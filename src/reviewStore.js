// Geteilter Session-State für ungespeicherte (dirty) Editor-Einträge — sowohl
// von Editor.jsx (liest/schreibt beim Bearbeiten und Speichern) als auch von
// Mods.jsx (liest nur, um den "Zu Prüfen"-Status zu berechnen, und schreibt
// nach einem JSON-Import) genutzt. Persistiert in sessionStorage, überlebt
// also einen View-Wechsel (Editor/Mods werden von App.jsx unmounted).

const DIRTY_KEY = "pt_editor_dirty";

// dirty: Map(entryId -> { modId, value, origin }). origin ist "manual"
// (Standard, auch für aus älteren Sessions migrierte Einträge) oder "import"
// (kam unverändert-ungespeichert aus einem LLM-JSON-Import, s. Mods.jsx) —
// Grundlage für den "Zu Prüfen"-Status: eine Mod gilt als "zu prüfen",
// solange sie mindestens einen offenen "import"-Eintrag hat.
export function loadDirty() {
  try {
    const raw = sessionStorage.getItem(DIRTY_KEY);
    if (raw) {
      const pairs = JSON.parse(raw);
      if (Array.isArray(pairs)) {
        return new Map(
          pairs.map(([id, val]) => [
            id,
            val && typeof val === "object"
              ? { modId: val.modId ?? null, value: val.value, origin: val.origin || "manual" }
              : { modId: null, value: val, origin: "manual" },
          ]),
        );
      }
    }
  } catch { /* ignore */ }
  return new Map();
}

export function saveDirty(dirty) {
  try {
    if (dirty.size === 0) {
      sessionStorage.removeItem(DIRTY_KEY);
    } else {
      sessionStorage.setItem(DIRTY_KEY, JSON.stringify(Array.from(dirty.entries())));
    }
  } catch { /* ignore */ }
}

// Set der modIds, die mindestens einen noch offenen (dirty) Import-Eintrag
// haben — Basis für den "Zu Prüfen"-Status auf der Mods-Seite und im Editor.
export function reviewModIds(dirty) {
  const ids = new Set();
  for (const val of dirty.values()) {
    if (val.origin === "import" && val.modId != null) ids.add(val.modId);
  }
  return ids;
}

// Status einer Mod für Filter-Pillen/Tags: "review" (Import-Einträge noch
// offen) schlägt den aus translatedCount/entryCount abgeleiteten Stand.
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
export const FILTER_TONE_CLASS = {
  all: "bg-slate text-text",
  open: "bg-warning/15 text-warning",
  translated: "bg-success/15 text-success",
  review: "bg-accent/15 text-accent",
};
