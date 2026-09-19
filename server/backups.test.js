// backups.js — Speicherpunkte mit Metadaten auflisten und zurückspielen
// ("Restore Backup" in Settings), plus die Backup-Regeln in entries.js, auf
// denen das aufbaut (meta.json, erste Sicherung gewinnt, "absent"-Vermerk).
const test = require('node:test')
const { before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { saveBatch, readMeta } = require('./entries')
const { listBackups, restoreBackup } = require('./backups')

let workdir
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-backups-'))
})
after(() => {
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true })
})

// Minimales Mod-Layout wie in entries.test.js: EN-Quelle + optional DE-Datei.
function makeMod(name, deContent) {
  const root = fs.mkdtempSync(path.join(workdir, `${name}-`))
  const rootPath = path.join(root, 'mods', name)
  const mod = { id: `123/${name}`, name, isBaseGame: false, rootPath }
  const vdir = path.join(rootPath, '42.20')
  const tdir = (lang) => path.join(vdir, 'media', 'lua', 'shared', 'Translate', lang)
  fs.mkdirSync(tdir('EN'), { recursive: true })
  fs.writeFileSync(path.join(tdir('EN'), 'UI.json'), JSON.stringify({ Greeting: 'Hello' }) + '\n')
  if (deContent !== undefined) {
    fs.mkdirSync(tdir('DE'), { recursive: true })
    fs.writeFileSync(path.join(tdir('DE'), 'UI.json'), JSON.stringify({ Greeting: deContent }) + '\n')
  }
  return {
    mod,
    deFile: path.join(tdir('DE'), 'UI.json'),
    entryId: '42.20/media/lua/shared/Translate/EN/UI.json::Greeting',
    backupRoot: path.join(root, 'backups'),
    baselineRoot: path.join(root, 'baseline')
  }
}

const readGreeting = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).Greeting

test('saveBatch schreibt meta.json mit exaktem Zielpfad und Mod-Namen', () => {
  const t = makeMod('MetaMod', 'Hallo alt')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo neu' }], 'DE', t.backupRoot, t.baselineRoot)
  const [pointId] = fs.readdirSync(t.backupRoot)
  const meta = readMeta(path.join(t.backupRoot, pointId))
  assert.deepEqual(meta.kinds, ['save'])
  assert.equal(meta.files.length, 1)
  const [f] = meta.files
  assert.equal(f.targetPath, t.deFile.replace(/\\/g, '/'))
  assert.equal(f.modId, '123/MetaMod')
  assert.equal(f.modName, 'MetaMod')
  assert.equal(f.lang, 'DE')
  assert.equal(f.absent, false)
  assert.ok(f.createdAt === undefined, 'Zeitstempel gehört an den Punkt, nicht an die Datei')
  assert.ok(meta.createdAt, 'Punkt braucht Datum und Uhrzeit')
})

// Wird dieselbe Datei im selben Speicherpunkt (derselben Minute) mehrmals
// gespeichert, muss der Stand VOR dem ersten Speichern erhalten bleiben —
// sonst holt ein Restore nur den Zwischenstand zurück.
test('erste Sicherung gewinnt: zweites Speichern im selben Punkt überschreibt das Backup nicht', () => {
  const t = makeMod('FirstWins', 'Original')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Zwischenstand' }], 'DE', t.backupRoot, t.baselineRoot)
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Endstand' }], 'DE', t.backupRoot, t.baselineRoot)
  const points = fs.readdirSync(t.backupRoot)
  // Beide Aufrufe laufen in derselben Minute (sonst ist der Test nicht aussagekräftig).
  if (points.length !== 1) return
  const meta = readMeta(path.join(t.backupRoot, points[0]))
  const copy = path.join(t.backupRoot, points[0], meta.files[0].dir, meta.files[0].fileName)
  assert.equal(readGreeting(copy), 'Original')
})

test('listBackups: Punkt mit Mods, Sprache und Art, neueste zuerst', () => {
  const t = makeMod('ListMod', 'Hallo alt')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo neu' }], 'DE', t.backupRoot, t.baselineRoot)
  // Älterer, nicht zuordenbarer Alt-Punkt ohne meta.json daneben.
  fs.mkdirSync(path.join(t.backupRoot, '2020-01-01_10-00', 'irgendwas'), { recursive: true })
  const list = listBackups(t.backupRoot)
  assert.equal(list.length, 2)
  assert.equal(list[0].restorable, true)
  assert.deepEqual(list[0].mods, [{ modId: '123/ListMod', name: 'ListMod' }])
  assert.deepEqual(list[0].langs, ['DE'])
  assert.deepEqual(list[0].kinds, ['save'])
  assert.equal(list[0].fileCount, 1)
  assert.equal(list[1].id, '2020-01-01_10-00')
  assert.equal(list[1].restorable, false, 'nicht zuordenbarer Alt-Punkt (kein Mod, keine Sprache) ist nicht wiederherstellbar')
})

test('restoreBackup: bringt den Stand vor dem Speichern zurück und sichert vorher den aktuellen', () => {
  const t = makeMod('RestoreMod', 'Vorher')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Nachher' }], 'DE', t.backupRoot, t.baselineRoot)
  const [point] = listBackups(t.backupRoot)
  assert.equal(readGreeting(t.deFile), 'Nachher')

  const res = restoreBackup(t.backupRoot, point.id)
  assert.equal(res.restored, 1)
  assert.equal(res.skipped, 0)
  assert.equal(readGreeting(t.deFile), 'Vorher')

  // Die Sicherung vor dem Restore ist selbst ein Punkt — damit lässt sich
  // auch der Restore rückgängig machen.
  assert.ok(res.safetyBackupId)
  const safety = listBackups(t.backupRoot).find((b) => b.id === res.safetyBackupId)
  assert.deepEqual(safety.kinds, ['restore'])
  restoreBackup(t.backupRoot, res.safetyBackupId)
  assert.equal(readGreeting(t.deFile), 'Nachher')
})

test('restoreBackup: Datei, die es vorher nicht gab, wird gelöscht', () => {
  const t = makeMod('AbsentMod') // keine DE-Datei vorhanden
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Neu angelegt' }], 'DE', t.backupRoot, t.baselineRoot)
  assert.ok(fs.existsSync(t.deFile))
  const [point] = listBackups(t.backupRoot)
  assert.equal(readMeta(path.join(t.backupRoot, point.id)).files[0].absent, true)

  const res = restoreBackup(t.backupRoot, point.id)
  assert.equal(res.restored, 1)
  assert.equal(fs.existsSync(t.deFile), false)
})

test('restoreBackup: schon am Ziel → nichts zu tun, keine leere Sicherung', () => {
  const t = makeMod('NoopMod', 'Vorher')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Nachher' }], 'DE', t.backupRoot, t.baselineRoot)
  const [point] = listBackups(t.backupRoot)
  restoreBackup(t.backupRoot, point.id)
  const before = listBackups(t.backupRoot).length
  const again = restoreBackup(t.backupRoot, point.id)
  assert.equal(again.restored, 0)
  assert.equal(again.safetyBackupId, null)
  assert.equal(listBackups(t.backupRoot).length, before)
})

test('restoreBackup: Mod-Ordner inzwischen weg → übersprungen, nicht neu angelegt', () => {
  const t = makeMod('GoneMod', 'Vorher')
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Nachher' }], 'DE', t.backupRoot, t.baselineRoot)
  const [point] = listBackups(t.backupRoot)
  fs.rmSync(t.mod.rootPath, { recursive: true, force: true })
  const res = restoreBackup(t.backupRoot, point.id)
  assert.equal(res.restored, 0)
  assert.equal(res.skipped, 1)
  assert.equal(fs.existsSync(t.mod.rootPath), false)
})

test('restoreBackup: ungültige id → 400, Alt-Punkt → 409, unbekannt → 404', () => {
  const t = makeMod('ErrMod', 'x')
  fs.mkdirSync(path.join(t.backupRoot, '2020-01-01_10-00', 'irgendwas'), { recursive: true })
  assert.throws(() => restoreBackup(t.backupRoot, '../../etc'), (e) => e.status === 400)
  assert.throws(() => restoreBackup(t.backupRoot, '2020-01-01_10-00'), (e) => e.status === 409)
  assert.throws(() => restoreBackup(t.backupRoot, '2021-01-01_10-00'), (e) => e.status === 404)
})

// Alt-Punkte (vor meta.json) im echten alten Format nachbauen:
// <modId mit "/"→"_">__<version>__<EN-Pfad mit "/"→"_">/<gesicherte Zieldatei>
function legacyPoint(backupRoot, id, entries) {
  for (const [folder, fileName, content] of entries) {
    const dir = path.join(backupRoot, id, folder)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, fileName), content)
  }
}

test('Alt-Punkt: JSON bekommt die Sprache, die die TXT-Dateien desselben Punkts belegen', () => {
  const t = makeMod('LegacyMod', 'Hallo neu')
  legacyPoint(t.backupRoot, '2026-09-16_15-59', [
    ['123_LegacyMod__42.20__media_lua_shared_Translate_EN_UI.json', 'UI.json', JSON.stringify({ Greeting: 'Hallo alt' }) + '\n'],
    ['123_LegacyMod__42.20__media_lua_shared_Translate_EN_Sandbox_EN.txt', 'Sandbox_DE.txt', 'Sandbox_DE = {}\n']
  ])

  // Ohne Scan (keine Mods) nicht zuordenbar.
  assert.equal(listBackups(t.backupRoot)[0].restorable, false)
  assert.throws(() => restoreBackup(t.backupRoot, '2026-09-16_15-59'), (e) => e.status === 409 && /Search for mods first/.test(e.message))

  const [point] = listBackups(t.backupRoot, [t.mod])
  assert.equal(point.restorable, true)
  assert.equal(point.legacy, true)
  assert.deepEqual(point.langs, ['DE'])
  assert.deepEqual(point.mods, [{ modId: '123/LegacyMod', name: 'LegacyMod' }])

  const res = restoreBackup(t.backupRoot, '2026-09-16_15-59', [t.mod])
  assert.equal(res.restored, 2)
  assert.equal(readGreeting(t.deFile), 'Hallo alt')
  // Auch der Alt-Restore ist über den Sicherungspunkt rückgängig zu machen.
  restoreBackup(t.backupRoot, res.safetyBackupId, [t.mod])
  assert.equal(readGreeting(t.deFile), 'Hallo neu')
})

test('Alt-Punkt nur mit JSON: Sprache kommt aus den übrigen Alt-Punkten', () => {
  const t = makeMod('JsonOnly', 'Hallo neu')
  legacyPoint(t.backupRoot, '2026-09-16_17-16', [
    ['999_Other__root__media_lua_shared_Translate_EN_IG_UI_EN.txt', 'IG_UI_DE.txt', 'IG_UI_DE = {}\n']
  ])
  legacyPoint(t.backupRoot, '2026-09-16_23-16', [
    ['123_JsonOnly__42.20__media_lua_shared_Translate_EN_UI.json', 'UI.json', JSON.stringify({ Greeting: 'Hallo alt' }) + '\n']
  ])
  const point = listBackups(t.backupRoot, [t.mod]).find((b) => b.id === '2026-09-16_23-16')
  assert.equal(point.restorable, true)
  assert.deepEqual(point.langs, ['DE'])
  restoreBackup(t.backupRoot, '2026-09-16_23-16', [t.mod])
  assert.equal(readGreeting(t.deFile), 'Hallo alt')
})

test('Alt-Punkt: Sprache nirgends eindeutig belegt → nicht geraten, nicht wiederherstellbar', () => {
  const t = makeMod('NoEvidence', 'Hallo neu')
  legacyPoint(t.backupRoot, '2026-09-16_23-16', [
    ['123_NoEvidence__42.20__media_lua_shared_Translate_EN_UI.json', 'UI.json', JSON.stringify({ Greeting: 'x' }) + '\n']
  ])
  const [point] = listBackups(t.backupRoot, [t.mod])
  assert.equal(point.restorable, false)
  assert.equal(readGreeting(t.deFile), 'Hallo neu')
})
