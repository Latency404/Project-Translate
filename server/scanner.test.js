// Scanner-Tests gegen die ECHTE Installation: die Steam-Pfade aus den Config-Defaults,
// nicht die Fixtures. Auf Maschinen ohne Project-Zomboid-Installation wird der Block
// übersprungen (skip) — die Assertions bleiben unverändert und greifen, wo die Daten
// vorhanden sind. Damit bleibt `npm test` überall grün, prüft hier aber die echte Logik.
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { scan, readFlatMap } = require('./scanner')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { DEFAULTS } = require('./config')
const fs = require('node:fs')

// Toleranter JSON-Reader (readFlatMap): striktes JSON bleibt unverändert,
// handgeschriebene Mod-Dateien (Trailing Comma, Lua-Style-Keys) werden gerettet.
test('readFlatMap: striktes JSON unverändert', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-scan-'))
  try {
    const p = join(dir, 'a.json')
    writeFileSync(p, '{"K1": "v1", "K2": "v2"}\n')
    assert.deepEqual(readFlatMap(p), { K1: 'v1', K2: 'v2' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readFlatMap: Trailing Comma (PZ-B42-JSON-Vorgabe-Bruch)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-scan-'))
  try {
    const p = join(dir, 'b.json')
    // So schreiben viele Mod-Autoren die B42-JSON-Dateien (CRLF + , vor })
    writeFileSync(p, '{\r\n\t"Base.item": "Item",\r\n\t"Base.item2": "Item 2",\r\n}\r\n')
    assert.deepEqual(readFlatMap(p), { 'Base.item': 'Item', 'Base.item2': 'Item 2' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readFlatMap: unquoted Lua-Style-Keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-scan-'))
  try {
    const p = join(dir, 'c.json')
    writeFileSync(p, '{\n\tUI_optionscreen_binding_OPTION_X: "Inspect Weapon",\n\tUI_other: "Other",\n}\n')
    assert.deepEqual(readFlatMap(p), {
      UI_optionscreen_binding_OPTION_X: 'Inspect Weapon',
      UI_other: 'Other'
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readFlatMap: BOM + Mischformen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-scan-'))
  try {
    const p = join(dir, 'd.json')
    writeFileSync(p, '\uFEFF{\nA: "a",\n"B": "b",\n}')
    assert.deepEqual(readFlatMap(p), { A: 'a', B: 'b' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readFlatMap: fehlende Datei / ungültiger Inhalt → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-scan-'))
  try {
    assert.equal(readFlatMap(join(dir, 'fehlt.json')), null)
    const p = join(dir, 'bad.json')
    writeFileSync(p, 'kein json {{')
    assert.equal(readFlatMap(p), null)
    const q = join(dir, 'arr.json')
    writeFileSync(q, '[1, 2, 3]')
    assert.equal(readFlatMap(q), null) // Arrays sind keine Maps
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// true, wenn a >= b (segmentweise numerisch, wie cmpVersionDesc im Scanner).
function versionGe(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x >= y
  }
  return true
}

const gameRoot = DEFAULTS.gameRoot
const workshopDir = DEFAULTS.workshopDir
const available = existsSync(gameRoot) && existsSync(workshopDir)
const skipReason = !available
  ? `echte PZ-Installation fehlt (gameRoot/workshopDir nicht gefunden): ${gameRoot}`
  : false

let result

before(async () => {
  if (!available) return
  result = await scan(gameRoot, workshopDir, DEFAULTS.targetLang)
})

test('echter Scan findet ≥ 100 Mods inkl. Base Game', { skip: skipReason }, () => {
  const { mods } = result
  assert.ok(mods.length >= 100, `erwartet ≥ 100 Mods, gefunden: ${mods.length}`)

  const base = mods.find((m) => m.id === 'BASE')
  assert.ok(base, 'Base Game wurde nicht gefunden')
  assert.equal(base.isBaseGame, true)
  assert.equal(base.name, 'Project Zomboid (Base Game)')
  assert.deepEqual(base.versions, ['base'])
})

test('1299328280 (More Traits): mehrere Mods, jeweils nur die neueste Version', {
  skip: skipReason
}, () => {
  const { mods } = result
  const moreTraits = mods.filter((m) => m.id.startsWith('1299328280/'))
  assert.ok(moreTraits.length >= 2, `erwartet mehrere More-Traits-Mods, gefunden: ${moreTraits.length}`)
  for (const m of moreTraits) {
    // Auf der Platte liegen mehrere Version-Ordner, aber nur die neueste wird genutzt.
    const onDisk = fs
      .readdirSync(m.rootPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+(\.\d+)*$/.test(d.name))
      .map((d) => d.name)
    assert.ok(onDisk.length >= 2, `${m.id}: erwartet mehrere Version-Ordner auf der Platte, gefunden: ${onDisk.length}`)
    assert.equal(m.versions.length, 1, `${m.id}: erwartet genau 1 Version, gefunden: ${JSON.stringify(m.versions)}`)
    let newest = onDisk[0]
    for (const v of onDisk) {
      if (versionGe(v, newest) && !versionGe(newest, v)) newest = v
    }
    assert.equal(
      m.versions[0], newest,
      `${m.id}: erwartet neueste Version ${newest}, gefunden: ${m.versions[0]}`
    )
  }
})

test('Einträge tragen id/file/key/original korrekt (id = <version>/<file>::<key>)', {
  skip: skipReason
}, () => {
  const { mods, entriesByModId } = result
  // Ein Mod mit Einträgen nehmen (robust: der mit dem meisten Inhalt).
  const withEntries = mods
    .map((m) => ({ m, entries: entriesByModId[m.id] || [] }))
    .find(({ entries }) => entries.length > 0)
  assert.ok(withEntries, 'kein Mod mit Einträgen gefunden')

  const { m, entries } = withEntries
  assert.ok(entries.length > 0)
  for (const e of entries) {
    assert.equal(typeof e.id, 'string')
    assert.equal(typeof e.file, 'string')
    assert.equal(typeof e.key, 'string')
    assert.equal(typeof e.original, 'string')
    assert.ok(e.key.length > 0, `leerer key: ${JSON.stringify(e)}`)
    assert.ok(e.file.includes('Translate/EN/'), `kein EN-Pfad: ${e.file}`)
    assert.equal(e.id, `${e.version}/${e.file}::${e.key}`, `id nicht aufgebaut: ${e.id}`)
    assert.equal(e.modId, m.id)
  }
})
