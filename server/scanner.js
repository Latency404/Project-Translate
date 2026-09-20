// Reine Funktion: Wurzel-Dir (Game-Root + Workshop) → Mods + Einträge.
// Echte Logik ab Phase 0 — die Fake-API richtet sie nur auf server/fixtures/
// statt auf die Steam-Pfade ( Wurzel-Tausch, kein Umbau).
//
// Mod-Layout (Workshop):
//   <workshopDir>/<PublishedFileID>/mods/<ModName>/
//       mod.info            (deklariert das Poster: poster=<file>, meist preview.png)
//       <poster-Datei> (meist preview.png) oder poster.png / generic.png
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
// JSON-Dateien sind flache key → string-Maps; handgeschriebene Mods dürfen
// Trailing Commas und unquoted (Lua-Style) Keys enthalten — readFlatMap()
// parse beide Varianten tolerant.
// TXT-Dateien sind Lua-Translate (Sandbox_EN.txt etc.) mit Key=Value-Paaren —
// Quelle nur, wenn es keine JSON derselben Kategorie gibt; geschrieben wird
// immer JSON (s. targetFileName / sourceFileNames).
// Spiel- und Workshop-Ordner werden nur GELESEN. Eigene Übersetzungen liegen im
// Arbeitsordner (export/work/) und überlagern dort die Dateien der Mods (s.
// workLangDir / readTargetMapWithWork).
// Mods ohne übersetzbare Einträge werden nicht gelistet.
// Einträge in JSON-/TXT-Datei-Reihenfolge (Insertion Order), Dateien alphabetisch.
// Pfade immer POSIX-Style.
const fs = require('node:fs')
const path = require('node:path')
const { SOURCE_LANG } = require('./langs')

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

// Wert einer Zeile `<key>=<wert>` aus <dir>/mod.info (Groß-/Kleinschreibung des
// Keys egal, Werte dürfen quoted sein, BOM am Dateianfang wird ignoriert).
// null, wenn es die Datei oder den Key nicht gibt oder der Wert leer ist.
// `infoCache` (optionale Map dir → Text|null) spart beim Scan das mehrfache
// Lesen derselben Datei.
function modInfoValueIn(dir, key, infoCache) {
  let raw = infoCache ? infoCache.get(dir) : undefined
  if (raw === undefined) {
    try {
      raw = fs.readFileSync(path.join(dir, 'mod.info'), 'utf8')
    } catch {
      raw = null
    }
    if (infoCache) infoCache.set(dir, raw)
  }
  if (raw === null) return null
  const re = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'i')
  for (const line of raw.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = re.exec(line.trim())
    if (!m) continue
    let v = m[1].trim()
    if (v.length >= 2 && ((v[0] === "'" && v[v.length - 1] === "'") || (v[0] === '"' && v[v.length - 1] === '"'))) {
      v = v.slice(1, -1).trim()
    }
    if (v) return v
  }
  return null
}

// Ordner, in denen B42 die mod.info eines Mods führt, in Vorrang-Reihenfolge:
// neuester Versionsordner, common, Mod-Wurzel (B41).
function modInfoDirs(modDir, versionNames) {
  return [versionNames[0] ? path.join(modDir, versionNames[0]) : null, path.join(modDir, 'common'), modDir].filter(
    Boolean
  )
}

// Poster eines Mods. Die mod.info liegt bei B42-Mods im Versionsordner oder in
// common (nicht in der Mod-Wurzel), und das deklarierte Bild liegt neben ihr.
// Reihenfolge: das in einer mod.info deklarierte `poster=` (relativ zu deren
// Ordner), dann poster.png / generic.png / icon.png in einem der Ordner.
function posterFor(modDir, versionNames = [], infoCache) {
  const dirs = modInfoDirs(modDir, versionNames)
  const candidates = []
  for (const dir of dirs) {
    const declared = modInfoValueIn(dir, 'poster', infoCache)
    if (declared) candidates.push([dir, declared])
  }
  for (const name of ['poster.png', 'generic.png', 'icon.png']) {
    for (const dir of dirs) candidates.push([dir, name])
  }
  for (const [dir, name] of candidates) {
    // Nur PNG-Dateien innerhalb des Mod-Ordners: mod.info ist Mod-Inhalt, und
    // die /mod-poster-Route dient ausschließlich *.png. Relative Pfade wie
    // "../common/poster.png" sind üblich (mod.info im Versionsordner, Bild in
    // common), dürfen den Mod-Ordner aber nie verlassen.
    if (path.isAbsolute(name) || !name.toLowerCase().endsWith('.png')) continue
    const p = path.resolve(dir, name)
    const rel = path.relative(modDir, p)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
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

// Flaches key → string-Objekt parsen. Striktes JSON.parse schlägt bei
// Mod-Authoren-Dateien oft fehl (Trailing Comma, Lua-Style-Keys) — die
// Toleranz-Variante parseFlatLenient() nimmt diese Formen zusätzlich.
function parseFlat(raw) {
  try {
    const obj = JSON.parse(raw)
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}

// Tolerante Variante für handgeschriebene Translate-JSONs:
//   - BOM am Dateianfang
//   - Trailing Commas (", }" / ", ]")
//   - unquoted Keys mit Doppelpunkt (Lua-Style: { Key: "Value" })
// Gibt null zurück, wenn nichts Parsebares dabei herauskommt.
function parseFlatLenient(raw) {
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
  let s = raw.replace(/,(\s*[}\]])/g, '$1') // Trailing Commata
  // Keys direkt nach { bzw , (Whitespace dazwischen): anquote + Colon bleibt.
  s = s.replace(/([{,]\s*)([A-Za-z0-9_$.]+)\s*:/g, '$1"$2":')
  return parseFlat(s)
}

function readFlatMap(filePath) {
  // Liest eine flache key → string-Map; gibt null zurück, wenn die Datei fehlt
  // oder kein gültiges flaches JSON ist (geskipped, kein Abbruch).
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  return parseFlat(raw) ?? parseFlatLenient(raw)
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

// B42 lädt Übersetzungen AUSSCHLIESSLICH aus
//   <Ort>/media/lua/shared/Translate/<LANG>/<Kategorie>.json
// (zombie/core/Translator.tryFillMapFromFile, gegen projectzomboid.jar geprüft).
// TXT-Dateien (<Kategorie>_EN.txt, Lua-Translate aus B41) liest das Spiel nicht
// mehr. Deshalb:
//   - Quelle: alle .json; eine <Kategorie>_<SRC>.txt nur, wenn es KEINE
//     <Kategorie>.json im selben Quellordner gibt (sourceFileNames).
//   - Ziel: immer <Kategorie>.json (targetFileName) — auch für TXT-Quellen.
//   - Alte Zieldateien <Kategorie>_<LANG>.txt (legacyTargetFileName) werden nur
//     noch gelesen, als Rückfall, solange es die JSON-Zieldatei nicht gibt.
// Andere .txt (README.txt, language.txt, ...) sind keine Quellen.

// Quelldatei → Kategorie: "UI.json" → "UI", "Sandbox_EN.txt" → "Sandbox".
function categoryOf(srcFileName, sourceLang = SOURCE_LANG) {
  const ext = path.extname(srcFileName)
  const base = srcFileName.slice(0, -ext.length)
  if (ext.toLowerCase() === '.json') return base
  const suffix = '_' + sourceLang
  return base.toUpperCase().endsWith(suffix.toUpperCase()) ? base.slice(0, -suffix.length) : base
}

function isTxtSourceName(name, sourceLang = SOURCE_LANG) {
  return name.toUpperCase().endsWith(`_${sourceLang}.TXT`.toUpperCase())
}

// Quelldatei → Zieldatei: immer <Kategorie>.json
// (ItemName.json → ItemName.json, Sandbox_EN.txt → Sandbox.json).
function targetFileName(srcFileName, targetLang, sourceLang = SOURCE_LANG) {
  return categoryOf(srcFileName, sourceLang) + '.json'
}

// Alte TXT-Zieldatei einer TXT-Quelle (Sandbox_EN.txt → Sandbox_DE.txt), nur
// noch zum LESEN (Rückfall) — für JSON-Quellen null. Bei Ziel == Quelle (EN)
// ist das die Quelldatei selbst.
function legacyTargetFileName(srcFileName, targetLang, sourceLang = SOURCE_LANG) {
  if (!srcFileName.toLowerCase().endsWith('.txt')) return null
  return `${categoryOf(srcFileName, sourceLang)}_${targetLang}.txt`
}

// Effektive Quelldateien eines Quellordners, JSON zuerst (alphabetisch), dann
// die TXT ohne JSON-Gegenstück (alphabetisch). Fehlt der Ordner: [].
function sourceFileNames(srcDir, sourceLang = SOURCE_LANG) {
  let names
  try {
    names = fs.readdirSync(srcDir).sort()
  } catch {
    return []
  }
  const json = names.filter((f) => f.toLowerCase().endsWith('.json'))
  const jsonCats = new Set(json.map((f) => categoryOf(f, sourceLang).toLowerCase()))
  const txt = names.filter(
    (f) => isTxtSourceName(f, sourceLang) && !jsonCats.has(categoryOf(f, sourceLang).toLowerCase())
  )
  return [...json, ...txt]
}

// Quelldatei lesen (JSON tolerant, TXT als Lua-Translate) → Map oder null.
function readSourceMap(srcDir, srcFileName) {
  const p = path.join(srcDir, srcFileName)
  return srcFileName.toLowerCase().endsWith('.txt') ? readTxtMap(p) : readFlatMap(p)
}

// Aktuelle Übersetzung einer Quelldatei im Zielordner lesen: die JSON-Zieldatei,
// sonst (nur TXT-Quellen) die alte <Kategorie>_<LANG>.txt. null = nichts da.
function readTargetMap(tgtDir, srcFileName, targetLang, sourceLang = SOURCE_LANG) {
  const json = readFlatMap(path.join(tgtDir, targetFileName(srcFileName, targetLang, sourceLang)))
  if (json) return json
  const legacy = legacyTargetFileName(srcFileName, targetLang, sourceLang)
  return legacy ? readTxtMap(path.join(tgtDir, legacy)) : null
}

// --- Arbeitsordner (export/work/) ---
// Game- und Workshop-Ordner werden von der App NUR gelesen. Alles, was der
// Nutzer übersetzt, liegt im Arbeitsordner, im selben Layout wie im Mod:
//   <workRoot>/<modId, "/" → "_">/<version>/media/lua/shared/Translate/<LANG>/<Kategorie>.json
// Eine Arbeitsdatei ist der KOMPLETTE Stand der Zieldatei (beim ersten Speichern
// aus der Datei im Spiel gesät) und überlagert sie vollständig. Fehlt sie, gilt
// die Datei im Spiel/Workshop.
function workVersionDir(workRoot, mod, version) {
  return path.join(workRoot, String(mod.id).replace(/[\\/:*?"<>|]/g, '_'), String(version))
}

function workLangDir(workRoot, mod, version, lang) {
  return translateDir(workVersionDir(workRoot, mod, version), lang)
}

// Wie readTargetMap(), aber mit Vorrang der Arbeitsdatei. work = { workRoot,
// mod, version } oder null (dann nur Spiel/Workshop, wie bisher).
function readTargetMapWithWork(gameLangDir, srcFileName, targetLang, sourceLang, work) {
  if (work && work.workRoot) {
    const dir = workLangDir(work.workRoot, work.mod, work.version, targetLang)
    const own = readFlatMap(path.join(dir, targetFileName(srcFileName, targetLang, sourceLang)))
    if (own) return own
  }
  return readTargetMap(gameLangDir, srcFileName, targetLang, sourceLang)
}

// id= aus einer mod.info (für loadModAfter= im Export). null, wenn keine.
function modInfoIdIn(dir) {
  return modInfoValueIn(dir, 'id')
}

// Einträge eines Quellordners lesen: die effektiven Quelldateien
// (sourceFileNames: JSON, dazu TXT ohne JSON-Gegenstück), Key-Reihenfolge wie
// in der Datei; Übersetzung je Sprache über readTargetMap() aus dem passenden
// Zielordner (path.join(path.dirname(enDir), lang)).
// version: das "version"-Segment der entryId (z. B. "42.20", "common", "root").
// modRoot: Bezugsordner für den Datei-Pfad der entryId.
function scanEntriesForDir(mod, version, enDir, targetLangs, modRoot, sourceLang = SOURCE_LANG, workRoot = null) {
  const entries = []
  const langsBaseDir = path.dirname(enDir)
  for (const f of sourceFileNames(enDir, sourceLang)) {
    const enMap = readSourceMap(enDir, f)
    if (!enMap) continue
    const file = toPosix(path.relative(modRoot, path.join(enDir, f)))
    // Zieldatei pro Sprache GENAU EINMAL lesen (nicht pro Key) — wichtig bei
    // 450+ Mods und mehreren Zielsprachen.
    const targetMaps = {}
    for (const lang of targetLangs) {
      targetMaps[lang] = readTargetMapWithWork(path.join(langsBaseDir, lang), f, lang, sourceLang, { workRoot, mod, version })
    }
    for (const [key, value] of Object.entries(enMap)) {
      if (typeof value !== 'string') continue
      const translations = {}
      const preFilled = {}
      for (const lang of targetLangs) {
        const tMap = targetMaps[lang]
        // "" zählt als unübersetzt: das Spiel fällt dafür auf EN zurück (die
        // offiziellen Sprachdateien des Basisspiels sind voll davon), und
        // Speichern von "" löscht den Key ohnehin.
        const t = tMap && typeof tMap[key] === 'string' && tMap[key] !== '' ? tMap[key] : null
        translations[lang] = t
        preFilled[lang] = t !== null
      }
      entries.push({
        id: `${version}/${file}::${key}`,
        modId: mod.id,
        version,
        file,
        key,
        original: value,
        translations,
        preFilled
      })
    }
  }
  return entries
}

// mod.translatedCounts bekommt für JEDE Sprache aus targetLangs einen Eintrag —
// auch 0, wenn in dieser Sprache nichts übersetzt ist (z. B. Mod ohne Einträge).
function summarize(mod, entries, targetLangs) {
  mod.entryCount = entries.length
  const translatedCounts = {}
  for (const lang of targetLangs) {
    translatedCounts[lang] = entries.filter((e) => e.translations[lang] !== null).length
  }
  mod.translatedCounts = translatedCounts
  return entries
}

// Scan: Wurzel-Dir → { mods, entriesByModId }.
// gameRoot / workshopDir: native Pfade. targetLangs: Array von Zielsprache-Codes
// (ein versehentlich übergebener einzelner String wird der Robustheit halber
// als [string] behandelt). sourceLang: Sprachordner, aus dem die Originaltexte
// gelesen werden (Default 'EN'); die entryId trägt den entsprechenden Pfad,
// ein Wechsel macht bestehende entryIds ungültig. Async, damit der Event Loop
// während des Scans Fortschritt (POST /api/scan → GET /api/status) weiter
// bedienen kann.
// author= in der mod.info der vom Tool exportierten Übersetzungs-Mods
// (mod-export.js schreibt ihn, der Scanner überspringt solche Mods).
const TOOL_AUTHOR = 'Project Translate'

async function scan(gameRoot, workshopDir, targetLangs, sourceLang = SOURCE_LANG, { onProgress, workRoot = null } = {}) {
  const langs = Array.isArray(targetLangs) ? targetLangs : [targetLangs]
  const mods = []
  const entriesByModId = {}
  const report = (done, total, current) => {
    if (onProgress) onProgress({ done, total, current })
  }

  // --- Base Game ---
  const baseEnDir = translateDir(gameRoot, sourceLang)
  const total = 1 + (fs.existsSync(workshopDir) ? fs.readdirSync(workshopDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0)
  const baseMod = {
    id: BASE_ID,
    name: BASE_NAME,
    isBaseGame: true,
    versions: ['base'],
    rootPath: toPosix(gameRoot),
    poster: null,
    entryCount: 0,
    translatedCounts: {}
  }
  if (fs.existsSync(baseEnDir)) {
    const entries = summarize(baseMod, scanEntriesForDir(baseMod, 'base', baseEnDir, langs, baseMod.rootPath, sourceLang, workRoot), langs)
    if (entries.length) {
      mods.push(baseMod)
      entriesByModId[BASE_ID] = entries
    }
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
      const infoDirs = modInfoDirs(modDir, versionNames)
      const infoCache = new Map()
      const firstInfo = (key) => {
        for (const dir of infoDirs) {
          const v = modInfoValueIn(dir, key, infoCache)
          if (v) return v
        }
        return null
      }
      // Übersetzungs-Mods, die dieses Tool selbst exportiert hat, sind keine Quelle
      // (z. B. mit EN als Zielsprache in den Workshop-Ordner kopiert).
      if (firstInfo('author') === TOOL_AUTHOR) continue
      const mod = {
        // Die id bleibt der Ordnername (stabil, steckt in jeder entryId); der
        // Anzeigename ist der `name=` aus der mod.info — wie im Spiel.
        id: `${pid}/${name}`,
        name: firstInfo('name') || name,
        // Beschreibung aus der mod.info — Kontext für das LLM im Export.
        description: firstInfo('description'),
        isBaseGame: false,
        versions: versionNames.slice(0, 1),
        rootPath: toPosix(modDir),
        poster: posterFor(modDir, versionNames, infoCache),
        // mod.info-id des Quell-Mods (B42: im Versionsordner, sonst common/
        // oder Mod-Wurzel) — der Export setzt damit loadModAfter=.
        modInfoId: firstInfo('id'),
        entryCount: 0,
        translatedCounts: {}
      }

      let entries = []

      // Layout-Scanner: welche Translate-Orte existieren?
      // common → root → neuester Version-Ordner

      // common-Layout prüfen
      const commonEnDir = path.join(modDir, 'common', 'media', 'lua', 'shared', 'Translate', sourceLang)
      if (fs.existsSync(commonEnDir)) {
        const commonEntries = scanEntriesForDir(mod, 'common', commonEnDir, langs, path.join(modDir, 'common'), sourceLang, workRoot)
        entries.push(...commonEntries)
      }

      // root-Layout (B41) nur, wenn weder common noch der neueste
      // Versionsordner einen Quellordner hat — B42 lädt die Mod-Wurzel nie,
      // dort liegen bei B42-Mods nur Altlasten für B41.
      const newestEnDir = versionNames[0] ? translateDir(path.join(modDir, versionNames[0]), sourceLang) : null
      if (!fs.existsSync(commonEnDir) && !(newestEnDir && fs.existsSync(newestEnDir))) {
        const rootEnDir = path.join(modDir, 'media', 'lua', 'shared', 'Translate', sourceLang)
        if (fs.existsSync(rootEnDir)) {
          const rootEntries = scanEntriesForDir(mod, 'root', rootEnDir, langs, modDir, sourceLang, workRoot)
          entries.push(...rootEntries)
        }
      }

      // Version-Ordner scannen
      for (const version of versionNames.slice(0, 1)) {
        const enDir = translateDir(path.join(modDir, version), sourceLang)
        entries.push(...scanEntriesForDir(mod, version, enDir, langs, path.join(modDir, version), sourceLang, workRoot))
      }

      // Mods ohne übersetzbare Einträge (kein Translate-Ordner o. ä.) gar nicht
      // erst listen — sie wären dauerhaft "Open 0 %" und nie übersetzbar.
      if (!entries.length) continue
      summarize(mod, entries, langs)
      mods.push(mod)
      entriesByModId[mod.id] = entries
    }
  }

  // Name aufsteigend (Base Game bleibt an seiner alphabetischen Stelle).
  mods.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { mods, entriesByModId }
}

module.exports = {
  scan,
  TOOL_AUTHOR,
  readFlatMap,
  readTxtMap,
  targetFileName,
  legacyTargetFileName,
  categoryOf,
  sourceFileNames,
  readSourceMap,
  readTargetMap,
  readTargetMapWithWork,
  workVersionDir,
  workLangDir,
  modInfoIdIn,
  modInfoValueIn,
  versionDirOf,
  translateDir,
  toPosix,
  SOURCE_LANG,
  BASE_ID,
  BASE_NAME
}
