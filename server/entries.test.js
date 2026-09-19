// entries.js — Fehler-Klassifikation (2.2: Rechtefehler sauber im UI melden)
// + Backup/Baseline-Ordner je Zielsprache (Multi-Language-Umbau).
const test = require('node:test')
const { before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { classifyFsError, saveBatch, restoreBaseline, backupName, readMeta } = require('./entries')

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

// --- saveBatch/restoreBaseline: Backup-/Baseline-Ordner je Zielsprache ---
// (Multi-Language-Umbau — Bug: Ordner ohne Sprach-Suffix wurden von zwei
// Zielsprachen geteilt, die dieselbe EN-Quelldatei betreffen; ein Reset hätte
// dann die falsche Sprache wiederhergestellt.)

let workdir

before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-entries-'))
})

after(() => {
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true })
})

// Legt ein minimales Mod-Layout auf der Platte an: <root>/mods/<name>/<version>/
// media/lua/shared/Translate/<LANG>/UI.json. Gibt das Mod-Objekt + Pfade zurück.
function makeTestMod(root, name, version) {
  const rootPath = path.join(root, 'mods', name)
  const mod = { id: name, isBaseGame: false, rootPath }
  const vdir = path.join(rootPath, version)
  const translateDir = (lang) => path.join(vdir, 'media', 'lua', 'shared', 'Translate', lang)
  fs.mkdirSync(translateDir('EN'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('EN'), 'UI.json'), JSON.stringify({ Greeting: 'Hello' }) + '\n', 'utf8')
  const file = 'media/lua/shared/Translate/EN/UI.json'
  const entryId = `${version}/${file}::Greeting`
  return { mod, vdir, translateDir, file, entryId }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// Legt ein minimales Mod-Layout mit einer TXT-Quelle an (B41-Altlast):
// <root>/mods/<name>/<version>/media/lua/shared/Translate/EN/Sandbox_EN.txt.
// B42 lädt nur noch JSON (s. scanner.js) — Ziel ist deshalb IMMER
// Sandbox.json, auch wenn die Quelle TXT ist.
function makeTxtTestMod(root, name, version) {
  const rootPath = path.join(root, 'mods', name)
  const mod = { id: name, isBaseGame: false, rootPath }
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
  return { mod, vdir, translateDir, file, entryId }
}

test('saveBatch: zwei Sprachen auf derselben Quelldatei bekommen eigene Baselines, Reset trifft nur eine', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'two-langs-'))
  const { mod, translateDir, file, entryId } = makeTestMod(root, 'TestMod', '1.0')
  // Vorbestehende (App-fremde) Übersetzungen je Sprache — das ist die
  // Baseline, die beim allerersten Speichern gesichert werden muss.
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'UI.json'), JSON.stringify({ Greeting: 'Hallo (bestehend)' }) + '\n', 'utf8')
  fs.mkdirSync(translateDir('FR'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('FR'), 'UI.json'), JSON.stringify({ Greeting: 'Bonjour (bestehend)' }) + '\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')

  saveBatch(mod, [{ entryId, translation: 'Hallo NEU' }], 'DE', backupRoot, baselineRoot)
  saveBatch(mod, [{ entryId, translation: 'Bonjour NEU' }], 'FR', backupRoot, baselineRoot)

  // Beide Sprachen haben eigene, unterscheidbare Baseline-Ordner.
  const deBaselineDir = path.join(baselineRoot, backupName(mod.id, '1.0', file, 'DE'))
  const frBaselineDir = path.join(baselineRoot, backupName(mod.id, '1.0', file, 'FR'))
  assert.notEqual(deBaselineDir, frBaselineDir)
  assert.equal(readJson(path.join(deBaselineDir, 'UI.json')).Greeting, 'Hallo (bestehend)')
  assert.equal(readJson(path.join(frBaselineDir, 'UI.json')).Greeting, 'Bonjour (bestehend)')

  // Reset DE stellt nur die DE-Datei wieder her — FR bleibt unberührt.
  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot)
  assert.equal(changed, 1)
  assert.equal(readJson(path.join(translateDir('DE'), 'UI.json')).Greeting, 'Hallo (bestehend)')
  assert.equal(readJson(path.join(translateDir('FR'), 'UI.json')).Greeting, 'Bonjour NEU')
})

test('restoreBaseline: alte Baseline ohne Sprach-Suffix wird weiterhin gefunden und angewendet', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'legacy-baseline-'))
  const { mod, translateDir, file } = makeTestMod(root, 'LegacyMod', '1.0')
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'UI.json'), JSON.stringify({ Greeting: 'Aktuell' }) + '\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  // Alter Ordnername (vor dem Multi-Language-Umbau): kein Sprach-Suffix.
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  const legacyDir = path.join(baselineRoot, `${clean(mod.id)}__${clean('1.0')}__${clean(file)}`)
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'UI.json'), JSON.stringify({ Greeting: 'Ursprünglich' }) + '\n', 'utf8')

  // Kein Ordner mit Suffix vorhanden — der alte muss trotzdem gefunden werden.
  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot)
  assert.equal(changed, 1)
  assert.equal(readJson(path.join(translateDir('DE'), 'UI.json')).Greeting, 'Ursprünglich')
})

// --- JSON-Only-Umbau (B42 lädt keine TXT-Zieldateien mehr): TXT-Quellen ---

test('saveBatch (TXT-Quelle): schreibt die JSON-Zieldatei und übernimmt den Bestand aus der alten <Kategorie>_<LANG>.txt', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-seed-'))
  const { mod, translateDir, entryId } = makeTxtTestMod(root, 'TxtMod', '1.0')
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Hallo (Alt)"\n}\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  const result = saveBatch(mod, [{ entryId: entryId('Farewell'), translation: 'Tschüss' }], 'DE', backupRoot, baselineRoot)
  assert.equal(result.saved, 1)

  const tgt = path.join(translateDir('DE'), 'Sandbox.json')
  assert.ok(fs.existsSync(tgt), 'Ziel ist die JSON-Datei, keine TXT mehr')
  const written = readJson(tgt)
  assert.equal(written.Farewell, 'Tschüss')
  assert.equal(written.Greeting, 'Hallo (Alt)', 'aus der Legacy-TXT übernommener Bestand bleibt erhalten')
  // Die alte TXT-Datei selbst wird nicht mehr angefasst.
  assert.match(fs.readFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'utf8'), /Hallo \(Alt\)/)
})

test('saveBatch (TXT-Quelle, Zielsprache EN): erzeugt eine volle JSON-Kopie der Quelle plus die Edits', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-en-'))
  const { mod, translateDir, entryId } = makeTxtTestMod(root, 'TxtEnMod', '1.0')
  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  const result = saveBatch(mod, [{ entryId: entryId('Greeting'), translation: 'Hello (edited)' }], 'EN', backupRoot, baselineRoot)
  assert.equal(result.saved, 1)

  const tgt = path.join(translateDir('EN'), 'Sandbox.json')
  assert.ok(fs.existsSync(tgt))
  const written = readJson(tgt)
  assert.equal(written.Greeting, 'Hello (edited)')
  assert.equal(written.Farewell, 'Bye', 'unveränderte Keys aus der EN-Quelle sind mit übernommen (volle Kopie)')
  // Die TXT-Quelle selbst bleibt daneben unangetastet stehen.
  assert.ok(fs.existsSync(path.join(translateDir('EN'), 'Sandbox_EN.txt')))
})

test('restoreBaseline (TXT-Quelle): Reset entfernt die neu angelegte JSON wieder, die Legacy-TXT bleibt unberührt', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-reset-'))
  const { mod, translateDir, entryId, file } = makeTxtTestMod(root, 'TxtResetMod', '1.0')
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Hallo (Alt)"\n}\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  saveBatch(mod, [{ entryId: entryId('Farewell'), translation: 'Tschüss' }], 'DE', backupRoot, baselineRoot)
  const tgt = path.join(translateDir('DE'), 'Sandbox.json')
  assert.ok(fs.existsSync(tgt))

  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot)
  assert.ok(changed > 0)
  // Die JSON-Datei gab es vor der App nicht — Reset löscht sie wieder.
  assert.equal(fs.existsSync(tgt), false)
  // Die Legacy-TXT-Datei hat die App nie geschrieben — bleibt unverändert.
  assert.match(fs.readFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'utf8'), /Hallo \(Alt\)/)
})

test('restoreBaseline: Alt-Baseline mit Kopie der Legacy-TXT-Zieldatei wird weiterhin zurückgespielt', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-legacy-baseline-'))
  const { mod, translateDir, file } = makeTxtTestMod(root, 'TxtLegacyBaseline', '1.0')
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Aktuell"\n}\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  // Alt-Baseline (vor dem JSON-Only-Umbau): Kopie der alten TXT-Zieldatei,
  // sprachunabhängiger Ordnername (vor dem Multi-Language-Umbau angelegt).
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  const legacyDir = path.join(baselineRoot, `${clean(mod.id)}__${clean('1.0')}__${clean(file)}`)
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Ursprünglich"\n}\n', 'utf8')

  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot)
  assert.equal(changed, 1)
  assert.match(fs.readFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'utf8'), /Ursprünglich/)
  // Es wurde keine JSON-Datei angelegt — nur die Alt-Baseline wurde zurückgespielt.
  assert.equal(fs.existsSync(path.join(translateDir('DE'), 'Sandbox.json')), false)
})

test('restoreBaseline: nackter Alt-".absent"-Marker bezieht sich auf den alten TXT-Zielnamen, nicht auf die neue JSON', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'txt-legacy-absent-'))
  const { mod, translateDir, file } = makeTxtTestMod(root, 'TxtLegacyAbsent', '1.0')
  // Die Ziel-TXT gab es vor der App nicht, ein früherer (Alt-)Save hat sie angelegt.
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tFarewell = "Tschüss"\n}\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  const legacyDir = path.join(baselineRoot, `${clean(mod.id)}__${clean('1.0')}__${clean(file)}`)
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(path.join(legacyDir, '.absent'), '')

  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot)
  assert.equal(changed, 1)
  assert.equal(fs.existsSync(path.join(translateDir('DE'), 'Sandbox_DE.txt')), false)
})

test('restoreBaseline + backupFile: Reset über JSON- UND Legacy-TXT-Ziel im selben Ordner erzeugt zwei Backup-Einträge (dedupe by targetPath)', () => {
  const root = fs.mkdtempSync(path.join(workdir, 'dedupe-'))
  const { mod, translateDir, entryId, file } = makeTxtTestMod(root, 'DedupeMod', '1.0')
  fs.mkdirSync(translateDir('DE'), { recursive: true })
  fs.writeFileSync(path.join(translateDir('DE'), 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Hallo (Alt)"\n}\n', 'utf8')

  const backupRoot = path.join(root, 'backups')
  const baselineRoot = path.join(root, 'baseline')
  // Normaler Save legt die JSON-Baseline an (Startbestand aus der Legacy-TXT).
  saveBatch(mod, [{ entryId: entryId('Farewell'), translation: 'Tschüss' }], 'DE', backupRoot, baselineRoot)

  // Zusätzlich eine Alt-Baseline der Legacy-TXT-Zieldatei in denselben (mit
  // Sprach-Suffix versehenen) Ordner legen, als wäre sie mit dieser Version
  // schon vor dem JSON-Only-Umbau gesichert worden.
  const bdir = path.join(baselineRoot, backupName(mod.id, '1.0', file, 'DE'))
  fs.writeFileSync(path.join(bdir, 'Sandbox_DE.txt'), 'Sandbox_DE = {\n\tGreeting = "Ursprünglich"\n}\n', 'utf8')

  const changed = restoreBaseline(mod, '1.0', file, 'DE', backupRoot, baselineRoot, 'dedupe-stamp')
  // JSON (Greeting+Farewell gegen absent) + TXT (Greeting gegen "Ursprünglich") = 3
  assert.equal(changed, 3)

  const pointDir = path.join(backupRoot, 'dedupe-stamp')
  const meta = readMeta(pointDir)
  assert.equal(meta.files.length, 2, 'beide Zieldateien bekommen einen eigenen Backup-Eintrag statt sich zu verdrängen')
  const targets = meta.files.map((f) => f.targetPath).sort()
  assert.ok(targets.some((t) => t.endsWith('Sandbox.json')))
  assert.ok(targets.some((t) => t.endsWith('Sandbox_DE.txt')))
})
