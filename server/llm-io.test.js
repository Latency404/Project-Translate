// llm-io: Export (EINE Datei für alle Mods), Import-Vorschau, Apply.
// Läuft auf einer Fixture-Kopie aus server/fixtures/ (tmp). Der Export bündelt
// alle ausgewählten Mods in einen JSON-String (keine Disk-Datei); der Import
// liest denselben String via normalizeImportInput (Bundle / Array / Einzel-Mod).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdtempSync, rmSync, cpSync, existsSync, readFileSync,
  writeFileSync, mkdirSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const { saveBatch } = require('./entries')
const {
  exportLlmBundle, normalizeImportInput, importPreview
} = require('./llm-io')

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
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-llm-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(path.join(__dirname, 'fixtures'), fakeRoot, { recursive: true })
  injectLayoutFixtures(fakeRoot)
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

test('exportLlmBundle: EINE Datei mit allen ausgewählten Mods, korrektes Format', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const { text, filename, targetLang, modCount, entryCount } = exportLlmBundle([coffee, belt], 'DE')
  assert.equal(targetLang, 'DE')
  assert.equal(modCount, 2)
  assert.equal(filename, 'llm-translation-de.json')
  assert.ok(entryCount > 0)
  const doc = JSON.parse(text)
  assert.equal(doc.targetLang, 'DE')
  assert.ok(Array.isArray(doc.mods) && doc.mods.length === 2)
  const coffeeDoc = doc.mods.find((d) => d.modId === coffee.id)
  assert.ok(coffeeDoc)
  assert.equal(coffeeDoc.mod, 'Coffee Machines Fix')
  // Datei-Keys tragen das Versions-Segment; nur die neueste Version (42.20)
  const keys = Object.keys(coffeeDoc.files)
  assert.ok(keys.includes('42.20/ContextMenu.json'))
  assert.ok(!keys.includes('42/ItemName.json')) // ältere Version wird nicht exportiert
  // Werte sind Originaltexte (EN), keine Übersetzungen
  assert.equal(coffeeDoc.files['42.20/ContextMenu.json'].ContextMenu_OPTION_COFFEE_MACHINE, 'Coffee Machine')
})

test('Roundtrip: exportiertes Bundle → normalizeImportInput → Preview zählt alles als matched', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const { text, entryCount } = exportLlmBundle([coffee], 'DE')
  const { docs, error } = normalizeImportInput(text)
  assert.equal(error, null)
  assert.equal(docs.length, 1)
  const preview = importPreview(docs, mods, 'DE')
  // Exportierte Keys sind die EN-Originale → alle existieren (matched), keine unmatched
  assert.equal(preview.matched, entryCount)
  assert.equal(preview.unmatched, 0)
  assert.equal(preview.perMod[coffee.id].matched, entryCount)
})

test('importPreview: matched + unmatched zählen (aus Einzel-Mod-Datei)', () => {
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
  const { docs, error } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  const preview = importPreview(docs, mods, 'DE')
  assert.equal(preview.matched, 2)
  assert.equal(preview.unmatched, 2)
  assert.equal(preview.perMod[coffee.id].matched, 2)
  assert.equal(preview.perMod[coffee.id].unmatched, 2)
  // Keine perMod-Einträge für andere Mods
  assert.ok(!Object.values(preview.perMod).some((p) => p.mod !== coffee.name))
})

test('importPreview: matches liefert die rekonstruierte entryId, saveBatch schreibt sie in die DE-Datei', () => {
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
  const { docs, error } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  const preview = importPreview(docs, mods, 'DE')
  assert.equal(preview.matches.length, 1)
  assert.deepEqual(preview.matches[0], {
    modId: belt.id,
    entryId: '42.20/media/lua/shared/Translate/EN/ItemName.json::ExpandedBelt.ExpandedBelt',
    translation: 'Neuer Gürtel'
  })
  const backupRoot = path.join(workdir, 'backups')
  const result = saveBatch(
    belt,
    preview.matches.map(({ entryId, translation }) => ({ entryId, translation })),
    'DE',
    backupRoot
  )
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
  assert.ok(existsSync(backupRoot))
})

test('importPreview: leere Datei → 0/0', () => {
  const { docs, error } = normalizeImportInput('')
  assert.ok(error) // leer → Fehlermeldung (die Route gibt sie als 400 weiter)
})

test('normalizeImportInput: BOM und Trailing-Comma-Toleranz via readFlatMap-Parser', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const doc = { mod: belt.name, modId: belt.id, targetLang: 'DE', files: {} }
  // BOM am Anfang
  const withBom = '\uFEFF' + JSON.stringify(doc)
  const r = normalizeImportInput(withBom)
  assert.equal(r.error, null)
  assert.equal(r.docs[0].modId, belt.id)
  // Ungültiges JSON → Fehler statt Exception
  const bad = normalizeImportInput('{ dies ist kein json')
  assert.ok(bad.error)
})

test('normalizeImportInput: Array-Form und Bundle-Form beide akzeptiert', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const single = { mod: belt.name, modId: belt.id, targetLang: 'DE', files: {} }
  // Array
  const arr = normalizeImportInput(JSON.stringify([single]))
  assert.equal(arr.error, null)
  assert.equal(arr.docs.length, 1)
  // Bundle
  const bundle = normalizeImportInput(JSON.stringify({ targetLang: 'DE', mods: [single] }))
  assert.equal(bundle.error, null)
  assert.equal(bundle.docs.length, 1)
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

test('exportLlmBundle: TXT-Mod → Datei-Key common/<Datei>, EN-Werte', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  const { text } = exportLlmBundle([field], 'DE')
  const doc = JSON.parse(text)
  const fieldDoc = doc.mods.find((d) => d.modId === field.id)
  const keys = Object.keys(fieldDoc.files)
  assert.deepEqual(keys, ['common/Sandbox_EN.txt'])
  assert.equal(fieldDoc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes, 'Field Notes')
  assert.equal(fieldDoc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes_HowTo, 'How to use the field notes')
})

test('importPreview: matches (TXT) → saveBatch schreibt DE-Lua-Datei, bestehende Keys bleiben, Backup', () => {
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
  const { docs, error } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  const preview = importPreview(docs, mods, 'DE')
  assert.equal(preview.matches.length, 1)
  const backupRoot = path.join(workdir, 'backups-txt')
  const result = saveBatch(
    field,
    preview.matches.map(({ entryId, translation }) => ({ entryId, translation })),
    'DE',
    backupRoot
  )
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
  assert.ok(existsSync(backupRoot))
})

test('D3: sourceLang="DE" — Export liest Originale aus dem DE-Baum, Roundtrip matched', async () => {
  // Radio Mod (root-Layout, JSON): DE hat nur EINEN Key (Tooltip_RadioMod) —
  // mit sourceLang='DE' ist das die vollstaendige Quelle, EN (das bereits
  // vollstaendig ist) liefert die "Uebersetzung" zurueck.
  const r = await scan(
    path.join(fakeRoot, 'gameRoot'),
    path.join(fakeRoot, 'workshop'),
    'EN',
    'DE'
  )
  const radio = r.mods.find((m) => m.id === '9999000002/Radio Mod')
  assert.ok(radio, 'Radio Mod nicht gefunden')

  const { text, entryCount } = exportLlmBundle([radio], 'EN', 'DE')
  assert.equal(entryCount, 1)
  const doc = JSON.parse(text)
  const radioDoc = doc.mods.find((d) => d.modId === radio.id)
  // Original stammt aus der DE-Datei, nicht aus EN.
  assert.equal(radioDoc.files['root/Tooltip.json'].Tooltip_RadioMod, 'Mobilfunkradio')

  const { docs, error } = normalizeImportInput(text)
  assert.equal(error, null)
  const preview = importPreview(docs, r.mods, 'EN', 'DE')
  assert.equal(preview.matched, 1)
  assert.equal(preview.unmatched, 0)
})
