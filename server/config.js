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
  sourceLang: 'EN',
  targetLang: 'DE'
}

// Fallback, wenn ein aufrufendes Modul kein sourceLang übergibt (siehe
// scanner.scan() / llm-io.js / mod-export.js Default-Parameter) — deckt sich
// mit DEFAULTS.sourceLang oben.
const SOURCE_LANG = 'EN'

function load() {
  // config.json existieren lassen: existiert die Datei nicht, gibt load()
  // DEFAULTS zurück, OHNE die Datei anzulegen — nur save() schreibt.
  // (Davor hat load() DEFAULTS persistiert, wodurch im Fake-Mode ein
  // config.json mit Steam-Pfaden im Projektroot landete.)
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS }
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

// Gleiche Auffassung von "gültig" wie targetLangOf() in server/index.js:
// nur die Länge zählt (2-4 Zeichen), kein Alphabet-Check.
function isValidLangCode(v) {
  return typeof v === 'string' && v.length >= 2 && v.length <= 4
}

function isExistingDir(p) {
  if (typeof p !== 'string' || !p) return false
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Validiert einen an POST /api/config übergebenen Body, BEVOR save()
// geschrieben wird. Fehlt ein Feld im Body, zieht die Prüfung den zuletzt
// gespeicherten (bzw. Default-)Wert heran — genau wie save() es beim Mergen
// tut, damit ein Teil-Update nicht an einem Feld scheitert, das gar nicht
// geändert wurde. Gibt eine Liste lesbarer Fehlermeldungen zurück; ein
// leeres Array heißt gültig.
function validate(body) {
  const merged = { ...load(), ...body }
  const errors = []

  if (!isExistingDir(merged.gameRoot)) {
    errors.push(`Game folder does not exist or is not a directory: ${merged.gameRoot}`)
  }
  if (!isExistingDir(merged.workshopDir)) {
    errors.push(`Workshop folder does not exist or is not a directory: ${merged.workshopDir}`)
  }
  if (!isValidLangCode(merged.targetLang)) {
    errors.push('Target language must be 2 to 4 letters.')
  }
  if (!isValidLangCode(merged.sourceLang)) {
    errors.push('Source language must be 2 to 4 letters.')
  }

  if (
    isValidLangCode(merged.sourceLang) &&
    isValidLangCode(merged.targetLang) &&
    String(merged.sourceLang).toUpperCase() === String(merged.targetLang).toUpperCase()
  ) {
    errors.push('Source and target language must not be the same.')
  }

  return errors
}

module.exports = { load, save, validate, toPosix, DEFAULTS, SOURCE_LANG, CONFIG_PATH }
