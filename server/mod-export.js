// Mod-Export: erzeugt einen installierbaren Übersetzungs-Mod.
//
// Ziel: <targetDir>/<ModName>-<targetLang>/
//   [common/][<version>/]mod.info             (je Layout-Ort eine eigene mod.info,
//                                              direkt neben dessen media/ — nur bei
//                                              echtem Root-Layout/Basisspiel am
//                                              Wurzelordner. id/name/author/
//                                              description gleich in jeder Datei;
//                                              versionMin nur, wenn der Ort ein
//                                              echter Versionsordner ist —
//                                              versionMax bewusst nie, s.u.)
//   [common/][<version>/]icon.png              (falls die Quelle ein Bild hat; via
//                                              poster=/icon= in derselben mod.info
//                                              deklariert)
//   [common/][<version>/]media/lua/shared/Translate/<targetLang>/<Datei>
//
// Format von mod.info gegen echte B42-Mods (Steam Workshop 108600) und pzwiki
// ("Mod.info", "Mod structure") verifiziert: `game_version` ist kein gültiger
// Schlüssel (kommt in keinem realen Mod vor) und fehlt daher; `id` ist Pflicht
// und liegt in jeder Kopie der Datei alphanumerisch + Unterstrich vor.
//
// Es werden nur übersetzte Einträge exportiert (non-empty String-Value, der auch
// in der EN-Datei existiert). Layout-Traversal wie scanner.scan():
// common → root (nur wenn kein common) → Versionen. JSON und TXT (Lua-Translate)
// werden unterstützt; TXT wird als Lua-Table serialisiert. Leere Dateien werden
// nicht erzeugt.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  versionDirOf,
  translateDir,
  toPosix,
  readFlatMap,
  readTxtMap,
  targetFileName,
  SOURCE_LANG
} = require('./scanner')
const { writeLua } = require('./entries')

const NUMBERED_VERSION_RE = /^\d+(\.\d+)*$/

// Höchste Version: numerisch segmentweise vergleichen (42.20 > 42.15 > 42).
function highestVersion(versions) {
  let best = null
  for (const v of versions) {
    const a = String(v).split('.').map(Number)
    const b = best ? String(best).split('.').map(Number) : null
    if (best === null) {
      best = v
      continue
    }
    const n = Math.max(a.length, b.length)
    let cmp = 0
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0
      const y = b[i] || 0
      if (x !== y) {
        cmp = x - y
        break
      }
    }
    if (cmp > 0) best = v
  }
  return best
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 4) + '\n', 'utf8')
}

// Nur [A-Za-z0-9_] — die einzigen Zeichen, die in echten mod.info-`id`-Werten
// vorkommen (gegen Steam-Workshop-Mods verifiziert). Alles andere → '_'.
function slugForId(s) {
  const cleaned = String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'mod'
}

// Deterministische id für einen einzelnen Mod + Zielsprache: derselbe Mod
// (mod.id enthält bereits die WorkshopId oder ist 'BASE') + dieselbe Sprache
// ergeben immer dieselbe id, damit ein erneuter Export den vorigen ersetzt statt
// zu duplizieren. Präfix 'pt_' verhindert eine Kollision mit der id des
// Quell-Mods selbst.
function singleModInfoId(mod, targetLang) {
  return `pt_${slugForId(mod.id)}_${targetLang}`
}

// Deterministische id für ein Bundle: hängt nur von der Menge der enthaltenen
// Mod-ids (sortiert, damit Auswahlreihenfolge egal ist) + Zielsprache ab.
// Kurzer Hash statt Namenskette, damit die id nicht mit der Mod-Anzahl wächst.
function bundleModInfoId(mods, targetLang) {
  const key = mods.map((m) => m.id).slice().sort().join('|')
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)
  return `pt_bundle_${hash}_${targetLang}`
}

// Ordnername sicher machen: unter Windows unzulässige Zeichen ersetzen, keine
// trailing dots/spaces, Länge begrenzen (Pfadlängen-Grenze).
function sanitizeFolderName(name, maxLen = 100) {
  let s = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  s = s.replace(/[. ]+$/, '')
  if (s.length > maxLen) s = s.slice(0, maxLen).trim()
  return s || 'Mod'
}

// Bundle-Ordnername: ein Mod → sein (sanitizter) Name; mehrere → ein fester
// Name + Anzahl, damit er bei vielen Mods nicht die Pfadlänge sprengt und keine
// verbotenen Zeichen aus Mod-Namen erbt.
function bundleFolderBaseName(mods) {
  if (mods.length === 1) return sanitizeFolderName(mods[0].name)
  return `Translation Bundle (${mods.length} mods)`
}

// Anzeigename fürs `name=`-Feld der mod.info: dieselbe Regel wie beim
// Ordnernamen (bundleFolderBaseName) — ein Mod → sein Name, mehrere → eine
// kurze zählende Form statt der mit ' + ' verketteten Namensliste, die bei
// vielen Mods eine unlesbare Zeile im Mod-Manager des Spiels ergibt.
function bundleDisplayName(mods, targetLang) {
  if (mods.length === 1) return `${mods[0].name} Translation (${targetLang})`
  return `Translation Bundle (${mods.length} mods) (${targetLang})`
}

// Übersetzungs-Stellen eines Mods: [{ rel, vdir }] — rel ist das Pfad-Prefix im
// exportierten Mod ('' für root/Base, 'common', Versionsnummer), vdir der
// Quell-Translate-Root. Gleiche Reihenfolge wie scanner.scan():
// common (exklusiv mit root), root nur ohne common, dann die Versionen.
function layoutLocations(mod) {
  if (mod.isBaseGame) {
    return [{ rel: '', vdir: mod.rootPath }]
  }
  const locs = []
  const commonDir = path.join(mod.rootPath, 'common')
  if (fs.existsSync(translateDir(commonDir, SOURCE_LANG))) {
    locs.push({ rel: 'common', vdir: commonDir })
  } else if (fs.existsSync(translateDir(mod.rootPath, SOURCE_LANG))) {
    locs.push({ rel: '', vdir: mod.rootPath })
  }
  for (const v of mod.versions) {
    locs.push({ rel: v, vdir: versionDirOf(mod, v) })
  }
  return locs
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

// Für jeden Layout-Ort eine eigene mod.info (+ ggf. icon.png) schreiben.
// id/name/author/description sind an jedem Ort identisch; versionMin nur an
// einem echten Versionsordner (common/root sind Fallback-Orte ohne
// Versionsbindung; versionMax wird nie geschrieben, s. Kopfkommentar).
// Gibt die geschriebenen Pfade (POSIX, relativ zu outRoot) zurück.
function writeModInfoFiles(outRoot, locations, { id, name, author, description, iconSrc }) {
  const written = []
  for (const { rel } of locations) {
    const locDir = path.join(outRoot, rel)
    fs.mkdirSync(locDir, { recursive: true })
    const lines = [
      `id=${id}`,
      `name=${name}`,
      `author=${author}`,
      `description=${description}`
    ]
    if (NUMBERED_VERSION_RE.test(rel)) {
      // Nur versionMin, kein versionMax: gegen die echten Workshop-Mods
      // verifiziert (909 mod.info-Dateien) — versionMin kommt in 58 % vor und
      // bedeutet "ab dieser Version", während versionMax nur in 7 % vorkommt
      // und dort als bewusster Deckel für aufgegebene/B41-only-Mods dient
      // (Werte wie 41.99, 42.12.99). Ein Übersetzungs-Mod ist mit künftigen
      // Spiel-Versionen kompatibel — versionMax würde ihn fälschlich als
      // inkompatibel markieren, sobald das Spiel darüber hinaus aktualisiert wird.
      lines.push(`versionMin=${rel}`)
    }
    let hasIcon = false
    if (iconSrc) {
      fs.copyFileSync(iconSrc, path.join(locDir, 'icon.png'))
      hasIcon = true
    }
    if (hasIcon) {
      lines.push('poster=icon.png')
      lines.push('icon=icon.png')
    }
    fs.writeFileSync(path.join(locDir, 'mod.info'), lines.join('\n') + '\n', 'utf8')
    written.push(toPosix(path.join(rel, 'mod.info')))
    if (hasIcon) written.push(toPosix(path.join(rel, 'icon.png')))
  }
  return written
}

// Übersetzte Dateien einer einzelnen Layout-Stelle einlesen: [{ relPath, isTxt,
// tgtFileName, out }] — out ist die gefilterte Key→Value-Map (nur übersetzte,
// in EN vorhandene Keys). Leere Ergebnisse werden ausgelassen.
function readTranslatedFiles(rel, vdir, targetLang) {
  const results = []
  const enDir = translateDir(vdir, SOURCE_LANG)
  const tgtDir = translateDir(vdir, targetLang)
  let names
  try {
    names = fs.readdirSync(enDir).sort()
  } catch {
    return results
  }
  for (const f of names) {
    const isTxt = f.toLowerCase().endsWith('.txt')
    const isJson = f.toLowerCase().endsWith('.json')
    if (!isTxt && !isJson) continue
    // EN-Datei (tolerant: Trailing Comma / Lua-Keys, TXT: Lua-Translate) —
    // die Quelle für die gültigen Keys.
    const en = isTxt ? readTxtMap(path.join(enDir, f)) : readFlatMap(path.join(enDir, f))
    if (!en) continue
    // Zieldatei: JSON identisch, TXT _EN → _<TGT>.
    const tgtFileName = targetFileName(f, targetLang)
    const tgtPath = path.join(tgtDir, tgtFileName)
    if (!fs.existsSync(tgtPath)) continue
    const tgt = isTxt ? readTxtMap(tgtPath) : readFlatMap(tgtPath)
    if (!tgt) continue
    // Nur übersetzte Keys, die auch in EN existieren (unmatched verwerfen).
    const out = {}
    for (const [k, val] of Object.entries(tgt)) {
      if (typeof val === 'string' && val !== '' && k in en) out[k] = val
    }
    if (!Object.keys(out).length) continue
    const relPath = path.join(rel, 'media', 'lua', 'shared', 'Translate', targetLang, tgtFileName)
    results.push({ relPath, isTxt, tgtFileName, out })
  }
  return results
}

// Gemeinsamer Kern von exportMod und exportModsBundle (D1): baut den Zielordner,
// eine mod.info je Layout-Ort (über alle Mods hinweg vereinigt) und mergt die
// übersetzten Dateien aller Mods in einen Baum. Nimmt IMMER ein Array (auch für
// den Einzelmod-Fall) — Ordnername, id, name/description und die Datei-Merge-Regel
// sind für ein einzelnes Element dieselben Regeln wie für mehrere, siehe
// bundleFolderBaseName/bundleDisplayName. `written` ist ein Set in
// Einfüge-Reihenfolge (mod.info/icon je Layout-Ort zuerst, dann die Dateien) —
// ob/wie sortiert wird, entscheidet der Aufrufer.
function buildExport(mods, targetLang, targetDir) {
  const outRoot = path.join(targetDir, `${bundleFolderBaseName(mods)}-${targetLang}`)
  fs.mkdirSync(outRoot, { recursive: true })

  // Layout-Orte über alle Mods hinweg (rel-Werte können sich über Mods
  // wiederholen, z. B. mehrere Mods mit '42.20' — mod.info dort nur einmal).
  // Für einen einzelnen Mod ist das exakt layoutLocations(mod).
  const locByRel = new Map()
  for (const mod of mods) {
    for (const loc of layoutLocations(mod)) {
      if (!locByRel.has(loc.rel)) locByRel.set(loc.rel, loc)
    }
  }
  const locations = [...locByRel.values()]

  const id = mods.length === 1 ? singleModInfoId(mods[0], targetLang) : bundleModInfoId(mods, targetLang)
  const name = bundleDisplayName(mods, targetLang)
  const author = 'Project Translate'
  const description = mods.length === 1
    ? (mods[0].isBaseGame
        ? `Community translation of the Project Zomboid base game into ${targetLang}.`
        : `Community translation of ${mods[0].name} into ${targetLang}.`)
    : `Community translation bundle (${mods.length} mods) into ${targetLang}.`
  // icon.png: das erste Poster, das vorhanden ist (bei einem Mod: dessen Poster).
  let iconSrc = null
  for (const mod of mods) {
    iconSrc = findIconSrc(mod)
    if (iconSrc) break
  }

  const written = new Set(writeModInfoFiles(outRoot, locations, { id, name, author, description, iconSrc }))

  // Übersetzte Dateien aller Mods in EINEN Baum mergen (Key-Vereinigung pro Pfad;
  // bei einem einzelnen Mod gibt es nie zwei Quellen für denselben relPath, das
  // Mergen ist dann ein No-Op).
  const fileAcc = new Map() // relPath -> { isTxt, fileName, merged }
  for (const mod of mods) {
    for (const { rel, vdir } of layoutLocations(mod)) {
      for (const { relPath, isTxt, tgtFileName, out } of readTranslatedFiles(rel, vdir, targetLang)) {
        if (!fileAcc.has(relPath)) fileAcc.set(relPath, { isTxt, fileName: tgtFileName, merged: {} })
        // Gleicher Pfad: Keys vereinigen, späterer Mod gewinnt bei Kollision.
        Object.assign(fileAcc.get(relPath).merged, out)
      }
    }
  }

  // Gemergte Dateien schreiben (JSON / TXT → Lua-Table).
  for (const [relPath, { isTxt, fileName, merged }] of fileAcc) {
    if (!Object.keys(merged).length) continue
    if (isTxt) {
      // Lua-Tabelle heißt nach dem targetLang-Dateinamen: Sandbox_DE.txt → Sandbox_DE.
      writeLua(path.join(outRoot, relPath), fileName.slice(0, -4), merged)
    } else {
      writeJson(path.join(outRoot, relPath), merged)
    }
    written.add(toPosix(relPath))
  }

  // mods.map(id).join(' + ') ist bei einem Element exakt dieses eine mod.id
  // (kein Trenner ohne zweites Element) — exportMod muss modId nicht separat bilden.
  return { modId: mods.map((m) => m.id).join(' + '), targetPath: toPosix(outRoot), written }
}

// Ein Mod exportieren. Liest die targetLang-Dateien direkt aus dem Mod (Pre-Fill
// und gespeicherte Werte sind identisch = die Werte der Datei). Dünner Aufruf von
// buildExport mit einem einelementigen Array — `written` bleibt bewusst in
// Einfüge-Reihenfolge (unsortiert), das ist das historische, getestete Verhalten
// dieser Funktion und unterscheidet sich damit von exportModsBundle, das sortiert.
function exportMod(mod, targetLang, targetDir) {
  const { modId, targetPath, written } = buildExport([mod], targetLang, targetDir)
  return { modId, targetPath, written: [...written] }
}

// Mehrere ausgewählte Mods in EINE installierbare Mod bündeln.
//
// Ziel: <targetDir>/<Name>-<targetLang>/ — ein einziger Mod, der alle
// Übersetzungen der Auswahl enthält (statt je einem Ordner pro Mod).
//   - Ordnername: ein Mod → sein Name; mehrere → fester Name + Anzahl (C4).
//   - Anzeigename (`name=`): dieselbe Regel wie beim Ordnernamen (Nachbesserung 1).
//   - mod.info je Layout-Ort (wie exportMod); id deterministisch aus der
//     sortierten Menge der Mod-ids + Zielsprache (Auswahlreihenfolge egal).
//   - Übersetzte Dateien aller Mods werden in EINEN Baum gemergt: gleiche
//     Zielpfade (z. B. beide common/.../DE/UI.json) vereinigen ihre Key-Mengen;
//     bei Key-Kollision gewinnt der spätere Mod (in der Reihenfolge von modIds).
//   - icon.png: das erste vorhandene Poster der Auswahl, an jedem Layout-Ort.
// Ein einzelner Mod erzeugt exakt dasselbe Ergebnis wie exportMod(), bis auf die
// Reihenfolge von `written` (hier alphabetisch sortiert, s. buildExport).
function exportModsBundle(mods, targetLang, targetDir) {
  const { modId, targetPath, written } = buildExport(mods, targetLang, targetDir)
  return { modId, targetPath, written: [...written].sort() }
}

module.exports = {
  exportMod,
  exportModsBundle,
  highestVersion,
  layoutLocations,
  singleModInfoId,
  bundleModInfoId,
  sanitizeFolderName,
  bundleFolderBaseName
}
