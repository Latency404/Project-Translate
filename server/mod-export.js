// Mod-Export: erzeugt einen installierbaren Übersetzungs-Mod für BELIEBIG VIELE
// Zielsprachen in EINEM Mod.
//
// Gegen das entpackte projectzomboid.jar (B42) verifiziert:
//   - Ein Mod wird NUR erkannt, wenn <mod>/common/mod.info ODER
//     <mod>/<versionOrdner>/mod.info existiert (ZomboidFileSystem.
//     getAllModFoldersAux) — ein mod.info am Mod-Root wird NICHT gefunden.
//   - Übersetzungen lädt das Spiel AUSSCHLIESSLICH aus
//     common/media/lua/shared/Translate/<LANG>/<Kategorie>.json plus dem EINEN
//     gewählten Versionsordner (später non-empty gewinnt) — nie aus dem
//     Mod-Root, nie aus TXT (zombie/core/Translator.tryFillMapFromFile).
//
// Ziel: <targetDir>/<Name>-<DE>/  (ab 2 Sprachen: <Name>-Multi); <Name> ist bei
// einem Mod dessen interner Ordnername (UsefulBarrelsMP), bei mehreren "TranslationPack"
//   42/mod.info                 (die EINZIGE mod.info dieses Mods — "42" ist
//                                ein fester, gültiger Versionsordner-Name
//                                [PZ Build 42], kein aus den Quellen
//                                abgeleiteter Wert. Er macht den Mod ohne
//                                versionMin/versionMax entdeckbar und bleibt
//                                mit jeder künftigen 42.x-Version kompatibel.)
//   42/icon.png                 (falls eine Quelle ein Poster hat; via
//                                poster=/icon= in derselben mod.info deklariert)
//   common/media/lua/shared/Translate/<LANG>/<Kategorie>.json
//                                (ALLE Übersetzungen ALLER gewählten Mods, je
//                                Sprache gemergt — common wird vom Spiel IMMER
//                                geladen, unabhängig vom gewählten
//                                Versionsordner)
//
// Merge-Reihenfolge (gilt für einen einzelnen Mod genauso wie für ein Bundle):
// pro Mod, in der übergebenen Auswahlreihenfolge, seine Layout-Orte in
// Scanner-Reihenfolge (common ODER root, danach sein neuester Versionsordner)
// — eine spätere Quelle gewinnt bei Key-Kollision, genau wie im Spiel (der
// gewählte Versionsordner überschreibt common). Zwischen mehreren Mods
// gewinnt der spätere Mod (Auswahlreihenfolge) — wie im Spiel, wo der später
// geladene Mod denselben Key überschreibt.
//
// loadModAfter=: listet die mod.info-`id` der ausgewählten Quell-Mods
// (scanner.js liefert sie bereits als mod.modInfoId, null für Basisspiel/
// unbekannt). Lädt die Übersetzung nach dem Quell-Mod, damit dessen eigene
// (evtl. veraltete) Übersetzung für dieselbe Sprache nicht gewinnt.
//
// Quelle der Übersetzungen ist der Arbeitsstand (export/work/, s. scanner.js):
// eine Arbeitsdatei geht vor der Datei im Spiel/Workshop. Der Zielordner darf
// nie in Spiel/Workshop liegen (guard.assertWritable).
//
// Es werden nur übersetzte Einträge exportiert (non-empty String-Value, der
// auch in der Quelldatei existiert). Ausgabe ist IMMER JSON — auch für
// TXT-Quellen (Lua-Translate liest B42 nicht mehr, s. o.). Leere Dateien
// werden nicht erzeugt. Sprachen sind strikt getrennt (eigener Ordner je
// Sprache) — sie können sich nie gegenseitig überschreiben.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  translateDir,
  toPosix,
  sourceFileNames,
  readSourceMap,
  readTargetMapWithWork,
  targetFileName,
  versionDirOf,
  TOOL_AUTHOR
} = require('./scanner')
const { enLocations } = require('./llm-io')
const { writeJson } = require('./entries')
const { SOURCE_LANG, isKnownLang } = require('./langs')
const { assertWritable } = require('./guard')

// Fester Versionsordner für die mod.info (s. Kopfkommentar) — kein aus den
// Quellen abgeleiteter Wert.
const MOD_INFO_VERSION_DIR = '42'

// targetLangs normalisieren: ein versehentlich übergebener String wird als
// Einzelsprache behandelt (Robustheit), Groß-/Kleinschreibung vereinheitlicht,
// Duplikate raus, aufsteigend sortiert — die sortierte Form bestimmt
// Ordnername/id/Anzeigename gleichermaßen. Unbekannte Codes (server/langs.js)
// werden verworfen, damit kein von außen übergebener Sprachcode als
// Pfadsegment im Export landet; bleibt danach nichts übrig, ist das ein
// Fehler (400) statt eines leeren Exports.
function normalizeLangs(targetLangs) {
  const arr = Array.isArray(targetLangs) ? targetLangs : [targetLangs]
  const known = arr.filter((l) => isKnownLang(l)).map((l) => String(l).toUpperCase())
  const langs = [...new Set(known)].sort()
  if (!langs.length) {
    throw Object.assign(new Error('No valid target language selected.'), { status: 400 })
  }
  return langs
}

// Sprachanteil für Ordnername/id: bis zu 3 Sprachen ausgeschrieben (mit sep
// verbunden), ab 4 Sprachen ein fester Platzhalter — sonst würde der Name mit
// der Sprachanzahl unbegrenzt wachsen (Pfadlängen-Grenze unter Windows).
function langSuffix(langsSorted, sep) {
  return langsSorted.length <= 3 ? langsSorted.join(sep) : 'multi'
}

// Sprachliste fürs Anzeigefeld (name=/description=): immer ausgeschrieben,
// unabhängig von der Anzahl — hier gibt es keine Pfadlängen-Grenze.
function langDisplayList(langsSorted) {
  return langsSorted.join(', ')
}

// Nur [A-Za-z0-9_] — die einzigen Zeichen, die in echten mod.info-`id`-Werten
// vorkommen (gegen Steam-Workshop-Mods verifiziert). Alles andere → '_'.
function slugForId(s) {
  const cleaned = String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'mod'
}

// Sprachanteil im Ordnernamen: eine Sprache → ihr Code, mehrere → "Multi".
// (Die mod.info-id nutzt weiter langSuffix.)
function folderLangSuffix(langsSorted) {
  return langsSorted.length === 1 ? langsSorted[0] : 'Multi'
}

// Deterministische id für einen einzelnen Mod + Zielsprachen-Menge: derselbe
// Mod (mod.id enthält bereits die WorkshopId oder ist 'BASE') + dieselbe
// Sprachmenge ergeben immer dieselbe id, damit ein erneuter Export den vorigen
// ersetzt statt zu duplizieren. Präfix 'pt_' verhindert eine Kollision mit der
// id des Quell-Mods selbst.
function singleModInfoId(mod, targetLangs) {
  const langs = normalizeLangs(targetLangs)
  return `pt_${slugForId(mod.id)}_${langSuffix(langs, '_')}`
}

// Deterministische id für ein Bundle: hängt nur von der Menge der enthaltenen
// Mod-ids (sortiert, damit Auswahlreihenfolge egal ist) + der Zielsprachen-Menge
// ab. Kurzer Hash statt Namenskette, damit die id nicht mit der Mod-Anzahl wächst.
function bundleModInfoId(mods, targetLangs) {
  const langs = normalizeLangs(targetLangs)
  const key = mods.map((m) => m.id).slice().sort().join('|') + '::' + langs.join(',')
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)
  return `pt_bundle_${hash}_${langSuffix(langs, '_')}`
}

// Ordnername sicher machen: unter Windows unzulässige Zeichen ersetzen, keine
// trailing dots/spaces, Länge begrenzen (Pfadlängen-Grenze).
function sanitizeFolderName(name, maxLen = 100) {
  let s = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  s = s.replace(/[. ]+$/, '')
  if (s.length > maxLen) s = s.slice(0, maxLen).trim()
  return s || 'Mod'
}

// Bundle-Ordnername: ein Mod → der interne Ordnername des Mods (letztes Segment
// der mod.id, z. B. "UsefulBarrelsMP" aus "3436537035/UsefulBarrelsMP"; das
// Basisspiel hat keinen und nimmt seinen Namen); mehrere → "TranslationPack".
// Kurz und ohne Zeichen aus Mod-Namen, damit er bei vielen Mods nicht die
// Pfadlänge sprengt. Die Sprachen hängt buildExport mit "-" an.
function bundleFolderBaseName(mods) {
  if (mods.length !== 1) return 'TranslationPack'
  const mod = mods[0]
  if (mod.isBaseGame) return sanitizeFolderName(mod.name)
  return sanitizeFolderName(String(mod.id).split('/').pop())
}

// Anzeigename fürs `name=`-Feld der mod.info: dieselbe Regel wie beim
// Ordnernamen (bundleFolderBaseName) — ein Mod → sein Name, mehrere → eine
// kurze zählende Form statt der mit ' + ' verketteten Namensliste, die bei
// vielen Mods eine unlesbare Zeile im Mod-Manager des Spiels ergibt. Die
// Sprachliste im Klammerzusatz ist immer vollständig ausgeschrieben (auch bei
// 4+ Sprachen) — anders als Ordnername/id gibt es hier keine Pfadlängen-Grenze.
function bundleDisplayName(mods, targetLangs) {
  const list = langDisplayList(normalizeLangs(targetLangs))
  if (mods.length === 1) return `${mods[0].name} Translation (${list})`
  return `Translation Bundle (${mods.length} mods) (${list})`
}

// Übersetzungs-Quellorte eines Mods, in Scanner-Reihenfolge: [{ rel, vdir }].
// Spiegelt exakt scanner.scan() / llm-io.enLocations() — common schließt root
// aus; root nur, wenn WEDER common NOCH der neueste Versionsordner einen
// Quellordner hat (B42 lädt die Mod-Wurzel nie, dort liegen bei B42-Mods nur
// Altlasten für B41); danach immer der neueste Versionsordner (mod.versions
// enthält durch den Scanner ohnehin höchstens einen Eintrag). `rel` ist nur
// eine Herkunfts-Kennung fürs Lesen/Testen — der Export selbst schreibt IMMER
// nach common/ im Zielordner (s. Kopfkommentar), unabhängig von `rel`.
function layoutLocations(mod, sourceLang = SOURCE_LANG) {
  return enLocations(mod, sourceLang).map(({ version }) => ({ rel: version, vdir: versionDirOf(mod, version) }))
}

// Bildquelle fürs Icon: das deklarierte Poster, sonst ein sibling icon.png.
// null, wenn nichts existiert (dann wird nichts kopiert/deklariert).
function findIconSrc(mod) {
  if (!mod.poster) return null
  for (const candidate of [path.basename(mod.poster), 'icon.png']) {
    const src = path.join(path.dirname(mod.poster), candidate)
    if (fs.existsSync(src)) return src
  }
  return null
}

// Die EINE mod.info des exportierten Mods schreiben (+ ggf. icon.png), unter
// <outRoot>/<MOD_INFO_VERSION_DIR>/ (s. Kopfkommentar — kein mod.info am
// Mod-Root, das würde die Mod-Erkennung in B42 stillschweigend übergehen).
// Gibt die geschriebenen Pfade (POSIX, relativ zu outRoot) zurück.
function writeModInfoFile(outRoot, { id, name, author, description, iconSrc, loadModAfter }) {
  const written = []
  const locDir = path.join(outRoot, MOD_INFO_VERSION_DIR)
  fs.mkdirSync(locDir, { recursive: true })
  const lines = [
    `id=${id}`,
    `name=${name}`,
    `author=${author}`,
    `description=${description}`
  ]
  let hasIcon = false
  if (iconSrc) {
    fs.copyFileSync(iconSrc, path.join(locDir, 'icon.png'))
    hasIcon = true
  }
  if (hasIcon) {
    lines.push('poster=icon.png')
    lines.push('icon=icon.png')
  }
  // Lädt die Übersetzung NACH den Quell-Mods, damit deren eigene (evtl.
  // veraltete) Übersetzung für dieselbe Sprache nicht gewinnt (s. Kopfkommentar).
  if (loadModAfter.length) {
    lines.push(`loadModAfter=${loadModAfter.join(',')}`)
  }
  fs.writeFileSync(path.join(locDir, 'mod.info'), lines.join('\n') + '\n', 'utf8')
  written.push(toPosix(path.join(MOD_INFO_VERSION_DIR, 'mod.info')))
  if (hasIcon) written.push(toPosix(path.join(MOD_INFO_VERSION_DIR, 'icon.png')))
  return written
}

// Übersetzte Dateien EINES Quellorts + EINER Zielsprache einlesen:
// { "<Kategorie>.json": { key: value } } — nur übersetzte, in der Quelle
// vorhandene Keys (unmatched/leer verwerfen). Ausgabe-Dateiname immer
// targetFileName() (also immer .json, auch für TXT-Quellen).
function readLocationTranslations(vdir, targetLang, sourceLang = SOURCE_LANG, work = null) {
  const out = {}
  const enDir = translateDir(vdir, sourceLang)
  const tgtDir = translateDir(vdir, targetLang)
  for (const f of sourceFileNames(enDir, sourceLang)) {
    const enMap = readSourceMap(enDir, f)
    if (!enMap) continue
    const tgtMap = readTargetMapWithWork(tgtDir, f, targetLang, sourceLang, work)
    if (!tgtMap) continue
    const fileName = targetFileName(f, targetLang, sourceLang)
    const filtered = {}
    for (const [key, val] of Object.entries(tgtMap)) {
      if (typeof val === 'string' && val !== '' && key in enMap) filtered[key] = val
    }
    if (!Object.keys(filtered).length) continue
    if (!out[fileName]) out[fileName] = {}
    Object.assign(out[fileName], filtered)
  }
  return out
}

// Gemeinsamer Kern von exportMod und exportModsBundle: baut den Zielordner,
// EINE mod.info (im festen Versionsordner) und mergt die übersetzten Dateien
// ALLER Mods in EINEN common/-Baum — JE ZIELSPRACHE in ihrem eigenen
// Sprachordner, damit sich Sprachen nie gegenseitig überschreiben. Nimmt IMMER
// ein Array (auch für den Einzelmod-Fall) — Ordnername, id, name/description
// und die Merge-Regel sind für ein einzelnes Element dieselben Regeln wie für
// mehrere, siehe bundleFolderBaseName/bundleDisplayName. `written` ist ein Set
// in Einfüge-Reihenfolge (mod.info/icon zuerst, dann je Sprache die Dateien in
// Verarbeitungsreihenfolge) — ob/wie sortiert wird, entscheidet der Aufrufer.
function buildExport(mods, targetLangs, targetDir, sourceLang = SOURCE_LANG, workRoot = null) {
  const langs = normalizeLangs(targetLangs)
  const outRoot = path.join(targetDir, `${bundleFolderBaseName(mods)}-${folderLangSuffix(langs)}`)
  assertWritable(outRoot)
  fs.mkdirSync(outRoot, { recursive: true })

  const id = mods.length === 1 ? singleModInfoId(mods[0], langs) : bundleModInfoId(mods, langs)
  const name = bundleDisplayName(mods, langs)
  const author = TOOL_AUTHOR
  const langList = langDisplayList(langs)
  const description = mods.length === 1
    ? (mods[0].isBaseGame
        ? `Community translation of the Project Zomboid base game into ${langList}.`
        : `Community translation of ${mods[0].name} into ${langList}.`)
    : `Community translation bundle (${mods.length} mods) into ${langList}.`
  // icon.png: das erste Poster, das vorhanden ist (bei einem Mod: dessen Poster).
  let iconSrc = null
  for (const mod of mods) {
    iconSrc = findIconSrc(mod)
    if (iconSrc) break
  }
  // loadModAfter=: die mod.info-id der Quell-Mods (dedupliziert, Reihenfolge
  // der Auswahl), Basisspiel/unbekannt (modInfoId null) fällt raus.
  const loadModAfter = [...new Set(mods.map((m) => m.modInfoId).filter((x) => typeof x === 'string' && x))]

  const written = new Set(writeModInfoFile(outRoot, { id, name, author, description, iconSrc, loadModAfter }))

  // Merge: lang -> Dateiname -> gemergte Map. Reihenfolge: pro Mod (in
  // Auswahlreihenfolge) seine Layout-Orte in Scanner-Reihenfolge (common/root,
  // dann neueste Version) — spätere Quelle gewinnt bei Key-Kollision.
  const perLang = new Map(langs.map((lang) => [lang, new Map()]))
  for (const mod of mods) {
    for (const { rel, vdir } of layoutLocations(mod, sourceLang)) {
      for (const lang of langs) {
        const files = readLocationTranslations(vdir, lang, sourceLang, { workRoot, mod, version: rel })
        const acc = perLang.get(lang)
        for (const [fileName, obj] of Object.entries(files)) {
          if (!acc.has(fileName)) acc.set(fileName, {})
          Object.assign(acc.get(fileName), obj)
        }
      }
    }
  }

  // Gemergte Dateien schreiben — immer JSON, unter common/.../<LANG>/.
  for (const [lang, files] of perLang) {
    for (const [fileName, obj] of files) {
      if (!Object.keys(obj).length) continue
      const relPath = path.join('common', 'media', 'lua', 'shared', 'Translate', lang, fileName)
      writeJson(path.join(outRoot, relPath), obj)
      written.add(toPosix(relPath))
    }
  }

  // mods.map(id).join(' + ') ist bei einem Element exakt dieses eine mod.id
  // (kein Trenner ohne zweites Element) — exportMod muss modId nicht separat bilden.
  return { modId: mods.map((m) => m.id).join(' + '), targetPath: toPosix(outRoot), written, targetLangs: langs }
}

// Ein Mod exportieren. Liest die Zielsprachen-Dateien direkt aus dem Mod
// (Pre-Fill und gespeicherte Werte sind identisch = die Werte der Datei). Dünner
// Aufruf von buildExport mit einem einelementigen Array — `written` bleibt
// bewusst in Einfüge-Reihenfolge (unsortiert), das ist das historische,
// getestete Verhalten dieser Funktion und unterscheidet sich damit von
// exportModsBundle, das sortiert. Bei genau einer Sprache ist das Ergebnis
// bit-identisch zum bisherigen Einzelsprachen-Export (Ordnername/id/Name).
function exportMod(mod, targetLangs, targetDir, sourceLang = SOURCE_LANG, workRoot = null) {
  const { modId, targetPath, written, targetLangs: langs } = buildExport([mod], targetLangs, targetDir, sourceLang, workRoot)
  return { modId, targetPath, written: [...written], targetLangs: langs }
}

// Mehrere ausgewählte Mods in EINE installierbare Mod bündeln.
//
// Ziel: <targetDir>/<Name>-<DE>[-<FR>...]/ — ein einziger Mod, der alle
// Übersetzungen der Auswahl in ALLEN gewählten Sprachen enthält (statt je einem
// Ordner pro Mod bzw. je einem Mod pro Sprache).
//   - Ordnername: ein Mod → sein Name; mehrere → fester Name + Anzahl (C4).
//   - Anzeigename (`name=`): dieselbe Regel wie beim Ordnernamen (Nachbesserung 1).
//   - EINE mod.info im festen Versionsordner (wie exportMod); id deterministisch
//     aus der sortierten Menge der Mod-ids + Zielsprachen-Menge (Auswahlreihenfolge
//     egal); loadModAfter= aus der Auswahlreihenfolge (Reihenfolge relevant).
//   - Übersetzte Dateien aller Mods werden je Sprache in EINEN common/-Baum
//     gemergt: gleiche Zielpfade (z. B. beide common/.../DE/UI.json) vereinigen
//     ihre Key-Mengen; bei Key-Kollision gewinnt der spätere Mod (Reihenfolge
//     von modIds). Sprachen selbst überschreiben sich nie (eigener Ordner je
//     Sprache).
//   - icon.png: das erste vorhandene Poster der Auswahl.
// Ein einzelner Mod mit genau einer Sprache erzeugt exakt dasselbe Ergebnis wie
// exportMod(), bis auf die Reihenfolge von `written` (hier alphabetisch
// sortiert, s. buildExport).
function exportModsBundle(mods, targetLangs, targetDir, sourceLang = SOURCE_LANG, workRoot = null) {
  const { modId, targetPath, written, targetLangs: langs } = buildExport(mods, targetLangs, targetDir, sourceLang, workRoot)
  return { modId, targetPath, written: [...written].sort(), targetLangs: langs }
}

module.exports = {
  exportMod,
  exportModsBundle,
  layoutLocations,
  singleModInfoId,
  bundleModInfoId,
  sanitizeFolderName,
  bundleFolderBaseName
}
