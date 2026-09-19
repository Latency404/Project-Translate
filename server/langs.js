// Die Sprachen, die Project Zomboid B42 kennt — 1:1 die Ordnernamen unter
// media/lua/shared/Translate/ der echten Installation.
// Nicht enthalten: STREW — ein Pseudo-Ordner des Spiels, keine echte Sprache.
//
// EN ist die Quellsprache (fest, nicht konfigurierbar) und steht TROTZDEM in
// TARGET_LANGS: wer die englische Fassung selbst umformulieren will, wählt sie
// als Ziel. Die Änderungen landen wie bei jeder Sprache im Arbeitsordner; die
// Originaltexte der Mod bleiben unverändert (Spiel/Workshop sind schreibgeschützt).
//
// Achtung: ES_CL/ES_MX sind 5 Zeichen lang; jede Längenprüfung für Sprachcodes
// muss 2..5 zulassen (config.validate).
const SOURCE_LANG = 'EN'

// code → lesbarer Name (die Oberfläche spricht Englisch).
const LANG_NAMES = {
  AR: 'Arabic',
  CA: 'Catalan',
  CH: 'Chinese (Traditional)',
  CN: 'Chinese (Simplified)',
  CS: 'Czech',
  DA: 'Danish',
  DE: 'German',
  EN: 'English',
  ES: 'Spanish',
  ES_CL: 'Spanish (Chile)',
  ES_MX: 'Spanish (Mexico)',
  FI: 'Finnish',
  FR: 'French',
  HU: 'Hungarian',
  ID: 'Indonesian',
  IT: 'Italian',
  JP: 'Japanese',
  KO: 'Korean',
  NL: 'Dutch',
  NO: 'Norwegian',
  PL: 'Polish',
  PT: 'Portuguese',
  PTBR: 'Portuguese (Brazil)',
  RO: 'Romanian',
  RU: 'Russian',
  TH: 'Thai',
  TR: 'Turkish',
  UA: 'Ukrainian'
}

// Alphabetisch nach Code — die Reihenfolge, in der die Oberfläche sie zeigt.
const TARGET_LANGS = Object.keys(LANG_NAMES).sort()

function isKnownLang(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANG_NAMES, code.toUpperCase())
}

function langName(code) {
  return LANG_NAMES[String(code).toUpperCase()] || String(code)
}

module.exports = { SOURCE_LANG, TARGET_LANGS, LANG_NAMES, isKnownLang, langName }
