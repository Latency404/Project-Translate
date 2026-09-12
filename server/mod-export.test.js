// mod-export: installierbarer Übersetzungs-Mod — mod.info am Root,
// game_version = höchste Version, nur übersetzte Einträge, pro Version eigene Bäume.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, cpSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')
const { exportMod, highestVersion } = require('./mod-export')

let workdir
let fakeRoot
let mods

before(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), 'pt-modx-'))
  fakeRoot = path.join(workdir, 'fixtures')
  cpSync(path.join(__dirname, 'fixtures'), fakeRoot, { recursive: true })
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
  const coffee = mods.find((m) => m.id === '2000000001/Coffee Machines Fix')
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
  const belt = mods.find((m) => m.id === '2000000002/Expanded Belt')
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
