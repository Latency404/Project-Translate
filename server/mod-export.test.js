// mod-export: installierbarer Übersetzungs-Mod — mod.info am Root,
// game_version = höchste Version, nur übersetzte Einträge, pro Version eigene Bäume.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, cpSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const { exportMod, highestVersion, layoutLocations } = require('./mod-export')
const { injectLayoutFixtures } = require('./fixtures-inject')

let workdir
let fakeRoot
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-modx-'))
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

test('highestVersion: segmentweise numerisch', () => {
  assert.equal(highestVersion(['42', '42.13', '42.20']), '42.20')
  assert.equal(highestVersion(['42']), '42')
  assert.equal(highestVersion([]), null)
  assert.equal(highestVersion(['42.15.1', '42.15']), '42.15.1')
})

test('exportMod: mod.info am Root mit game_version = höchste Version', () => {
  const coffee = mods.find((m) => m.id === '2688538916/Coffee Machines Fix')
  const targetDir = path.join(workdir, 'export')
  const { targetPath, written } = exportMod(coffee, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Coffee Machines Fix-DE')
  // targetPath ist POSIX-Style (Projekt-Konvention)
  assert.equal(targetPath, outRoot.replace(/\\/g, '/'))
  assert.ok(existsSync(path.join(outRoot, 'mod.info')))
  const info = readFileSync(path.join(outRoot, 'mod.info'), 'utf8')
  assert.match(info, /^name=Coffee Machines Fix Translation \(DE\)$/m)
  assert.match(info, /^author=Project Translate$/m)
  assert.match(info, /^game_version=42\.20$/m)

  // Übersetzte Einträge: nur die neueste Version (42.20) — ContextMenu (4)
  // + IG_UI (6) = 10. ItemName (nur in 42) wird nicht mehr exportiert.
  const f42 = readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'ContextMenu.json'), 'utf8'
  )
  const f42obj = JSON.parse(f42)
  assert.equal(f42obj.ContextMenu_OPTION_COFFEE_MACHINE, 'Kaffeemaschine')
  // ItemName (42.20) wurde im Fixture nie übersetzt → Datei fehlt
  assert.ok(
    !existsSync(
      path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json')
    )
  )
  // Ältere Version (42) wird nicht exportiert
  assert.ok(
    !existsSync(
      path.join(outRoot, '42', 'media', 'lua', 'shared', 'Translate', 'DE', 'ItemName.json')
    )
  )
  assert.ok(written.length >= 3)
})

test('exportMod: icon.png wird mitkopiert, wenn vorhanden', () => {
  const belt = mods.find((m) => m.id === '3411213493/Expanded Belt')
  const targetDir = path.join(workdir, 'export2')
  exportMod(belt, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Expanded Belt-DE')
  assert.ok(existsSync(path.join(outRoot, 'icon.png')))
})

test('exportMod: Basisspiel → "Project Zomboid (Base Game)-DE" ohne game_version', () => {
  const base = mods.find((m) => m.id === 'BASE')
  const targetDir = path.join(workdir, 'export3')
  const { targetPath } = exportMod(base, 'DE', targetDir)
  assert.equal(targetPath, path.join(targetDir, 'Project Zomboid (Base Game)-DE').replace(/\\/g, '/'))
  const info = readFileSync(path.join(targetPath, 'mod.info'), 'utf8')
  assert.ok(!info.includes('game_version'))
  // UI.json: 2 von 4 übersetzt → nur 2 Keys; Basisspiel ohne Version-Ordner
  const ui = JSON.parse(readFileSync(
    path.join(targetPath, 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.equal(Object.keys(ui).length, 2)
  assert.equal(ui.UI_MainMenu_Play, 'Spielen')
})

test('layoutLocations: common / root / reines common / dual', () => {
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const gear = mods.find((m) => m.id === '9999000003/CommonGear')
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  assert.ok(fn && radio && gear && dual, 'alle vier Layout-Fixtures gefunden')
  assert.deepEqual(layoutLocations(fn).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(radio).map((l) => l.rel), [''])
  assert.deepEqual(layoutLocations(gear).map((l) => l.rel), ['common'])
  assert.deepEqual(layoutLocations(dual).map((l) => l.rel), ['common', '42.20'])
  // reines common-Layout: versions leer → kein game_version
  assert.deepEqual(gear.versions, [])
  assert.equal(highestVersion(gear.versions), null)
})

test('exportMod: common-Layout mit TXT (Lua-Translate)', () => {
  const fn = mods.find((m) => m.id === '9999000001/Field Notes')
  const targetDir = path.join(workdir, 'export4')
  const { written } = exportMod(fn, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Field Notes-DE')
  const info = readFileSync(path.join(outRoot, 'mod.info'), 'utf8')
  // kein Versionsordner → kein game_version
  assert.ok(!info.includes('game_version'))
  assert.match(info, /^name=Field Notes Translation \(DE\)$/m)
  // TXT → Lua-Table unter common/.../DE/Sandbox_DE.txt
  const p = path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'Sandbox_DE.txt')
  assert.ok(existsSync(p))
  const txt = readFileSync(p, 'utf8')
  assert.match(txt, /^Sandbox_DE = \{/)
  assert.match(txt, /Sandbox_FieldNotes = \[\[Feldnotizen\]\]/)
  // unübersetzte Keys (HowTo, TipOne) werden nicht exportiert
  assert.ok(!txt.includes('Sandbox_FieldNotes_HowTo'))
  assert.ok(!txt.includes('Sandbox_FieldNotes_TipOne'))
  assert.deepEqual(written, [
    'mod.info',
    'common/media/lua/shared/Translate/DE/Sandbox_DE.txt'
  ])
})

test('exportMod: root-Layout (Translate am Mod-Root, JSON)', () => {
  const radio = mods.find((m) => m.id === '9999000002/Radio Mod')
  const targetDir = path.join(workdir, 'export5')
  exportMod(radio, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'Radio Mod-DE')
  // ohne common/ und ohne Versionsordner
  assert.ok(existsSync(path.join(outRoot, 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json')))
  const tip = JSON.parse(readFileSync(
    path.join(outRoot, 'media', 'lua', 'shared', 'Translate', 'DE', 'Tooltip.json'), 'utf8'
  ))
  assert.equal(tip.Tooltip_RadioMod, 'Mobilfunkradio')
  assert.ok(!('Tooltip_RadioMod_HowTo' in tip))
  assert.ok(!existsSync(path.join(outRoot, 'common')))
})

test('exportMod: dual-Layout (common + Version) exportiert beide Bäume', () => {
  const dual = mods.find((m) => m.id === '9999000004/DualLayout')
  const targetDir = path.join(workdir, 'export6')
  const { written } = exportMod(dual, 'DE', targetDir)
  const outRoot = path.join(targetDir, 'DualLayout-DE')
  const info = readFileSync(path.join(outRoot, 'mod.info'), 'utf8')
  assert.match(info, /^game_version=42\.20$/m)
  const common = JSON.parse(readFileSync(
    path.join(outRoot, 'common', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  const ver = JSON.parse(readFileSync(
    path.join(outRoot, '42.20', 'media', 'lua', 'shared', 'Translate', 'DE', 'UI.json'), 'utf8'
  ))
  assert.equal(common.UI_Dual_Common, 'Gemeinsames Label')
  assert.equal(ver.UI_Dual_Version, 'Versions-spezifisches Label')
  assert.deepEqual(written.sort(), [
    '42.20/media/lua/shared/Translate/DE/UI.json',
    'common/media/lua/shared/Translate/DE/UI.json',
    'mod.info'
  ].sort())
})
