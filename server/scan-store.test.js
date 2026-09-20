// scan-store.js: Scan-Stand speichern/laden, nur bei passenden Einstellungen.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const store = require('./scan-store')

let dir
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-scanstore-'))
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const meta = { gameRoot: 'C:/Game', workshopDir: 'C:/Workshop', langs: ['DE', 'FR'] }
const cache = { mods: [{ id: 'a/b', name: 'B' }], entriesByModId: { 'a/b': [{ key: 'K', original: 'O' }] }, langs: ['DE', 'FR'] }

test('save → load: gleicher Stand zurück, keine Temp-Datei übrig', async () => {
  const file = path.join(dir, 'sub', 'scan-cache.json')
  await store.save(file, meta, cache)
  assert.deepEqual(store.load(file, meta), cache)
  assert.deepEqual(store.load(file, { ...meta, langs: ['FR', 'DE'] }), cache, 'Reihenfolge der Sprachen egal')
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})

test('load: null bei anderen Pfaden/Sprachen, fehlender oder kaputter Datei', async () => {
  const file = path.join(dir, 'scan-cache.json')
  await store.save(file, meta, cache)
  assert.equal(store.load(file, { ...meta, gameRoot: 'D:/Game' }), null)
  assert.equal(store.load(file, { ...meta, workshopDir: 'D:/Workshop' }), null)
  assert.equal(store.load(file, { ...meta, langs: ['DE'] }), null)
  assert.equal(store.load(path.join(dir, 'gibt-es-nicht.json'), meta), null)
  fs.writeFileSync(file, '{ kaputt')
  assert.equal(store.load(file, meta), null)
})
