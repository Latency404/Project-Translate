// Mod-Export: erzeugt einen installierbaren Übersetzungs-Mod.
//
// Ziel: <targetDir>/<ModName>-<targetLang>/
//   mod.info                                   (am Root, game_version = höchste Version;
//                                              fehlt bei reinen common/root-Layouts und
//                                              beim Basisspiel)
//   icon.png                                   (falls die Quelle eine hat)
//   [common/][<version>/]media/lua/shared/Translate/<targetLang>/<Datei>
//
// Es werden nur übersetzte Einträge exportiert (non-empty String-Value, der auch
// in der EN-Datei existiert). Layout-Traversal wie scanner.scan():
// common → root (nur wenn kein common) → Versionen. JSON und TXT (Lua-Translate)
// werden unterstützt; TXT wird als Lua-Table serialisiert. Leere Dateien werden
// nicht erzeugt.
const fs = require('node:fs')
const path = require('node:path')
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

// Ein Mod exportieren. Liest die targetLang-Dateien direkt aus dem Mod (Pre-Fill
// und gespeicherte Werte sind identisch = die Werte der Datei).
function exportMod(mod, targetLang, targetDir) {
  const outRoot = path.join(targetDir, `${mod.name}-${targetLang}`)
  fs.mkdirSync(outRoot, { recursive: true })
  const written = []

  // mod.info am Root. game_version = höchste Version; bei reinen common/root-
  // Layouts (versions leer) und beim Basisspiel fehlt das Feld.
  const version = mod.isBaseGame ? null : highestVersion(mod.versions)
  const infoLines = [
    `name=${mod.name} Translation (${targetLang})`,
    `author=Project Translate`,
    version ? `game_version=${version}` : ''
  ].filter(Boolean)
  const infoPath = path.join(outRoot, 'mod.info')
  fs.writeFileSync(infoPath, infoLines.join('\n') + '\n', 'utf8')
  written.push(toPosix('mod.info'))

  // icon.png falls die Quelle eine hat.
  if (mod.poster) {
    for (const candidate of [path.basename(mod.poster), 'icon.png']) {
      const src = path.join(path.dirname(mod.poster), candidate)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outRoot, 'icon.png'))
        written.push('icon.png')
        break
      }
    }
  }

  // Übersetzte Einträge pro Stelle (common / root / Versionen).
  for (const { rel, vdir } of layoutLocations(mod)) {
    const enDir = translateDir(vdir, SOURCE_LANG)
    const tgtDir = translateDir(vdir, targetLang)
    let names
    try {
      names = fs.readdirSync(enDir).sort()
    } catch {
      continue
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
      const tgtFileName = targetFileName(f, targetLang, enDir)
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
      if (isTxt) {
        // Lua-Tabelle heißt nach dem targetLang-Dateinamen: Sandbox_DE.txt → Sandbox_DE.
        writeLua(path.join(outRoot, relPath), tgtFileName.slice(0, -4), out)
      } else {
        writeJson(path.join(outRoot, relPath), out)
      }
      written.push(toPosix(relPath))
    }
  }
  return { modId: mod.id, targetPath: toPosix(outRoot), written }
}

// Mehrere ausgewählte Mods in EINE installierbare Mod bündeln.
//
// Ziel: <targetDir>/<Name>-<targetLang>/ — ein einziger Mod, der alle
// Übersetzungen der Auswahl enthält (statt je einem Ordner pro Mod).
//   - Ein Mod = ein Name: ein Mod → sein Name; mehrere → die Namen mit " + ".
//   - mod.info am Root; game_version = höchste Version über alle (nicht Base).
//   - Übersetzte Dateien aller Mods werden in EINEN Baum gemergt: gleiche
//     Zielpfade (z. B. beide common/.../DE/UI.json) vereinigen ihre Key-Mengen;
//     bei Key-Kollision gewinnt der spätere Mod (in der Reihenfolge von modIds).
//   - icon.png: das erste vorhandene Poster der Auswahl.
// Ein einzelner Mod erzeugt exakt dasselbe Ergebnis wie exportMod().
function exportModsBundle(mods, targetLang, targetDir) {
  const combined = mods.length === 1 ? mods[0].name : mods.map((m) => m.name).join(' + ')
  const outRoot = path.join(targetDir, `${combined}-${targetLang}`)
  fs.mkdirSync(outRoot, { recursive: true })
  const written = new Set()

  // mod.info am Root. game_version = höchste Version über alle Nicht-Base-Mods.
  const allVersions = mods.flatMap((m) => (m.isBaseGame ? [] : m.versions))
  const version = highestVersion(allVersions)
  const infoLines = [
    `name=${combined} Translation (${targetLang})`,
    `author=Project Translate`,
    version ? `game_version=${version}` : ''
  ].filter(Boolean)
  fs.writeFileSync(path.join(outRoot, 'mod.info'), infoLines.join('\n') + '\n', 'utf8')
  written.add(toPosix('mod.info'))

  // icon.png: das erste Poster, das vorhanden ist.
  for (const mod of mods) {
    if (!mod.poster) continue
    for (const candidate of [path.basename(mod.poster), 'icon.png']) {
      const src = path.join(path.dirname(mod.poster), candidate)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outRoot, 'icon.png'))
        written.add('icon.png')
        break
      }
    }
    if (written.has('icon.png')) break
  }

  // Übersetzte Dateien aller Mods in EINEN Baum mergen (Key-Vereinigung pro Pfad).
  const fileAcc = new Map() // relPath -> { isTxt, fileName, merged }
  for (const mod of mods) {
    for (const { rel, vdir } of layoutLocations(mod)) {
      const enDir = translateDir(vdir, SOURCE_LANG)
      const tgtDir = translateDir(vdir, targetLang)
      let names
      try {
        names = fs.readdirSync(enDir).sort()
      } catch {
        continue
      }
      for (const f of names) {
        const isTxt = f.toLowerCase().endsWith('.txt')
        const isJson = f.toLowerCase().endsWith('.json')
        if (!isTxt && !isJson) continue
        // EN-Datei als Quelle der gültigen Keys (wie exportMod).
        const en = isTxt ? readTxtMap(path.join(enDir, f)) : readFlatMap(path.join(enDir, f))
        if (!en) continue
        const tgtFileName = targetFileName(f, targetLang, enDir)
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

  return { modId: mods.map((m) => m.id).join(' + '), targetPath: toPosix(outRoot), written: [...written].sort() }
}

module.exports = { exportMod, exportModsBundle, highestVersion, layoutLocations }
