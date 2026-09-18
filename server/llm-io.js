// LLM-Export/-Import.
//
// Export (EINE Datei für alle ausgewählten Mods, als JSON-String — die Frontend
// lädt sie über den Browser-Save-Dialog herunter):
//   { targetLang: "", note, mods: [ { mod, modId, files: { "<version>/<Kategorie>.json|txt": { key: original } } } ] }
// Datei-Keys tragen das Versions-Segment (42.20 / common / root / base), damit
// mehrere Versionen desselben Mods keine Kollisionen erzeugen. Der Export legt
// bewusst KEINE Zielsprache fest — er ist die neutrale EN-Originalfassung.
// `targetLang` ist ein leeres Tag, `note` bittet das LLM, beim Übersetzen
// selbst hineinzuschreiben, in welche Sprache es übersetzt hat — damit
// erkennt der Import automatisch, in welche Sprache übersetzt wurde.
//
// Import: die Frontend sendet den Text einer einzigen Datei (Browser-Open-
// Dialog). normalizeImportInput() akzeptiert Bundle (mods-Array), ein Array von
// Mod-Docs oder eine einzelne Mod-Datei. Zuordnung über (modId oder mod-Name,
// Datei-Key, JSON-Key). Keys, die nicht existieren, werden als unmatched
// gelistet und nicht übernommen. Bei Bundle-Form liefert es zusätzlich
// `detectedTargetLang` (das `targetLang`-Feld des Bundles) — die Frontend
// vergleicht es mit der konfigurierten Zielsprache und zeigt bei Abweichung
// eine kurze Toast-Notification.
//
// Es gibt bewusst KEIN importApply — der Import schreibt nichts auf die Platte.
// importPreview() liefert neben den Zähl-Feldern auch `matches` (rekonstruierte
// entryIds + Übersetzung); die Frontend übernimmt diese als ungespeicherte
// (dirty) Einträge, die man im Editor Mod für Mod prüft und über den normalen
// Save-Weg (PUT /api/mods/:modId/entries → saveBatch) einzeln speichert.
//
// Layout-Traversal entspricht scanner.scan(): Base Game "base" direkt am Root;
// Mods common → root (nur wenn kein common) → neueste Version. JSON- und
// TXT-Dateien (Lua-Translate) werden gelesen; JSON-Dateien mit Trailing
// Comma / Lua-Style-Keys tolerant via readFlatMap().
const fs = require('node:fs')
const path = require('node:path')
const {
  translateDir,
  readFlatMap,
  readTxtMap,
  SOURCE_LANG
} = require('./scanner')

// EN-Stellen eines Mods: [{ version, enDir }] — dieselben Regeln wie
// scanner.scan(): common (exklusiv mit root), root nur ohne common, die
// neueste Version zusätzlich. Base Game: ein Ort mit version "base".
function enLocations(mod, sourceLang = SOURCE_LANG) {
  if (mod.isBaseGame) {
    return [{ version: 'base', enDir: translateDir(mod.rootPath, sourceLang) }]
  }
  const locs = []
  const commonEnDir = translateDir(path.join(mod.rootPath, 'common'), sourceLang)
  if (fs.existsSync(commonEnDir)) {
    locs.push({ version: 'common', enDir: commonEnDir })
  } else {
    const rootEnDir = translateDir(mod.rootPath, sourceLang)
    if (fs.existsSync(rootEnDir)) {
      locs.push({ version: 'root', enDir: rootEnDir })
    }
  }
  const newest = mod.versions[0]
  if (newest) {
    locs.push({ version: newest, enDir: translateDir(path.join(mod.rootPath, newest), sourceLang) })
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
function buildValidKeys(mods, sourceLang = SOURCE_LANG) {
  const valid = new Set()
  for (const mod of mods) {
    for (const { version, enDir } of enLocations(mod, sourceLang)) {
      for (const [cat, obj] of Object.entries(readEnDir(enDir))) {
        for (const key of Object.keys(obj)) {
          valid.add(`${mod.id}::${version}/${cat}::${key}`)
        }
      }
    }
  }
  return valid
}

// Dateimap eines Mods: { "<version>/<cat>": { key: original } } — mehrere
// EN-Stellen werden überlagert (common/root/Versionen).
function modFiles(mod, sourceLang = SOURCE_LANG) {
  const files = {}
  for (const { version, enDir } of enLocations(mod, sourceLang)) {
    for (const [cat, obj] of Object.entries(readEnDir(enDir))) {
      if (!files[`${version}/${cat}`]) files[`${version}/${cat}`] = {}
      Object.assign(files[`${version}/${cat}`], obj)
    }
  }
  return files
}

// Alle ausgewählten Mods in EINE Datei bündeln — bewusst OHNE festgelegte
// Zielsprache: der Export ist die neutrale EN-Originalfassung, `targetLang`
// bleibt ein leeres Tag, das die KI beim Übersetzen selbst setzt (s. `note`).
// Rückgabe: { text, filename, modCount, entryCount }. Die Frontend lädt
// `text` als `filename` über den Save-Dialog herunter.
function exportLlmBundle(mods, sourceLang = SOURCE_LANG) {
  const modDocs = mods.map((mod) => ({ mod: mod.name, modId: mod.id, files: modFiles(mod, sourceLang) }))
  const note = 'These are the original English texts. Translate every string value in "files" into the target language of your choice, keeping keys and structure unchanged. Then set "targetLang" above to the ISO code of that language (e.g. "DE", "ES", "FR") so the import can detect it.'
  const doc = { targetLang: '', note, mods: modDocs }
  let entryCount = 0
  for (const d of modDocs) {
    for (const keys of Object.values(d.files)) entryCount += Object.keys(keys).length
  }
  return {
    text: JSON.stringify(doc, null, 2) + '\n',
    filename: 'llm-translation.json',
    modCount: mods.length,
    entryCount
  }
}

// Dateitext in eine Liste von Mod-Docs normalisieren. Akzeptiert:
//   - String: JSON-Text (tolerant gegenüber BOM); Fehler → { docs: [], error }
//   - Array von Mod-Docs
//   - Bundle-Objekt { targetLang, mods: [...] }
//   - Einzelnes Mod-Doc { mod, modId, files }
// detectedTargetLang: das oberste `targetLang`-Feld eines Bundles — die
// exportierte Datei bittet das LLM, es auf die tatsächlich übersetzte
// Sprache zu setzen, falls abweichend (s. exportLlmBundle). Nur bei
// Bundle-Form vorhanden, sonst null (Array/Einzel-Mod-Doc tragen es nicht).
function normalizeImportInput(input) {
  if (typeof input === 'string') {
    let text = input
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
    text = text.trim()
    if (!text) return { docs: [], error: 'Die Datei ist leer.', detectedTargetLang: null }
    try {
      input = JSON.parse(text)
    } catch (e) {
      return { docs: [], error: `JSON konnte nicht gelesen werden: ${e.message}`, detectedTargetLang: null }
    }
  }
  let docs
  let detectedTargetLang = null
  if (Array.isArray(input)) {
    docs = input
  } else if (input && typeof input === 'object' && Array.isArray(input.mods)) {
    docs = input.mods
    if (typeof input.targetLang === 'string' && input.targetLang.trim()) {
      detectedTargetLang = input.targetLang.trim().toUpperCase()
    }
  } else if (input && typeof input === 'object') {
    docs = [input]
  } else {
    return { docs: [], error: 'Unerwartetes Dateiformat — keine gültigen Mod-Daten.', detectedTargetLang: null }
  }
  return { docs, error: null, detectedTargetLang }
}

// Datei-Key "<version>/<cat>" in Version + Kategorienamen zerlegen.
function fileKeyParts(fileKey) {
  const slash = fileKey.lastIndexOf('/')
  if (slash === -1) return null
  return { version: fileKey.slice(0, slash), cat: fileKey.slice(slash + 1) }
}

// Mod-Doc einem Mod zuordnen (modId bevorzugt, sonst Name); null = unbekannt.
function resolveMod(doc, byId, byName) {
  if (!doc || typeof doc !== 'object' || typeof doc.files !== 'object' || doc.files === null) return null
  return (doc.modId && byId.get(doc.modId)) || byName.get(doc.mod) || null
}

// Import-Vorschau: { matched, unmatched, perMod: { <modId>: { mod, matched, unmatched } },
// matches: [{ modId, entryId, translation }] }. matched/unmatched zählen
// JSON-Keys (nicht Dateien). `matches` sind die bereits gültigen Treffer mit
// rekonstruierter entryId ("<version>/<EN_REL><cat>::<key>", EN_REL =
// media/lua/shared/Translate/<sourceLang>/) — die Frontend übernimmt sie
// direkt als dirty Einträge, ohne dass hier irgendetwas geschrieben wird.
function importPreview(docs, mods, targetLang, sourceLang = SOURCE_LANG) {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const byName = new Map(mods.map((m) => [m.name, m]))
  const valid = buildValidKeys(mods, sourceLang)
  const enRel = `media/lua/shared/Translate/${sourceLang}/`
  const perMod = {}
  const matches = []
  let matched = 0
  let unmatched = 0
  for (const doc of docs) {
    const mod = resolveMod(doc, byId, byName)
    if (!mod) continue
    if (!perMod[mod.id]) perMod[mod.id] = { mod: mod.name, matched: 0, unmatched: 0 }
    for (const [fileKey, keys] of Object.entries(doc.files)) {
      const parts = fileKeyParts(fileKey)
      for (const [key, value] of Object.entries(keys || {})) {
        const ok = parts !== null && valid.has(`${mod.id}::${fileKey}::${key}`) && typeof value === 'string'
        if (ok) {
          matched++
          perMod[mod.id].matched++
          matches.push({ modId: mod.id, entryId: `${parts.version}/${enRel}${parts.cat}::${key}`, translation: value })
        } else {
          unmatched++
          perMod[mod.id].unmatched++
        }
      }
    }
  }
  return { matched, unmatched, perMod, matches }
}

module.exports = {
  exportLlmBundle,
  normalizeImportInput,
  importPreview,
  enLocations,
  buildValidKeys
}
