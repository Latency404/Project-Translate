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

// TXT/common- und root-JSON-Layouts (3.1): werden in die Fixture-Kopie in
// before() injiziert, damit die geteilten Fixtures unter server/fixtures/
// unverändert bleiben.
function injectLayoutFixtures(fakeRoot) {
  const common = path.join(
    fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes',
    'common', 'media', 'lua', 'shared', 'Translate'
  )
  const root = path.join(
    fakeRoot, 'workshop', '9999000002', 'mods', 'Radio Mod',
    'media', 'lua', 'shared', 'Translate'
  )
  for (const d of [
    path.join(common, 'EN'),
    path.join(common, 'DE'),
    path.join(root, 'EN'),
    path.join(root, 'DE'),
    path.join(fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes'),
    path.join(fakeRoot, 'workshop', '9999000002', 'mods', 'Radio Mod')
  ]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(
    path.join(common, 'EN', 'Sandbox_EN.txt'),
    'Sandbox_EN = {\n\tSandbox_FieldNotes = "Field Notes",\n\tSandbox_FieldNotes_HowTo = "How to use the field notes",\n\tSandbox_FieldNotes_TipOne = "Tip: field notes survive a restart"\n}\n',
    'utf8'
  )
  writeFileSync(
    path.join(common, 'DE', 'Sandbox_DE.txt'),
    'Sandbox_DE = {\n\tSandbox_FieldNotes = "Feldnotizen"\n}\n',
    'utf8'
  )
  writeFileSync(
    path.join(root, 'EN', 'Tooltip.json'),
    '{\n    "Tooltip_RadioMod": "Portable radio",\n    "Tooltip_RadioMod_HowTo": "Turn the dial to tune a station"\n}\n',
    'utf8'
  )
  writeFileSync(
    path.join(root, 'DE', 'Tooltip.json'),
    '{\n    "Tooltip_RadioMod": "Mobilfunkradio"\n}\n',
    'utf8'
  )
  writeFileSync(
    path.join(fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes', 'mod.info'),
    'name=Field Notes\ndescription=Common-layout test mod (TXT)\nversion=1.0\n',
    'utf8'
  )
  writeFileSync(
    path.join(fakeRoot, 'workshop', '9999000002', 'mods', 'Radio Mod', 'mod.info'),
    'name=Radio Mod\ndescription=Root-layout test mod (JSON)\nversion=1.0\n',
    'utf8'
  )
}

let workdir
let fakeRoot
let exportRoot
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-llm-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(path.join(__dirname, 'fixtures'), fakeRoot, { recursive: true })
  injectLayoutFixtures(fakeRoot)
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
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const { written } = exportLlm([coffee], 'DE', path.join(exportRoot, 'llm'))
  assert.equal(written.length, 1)
  const file = path.join(exportRoot, 'llm', 'DE', 'Coffee Machines Fix.json')
  assert.ok(existsSync(file))
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(doc.mod, 'Coffee Machines Fix')
  assert.equal(doc.modId, '2688538916/Coffee Machines Fix')
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
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
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
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
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
    fakeRoot, 'workshop', '3411213493', 'mods', 'Expanded Belt', '42.20',
    'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json'
  )
  const written = JSON.parse(readFileSync(tgt, 'utf8'))
  assert.equal(written['ExpandedBelt.ExpandedBelt'], 'Neuer Gürtel')
  // Ungültige Datei wurde nicht angelegt
  assert.ok(
    !existsSync(
      path.join(fakeRoot, 'workshop', '3411213493', 'mods', 'Expanded Belt', '42.20',
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

// --- 3.1: TXT-Dateien (Lua-Translate) und common/root-Layouts ---

test('scan: TXT + common-Layout → Einträge mit Pre-Fill', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  assert.ok(field)
  assert.equal(field.entryCount, 3)
  assert.equal(field.translatedCount, 1) // 1 von 3 in Sandbox_DE.txt vorhanden
})

test('scan: root-Layout (JSON) → Einträge mit Pre-Fill', () => {
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  assert.ok(radio)
  assert.equal(radio.entryCount, 2)
  assert.equal(radio.translatedCount, 1)
})

test('exportLlm: TXT-Mod → Datei-Key common/<Datei>, EN-Werte', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  const { written } = exportLlm([field], 'DE', path.join(exportRoot, 'llm-txt'))
  assert.equal(written.length, 1)
  const file = path.join(exportRoot, 'llm-txt', 'DE', 'Field Notes.json')
  assert.ok(existsSync(file))
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const keys = Object.keys(doc.files)
  assert.deepEqual(keys, ['common/Sandbox_EN.txt'])
  assert.equal(doc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes, 'Field Notes')
  assert.equal(doc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes_HowTo, 'How to use the field notes')
})

test('importApply: TXT → DE-Lua-Datei, bestehende Keys bleiben, Backup', () => {
  const dir = path.join(workdir, 'apply-txt')
  mkdirSync(dir, { recursive: true })
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  const doc = {
    mod: field.name,
    modId: field.id,
    targetLang: 'DE',
    files: {
      'common/Sandbox_EN.txt': {
        Sandbox_FieldNotes_HowTo: 'So benutzt man die Feldnotizen' // matched → neu
        // Sandbox_FieldNotes existiert schon in der DE-Datei (Feldnotizen)
      },
      'common/Sandbox_EN.txt::erfundene/Datei.txt': {} // unmatched → verworfen
    }
  }
  writeFileSync(path.join(dir, 'Field Notes.json'), JSON.stringify(doc))
  const result = importApply(dir, mods, 'DE', path.join(exportRoot, 'backups-txt'))
  assert.equal(result.saved, 1)
  // Ziel: common/media/lua/shared/Translate/DE/Sandbox_DE.txt
  const tgt = path.join(
    fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes', 'common',
    'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt'
  )
  assert.ok(existsSync(tgt))
  const raw = readFileSync(tgt, 'utf8')
  assert.match(raw, /Sandbox_FieldNotes_HowTo\s*=\s*\[\[So benutzt man die Feldnotizen\]\]/)
  // Bestehender Pre-Fill-Key bleibt erhalten
  assert.match(raw, /Sandbox_FieldNotes\s*=\s*\[\[Feldnotizen\]\]/)
  // Backup der alten DE-Datei
  const backups = path.join(exportRoot, 'backups-txt')
  const batchDirs = readdirSync(backups, { withFileTypes: true }).map((d) => d.name)
  assert.ok(batchDirs.length >= 1)
})
