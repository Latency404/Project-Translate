// Mod-Export: erzeugt einen installierbaren Übersetzungs-Mod.
//
// Ziel: <targetDir>/<ModName>-<targetLang>/
//   mod.info                                   (am Root, game_version = höchste Version)
//   icon.png                                   (falls die Quelle eine hat)
//   <version>/media/lua/shared/Translate/<targetLang>/<Kategorie>.json
// Es werden nur übersetzte Einträge exportiert (translation !== null), pro
// Version eigene Dateien wie im echten Mod. Leere Dateien werden nicht erzeugt.
const fs = require('node:fs')
const path = require('node:path')
const { versionDirOf, toPosix } = require('./scanner')

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

// Ein Mod exportieren. Liest die targetLang-Dateien direkt aus dem Mod (Pre-Fill
// und gespeicherte Werte sind identisch = die Werte der Datei).
function exportMod(mod, targetLang, targetDir) {
  const outRoot = path.join(targetDir, `${mod.name}-${targetLang}`)
  fs.mkdirSync(outRoot, { recursive: true })
  const written = []

  // mod.info am Root (Einordnung: ein mod.info, game_version = höchste Version).
  // Das Basisspiel hat keinen Version-Ordner → kein game_version-Feld.
  const version = mod.isBaseGame ? null : highestVersion(mod.versions)
  const infoLines = [
    `name=${mod.name} Translation (${targetLang})`,
    `author=Project Translate`,
    version ? `game_version=${version}` : ''
  ].filter(Boolean)
  const infoPath = path.join(outRoot, 'mod.info')
  fs.writeFileSync(infoPath, infoLines.join('\n') + '\n', 'utf8')
  written.push(toPosix(path.relative(targetDir, infoPath)))

  // icon.png falls die Quelle eine hat.
  if (mod.poster) {
    for (const candidate of [path.basename(mod.poster), 'icon.png']) {
      const src = path.join(path.dirname(mod.poster), candidate)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outRoot, 'icon.png'))
        written.push(toPosix(path.relative(targetDir, path.join(outRoot, 'icon.png'))))
        break
      }
    }
  }

  // Übersetzte Einträge pro Version.
  for (const v of mod.versions) {
    const vdir = versionDirOf(mod, v)
    const tgtDir = path.join(vdir, 'media', 'lua', 'shared', 'Translate', targetLang)
    if (!fs.existsSync(tgtDir)) continue
    const enDir = path.join(vdir, 'media', 'lua', 'shared', 'Translate', 'EN')
    let names = []
    try {
      names = fs.readdirSync(tgtDir).filter((f) => f.endsWith('.json')).sort()
    } catch {
      continue
    }
    for (const f of names) {
      const obj = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(tgtDir, f), 'utf8'))
        } catch {
          return null
        }
      })()
      if (!obj || typeof obj !== 'object') continue
      const en = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(enDir, f), 'utf8'))
        } catch {
          return null
        }
      })()
      // Nur Keys, die auch in EN existieren (unmatched-Keys aus Import verwerfen).
      const out = {}
      for (const [k, val] of Object.entries(obj)) {
        if (typeof val === 'string' && val !== '' && en && k in en) out[k] = val
      }
      if (!Object.keys(out).length) continue
      // Basisspiel: kein Version-Ordner, Translate direkt am Mod-Root
      const rel = mod.isBaseGame
        ? path.join('media', 'lua', 'shared', 'Translate', targetLang, f)
        : path.join(v, 'media', 'lua', 'shared', 'Translate', targetLang, f)
      writeJson(path.join(outRoot, rel), out)
      written.push(toPosix(rel))
    }
  }
  return { modId: mod.id, targetPath: toPosix(outRoot), written }
}

module.exports = { exportMod, highestVersion }
