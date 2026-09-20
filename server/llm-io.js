// LLM-Export/-Import.
//
// Export (EINE Datei für alle ausgewählten Mods, als JSON-String — die Frontend
// lädt sie über den Browser-Save-Dialog herunter). Neues Format (Multi-Sprache):
//   {
//     targetLangs: ["DE", "FR"],
//     note,
//     mods: [ { mod, modId, files: { "<version>/<Kategorie>.json|txt": { key: original } } } ],
//     translations: { "DE": {}, "FR": {} }
//   }
// `mods` bleibt unverändert als Referenz der EN-Originaltexte stehen. Das LLM
// füllt ausschließlich `translations`:
//   translations["DE"]["<modId>"]["<version>/<Datei>"]["<Key>"] = "Übersetzung"
// Ist `targetLangs` leer, bleibt das bisherige Verhalten sinnvoll erhalten: das
// LLM wählt selbst eine Sprache, trägt sie unter einem eigenen Sprachschlüssel
// in `translations` ein, und der Import erkennt sie automatisch
// (`detectedTargetLangs`).
//
// Datei-Keys tragen das Versions-Segment (42.20 / common / root / base), damit
// mehrere Versionen desselben Mods keine Kollisionen erzeugen.
//
// Import: die Frontend sendet den Text einer einzigen Datei (Browser-Open-
// Dialog). normalizeImportInput() erkennt sowohl das neue `translations`-Format
// (mehrere Sprachen in einer Datei) als auch die alten Formen: Bundle
// ({ targetLang, mods: [...] }), ein Array von Mod-Docs oder ein einzelnes
// Mod-Doc. Zuordnung über (modId oder mod-Name, Datei-Key, JSON-Key). Keys, die
// nicht existieren, werden als unmatched gelistet und nicht übernommen.
//
// Es gibt bewusst KEIN importApply — der Import schreibt nichts auf die Platte.
// importPreview() liefert neben den Zähl-Feldern auch `matches` (rekonstruierte
// entryIds + Übersetzung + Sprache); die Frontend übernimmt diese als
// ungespeicherte (dirty) Einträge, die man im Editor Mod für Mod prüft und über
// den normalen Save-Weg (PUT /api/mods/:modId/entries → saveBatch) einzeln
// speichert.
//
// Layout-Traversal entspricht scanner.scan(): Base Game "base" direkt am Root;
// Mods common → root (nur wenn kein common) → neueste Version. JSON- und
// TXT-Dateien (Lua-Translate) werden gelesen; JSON-Dateien mit Trailing
// Comma / Lua-Style-Keys tolerant via readFlatMap().
const fs = require('node:fs')
const path = require('node:path')
const { translateDir, sourceFileNames, readSourceMap, versionDirOf } = require('./scanner')
const { findUsages, usageHint, findMentionedWords } = require('./lua-usage')
const { SOURCE_LANG, langName } = require('./langs')

// EN-Stellen eines Mods: [{ version, enDir }] — dieselben Regeln wie
// scanner.scan(): common, die neueste Version zusätzlich; root (B41) nur, wenn
// es weder common noch einen Quellordner in der neuesten Version gibt. Base Game: ein Ort mit version "base".
function enLocations(mod, sourceLang = SOURCE_LANG) {
  if (mod.isBaseGame) {
    return [{ version: 'base', enDir: translateDir(mod.rootPath, sourceLang) }]
  }
  const locs = []
  const commonEnDir = translateDir(path.join(mod.rootPath, 'common'), sourceLang)
  const newest = mod.versions[0]
  const newestEnDir = newest ? translateDir(path.join(mod.rootPath, newest), sourceLang) : null
  if (fs.existsSync(commonEnDir)) {
    locs.push({ version: 'common', enDir: commonEnDir })
  } else if (!(newestEnDir && fs.existsSync(newestEnDir))) {
    // root (B41) nur ohne common UND ohne Quellordner im neuesten Versionsordner
    const rootEnDir = translateDir(mod.rootPath, sourceLang)
    if (fs.existsSync(rootEnDir)) {
      locs.push({ version: 'root', enDir: rootEnDir })
    }
  }
  if (newest) {
    locs.push({ version: newest, enDir: translateDir(path.join(mod.rootPath, newest), sourceLang) })
  }
  return locs
}

// Eine EN-Dir einlesen: Map "<Dateiname>" → { key: original } (nur String-
// Werte). Nur die effektiven Quelldateien (scanner.sourceFileNames).
function readEnDir(enDir, sourceLang = SOURCE_LANG) {
  const files = {}
  // Effektive Quellen wie im Scanner: JSON, TXT nur ohne JSON-Gegenstück.
  for (const f of sourceFileNames(enDir, sourceLang)) {
    const map = readSourceMap(enDir, f)
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
// Form wie die Datei-Keys des Exports. Liest die EN-Dateien direkt von der
// Disk (unabhängig vom Scan-Cache-Format).
function buildValidKeys(mods, sourceLang = SOURCE_LANG) {
  const valid = new Set()
  for (const mod of mods) {
    for (const { version, enDir } of enLocations(mod, sourceLang)) {
      for (const [cat, obj] of Object.entries(readEnDir(enDir, sourceLang))) {
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
    for (const [cat, obj] of Object.entries(readEnDir(enDir, sourceLang))) {
      if (!files[`${version}/${cat}`]) files[`${version}/${cat}`] = {}
      Object.assign(files[`${version}/${cat}`], obj)
    }
  }
  return files
}

// Sprachliste normalisieren: trimmen, großschreiben, Duplikate/Leerstrings raus.
function normalizeLangList(langs) {
  const seen = new Set()
  const out = []
  for (const l of langs || []) {
    if (typeof l !== 'string') continue
    const code = l.trim().toUpperCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

// Anweisungstext an das LLM (englisch, knapp). Erklärt, dass nur `translations`
// befüllt wird, Keys/Struktur unverändert bleiben, und — falls keine Zielsprache
// vorgegeben ist — dass das LLM selbst eine wählt und dafür einen eigenen
// Sprachschlüssel unter `translations` anlegt.
// Die Form von `translations` wird ausdrücklich mit Beispiel genannt: "Kopie der
// mods-Struktur" haben Modelle als Liste von Mod-Blöcken gelesen (mod, description,
// files), obwohl ein Objekt nach modId gemeint ist.
const SHAPE_HINT =
  `Shape of translations["<LANG>"]: an OBJECT keyed by modId, not a list. Each modId maps to an object keyed by ` +
  `file key (for example "42/UI.json"), which maps each key to its translated string. ` +
  `Do not repeat "mod", "description" or "files". Example: ` +
  `{"translations": {"DE": {"1234/ModName": {"42/UI.json": {"UI_Key": "Übersetzter Text"}}}}}. `

function buildNote(langs) {
  if (langs.length) {
    return (
      `These are the original English texts under "mods". Fill in "translations" only. ` +
      `For each language listed in "targetLangs" (${langs.join(', ')}), translate every string value from "mods" ` +
      `into that language and put it under translations["<LANG>"] with the same modId, the same file keys and the same keys. ` +
      SHAPE_HINT +
      `Leave "mods" and all keys and structure exactly as given.`
    )
  }
  return (
    `These are the original English texts under "mods". Fill in "translations" only. ` +
    `No target language was specified, so choose one yourself and add an entry for it, e.g. translations["DE"], ` +
    `with the same modId, the same file keys and the same keys as "mods" and the string values translated into that language. ` +
    SHAPE_HINT +
    `Leave "mods" and all keys and structure exactly as given.`
  )
}

// Kontext für das LLM: worum es geht und worauf beim Übersetzen zu achten ist.
// Englisch und knapp, damit es in jedem Modell-Kontext Platz hat. Die
// Regeln zu Platzhaltern sind der wichtigste Teil — ein zerstörter Platzhalter
// (%1, <LINE>, <RGB:...>) bricht im Spiel Texte oder Farben.
function buildContext(langs, notes) {
  const ctx = {
    game: 'Project Zomboid (Build 42), a zombie survival game. Gritty, serious tone.',
    about:
      'The strings are in-game texts of the base game or of a workshop mod: item names, tooltips, ' +
      'context menu entries, recipes, UI labels, sandbox options, moodles and descriptions. ' +
      'Each mod may carry a short description that says what the mod does.',
    languages: Object.fromEntries(langs.map((l) => [l, langName(l)])),
    rules: [
      'Translate only the string values, never the keys.',
      'Keep placeholders, tags and control codes exactly as they are: %1 %2 %s %d {0} <LINE> <BR> <SPACE> <RGB:1,1,1> <IMAGE:...> <SIZE:...> <INDENT:...> and any other <...> tag, plus the escape sequences \\n and \\t.',
      'Keep proper names, place names and brand names as they are (e.g. Muldraugh, Rosewood, Knox Country).',
      'UI labels and menu entries must stay short, similar in length to the original.',
      'Use one consistent term for the same thing across all entries and mods.',
      'Prefer the wording the official game translation uses for that language.',
      'If a string cannot or should not be translated, copy the original unchanged.',
      'Where a mod has a "usage" entry for a key, it shows the game code that displays the text: the file name (it tells what the text is about) and the values passed in for %1, %2 and so on. Use it to understand what a placeholder stands for and what the text is used for, and translate so that the sentence still makes sense with that value.',
      'Return only the completed JSON file, nothing else.'
    ]
  }
  // Freitext des Nutzers zu den ausgewählten Mods (was sie tun, Fachbegriffe, gewünschter Stil).
  if (notes) {
    ctx.notes = notes
    ctx.rules.push('Follow the "notes" from the user: they know what these mods are about and how the texts are used.')
  }
  return ctx
}

// Wo und wie der Lua-Code einer Mod die Texte anzeigt: { key: "Datei.lua: getText(\"KEY\", …)" }
// nur für Keys, die in `files` vorkommen. Das Basisspiel wird nicht durchsucht
// (riesig, und seine Keys sind dem LLM meist geläufig).
function modUsageFound(mod, sourceLang = SOURCE_LANG) {
  if (mod.isBaseGame) return new Map()
  const luaDirs = [...new Set(enLocations(mod, sourceLang).map((l) => path.join(versionDirOf(mod, l.version), 'media', 'lua')))]
  return findUsages(luaDirs)
}

// Wörter aus Code/Skripten der Mod (für "Key kommt im Mod-Code nicht vor"); null,
// wenn sich das nicht belastbar sagen lässt (Basisspiel, kein Lua-Code, zu groß).
function modMentionedWords(mod, sourceLang = SOURCE_LANG) {
  if (mod.isBaseGame) return null
  const mediaDirs = [...new Set(enLocations(mod, sourceLang).map((l) => path.join(versionDirOf(mod, l.version), 'media')))]
  const r = findMentionedWords(mediaDirs)
  return r.hasLua && r.complete ? r.words : null
}

function modUsage(mod, files, sourceLang) {
  const found = modUsageFound(mod, sourceLang)
  const usage = {}
  for (const keys of Object.values(files)) {
    for (const key of Object.keys(keys)) {
      const uses = found.get(key)
      if (uses && !usage[key]) usage[key] = usageHint(key, uses)
    }
  }
  return usage
}

// Alle ausgewählten Mods in EINE Datei bündeln, mit einem leeren
// `translations`-Gerüst je Zielsprache. Rückgabe:
// { text, filename, modCount, entryCount, targetLangs }. Die Frontend lädt
// `text` als `filename` über den Save-Dialog herunter.
function exportLlmBundle(mods, sourceLang = SOURCE_LANG, targetLangs = [], { notes = "" } = {}) {
  const modDocs = mods.map((mod) => {
    const doc = { mod: mod.name, modId: mod.id }
    if (mod.description) doc.description = mod.description.slice(0, 500)
    doc.files = modFiles(mod, sourceLang)
    const usage = modUsage(mod, doc.files, sourceLang)
    if (Object.keys(usage).length) doc.usage = usage
    return doc
  })
  const langs = normalizeLangList(targetLangs)
  const translations = {}
  for (const lang of langs) translations[lang] = {}
  const doc = { targetLangs: langs, note: buildNote(langs), context: buildContext(langs, String(notes || "").trim()), mods: modDocs, translations }
  let entryCount = 0
  for (const d of modDocs) {
    for (const keys of Object.values(d.files)) entryCount += Object.keys(keys).length
  }
  return {
    text: JSON.stringify(doc, null, 2) + '\n',
    filename: 'llm-translation.json',
    modCount: mods.length,
    entryCount,
    targetLangs: langs
  }
}

// Dateitext in { docsByLang, error, detectedTargetLangs } normalisieren.
// Erkennt:
//   - NEU: Objekt mit `translations` (Sprache → modId → fileKey → key → Wert;
//     toleriert werden auch eine Liste von Mod-Docs je Sprache und modId → { files }).
//     Daraus je Sprache eine Liste von Mod-Docs { modId, files }.
//   - ALT (muss weiter funktionieren): { targetLang, mods: [...] }, ein Array
//     von Mod-Docs, oder ein einzelnes Mod-Doc { mod, modId, files }. Sprache
//     ist dann `targetLang` (falls gesetzt), sonst der leere Key "" — der
//     Aufrufer setzt dafür die aktive Sprache ein (s. importPreview).
// Hat ein Bundle sowohl `translations` als auch ein `mods`-Feld, gewinnt
// `translations` (die Originaltexte in `mods` sind dann nur Referenz).
// String-Input wird geparst (BOM abschneiden); leere Datei und kaputtes JSON
// liefern eine lesbare Fehlermeldung.
function normalizeImportInput(input) {
  if (typeof input === 'string') {
    let text = input
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
    text = text.trim()
    if (!text) return { docsByLang: {}, error: 'The file is empty.', detectedTargetLangs: [] }
    try {
      input = JSON.parse(text)
    } catch (e) {
      return { docsByLang: {}, error: `The JSON could not be parsed. ${e.message}`, detectedTargetLangs: [] }
    }
  }

  // NEU: Objekt mit `translations` (Sprache → modId → fileKey → key → Wert).
  if (
    input && typeof input === 'object' && !Array.isArray(input) &&
    input.translations && typeof input.translations === 'object' && !Array.isArray(input.translations)
  ) {
    const docsByLang = {}
    const detectedTargetLangs = []
    for (const [rawLang, modsObj] of Object.entries(input.translations)) {
      const lang = typeof rawLang === 'string' ? rawLang.trim().toUpperCase() : rawLang
      detectedTargetLangs.push(lang)
      const docs = []
      if (Array.isArray(modsObj)) {
        // Häufige Abweichung: das Modell kopiert die mods-Struktur als Liste von
        // Mod-Docs ({ mod, modId, files }) statt eines Objekts nach modId.
        for (const d of modsObj) if (d && typeof d === 'object') docs.push(d)
      } else if (modsObj && typeof modsObj === 'object') {
        for (const [modId, value] of Object.entries(modsObj)) {
          // Erwartet: modId → fileKey → key → Wert. Toleriert modId → { files: ... }.
          const isDoc = value && typeof value === 'object' && value.files && typeof value.files === 'object'
          const files = isDoc ? value.files : value
          docs.push({ modId, files: files && typeof files === 'object' ? files : {} })
        }
      }
      docsByLang[lang] = docs
    }
    return { docsByLang, error: null, detectedTargetLangs }
  }

  // ALT: Bundle, Array von Mod-Docs oder einzelnes Mod-Doc.
  let docs
  let lang = ''
  if (Array.isArray(input)) {
    docs = input
  } else if (input && typeof input === 'object' && Array.isArray(input.mods)) {
    docs = input.mods
    if (typeof input.targetLang === 'string' && input.targetLang.trim()) {
      lang = input.targetLang.trim().toUpperCase()
    }
  } else if (input && typeof input === 'object') {
    docs = [input]
  } else {
    return { docsByLang: {}, error: 'Unexpected file format. No valid mod data found.', detectedTargetLangs: [] }
  }
  return { docsByLang: { [lang]: docs }, error: null, detectedTargetLangs: lang ? [lang] : [] }
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

// Import-Vorschau über alle Sprachen aus docsByLang. matched/unmatched/perMod
// sind Summen über alle Sprachen; perLang bricht sie je Sprache auf. `matches`
// sind die bereits gültigen Treffer mit rekonstruierter entryId
// ("<version>/<EN_REL><cat>::<key>", EN_REL = media/lua/shared/Translate/<sourceLang>/)
// plus `lang` — die Frontend übernimmt sie direkt als dirty Einträge, ohne
// dass hier irgendetwas geschrieben wird. Der leere Sprach-Key "" aus
// docsByLang (alte Formate ohne erkannte Sprache) wird auf `fallbackLang`
// abgebildet.
function importPreview(docsByLang, mods, fallbackLang, sourceLang = SOURCE_LANG) {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const byName = new Map(mods.map((m) => [m.name, m]))
  const valid = buildValidKeys(mods, sourceLang)
  const enRel = `media/lua/shared/Translate/${sourceLang}/`
  const perMod = {}
  const perLang = {}
  const matches = []
  let matched = 0
  let unmatched = 0
  for (const [langKey, docs] of Object.entries(docsByLang || {})) {
    const lang = langKey === '' ? fallbackLang : langKey
    if (!perLang[lang]) perLang[lang] = { matched: 0, unmatched: 0 }
    for (const doc of docs || []) {
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
            perLang[lang].matched++
            matches.push({
              modId: mod.id,
              entryId: `${parts.version}/${enRel}${parts.cat}::${key}`,
              translation: value,
              lang
            })
          } else {
            unmatched++
            perMod[mod.id].unmatched++
            perLang[lang].unmatched++
          }
        }
      }
    }
  }
  return { matched, unmatched, perMod, perLang, matches }
}

module.exports = {
  exportLlmBundle,
  normalizeImportInput,
  importPreview,
  enLocations,
  buildValidKeys,
  modUsageFound,
  modMentionedWords
}
