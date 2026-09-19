// entries.js — Fehler-Klassifikation (2.2: Rechtefehler sauber im UI melden)
// + Speichern/Reset im Arbeitsordner (Game/Workshop bleiben unangetastet).
const test = require('node:test')
const { before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { classifyFsError, saveBatch, resetToGame, readMeta } = require('./entries')
const { workLangDir } = require('./scanner')
const { setProtectedRoots } = require('./guard')

function fsErr(code, msg, cause) {
  const e = new Error(msg || `${code}: test`)
  e.code = code
  if (cause) e.cause = cause
  return e
}

test('classifyFsError: EPERM → 403 + deutsche Nachricht mit Pfad', () => {
  const err = fsErr('EPERM', 'EPERM: operation not permitted, open \'C:\\mods\\DE\\UI.json\'')
  const out = classifyFsError(err, 'C:\\mods\\DE\\UI.json')
  assert.equal(out.status, 403)
  assert.match(out.message, /^Target folder not writable: C:\/mods\/DE\/UI\.json/)
})

test('classifyFsError: EACCES (in cause-Chain) → 403', () => {
  const inner = fsErr('EACCES', 'EACCES: permission denied')
  const outer = fsErr('ENOENT', 'wrapper', inner)
  const out = classifyFsError(outer, 'X:/a/b')
  assert.equal(out.status, 403)
  assert.match(out.message, /not writable/)
})

test('classifyFsError: ENOENT → 404', () => {
  const out = classifyFsError(fsErr('ENOENT', 'ENOENT: no such file'), 'X:/fehlend')
  assert.equal(out.status, 404)
  assert.match(out.message, /Folder not found/)
})

test('classifyFsError: ENOTDIR → 500', () => {
  const out = classifyFsError(fsErr('ENOTDIR', 'ENOTDIR'), 'X:/pfad')
  assert.equal(out.status, 500)
  assert.match(out.message, /directory layout/)
})

test('classifyFsError: ohne fs-Code → unverändert', () => {
  const err = Object.assign(new Error('entries missing'), { status: 400 })
  const out = classifyFsError(err, 'X:/y')
  assert.equal(out.status, 400)
  assert.equal(out.message, 'entries missing')
})

test('classifyFsError: vorhandener Status bleibt erhalten', () => {
  const err = Object.assign(new Error('ENOTDIR'), { status: 500, code: 'ENOTDIR' })
  const out = classifyFsError(err, 'X:/y')
  assert.equal(out.status, 500)
})

// --- saveBatch/resetToGame: Arbeitsordner statt Schreiben ins Spiel ---

let workdir

before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-entries-'))
})

after(() => {
  setProtectedRoots(() => [])
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true })
})

// Minimales Mod-Layout: <root>/mods/<name>/<version>/media/lua/shared/Translate/EN/UI.json.
// Arbeitsordner: <root>/work.
function makeTestMod(root, name, version) {
  const rootPath = path.join(root, 'mods', name)
  const mod = { id: name, name, isBaseGame: false, rootPath }
  const vdir = path.join(rootPath, version)
  const translateDir = (lang) => path.join(vdir, 'media', 'lua', 'shared', 'Translate', lang)
  fs.mkdirSync(translateDir('EN'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('EN'), 'UI.json'), JSON.stringify({ Greeting: 'Hello' }) + '\n', 'utf8')
  const file = 'media/lua/shared/Translate/EN/UI.json'
  const entryId = `${version}/${file}::Greeting`
  const workRoot = path.join(root, 'work')
  const workFile = (lang) => path.join(workLangDir(workRoot, mod, version, lang), 'UI.json')
  return { mod, vdir, translateDir, file, entryId, workRoot, workFile, backupRoot: path.join(root, 'backups') }
}

// Layout mit TXT-Quelle (B41-Altlast): .../Translate/EN/Sandbox_EN.txt.
// Ziel ist IMMER Sandbox.json.
function makeTxtTestMod(root, name, version) {
  const rootPath = path.join(root, 'mods', name)
  const mod = { id: name, name, isBaseGame: false, rootPath }
  const vdir = path.join(rootPath, version)
  const translateDir = (lang) => path.join(vdir, 'media', 'lua', 'shared', 'Translate', lang)
  fs.mkdirSync(translateDir('EN'), { recursive: true })
  fs.writeFileSync(
    path.join(translateDir('EN'), 'Sandbox_EN.txt'),
    'Sandbox_EN = {\n\tGreeting = "Hello",\n\tFarewell = "Bye"\n}\n',
    'utf8'
  )
  const file = 'media/lua/shared/Translate/EN/Sandbox_EN.txt'
  const entryId = (key) => `${version}/${file}::${key}`
  const workRoot = path.join(root, 'work')
  const workFile = (lang) => path.join(workLangDir(workRoot, mod, version, lang), 'Sandbox.json')
  return { mod, vdir, translateDir, file, entryId, workRoot, workFile, backupRoot: path.join(root, 'backups') }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// Snapshot aller Dateien unter einem Ordner (Pfad → Inhalt) — beweist "unverändert".
function snapshot(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[p] = fs.readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

test('saveBatch: schreibt nur in den Arbeitsordner, Spiel/Workshop bleiben byte-genau unverändert', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'readonly-'))
  const t = makeTestMod(root, 'TestMod', '1.0')
  fs.mkdirSync(t.translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(t.translateDir('DE'), 'UI.json'), JSON.stringify({ Greeting: 'Hallo (bestehend)' }) + '\n', 'utf8')
  const before = snapshot(path.join(root, 'mods'))

  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo NEU' }], 'DE', t.backupRoot, t.workRoot)

  assert.deepEqual(snapshot(path.join(root, 'mods')), before, 'Mod-Ordner unverändert')
  assert.equal(readJson(t.workFile('DE')).Greeting, 'Hallo NEU')
})

test('saveBatch: erstes Speichern sät die Arbeitsdatei aus der Übersetzung im Spiel', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'seed-'))
  const t = makeTestMod(root, 'SeedMod', '1.0')
  fs.writeFileSync(
    path.join(t.translateDir('EN'), 'UI.json'),
    JSON.stringify({ Greeting: 'Hello', Bye: 'Bye' }) + '\n'
  )
  fs.mkdirSync(t.translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(t.translateDir('DE'), 'UI.json'), JSON.stringify({ Bye: 'Tschüss (bestehend)' }) + '\n', 'utf8')

  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo' }], 'DE', t.backupRoot, t.workRoot)

  const work = readJson(t.workFile('DE'))
  assert.equal(work.Greeting, 'Hallo')
  assert.equal(work.Bye, 'Tschüss (bestehend)', 'bestehender Stand im Spiel bleibt in der Arbeitsdatei erhalten')
})

test('saveBatch: zwei Sprachen haben getrennte Arbeitsdateien, Reset trifft nur eine', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'two-langs-'))
  const t = makeTestMod(root, 'TwoLangs', '1.0')
  fs.mkdirSync(t.translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(t.translateDir('DE'), 'UI.json'), JSON.stringify({ Greeting: 'Hallo (bestehend)' }) + '\n', 'utf8')

  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo NEU' }], 'DE', t.backupRoot, t.workRoot)
  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Bonjour NEU' }], 'FR', t.backupRoot, t.workRoot)
  assert.notEqual(t.workFile('DE'), t.workFile('FR'))

  const changed = resetToGame(t.mod, '1.0', t.file, 'DE', t.backupRoot, t.workRoot)
  assert.equal(changed, 1)
  assert.equal(fs.existsSync(t.workFile('DE')), false, 'Arbeitsdatei DE ist weg')
  assert.equal(readJson(t.workFile('FR')).Greeting, 'Bonjour NEU', 'FR bleibt unberührt')
  assert.equal(readJson(path.join(t.translateDir('DE'), 'UI.json')).Greeting, 'Hallo (bestehend)', 'Datei im Spiel unberührt')
})

test('resetToGame: sichert die Arbeitsdatei vorher als Speicherpunkt; ohne Arbeitsdatei nichts zu tun', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'reset-backup-'))
  const t = makeTestMod(root, 'ResetMod', '1.0')
  assert.equal(resetToGame(t.mod, '1.0', t.file, 'DE', t.backupRoot, t.workRoot), 0)

  saveBatch(t.mod, [{ entryId: t.entryId, translation: 'Hallo' }], 'DE', t.backupRoot, t.workRoot)
  const changed = resetToGame(t.mod, '1.0', t.file, 'DE', t.backupRoot, t.workRoot, 'reset-stamp')
  assert.equal(changed, 1)
  const meta = readMeta(path.join(t.backupRoot, 'reset-stamp'))
  assert.deepEqual(meta.kinds, ['reset'])
  assert.equal(meta.files[0].targetPath, t.workFile('DE').replace(/\\/g, '/'))
})

test('saveBatch: unlesbare Arbeitsdatei bricht ab (409), statt sie zu überschreiben', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'broken-'))
  const t = makeTestMod(root, 'BrokenMod', '1.0')
  fs.mkdirSync(path.dirname(t.workFile('DE')), { recursive: true })
  fs.writeFileSync(t.workFile('DE'), '{ das ist kein json', 'utf8')
  assert.throws(
    () => saveBatch(t.mod, [{ entryId: t.entryId, translation: 'x' }], 'DE', t.backupRoot, t.workRoot),
    (e) => e.status === 409
  )
  assert.equal(fs.readFileSync(t.workFile('DE'), 'utf8'), '{ das ist kein json')
})

test('guard: Schreiben in einen geschützten Ordner (Spiel/Workshop) wird mit 403 abgelehnt', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'guard-'))
  const t = makeTestMod(root, 'GuardMod', '1.0')
  // Fehlkonfiguration simulieren: der Arbeitsordner läge im "Spiel".
  setProtectedRoots(() => [path.join(root, 'mods')])
  try {
    assert.throws(
      () => saveBatch(t.mod, [{ entryId: t.entryId, translation: 'x' }], 'DE', t.backupRoot, path.join(root, 'mods', 'work')),
      (e) => e.status === 403 && /Refusing to write/.test(e.message)
    )
  } finally {
    setProtectedRoots(() => [])
  }
})

// --- TXT-Quellen (B41-Altlast): Ziel ist trotzdem JSON ---

test('saveBatch (TXT-Quelle): Arbeitsdatei ist JSON und übernimmt den Bestand aus der alten <Kategorie>_<LANG>.txt', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-seed-'))
  const t = makeTxtTestMod(root, 'TxtMod', '1.0')
  fs.mkdirSync(t.translateDir('DE'), { recursive: true })
  const legacyTxt = path.join(t.translateDir('DE'), 'Sandbox_DE.txt')
  fs.writeFileSync(legacyTxt, 'Sandbox_DE = {\n\tGreeting = "Hallo (Alt)"\n}\n', 'utf8')

  const result = saveBatch(t.mod, [{ entryId: t.entryId('Farewell'), translation: 'Tschüss' }], 'DE', t.backupRoot, t.workRoot)
  assert.equal(result.saved, 1)

  const written = readJson(t.workFile('DE'))
  assert.equal(written.Farewell, 'Tschüss')
  assert.equal(written.Greeting, 'Hallo (Alt)', 'aus der Legacy-TXT übernommener Bestand bleibt erhalten')
  assert.match(fs.readFileSync(legacyTxt, 'utf8'), /Hallo \(Alt\)/)
  assert.equal(fs.existsSync(path.join(t.translateDir('DE'), 'Sandbox.json')), false, 'keine JSON im Mod angelegt')
})

test('saveBatch (Zielsprache EN): Originaltexte im Mod bleiben unverändert, die Änderung liegt im Arbeitsordner', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-en-'))
  const t = makeTxtTestMod(root, 'TxtEnMod', '1.0')
  const before = snapshot(path.join(root, 'mods'))

  const result = saveBatch(t.mod, [{ entryId: t.entryId('Greeting'), translation: 'Hello (edited)' }], 'EN', t.backupRoot, t.workRoot)
  assert.equal(result.saved, 1)

  const written = readJson(t.workFile('EN'))
  assert.equal(written.Greeting, 'Hello (edited)')
  assert.equal(written.Farewell, 'Bye', 'unveränderte Keys aus der EN-Quelle sind mit übernommen (volle Kopie)')
  assert.deepEqual(snapshot(path.join(root, 'mods')), before, 'EN-Quelle im Mod unverändert')
})
