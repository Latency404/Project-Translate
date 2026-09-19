// backups.js — Speicherpunkte mit Metadaten auflisten und zurückspielen
// ("Restore Backup" in Settings), plus die Backup-Regeln in entries.js, auf
// denen das aufbaut (meta.json, erste Sicherung gewinnt, "absent"-Vermerk).
// Zurückgespielt wird nur in den Arbeitsordner.
const test = require('node:test')
const { before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { saveBatch, readMeta } = require('./entries')
const { listBackups, restoreBackup } = require('./backups')
const { workLangDir } = require('./scanner')

let workdir
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-backups-'))
})
after(() => {
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true })
})

// Minimales Mod-Layout wie in entries.test.js: EN-Quelle + optional DE-Datei im
// "Spiel"; der Arbeitsstand liegt unter <root>/work.
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
  const workRoot = path.join(root, 'work')
  return {
    mod,
    gameDeFile: path.join(tdir('DE'), 'UI.json'),
    workDeFile: path.join(workLangDir(workRoot, mod, '42.20', 'DE'), 'UI.json'),
    entryId: '42.20/media/lua/shared/Translate/EN/UI.json::Greeting',
    backupRoot: path.join(root, 'backups'),
    workRoot
  }
}

const readGreeting = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).Greeting
const save = (t, translation) =>
  saveBatch(t.mod, [{ entryId: t.entryId, translation }], 'DE', t.backupRoot, t.workRoot)

test('saveBatch schreibt meta.json mit exaktem Zielpfad (Arbeitsdatei) und Mod-Namen', () => {
  const t = makeMod('MetaMod', 'Hallo alt')
  save(t, 'Hallo neu')
  const [pointId] = fs.readdirSync(t.backupRoot)
  const meta = readMeta(path.join(t.backupRoot, pointId))
  assert.deepEqual(meta.kinds, ['save'])
  assert.equal(meta.files.length, 1)
  const [f] = meta.files
  assert.equal(f.targetPath, t.workDeFile.replace(/\\/g, '/'))
  assert.equal(f.modId, '123/MetaMod')
  assert.equal(f.modName, 'MetaMod')
  assert.equal(f.lang, 'DE')
  assert.equal(f.absent, true, 'die Arbeitsdatei gab es vor dem ersten Speichern nicht')
  assert.ok(f.createdAt === undefined, 'Zeitstempel gehört an den Punkt, nicht an die Datei')
  assert.ok(meta.createdAt, 'Punkt braucht Datum und Uhrzeit')
})

// Wird dieselbe Datei im selben Speicherpunkt (derselben Minute) mehrmals
// gespeichert, muss der Stand VOR dem ersten Speichern erhalten bleiben —
// sonst holt ein Restore nur den Zwischenstand zurück.
test('erste Sicherung gewinnt: zweites Speichern im selben Punkt überschreibt das Backup nicht', () => {
  const t = makeMod('FirstWins', 'Original')
  save(t, 'Zwischenstand')
  save(t, 'Endstand')
  const points = fs.readdirSync(t.backupRoot)
  // Beide Aufrufe laufen in derselben Minute (sonst ist der Test nicht aussagekräftig).
  if (points.length !== 1) return
  const meta = readMeta(path.join(t.backupRoot, points[0]))
  assert.equal(meta.files.length, 1)
  assert.equal(meta.files[0].absent, true, 'erste Sicherung = Zustand vor dem ersten Speichern (keine Arbeitsdatei)')
})

test('listBackups: Punkt mit Mods, Sprache und Art, neueste zuerst; Alt-Punkt nicht wiederherstellbar', () => {
  const t = makeMod('ListMod', 'Hallo alt')
  save(t, 'Hallo neu')
  // Älterer Alt-Punkt ohne meta.json daneben.
  fs.mkdirSync(path.join(t.backupRoot, '2020-01-01_10-00', 'irgendwas'), { recursive: true })
  const list = listBackups(t.backupRoot, t.workRoot)
  assert.equal(list.length, 2)
  assert.equal(list[0].restorable, true)
  assert.deepEqual(list[0].mods, [{ modId: '123/ListMod', name: 'ListMod' }])
  assert.deepEqual(list[0].langs, ['DE'])
  assert.deepEqual(list[0].kinds, ['save'])
  assert.equal(list[0].fileCount, 1)
  assert.equal(list[1].id, '2020-01-01_10-00')
  assert.equal(list[1].restorable, false)
})

test('restoreBackup: bringt den Arbeitsstand von vor dem Speichern zurück und sichert vorher den aktuellen', () => {
  const t = makeMod('RestoreMod', 'Vorher')
  save(t, 'Erst')
  // Zweiter Punkt (andere Minute simulieren): eigener Ordner mit Stand "Erst".
  const [first] = listBackups(t.backupRoot, t.workRoot)
  assert.equal(readGreeting(t.workDeFile), 'Erst')

  // Den ersten Punkt zurückspielen: die Arbeitsdatei gab es vorher nicht → weg.
  const res = restoreBackup(t.backupRoot, first.id, t.workRoot)
  assert.equal(res.restored, 1)
  assert.equal(fs.existsSync(t.workDeFile), false)

  // Die Sicherung vor dem Restore ist selbst ein Punkt — damit lässt sich
  // auch der Restore rückgängig machen.
  assert.ok(res.safetyBackupId)
  const safety = listBackups(t.backupRoot, t.workRoot).find((b) => b.id === res.safetyBackupId)
  assert.deepEqual(safety.kinds, ['restore'])
  restoreBackup(t.backupRoot, res.safetyBackupId, t.workRoot)
  assert.equal(readGreeting(t.workDeFile), 'Erst')
})

test('restoreBackup: schon am Ziel → nichts zu tun, keine leere Sicherung', () => {
  const t = makeMod('NoopMod', 'Vorher')
  save(t, 'Nachher')
  const [point] = listBackups(t.backupRoot, t.workRoot)
  restoreBackup(t.backupRoot, point.id, t.workRoot)
  const before = listBackups(t.backupRoot, t.workRoot).length
  const again = restoreBackup(t.backupRoot, point.id, t.workRoot)
  assert.equal(again.restored, 0)
  assert.equal(again.safetyBackupId, null)
  assert.equal(listBackups(t.backupRoot, t.workRoot).length, before)
})

test('restoreBackup: fasst die Datei im Spiel nie an', () => {
  const t = makeMod('GameUntouched', 'Original im Spiel')
  save(t, 'Nachher')
  const [point] = listBackups(t.backupRoot, t.workRoot)
  restoreBackup(t.backupRoot, point.id, t.workRoot)
  assert.equal(readGreeting(t.gameDeFile), 'Original im Spiel')
})

test('restoreBackup: Punkt mit Zielpfad außerhalb des Arbeitsordners wird nie zurückgespielt', () => {
  const t = makeMod('OutsideMod', 'Im Spiel')
  const pointDir = path.join(t.backupRoot, '2026-09-16_15-59')
  fs.mkdirSync(path.join(pointDir, 'x'), { recursive: true })
  fs.writeFileSync(path.join(pointDir, 'x', 'UI.json'), JSON.stringify({ Greeting: 'Alt' }) + '\n')
  // meta.json im alten Format: Zielpfad ist die Datei IM SPIEL.
  fs.writeFileSync(
    path.join(pointDir, 'meta.json'),
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      kinds: ['save'],
      files: [
        { dir: 'x', fileName: 'UI.json', targetPath: t.gameDeFile.replace(/\\/g, '/'), modId: t.mod.id, modName: 'OutsideMod', version: '42.20', file: 'f', lang: 'DE', absent: false }
      ]
    })
  )
  const [point] = listBackups(t.backupRoot, t.workRoot)
  assert.equal(point.restorable, false)
  assert.throws(() => restoreBackup(t.backupRoot, point.id, t.workRoot), (e) => e.status === 409)
  assert.equal(readGreeting(t.gameDeFile), 'Im Spiel', 'Datei im Spiel unverändert')
})

test('restoreBackup: ungültige id → 400, Alt-Punkt → 409, unbekannt → 404', () => {
  const t = makeMod('ErrMod', 'x')
  fs.mkdirSync(path.join(t.backupRoot, '2020-01-01_10-00', 'irgendwas'), { recursive: true })
  assert.throws(() => restoreBackup(t.backupRoot, '../../etc', t.workRoot), (e) => e.status === 400)
  assert.throws(() => restoreBackup(t.backupRoot, '2020-01-01_10-00', t.workRoot), (e) => e.status === 409)
  assert.throws(() => restoreBackup(t.backupRoot, '2021-01-01_10-00', t.workRoot), (e) => e.status === 404)
})
