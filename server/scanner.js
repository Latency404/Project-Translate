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
// Ein Published-File kann mehrere Mods enthalten: jeder Unterordner unter mods/
// zählt als eigener Mod mit id = <PublishedFileID>/<Unterordnername>.
//
// Base Game:
//   <gameRoot>/media/lua/shared/Translate/<LANG>/<Kategorie>.json
//   id = BASE, name = "Project Zomboid (Base Game)", versions = ["base"],
//   rootPath = gameRoot (es gibt keinen Version-Ordner).
//
// JSON-Dateien sind flache key → string-Maps. Einträge in JSON-Datei-Reihenfolge
// (Insertion Order), Dateien alphabetisch. Pfade immer POSIX-Style.
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
function versionDirOf(mod, version) {
  return mod.isBaseGame ? mod.rootPath : path.join(mod.rootPath, version)
}

function posterFor(modDir) {
  for (const name of ['poster.png', 'generic.png']) {
    const p = path.join(modDir, name)
    if (fs.existsSync(p)) return toPosix(p)
  }
  return null
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

// Einträge einer Version lesen: alle EN-Dateien (alphabetisch), Key-Reihenfolge
// wie in der Datei; translation aus der targetLang-Datei (null = fehlt).
function scanVersionEntries(mod, version, enDir, targetLang) {
  const entries = []
  if (!fs.existsSync(enDir)) return entries
  const langDir = path.join(path.dirname(enDir), targetLang)
  let names
  try {
    names = fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return entries
  }
  for (const f of names) {
    const enMap = readFlatMap(path.join(enDir, f))
    if (!enMap) continue
    const deMap = readFlatMap(path.join(langDir, f))
    const file = toPosix(path.relative(versionDirOf(mod, version), path.join(enDir, f)))
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
        preFilled: translation !== null
      })
    }
  }
  return entries
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
    const entries = summarize(baseMod, scanVersionEntries(baseMod, 'base', baseEnDir, targetLang))
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
      const mod = {
        id: `${pid}/${name}`,
        name,
        isBaseGame: false,
        // Nur die neueste Version (versionNames steht absteigend): ältere
        // Version-Ordner werden weder gescannt, übersetzt noch exportiert.
        versions: versionNames.slice(0, 1),
        rootPath: toPosix(modDir),
        poster: posterFor(modDir),
        entryCount: 0,
        translatedCount: 0
      }
      const entries = []
      for (const version of mod.versions) {
        const enDir = translateDir(path.join(modDir, version), SOURCE_LANG)
        entries.push(...scanVersionEntries(mod, version, enDir, targetLang))
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
