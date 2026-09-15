// Geteilte Layout-Fixtures für die tmp-Kopien (nicht unter server/fixtures/).
//
// Vier synthetische Mods, die die PZ-Layout-Varianten abdecken:
//   9999000001 Field Notes  — common-Layout, TXT (Lua-Translate)
//   9999000002 Radio Mod    — root-Layout, JSON
//   9999000003 CommonGear   — REINES common (kein Versionsordner), TXT
//   9999000004 DualLayout   — common-Layout + Versionsordner 42.20 (beide JSON)
//
// Injizieren in eine Fixture-tmp-Kopie (before() eines Tests):
//   injectLayoutFixtures(fakeRoot)
// Die geteilten Fixtures unter server/fixtures/ bleiben unverändert.
const { writeFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

function writeTree(fakeRoot, rel, content) {
  const p = path.join(fakeRoot, ...rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, content, 'utf8')
}

function injectLayoutFixtures(fakeRoot) {
  // --- 9999000001 Field Notes: common-Layout, TXT ---
  const fn = path.join(fakeRoot, 'workshop', '9999000001', 'mods', 'Field Notes')
  writeTree(fakeRoot, [
    'workshop', '9999000001', 'mods', 'Field Notes', 'mod.info',
  ], 'name=Field Notes\ndescription=Common-layout test mod (TXT)\nversion=1.0\n')
  writeTree(fakeRoot, [
    'workshop', '9999000001', 'mods', 'Field Notes',
    'common', 'media', 'lua', 'shared', 'Translate', 'EN', 'Sandbox_EN.txt',
  ], 'Sandbox_EN = {\n\tSandbox_FieldNotes = "Field Notes",\n\tSandbox_FieldNotes_HowTo = "How to use the field notes",\n\tSandbox_FieldNotes_TipOne = "Tip: field notes survive a restart"\n}\n')
  writeTree(fakeRoot, [
    'workshop', '9999000001', 'mods', 'Field Notes',
    'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt',
  ], 'Sandbox_DE = {\n\tSandbox_FieldNotes = "Feldnotizen"\n}\n')

  // --- 9999000002 Radio Mod: root-Layout, JSON ---
  writeTree(fakeRoot, [
    'workshop', '9999000002', 'mods', 'Radio Mod', 'mod.info',
  ], 'name=Radio Mod\ndescription=Root-layout test mod (JSON)\nversion=1.0\n')
  writeTree(fakeRoot, [
    'workshop', '9999000002', 'mods', 'Radio Mod',
    'media', 'lua', 'shared', 'Translate', 'EN', 'Tooltip.json',
  ], '{\n    "Tooltip_RadioMod": "Portable radio",\n    "Tooltip_RadioMod_HowTo": "Turn the dial to tune a station"\n}\n')
  writeTree(fakeRoot, [
    'workshop', '9999000002', 'mods', 'Radio Mod',
    'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json',
  ], '{\n    "Tooltip_RadioMod": "Mobilfunkradio"\n}\n')

  // --- 9999000003 CommonGear: REINES common (kein Versionsordner), TXT ---
  writeTree(fakeRoot, [
    'workshop', '9999000003', 'mods', 'CommonGear', 'mod.info',
  ], 'name=CommonGear\ndescription=Pure common-layout mod (no version dir, TXT)\nversion=1.0\n')
  writeTree(fakeRoot, [
    'workshop', '9999000003', 'mods', 'CommonGear',
    'common', 'media', 'lua', 'shared', 'Translate', 'EN', 'Gear_EN.txt',
  ], 'Gear_EN = {\n\tGear_Hatchet = "Hatchet",\n\tGear_Hatchet_Desc = "A small hand axe"\n}\n')
  writeTree(fakeRoot, [
    'workshop', '9999000003', 'mods', 'CommonGear',
    'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Gear_DE.txt',
  ], 'Gear_DE = {\n\tGear_Hatchet = "Axt"\n}\n')

  // --- 9999000004 DualLayout: common-Layout + Versionsordner 42.20, beide JSON ---
  writeTree(fakeRoot, [
    'workshop', '9999000004', 'mods', 'DualLayout', 'mod.info',
  ], 'name=DualLayout\ndescription=Common + version-42.20 layout (JSON in both)\nversion=1.0\n')
  // common-Layout JSON
  writeTree(fakeRoot, [
    'workshop', '9999000004', 'mods', 'DualLayout',
    'common', 'media', 'lua', 'shared', 'Translate', 'EN', 'UI.json',
  ], '{\n    "UI_Dual_Common": "Common shared label"\n}\n')
  writeTree(fakeRoot, [
    'workshop', '9999000004', 'mods', 'DualLayout',
    'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json',
  ], '{\n    "UI_Dual_Common": "Gemeinsames Label"\n}\n')
  // 42.20 Versionsordner JSON
  writeTree(fakeRoot, [
    'workshop', '9999000004', 'mods', 'DualLayout', '42.20',
    'media', 'lua', 'shared', 'Translate', 'EN', 'UI.json',
  ], '{\n    "UI_Dual_Version": "Version-specific label"\n}\n')
  writeTree(fakeRoot, [
    'workshop', '9999000004', 'mods', 'DualLayout', '42.20',
    'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json',
  ], '{\n    "UI_Dual_Version": "Versions-spezifisches Label"\n}\n')
}

module.exports = { injectLayoutFixtures }
