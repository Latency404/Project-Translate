// API-Tests gegen die Fake-API: PT_FAKE=1 auf einer Fixture-Kopie (tmp),
// damit die echten Fixtures unter server/fixtures/ nicht verändert werden.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, rmSync, cpSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const PORT = 3199
// 127.0.0.1, nicht "localhost": die API bindet jetzt ausdrücklich nur an die
// Loopback-Adresse (s. server/index.js) — auf Node 17+ kann "localhost" zu
// ::1 aufgelöst werden, worauf niemand lauscht.
const BASE = `http://127.0.0.1:${PORT}/api`
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

// Arbeitsdatei einer Übersetzung: <export>/work/<modId, "/"→"_">/<version>/media/lua/shared/Translate/<LANG>/<Datei>.
function workFile(modId, version, lang, fileName) {
  return path.join(exportRoot, 'work', modId.replace(/[\\/:*?"<>|]/g, '_'), version, 'media', 'lua', 'shared', 'Translate', lang, fileName)
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

// Content-Type: application/json auf JEDEM Call, auch ohne Body — genau wie
// die Frontend (src/api.js) es tut. Die API lehnt schreibende Methoden ohne
// diesen Header inzwischen mit 415 ab (CSRF-Härtung, s. server/index.js).
async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, json: await res.json() }
}

async function waitForScan() {
  const deadline = Date.now() + 10000
  for (;;) {
    const st = await api('GET', '/status')
    if (!st.json.scanRunning) return
    if (Date.now() > deadline) throw new Error('Scan beendet nicht')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('GET /api/status zeigt gefundene Fake-Wurzeln + Default-Sprachen', async () => {
  const { status, json } = await api('GET', '/status')
  assert.equal(status, 200)
  assert.equal(json.gameFound, true)
  assert.equal(json.workshopFound, true)
  assert.equal(json.scanRunning, false)
  assert.equal(json.modCount, 0)
  assert.equal(json.error, null)
  assert.deepEqual(json.targetLangs, ['DE'])
  assert.equal(json.activeLang, 'DE')
})

test('POST ohne Content-Type: application/json → 415 (CSRF-Härtung)', async () => {
  // Simuliert einen "einfachen" Cross-Origin-Request (<form>-POST oder fetch
  // mit Content-Type: text/plain) — kein Preflight, den ein echter
  // Cross-Origin-JSON-Request auslösen würde. Ohne diese Sperre würde
  // express.json() den Body nicht parsen (req.body bleibt {}) und z. B.
  // POST /api/reset-translations liefe trotzdem durch.
  const textPlain = await fetch(`${BASE}/reset-translations`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}'
  })
  assert.equal(textPlain.status, 415)
  const textPlainJson = await textPlain.json()
  assert.ok(typeof textPlainJson.error === 'string' && textPlainJson.error.length > 0)

  // Klassisches <form>-POST: gar kein Content-Type-Header gesetzt.
  const noHeader = await fetch(`${BASE}/reset-translations`, { method: 'POST' })
  assert.equal(noHeader.status, 415)

  // GET bleibt davon unberührt — nur schreibende Methoden sind betroffen.
  const get = await fetch(`${BASE}/status`)
  assert.equal(get.status, 200)
})

test('GET /api/mods ohne Scan → 404 mit lesbarer Meldung', async () => {
  const { status, json } = await api('GET', '/mods')
  assert.equal(status, 404)
  assert.ok(typeof json.error === 'string' && json.error.length > 0)
})

test('GET /api/config liefert Defaults (targetLangs/activeLang, kein sourceLang)', async () => {
  const { status, json } = await api('GET', '/config')
  assert.equal(status, 200)
  assert.deepEqual(json.targetLangs, ['DE'])
  assert.equal(json.activeLang, 'DE')
  assert.equal(json.sourceLang, undefined)
  assert.ok(json.gameRoot.startsWith('C:/'))
  assert.ok(json.workshopDir.startsWith('C:/'))
})

test('POST /api/config — zwei Zielsprachen (DE, FR), aktive Sprache DE', async () => {
  const gameRoot = path.join(fakeRoot, 'gameRoot')
  const workshopDir = path.join(fakeRoot, 'workshop')
  const res = await api('POST', '/config', {
    gameRoot,
    workshopDir,
    targetLangs: ['DE', 'FR'],
    activeLang: 'DE'
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.targetLangs, ['DE', 'FR'])
  assert.equal(res.json.activeLang, 'DE')

  const got = await api('GET', '/config')
  assert.deepEqual(got.json.targetLangs, ['DE', 'FR'])
})

test('Scan: 5 Mods mit entryCount, Basisspiel dabei, translatedCount je Sprache', async () => {
  const scan = await api('POST', '/scan')
  assert.equal(scan.status, 202)
  await waitForScan()
  assert.equal((await api('GET', '/status')).json.modCount, 5)

  // DE: dieselben Werte wie im bisherigen Einzelsprachen-Verhalten.
  const de = await api('GET', '/mods?lang=DE')
  assert.equal(de.status, 200)
  const mods = de.json.mods
  assert.equal(mods.length, 5)
  const names = mods.map((m) => m.name)
  assert.ok(names.includes('Project Zomboid (Base Game)'))
  assert.ok(names.includes('Mixed Traits'))
  for (const m of mods) assert.ok(m.entryCount > 0, `entryCount für ${m.name}`)
  for (const m of mods) assert.ok(m.filesCount > 0, `filesCount für ${m.name}`)

  const base = mods.find((m) => m.id === 'BASE')
  assert.equal(base.isBaseGame, true)
  assert.deepEqual(base.versions, ['base'])
  // Base Game: 11 EN-Keys (4+3+4), 8 DE vorhanden → translatedCount 8
  assert.equal(base.entryCount, 11)
  assert.equal(base.translatedCount, 8)
  assert.equal(base.translatedCounts, undefined, 'translatedCounts (Objekt) wird nicht nach außen gegeben')

  const coffee = mods.find((m) => m.id === '2000000002/Coffee Corner')
  assert.ok(coffee)
  assert.deepEqual(coffee.versions, ['42.20']) // nur die neueste Version
  assert.equal(coffee.entryCount, 11) // 42.20 (ContextMenu 5 + IG_UI 6)
  assert.equal(coffee.translatedCount, 11) // 42.20 DE (5 + 6)
  assert.equal(coffee.filesCount, 2) // ContextMenu.json + IG_UI.json

  const traits = mods.find((m) => m.id === '1000000001/Mixed Traits')
  assert.ok(traits)
  assert.deepEqual(traits.versions, ['42.20'])
  assert.equal(traits.entryCount, 3)
  assert.equal(traits.translatedCount, 2)

  // FR: keine FR-Fixtures vorhanden → gleicher entryCount, aber
  // translatedCount 0 für jeden Mod (plausibel: nichts vorübersetzt).
  const fr = await api('GET', '/mods?lang=FR')
  assert.equal(fr.status, 200)
  for (const m of fr.json.mods) {
    const deMod = mods.find((x) => x.id === m.id)
    assert.equal(m.entryCount, deMod.entryCount, `entryCount(FR) == entryCount(DE) für ${m.name}`)
    assert.equal(m.translatedCount, 0, `translatedCount(FR) für ${m.name}`)
  }

  // Ohne ?lang= gilt activeLang (DE).
  const def = await api('GET', '/mods')
  assert.equal(def.json.mods.find((m) => m.id === 'BASE').translatedCount, 8)
})

test('GET /api/mods?lang= — unbekannte/nicht gescannte Sprache → 400', async () => {
  const res = await api('GET', '/mods?lang=XX')
  assert.equal(res.status, 400)
  assert.ok(typeof res.json.error === 'string' && res.json.error.length > 0)
})

test('POST /api/active-lang — wechselt ohne Rescan, lehnt unkonfigurierte Sprache ab', async () => {
  const before = await api('GET', '/mods?lang=FR')
  assert.equal(before.status, 200)

  const switched = await api('POST', '/active-lang', { lang: 'fr' })
  assert.equal(switched.status, 200)
  assert.equal(switched.json.activeLang, 'FR')

  const status = await api('GET', '/status')
  assert.equal(status.json.activeLang, 'FR')
  assert.equal(status.json.scanRunning, false)
  // Cache blieb erhalten — kein neuer Scan nötig, /mods antwortet sofort mit
  // denselben Mods (kein 404, kein modCount-Reset).
  assert.equal(status.json.modCount, 5)

  const mods = await api('GET', '/mods') // Default jetzt FR
  assert.equal(mods.status, 200)
  assert.equal(mods.json.mods.find((m) => m.id === 'BASE').translatedCount, 0)

  const rejected = await api('POST', '/active-lang', { lang: 'XX' })
  assert.equal(rejected.status, 400)
  assert.match(rejected.json.error, /Unknown target language/)

  // Zurück auf DE für die nachfolgenden Tests.
  const reset = await api('POST', '/active-lang', { lang: 'DE' })
  assert.equal(reset.status, 200)
  assert.equal(reset.json.activeLang, 'DE')
})

test('GET /api/mods/:modId/entries — Pagination + Suche + id-Format', async () => {
  const pid = encodeURIComponent('2000000002/Coffee Corner')
  const first = await api('GET', `/mods/${pid}/entries?page=1&pageSize=5`)
  assert.equal(first.status, 200)
  assert.equal(first.json.total, 11)
  assert.equal(first.json.entries.length, 5)
  const e = first.json.entries[0]
  assert.equal(e.modId, '2000000002/Coffee Corner')
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

  // ?lang=FR: keine Fixtures → alles null/preFilled false, aber dieselben Keys.
  const fr = await api('GET', `/mods/${pid}/entries?lang=FR&page=1&pageSize=5`)
  assert.equal(fr.status, 200)
  assert.equal(fr.json.total, 11)
  for (const en of fr.json.entries) {
    assert.equal(en.translation, null)
    assert.equal(en.preFilled, false)
  }

  const badLang = await api('GET', `/mods/${pid}/entries?lang=XX`)
  assert.equal(badLang.status, 400)
})

test('GET /api/mods/:modId/entries — Suche findet auch Treffer in der Übersetzung der angefragten Sprache', async () => {
  const pid = encodeURIComponent('3500000004/Fuel Trailer')
  const all = await api('GET', `/mods/${pid}/entries?lang=DE&pageSize=500`)
  // Ein Eintrag, dessen Übersetzung weder im Key noch im Original vorkommt.
  const entry = all.json.entries.find(
    (e) => e.translation && !e.key.toLowerCase().includes(e.translation.toLowerCase()) && !e.original.toLowerCase().includes(e.translation.toLowerCase())
  )
  assert.ok(entry, 'Fixture mit DE-Übersetzung fehlt')
  const term = entry.translation.slice(0, 5).toUpperCase() // Groß-/Kleinschreibung egal

  const de = await api('GET', `/mods/${pid}/entries?lang=DE&search=${encodeURIComponent(term)}`)
  assert.ok(de.json.entries.some((e) => e.id === entry.id), 'Treffer in der DE-Übersetzung')

  // Eine andere Sprache (FR, keine Übersetzung) durchsucht ihre eigene, nicht die DE.
  const fr = await api('GET', `/mods/${pid}/entries?lang=FR&search=${encodeURIComponent(term)}`)
  assert.ok(!fr.json.entries.some((e) => e.id === entry.id))
})

test('PUT /api/mods/:modId/entries — speichert in den Arbeitsordner (Workshop-Kopie bleibt unverändert) + Backup', async () => {
  const pid = encodeURIComponent('3500000004/Fuel Trailer')
  const before = await api('GET', `/mods/${pid}/entries`)
  const miss = before.json.entries.find((e) => e.translation === null)
  assert.ok(miss)
  const gameFile = path.join(
    fakeRoot, 'workshop', '3500000004', 'mods', 'Fuel Trailer', '42.20',
    'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'
  )
  const gameFileBefore = readFileSync(gameFile, 'utf8')
  const put = await api('PUT', `/mods/${pid}/entries`, {
    entries: [{ entryId: miss.id, translation: 'Testübersetzung' }]
  })
  assert.equal(put.status, 200)
  assert.equal(put.json.saved, 1)

  // Der neue Wert liegt in der Arbeitsdatei ...
  const written = JSON.parse(readFileSync(workFile('3500000004/Fuel Trailer', '42.20', 'DE', 'ContextMenu.json'), 'utf8'))
  assert.equal(written[miss.key], 'Testübersetzung')
  // ... die Datei im (Fake-)Workshop wurde nicht angefasst.
  assert.equal(readFileSync(gameFile, 'utf8'), gameFileBefore)
  // Der Rescan zeigt die Übersetzung.
  const after = await api('GET', `/mods/${pid}/entries`)
  assert.equal(after.json.entries.find((e) => e.id === miss.id).translation, 'Testübersetzung')

  // Ein Speicherpunkt mit meta.json liegt unter export/backups/<stempel>/; sein
  // Zielpfad ist die Arbeitsdatei.
  const backups = path.join(exportRoot, 'backups')
  const batchDirs = readDir(backups)
  assert.ok(batchDirs.length >= 1)
  const metas = batchDirs.map((d) => JSON.parse(readFileSync(path.join(backups, d, 'meta.json'), 'utf8')))
  assert.ok(
    metas.some((m) => m.files.some((f) => f.modName === 'Fuel Trailer' && f.lang === 'DE' && f.targetPath.includes('/export/work/'))),
    'Speicherpunkt der Arbeitsdatei fehlt'
  )
})

test('PUT /api/mods/:modId/entries — mit lang schreibt in die richtige Arbeitsdatei (FR)', async () => {
  const pid = encodeURIComponent('2000000002/Coffee Corner')
  const entries = await api('GET', `/mods/${pid}/entries?lang=FR`)
  const target = entries.json.entries[0]
  const put = await api('PUT', `/mods/${pid}/entries`, {
    entries: [{ entryId: target.id, translation: 'Traduction de test' }],
    lang: 'fr'
  })
  assert.equal(put.status, 200)
  assert.equal(put.json.saved, 1)

  const tgt = workFile('2000000002/Coffee Corner', '42.20', 'FR', 'ContextMenu.json')
  assert.ok(existsSync(tgt), 'FR-Arbeitsdatei wurde nicht angelegt')
  const written = JSON.parse(readFileSync(tgt, 'utf8'))
  assert.equal(written[target.key], 'Traduction de test')

  // Die DE-Version desselben Keys ist davon unberührt.
  const de = await api('GET', `/mods/${pid}/entries?lang=DE`)
  const deTarget = de.json.entries.find((e) => e.id === target.id)
  assert.notEqual(deTarget.translation, 'Traduction de test')
})

test('POST /api/export/mod — nimmt den Arbeitsstand (gespeicherte Übersetzungen) in die Mod', async () => {
  const targetDir = path.join(workdir, 'mod-export-work')
  const res = await api('POST', '/export/mod', {
    modIds: ['3500000004/Fuel Trailer'],
    targetLangs: ['DE'],
    targetDir
  })
  assert.equal(res.status, 200)
  const [result] = res.json.results
  const file = path.join(result.targetPath, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json')
  assert.ok(Object.values(JSON.parse(readFileSync(file, 'utf8'))).includes('Testübersetzung'))
})

test('POST /api/export/mod — Zielordner im Spiel/Workshop wird mit 403 abgelehnt, nichts wird geschrieben', async () => {
  const targetDir = path.join(fakeRoot, 'workshop', 'export-hier-nicht')
  const res = await api('POST', '/export/mod', {
    modIds: ['3500000004/Fuel Trailer'],
    targetLangs: ['DE'],
    targetDir
  })
  assert.equal(res.status, 403)
  assert.match(res.json.error, /Refusing to write/)
  assert.equal(existsSync(targetDir), false)
})

test('PUT /api/mods/:modId/entries — nicht konfigurierte Sprache → 400', async () => {
  const pid = encodeURIComponent('2000000002/Coffee Corner')
  const entries = await api('GET', `/mods/${pid}/entries`)
  const target = entries.json.entries[0]
  const res = await api('PUT', `/mods/${pid}/entries`, {
    entries: [{ entryId: target.id, translation: 'X' }],
    lang: 'XX'
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language/)
})

test('POST /api/export/llm + POST /api/import/llm/preview → Roundtrip über die Routen', async () => {
  // Export: alle ausgewählten Mods in EINE Datei (JSON-String), keine Disk-Datei;
  // ohne targetLangs im Body gilt die Konfiguration (DE, FR).
  const exp = await api('POST', '/export/llm', {
    modIds: ['2000000002/Coffee Corner']
  })
  assert.equal(exp.status, 200)
  assert.ok(typeof exp.json.text === 'string' && exp.json.text.length > 0)
  assert.equal(exp.json.modCount, 1)
  assert.equal(exp.json.filename, 'llm-translation.json')
  assert.ok(exp.json.entryCount > 0)
  assert.deepEqual(exp.json.targetLangs, ['DE', 'FR'])
  const doc = JSON.parse(exp.json.text)
  assert.deepEqual(doc.targetLangs, ['DE', 'FR'])
  assert.deepEqual(doc.translations, { DE: {}, FR: {} })

  // Das "LLM" befüllt translations.DE 1:1 aus den Originaltexten (mods).
  const coffeeDoc = doc.mods.find((d) => d.modId === '2000000002/Coffee Corner')
  doc.translations.DE[coffeeDoc.modId] = coffeeDoc.files

  const pv = await api('POST', '/import/llm/preview', { text: JSON.stringify(doc) })
  assert.equal(pv.status, 200)
  assert.equal(pv.json.matched, exp.json.entryCount)
  assert.equal(pv.json.unmatched, 0)
  assert.ok(Object.keys(pv.json.perMod).includes('2000000002/Coffee Corner'))
  assert.deepEqual(pv.json.detectedTargetLangs, ['DE', 'FR'])
  assert.deepEqual(pv.json.unknownLangs, [])

  // Leere Datei → 400 mit Fehlermeldung.
  const empty = await api('POST', '/import/llm/preview', { text: '' })
  assert.equal(empty.status, 400)
  assert.ok(typeof empty.json.error === 'string')
})

test('POST /api/import/llm/preview — nicht konfigurierte Sprache landet in unknownLangs, nicht in matches', async () => {
  const exp = await api('POST', '/export/llm', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['DE']
  })
  const doc = JSON.parse(exp.json.text)
  const coffeeDoc = doc.mods.find((d) => d.modId === '2000000002/Coffee Corner')
  // "ES" ist nicht Teil der konfigurierten targetLangs (DE, FR).
  const bundle = {
    targetLangs: ['ES'],
    note: 'irrelevant',
    mods: doc.mods,
    translations: { ES: { [coffeeDoc.modId]: coffeeDoc.files } }
  }

  const pv = await api('POST', '/import/llm/preview', { text: JSON.stringify(bundle) })
  assert.equal(pv.status, 200)
  assert.deepEqual(pv.json.detectedTargetLangs, ['ES'])
  assert.deepEqual(pv.json.unknownLangs, ['ES'])
  assert.equal(pv.json.matched, 0)
  assert.equal(pv.json.unmatched, 0)
  assert.equal(pv.json.matches.length, 0)
  assert.ok(!pv.json.matches.some((m) => m.lang === 'ES'))
})

test('POST /api/config — nicht existierender gameRoot → 400', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'does-not-exist'),
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: ['DE']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Game folder/)
})

test('POST /api/config — nicht existierender workshopDir → 400', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'gameRoot'),
    workshopDir: path.join(fakeRoot, 'does-not-exist'),
    targetLangs: ['DE']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Workshop folder/)
})

test('POST /api/config — Datei statt Verzeichnis wird abgelehnt', async () => {
  // Es genügt irgendeine existierende Datei (kein Verzeichnis); wir nutzen
  // eine bekannte Fixture-Datei relativ zu fakeRoot.
  const existingFile = path.join(fakeRoot, 'workshop', '3500000004', 'mods', 'Fuel Trailer', 'mod.info')
  assert.ok(existsSync(existingFile), 'Fixture-Datei fehlt: ' + existingFile)
  const res = await api('POST', '/config', {
    gameRoot: existingFile,
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: ['DE']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Game folder/)
})

test('POST /api/config — Ordner ohne passenden Inhalt wird abgelehnt', async () => {
  // Existierende Ordner, aber weder Spiel noch Workshop-Inhalt.
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'workshop'),
    workshopDir: path.join(fakeRoot, 'gameRoot'),
    targetLangs: ['DE']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Game folder is not a Project Zomboid installation\./)
  assert.match(res.json.error, /Workshop folder contains no workshop mods\./)
})

test('POST /api/config — keine Zielsprache ausgewählt → 400', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'gameRoot'),
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: []
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Select at least one target language\./)
})

test('POST /api/config — unbekannte Zielsprache → 400', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'gameRoot'),
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: ['ZZ']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language: ZZ\./)
})

// EN ist als Zielsprache erlaubt (die englische Fassung selbst umschreiben,
// s. server/langs.js). Geprüft über einen Request, der an einem ANDEREN Feld
// scheitert: so bleibt die Konfiguration unverändert (ein erfolgreiches
// Speichern würde den Scan-Cache verwerfen und die Folgetests aushebeln), und
// trotzdem zeigt die Fehlermeldung, dass EN selbst nicht beanstandet wird.
test('POST /api/config — EN als Zielsprache wird nicht abgelehnt', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'does-not-exist'),
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: ['DE', 'EN'],
    activeLang: 'EN'
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Game folder does not exist\./)
  assert.doesNotMatch(res.json.error, /target language|English/i)
})

test('POST /api/config — activeLang nicht Teil von targetLangs → 400', async () => {
  const res = await api('POST', '/config', {
    gameRoot: path.join(fakeRoot, 'gameRoot'),
    workshopDir: path.join(fakeRoot, 'workshop'),
    targetLangs: ['DE'],
    activeLang: 'FR'
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Active language must be one of the selected target languages\./)
})

test('POST /api/config — targetLangs-Änderung startet einen Hintergrund-Scan', async () => {
  const before = await api('GET', '/mods')
  assert.equal(before.status, 200)

  const gameRoot = path.join(fakeRoot, 'gameRoot')
  const workshopDir = path.join(fakeRoot, 'workshop')
  const changed = await api('POST', '/config', {
    gameRoot,
    workshopDir,
    targetLangs: ['DE', 'FR', 'IT']
  })
  assert.equal(changed.status, 200)

  // Der alte Cache kennt IT nicht — der Server scannt selbst im Hintergrund neu.
  await waitForScan()
  const afterChange = await api('GET', '/mods?lang=IT')
  assert.equal(afterChange.status, 200)

  // Zurück auf DE, FR (Zustand vor diesem Test) — ebenfalls automatisch gescannt.
  const reset = await api('POST', '/config', {
    gameRoot,
    workshopDir,
    targetLangs: ['DE', 'FR'],
    activeLang: 'DE'
  })
  assert.equal(reset.status, 200)
  await waitForScan()
  const afterReset = await api('GET', '/mods')
  assert.equal(afterReset.status, 200)
})

test('POST /api/config — reiner activeLang-Wechsel behält den Scan-Cache', async () => {
  const before = await api('GET', '/status')
  assert.equal(before.json.modCount, 5)

  const gameRoot = path.join(fakeRoot, 'gameRoot')
  const workshopDir = path.join(fakeRoot, 'workshop')
  const res = await api('POST', '/config', {
    gameRoot,
    workshopDir,
    targetLangs: ['DE', 'FR'],
    activeLang: 'FR'
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.activeLang, 'FR')

  // Kein Rescan nötig — /mods antwortet sofort (kein 404).
  const mods = await api('GET', '/mods')
  assert.equal(mods.status, 200)

  // Zurück auf DE für nachfolgende Tests.
  const back = await api('POST', '/config', {
    gameRoot,
    workshopDir,
    targetLangs: ['DE', 'FR'],
    activeLang: 'DE'
  })
  assert.equal(back.status, 200)
})

test('POST /api/export/mod — legt eine installierbare Mod mit mod.info an (eine Sprache)', async () => {
  const targetDir = path.join(workdir, 'mod-export-route')
  const res = await api('POST', '/export/mod', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['DE'],
    targetDir
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.targetLangs, ['DE'])
  assert.equal(res.json.results.length, 1)
  const [result] = res.json.results
  assert.ok(result.written.length > 0)

  // B42 erkennt eine Mod nur über <version>/mod.info bzw. common/mod.info
  assert.ok(readDir(path.join(result.targetPath, '42')).includes('mod.info'), 'mod.info fehlt unter 42/')
})

test('POST /api/export/mod — zwei Sprachen liefern einen Mod mit beiden Sprachordnern', async () => {
  const targetDir = path.join(workdir, 'mod-export-route-multi')
  const res = await api('POST', '/export/mod', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['de', 'fr'],
    targetDir
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.targetLangs, ['DE', 'FR'])
  assert.equal(res.json.results.length, 1)
  const [result] = res.json.results
  assert.deepEqual(result.targetLangs, ['DE', 'FR'])

  const langsDir = path.join(result.targetPath, 'common', 'media', 'lua', 'shared', 'Translate')
  const langs = readDir(langsDir)
  assert.ok(langs.includes('DE'), 'DE-Sprachordner fehlt')
  assert.ok(langs.includes('FR'), 'FR-Sprachordner fehlt — sollte die eben per PUT gespeicherte Übersetzung enthalten')
})

test('POST /api/export/mod — Rückwärtskompatibilität: einzelnes targetLang (String)', async () => {
  const targetDir = path.join(workdir, 'mod-export-route-legacy')
  const res = await api('POST', '/export/mod', {
    modIds: ['2000000002/Coffee Corner'],
    targetLang: 'DE',
    targetDir
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.targetLangs, ['DE'])
})

test('POST /api/export/mod — leere Mod-Auswahl → 400', async () => {
  const res = await api('POST', '/export/mod', { modIds: [], targetLangs: ['DE'] })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /No valid mod selection/)
})

// Ein Tippfehler in targetLangs (z. B. "ZZ") bricht sonst erst unbemerkt beim
// Schreiben der Export-Dateien — die Route soll ihn vorher mit 400 abfangen
// (server/langs.js → isKnownLang), noch vor der Mod-Auswahl-Prüfung.
test('POST /api/export/mod — unbekannte Zielsprache → 400', async () => {
  const res = await api('POST', '/export/mod', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['ZZ']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language: ZZ\./)
})

test('POST /api/export/llm — unbekannte Zielsprache → 400', async () => {
  const res = await api('POST', '/export/llm', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['ZZ']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language: ZZ\./)
})

test('POST /api/export/mod/zip — unbekannte Zielsprache → 400', async () => {
  const res = await api('POST', '/export/mod/zip', {
    modIds: ['2000000002/Coffee Corner'],
    targetLangs: ['ZZ']
  })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language: ZZ\./)
})

// Der Weg, den der globale "Export Mod"-Button tatsächlich nimmt: dieselbe Mod
// wie /export/mod, aber serverseitig gezippt als Binärantwort. Die Dateinamen
// stehen im ZIP unkomprimiert im Header/Central Directory — deshalb genügt die
// Suche im Buffer, ohne einen ZIP-Parser in den Test zu holen.
test('POST /api/export/mod/zip — ZIP-Download enthält beide Sprachordner', async () => {
  const res = await fetch(BASE + '/export/mod/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modIds: ['2000000002/Coffee Corner'],
      targetLangs: ['DE', 'FR']
    })
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/zip')
  assert.match(res.headers.get('content-disposition'), /attachment; filename="[^"]+\.zip"/)
  const buf = Buffer.from(await res.arrayBuffer())
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'PK', 'keine ZIP-Signatur')
  const names = buf.toString('latin1')
  assert.ok(names.includes('Translate/DE/'), 'DE-Sprachordner fehlt in der ZIP')
  assert.ok(names.includes('Translate/FR/'), 'FR-Sprachordner fehlt in der ZIP')
  assert.ok(names.includes('mod.info'), 'mod.info fehlt in der ZIP')
})

test('POST /api/import/llm/preview — liefert matches (entryId + Uebersetzung + lang), schreibt nichts', async () => {
  const exp = await api('POST', '/export/llm', {
    modIds: ['1000000001/Mixed Traits'],
    targetLangs: ['DE']
  })
  assert.equal(exp.status, 200)
  const doc = JSON.parse(exp.json.text)
  const traitsDoc = doc.mods.find((d) => d.modId === '1000000001/Mixed Traits')
  doc.translations.DE[traitsDoc.modId] = traitsDoc.files

  const before = await api('GET', '/mods?lang=DE')
  const traitsBefore = before.json.mods.find((m) => m.id === '1000000001/Mixed Traits')

  const preview = await api('POST', '/import/llm/preview', { text: JSON.stringify(doc) })
  assert.equal(preview.status, 200)
  assert.ok(preview.json.matched > 0)
  assert.ok(Array.isArray(preview.json.matches))
  assert.equal(preview.json.matches.length, preview.json.matched)
  for (const m of preview.json.matches) {
    assert.equal(m.modId, '1000000001/Mixed Traits')
    assert.match(m.entryId, /^[^/]+\/media\/lua\/shared\/Translate\/EN\/.+::.+$/)
    assert.equal(typeof m.translation, 'string')
    assert.equal(m.lang, 'DE')
  }

  // Die Route schreibt nichts — /api/mods bleibt unveraendert.
  const after = await api('GET', '/mods?lang=DE')
  const traitsAfter = after.json.mods.find((m) => m.id === '1000000001/Mixed Traits')
  assert.equal(traitsAfter.translatedCount, traitsBefore.translatedCount)
})

test('POST /api/import/llm/preview — leerer Text → 400', async () => {
  const res = await api('POST', '/import/llm/preview', { text: '' })
  assert.equal(res.status, 400)
  assert.ok(typeof res.json.error === 'string')
})

test('POST /api/reset-translations — zurück auf den Stand im Workshop, Workshop-Dateien bleiben unverändert', async () => {
  const pid = encodeURIComponent('3500000004/Fuel Trailer')
  const vdir = path.join(fakeRoot, 'workshop', '3500000004', 'mods', 'Fuel Trailer', '42.20')
  const enContextMenuPath = path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'EN', 'ContextMenu.json')
  const deIgUiPath = path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'DE', 'IG_UI.json')
  const enBefore = readFileSync(enContextMenuPath, 'utf8')
  const deIgUiBefore = readFileSync(deIgUiPath, 'utf8')

  // IG_UI.json (DE) hat eine mit der Fixture ausgelieferte Übersetzung im
  // Workshop-Ordner. Wir überschreiben ihren einzigen Key über die API — das
  // legt nur eine Arbeitsdatei an.
  const before = await api('GET', `/mods/${pid}/entries?lang=DE`)
  const igUiEntry = before.json.entries.find((e) => e.file.endsWith('IG_UI.json'))
  assert.ok(igUiEntry)
  assert.equal(igUiEntry.translation, 'Treibstofftankzug', 'Fixture-Vorbelegung fehlt')

  const overwrite = await api('PUT', `/mods/${pid}/entries`, {
    entries: [{ entryId: igUiEntry.id, translation: 'Vom User geaendert' }],
    lang: 'DE'
  })
  assert.equal(overwrite.status, 200)
  const workIgUi = workFile('3500000004/Fuel Trailer', '42.20', 'DE', 'IG_UI.json')
  assert.equal(JSON.parse(readFileSync(workIgUi, 'utf8')).IGUI_VehicleNameFuelTrailer, 'Vom User geaendert')
  assert.equal(readFileSync(deIgUiPath, 'utf8'), deIgUiBefore, 'Workshop-Datei nach dem Speichern unverändert')

  // ContextMenu.json (DE) wurde schon vom früheren PUT-Test beschrieben (Arbeitsdatei).
  const res = await api('POST', '/reset-translations', { langs: ['DE'] })
  assert.equal(res.status, 200)
  assert.ok(res.json.resetCount > 0)
  assert.ok(res.json.modCount > 0)

  // Originale im Workshop-Ordner unverändert, die Arbeitsdatei ist weg.
  assert.equal(readFileSync(enContextMenuPath, 'utf8'), enBefore)
  assert.equal(readFileSync(deIgUiPath, 'utf8'), deIgUiBefore)
  assert.equal(existsSync(workIgUi), false)

  // Die Übersetzung aus dem Workshop-Ordner gilt wieder — NICHT leer.
  const afterEntries = await api('GET', `/mods/${pid}/entries?lang=DE`)
  const igUiAfter = afterEntries.json.entries.find((e) => e.file.endsWith('IG_UI.json'))
  assert.equal(igUiAfter.translation, 'Treibstofftankzug')
  const contextMenuAfter = afterEntries.json.entries.filter((e) => e.file.endsWith('ContextMenu.json'))
  assert.ok(contextMenuAfter.every((e) => e.translation === null), 'ContextMenu.json sollte wieder leer sein')

  // Ein Mod ohne Arbeitsdatei behält seine Übersetzungen aus dem Workshop.
  const traitsPid = encodeURIComponent('1000000001/Mixed Traits')
  const traitsBefore = await api('GET', `/mods/${traitsPid}/entries?lang=DE`)
  assert.ok(traitsBefore.json.entries.some((e) => e.translation !== null), 'Mixed Traits sollte weiterhin Übersetzungen haben')

  // Die Arbeitsdatei wurde vor dem Löschen gesichert (Speicherpunkt "reset").
  const backups = path.join(exportRoot, 'backups')
  const metas = readDir(backups).map((d) => JSON.parse(readFileSync(path.join(backups, d, 'meta.json'), 'utf8')))
  assert.ok(
    metas.some((m) => m.kinds.includes('reset') && m.files.some((f) => f.modName === 'Fuel Trailer' && f.fileName === 'IG_UI.json' && f.lang === 'DE')),
    'Backup der Arbeitsdatei (IG_UI.json) fehlt'
  )
})

test('POST /api/reset-translations — Default (kein langs) betrifft ALLE targetLangs', async () => {
  const pid = encodeURIComponent('2000000002/Coffee Corner')
  // FR wurde in einem frueheren Test per PUT beschrieben.
  const before = await api('GET', `/mods/${pid}/entries?lang=FR`)
  assert.ok(before.json.entries.some((e) => e.translation !== null), 'FR sollte vor dem Reset eine Uebersetzung haben')

  const res = await api('POST', '/reset-translations')
  assert.equal(res.status, 200)

  const after = await api('GET', `/mods/${pid}/entries?lang=FR`)
  assert.ok(after.json.entries.every((e) => e.translation === null), 'FR sollte nach dem Default-Reset wieder leer sein')
})

test('POST /api/reset-translations — unbekannte Sprache in langs → 400', async () => {
  const res = await api('POST', '/reset-translations', { langs: ['XX'] })
  assert.equal(res.status, 400)
  assert.match(res.json.error, /Unknown target language: XX\./)
})

// Speicherpunkte ("Restore Backup" in Settings). Ans Dateiende gestellt: ein
// Restore verändert die Übersetzungsdateien und soll keinen anderen Test
// beeinflussen. Der Default-Reset oben hat FR geleert und dabei einen EIGENEN
// Punkt angelegt — genau den spielen wir zurück.
test('GET /api/backups — listet Punkte mit Metadaten, der Reset hat einen eigenen', async () => {
  const res = await api('GET', '/backups')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.json.backups) && res.json.backups.length > 0)
  const [newest] = res.json.backups
  assert.deepEqual(newest.kinds, ['reset'], 'der Reset muss ein eigener Punkt sein, nicht mit Speichern vermischt')
  assert.equal(newest.restorable, true)
  assert.ok(newest.createdAt && !Number.isNaN(Date.parse(newest.createdAt)))
  assert.ok(newest.langs.includes('FR'))
  assert.ok(newest.mods.some((m) => m.name === 'Coffee Corner'))
})

test('POST /api/backups/:id/restore — macht den Reset rückgängig', async () => {
  const pid = encodeURIComponent('2000000002/Coffee Corner')
  const before = await api('GET', `/mods/${pid}/entries?lang=FR`)
  assert.ok(before.json.entries.every((e) => e.translation === null), 'FR ist nach dem Reset leer')

  const [resetPoint] = (await api('GET', '/backups')).json.backups
  const res = await api('POST', `/backups/${resetPoint.id}/restore`)
  assert.equal(res.status, 200)
  assert.ok(res.json.restored > 0)
  assert.ok(res.json.safetyBackupId, 'vor dem Restore wird der aktuelle Stand gesichert')

  // Der Rescan nach dem Restore spiegelt die Disk sofort in die API.
  const after = await api('GET', `/mods/${pid}/entries?lang=FR`)
  assert.ok(after.json.entries.some((e) => e.translation !== null), 'FR-Übersetzung ist wieder da')
})

test('POST /api/backups/:id/restore — ungültige id → 400, unbekannte → 404', async () => {
  const bad = await api('POST', '/backups/..%2F..%2Fetc/restore')
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /Invalid backup id\./)
  const missing = await api('POST', '/backups/2001-01-01_00-00/restore')
  assert.equal(missing.status, 404)
})
