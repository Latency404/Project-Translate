// Liest/schreibt config.json im Projektroot (git-ignoriert).
// Pfade sind immer POSIX-Style ("/"), auch auf Windows.
const fs = require('node:fs')
const path = require('node:path')
const { SOURCE_LANG, isKnownLang } = require('./langs')

// Laufzeit: config.json im Projektroot (git-ignoriert); PT_CONFIG_PATH erlaubt
// einen anderen Ort (Tests).
const CONFIG_PATH =
  process.env.PT_CONFIG_PATH || path.join(__dirname, '..', 'config.json')

// Quellsprache ist fest EN (nicht mehr konfigurierbar) — kommt aus langs.js,
// hier nur re-exportiert, weil andere Module weiterhin config.SOURCE_LANG
// importieren.
const DEFAULTS = {
  gameRoot: 'C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid',
  workshopDir: 'C:/Program Files (x86)/Steam/steamapps/workshop/content/108600',
  targetLangs: ['DE'],
  activeLang: 'DE'
}

// Normalisiert eine Zielsprachen-Angabe (Array oder — rückwärtskompatibel —
// ein einzelner String) zu einem nicht-leeren Array aus Großbuchstaben-Codes,
// ohne Duplikate und ohne EN. Fällt eine leere/ungültige Liste heraus, gilt
// DEFAULTS.targetLangs.
function normalizeTargetLangs(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' && input ? [input] : []
  const seen = new Set()
  const result = []
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw) continue
    const code = raw.toUpperCase()
    if (seen.has(code)) continue
    seen.add(code)
    result.push(code)
  }
  return result.length ? result : [...DEFAULTS.targetLangs]
}

// activeLang muss immer ein Element von targetLangs sein — sonst gilt
// targetLangs[0].
function normalizeActiveLang(activeLang, targetLangs) {
  if (typeof activeLang === 'string') {
    const upper = activeLang.toUpperCase()
    if (targetLangs.includes(upper)) return upper
  }
  return targetLangs[0]
}

function load() {
  // config.json existieren lassen: existiert die Datei nicht, gibt load()
  // DEFAULTS zurück, OHNE die Datei anzulegen — nur save() schreibt.
  // (Davor hat load() DEFAULTS persistiert, wodurch im Fake-Mode ein
  // config.json mit Steam-Pfaden im Projektroot landete.)
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    // sourceLang gibt es nicht mehr — ein evtl. in einer alten config.json
    // vorhandenes Feld wird beim Lesen verworfen. targetLang (alt, String)
    // wird zu targetLangs/activeLang migriert. Die migrierte Form wird NICHT
    // hier geschrieben, sondern erst beim nächsten save() persistiert.
    const { sourceLang, targetLang, targetLangs, activeLang, ...rest } = parsed
    const merged = { ...DEFAULTS, ...rest }
    merged.targetLangs = normalizeTargetLangs(targetLangs !== undefined ? targetLangs : targetLang)
    merged.activeLang = normalizeActiveLang(
      activeLang !== undefined ? activeLang : targetLang,
      merged.targetLangs
    )
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

function save(config) {
  const merged = { ...DEFAULTS, ...config }
  // targetLang/sourceLang nie in die Datei schreiben — nur die neuen Felder.
  delete merged.targetLang
  delete merged.sourceLang
  merged.targetLangs = normalizeTargetLangs(
    config.targetLangs !== undefined ? config.targetLangs : config.targetLang
  )
  merged.activeLang = normalizeActiveLang(
    config.activeLang !== undefined ? config.activeLang : config.targetLang,
    merged.targetLangs
  )
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  return merged
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}

function isExistingDir(p) {
  if (typeof p !== 'string' || !p) return false
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Inhaltsprüfung: ein existierender Ordner muss auch wirklich nach Project
// Zomboid aussehen. Spiel: media/lua/shared/Translate (Layout des Scanners).
// Workshop: mindestens ein <PublishedFileID>/mods-Ordner.
function isGameRoot(p) {
  return isExistingDir(path.join(String(p), 'media', 'lua', 'shared', 'Translate'))
}

function isWorkshopDir(p) {
  if (!isExistingDir(p)) return false
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .some((d) => d.isDirectory() && isExistingDir(path.join(p, d.name, 'mods')))
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
  const saved = load()
  const errors = []

  if (!isExistingDir(body.gameRoot !== undefined ? body.gameRoot : saved.gameRoot)) {
    errors.push('Game folder does not exist.')
  } else if (!isGameRoot(body.gameRoot !== undefined ? body.gameRoot : saved.gameRoot)) {
    errors.push('Game folder is not a Project Zomboid installation.')
  }
  if (!isExistingDir(body.workshopDir !== undefined ? body.workshopDir : saved.workshopDir)) {
    errors.push('Workshop folder does not exist.')
  } else if (!isWorkshopDir(body.workshopDir !== undefined ? body.workshopDir : saved.workshopDir)) {
    errors.push('Workshop folder contains no workshop mods.')
  }

  // targetLangs: Rückwärtskompatibilität — ein einzelnes targetLang (String)
  // wird wie [targetLang] gelesen (s. SPEC.md).
  const rawTargetLangs =
    body.targetLangs !== undefined
      ? body.targetLangs
      : body.targetLang !== undefined
        ? [body.targetLang]
        : saved.targetLangs
  const targetLangsArray = Array.isArray(rawTargetLangs)
    ? rawTargetLangs
    : typeof rawTargetLangs === 'string' && rawTargetLangs
      ? [rawTargetLangs]
      : []

  if (targetLangsArray.length === 0) {
    errors.push('Select at least one target language.')
  } else {
    for (const raw of targetLangsArray) {
      const code = typeof raw === 'string' ? raw.toUpperCase() : raw
      // EN ist erlaubt: wer die englische Fassung selbst umschreiben will,
      // waehlt sie als Ziel (s. server/langs.js).
      if (typeof code !== 'string' || code.length < 2 || code.length > 5 || !isKnownLang(code)) {
        errors.push(`Unknown target language: ${raw}.`)
      }
    }
  }

  if (body.activeLang !== undefined) {
    const upperTargetLangs = targetLangsArray
      .filter((c) => typeof c === 'string')
      .map((c) => c.toUpperCase())
    if (!upperTargetLangs.includes(String(body.activeLang).toUpperCase())) {
      errors.push('Active language must be one of the selected target languages.')
    }
  }

  return errors
}

module.exports = {
  load,
  save,
  validate,
  isGameRoot,
  isWorkshopDir,
  toPosix,
  DEFAULTS,
  SOURCE_LANG,
  CONFIG_PATH
}
