// Liest/schreibt config.json im Projektroot (git-ignoriert).
// Pfade sind immer POSIX-Style ("/"), auch auf Windows.
const fs = require('node:fs')
const path = require('node:path')

// Laufzeit: config.json im Projektroot (git-ignoriert); PT_CONFIG_PATH erlaubt
// einen anderen Ort (Tests).
const CONFIG_PATH =
  process.env.PT_CONFIG_PATH || path.join(__dirname, '..', 'config.json')

const DEFAULTS = {
  gameRoot: 'C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid',
  workshopDir: 'C:/Program Files (x86)/Steam/steamapps/workshop/content/108600',
  targetLang: 'DE'
}

// sourceLang ist fix EN: Konstante, kein Feld in der UI und kein Feld in der Config.
const SOURCE_LANG = 'EN'

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(config) {
  const merged = { ...DEFAULTS, ...config }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  return merged
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}

module.exports = { load, save, toPosix, DEFAULTS, SOURCE_LANG, CONFIG_PATH }
