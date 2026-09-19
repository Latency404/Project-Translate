// Speicherpunkte auflisten und zurückspielen ("Restore Backup" in Settings).
//
// Ein Speicherpunkt ist ein Ordner unter export/backups/ (s. entries.js):
// <YYYY-MM-DD_HH-mm> für Speichern, <YYYY-MM-DD_HH-mm-ss> für die eigenen
// Punkte von Reset und Restore (ggf. mit Zähler _N, s. freshStamp). Seine
// meta.json hält je Datei den exakten Zielpfad und ob es die Datei vorher gab.
//
// Ordner ohne meta.json ("Alt-Punkte") stammen aus der Zeit vor dieser
// Funktion. Ihr Zielpfad wird rekonstruiert (s. legacyMeta): Mod, Version und
// Quelldatei stehen im Ordnernamen, der Zieldateiname ist die gesicherte Datei
// selbst. Die Mod-ID ist dort verstümmelt ("/" → "_") und wird deshalb gegen
// die gescannten Mods abgeglichen — ohne Scan sind Alt-Punkte nicht
// zurückzuspielen. Die Sprache: Alt-Punkte stammen aus der Zeit mit genau
// EINER Zielsprache; TXT-Dateien tragen sie im Namen (Sandbox_DE.txt), für
// JSON-Dateien (Name ohne Sprache) gilt die Sprache, die die TXT-Dateien
// desselben Punkts bzw. aller Alt-Punkte eindeutig belegen. Ist sie nicht
// eindeutig, bleibt die Datei ausgelassen statt geraten.
// Alt-Punkte kennen keine "absent"-Vermerke: Dateien, die ein damaliges
// Speichern neu angelegt hat, bleiben beim Zurückspielen stehen.
// Weil vor jedem Restore der aktuelle Stand gesichert wird, bleibt auch das
// Zurückspielen eines Alt-Punkts rückgängig zu machen.
const fs = require('node:fs')
const path = require('node:path')
const { backupFile, readMeta, timestampDir, safeWriteError } = require('./entries')
const { versionDirOf, toPosix } = require('./scanner')
const { isKnownLang, TARGET_LANGS } = require('./langs')

// Optionaler Zähler _N: falls in derselben Sekunde schon ein Punkt liegt
// (s. freshStamp).
const ID_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?:-(\d{2}))?(?:_(\d+))?$/

// Ordnername → Zeitpunkt (lokale Zeit, so wie timestampDir() ihn schreibt).
function dateOfId(id) {
  const m = ID_RE.exec(id)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return new Date(+y, +mo - 1, +d, +h, +mi, s ? +s : 0)
}

function uniqueSorted(list) {
  return [...new Set(list.filter(Boolean))].sort()
}

function pointIds(backupRoot) {
  try {
    return fs
      .readdirSync(backupRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID_RE.test(d.name))
      .map((d) => d.name)
  } catch {
    return []
  }
}

// --- Alt-Punkte ohne meta.json ---

// Wie backupName() in entries.js: so wurde die modId im Ordnernamen abgetragen.
const cleanId = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
const EN_PREFIX = 'media_lua_shared_Translate_EN_'
// Längste Codes zuerst, damit "IG_UI_ES_CL.txt" ES_CL ergibt und nicht CL.
const LANGS_LONGEST_FIRST = [...TARGET_LANGS].sort((a, b) => b.length - a.length)

function langOfTxt(fileName) {
  const upper = fileName.toUpperCase()
  if (!upper.endsWith('.TXT')) return null
  return LANGS_LONGEST_FIRST.find((l) => upper.endsWith(`_${l}.TXT`)) || null
}

// Rohdaten eines Alt-Punkts: je Unterordner Mod (verstümmelt), Version,
// Quelldatei, gesicherte Datei und — falls ablesbar — die Sprache.
function legacyRaw(pointDir) {
  let subs
  try {
    subs = fs.readdirSync(pointDir, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return []
  }
  const out = []
  for (const d of subs) {
    const parts = d.name.split('__')
    if (parts.length < 3) continue
    // Ordner aus der Zeit nach der Mehrsprachigkeit tragen die Sprache hinten.
    let lang = parts.length >= 4 && isKnownLang(parts[parts.length - 1]) ? parts.pop() : null
    const cleanFile = parts.pop()
    const version = parts.pop()
    const cleanModId = parts.join('__')
    let inner
    try {
      inner = fs.readdirSync(path.join(pointDir, d.name))
    } catch {
      continue
    }
    if (inner.length !== 1) continue
    const fileName = inner[0]
    if (!lang) lang = langOfTxt(fileName)
    const file = cleanFile.startsWith(EN_PREFIX)
      ? `media/lua/shared/Translate/EN/${cleanFile.slice(EN_PREFIX.length)}`
      : cleanFile
    out.push({ dir: d.name, fileName, cleanModId, version, file, lang })
  }
  return out
}

// Genau eine Sprache belegt? Dann die, sonst null.
function singleLang(raws) {
  const langs = new Set(raws.map((r) => r.lang).filter(Boolean))
  return langs.size === 1 ? [...langs][0] : null
}

// Sprache, die ALLE Alt-Punkte zusammen eindeutig belegen — Rückfall für
// Punkte, die nur JSON-Dateien enthalten.
function globalLegacyLang(backupRoot, ids) {
  const all = []
  for (const id of ids) {
    const pointDir = path.join(backupRoot, id)
    if (!readMeta(pointDir)) all.push(...legacyRaw(pointDir))
  }
  return singleLang(all)
}

// Alt-Punkt → dieselbe Form wie meta.json (files[]), soweit sicher zuordenbar.
// `total` = alle gesicherten Dateien, `files` = die davon zuordenbaren.
function legacyMeta(pointDir, mods, globalLang) {
  const raws = legacyRaw(pointDir)
  const byClean = new Map()
  for (const m of mods) {
    const key = cleanId(m.id)
    byClean.set(key, byClean.has(key) ? null : m) // null = mehrdeutig, auslassen
  }
  const pointLang = singleLang(raws) || globalLang
  const files = []
  for (const r of raws) {
    const mod = byClean.get(r.cleanModId)
    const lang = r.lang || pointLang
    if (!mod || !lang) continue
    const tgtPath = path.join(versionDirOf(mod, r.version), 'media', 'lua', 'shared', 'Translate', lang, r.fileName)
    files.push({
      dir: r.dir,
      fileName: r.fileName,
      targetPath: toPosix(tgtPath),
      modId: mod.id,
      modName: mod.name,
      version: r.version,
      file: r.file,
      lang,
      absent: false
    })
  }
  return { files, total: raws.length }
}

// --- Liste ---

// Neueste zuerst. Liefert je Punkt nur, was die Auswahl-Liste braucht.
// `mods`: die gescannten Mods (für Alt-Punkte, s. legacyMeta).
function listBackups(backupRoot, mods = []) {
  const ids = pointIds(backupRoot)
  const globalLang = globalLegacyLang(backupRoot, ids)
  const out = ids.map((id) => {
    const pointDir = path.join(backupRoot, id)
    const meta = readMeta(pointDir)
    const legacy = !(meta && Array.isArray(meta.files))
    const files = legacy ? legacyMeta(pointDir, mods, globalLang).files : meta.files
    const byMod = new Map()
    for (const f of files) if (!byMod.has(f.modId)) byMod.set(f.modId, f.modName || f.modId)
    return {
      id,
      createdAt: (!legacy && meta.createdAt) || dateOfId(id).toISOString(),
      kinds: !legacy && Array.isArray(meta.kinds) ? meta.kinds : [],
      fileCount: files.length,
      mods: [...byMod].map(([modId, name]) => ({ modId, name })),
      langs: uniqueSorted(files.map((f) => f.lang)),
      restorable: files.length > 0,
      legacy
    }
  })
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return out
}

// --- Zurückspielen ---

// Eigener, NEUER Punkt für einen Restore oder Reset (sekundengenau, bei
// Kollision mit Zähler _N). Ein bereits bestehender Ordner (Speichern in
// derselben Minute, zweiter Restore in derselben Sekunde, oder genau der
// Punkt, der gerade zurückgespielt wird) würde über "erste Sicherung gewinnt"
// den aktuellen Stand stillschweigend NICHT sichern.
function freshStamp(backupRoot) {
  const base = timestampDir(true)
  let stamp = base
  for (let n = 2; fs.existsSync(path.join(backupRoot, stamp)); n++) stamp = `${base}_${n}`
  return stamp
}

function sameContent(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b))
  } catch {
    return false
  }
}

// Punkt `id` zurückspielen: jede Datei bekommt den Stand von VOR diesem Punkt
// zurück (bzw. wird gelöscht, wenn es sie vorher nicht gab). Vorher wird der
// aktuelle Stand jeder betroffenen Datei als eigener Punkt ("restore")
// gesichert — auch ein Restore bleibt damit rückgängig machbar.
// Dateien, die schon dem Ziel entsprechen, bleiben unberührt; Dateien, deren
// Mod-Ordner es nicht mehr gibt (oder die ein Alt-Punkt nicht zuordnen kann),
// werden übersprungen statt neu angelegt.
// → { restored, skipped, safetyBackupId }  (safetyBackupId null, wenn nichts
//   zu ändern war)
function restoreBackup(backupRoot, id, mods = []) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw Object.assign(new Error('Invalid backup id.'), { status: 400 })
  }
  const pointDir = path.join(backupRoot, id)
  if (!fs.existsSync(pointDir)) {
    throw Object.assign(new Error('Backup not found.'), { status: 404 })
  }
  let files
  let skipped = 0
  const meta = readMeta(pointDir)
  if (meta && Array.isArray(meta.files)) {
    files = meta.files
  } else {
    const legacy = legacyMeta(pointDir, mods, globalLegacyLang(backupRoot, pointIds(backupRoot)))
    if (!legacy.files.length) {
      throw Object.assign(
        new Error(
          mods.length
            ? 'This older backup does not match any scanned mod.'
            : 'Search for mods first to restore this older backup.'
        ),
        { status: 409 }
      )
    }
    files = legacy.files
    skipped = legacy.total - legacy.files.length
  }

  const safetyStamp = freshStamp(backupRoot)
  let restored = 0
  let safetyUsed = false
  for (const f of files) {
    const tgtPath = f.targetPath
    const sourcePath = path.join(pointDir, f.dir, f.fileName)
    const exists = fs.existsSync(tgtPath)
    // Schon am Ziel: nichts zu tun, auch keine Sicherung.
    if (f.absent ? !exists : exists && sameContent(sourcePath, tgtPath)) continue
    // Mod-Ordner weg (Mod deinstalliert/verschoben): nicht neu anlegen.
    const translateRoot = path.dirname(path.dirname(tgtPath))
    if (!f.absent && (!fs.existsSync(translateRoot) || !fs.existsSync(sourcePath))) {
      skipped++
      continue
    }

    backupFile(backupRoot, safetyStamp, 'restore', {
      modId: f.modId,
      modName: f.modName,
      version: f.version,
      file: f.file,
      lang: f.lang,
      tgtPath,
      tgtFileName: f.fileName
    })
    safetyUsed = true

    try {
      if (f.absent) {
        fs.rmSync(tgtPath, { force: true })
      } else {
        fs.mkdirSync(path.dirname(tgtPath), { recursive: true })
        fs.copyFileSync(sourcePath, tgtPath)
      }
    } catch (e) {
      throw safeWriteError(e, tgtPath)
    }
    restored++
  }
  return { restored, skipped, safetyBackupId: safetyUsed ? safetyStamp : null }
}

module.exports = { listBackups, restoreBackup, freshStamp }
