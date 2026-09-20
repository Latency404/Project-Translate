// Der letzte Scan-Stand auf der Platte (export/scan-cache.json), damit man nach
// einem Neustart nicht erst neu suchen muss. Reine Ablage des Scan-Caches: die
// Wahrheit bleiben Spiel/Workshop + Arbeitsordner. Geladen wird nur, wenn Pfade
// und Zielsprachen noch zu den Einstellungen passen, mit denen gescannt wurde;
// "Search Mods" liest alles frisch ein (z. B. nach einem Workshop-Update).
const fs = require('node:fs')
const path = require('node:path')
const { assertWritable } = require('./guard')

const FORMAT = 1

function sameLangs(a, b) {
  return Array.isArray(a) && a.length === b.length && b.every((l) => a.includes(l))
}

// meta = { gameRoot, workshopDir, langs } der aktuellen Einstellungen.
function load(file, meta) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (doc.format !== FORMAT) return null
    if (doc.gameRoot !== meta.gameRoot || doc.workshopDir !== meta.workshopDir) return null
    if (!sameLangs(doc.cache && doc.cache.langs, meta.langs)) return null
    if (!doc.cache || !Array.isArray(doc.cache.mods) || !doc.cache.entriesByModId) return null
    return doc.cache
  } catch {
    return null
  }
}

// Erst in eine Temp-Datei, dann umbenennen: ein Absturz mitten im Schreiben
// hinterlässt nie eine halbe scan-cache.json.
async function save(file, meta, cache) {
  assertWritable(file)
  const text = JSON.stringify({ format: FORMAT, gameRoot: meta.gameRoot, workshopDir: meta.workshopDir, scannedAt: new Date().toISOString(), cache })
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, text, 'utf8')
  await fs.promises.rename(tmp, file)
}

module.exports = { load, save }
