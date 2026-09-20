// Die Sprachen, die Project Zomboid kennt — Spiegel von server/langs.js
// (dieselben Codes, dieselben Namen). EN ist die Quellsprache, steht aber
// trotzdem zur Wahl: wer die englische Fassung selbst umformulieren will,
// nimmt sie als Zielsprache. Quelle und Ziel sind dann dieselbe Datei.
//
// Achtung: ES_CL/ES_MX sind 5 Zeichen lang.
export const LANG_NAMES = {
  AR: "Arabic",
  CA: "Catalan",
  CH: "Chinese (Traditional)",
  CN: "Chinese (Simplified)",
  CS: "Czech",
  DA: "Danish",
  DE: "German",
  EN: "English",
  ES: "Spanish",
  ES_CL: "Spanish (Chile)",
  ES_MX: "Spanish (Mexico)",
  FI: "Finnish",
  FR: "French",
  HU: "Hungarian",
  ID: "Indonesian",
  IT: "Italian",
  JP: "Japanese",
  KO: "Korean",
  NL: "Dutch",
  NO: "Norwegian",
  PL: "Polish",
  PT: "Portuguese",
  PTBR: "Portuguese (Brazil)",
  RO: "Romanian",
  RU: "Russian",
  TH: "Thai",
  TR: "Turkish",
  UA: "Ukrainian",
};

export const TARGET_LANGS = Object.keys(LANG_NAMES).sort();

// "German (DE)" — überall dort, wo Platz ist. Unbekannte Codes (z. B. aus
// einer von Hand bearbeiteten config.json) geben einfach den Code zurück.
export function langLabel(code) {
  const name = LANG_NAMES[code];
  return name ? `${name} (${code})` : String(code);
}

export function langName(code) {
  return LANG_NAMES[code] || String(code);
}
