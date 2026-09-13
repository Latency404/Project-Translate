// API-Tests gegen die Fake-API: PT_FAKE=1 auf einer Fixture-Kopie (tmp),
// damit die echten Fixtures unter server/fixtures/ nicht verändert werden.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, rmSync, cpSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const PORT = 3199
const BASE = `http://localhost:${PORT}/api`
const FIXTURES = path.join(__dirname, 'fixtures')

let child
let workdir
let fakeRoot
let exportRoot
let configPath

function readDir(p) {
  try {
    return readdirSync(p, { withFileTypes: true }).map((d) => d.name)
  } catch {
    return []
  }
}

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-test-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(FIXTURES, fakeRoot, { recursive: true })
  exportRoot = path.join(workdir, 'export')
  configPath = path.join(workdir, 'config.json')

  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PT_FAKE: '1',
      PT_FAKE_ROOT: fakeRoot,
      PT_EXPORT_ROOT: exportRoot,
      PT_CONFIG_PATH: configPath
    },
    stdio: 'pipe'
  })
  const deadline = Date.now() + 10000
  for (;;) {
    try {
      const res = await fetch(`${BASE}/status`)
      if (res.ok) break
    } catch {}
    if (Date.now() > deadline) throw new Error('API startete nicht')
    await new Promise((r) => setTimeout(r, 100))
  }
})

after(() => {
  if (child) child.kill()
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, json: await res.json() }
}

test('GET /api/status zeigt gefundene Fake-Wurzeln', async () => {
  const { status, json } = await api('GET', '/status')
  assert.equal(status, 200)
  assert.equal(json.gameFound, true)
  assert.equal(json.workshopFound, true)
  assert.equal(json.scanRunning, false)
  assert.equal(json.modCount, 0)
  assert.equal(json.error, null)
})

test('GET /api/mods ohne Scan → 404 mit lesbarer Meldung', async () => {
  const { status, json } = await api('GET', '/mods')
  assert.equal(status, 404)
  assert.ok(typeof json.error === 'string' && json.error.length > 0)
})

test('GET /api/config liefert Defaults (DE)', async () => {
  const { status, json } = await api('GET', '/config')
  assert.equal(status, 200)
  assert.equal(json.targetLang, 'DE')
  assert.ok(json.gameRoot.startsWith('C:/'))
  assert.ok(json.workshopDir.startsWith('C:/'))
})

test('Scan: 4 Mods mit entryCount, Basisspiel dabei', async () => {
  const scan = await api('POST', '/scan')
  assert.equal(scan.status, 202)
  const deadline = Date.now() + 10000
  for (;;) {
    const st = await api('GET', '/status')
    if (!st.json.scanRunning) break
    if (Date.now() > deadline) throw new Error('Scan beendet nicht')
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.equal((await api('GET', '/status')).json.modCount, 4)

  const { status, json } = await api('GET', '/mods')
  assert.equal(status, 200)
  const mods = json.mods
  assert.equal(mods.length, 4)
  const names = mods.map((m) => m.name)
  assert.ok(names.includes('Project Zomboid (Base Game)'))
  for (const m of mods) assert.ok(m.entryCount > 0, `entryCount für ${m.name}`)

  const base = mods.find((m) => m.id === 'BASE')
  assert.equal(base.isBaseGame, true)
  assert.deepEqual(base.versions, ['base'])
  // Base Game: 11 EN-Keys (4+3+4), 8 DE vorhanden → translatedCount 8
  assert.equal(base.entryCount, 11)
  assert.equal(base.translatedCount, 8)

  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  assert.ok(coffee)
  assert.deepEqual(coffee.versions, ['42.20']) // nur die neueste Version
  assert.equal(coffee.entryCount, 11) // 42.20 (ContextMenu 5 + IG_UI 6)
  assert.equal(coffee.translatedCount, 10) // 42.20 DE (4 + 6)
})

test('GET /api/mods/:modId/entries — Pagination + Suche + id-Format', async () => {
  const pid = encodeURIComponent('2688538916/Coffee Machines Fix')
  const first = await api('GET', `/mods/${pid}/entries?page=1&pageSize=5`)
  assert.equal(first.status, 200)
  assert.equal(first.json.total, 11)
  assert.equal(first.json.entries.length, 5)
  const e = first.json.entries[0]
  assert.equal(e.modId, '2688538916/Coffee Machines Fix')
  assert.equal(e.version, '42.20')
  assert.equal(e.file, 'media/lua/shared/Translate/EN/ContextMenu.json')
  assert.match(e.id, /^42\.20\/media\/lua\/shared\/Translate\/EN\/ContextMenu\.json::ContextMenu_.+/)
  assert.equal(typeof e.original, 'string')
  assert.equal(typeof e.preFilled, 'boolean')

  const last = await api('GET', `/mods/${pid}/entries?page=3&pageSize=5`)
  assert.equal(last.json.entries.length, 1)

  const found = await api('GET', `/mods/${pid}/entries?search=Coffee`)
  assert.ok(found.json.total > 0)
  for (const en of found.json.entries) {
    assert.ok(
      en.key.toLowerCase().includes('coffee') || en.original.toLowerCase().includes('coffee')
    )
  }
  const none = await api('GET', `/mods/${pid}/entries?search=zzzz_nix`)
  assert.equal(none.json.total, 0)
})

test('PUT /api/mods/:modId/entries — speichern + Backup + Ziel-Datei', async () => {
  const pid = encodeURIComponent('3554514861/Fuel Bowser')
  const before = await api('GET', `/mods/${pid}/entries`)
  const miss = before.json.entries.find((e) => e.translation === null)
  assert.ok(miss)
  const put = await api('PUT', `/mods/${pid}/entries`, {
    entries: [{ entryId: miss.id, translation: 'Testübersetzung' }]
  })
  assert.equal(put.status, 200)
  assert.equal(put.json.saved, 1)

  // Die DE-Datei in der Fake-Kopie enthält jetzt den neuen Wert.
  const tgt = path.join(
    fakeRoot, 'workshop', '3554514861', 'mods', 'Fuel Bowser', '42.20',
    'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'
  )
  const written = JSON.parse(readFileSync(tgt, 'utf8'))
  assert.equal(written[miss.key], 'Testübersetzung')

  // Backup liegt unter export/backups/<stempel>/<modId>__<version>__<file>/
  const backups = path.join(exportRoot, 'backups')
  const batchDirs = readDir(backups)
  assert.ok(batchDirs.length >= 1)
  let found = false
  for (const d of batchDirs) {
    for (const sub of readDir(path.join(backups, d))) {
      if (sub.includes('Fuel Bowser') && readDir(path.join(backups, d, sub)).includes('ContextMenu.json')) {
        found = true
      }
    }
  }
  assert.ok(found, 'Backup der alten DE-Datei fehlt')
})

test('GET /api/import/llm/preview leerer Ordner → 0/0', async () => {
  const { status, json } = await api('GET', '/import/llm/preview')
  assert.equal(status, 200)
  assert.equal(json.matched, 0)
  assert.equal(json.unmatched, 0)
  assert.deepEqual(json.perMod, {})
})
