// Lesen/Schreiben von Übersetzungs-Einträgen + Backup.
//
// Ein Eintrag schreibt die targetLang-Datei, die zu seiner EN-Datei gehört:
//   EN:  <versionDir>/media/lua/shared/Translate/EN/<Kategorie>.json
//   TGT: <versionDir>/media/lua/shared/Translate/<targetLang>/<Kategorie>.json
// Die Datei wird als flaches key → string-Map geschrieben, bestehende Keys
// bleiben erhalten (nur der neue Key wird gesetzt/gelöscht).
//
// Backup: Vor jedem Überschreiben einer targetLang-Datei wird die alte Datei
// kopiert nach export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>.
// Ein Ordner pro Speicher-Batch, Backups werden nie automatisch gelöscht.
const fs = require('node:fs')
const path = require('node:path')
const { versionDirOf, toPosix } = require('./scanner')

// <modId>__<version>__<file> — Slashes und Sonderzeichen im Namen abtragen.
function backupName(modId, version, file) {
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_')
  return `${clean(modId)}__${clean(version)}__${clean(file)}`
}

function timestampDir() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}

// Ein Batch speichern: { entries: [{ entryId, translation }] }.
// entryId-Format: <version>/<file>::<key>, file relativ zum Version-Ordner
// (immer der EN-Pfad). translation = "" löscht den Key (leere Übersetzung),
// null wird wie "" behandelt. Rückgabe: { saved: Zahl }.
// Fehler werden als { error: "Mensch lesbarer Text" } geworfen (HTTP 4xx/5xx).
function saveBatch(mod, entries, targetLang, backupRoot) {
  if (!Array.isArray(entries)) throw Object.assign(new Error('entries fehlt'), { status: 400 })
  const byFile = new Map()
  for (const e of entries) {
    const sep = e.entryId.lastIndexOf('::')
    if (sep === -1) throw Object.assign(new Error(`Ungültige entryId: ${e.entryId}`), { status: 400 })
    const key = e.entryId.slice(sep + 2)
    const before = e.entryId.slice(0, sep)
    // version ist das erste Segment (enthält kein "/"), file den Rest:
    // "42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key"
    const slash = before.indexOf('/')
    if (slash === -1) throw Object.assign(new Error(`Ungültige entryId: ${e.entryId}`), { status: 400 })
    const version = before.slice(0, slash)
    const file = before.slice(slash + 1)
    const translation = e.translation === null ? '' : String(e.translation)
    if (!byFile.has(file)) byFile.set(file, { version, file, items: [] })
    byFile.get(file).items.push({ key, translation })
  }

  const stamp = timestampDir()
  let saved = 0
  for (const { version, file, items } of byFile.values()) {
    const vdir = versionDirOf(mod, version)
    const enPath = path.join(vdir, file)
    const tgtPath = path.join(vdir, 'media', 'lua', 'shared', 'Translate', targetLang, path.basename(file))
    // EN-Datei muss existieren, sonst ist der Key erfunden (unmatched).
    if (!fs.existsSync(enPath)) {
      throw Object.assign(new Error(`EN-Datei nicht gefunden: ${toPosix(enPath)}`), { status: 404 })
    }
    if (fs.existsSync(tgtPath)) {
      const bdir = path.join(backupRoot, stamp, backupName(mod.id, version, file))
      fs.mkdirSync(bdir, { recursive: true })
      fs.copyFileSync(tgtPath, path.join(bdir, path.basename(file)))
    }
    const obj = readJson(tgtPath) || {}
    for (const { key, translation } of items) {
      if (translation === '') delete obj[key]
      else obj[key] = translation
      saved++
    }
    writeJson(tgtPath, obj)
  }
  return { saved }
}

module.exports = { saveBatch, backupName, timestampDir }
