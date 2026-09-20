// Platzhalter und Formatierungscodes in Spieltexten (z. B. %1, {0}, <LINE>,
// <RGB:1,1,1>). Das Spiel ersetzt sie zur Laufzeit; fehlt einer in der
// Übersetzung oder kommt einer dazu, zeigt das Spiel falsche Texte oder Farben.
// Der Editor markiert sie im Original und warnt (ohne zu blockieren), wenn die
// Übersetzung von den Platzhaltern des Originals abweicht. Die Reihenfolge ist
// egal (Übersetzungen müssen sie oft verschieben), nur Art und Anzahl zählen.

// %1 %2 …, %s, %d, {0} {1} …, und Tags wie <LINE> <BR> <SPACE> <RGB:1,1,1> <IMAGE:x>.
const TOKEN_RE = /%\d+|%[sd]|\{\d+\}|<[A-Za-z]+(?::[^<>]*)?>/g;

// Text in Stücke zerlegen: [{ text, token: bool }] — für die Hervorhebung.
export function splitByPlaceholders(text) {
  const src = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index), token: false });
    parts.push({ text: m[0], token: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last), token: false });
  return parts;
}

// Reine Layout-Tags (Zeilenumbruch, Leerzeichen): Übersetzungen brechen Zeilen
// anders um, die Anzahl weicht legitim ab. Sie werden hervorgehoben, aber beim
// Vergleich ignoriert — sonst warnt der Editor bei fast jedem Tutorial-Text.
const LAYOUT_TOKEN_RE = /^<(LINE|BR|SPACE)>$/i;

function countTokens(text) {
  const counts = new Map();
  for (const m of String(text ?? "").matchAll(TOKEN_RE)) {
    if (LAYOUT_TOKEN_RE.test(m[0])) continue;
    counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  }
  return counts;
}

// Was jeder Platzhalter bedeutet, in einfachen Worten (Oberfläche ist Englisch).
export function describePlaceholder(token) {
  if (/^%\d+$|^%[sd]$|^\{\d+\}$/.test(token)) {
    return "a value the game fills in, such as a name or a number";
  }
  const name = /^<([A-Za-z]+)/.exec(token)?.[1].toUpperCase();
  switch (name) {
    case "LINE":
    case "BR":
      return "a line break";
    case "SPACE":
      return "a space";
    case "RGB":
      return "a text color";
    case "IMAGE":
      return "an icon";
    case "SIZE":
      return "the text size";
    case "INDENT":
      return "an indent";
    case "CENTRE":
    case "CENTER":
    case "LEFT":
    case "RIGHT":
      return "text alignment";
    default:
      return "a formatting code";
  }
}

// Vergleich Original ↔ Übersetzung. missing: im Original, aber nicht (oft genug)
// in der Übersetzung; extra: in der Übersetzung, aber nicht im Original.
// Beide sind Listen einzelner Tokens ohne Duplikate.
export function comparePlaceholders(original, translation) {
  const o = countTokens(original);
  const t = countTokens(translation);
  const missing = [];
  const extra = [];
  for (const [tok, n] of o) if ((t.get(tok) || 0) < n) missing.push(tok);
  for (const [tok, n] of t) if ((o.get(tok) || 0) < n) extra.push(tok);
  return { missing, extra };
}
