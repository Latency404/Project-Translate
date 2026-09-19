// llm-io: Export (EINE Datei für alle Mods, mehrsprachig), Import-Vorschau.
// Läuft auf einer Fixture-Kopie aus server/fixtures/ (tmp). Der Export bündelt
// alle ausgewählten Mods in einen JSON-String (keine Disk-Datei); der Import
// liest denselben String via normalizeImportInput (neues `translations`-Format
// sowie die alten Formen: Bundle / Array / Einzel-Mod).
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
    ['DE']
  )
  mods = r.mods
})

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

test('exportLlmBundle: EINE Datei mit allen ausgewählten Mods, korrektes Format', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const { text, filename, modCount, entryCount, targetLangs } = exportLlmBundle([coffee, belt], 'EN', ['DE'])
  assert.equal(modCount, 2)
  assert.equal(filename, 'llm-translation.json')
  assert.ok(entryCount > 0)
  assert.deepEqual(targetLangs, ['DE'])
  const doc = JSON.parse(text)
  assert.deepEqual(doc.targetLangs, ['DE'])
  assert.equal(typeof doc.note, 'string')
  assert.deepEqual(doc.translations, { DE: {} })
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

test('exportLlmBundle: mehrere Zielsprachen → translations-Gerüst mit beiden Sprachen', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const { text, targetLangs } = exportLlmBundle([coffee], 'EN', ['de', 'fr'])
  assert.deepEqual(targetLangs, ['DE', 'FR']) // normalisiert: großgeschrieben
  const doc = JSON.parse(text)
  assert.deepEqual(doc.targetLangs, ['DE', 'FR'])
  assert.deepEqual(doc.translations, { DE: {}, FR: {} })
  assert.match(doc.note, /DE, FR/)
  assert.doesNotMatch(doc.note, /—/) // keine Gedankenstriche
})

test('exportLlmBundle: keine Zielsprache → leeres targetLangs/translations, Note bittet LLM um eigene Sprachwahl', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const { targetLangs } = exportLlmBundle([coffee])
  assert.deepEqual(targetLangs, [])
  const doc = JSON.parse(exportLlmBundle([coffee]).text)
  assert.deepEqual(doc.targetLangs, [])
  assert.deepEqual(doc.translations, {})
  assert.match(doc.note, /choose/i)
})

test('Roundtrip (neues Format): exportiertes Bundle ausgefüllt → normalizeImportInput → Preview matched', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const { text, entryCount } = exportLlmBundle([coffee], 'EN', ['DE'])
  const doc = JSON.parse(text)
  // Das LLM würde hier "translations.DE.<modId>.<fileKey>.<key>" befüllen —
  // wir simulieren das, indem wir die Originaltexte 1:1 übernehmen.
  doc.translations.DE[coffee.id] = doc.mods.find((d) => d.modId === coffee.id).files
  const { docsByLang, error, detectedTargetLangs } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  assert.deepEqual(detectedTargetLangs, ['DE'])
  assert.equal(docsByLang.DE.length, 1)
  assert.equal(docsByLang.DE[0].modId, coffee.id)
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matched, entryCount)
  assert.equal(preview.unmatched, 0)
  assert.equal(preview.perMod[coffee.id].matched, entryCount)
  assert.equal(preview.perLang.DE.matched, entryCount)
  assert.ok(preview.matches.every((m) => m.lang === 'DE'))
})

test('Import (neues Format): translations mit zwei Sprachen → matches mit korrektem lang, perLang-Zähler', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const bundle = {
    targetLangs: ['DE', 'FR'],
    note: 'irrelevant',
    mods: [],
    translations: {
      DE: {
        [coffee.id]: {
          '42.20/ContextMenu.json': {
            ContextMenu_OPTION_COFFEE_MACHINE: 'Kaffeemaschine', // matched
            ContextMenu_ERFUNDEN: 'Nein' // unmatched
          }
        }
      },
      FR: {
        [belt.id]: {
          '42.20/ItemName.json': {
            'ExpandedBelt.ExpandedBelt': 'Nouvelle ceinture' // matched
          }
        }
      }
    }
  }
  const { docsByLang, error, detectedTargetLangs } = normalizeImportInput(JSON.stringify(bundle))
  assert.equal(error, null)
  assert.deepEqual(detectedTargetLangs, ['DE', 'FR'])
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matched, 2)
  assert.equal(preview.unmatched, 1)
  assert.deepEqual(preview.perLang.DE, { matched: 1, unmatched: 1 })
  assert.deepEqual(preview.perLang.FR, { matched: 1, unmatched: 0 })
  const deMatch = preview.matches.find((m) => m.modId === coffee.id)
  assert.equal(deMatch.lang, 'DE')
  assert.equal(deMatch.translation, 'Kaffeemaschine')
  const frMatch = preview.matches.find((m) => m.modId === belt.id)
  assert.equal(frMatch.lang, 'FR')
  assert.equal(frMatch.entryId, '42.20/media/lua/shared/Translate/EN/ItemName.json::ExpandedBelt.ExpandedBelt')
})

test('normalizeImportInput: translations gewinnt, wenn mods.files zusätzlich befüllt ist', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const bundle = {
    targetLangs: ['DE'],
    mods: [
      // "mods" trägt hier (untypisch) bereits Werte statt Originaltexten -
      // muss trotzdem ignoriert werden, sobald "translations" vorhanden ist.
      { mod: coffee.name, modId: coffee.id, files: { '42.20/ContextMenu.json': { ContextMenu_OPTION_COFFEE_MACHINE: 'Falsch' } } }
    ],
    translations: {
      DE: { [coffee.id]: { '42.20/ContextMenu.json': { ContextMenu_OPTION_COFFEE_MACHINE: 'Kaffeemaschine' } } }
    }
  }
  const { docsByLang, error } = normalizeImportInput(JSON.stringify(bundle))
  assert.equal(error, null)
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matches.length, 1)
  assert.equal(preview.matches[0].translation, 'Kaffeemaschine')
})

test('importPreview (altes Format, Einzel-Mod-Datei): matched + unmatched zählen', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const doc = {
    mod: coffee.name,
    modId: coffee.id,
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
  const { docsByLang, error, detectedTargetLangs } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  assert.deepEqual(detectedTargetLangs, []) // kein targetLang-Feld → keine erkannte Sprache
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matched, 2)
  assert.equal(preview.unmatched, 2)
  assert.equal(preview.perMod[coffee.id].matched, 2)
  assert.equal(preview.perMod[coffee.id].unmatched, 2)
  assert.deepEqual(preview.perLang.DE, { matched: 2, unmatched: 2 }) // leerer Key → fallbackLang
  // Keine perMod-Einträge für andere Mods
  assert.ok(!Object.values(preview.perMod).some((p) => p.mod !== coffee.name))
})

test('importPreview (altes Bundle-Format mit targetLang): matches liefert entryId + lang, saveBatch schreibt die DE-Datei', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const doc = {
    targetLang: 'DE',
    mods: [{
      mod: belt.name,
      modId: belt.id,
      files: {
        '42.20/ItemName.json': {
          'ExpandedBelt.ExpandedBelt': 'Neuer Gürtel' // matched → wird geschrieben
        },
        '42.20/KeineDatei.json': {
          X: 'Y' // unmatched → wird verworfen
        }
      }
    }]
  }
  const { docsByLang, error, detectedTargetLangs } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  assert.deepEqual(detectedTargetLangs, ['DE'])
  const preview = importPreview(docsByLang, mods, 'FR') // fallbackLang wird ignoriert, da targetLang gesetzt ist
  assert.equal(preview.matches.length, 1)
  assert.deepEqual(preview.matches[0], {
    modId: belt.id,
    entryId: '42.20/media/lua/shared/Translate/EN/ItemName.json::ExpandedBelt.ExpandedBelt',
    translation: 'Neuer Gürtel',
    lang: 'DE'
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

test('importPreview (altes Format ohne targetLang): leerer Sprach-Key wird auf fallbackLang abgebildet', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const doc = {
    mod: coffee.name,
    modId: coffee.id,
    files: { '42.20/ContextMenu.json': { ContextMenu_OPTION_COFFEE_MACHINE: 'Kaffeemaschine' } }
  }
  const { docsByLang } = normalizeImportInput(JSON.stringify(doc))
  assert.deepEqual(Object.keys(docsByLang), [''])
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matches[0].lang, 'DE')
  assert.deepEqual(Object.keys(preview.perLang), ['DE'])
})

test('importPreview: leere Datei → Fehlermeldung', () => {
  const { docsByLang, error } = normalizeImportInput('')
  assert.ok(error)
  assert.deepEqual(docsByLang, {})
  assert.equal(error, 'The file is empty.')
})

test('normalizeImportInput: BOM- und Trailing-Comma-Toleranz, kaputtes JSON → Fehler', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const doc = { mod: belt.name, modId: belt.id, files: {} }
  // BOM am Anfang
  const withBom = '﻿' + JSON.stringify(doc)
  const r = normalizeImportInput(withBom)
  assert.equal(r.error, null)
  assert.equal(r.docsByLang[''][0].modId, belt.id)
  // Ungültiges JSON → Fehler statt Exception
  const bad = normalizeImportInput('{ dies ist kein json')
  assert.ok(bad.error)
  assert.doesNotMatch(bad.error, /—/)
})

test('normalizeImportInput: Array-Form und altes Bundle-Format beide akzeptiert', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const single = { mod: belt.name, modId: belt.id, files: {} }
  // Array
  const arr = normalizeImportInput(JSON.stringify([single]))
  assert.equal(arr.error, null)
  assert.equal(arr.docsByLang[''].length, 1)
  // Bundle (altes Format, ohne "translations")
  const bundle = normalizeImportInput(JSON.stringify({ targetLang: 'DE', mods: [single] }))
  assert.equal(bundle.error, null)
  assert.equal(bundle.docsByLang.DE.length, 1)
})

// --- 3.1: TXT-Dateien (Lua-Translate) und common/root-Layouts ---

test('scan: TXT + common-Layout → Einträge mit Pre-Fill', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  assert.ok(field)
  assert.equal(field.entryCount, 3)
  assert.equal(field.translatedCounts.DE, 1) // 1 von 3 in Sandbox_DE.txt vorhanden
})

test('scan: root-Layout (JSON) → Einträge mit Pre-Fill', () => {
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  assert.ok(radio)
  assert.equal(radio.entryCount, 2)
  assert.equal(radio.translatedCounts.DE, 1)
})

test('exportLlmBundle: TXT-Mod → Datei-Key common/<Datei>, EN-Werte', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  const { text } = exportLlmBundle([field], 'EN', ['DE'])
  const doc = JSON.parse(text)
  const fieldDoc = doc.mods.find((d) => d.modId === field.id)
  const keys = Object.keys(fieldDoc.files)
  assert.deepEqual(keys, ['common/Sandbox_EN.txt'])
  assert.equal(fieldDoc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes, 'Field Notes')
  assert.equal(fieldDoc.files['common/Sandbox_EN.txt'].Sandbox_FieldNotes_HowTo, 'How to use the field notes')
})

test('importPreview (TXT, neues Format): matches → saveBatch schreibt die JSON-Zieldatei (B42 lädt kein TXT mehr), bestehende Legacy-Keys bleiben, Backup', () => {
  const field = mods.find((m) => m.id === '9999000001/Field Notes')
  const bundle = {
    targetLangs: ['DE'],
    mods: [],
    translations: {
      DE: {
        [field.id]: {
          'common/Sandbox_EN.txt': {
            Sandbox_FieldNotes_HowTo: 'So benutzt man die Feldnotizen' // matched → neu
            // Sandbox_FieldNotes existiert schon in der alten Sandbox_DE.txt (Feldnotizen)
          },
          'common/Sandbox_EN.txt::erfundene/Datei.txt': {} // unmatched → verworfen
        }
      }
    }
  }
  const { docsByLang, error } = normalizeImportInput(JSON.stringify(bundle))
  assert.equal(error, null)
  const preview = importPreview(docsByLang, mods, 'DE')
  assert.equal(preview.matches.length, 1)
  const backupRoot = path.join(workdir, 'backups-txt')
  const result = saveBatch(
    field,
    preview.matches.map(({ entryId, translation }) => ({ entryId, translation })),
    'DE',
    backupRoot
  )
  assert.equal(result.saved, 1)
  // Ziel ist IMMER JSON, auch für eine TXT-Quelle: common/media/lua/shared/Translate/DE/Sandbox.json
  const tgt = path.join(
    fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes', 'common',
    'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox.json'
  )
  assert.ok(existsSync(tgt))
  const written = JSON.parse(readFileSync(tgt, 'utf8'))
  assert.equal(written.Sandbox_FieldNotes_HowTo, 'So benutzt man die Feldnotizen')
  // Aus der alten Sandbox_DE.txt übernommener Bestand bleibt erhalten (Seed).
  assert.equal(written.Sandbox_FieldNotes, 'Feldnotizen')
  // Die alte TXT-Zieldatei selbst wird nicht mehr geschrieben.
  const legacyTxt = path.join(
    fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes', 'common',
    'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt'
  )
  assert.match(readFileSync(legacyTxt, 'utf8'), /Sandbox_FieldNotes\s*=\s*"Feldnotizen"/)
  // Backup der (neuen) JSON-Zieldatei
  assert.ok(existsSync(backupRoot))
})

test('D3: sourceLang="DE" — Export liest Originale aus dem DE-Baum, Roundtrip matched', async () => {
  // Radio Mod (root-Layout, JSON): DE hat nur EINEN Key (Tooltip_RadioMod) —
  // mit sourceLang='DE' ist das die vollstaendige Quelle, EN (das bereits
  // vollstaendig ist) liefert die "Uebersetzung" zurueck.
  const r = await scan(
    path.join(fakeRoot, 'gameRoot'),
    path.join(fakeRoot, 'workshop'),
    ['EN'],
    'DE'
  )
  const radio = r.mods.find((m) => m.id === '9999000002/Radio Mod')
  assert.ok(radio, 'Radio Mod nicht gefunden')

  const { text, entryCount } = exportLlmBundle([radio], 'DE', ['EN'])
  assert.equal(entryCount, 1)
  const doc = JSON.parse(text)
  const radioDoc = doc.mods.find((d) => d.modId === radio.id)
  // Original stammt aus der DE-Datei, nicht aus EN.
  assert.equal(radioDoc.files['root/Tooltip.json'].Tooltip_RadioMod, 'Mobilfunkradio')

  doc.translations.EN[radio.id] = radioDoc.files
  const { docsByLang, error } = normalizeImportInput(JSON.stringify(doc))
  assert.equal(error, null)
  const preview = importPreview(docsByLang, r.mods, 'EN', 'DE')
  assert.equal(preview.matched, 1)
  assert.equal(preview.unmatched, 0)
})
