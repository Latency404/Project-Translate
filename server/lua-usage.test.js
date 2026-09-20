// lua-usage.js: Fundstellen von getText("KEY", ...) im Mod-Code, und ihre Ausgabe
// im LLM-Export (usage je Mod, notes des Nutzers).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { findUsages, usageHint, readArgs } = require('./lua-usage')
const { exportLlmBundle } = require('./llm-io')

let root
let modDir

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-lua-'))
  modDir = path.join(root, 'BarrelMod')
  const v = path.join(modDir, '42', 'media')
  fs.mkdirSync(path.join(v, 'lua', 'shared', 'Translate', 'EN'), { recursive: true })
  fs.mkdirSync(path.join(v, 'lua', 'client', 'UB_ContextMenu'), { recursive: true })
  fs.writeFileSync(
    path.join(v, 'lua', 'shared', 'Translate', 'EN', 'ContextMenu.json'),
    JSON.stringify({
      ContextMenu_UB_UnscrewPlug: 'Unscrew %1',
      ContextMenu_UB_PumpFuel: 'Fuel Pump',
      ContextMenu_UB_Nowhere: 'Never used in code'
    })
  )
  fs.writeFileSync(
    path.join(v, 'lua', 'client', 'UB_ContextMenu', 'UB_BarrelContextMenu.lua'),
    [
      'local a = getText("ContextMenu_UB_UnscrewPlug", ub_barrel.altLabel)',
      'local b = getText(\'ContextMenu_UB_PumpFuel\')',
      '-- Komma im String und verschachtelte Klammern:',
      'local c = getText("Tooltip_X", getItemName("Base.RubberHose"), "a, b", math.ceil(x(1, 2)))',
      'local d = getText("ContextMenu_UB_UnscrewPlug", ub_barrel.altLabel)' // gleiche Fundstelle nochmal
    ].join('\n')
  )
})

after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('readArgs: trennt an Top-Level-Kommas, beachtet Klammern und Strings', () => {
  const src = ', getItemName("Base.Hose", 1), "a, b", tostring(x) .. "L")'
  assert.deepEqual(readArgs(src, 0), ['getItemName("Base.Hose", 1)', '"a, b"', 'tostring(x) .. "L"'])
  assert.deepEqual(readArgs(')', 0), [])
  assert.equal(readArgs(', unvollstaendig(', 0), null)
})

test('findUsages: Datei + Argumente, doppelte Fundstellen nur einmal, ohne Argumente leer', () => {
  const luaDir = path.join(modDir, '42', 'media', 'lua')
  const found = findUsages([luaDir])
  assert.deepEqual(found.get('ContextMenu_UB_UnscrewPlug'), [
    { file: 'UB_BarrelContextMenu.lua', args: ['ub_barrel.altLabel'] }
  ])
  assert.deepEqual(found.get('ContextMenu_UB_PumpFuel'), [{ file: 'UB_BarrelContextMenu.lua', args: [] }])
  assert.deepEqual(found.get('Tooltip_X')[0].args, ['getItemName("Base.RubberHose")', '"a, b"', 'math.ceil(x(1, 2))'])
  assert.equal(
    usageHint('ContextMenu_UB_UnscrewPlug', found.get('ContextMenu_UB_UnscrewPlug')),
    'UB_BarrelContextMenu.lua: getText("ContextMenu_UB_UnscrewPlug", ub_barrel.altLabel)'
  )
})

test('exportLlmBundle: usage je Mod nur für vorhandene Keys, notes des Nutzers im context', () => {
  const mod = { id: '1/BarrelMod', name: 'BarrelMod', isBaseGame: false, rootPath: modDir, versions: ['42'] }
  const doc = JSON.parse(exportLlmBundle([mod], 'EN', ['DE'], { notes: '  Useful Barrels is about oil drums.  ' }).text)

  assert.deepEqual(Object.keys(doc.mods[0].usage).sort(), ['ContextMenu_UB_PumpFuel', 'ContextMenu_UB_UnscrewPlug'])
  assert.match(doc.mods[0].usage.ContextMenu_UB_UnscrewPlug, /altLabel/)
  assert.equal('ContextMenu_UB_Nowhere' in doc.mods[0].usage, false, 'Key ohne Fundstelle ohne Hinweis')

  assert.equal(doc.context.notes, 'Useful Barrels is about oil drums.')
  assert.ok(doc.context.rules.some((r) => r.includes('"usage"')), 'Regel erklärt usage')
  assert.ok(doc.context.rules.some((r) => r.includes('"notes"')), 'Regel verweist auf die Notizen')

  // Ohne Notizen: kein notes-Feld.
  const plain = JSON.parse(exportLlmBundle([mod], 'EN', ['DE']).text)
  assert.equal('notes' in plain.context, false)
})

test('exportLlmBundle: Basisspiel wird nicht nach Lua-Aufrufen durchsucht', () => {
  const base = { id: 'BASE', name: 'Base', isBaseGame: true, rootPath: root, versions: ['base'] }
  const doc = JSON.parse(exportLlmBundle([base], 'EN', ['DE']).text)
  assert.equal('usage' in doc.mods[0], false)
})
