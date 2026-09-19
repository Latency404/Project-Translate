// Lesen/Schreiben von Übersetzungs-Einträgen + Backup.
//
// B42 lädt Übersetzungen AUSSCHLIESSLICH aus <LANG>/<Kategorie>.json (s.
// scanner.js) — ein Eintrag schreibt deshalb IMMER die JSON-Zieldatei, egal ob
// seine EN-Quelle JSON oder (B41-Altlast) TXT ist:
//   EN-Quelle: <versionDir>/media/lua/shared/Translate/EN/<Kategorie>.json|<Name>_EN.txt
//   TGT:       <versionDir>/media/lua/shared/Translate/<targetLang>/<Kategorie>.json
// Existiert noch keine JSON-Zieldatei, wird der Startbestand aus der alten
// <Kategorie>_<LANG>.txt gelesen, falls die (Rückfall) existiert (readTargetMap
// in scanner.js) — sonst gingen Übersetzungen, die bisher nur über den
// TXT-Rückfall sichtbar waren, beim ersten Speichern verloren. TXT-Zieldateien
// werden von der App nicht mehr geschrieben. Ziel ist eine flache key →
// string-Map; bestehende Keys bleiben erhalten (nur der neue Key wird
// gesetzt/gelöscht).
//
// Backup: Vor jedem Überschreiben einer targetLang-Datei wird die alte Datei
// kopiert nach
// export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>__<LANG>/<Zieldateiname>.
// Ein Ordner pro Speicher-Batch (= Speicherpunkt, mit meta.json, s. backupFile),
// Backups werden nie automatisch gelöscht. Zurückspielen: server/backups.js.
// Ein Speicherpunkt kann für dieselbe (modId/version/file/lang)-Kombination
// mehrere Zieldateien enthalten (z. B. Reset einer Alt-Baseline, die noch eine
// legacy-TXT-Datei UND die neue JSON-Datei betrifft) — dedupe erfolgt deshalb
// über den exakten Zielpfad, nicht über den Ordnernamen.
//
// Baseline (für "Reset Translations", Settings): der allererste App-
// Schreibzugriff auf eine targetLang-Datei sichert deren Zustand VOR diesem
// Schreiben nach export/baseline/<modId>__<version>__<file>__<LANG>/ —
// entweder als Kopie der Datei (unter ihrem Zieldateinamen), oder als leere
// Markerdatei "<Zieldateiname>.absent", falls die Datei noch gar nicht
// existierte. Eine Baseline wird PRO Zieldateiname im Ordner geführt (s.
// hasBaselineFor()): ein Ordner kann sowohl eine Alt-Baseline der früheren
// TXT-Zieldatei als auch — sobald erstmals mit dieser Version gespeichert wird
// — eine Baseline der neuen JSON-Zieldatei enthalten. Ein Reset stellt jeden
// dort erfassten Zielnamen wieder her (oder löscht ihn bei ".absent") statt
// einfach alles zu leeren — vorhandene Übersetzungen, die schon vor der
// App-Nutzung da waren, bleiben so erhalten. Einmal aufgenommen, wird eine
// Baseline nie überschrieben.
//
// Sprach-Suffix (Multi-Language-Umbau): der Ordnername war früher
// sprachunabhängig (<modId>__<version>__<file>) — sobald zwei Zielsprachen
// dieselbe Quelldatei betreffen, hätten sie sich sonst gegenseitig die
// Baseline überschrieben bzw. verwechselt. Neu geschriebene Baselines tragen
// deshalb IMMER das Sprach-Suffix. Beim Lesen einer Baseline gilt: gibt es
// den Ordner mit Suffix, zählt der; sonst, falls ein alter Ordner OHNE Suffix
// existiert (vor diesem Umbau angelegt), gilt der als Baseline der
// angefragten Sprache — so geht kein Alt-Bestand verloren
// (s. resolveBaselineDirForRead()). Alt-Baselines (vor dieser Funktion, s. o.)
// kennen nur einen nackten ".absent"-Marker statt eines dateinamen-genauen —
// der bezog sich auf den DAMALS einzigen Zielnamen (bei JSON-Quellen identisch
// mit dem heutigen, bei TXT-Quellen der alte <Kategorie>_<LANG>.txt-Name) und
// wird beim Lesen entsprechend zugeordnet (s. hasBaselineFor()).
const fs = require('node:fs')
const path = require('node:path')
const {
  versionDirOf,
  toPosix,
  readFlatMap,
  readTxtMap,
  targetFileName,
  legacyTargetFileName,
  readTargetMap
} = require('./scanner')

// <modId>__<version>__<file>__<LANG> — Slashes und Sonderzeichen im Namen
// abtragen. lang macht Backup-/Baseline-Ordner sprachspezifisch, damit zwei
// Zielsprachen, die dieselbe Quelldatei betreffen, sich nicht gegenseitig
// überschreiben/verwechseln.
function backupName(modId, version, file, lang) {
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  return `${clean(modId)}__${clean(version)}__${clean(file)}__${clean(lang)}`
}

// Alter, sprachunabhängiger Ordnername von vor dem Multi-Sprachen-Umbau —
// wird nur noch beim LESEN bestehender Baselines gebraucht (Migration),
// s. resolveBaselineDirForRead().
function legacyBackupName(modId, version, file) {
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  return `${clean(modId)}__${clean(version)}__${clean(file)}`
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
// Grundlage für "Restore Backup" in Settings — ohne sie wäre ein Punkt nicht
// sicher zurückzuspielen: der Ordnername eines Datei-Backups verstümmelt
// modId/Pfad (s. backupName) und kennt bei JSON-Dateien die Sprache nicht.
// Deshalb steht hier je Datei der EXAKTE Zielpfad.
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
    // Dedupe über den exakten Zielpfad, nicht den Ordnernamen: derselbe `dir`
    // (modId/version/file/lang) kann bei TXT-Quellen zwei Zieldateien treffen
    // (legacy TXT + neue JSON) — beide müssen im selben Speicherpunkt Platz
    // haben, sonst würde "erste Sicherung gewinnt" die zweite Datei verwerfen.
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
        targetPath: toPosix(tgtPath),
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}

// fs-Fehler in eine menschenlesbare, deutsche Nachricht übersetzen.
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
    err.message = `Folder not found: ${p}. The mod path no longer exists (mod removed or moved?).`
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

// Ziel-Ordnername für NEU geschriebene Baselines — immer mit Sprach-Suffix.
function baselineDirFor(baselineRoot, modId, version, file, lang) {
  return path.join(baselineRoot, backupName(modId, version, file, lang))
}

// Baseline-Ordner zum LESEN auflösen (Migration): existiert der Ordner mit
// Sprach-Suffix, gilt der. Sonst, falls der alte Ordner ohne Suffix (vor
// diesem Umbau angelegt) existiert, gilt er als Baseline der angefragten
// Sprache. Existiert keiner von beiden, wird trotzdem der neue (mit Suffix)
// Pfad zurückgegeben — der Aufrufer prüft selbst per existsSync, ob eine
// Baseline überhaupt vorliegt.
function resolveBaselineDirForRead(baselineRoot, modId, version, file, lang) {
  const withSuffix = baselineDirFor(baselineRoot, modId, version, file, lang)
  if (fs.existsSync(withSuffix)) return withSuffix
  const legacy = path.join(baselineRoot, legacyBackupName(modId, version, file))
  if (fs.existsSync(legacy)) return legacy
  return withSuffix
}

// Alter, sprachunabhängiger Zielname von vor diesem JSON-Only-Umbau: bei
// TXT-Quellen war das die <Kategorie>_<LANG>.txt, bei JSON-Quellen ist er
// identisch mit dem heutigen Namen. Ein nackter ".absent"-Marker (Alt-
// Baseline, s. hasBaselineFor()) bezieht sich immer auf DIESEN Namen.
function oldTargetFileNameOf(srcFileName, lang) {
  return legacyTargetFileName(srcFileName, lang) || targetFileName(srcFileName, lang)
}

// Ob in `bdir` bereits eine Baseline für genau die Zieldatei `tgtFileName`
// aufgenommen ist: eine Kopie `bdir/<tgtFileName>`, ein dateinamen-genauer
// Marker `bdir/<tgtFileName>.absent`, oder — Alt-Baselines von vor der
// Aufteilung je Zieldateiname — ein nackter `bdir/.absent`, sofern
// `tgtFileName` der damals einzige Zielname war (oldTgtFileName).
function hasBaselineFor(bdir, tgtFileName, oldTgtFileName) {
  if (fs.existsSync(path.join(bdir, tgtFileName))) return true
  if (fs.existsSync(path.join(bdir, `${tgtFileName}.absent`))) return true
  return tgtFileName === oldTgtFileName && fs.existsSync(path.join(bdir, '.absent'))
}

// Einmalig (idempotent) den Vor-App-Zustand EINER Zieldatei sichern — wird vor
// jedem Überschreiben in saveBatch aufgerufen; eine bereits vorhandene
// Baseline für genau diesen Zieldateinamen (s. hasBaselineFor) bleibt
// unberührt. Der Ordner selbst folgt der Migrationsregel (neu mit
// Sprach-Suffix, alt ohne, s. resolveBaselineDirForRead) — ein bestehender
// Alt-Ordner (z. B. mit einer Baseline der früheren TXT-Zieldatei) bekommt den
// neuen JSON-Zielnamen einfach hinzugefügt, statt einen zweiten Ordner
// anzulegen.
function ensureBaseline(baselineRoot, modId, version, file, tgtPath, tgtFileName, lang) {
  const bdir = resolveBaselineDirForRead(baselineRoot, modId, version, file, lang)
  const oldTgtFileName = oldTargetFileNameOf(path.basename(file), lang)
  if (hasBaselineFor(bdir, tgtFileName, oldTgtFileName)) return
  fs.mkdirSync(bdir, { recursive: true })
  if (fs.existsSync(tgtPath)) {
    fs.copyFileSync(tgtPath, path.join(bdir, tgtFileName))
  } else {
    fs.writeFileSync(path.join(bdir, `${tgtFileName}.absent`), '')
  }
}

// Anzahl Keys, in denen sich zwei flache Maps unterscheiden (fürs Reporting).
function diffCount(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let n = 0
  for (const k of keys) if (a[k] !== b[k]) n++
  return n
}

// Eine targetLang-Datei auf ihre Baseline(n) zurücksetzen (s. Kommentar oben).
// Kein Baseline-Ordner vorhanden → die App hat diese Datei nie geschrieben,
// es gibt nichts zurückzusetzen (sie ist bereits im Originalzustand). Sonst
// wird JEDER in diesem Ordner erfasste Zielname geprüft: der aktuelle
// JSON-Zielname (den saveBatch schreibt) und — nur bei TXT-Quellen, als
// Rückfall auf Alt-Baselines von vor diesem Umbau — der frühere
// <Kategorie>_<LANG>.txt-Name; die App selbst schreibt diesen nicht mehr
// (s. saveBatch), ein Reset muss eine dort noch vorhandene Alt-Baseline aber
// weiter zurückspielen können. Rückgabe: Anzahl der tatsächlich geänderten
// Keys, summiert über alle betroffenen Zieldateien (0 = keine Änderung nötig,
// dann wird auch nicht geschrieben/gesichert).
// `stamp`: der Speicherpunkt, in den die Sicherung geht. Die Reset-Route gibt
// einen eigenen, frischen Punkt für den ganzen Reset vor (backups.freshStamp) —
// so lässt sich genau der Reset rückgängig machen, ohne ein Speichern aus
// derselben Minute mitzunehmen.
function restoreBaseline(mod, version, file, targetLang, backupRoot, baselineRoot, stamp = timestampDir()) {
  const vdir = versionDirOf(mod, version)
  const tDir = path.join(vdir, 'media', 'lua', 'shared', 'Translate', targetLang)
  const srcBase = path.basename(file)
  const tgtFileName = targetFileName(srcBase, targetLang)
  const bdir = resolveBaselineDirForRead(baselineRoot, mod.id, version, file, targetLang)
  if (!fs.existsSync(bdir)) return 0

  const legacyName = legacyTargetFileName(srcBase, targetLang) // null bei JSON-Quellen
  const oldTgtFileName = legacyName || tgtFileName
  // Kandidaten in diesem Ordner: der aktuelle JSON-Zielname, dazu bei
  // TXT-Quellen zusätzlich der alte TXT-Zielname (nur relevant, wenn eine
  // Alt-Baseline ihn noch führt).
  const candidates = [{ name: tgtFileName, tPath: path.join(tDir, tgtFileName), isTxt: false }]
  if (legacyName && legacyName !== tgtFileName) {
    candidates.push({ name: legacyName, tPath: path.join(tDir, legacyName), isTxt: true })
  }

  const actions = []
  let changed = 0
  for (const c of candidates) {
    const copyPath = path.join(bdir, c.name)
    const hasCopy = fs.existsSync(copyPath)
    if (!hasBaselineFor(bdir, c.name, oldTgtFileName)) continue // kein Eintrag für dieses Ziel

    const wasAbsent = !hasCopy
    const current = (c.isTxt ? readTxtMap(c.tPath) : readFlatMap(c.tPath)) || {}
    const baseline = wasAbsent ? {} : (c.isTxt ? readTxtMap(copyPath) : readFlatMap(copyPath)) || {}
    const n = diffCount(current, baseline)
    if (n === 0) continue
    changed += n
    actions.push({ ...c, wasAbsent, copyPath })
  }

  if (changed === 0) return 0

  for (const { tPath, name, isTxt, wasAbsent, copyPath } of actions) {
    backupFile(backupRoot, stamp, 'reset', {
      modId: mod.id,
      modName: mod.name,
      version,
      file,
      lang: targetLang,
      tgtPath: tPath,
      tgtFileName: name
    })
    try {
      if (wasAbsent) {
        fs.rmSync(tPath, { force: true })
      } else if (isTxt) {
        // Alt-Baseline byte-für-byte zurückkopieren — kein Reparse/Rewrite
        // mehr nötig, die App schreibt dieses Format nicht mehr.
        fs.mkdirSync(path.dirname(tPath), { recursive: true })
        fs.copyFileSync(copyPath, tPath)
      } else {
        writeJson(tPath, readFlatMap(copyPath) || {})
      }
    } catch (e) {
      throw safeWriteError(e, tPath)
    }
  }
  return changed
}

// Ein Batch speichern: { entries: [{ entryId, translation }] }.
// entryId-Format: <version>/<file>::<key>, file relativ zum Version-Ordner
// (immer der EN-Pfad). translation = "" löscht den Key (leere Übersetzung),
// null wird wie "" behandelt. Rückgabe: { saved: Zahl }.
// Fehler werden als { error: "Mensch lesbarer Text" } geworfen (HTTP 4xx/5xx).
function saveBatch(mod, entries, targetLang, backupRoot, baselineRoot) {
  if (!Array.isArray(entries)) throw Object.assign(new Error('entries missing'), { status: 400 })
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
    // Zielpfad: Translate/<targetLang>/<Kategorie>.json — IMMER JSON, auch für
    // eine TXT-Quelle (targetFileName, s. scanner.js: B42 lädt nur noch JSON).
    // Nur der Basisname — der EN-Pfad liegt ja schon unter Translate/EN/.
    const tgtFileName = targetFileName(srcBase, targetLang)
    const tgtDir = path.join(vdir, 'media', 'lua', 'shared', 'Translate', targetLang)
    const tgtPath = path.join(tgtDir, tgtFileName)
    // EN-Datei muss existieren, sonst ist der Key erfunden (unmatched). Bei
    // einer TXT-Quelle bleibt das die TXT-Datei selbst — sie wird nie
    // angefasst, auch nicht wenn daneben inzwischen eine <Kategorie>.json
    // liegt (z. B. weil Zielsprache EN schon einmal gespeichert wurde).
    if (!fs.existsSync(enPath)) {
      throw Object.assign(new Error(`EN file not found: ${toPosix(enPath)}`), { status: 404 })
    }
    // Baseline VOR dieser Änderung sichern (No-op ab dem zweiten Schreiben).
    if (baselineRoot) {
      try {
        ensureBaseline(baselineRoot, mod.id, version, file, tgtPath, tgtFileName, targetLang)
      } catch (e) {
        throw safeWriteError(e, path.join(baselineRoot, backupName(mod.id, version, file, targetLang)))
      }
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
    // Startbestand: die JSON-Zieldatei, falls sie schon existiert (tolerant:
    // Trailing Comma / Lua-Style-Keys — eine handgeschriebene Zieldatei wird
    // beim Speichern nicht plattgemacht); sonst, beim allerersten Speichern
    // über einer TXT-Quelle, die alte <Kategorie>_<LANG>.txt als Startbestand
    // (readTargetMap-Rückfall) — sonst verschwänden Übersetzungen, die vorher
    // nur über den TXT-Rückfall sichtbar waren.
    const existing = readTargetMap(tgtDir, srcBase, targetLang)
    const obj = existing || {}
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
  restoreBaseline,
  backupName,
  backupFile,
  readMeta,
  META_FILE,
  timestampDir,
  classifyFsError,
  safeWriteError
}
