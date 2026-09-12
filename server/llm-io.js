// LLM-Export/-Import.
//
// Export (eine Datei pro Mod): export/llm/<targetLang>/<ModName>.json
//   { mod, modId, targetLang, files: { "<version>/<Kategorie>.json": { key: original } } }
// Datei-Keys unter files tragen das Versions-Segment, damit mehrere Versionen
// desselben Mods keine Kollisionen erzeugen. Der LLM übersetzt die Werte;
// Struktur und Keys bleiben unverändert.
//
// Import: liest export/llm/<targetLang>/ (oder einen gewählten Ordner).
// Zuordnung über (modId oder mod-Name, Datei-Key, JSON-Key). Keys, die nicht
// existieren, werden als unmatched gelistet und nicht übernommen.
const fs = require('node:fs')
const path = require('node:path')
const { versionDirOf, toPosix } = require('./scanner')
const { saveBatch } = require('./entries')

function listEnFiles(vdir) {
  const enDir = path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'EN')
  if (!fs.existsSync(enDir)) return []
  try {
    return fs.readdirSync(enDir).filter((x) => x.endsWith('.json')).sort()
  } catch {
    return []
  }
}

function readFlatMap(filePath) {
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj
  } catch {
    return null
  }
}

// Alle gültigen Einträge eines Sets Mods: Map "modId::version/<cat>.json::key".
function buildValidKeys(mods) {
  const valid = new Set()
  for (const mod of mods) {
    for (const version of mod.versions) {
      const vdir = versionDirOf(mod, version)
      for (const f of listEnFiles(vdir)) {
        const obj = readFlatMap(path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'EN', f))
        if (!obj) continue
        for (const key of Object.keys(obj)) {
          valid.add(`${mod.id}::${version}/${f}::${key}`)
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
    for (const version of mod.versions) {
      const vdir = versionDirOf(mod, version)
      for (const f of listEnFiles(vdir)) {
        const obj = readFlatMap(path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'EN', f))
        if (!obj) continue
        if (!files[`${version}/${f}`]) files[`${version}/${f}`] = {}
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') files[`${version}/${f}`][k] = v
        }
      }
    }
    const doc = { mod: mod.name, modId: mod.id, targetLang, files }
    const file = path.join(outDir, `${mod.name}.json`)
    fs.writeFileSync(file, JSON.stringify(doc, null, 4) + '\n', 'utf8')
    written.push(toPosix(file))
  }
  return { written }
}

function readLlmFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const obj = readFlatMap(path.join(dir, f))
      return obj ? { file: f, doc: obj } : null
    })
    .filter(Boolean)
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
    if (!mod || typeof doc.files !== 'object') continue
    if (!perMod[mod.id]) perMod[mod.id] = { mod: mod.name, matched: 0, unmatched: 0 }
    for (const [fileKey, keys] of Object.entries(doc.files)) {
      const slash = fileKey.lastIndexOf('/')
      const version = slash === -1 ? '' : fileKey.slice(0, slash)
      const cat = slash === -1 ? '' : fileKey.slice(slash + 1)
      for (const [key, value] of Object.entries(keys || {})) {
        const ok = valid.has(`${mod.id}::${version}/${cat}::${key}`) && typeof value === 'string'
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
function importApply(dir, mods, targetLang, backupRoot) {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const byName = new Map(mods.map((m) => [m.name, m]))
  const valid = buildValidKeys(mods)
  let saved = 0
  for (const { doc } of readLlmFiles(dir)) {
    const mod = (doc.modId && byId.get(doc.modId)) || byName.get(doc.mod) || null
    if (!mod || typeof doc.files !== 'object') continue
    const byFile = new Map()
    for (const [fileKey, keys] of Object.entries(doc.files)) {
      const slash = fileKey.lastIndexOf('/')
      if (slash === -1) continue
      const version = fileKey.slice(0, slash)
      const cat = fileKey.slice(slash + 1)
      for (const [key, value] of Object.entries(keys || {})) {
        if (valid.has(`${mod.id}::${version}/${cat}::${key}`) && typeof value === 'string') {
          if (!byFile.has(fileKey)) byFile.set(fileKey, [])
          // entryId braucht den vollen EN-Pfad relativ zum Version-Ordner
          byFile
            .get(fileKey)
            .push({
              entryId: `${version}/media/lua/shared/Translate/EN/${cat}::${key}`,
              translation: value
            })
        }
      }
    }
    if (byFile.size) {
      for (const items of byFile.values()) {
        saved += saveBatch(mod, items, targetLang, backupRoot).saved
      }
    }
  }
  return { saved }
}

module.exports = { exportLlm, importPreview, importApply }
