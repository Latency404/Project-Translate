// Speicherpunkte auflisten und zurückspielen ("Restore Backup" in Settings).
//
// Ein Speicherpunkt ist ein Ordner unter export/backups/ (s. entries.js):
// <YYYY-MM-DD_HH-mm> für Speichern, <YYYY-MM-DD_HH-mm-ss> für die eigenen
// Punkte von Reset und Restore (ggf. mit Zähler _N, s. freshStamp). Seine
// meta.json hält je Datei den exakten Zielpfad und ob es die Datei vorher gab.
//
// Zurückgespielt wird NUR in den Arbeitsordner (export/work/). Ein Punkt aus
// der Zeit, in der die App noch in Spiel/Workshop schrieb (kein meta.json, oder
// Zielpfade außerhalb des Arbeitsordners), bleibt auf der Platte, ist aber nicht
// wiederherstellbar — die App schreibt dort nicht mehr.
const fs = require('node:fs')
const path = require('node:path')
const { backupFile, readMeta, timestampDir, safeWriteError } = require('./entries')
const { assertWritable, isInside } = require('./guard')

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

// --- Liste ---

// Dateien eines Punkts, die zurückspielbar sind: nur Zielpfade INNERHALB des
// Arbeitsordners (s. Kopfkommentar). Ohne Arbeitsordner: keine.
function usableFiles(meta, workRoot) {
  if (!workRoot || !meta || !Array.isArray(meta.files)) return []
  return meta.files.filter((f) => typeof f.targetPath === 'string' && isInside(workRoot, f.targetPath))
}

// Neueste zuerst. Liefert je Punkt nur, was die Auswahl-Liste braucht.
function listBackups(backupRoot, workRoot) {
  const out = pointIds(backupRoot).map((id) => {
    const meta = readMeta(path.join(backupRoot, id))
    const hasMeta = !!(meta && Array.isArray(meta.files))
    const files = usableFiles(meta, workRoot)
    const byMod = new Map()
    for (const f of files) if (!byMod.has(f.modId)) byMod.set(f.modId, f.modName || f.modId)
    return {
      id,
      createdAt: (hasMeta && meta.createdAt) || dateOfId(id).toISOString(),
      kinds: hasMeta && Array.isArray(meta.kinds) ? meta.kinds : [],
      fileCount: files.length,
      mods: [...byMod].map(([modId, name]) => ({ modId, name })),
      langs: uniqueSorted(files.map((f) => f.lang)),
      restorable: files.length > 0,
      legacy: files.length === 0
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

// Punkt `id` zurückspielen: jede Arbeitsdatei bekommt den Stand von VOR diesem
// Punkt zurück (bzw. wird gelöscht, wenn es sie vorher nicht gab). Vorher wird
// der aktuelle Stand jeder betroffenen Datei als eigener Punkt ("restore")
// gesichert — auch ein Restore bleibt damit rückgängig machbar.
// Dateien, die schon dem Ziel entsprechen, bleiben unberührt. Zielpfade
// außerhalb des Arbeitsordners (alte Punkte aus der Zeit, als die App in
// Spiel/Workshop schrieb) werden nie angefasst und als übersprungen gezählt.
// → { restored, skipped, safetyBackupId }  (safetyBackupId null, wenn nichts
//   zu ändern war)
function restoreBackup(backupRoot, id, workRoot) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw Object.assign(new Error('Invalid backup id.'), { status: 400 })
  }
  const pointDir = path.join(backupRoot, id)
  if (!fs.existsSync(pointDir)) {
    throw Object.assign(new Error('Backup not found.'), { status: 404 })
  }
  const meta = readMeta(pointDir)
  const files = usableFiles(meta, workRoot)
  if (!files.length) {
    throw Object.assign(
      new Error('This backup cannot be restored. It was made before translations moved to the work folder.'),
      { status: 409 }
    )
  }
  let skipped = meta.files.length - files.length

  const safetyStamp = freshStamp(backupRoot)
  let restored = 0
  let safetyUsed = false
  for (const f of files) {
    const tgtPath = f.targetPath
    const sourcePath = path.join(pointDir, f.dir, f.fileName)
    const exists = fs.existsSync(tgtPath)
    // Schon am Ziel: nichts zu tun, auch keine Sicherung.
    if (f.absent ? !exists : exists && sameContent(sourcePath, tgtPath)) continue
    if (!f.absent && !fs.existsSync(sourcePath)) {
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
      assertWritable(tgtPath)
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
