// Speichern/Zurücksetzen von Übersetzungs-Einträgen + Backup.
//
// Game- und Workshop-Ordner werden NIE beschrieben (s. guard.js). Ein Eintrag
// landet im Arbeitsordner der App (export/work/, Layout s. scanner.workLangDir):
//   EN-Quelle: <versionDir>/media/lua/shared/Translate/EN/<Kategorie>.json|<Name>_EN.txt  (nur gelesen)
//   Arbeit:    <workRoot>/<modId>/<version>/media/lua/shared/Translate/<LANG>/<Kategorie>.json
// Die Arbeitsdatei ist der komplette Stand der Zieldatei: beim ersten Speichern
// wird sie aus der Übersetzung im Spiel/Workshop gesät (readTargetMap, inkl. der
// alten <Kategorie>_<LANG>.txt), danach überlagert sie diese vollständig. Der
// Mod-Export (mod-export.js) liest den Arbeitsstand. Ziel ist eine flache key →
// string-Map; bestehende Keys bleiben erhalten (nur der neue Key wird
// gesetzt/gelöscht).
//
// Reset (resetToGame): löscht die Arbeitsdatei — danach gilt wieder der Stand
// im Spiel/Workshop.
//
// Backup: Vor jedem Überschreiben/Löschen einer Arbeitsdatei wird die alte Datei
// kopiert nach
// export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>__<LANG>/<Zieldateiname>.
// Ein Ordner pro Speicher-Batch (= Speicherpunkt, mit meta.json, s. backupFile),
// Backups werden nie automatisch gelöscht. Zurückspielen: server/backups.js.
const fs = require('node:fs')
const path = require('node:path')
const {
  versionDirOf,
  toPosix,
  readFlatMap,
  targetFileName,
  readTargetMap,
  translateDir,
  workLangDir
} = require('./scanner')
const { assertWritable } = require('./guard')

// <modId>__<version>__<file>__<LANG> — Slashes und Sonderzeichen im Namen
// abtragen. lang macht Backup-Ordner sprachspezifisch, damit zwei
// Zielsprachen, die dieselbe Quelldatei betreffen, sich nicht gegenseitig
// überschreiben/verwechseln.
function backupName(modId, version, file, lang) {
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  return `${clean(modId)}__${clean(version)}__${clean(file)}__${clean(lang)}`
}

// Speicherpunkt-Ordner: minutengenau, damit ein Klick auf "Save" (der Editor
// speichert Mod für Mod nacheinander) EIN Speicherpunkt bleibt. `withSeconds`
// nur für die eigenen Punkte von Restore und Reset (backups.freshStamp).
function timestampDir(withSeconds = false) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
  return withSeconds ? `${base}-${p(d.getSeconds())}` : base
}

// Metadaten eines Speicherpunkts: export/backups/<stamp>/meta.json.
// Grundlage für "Restore Backup" in Settings — der Ordnername eines Datei-Backups
// verstümmelt modId/Pfad (s. backupName), deshalb steht hier je Datei der
// EXAKTE Zielpfad (immer eine Arbeitsdatei).
//   { version: 1, createdAt, updatedAt, kinds: ["save"|"reset"|"restore"],
//     files: [{ dir, fileName, targetPath, modId, modName, version, file,
//               lang, absent }] }
// absent: true = die Datei gab es vor diesem Punkt noch nicht; ein Restore
// löscht sie dann, statt etwas zurückzukopieren.
const META_FILE = 'meta.json'

function readMeta(pointDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pointDir, META_FILE), 'utf8'))
  } catch {
    return null
  }
}

// Eine Datei in den Speicherpunkt `stamp` sichern und in meta.json vermerken.
// Erste Sicherung gewinnt: wird dieselbe Datei in derselben Minute erneut
// gespeichert, bleibt der Stand VOR dem ersten Speichern stehen — sonst würde
// der Punkt den Zwischenstand halten und ein Restore nicht mehr den Zustand
// von vor dem Speichern zurückbringen.
function backupFile(backupRoot, stamp, kind, { modId, modName, version, file, lang, tgtPath, tgtFileName }) {
  const pointDir = path.join(backupRoot, stamp)
  const dir = backupName(modId, version, file, lang)
  const now = new Date().toISOString()
  try {
    fs.mkdirSync(pointDir, { recursive: true })
    const meta = readMeta(pointDir) || { version: 1, createdAt: now, updatedAt: now, kinds: [], files: [] }
    if (!meta.kinds.includes(kind)) meta.kinds.push(kind)
    meta.updatedAt = now
    // Dedupe über den exakten Zielpfad, nicht den Ordnernamen.
    const tgtPathPosix = toPosix(tgtPath)
    if (!meta.files.some((f) => f.targetPath === tgtPathPosix)) {
      const absent = !fs.existsSync(tgtPath)
      if (!absent) {
        fs.mkdirSync(path.join(pointDir, dir), { recursive: true })
        fs.copyFileSync(tgtPath, path.join(pointDir, dir, tgtFileName))
      }
      meta.files.push({
        dir,
        fileName: tgtFileName,
        targetPath: tgtPathPosix,
        modId,
        modName,
        version,
        file,
        lang,
        absent
      })
    }
    fs.writeFileSync(path.join(pointDir, META_FILE), JSON.stringify(meta, null, 2) + '\n', 'utf8')
  } catch (e) {
    throw safeWriteError(e, pointDir)
  }
}

function writeJson(filePath, obj) {
  assertWritable(filePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}

// fs-Fehler in eine menschenlesbare Nachricht übersetzen.
// Der Error wird (über .message) nicht ersetzt — Status bleibt erhalten.
// Idempotent: wer zuerst klassifiziert (saveBatch kennt den exakten
// Zielpfad), liefert die präzisere Meldung — der spätere Aufruf in der
// Route (nur Mod-Root bekannt) übersteuert nicht mehr.
function classifyFsError(err, filePath) {
  if (err._classified) return err
  err._classified = true
  const p = toPosix(filePath)
  const causes = []
  for (let e = err; e; e = e.cause) {
    if (e.code) causes.push(e.code)
  }
  if (causes.includes('EPERM') || causes.includes('EACCES')) {
    err.message = `Target folder not writable: ${p}. Missing write permission (path is read-only). Check permissions and try again.`
    if (!err.status) err.status = 403
  } else if (causes.includes('ENOENT')) {
    err.message = `Folder not found: ${p}. The path no longer exists.`
    if (!err.status) err.status = 404
  } else if (causes.includes('ENOTDIR')) {
    err.message = `Unexpected directory layout: ${p}`
    if (!err.status) err.status = 500
  }
  return err
}

function safeWriteError(err, filePath) {
  if (!err.code) return err
  return classifyFsError(err, filePath)
}

// Anzahl Keys, in denen sich zwei flache Maps unterscheiden (fürs Reporting).
function diffCount(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let n = 0
  for (const k of keys) if (a[k] !== b[k]) n++
  return n
}

// Übersetzungsdatei im Spiel/Workshop (nur lesen): dort liegt der Stand, auf
// den ein Reset zurückfällt.
function gameLangDirOf(mod, version, targetLang) {
  return translateDir(versionDirOf(mod, version), targetLang)
}

// Eine Arbeitsdatei auf den Stand im Spiel/Workshop zurücksetzen (= löschen).
// Gibt es keine Arbeitsdatei, ist nichts zu tun. Rückgabe: Anzahl der Keys, in
// denen die Arbeitsdatei vom Stand im Spiel abwich (0 = keine Änderung; dann
// wird nichts gesichert, ein überflüssiger Rest wird still entfernt).
// `stamp`: der Speicherpunkt, in den die Sicherung geht. Die Reset-Route gibt
// einen eigenen, frischen Punkt für den ganzen Reset vor (backups.freshStamp) —
// so lässt sich genau der Reset rückgängig machen.
function resetToGame(mod, version, file, targetLang, backupRoot, workRoot, stamp = timestampDir()) {
  const srcBase = path.basename(file)
  const tgtFileName = targetFileName(srcBase, targetLang)
  const tgtPath = path.join(workLangDir(workRoot, mod, version, targetLang), tgtFileName)
  if (!fs.existsSync(tgtPath)) return 0

  const work = readFlatMap(tgtPath) || {}
  const game = readTargetMap(gameLangDirOf(mod, version, targetLang), srcBase, targetLang) || {}
  const changed = diffCount(work, game)
  try {
    if (changed > 0) {
      backupFile(backupRoot, stamp, 'reset', {
        modId: mod.id,
        modName: mod.name,
        version,
        file,
        lang: targetLang,
        tgtPath,
        tgtFileName
      })
    }
    assertWritable(tgtPath)
    fs.rmSync(tgtPath, { force: true })
  } catch (e) {
    throw safeWriteError(e, tgtPath)
  }
  return changed
}

// Ein Batch speichern: { entries: [{ entryId, translation }] }.
// entryId-Format: <version>/<file>::<key>, file relativ zum Version-Ordner
// (immer der EN-Pfad). translation = "" löscht den Key (leere Übersetzung),
// null wird wie "" behandelt. Rückgabe: { saved: Zahl }.
// Fehler werden als { error: "Mensch lesbarer Text" } geworfen (HTTP 4xx/5xx).
function saveBatch(mod, entries, targetLang, backupRoot, workRoot) {
  if (!Array.isArray(entries)) throw Object.assign(new Error('entries missing'), { status: 400 })
  if (!workRoot) throw Object.assign(new Error('No work folder configured.'), { status: 500 })
  const byFile = new Map()
  for (const e of entries) {
    const sep = e.entryId.lastIndexOf('::')
    if (sep === -1) throw Object.assign(new Error(`Invalid entryId: ${e.entryId}`), { status: 400 })
    const key = e.entryId.slice(sep + 2)
    const before = e.entryId.slice(0, sep)
    // version ist das erste Segment (enthält kein "/"), file den Rest:
    // "42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key"
    const slash = before.indexOf('/')
    if (slash === -1) throw Object.assign(new Error(`Invalid entryId: ${e.entryId}`), { status: 400 })
    const version = before.slice(0, slash)
    const file = before.slice(slash + 1)
    const translation = e.translation === null ? '' : String(e.translation)
    // Version+Datei als Schlüssel: dieselbe Dateinamen-Kategorie kann unter
    // mehreren Layouts liegen (common/root/42.20) und gehört getrennt.
    const fileKey = `${version}/${file}`
    if (!byFile.has(fileKey)) byFile.set(fileKey, { version, file, items: [] })
    byFile.get(fileKey).items.push({ key, translation })
  }

  const stamp = timestampDir()
  let saved = 0
  for (const { version, file, items } of byFile.values()) {
    const vdir = versionDirOf(mod, version)
    const enPath = path.join(vdir, file)
    const srcBase = path.basename(file)
    // Zielpfad in der Arbeitsdatei: immer <Kategorie>.json (targetFileName, s.
    // scanner.js: B42 lädt nur noch JSON), auch für eine TXT-Quelle.
    const tgtFileName = targetFileName(srcBase, targetLang)
    const tgtPath = path.join(workLangDir(workRoot, mod, version, targetLang), tgtFileName)
    // EN-Datei muss existieren, sonst ist der Key erfunden (unmatched). Sie
    // wird nur gelesen, nie geschrieben.
    if (!fs.existsSync(enPath)) {
      throw Object.assign(new Error(`EN file not found: ${toPosix(enPath)}`), { status: 404 })
    }
    // Startbestand: die Arbeitsdatei, falls es sie schon gibt (tolerant gelesen:
    // Trailing Comma / Lua-Style-Keys); eine vorhandene, aber unlesbare Datei
    // bricht ab statt sie zu überschreiben. Sonst — erstes Speichern — der
    // Stand im Spiel/Workshop (inkl. altem TXT-Rückfall), damit dort vorhandene
    // Übersetzungen nicht verschwinden.
    let obj
    if (fs.existsSync(tgtPath)) {
      obj = readFlatMap(tgtPath)
      if (!obj) {
        throw Object.assign(new Error(`Work file is not readable: ${toPosix(tgtPath)}. Fix or remove it first.`), {
          status: 409
        })
      }
    } else {
      obj = readTargetMap(gameLangDirOf(mod, version, targetLang), srcBase, targetLang) || {}
    }
    backupFile(backupRoot, stamp, 'save', {
      modId: mod.id,
      modName: mod.name,
      version,
      file,
      lang: targetLang,
      tgtPath,
      tgtFileName
    })
    for (const { key, translation } of items) {
      if (translation === '') delete obj[key]
      else obj[key] = translation
      saved++
    }
    try {
      writeJson(tgtPath, obj)
    } catch (e) {
      throw safeWriteError(e, tgtPath)
    }
  }
  return { saved }
}

module.exports = {
  saveBatch,
  resetToGame,
  backupName,
  backupFile,
  readMeta,
  META_FILE,
  timestampDir,
  classifyFsError,
  safeWriteError
}
