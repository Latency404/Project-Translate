// Reine Funktion: Wurzel-Dir (Game-Root + Workshop) → Mods + Einträge.
// Echte Logik ab Phase 0 — die Fake-API richtet sie nur auf server/fixtures/
// statt auf die Steam-Pfade ( Wurzel-Tausch, kein Umbau).
//
// Mod-Layout (Workshop):
//   <workshopDir>/<PublishedFileID>/mods/<ModName>/
//       mod.info
//       poster.png oder generic.png
//       <version>/  (z. B. 42, 42.13, 42.20 — Versionsordner heißen immer \d+(\.\d+)*;
//                    es wird immer nur die NEUESTE Version gescannt/übersetzt —
//                    ältere Version-Ordner bleiben auf der Platte, aber ungenutzt)
//           media/lua/shared/Translate/<LANG>/<Kategorie>.json
//       common/media/lua/shared/Translate/<LANG>/<Kategorie>.json  (common-Layout)
//       media/lua/shared/Translate/<LANG>/<Kategorie>.json  (root-Layout)
// Ein Published-File kann mehrere Mods enthalten: jeder Unterordner unter mods/
// zählt als eigener Mod mit id = <PublishedFileID>/<Unterordnername>.
//
// Base Game:
//   <gameRoot>/media/lua/shared/Translate/<LANG>/<Kategorie>.json
//   id = BASE, name = "Project Zomboid (Base Game)", versions = ["base"],
//   rootPath = gameRoot (es gibt keinen Version-Ordner).
//
// JSON-Dateien sind flache key → string-Maps.
// TXT-Dateien sind Lua-Translate (Sandbox_EN.txt etc.) mit Key=Value-Paaren.
// Einträge in JSON-/TXT-Datei-Reihenfolge (Insertion Order), Dateien alphabetisch.
// Pfade immer POSIX-Style.
const fs = require('node:fs')
const path = require('node:path')

const SOURCE_LANG = 'EN'
const BASE_ID = 'BASE'
const BASE_NAME = 'Project Zomboid (Base Game)'

function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}

// Versionsordner erkennen: "42", "42.13", "42.15.1" — aber nicht "common", "media".
function isVersionDir(name) {
  return /^\d+(\.\d+)*$/.test(name)
}

// Absteigend sortieren: 42.20 > 42.15 > 42.
function cmpVersionDesc(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return y - x
  }
  return 0
}

// Ordner eines Mod (relativ zum Version-Ordner): media/lua/shared/Translate/<LANG>
function translateDir(rootDir, lang) {
  return path.join(rootDir, 'media', 'lua', 'shared', 'Translate', lang)
}

// Version-Ordner eines Mods: Mods haben <rootPath>/<version>, das Base Game nicht.
// Für common/root-Layouts liefert sie den entsprechenden Pfad.
function versionDirOf(mod, version) {
  if (mod.isBaseGame) return mod.rootPath
  if (version === 'common') return path.join(mod.rootPath, 'common')
  if (version === 'root') return mod.rootPath
  return path.join(mod.rootPath, version)
}

function posterFor(modDir) {
  for (const name of ['poster.png', 'generic.png']) {
    const p = path.join(modDir, name)
    if (fs.existsSync(p)) return toPosix(p)
  }
  return null
}

// Lua-Translate-Parser — liest .txt Dateien (Sandbox_EN.txt etc.)
// Format: Key = "Value" oder Key = [[Long Value]] oder ["Key"] = "Value"
const IS_WS = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n'
function unescapeLua(c) {
  switch (c) {
    case '"': return '"'
    case "'": return "'"
    case '\\': return '\\'
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    case 'a': return '\x07'
    case 'v': return '\x0b'
    case 'f': return '\x0c'
    case 'b': return '\b'
    default: return c
  }
}
function readString(raw, i) {
  const n = raw.length
  if (i >= n) return [null, i]
  const q = raw[i]
  if (q !== '"' && q !== "'") return [null, i]
  i++
  let v = ''
  while (i < n && raw[i] !== q) {
    if (raw[i] === '\\' && i + 1 < n) { v += unescapeLua(raw[i + 1]); i += 2 }
    else { v += raw[i]; i++ }
  }
  i++ // closing quote
  return [v, i]
}
function parseLuaTranslate(raw) {
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1) // BOM entfernen
  const map = {}
  let i = 0
  const n = raw.length
  while (i < n) {
    const c = raw[i]
    if (IS_WS(c)) { i++; continue }
    if (c === '-' && raw[i + 1] === '-') { while (i < n && raw[i] !== '\n') i++; continue } // -- Kommentar
    if (c === '{' || c === '}' || c === ',' || c === '=') { i++; continue }
    // Key lesen
    let key = null
    if (c === '"' || c === "'") {
      const [v, j] = readString(raw, i)
      if (v === null) { i++; continue }
      key = v; i = j
    } else if (c === '[' && raw[i + 1] !== '[') {
      // ["key"] oder [ "key" ]
      let j = i + 1
      while (j < n && IS_WS(raw[j])) j++
      if (raw[j] === '"' || raw[j] === "'") {
        const [v, k] = readString(raw, j)
        if (v !== null) {
          key = v
          // nach Closing-Quote: ] erwartet (ws toleriert)
          let m = k
          while (m < n && IS_WS(raw[m])) m++
          i = (raw[m] === ']') ? m + 1 : k
          if (raw[m] !== ']') i = k + 1 // Fallback: 1 Zeichen Vorwärtsschritt
          continue
        }
      }
      i++
      continue
    } else {
      // unquoted Key: Identifier [A-Za-z0-9_%.]+
      const start = i
      while (i < n && /[A-Za-z0-9_%.]/.test(raw[i])) i++
      const k = raw.slice(start, i)
      if (!k) { i++; continue }
      key = k
    }
    // '=' erwarten
    let k = i
    while (k < n && IS_WS(raw[k])) k++
    if (raw[k] !== '=') continue
    k++
    while (k < n && IS_WS(raw[k])) k++
    // Wert
    if (raw[k] === '{') { i = k + 1; continue } // Tabelle skip
    if (raw[k] === '[' && raw[k + 1] === '[') {
      // Langstring [[ ... ]]
      let j = k + 2, v = ''
      while (j < n && !(raw[j] === ']' && raw[j + 1] === ']')) { v += raw[j]; j++ }
      map[key] = v
      i = j + 2
      continue
    }
    if (raw[k] === '"' || raw[k] === "'") {
      const [v, j] = readString(raw, k)
      if (v === null) { i = k + 1; continue }
      map[key] = v
      i = j
      continue
    }
    // Zahl/Boolean/etc. → kein String, nicht übersetzbar
    i = Math.max(k + 1, i + 1)
  }
  return map
}

function readFlatMap(filePath) {
  // Liest eine flache key → string-Map; gibt null zurück, wenn die Datei fehlt
  // oder kein gültiges flaches JSON ist (geskipped, kein Abbruch).
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj
  } catch {
    return null
  }
}

// TXT-Datei als Lua-Translate lesen.
// Gibt {key: value} Map oder null wenn keine Keys gefunden.
function readTxtMap(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const map = parseLuaTranslate(raw)
    return Object.keys(map).length > 0 ? map : null
  } catch {
    return null
  }
}

// EN-Datei-Name → DE-Datei-Name.
// JSON: gleich (ItemName.json → ItemName.json)
// TXT: _EN.txt → _DE.txt (Sandbox_EN.txt → Sandbox_DE.txt)
//     sonst: .txt → _DE.txt (Sandbox.txt → Sandbox_DE.txt)
function targetFileName(enFileName, targetLang, enDir) {
  const ext = path.extname(enFileName)
  const base = enFileName.slice(0, -ext.length)
  if (ext === '.json') return enFileName
  // TXT: entferne optional _EN-Suffix, hänge _<targetLang>
  const noEn = base.endsWith('_EN') ? base.slice(0, -3) : base
  return noEn + '_' + targetLang + ext
}

// Einträge einer EN-Dir lesen: alle .json + .txt Dateien (alphabetisch),
// Key-Reihenwie in der Datei; Translation aus der targetLang-Dir.
// Gibt Array von Entry-Objekten zurück.
// version: das "version"-Segment der entryId (z. B. "42.20", "common", "root").
// modRoot: der Root-Pfad des Mods (für entryId-File-Berechnung).
// enDir: der EN-Translate-Ordner.
// targetLang: Zielsprache-Code.
// isVersion: true wenn version ein echter Versionsordner (nicht common/root) —
//            bestimmt das file-Verhältnis (relativ zum Version-Ordner vs. zum Root).
function scanEntriesForDir(mod, version, enDir, targetLang, modRoot) {
  const entries = []
  if (!fs.existsSync(enDir)) return entries
  const langDir = path.join(path.dirname(enDir), targetLang)
  let names
  try {
    names = fs.readdirSync(enDir).sort()
  } catch {
    return entries
  }

  // Alle .json und .txt Dateien sammeln
  const jsonNames = names.filter(f => f.endsWith('.json'))
  const txtNames = names.filter(f => /\.txt$/i.test(f) && !f.endsWith('.json'))

  // JSON-Einträge zuerst (höhere Priorität bei Duplikaten)
  const jsonEntries = new Map()
  for (const f of jsonNames) {
    const enMap = readFlatMap(path.join(enDir, f))
    if (!enMap) continue
    const deFileName = targetFileName(f, targetLang, enDir)
    const deMap = readFlatMap(path.join(langDir, deFileName))
    const relPath = path.relative(modRoot, path.join(enDir, f))
    const file = toPosix(relPath)
    for (const [key, value] of Object.entries(enMap)) {
      if (typeof value !== 'string') continue
      const translation = deMap && typeof deMap[key] === 'string' ? deMap[key] : null
      entries.push({
        id: `${version}/${file}::${key}`,
        modId: mod.id,
        version,
        file,
        key,
        original: value,
        translation,
        preFilled: translation !== null,
        _sourceFile: f
      })
      jsonEntries.set(`${version}/${file}::${key}`, true)
    }
  }

  // TXT-Einträge danach (Überschreibt JSON nur wenn gleiche entryId — sollte selten sein)
  for (const f of txtNames) {
    const enMap = readTxtMap(path.join(enDir, f))
    if (!enMap) continue
    const deFileName = targetFileName(f, targetLang, enDir)
    const deMap = readFlatMap(path.join(langDir, deFileName))
    const relPath = path.relative(modRoot, path.join(enDir, f))
    const file = toPosix(relPath)
    for (const [key, value] of Object.entries(enMap)) {
      if (typeof value !== 'string') continue
      const entryId = `${version}/${file}::${key}`
      const translation = deMap && typeof deMap[key] === 'string' ? deMap[key] : null
      entries.push({
        id: entryId,
        modId: mod.id,
        version,
        file,
        key,
        original: value,
        translation,
        preFilled: translation !== null,
        _sourceFile: f
      })
    }
  }

  // Deduplizierung: gleiche entryId → JSON hat Priorität.
  // Wenn JSON+TXT gleiche entryId haben, den TXT-Eintrag entfernen.
  const seen = new Map()
  for (const e of entries) {
    const existing = seen.get(e.id)
    if (existing) {
      // JSON-Eintrag hat Priorität — TXT-Eintrag überschreibt nur wenn kein JSON
      // Da wir zuerst JSON durchlaufen, ist existing immer JSON → TXT überspringen
      // Aber wir wollen den TXT-Eintrag nicht verlieren wenn es keinen JSON gibt →
      // Die JSON-Einträge sind schon im Map, TXT-Einträge haben gleiche entryId → remove TXT
      // Weil JSON zuerst: existing ist JSON, e ist TXT → TXT überspringen
      // Umgekehrt: wenn TXT zuerst (sollte nicht vorkommen), JSON würde überschreiben
      // Lösung: Map enthält nur JSON-Einträge für diese entryId
    } else {
      seen.set(e.id, e)
    }
  }

  // Einträge zurückgeben, _sourceFile entfernen
  return Array.from(seen.values()).map(e => {
    const { _sourceFile: _, ...rest } = e
    return rest
  })
}

function summarize(mod, entries) {
  mod.entryCount = entries.length
  mod.translatedCount = entries.filter((e) => e.translation !== null).length
  return entries
}

// Scan: Wurzel-Dir → { mods, entriesByModId }.
// gameRoot / workshopDir: native Pfade. Async, damit der Event Loop während des
// Scans Fortschritt (POST /api/scan → GET /api/status) weiter bedienen kann.
async function scan(gameRoot, workshopDir, targetLang, { onProgress } = {}) {
  const mods = []
  const entriesByModId = {}
  const report = (done, total, current) => {
    if (onProgress) onProgress({ done, total, current })
  }

  // --- Base Game ---
  const baseEnDir = translateDir(gameRoot, SOURCE_LANG)
  const total = 1 + (fs.existsSync(workshopDir) ? fs.readdirSync(workshopDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0)
  const baseMod = {
    id: BASE_ID,
    name: BASE_NAME,
    isBaseGame: true,
    versions: ['base'],
    rootPath: toPosix(gameRoot),
    poster: null,
    entryCount: 0,
    translatedCount: 0
  }
  if (fs.existsSync(baseEnDir)) {
    const entries = summarize(baseMod, scanEntriesForDir(baseMod, 'base', baseEnDir, targetLang, baseMod.rootPath))
    mods.push(baseMod)
    entriesByModId[BASE_ID] = entries
  }
  report(1, total, BASE_NAME)
  await new Promise((r) => setImmediate(r))

  // --- Workshop ---
  let pids = []
  if (fs.existsSync(workshopDir)) {
    pids = fs
      .readdirSync(workshopDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  }
  for (let i = 0; i < pids.length; i++) {
    const pid = pids[i]
    report(i + 2, total, pid)
    await new Promise((r) => setImmediate(r))
    const modsDir = path.join(workshopDir, pid, 'mods')
    if (!fs.existsSync(modsDir)) continue
    let subNames
    try {
      subNames = fs
        .readdirSync(modsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    } catch {
      continue
    }
    for (const name of subNames) {
      const modDir = path.join(modsDir, name)

      // Versionen suchen (vor mod-Deklaration, weil später benötigt)
      let versionNames = []
      try {
        versionNames = fs
          .readdirSync(modDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && isVersionDir(d.name))
          .map((d) => d.name)
          .sort(cmpVersionDesc)
      } catch {
        versionNames = []
      }

      // Mod-Objekt anlegen (vor dem Scan, damit es referenziert werden kann)
      const mod = {
        id: `${pid}/${name}`,
        name,
        isBaseGame: false,
        versions: versionNames.slice(0, 1),
        rootPath: toPosix(modDir),
        poster: posterFor(modDir),
        entryCount: 0,
        translatedCount: 0
      }

      let entries = []

      // Layout-Scanner: welche Translate-Orte existieren?
      // common → root → neuester Version-Ordner

      // common-Layout prüfen
      const commonEnDir = path.join(modDir, 'common', 'media', 'lua', 'shared', 'Translate', SOURCE_LANG)
      if (fs.existsSync(commonEnDir)) {
        const commonEntries = scanEntriesForDir(mod, 'common', commonEnDir, targetLang, path.join(modDir, 'common'))
        entries.push(...commonEntries)
      }

      // root-Layout prüfen (nur wenn kein common-Layout)
      if (!fs.existsSync(commonEnDir)) {
        const rootEnDir = path.join(modDir, 'media', 'lua', 'shared', 'Translate', SOURCE_LANG)
        if (fs.existsSync(rootEnDir)) {
          const rootEntries = scanEntriesForDir(mod, 'root', rootEnDir, targetLang, modDir)
          entries.push(...rootEntries)
        }
      }

      // Version-Ordner scannen
      for (const version of versionNames.slice(0, 1)) {
        const enDir = translateDir(path.join(modDir, version), SOURCE_LANG)
        entries.push(...scanEntriesForDir(mod, version, enDir, targetLang, path.join(modDir, version)))
      }

      summarize(mod, entries)
      mods.push(mod)
      entriesByModId[mod.id] = entries
    }
  }

  // Name aufsteigend (Base Game bleibt an seiner alphabetischen Stelle).
  mods.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { mods, entriesByModId }
}

module.exports = { scan, versionDirOf, translateDir, toPosix, SOURCE_LANG, BASE_ID, BASE_NAME }
