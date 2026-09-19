// scanner: Anzeigename (name=) und Poster kommen aus der mod.info — bei B42-Mods
// liegt sie im Versionsordner oder in common, nicht in der Mod-Wurzel.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { scan } = require('./scanner')

let root
let workshop

function makeMod(pid, folder, { infoDir, info, files = {} }) {
  const modDir = path.join(workshop, pid, 'mods', folder)
  const tdir = path.join(modDir, '42', 'media', 'lua', 'shared', 'Translate', 'EN')
  fs.mkdirSync(tdir, { recursive: true })
  fs.writeFileSync(path.join(tdir, 'UI.json'), JSON.stringify({ Hello: 'Hello' }))
  if (info !== undefined) {
    const dir = path.join(modDir, infoDir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'mod.info'), info)
  }
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(modDir, rel)), { recursive: true })
    fs.writeFileSync(path.join(modDir, rel), content)
  }
  return modDir
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-info-'))
  workshop = path.join(root, 'workshop')
  fs.mkdirSync(path.join(root, 'game'), { recursive: true })

  // Name + Poster aus der mod.info im Versionsordner, Poster daneben.
  makeMod('1', 'BetterSorting', {
    infoDir: '42',
    info: '﻿id=BetterSorting\nname=Better Sorting\nposter=poster.png\n',
    files: { '42/poster.png': 'png' }
  })
  // Poster relativ in common ("../common/x.png"), mod.info im Versionsordner.
  makeMod('2', 'Rel', {
    infoDir: '42',
    info: 'name=Relative Poster\nposter=../common/rel.png\n',
    files: { 'common/rel.png': 'png' }
  })
  // Kein name= und keine mod.info-Poster-Zeile: Ordnername, poster.png im Versionsordner.
  makeMod('3', 'PlainFolder', {
    infoDir: '42',
    info: 'id=PlainFolder\n',
    files: { '42/poster.png': 'png' }
  })
  // Poster-Pfad, der den Mod-Ordner verlassen will, wird ignoriert.
  makeMod('4', 'Escape', {
    infoDir: '42',
    info: 'name=Escape\nposter=../../../secret.png\n',
    files: {}
  })
  fs.writeFileSync(path.join(workshop, '4', 'secret.png'), 'png')
  // Gar nichts: kein Poster.
  makeMod('5', 'NoImages', { infoDir: '42', info: 'name=No Images\n' })
})

after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('scan: Anzeigename aus mod.info name=, sonst Ordnername; id bleibt der Ordner', async () => {
  const { mods } = await scan(path.join(root, 'game'), workshop, ['DE'])
  const byId = Object.fromEntries(mods.map((m) => [m.id, m]))
  assert.equal(byId['1/BetterSorting'].name, 'Better Sorting')
  assert.equal(byId['1/BetterSorting'].modInfoId, 'BetterSorting', 'BOM am Dateianfang stört nicht')
  assert.equal(byId['3/PlainFolder'].name, 'PlainFolder')
  assert.equal(byId['5/NoImages'].name, 'No Images')
})

test('scan: Poster wird auch aus mod.info im Versionsordner / relativ nach common gefunden', async () => {
  const { mods } = await scan(path.join(root, 'game'), workshop, ['DE'])
  const byId = Object.fromEntries(mods.map((m) => [m.id, m]))
  assert.match(byId['1/BetterSorting'].poster, /BetterSorting\/42\/poster\.png$/)
  assert.match(byId['2/Rel'].poster, /Rel\/common\/rel\.png$/)
  assert.match(byId['3/PlainFolder'].poster, /PlainFolder\/42\/poster\.png$/, 'Rückfall poster.png')
  assert.equal(byId['5/NoImages'].poster, null)
})

test('scan: ein Poster-Pfad außerhalb des Mod-Ordners wird ignoriert', async () => {
  const { mods } = await scan(path.join(root, 'game'), workshop, ['DE'])
  assert.equal(mods.find((m) => m.id === '4/Escape').poster, null)
})
