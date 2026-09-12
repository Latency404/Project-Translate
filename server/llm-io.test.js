// llm-io: Export (eine Datei pro Mod), Import-Vorschau, Apply.
// Läuft auf einer Fixture-Kopie aus server/fixtures/ (tmp), schreibt nach export/
// in ein tmp-Verzeichnis.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdtempSync, rmSync, cpSync, existsSync, readFileSync, readdirSync,
  writeFileSync, mkdirSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const { exportLlm, importPreview, importApply } = require('./llm-io')

let workdir
let fakeRoot
let exportRoot
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-llm-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(path.join(__dirname, 'fixtures'), fakeRoot, { recursive: true })
  exportRoot = path.join(workdir, 'export')
  const r = await scan(
    path.join(fakeRoot, 'gameRoot'),
    path.join(fakeRoot, 'workshop'),
    'DE'
  )
  mods = r.mods
})

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

test('exportLlm: eine Datei pro Mod, korrektes Format', () => {
  const coffee = mods.find((m) => m.id === '2000000001/Coffee Machines Fix')
  const { written } = exportLlm([coffee], 'DE', path.join(exportRoot, 'llm'))
  assert.equal(written.length, 1)
  const file = path.join(exportRoot, 'llm', 'DE', 'Coffee Machines Fix.json')
  assert.ok(existsSync(file))
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(doc.mod, 'Coffee Machines Fix')
  assert.equal(doc.modId, '2000000001/Coffee Machines Fix')
  assert.equal(doc.targetLang, 'DE')
  // Datei-Keys tragen das Versions-Segment; nur die neueste Version (42.20)
  const keys = Object.keys(doc.files)
  assert.ok(keys.includes('42.20/ContextMenu.json'))
  assert.ok(!keys.includes('42/ItemName.json')) // ältere Version wird nicht exportiert
  // Werte sind Originaltexte (EN), keine Übersetzungen
  assert.equal(doc.files['42.20/ContextMenu.json'].ContextMenu_OPTION_COFFEE_MACHINE, 'Coffee Machine')
})

test('importPreview: matched + unmatched zählen', () => {
  const dir = path.join(workdir, 'preview-test')
  mkdirSync(dir, { recursive: true })
  const coffee = mods.find((m) => m.id === '2000000001/Coffee Machines Fix')
  const doc = {
    mod: coffee.name,
    modId: coffee.id,
    targetLang: 'DE',
    files: {
      '42.20/ContextMenu.json': {
        ContextMenu_OPTION_COFFEE_MACHINE: 'Kaffeemaschine', // matched
        ContextMenu_OPTION_NO_ELECTRICITY: 'Kein Strom!', // matched
        ContextMenu_ERFUNDE: 'Nein' // unmatched
      },
      '42/ItemName.json': {
        ItemName_CoffeeMachine: 'Kaffeemaschine' // unmatched: ältere Version (nur die neueste wird genutzt)
      }
    }
  }
  writeFileSync(path.join(dir, 'Coffee Machines Fix.json'), JSON.stringify(doc))
  const preview = importPreview(dir, mods, 'DE')
  assert.equal(preview.matched, 2)
  assert.equal(preview.unmatched, 2)
  assert.equal(preview.perMod[coffee.id].matched, 2)
  assert.equal(preview.perMod[coffee.id].unmatched, 2)
  // Keine perMod-Einträge für andere Mods
  assert.ok(!Object.values(preview.perMod).some((p) => p.mod !== coffee.name))
})

test('importApply: nur gültige Keys landen in der DE-Datei, mit Backup', () => {
  const dir = path.join(workdir, 'apply-test')
  mkdirSync(dir, { recursive: true })
  const belt = mods.find((m) => m.id === '2000000002/Expanded Belt')
  const doc = {
    mod: belt.name,
    modId: belt.id,
    targetLang: 'DE',
    files: {
      '42.20/ItemName.json': {
        'ExpandedBelt.ExpandedBelt': 'Neuer Gürtel' // matched → wird geschrieben
      },
      '42.20/KeineDatei.json': {
        X: 'Y' // unmatched → wird verworfen
      }
    }
  }
  writeFileSync(path.join(dir, 'Expanded Belt.json'), JSON.stringify(doc))
  const result = importApply(dir, mods, 'DE', path.join(exportRoot, 'backups'))
  assert.equal(result.saved, 1)
  const tgt = path.join(
    fakeRoot, 'workshop', '2000000002', 'mods', 'Expanded Belt', '42.20',
    'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json'
  )
  const written = JSON.parse(readFileSync(tgt, 'utf8'))
  assert.equal(written['ExpandedBelt.ExpandedBelt'], 'Neuer Gürtel')
  // Ungültige Datei wurde nicht angelegt
  assert.ok(
    !existsSync(
      path.join(fakeRoot, 'workshop', '2000000002', 'mods', 'Expanded Belt', '42.20',
        'media', 'lua', 'shared', 'Translate', 'DE', 'KeineDatei.json')
    )
  )
  // Backup der alten DE-Datei
  const backups = path.join(exportRoot, 'backups')
  const batchDirs = readdirSync(backups, { withFileTypes: true }).map((d) => d.name)
  assert.ok(batchDirs.length >= 1)
})

test('importPreview: leeres Verzeichnis → 0/0', () => {
  const dir = path.join(workdir, 'leer')
  mkdirSync(dir, { recursive: true })
  const preview = importPreview(dir, mods, 'DE')
  assert.equal(preview.matched, 0)
  assert.equal(preview.unmatched, 0)
  assert.deepEqual(preview.perMod, {})
})
