// Lesen/Schreiben von Übersetzungs-Einträgen + Backup.
//
// Ein Eintrag schreibt die targetLang-Datei, die zu seiner EN-Datei gehört:
//   EN-JSON: <versionDir>/media/lua/shared/Translate/EN/<Kategorie>.json
//     TGT:   <versionDir>/media/lua/shared/Translate/<targetLang>/<Kategorie>.json
//   EN-TXT:  <versionDir>/media/lua/shared/Translate/EN/<Name>_EN.txt
//     TGT:   <versionDir>/media/lua/shared/Translate/<targetLang>/<Name>_<TGT>.txt
//            (Name ohne _EN-Suffix; EN.txt ohne Suffix → Name_<TGT>.txt)
// Beide Formate sind flache key → string-Maps; bestehende Keys bleiben erhalten
// (nur der neue Key wird gesetzt/gelöscht).
//
// Backup: Vor jedem Überschreiben einer targetLang-Datei wird die alte Datei
// kopiert nach export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>.
// Ein Ordner pro Speicher-Batch, Backups werden nie automatisch gelöscht.
const fs = require('node:fs')
const path = require('node:path')
const { versionDirOf, toPosix, readFlatMap, readTxtMap, targetFileName } = require('./scanner')

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

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}

// Lua-Translate-Datei serialisieren: <TableName> = { Key = "Value", ... }
// Werte als Long-String [[ ... ]], außer sie enthalten ]] oder starten mit
// Whitespace (dann als quoted string mit Escapes). Schlüssel werden quoted,
// wenn sie nicht reiner Identifier sind.
function writeLua(filePath, tableName, obj) {
  const esc = (s) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  const lines = []
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') continue
    const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `"${esc(k)}"`
    let val
    if (v.includes(']]') || v.length === 0 || /^\s/.test(v)) {
      val = `"${esc(v)}"`
    } else {
      val = `[[${v}]]`
    }
    lines.push(`\t${key} = ${val},`)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const body = lines.length
    ? `${tableName} = {\n${lines.join('\n')}\n}\n`
    : `${tableName} = {}\n`
  fs.writeFileSync(filePath, body, 'utf8')
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
    // Zielpfad: Translate/<targetLang>/, Dateiname nach targetFileName()
    // (JSON: identisch, TXT: _EN → _<TGT>). Nur der Basisname — der EN-Pfad
    // liegt ja schon unter Translate/EN/.
    const tgtFileName = targetFileName(path.basename(file), targetLang)
    const tgtPath = path.join(vdir, 'media', 'lua', 'shared', 'Translate', targetLang, tgtFileName)
    // EN-Datei muss existieren, sonst ist der Key erfunden (unmatched).
    if (!fs.existsSync(enPath)) {
      throw Object.assign(new Error(`EN-Datei nicht gefunden: ${toPosix(enPath)}`), { status: 404 })
    }
    if (fs.existsSync(tgtPath)) {
      const bdir = path.join(backupRoot, stamp, backupName(mod.id, version, file))
      fs.mkdirSync(bdir, { recursive: true })
      fs.copyFileSync(tgtPath, path.join(bdir, tgtFileName))
    }
    // Tolerantes Einlesen (JSON: Trailing Comma / Lua-Keys, TXT: Lua-Translate)
    // — eine handgeschriebene targetLang-Datei wird beim Speichern nicht
    // plattgemacht.
    const isTxt = tgtFileName.toLowerCase().endsWith('.txt')
    const existing = isTxt ? readTxtMap(tgtPath) : readFlatMap(tgtPath)
    const obj = existing || {}
    for (const { key, translation } of items) {
      if (translation === '') delete obj[key]
      else obj[key] = translation
      saved++
    }
    if (isTxt) {
      // Lua-Tabelle heißt nach dem targetLang-Dateinamen: Sandbox_DE.txt → Sandbox_DE.
      const tableName = tgtFileName.slice(0, tgtFileName.length - 4)
      writeLua(tgtPath, tableName, obj)
    } else {
      writeJson(tgtPath, obj)
    }
  }
  return { saved }
}

module.exports = { saveBatch, backupName, timestampDir, writeLua }
