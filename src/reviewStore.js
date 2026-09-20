// Geteilter Session-State für ungespeicherte (dirty) Editor-Einträge — sowohl
// von Editor.jsx (liest/schreibt beim Bearbeiten und Speichern) als auch von
// Mods.jsx (liest nur, um den "Zu Prüfen"-Status zu berechnen, und schreibt
// nach einem JSON-Import) genutzt. Persistiert in localStorage, überlebt also
// View-Wechsel (Editor/Mods werden von App.jsx unmounted) UND das Schließen von
// Tab/Browser/App — man macht später dort weiter, wo man aufgehört hat. Ein
// Stand aus sessionStorage (Sitzungen vor dieser Umstellung) wird weiter gelesen
// und beim nächsten Schreiben nach localStorage übernommen.

const DIRTY_KEY = "pt_editor_dirty";

// dirty: Map("<lang>::<entryId>" -> { modId, value, origin, lang }).
// Der Sprachpräfix ist nötig, seit mehrere Zielsprachen gleichzeitig offen
// sein können: DIESELBE entryId kann in DE und FR unterschiedliche
// ungespeicherte Werte haben.
// origin ist "manual" (Standard) oder "import" (kam unverändert-ungespeichert
// aus einem LLM-JSON-Import, s. Mods.jsx) — Grundlage für den "Zu Prüfen"-
// Status: eine Mod gilt als "zu prüfen", solange sie mindestens einen offenen
// "import"-Eintrag hat.

function readRaw() {
  return localStorage.getItem(DIRTY_KEY) ?? sessionStorage.getItem(DIRTY_KEY);
}

// Alles Ungespeicherte verwerfen (auch einen Alt-Stand in sessionStorage).
export function clearDirty() {
  try {
    localStorage.removeItem(DIRTY_KEY);
    sessionStorage.removeItem(DIRTY_KEY);
  } catch { /* ignore */ }
}

// Sprachcodes enthalten nie ":", entryIds nie am Anfang — deshalb trennt das
// ERSTE "::" den Sprachcode sauber ab, auch wenn die entryId selbst ein "::"
// enthält (sie tut es: "<version>/<file>::<key>").
export function dirtyKey(lang, entryId) {
  return `${lang}::${entryId}`;
}

export function parseDirtyKey(key) {
  const i = key.indexOf("::");
  if (i === -1) return { lang: null, entryId: key };
  return { lang: key.slice(0, i), entryId: key.slice(i + 2) };
}

// `activeLang` wird gebraucht, um Einträge aus älteren Sessions (noch ohne
// Sprachpräfix) einer Sprache zuzuordnen — damals gab es nur eine.
export function loadDirty(activeLang) {
  try {
    const raw = readRaw();
    if (raw) {
      const pairs = JSON.parse(raw);
      if (Array.isArray(pairs)) {
        const out = new Map();
        for (const [key, val] of pairs) {
          const obj =
            val && typeof val === "object"
              ? { modId: val.modId ?? null, value: val.value, origin: val.origin || "manual", lang: val.lang || null }
              : { modId: null, value: val, origin: "manual", lang: null };
          if (obj.lang) {
            // Bereits im neuen Format (Key trägt den Sprachpräfix).
            out.set(key, obj);
          } else if (activeLang) {
            // Altes Format: nackte entryId, Sprache war die damals einzige.
            obj.lang = activeLang;
            out.set(dirtyKey(activeLang, key), obj);
          }
        }
        return out;
      }
    }
  } catch { /* ignore */ }
  return new Map();
}

// Gibt zurück, ob das Schreiben geklappt hat — ein Storage-Quota-Fehler
// (z. B. bei einem sehr großen LLM-Import) würde sonst lautlos verschluckt und
// die Einträge wären beim nächsten View-Wechsel (Editor liest sessionStorage
// frisch ein) spurlos weg, obwohl die Mods-Seite den React-State noch zeigt.
export function saveDirty(dirty) {
  try {
    if (dirty.size === 0) {
      clearDirty();
    } else {
      localStorage.setItem(DIRTY_KEY, JSON.stringify(Array.from(dirty.entries())));
      sessionStorage.removeItem(DIRTY_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

// Nur die Einträge einer Sprache, als Map(entryId -> { modId, value, origin }).
// Der Editor arbeitet immer in genau einer Sprache und braucht deshalb die
// entryId als Schlüssel, nicht den zusammengesetzten.
export function dirtyForLang(dirty, lang) {
  const out = new Map();
  for (const [key, val] of dirty) {
    if (val.lang === lang) out.set(parseDirtyKey(key).entryId, val);
  }
  return out;
}

// Set der modIds, die mindestens einen noch offenen (dirty) Import-Eintrag
// haben — Basis für den "Zu Prüfen"-Status auf der Mods-Seite und im Editor.
// Sprachübergreifend: eine Mod ist auch dann zu prüfen, wenn der offene
// Import eine andere als die gerade aktive Sprache betrifft.
export function reviewModIds(dirty) {
  const ids = new Set();
  for (const val of dirty.values()) {
    if (val.origin === "import" && val.modId != null) ids.add(val.modId);
  }
  return ids;
}

// Status einer Mod für Filter-Pillen/Tags: "review" (Import-Einträge noch
// offen) schlägt den aus translatedCount/entryCount abgeleiteten Stand.
// `translatedCount` ist der von der API für die AKTIVE Sprache gelieferte
// flache Wert (der Scan-Cache hält intern einen Wert je Sprache).
export function statusOf(mod, reviewIds) {
  if (reviewIds.has(mod.id)) return "review";
  if (mod.entryCount > 0 && mod.translatedCount === mod.entryCount) return "translated";
  return "open";
}

// Farbton je Status-Filter-Pille (Mods-Seite + Editor-Sidebar) — passend zum
// jeweiligen Status-Tag auf der Mod-Kachel: Open=warning, Translated=success,
// Needs Review=accent (USER-Wahl, übernimmt den Ton, den zuvor "All Mods"
// hatte). "All Mods" selbst ist jetzt Slate (#596973, USER-Wahl) wie die
// aktiven File-Filter-Pillen im Editor ("All Files" / <Datei>.json).
// "Selected" (nur die aktuell ausgewählten Mods) trägt denselben Ton wie
// "All Mods" — beide sind reine Mengen-Filter, kein Übersetzungsstatus.
export const FILTER_TONE_CLASS = {
  all: "bg-slate text-text",
  selected: "bg-slate text-text",
  open: "bg-warning/15 text-warning",
  translated: "bg-success/15 text-success",
  review: "bg-accent/15 text-accent",
};

// Anzeige-Name ohne den "(Base Game)"-Zusatz — der volle Name (mod.name) bleibt
// als Backend-Wert unverändert (Export-Ordnernamen etc. hängen daran).
export function displayModName(mod) {
  return mod.name.replace(/\s*\(Base Game\)\s*$/, "");
}

// Die Mods-Auswahl (pt_library_selected) — nur die Mods-Seite schreibt sie;
// Editor und der globale Export-Mod-Button lesen sie.
export function loadSelectedModIds() {
  try {
    const raw = sessionStorage.getItem("pt_library_selected");
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

// Such-Filter der Mod-Listen (Mods-Seite + Editor-Sidebar): Treffer im Namen oder in der id.
export function matchesModSearch(mod, search) {
  if (search.trim() === "") return true;
  const q = search.toLowerCase();
  return mod.name.toLowerCase().includes(q) || mod.id.toLowerCase().includes(q);
}

// Sortierung der Mod-Listen: Basisspiel zuerst.
export function baseGameFirst(a, b) {
  return Number(b.isBaseGame) - Number(a.isBaseGame);
}

// Anzahl je Status-Pille (open / translated / review).
export function statusCounts(mods, reviewIds) {
  const counts = { open: 0, translated: 0, review: 0 };
  for (const m of mods) counts[statusOf(m, reviewIds)] += 1;
  return counts;
}
