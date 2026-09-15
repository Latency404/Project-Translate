// LLM-Export/-Import.
//
// Export (eine Datei pro Mod): export/llm/<targetLang>/<ModName>.json
//   { mod, modId, targetLang, files: { "<version>/<Kategorie>.json|txt": { key: original } } }
// Datei-Keys tragen das Versions-Segment (42.20 / common / root / base), damit
// mehrere Versionen desselben Mods keine Kollisionen erzeugen. Der LLM
// übersetzt die Werte; Struktur und Keys bleiben unverändert.
//
// Import: liest export/llm/<targetLang>/ (oder einen gewählten Ordner).
// Zuordnung über (modId oder mod-Name, Datei-Key, JSON-Key). Keys, die nicht
// existieren, werden als unmatched gelistet und nicht übernommen.
//
// Layout-Traversal entspricht scanner.scan(): Base Game "base" direkt am Root;
// Mods common → root (nur wenn kein common) → neueste Version. JSON- und
// TXT-Dateien (Lua-Translate) werden gelesen; JSON-Dateien mit Trailing
// Comma / Lua-Style-Keys tolerant via readFlatMap().
const fs = require('node:fs')
const path = require('node:path')
const {
  toPosix,
  translateDir,
  versionDirOf,
  readFlatMap,
  readTxtMap,
  targetFileName,
  SOURCE_LANG
} = require('./scanner')
const { saveBatch } = require('./entries')

// EN-Pfad relativ zum Version-Ordner — POSIX, identisch zum file-Segment
// der entryIds (media/lua/shared/Translate/EN/...).
const EN_REL = 'media/lua/shared/Translate/EN/'

// EN-Stellen eines Mods: [{ version, enDir }] — dieselben Regeln wie
// scanner.scan(): common (exklusiv mit root), root nur ohne common, die
// neueste Version zusätzlich. Base Game: ein Ort mit version "base".
function enLocations(mod) {
  if (mod.isBaseGame) {
    return [{ version: 'base', enDir: translateDir(mod.rootPath, SOURCE_LANG) }]
  }
  const locs = []
  const commonEnDir = translateDir(path.join(mod.rootPath, 'common'), SOURCE_LANG)
  if (fs.existsSync(commonEnDir)) {
    locs.push({ version: 'common', enDir: commonEnDir })
  } else {
    const rootEnDir = translateDir(mod.rootPath, SOURCE_LANG)
    if (fs.existsSync(rootEnDir)) {
      locs.push({ version: 'root', enDir: rootEnDir })
    }
  }
  const newest = mod.versions[0]
  if (newest) {
    locs.push({ version: newest, enDir: translateDir(path.join(mod.rootPath, newest), SOURCE_LANG) })
  }
  return locs
}

// Eine EN-Dir einlesen: Map "<Dateiname>" → { key: original } (nur String-
// Werte). JSON via readFlatMap (tolerant), TXT via readTxtMap (Lua-Translate).
function readEnDir(enDir) {
  const files = {}
  let names
  try {
    names = fs.readdirSync(enDir).sort()
  } catch {
    return files
  }
  for (const f of names) {
    const p = path.join(enDir, f)
    let map
    if (f.toLowerCase().endsWith('.json')) map = readFlatMap(p)
    else if (f.toLowerCase().endsWith('.txt')) map = readTxtMap(p)
    else continue
    if (!map) continue
    const obj = {}
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'string') obj[k] = v
    }
    if (Object.keys(obj).length) files[f] = obj
  }
  return files
}

// Alle gültigen Einträge eines Sets Mods: Set "<modId>::<version>/<cat>::<key>".
// cat ist der Datei-Name (Kategorie.json / Kategorie.txt) — dieselbe Short-
// Form wie die Datei-Keys des Exports.
function buildValidKeys(mods) {
  const valid = new Set()
  for (const mod of mods) {
    for (const { version, enDir } of enLocations(mod)) {
      for (const [cat, obj] of Object.entries(readEnDir(enDir))) {
        for (const key of Object.keys(obj)) {
          valid.add(`${mod.id}::${version}/${cat}::${key}`)
        }
      }
    }
  }
  return valid
}

function exportLlm(mods, targetLang, llmRoot) {
  const outDir = path.join(llmRoot, targetLang)
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  for (const mod of mods) {
    const files = {}
    for (const { version, enDir } of enLocations(mod)) {
      for (const [cat, obj] of Object.entries(readEnDir(enDir))) {
        if (!files[`${version}/${cat}`]) files[`${version}/${cat}`] = {}
        Object.assign(files[`${version}/${cat}`], obj)
      }
    }
    const doc = { mod: mod.name, modId: mod.id, targetLang, files }
    const file = path.join(outDir, `${mod.name}.json`)
    fs.writeFileSync(file, JSON.stringify(doc, null, 4) + '\n', 'utf8')
    written.push(toPosix(file))
  }
  return { written }
}

// LLM-Dateien lesen (tolerant: BOM / Trailing-Comma, falls der LLM kein
// strenges JSON abliefert).
function readLlmFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const obj = readFlatMap(path.join(dir, f))
      return obj && typeof obj === 'object' ? { file: f, doc: obj } : null
    })
    .filter(Boolean)
}

// Datei-Key "<version>/<cat>" in Version + Kategorienamen zerlegen.
function fileKeyParts(fileKey) {
  const slash = fileKey.lastIndexOf('/')
  if (slash === -1) return null
  return { version: fileKey.slice(0, slash), cat: fileKey.slice(slash + 1) }
}

// Import-Vorschau: { matched, unmatched, perMod: { <modId>: { mod, matched, unmatched } } }.
// matched/unmatched zählen JSON-Keys (nicht Dateien).
function importPreview(dir, mods, targetLang) {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const byName = new Map(mods.map((m) => [m.name, m]))
  const valid = buildValidKeys(mods)
  const perMod = {}
  let matched = 0
  let unmatched = 0

  for (const { doc } of readLlmFiles(dir)) {
    const mod = (doc.modId && byId.get(doc.modId)) || byName.get(doc.mod) || null
    if (!mod || typeof doc.files !== 'object' || doc.files === null) continue
    if (!perMod[mod.id]) perMod[mod.id] = { mod: mod.name, matched: 0, unmatched: 0 }
    for (const [fileKey, keys] of Object.entries(doc.files)) {
      const parts = fileKeyParts(fileKey)
      for (const [key, value] of Object.entries(keys || {})) {
        const ok = parts !== null && valid.has(`${mod.id}::${fileKey}::${key}`) && typeof value === 'string'
        if (ok) {
          matched++
          perMod[mod.id].matched++
        } else {
          unmatched++
          perMod[mod.id].unmatched++
        }
      }
    }
  }
  return { matched, unmatched, perMod }
}

// Apply: übernimmt die gültigen Keys und schreibt die targetLang-Dateien
// (inkl. Backup via saveBatch). Ungültige/fehlende Keys bleiben unverändert.
// Aus dem Short-Form-Datei-Key wird die entryId rekonstruiert:
// "<version>/<EN_REL><cat>::<key>" — saveBatch leitet Zielpfad und
// targetLang-Dateinamen (JSON: identisch, TXT: _EN → _<TGT>) davon ab.
function importApply(dir, mods, targetLang, backupRoot) {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const byName = new Map(mods.map((m) => [m.name, m]))
  const valid = buildValidKeys(mods)
  let saved = 0
  for (const { doc } of readLlmFiles(dir)) {
    const mod = (doc.modId && byId.get(doc.modId)) || byName.get(doc.mod) || null
    if (!mod || typeof doc.files !== 'object' || doc.files === null) continue
    const byFile = new Map()
    for (const [fileKey, keys] of Object.entries(doc.files)) {
      const parts = fileKeyParts(fileKey)
      if (!parts) continue
      for (const [key, value] of Object.entries(keys || {})) {
        if (valid.has(`${mod.id}::${fileKey}::${key}`) && typeof value === 'string') {
          if (!byFile.has(fileKey)) byFile.set(fileKey, [])
          // entryId braucht den vollen EN-Pfad relativ zum Version-Ordner —
          // den Short-Form-Key "<version>/<cat>" um EN_REL ergänzen.
          byFile.get(fileKey).push({ entryId: `${parts.version}/${EN_REL}${parts.cat}::${key}`, translation: value })
        }
      }
    }
    for (const items of byFile.values()) {
      saved += saveBatch(mod, items, targetLang, backupRoot).saved
    }
  }
  return { saved }
}

module.exports = { exportLlm, importPreview, importApply, enLocations, buildValidKeys }
