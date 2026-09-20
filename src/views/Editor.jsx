import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Save } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import Tag from "../components/Tag.jsx";
import ModCard from "../components/ModCard.jsx";
import DiscardIcon from "../components/DiscardIcon.jsx";
import { useToast } from "../components/Toast.jsx";
import { splitByPlaceholders, comparePlaceholders, describePlaceholder, placeholderSources } from "../placeholders.js";
import {
  loadDirty,
  saveDirty,
  dirtyForLang,
  dirtyKey,
  parseDirtyKey,
  reviewModIds,
  statusOf,
  FILTER_TONE_CLASS,
} from "../reviewStore.js";

// Pseudo-Tab neben "All Files": zeigt über alle Dateien nur Einträge ohne Übersetzung.
const OPEN_TAB = Symbol("open");

// Anzeige-Name ohne den "(Base Game)"-Zusatz — der volle Name (mod.name) bleibt
// als Backend-Wert unverändert (Export-Ordnernamen etc. hängen daran).
function displayModName(mod) {
  return mod.name.replace(/\s*\(Base Game\)\s*$/, "");
}

// The universe of mods the Editor can show IS the Library selection — the
// Editor only ever READS this key (the Library writes it). Switching the
// active mod in the Editor never touches the Library selection.
const UNIVERSE_KEY = "pt_library_selected";
// The Editor's own single active mod (one mod at a time — "durcharbeiten Mod
// für Mod"). Persisted in its own key so it survives view switches without
// touching the Library selection at all.
const ACTIVE_KEY = "pt_editor_active_mod";

// Ganzer (such-gefilterter) Bestand eines Mods wird seitenweise geholt — eine
// einzelne Seite reicht nicht, weil Sortierung UND die Datei-Tabs (Namen aller
// Quelldateien des Mods) den vollen Bestand brauchen. Nur EIN Mod ist je
// gleichzeitig geladen (Einzel-Mod-Fokus), daher ist das unproblematisch —
// selbst das Basisspiel (~47k Einträge) bleibt ein vertretbarer Satz
// Round-Trips. Das Render-Fenster bleibt trotzdem klein (PAGE_SIZE, per
// Scroll-Reveal erweitert) — keine zehntausende DOM-Zeilen auf einmal.
const FETCH_PAGE_SIZE = 500;
const PAGE_SIZE = 200;

function loadUniverseIds() {
  try {
    const raw = sessionStorage.getItem(UNIVERSE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return ids;
    }
  } catch { /* ignore */ }
  return [];
}

function loadActiveModId() {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) || null;
  } catch { /* ignore */ }
  return null;
}

// Pure, wiederverwendbar: sortiert eine Liste geladener Einträge nach
// Key/Translation/Original. `dirty` liefert den LIVE-Wert einer noch
// ungespeicherten Übersetzung, damit Tippen während aktiver
// Sortierung-nach-Translation die Reihenfolge konsistent hält.
function sortEntries(entries, sort, dirty) {
  if (!sort || entries.length <= 1) return entries;
  const { field, dir } = sort;
  const factor = dir === "asc" ? 1 : -1;
  const val = (e) => {
    if (field === "key") return String(e.key ?? "");
    if (field === "translation") {
      const d = dirty.get(e.id);
      const t = d ? d.value : e.translation;
      return t === null || t === undefined ? "" : String(t);
    }
    return String(e.original ?? "");
  };
  return [...entries].sort((a, b) =>
    val(a) < val(b) ? -factor : val(a) > val(b) ? factor : 0,
  );
}

// Quelldatei einer entryId ableiten (Format s. CLAUDE.md: <version>/<Pfad>::<key>) —
// kein Server-Feld nötig, die entryId trägt den Pfad schon.
function sourceFileOf(entry) {
  const afterVersion = entry.id.slice(entry.id.indexOf("/") + 1);
  const relPath = afterVersion.slice(0, afterVersion.lastIndexOf("::"));
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function currentTranslationOf(entry, dirty) {
  const d = dirty.get(entry.id);
  return d ? d.value : entry.translation;
}

function isDirtyEntry(entry, dirty) {
  return dirty.has(entry.id);
}

// Sortable column header (Key / Translation / Original). Click toggles
// asc → desc → server order.
function SortHeader({ field, label, className, sort, onCycle }) {
  const active = sort && sort.field === field;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onCycle(field)}
      title={`Sort by ${label} (click: ${!active ? "ascending" : sort.dir === "asc" ? "descending" : "reset"})`}
      className={`flex cursor-pointer items-center gap-0.5 text-left text-ui leading-none font-semibold transition-colors hover:text-text ${
        active ? "text-accent" : "text-muted"
      } ${className || ""}`}
    >
      {/* Box auf Versalhöhe/Grundlinie trimmen, damit items-center die
          sichtbaren Buchstaben zentriert statt der Font-Zeilenbox. */}
      <span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
      <Icon size={16} className={`shrink-0 ${active ? "text-accent" : "text-muted/40"}`} aria-hidden />
    </button>
  );
}

// Original mit hervorgehobenen Platzhaltern (%1, {0}, <LINE> …); der Tooltip
// erklärt, was der jeweilige Platzhalter im Spiel bewirkt.
function PlaceholderText({ text }) {
  return splitByPlaceholders(text).map((p, i) =>
    p.token ? (
      <span
        key={i}
        title={`${p.text}: ${describePlaceholder(p.text)}. Keep it in your translation only if it makes sense there.`}
        className="rounded bg-accent/15 px-1 text-accent"
      >
        {p.text}
      </span>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

// Warnung unter dem Übersetzungsfeld, wenn Platzhalter fehlen oder zu viel sind.
// Bewusst nur ein Hinweis: gespeichert werden kann trotzdem.
function PlaceholderWarning({ missing, extra, onInsert }) {
  const them = missing.length > 1 ? "them" : "it";
  return (
    <div className="space-y-1 text-xs leading-snug text-warning">
      {missing.length > 0 && (
        <p>
          Missing from your translation:{" "}
          {missing.map((tok, i) => (
            <span key={tok}>
              {i > 0 && ", "}
              <span className="font-semibold">{tok}</span> ({describePlaceholder(tok)})
            </span>
          ))}
          . Leave {them} out if {them === "it" ? "it doesn't" : "they don't"} fit your sentence. Otherwise you can put {them} anywhere in your text.
        </p>
      )}
      {extra.length > 0 && (
        <p>
          Not in the original: <span className="font-semibold">{extra.join(", ")}</span>. The game has
          nothing to put there, so it may show an error. Remove {extra.length > 1 ? "them" : "it"}.
        </p>
      )}
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {missing.map((tok) => (
            <button
              key={tok}
              type="button"
              onClick={() => onInsert(tok)}
              className="cursor-pointer rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning transition-colors hover:bg-warning/25"
            >
              Insert {tok}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Die Zeilen des aktiven Mods. Eigene Komponente, damit useMemo den Re-Sort
// nicht bei jedem Tastendruck woanders im Editor mit auslöst.
function EntryRows({ entries, renderCount, search, sort, dirty, sortDirty, updateDirty, sentinelRef, hasMore, fetching, showFileDividers }) {
  const sortActive = sort !== null;
  const displayEntries = useMemo(() => {
    const sorted = sortActive
      ? sortEntries(entries, sort, sortActive && sort.field === "translation" ? sortDirty : dirty)
      : entries;
    return sorted.slice(0, renderCount);
    // dirty ist absichtlich NICHT als Dependency dabei: nur beim Sortieren
    // nach Translation braucht ein Re-Sort den (entprellten) Live-Wert — s.
    // sortDirty unten. Sortierung nach Key/Original ändert sich nie durch
    // Tippen, und die Zellen selbst lesen `dirty` ohnehin live (unabhängig
    // von diesem Memo) — ein Re-Sort bei jedem Tastendruck würde sonst
    // spürbar den Main Thread blockieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entries,
    renderCount,
    sortActive,
    sort && sort.field,
    sort && sort.dir,
    sortActive && sort.field === "translation" ? sortDirty : null,
  ]);

  if (entries.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted">
        {search !== "" ? "No entries for this search." : "No entries."}
      </p>
    );
  }

  // Platzhalter an der Cursorposition des Übersetzungsfelds einfügen (am Ende,
  // wenn das Feld noch nie den Fokus hatte).
  const insertPlaceholder = (entry, token) => {
    const el = document.querySelector(`[data-entry-input="${CSS.escape(entry.id)}"]`);
    const cur = String(currentTranslationOf(entry, dirty) ?? "");
    const pos = el && el.selectionStart != null ? Math.min(el.selectionStart, cur.length) : cur.length;
    updateDirty(entry.id, cur.slice(0, pos) + token + cur.slice(pos), entry.translation);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos + token.length, pos + token.length);
    });
  };

  let prevSourceFile = null;

  return (
    <>
      {displayEntries.map((entry) => {
        const currentTranslation = currentTranslationOf(entry, dirty);
        const dirtyEntry = dirty.get(entry.id);
        const entryDirty = dirtyEntry !== undefined;
        const needsReview = dirtyEntry?.origin === "import";

        let borderClass = "border-success";
        // Importierte Einträge nutzen bewusst denselben Akzentton wie die
        // "Needs Review"-Pill, bis sie gespeichert wurden.
        if (needsReview || entryDirty) borderClass = "border-accent";
        else if (!entry.translation) borderClass = "border-warning";

        // Nur prüfen, wenn schon etwas geschrieben steht (leer = "noch offen").
        const ph = currentTranslation ? comparePlaceholders(entry.original, currentTranslation) : null;
        const phIssue = ph && (ph.missing.length > 0 || ph.extra.length > 0);

        const sources = placeholderSources(entry.original, entry.usage);

        const sourceFile = sourceFileOf(entry);
        const showFileDivider = showFileDividers && sourceFile !== prevSourceFile;
        prevSourceFile = sourceFile;

        return (
          <div key={entry.id}>
            {showFileDivider && (
              <div className="flex items-stretch border-t border-line bg-surface px-4 text-ui font-semibold text-muted">
                <span className="w-1/3 shrink-0 truncate py-1.5 pr-4">{sourceFile}</span>
                <span className="w-1/3 shrink-0 border-l border-muted/15" />
                <span className="w-1/3 border-l border-muted/15" />
              </div>
            )}
            <div className="flex items-stretch border-b border-line px-4 last:border-b-0 hover:bg-raised/30">
              <span className="flex w-1/3 shrink-0 items-center py-2 pr-4">
                <span className="truncate text-ui leading-none font-semibold text-text">{entry.key}</span>
              </span>
              <span className="flex w-1/3 shrink-0 flex-col justify-center gap-1.5 border-l border-muted/15 px-4 py-2">
                <input
                  data-entry-input={entry.id}
                  value={currentTranslation ?? ""}
                  onChange={(e) => updateDirty(entry.id, e.target.value, entry.translation)}
                  placeholder="Translation..."
                  className={`h-10 w-full min-w-[20ch] rounded-lg border-2 bg-raised px-3 text-ui font-semibold text-text placeholder:text-muted placeholder:font-semibold focus-visible:outline-none focus-visible:border-accent ${phIssue ? "border-warning" : borderClass}`}
                />
                {phIssue && (
                  <PlaceholderWarning
                    missing={ph.missing}
                    extra={ph.extra}
                    onInsert={(tok) => insertPlaceholder(entry, tok)}
                  />
                )}
              </span>
              <span className="flex w-1/3 min-w-0 flex-col justify-center gap-1.5 border-l border-muted/15 py-2 pl-4">
                <span className="text-ui leading-snug font-semibold break-words text-text">
                  <PlaceholderText text={entry.original} />
                </span>
                {entry.notInCode && (
                  <span
                    className="text-xs leading-snug text-warning"
                    title="This mod's code never mentions this key. The game may still use it if the code builds keys dynamically or if another mod uses it, so check before skipping it."
                  >
                    Not found in the mod's code, so it may not be used in the game.
                  </span>
                )}
                {Object.keys(sources).length > 0 && (
                  <span className="space-y-0.5 text-xs leading-snug break-words text-muted">
                    {Object.entries(sources).map(([tok, s]) => (
                      <span key={tok} className="block">
                        <span className="font-semibold text-accent">{tok}</span> = {s.value}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}
      {hasMore && (
        <div ref={sentinelRef} className="px-4 py-3 text-ui font-semibold text-muted">
          {fetching ? "Loading more..." : "Loading more..."}
        </div>
      )}
    </>
  );
}

export default function Editor({ onReselect, onGoToSettings, activeLang }) {
  // --- Universe: the Library selection (read-only here) ---
  const [universeIds] = useState(() => loadUniverseIds());
  // --- Active mod: exactly one at a time ("Mod für Mod durcharbeiten") ---
  const [activeModId, setActiveModIdState] = useState(() => loadActiveModId());
  const setActiveModId = (id) => {
    setActiveModIdState(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch { /* ignore */ }
  };

  // --- State ---
  const [allMods, setAllMods] = useState([]);
  const [modsLoading, setModsLoading] = useState(true);
  const toast = useToast();
  const [loadFailed, setLoadFailed] = useState(false);

  const [saving, setSaving] = useState(false);

  // Sidebar: its own search + status filter (All Mods / Open / Translated / Review).
  const [modSearch, setModSearch] = useState("");
  const [modFilter, setModFilter] = useState("all");

  // Active mod's entries: always the FULL (search-filtered) set — needed both
  // for client-side sort and to know every source file for the file tabs.
  const [entries, setEntries] = useState([]);
  // Infinity = "not loaded yet" (unknown) — keeps the prune effect below from
  // treating an empty initial/in-flight `entries` array as "fully known and
  // empty", which would otherwise wipe out perfectly valid dirty entries for
  // whatever mod happens to be the initially restored active mod.
  const [entriesTotal, setEntriesTotal] = useState(Infinity);
  // Which mod `entries` actually belongs to — set together with `entries`
  // itself once a fetch completes, deliberately NOT assumed to equal
  // `activeModId` right after switching mods. On a mod switch, `activeModId`
  // updates immediately but `entries` still holds the PREVIOUS mod's
  // (fully-loaded) set for one more render; without this, the prune effect
  // below would read that stale set as if it were the new mod's and delete
  // the new mod's still-valid dirty entries as "stale".
  const [entriesModId, setEntriesModId] = useState(null);
  const [renderCount, setRenderCount] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const lastLoadKeyRef = useRef(null);

  const [search, setSearch] = useState("");
  // null = "All Files", OPEN_TAB = alle Einträge ohne Übersetzung, sonst ein Dateiname
  const [activeFile, setActiveFile] = useState(null);
  const [sort, setSort] = useState(null);
  const fileTabBarRef = useRef(null);
  const fileTabDragRef = useRef({ dragging: false, startX: 0, scrollLeft: 0, moved: false });
  const [fileTabDragging, setFileTabDragging] = useState(false);

  // `dirty` hält ALLE Sprachen gleichzeitig (Key "<lang>::<entryId>", s.
  // reviewStore.js) — mehrere Sprachen können parallel ungespeicherte
  // Änderungen haben. Der Editor selbst arbeitet aber immer nur mit der
  // aktiven Sprache; die per-Sprache-Sicht liefert `dirtyForLang` weiter
  // unten (`activeDirty`).
  const [dirty, setDirty] = useState(() => loadDirty(activeLang));
  // Entprellte Kopie von `dirty`, nur für den Re-Sort bei aktiver
  // Translation-Sortierung — verhindert einen kompletten Re-Sort von
  // zehntausenden Zeilen bei jedem Tastendruck (Eingabe selbst bleibt live).
  const [dirtyDebounced, setDirtyDebounced] = useState(dirty);
  useEffect(() => {
    const t = setTimeout(() => setDirtyDebounced(dirty), 350);
    return () => clearTimeout(t);
  }, [dirty]);
  const [reloadKey, setReloadKey] = useState(0);

  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  // --- Load Library selection's mods. If the API hasn't scanned mods yet,
  // there's nothing useful to show here — go straight to Settings instead
  // of a dead-end hint (mirrors Mods.jsx). ---
  useEffect(() => {
    setModsLoading(true);
    api
      .getMods(activeLang)
      .then((data) => setAllMods(data.mods || []))
      .catch((err) => {
        if (err.message && err.message.toLowerCase().includes('scan')) {
          onGoToSettings();
        } else {
          setLoadFailed(true);
          toast("error", err.message);
          setAllMods([]);
        }
      })
      .finally(() => setModsLoading(false));
  }, [activeLang, onGoToSettings, toast]);

  // --- Persist dirty edits so they survive a view switch ---
  useEffect(() => {
    if (!saveDirty(dirty)) {
      toast(
        "error",
        "Could not save unsaved edits for the view switch because they are too large for the browser's session storage.",
      );
    }
  }, [dirty, toast]);

  const reviewIds = useMemo(() => reviewModIds(dirty), [dirty]);

  // Universe: the mods picked in the Library (read-only source for the Editor).
  const universe = allMods.filter((m) => universeIds.includes(m.id));

  // Default/repair the active mod once the universe is known: fall back to
  // the first universe mod if nothing (or a stale id) is stored.
  useEffect(() => {
    if (universe.length === 0) return;
    if (activeModId && universe.some((m) => m.id === activeModId)) return;
    setActiveModId(universe[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.map((m) => m.id).join(" ")]);

  const activeMod = universe.find((m) => m.id === activeModId) || null;

  // Sidebar list: the full Library selection, filtered by its own search +
  // status pill (independent of what's actually open).
  const sidebarMods = universe.filter((m) => {
    if (modSearch.trim() !== "") {
      const q = modSearch.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
    }
    if (modFilter === "all") return true;
    return statusOf(m, reviewIds) === modFilter;
  }).sort((a, b) => Number(b.isBaseGame) - Number(a.isBaseGame));
  const filterCounts = {
    all: universe.length,
    open: universe.filter((m) => statusOf(m, reviewIds) === "open").length,
    translated: universe.filter((m) => statusOf(m, reviewIds) === "translated").length,
    review: universe.filter((m) => statusOf(m, reviewIds) === "review").length,
  };

  // --- Load the active mod's full (search-filtered) entry set ---
  useEffect(() => {
    // Clear immediately (not just on completion) so a mod/search switch never
    // lets the prune effect below see a mismatched pair — e.g. activeModId
    // already pointing at the new mod while `entries` still holds the
    // previous mod's (fully-known) set, which would make it prune the NEW
    // mod's dirty entries against the OLD mod's entry ids.
    // Ausnahme: ein reiner Reload nach Save (gleicher Mod/Sprache/Suche) lässt die
    // Liste stehen und tauscht sie erst mit den neuen Daten aus — sonst klappt sie
    // zusammen und die Ansicht springt an den Anfang.
    const loadKey = `${activeModId}|${activeLang}|${search}`;
    const isReload = loadKey === lastLoadKeyRef.current;
    lastLoadKeyRef.current = loadKey;
    if (!isReload) {
      setEntries([]);
      setEntriesTotal(Infinity);
      setEntriesModId(null);
      setRenderCount(0);
    }
    if (!activeModId) return;
    let cancelled = false;
    setEntriesLoading(true);
    (async () => {
      let all = [];
      let total = Infinity;
      let page = 1;
      let guard = 0;
      while (all.length < total && guard < 1000) {
        const data = await api.getEntries(activeModId, { page, pageSize: FETCH_PAGE_SIZE, search, lang: activeLang });
        total = data.total ?? 0;
        const batch = data.entries || [];
        all = all.concat(batch);
        if (batch.length === 0) break;
        page += 1;
        guard += 1;
      }
      if (cancelled) return;
      setEntries(all);
      setEntriesTotal(total);
      setEntriesModId(activeModId);
      setRenderCount((c) => Math.min(all.length, isReload ? Math.max(c, PAGE_SIZE) : PAGE_SIZE));
    })()
      .catch((err) => {
        // "Kein Scan": die Weiterleitung nach Settings meldet das bereits.
        if (!cancelled && !err.message.toLowerCase().includes("scan")) toast("error", err.message);
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeModId, activeLang, search, reloadKey, toast]);

  // --- Prune stale dirty ids for the ACTIVE mod, once its full (unfiltered)
  // stock is known — a rescan can remove/rename an entry, leaving a stale
  // entryId that would fail to save. Only prunes what's currently loaded &
  // fully known (search === ""), never touches dirty entries of other mods.
  // Guarded by entriesModId === activeModId (not just `entries` being
  // "fully known") — right after switching mods, `entries` can for one
  // render still be the PREVIOUS mod's fully-loaded set while `activeModId`
  // already points at the new one; without this guard that stale pairing
  // would wrongly prune the new mod's still-valid dirty entries. ---
  useEffect(() => {
    if (search !== "" || !activeModId || entriesModId !== activeModId) return;
    if (entries.length < entriesTotal) return;
    setDirty((prev) => {
      const validIds = new Set(entries.map((e) => e.id));
      let next = null;
      // Die entryId selbst ist sprachunabhängig (sie referenziert die
      // EN-Quelldatei) — ein Rescan-Wegfall betrifft deshalb Dirty-Einträge
      // ALLER Sprachen dieser Mod gleichermaßen, nicht nur die aktive.
      for (const [key, val] of prev) {
        const { entryId } = parseDirtyKey(key);
        if (val.modId === activeModId && val.origin !== "import" && !validIds.has(entryId)) {
          if (!next) next = new Map(prev);
          next.delete(key);
        }
      }
      return next || prev;
    });
  }, [entries, entriesTotal, entriesModId, search, activeModId]);

  // --- Backward-compat: fill in modId for dirty entries restored from an
  // older sessionStorage shape (modId: null), once identifiable from the
  // currently loaded mod. Never deletes anything — only annotates. Same
  // entriesModId guard as the prune effect above — otherwise a stale id
  // match against the PREVIOUS mod's still-loaded entries could tag an
  // entry with the wrong mod right after switching. ---
  useEffect(() => {
    if (entries.length === 0 || !activeModId || entriesModId !== activeModId) return;
    setDirty((prev) => {
      let next = null;
      for (const [key, val] of prev) {
        if (val.modId != null) continue;
        const { entryId } = parseDirtyKey(key);
        if (entries.some((e) => e.id === entryId)) {
          if (!next) next = new Map(prev);
          next.set(key, { ...val, modId: activeModId });
        }
      }
      return next || prev;
    });
  }, [entries, entriesModId, activeModId]);

  // --- Infinite scroll: widen the render window (no network call — the full
  // set is already loaded). ---
  const observerRef = useRef(null);
  const sentinelRef = (node) => {
    if (node && observerRef.current) observerRef.current.observe(node);
  };
  useEffect(() => {
    const observer = new IntersectionObserver(
      (observedEntries) => {
        for (const oe of observedEntries) {
          if (!oe.isIntersecting) continue;
          setRenderCount((c) => Math.min(entries.length, c + PAGE_SIZE));
        }
      },
      { rootMargin: "600px 0px" },
    );
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [entries.length]);

  // --- File tabs: distinct source files of the active mod's full (loaded) set ---
  const files = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const e of entries) {
      const f = sourceFileOf(e);
      if (!seen.has(f)) {
        seen.add(f);
        list.push(f);
      }
    }
    return list;
  }, [entries]);

  useEffect(() => {
    if (activeFile && activeFile !== OPEN_TAB && !files.includes(activeFile)) setActiveFile(null);
  }, [files, activeFile]);

  // Datei-Tabs: alle in einer Reihe, horizontal per Maus-Drag scrollbar
  // (kein Scrollbalken sichtbar, `scrollbar-none`). Bewusst KEIN
  // setPointerCapture: das würde den click danach auf den Container statt
  // auf den darunterliegenden Tab-Button umleiten (Chromium-Verhalten) und
  // jeden Klick auf einen Tab unmöglich machen. Move/Up daher per
  // window-Listener, damit ein Drag auch außerhalb der Bar weiterläuft.
  // `moved` unterscheidet Drag von Klick, damit ein Ziehen keinen Tab aktiviert.
  const handleFileTabPointerDown = (e) => {
    const bar = fileTabBarRef.current;
    if (!bar) return;
    fileTabDragRef.current = { startX: e.clientX, scrollLeft: bar.scrollLeft, moved: false };
    setFileTabDragging(true);

    const handleMove = (moveEvent) => {
      const state = fileTabDragRef.current;
      const delta = moveEvent.clientX - state.startX;
      if (Math.abs(delta) > 3) state.moved = true;
      bar.scrollLeft = state.scrollLeft - delta;
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setFileTabDragging(false);
      // Falls kein click folgt (z. B. Drag endet über einem anderen Tab als
      // dem Start-Tab), bliebe `moved` sonst dauerhaft hängen und würde jeden
      // künftigen Klick blockieren.
      window.setTimeout(() => {
        fileTabDragRef.current.moved = false;
      }, 0);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const handleFileTabClickCapture = (e) => {
    if (fileTabDragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      fileTabDragRef.current.moved = false;
    }
  };

  // "Open": wie die Zeilenmarkierung (border-warning) — keine gespeicherte Übersetzung.
  // Ein gerade getippter Wert lässt die Zeile stehen, sie verschwindet erst nach dem Speichern.
  const visibleEntries =
    activeFile === OPEN_TAB
      ? entries.filter((e) => !e.translation)
      : activeFile
        ? entries.filter((e) => sourceFileOf(e) === activeFile)
        : entries;

  // --- Dirty tracking: dirty only when the value differs from the loaded one.
  // Preserves an existing "import" origin (still unreviewed) when the user
  // edits an imported value further; brand-new edits are "manual". ---
  const updateDirty = useCallback((id, translation, original) => {
    const value = translation === null ? "" : String(translation);
    const originalValue = original === null || original === undefined ? "" : String(original);
    const key = dirtyKey(activeLang, id);

    setDirty((prev) => {
      const existing = prev.get(key);
      // Ein Import bleibt bis zum erfolgreichen Save ein Review-Eintrag —
      // auch wenn sein Wert während der Prüfung wieder dem Original gleicht.
      if (value === originalValue && existing?.origin !== "import") {
        if (!existing) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      const next = new Map(prev);
      next.set(key, { modId: activeModId, value, origin: existing?.origin || "manual", lang: activeLang });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModId, activeLang]);

  // Nur die aktive Sprache, als Map(entryId -> { modId, value, origin }) —
  // die Zeilen/Sortierung arbeiten weiter rein auf entryId-Basis.
  const activeDirty = useMemo(() => dirtyForLang(dirty, activeLang), [dirty, activeLang]);
  const activeDirtyDebounced = useMemo(
    () => dirtyForLang(dirtyDebounced, activeLang),
    [dirtyDebounced, activeLang],
  );

  // Dirty items of the ACTIVE mod UND der aktiven Sprache — Save touched
  // immer nur den offenen Mod ("Mod für Mod") in der gerade offenen Sprache.
  const activeDirtyItems = Array.from(activeDirty.entries())
    .filter(([, val]) => val.modId === activeModId)
    .map(([id, val]) => [id, val.value]);
  const dirtySize = activeDirtyItems.length;

  // Unaufdringlicher Hinweis: hat der offene Mod zusätzlich ungespeicherte
  // Änderungen in ANDEREN Sprachen (die der Zähler oben bewusst nicht zählt)?
  const otherLangDirtyCount = useMemo(() => {
    if (!activeModId) return 0;
    let count = 0;
    for (const [key, val] of dirty) {
      if (val.modId !== activeModId) continue;
      const { lang } = parseDirtyKey(key);
      if (lang && lang !== activeLang) count += 1;
    }
    return count;
  }, [dirty, activeModId, activeLang]);

  // Unsaved edits whose mod is no longer part of the Library selection: kept
  // (never deleted), but invisible and unsavable until the mod is reselected.
  const orphanedDirtyModIds = Array.from(
    new Set(
      Array.from(dirty.values())
        .map((v) => v.modId)
        .filter((modId) => modId != null && !universeIds.includes(modId)),
    ),
  );
  const orphanedCount = orphanedDirtyModIds.length;
  useEffect(() => {
    if (orphanedCount === 0) return;
    toast(
      "warning",
      `You have unsaved changes in ${orphanedCount} mod(s) no longer selected on the Mods page. Reselect ${orphanedCount === 1 ? "it" : "them"} there to save or discard those changes.`,
    );
  }, [orphanedCount, toast]);

  // --- Discard the active mod's unsaved edits (nothing written to disk,
  // this only clears the dirty entries — same "active mod only" scope as
  // Save). Irreversible from the UI's point of view (the typed values are
  // gone), so it asks for confirmation first instead of acting immediately. ---
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const handleDiscardClick = () => {
    if (dirtySize === 0 || !activeModId) return;
    setDiscardConfirmOpen(true);
  };

  const handleDiscardConfirm = () => {
    setDirty((prev) => {
      const next = new Map(prev);
      for (const [id] of activeDirtyItems) next.delete(dirtyKey(activeLang, id));
      return next;
    });
    setDiscardConfirmOpen(false);
  };

  // --- Save the active mod's dirty entries ---
  const handleSave = async () => {
    if (dirtySize === 0 || !activeModId) return;
    setSaving(true);

    try {
      await api.saveEntries(
        activeModId,
        activeDirtyItems.map(([entryId, translation]) => ({ entryId, translation })),
        activeLang,
      );
      setDirty((prev) => {
        const next = new Map(prev);
        for (const [id] of activeDirtyItems) next.delete(dirtyKey(activeLang, id));
        return next;
      });

      setReloadKey((k) => k + 1);
      api
        .getMods(activeLang)
        .then((data) => setAllMods(data.mods || []))
        .catch(() => {});
    } catch (err) {
      toast("error", `${activeMod ? activeMod.name : activeModId}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // --- Column sort: click a header to toggle asc → desc → (server order) ---
  const cycleSort = (field) => {
    setSort((prev) => {
      if (prev && prev.field === field) {
        return prev.dir === "asc" ? { field, dir: "desc" } : null;
      }
      return { field, dir: "asc" };
    });
  };

  const hasMore = renderCount < visibleEntries.length;

  // === Error state (e.g. no scan) ===
  if (loadFailed && allMods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Editor">
          <div>
            <Button variant="secondary" onClick={onReselect}>
              Go to Mods
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading mods ===
  if (modsLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-center text-muted">Loading...</p>
      </div>
    );
  }

  const FILTERS = [
    { key: "all", label: "All Mods" },
    { key: "open", label: "Open" },
    { key: "translated", label: "Translated" },
    { key: "review", label: "Needs Review" },
  ];

  // Zwei Ebenen (Außen-Padding, dann zentriert) — dieselbe Struktur wie die
  // Navbar, damit die Sidebar links exakt mit dem PT-Logo fluchtet (s. Mods.jsx).
  return (
    <div className="h-full px-6">
    <div className="mx-auto flex h-full w-full max-w-[90rem]">
      {/* Sidebar: the full Library selection, single-select — click a mod to
          open it. The Library selection itself is never touched here. */}
      <aside className="flex w-[19.0625rem] shrink-0 flex-col gap-3 self-stretch overflow-y-auto border-r border-line py-4 pl-2 pr-4 -ml-2">
        {/* Suche + Filter bleiben beim Scrollen der Mod-Liste oben kleben
            (-top-4/-mt-4/pt-4 heben das Aside-Padding auf, -mb-3 das Flex-Gap). */}
        <div className="sticky -top-4 z-10 -mb-3 -mt-4 flex flex-col gap-3 bg-ink pb-3 pt-4">
          <Input
            placeholder="Search Mods..."
            value={modSearch}
            onChange={(e) => setModSearch(e.target.value)}
            clearable
          />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setModFilter(f.key)}
                className={`flex h-6 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold transition-colors ${
                  modFilter === f.key
                    ? FILTER_TONE_CLASS[f.key]
                    : "bg-raised text-muted hover:text-text"
                }`}
              >
                {f.label} ({filterCounts[f.key]})
              </button>
            ))}
          </div>
        </div>
        <nav className="flex flex-col gap-3">
          {sidebarMods.map((mod) => (
            <ModCard
              key={mod.id}
              id={mod.id}
              mod={mod}
              name={displayModName(mod)}
              status={statusOf(mod, reviewIds)}
              active={mod.id === activeModId}
              onToggle={setActiveModId}
            />
          ))}
          {sidebarMods.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">No mods match.</p>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* File tabs + Search + Save */}
        <div className="flex items-center gap-3 py-4 pl-4">
          <Input
            placeholder="Search Entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[12.5rem] shrink-0"
            clearable
          />
          <div
            ref={fileTabBarRef}
            onPointerDown={handleFileTabPointerDown}
            onClickCapture={handleFileTabClickCapture}
            className={`scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto ${fileTabDragging ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <button
              onClick={() => setActiveFile(null)}
              className={`flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold transition-colors ${
                activeFile === null
                  ? "bg-slate text-text"
                  : "bg-raised text-muted hover:text-text"
              }`}
            >
              All Files
            </button>
            <button
              onClick={() => setActiveFile(OPEN_TAB)}
              title="Show all entries without a translation"
              className={`flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold transition-colors ${
                activeFile === OPEN_TAB
                  ? "bg-slate text-text"
                  : "bg-raised text-muted hover:text-text"
              }`}
            >
              Open
            </button>
            {files.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                title={f}
                className={`flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold transition-colors ${
                  activeFile === f
                    ? "bg-slate text-text"
                    : "bg-raised text-muted hover:text-text"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {otherLangDirtyCount > 0 && (
            <span
              className="shrink-0 whitespace-nowrap text-ui font-semibold text-muted"
              title="This mod has unsaved changes in other languages too, switch the active language to review them"
            >
              {otherLangDirtyCount} unsaved in other languages
            </span>
          )}
          <Button
            variant="secondary"
            icon={DiscardIcon}
            onClick={handleDiscardClick}
            disabled={dirtySize === 0 || saving || !activeModId}
            title="Discard unsaved changes in this mod"
          >
            Discard
          </Button>
          <Button
            variant="secondary"
            icon={Save}
            onClick={handleSave}
            disabled={dirtySize === 0 || saving || !activeModId}
          >
            {saving ? "Saving..." : dirtySize === 0 ? "Save" : `Save (${dirtySize})`}
          </Button>
        </div>

        {/* Entry area */}
        <div className="flex-1 overflow-auto">
          {!activeMod && (
            <div className="mx-auto max-w-md px-6 py-10">
              <Card title="Editor">
                {universe.length > 0 ? (
                  <p className="text-sm text-muted">No mod selected. Pick one from the sidebar.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      No mods selected. Pick them on the Mods page.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button variant="secondary" onClick={onReselect}>
                        Go to Mods
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}

          {activeMod && entriesLoading && entries.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">Loading...</p>
          )}

          {activeMod && (entries.length > 0 || !entriesLoading) && (
            <>
              <div className="flex items-center gap-2 border-t border-b border-line bg-surface px-4 py-3">
                <span className="text-lg font-semibold text-text">
                  {displayModName(activeMod)}
                </span>
                <Tag tone="base">
                  {entriesTotal === Infinity ? entries.length : entriesTotal}{" "}
                  {(entriesTotal === Infinity ? entries.length : entriesTotal) === 1
                    ? "Entry"
                    : "Entries"}
                </Tag>
              </div>
              {/* Blaue 2px-Linie als ::after innerhalb der Leiste — pb ist
                  deshalb 2px größer als pt, damit der Text mittig zwischen
                  Oberkante und Linie steht. */}
              <div className="sticky top-0 z-10 flex items-stretch bg-raised px-4 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-accent after:content-['']">
                <SortHeader field="key" label="Key" className="w-1/3 shrink-0 pt-[0.5rem] pb-[0.6rem] pr-4" sort={sort} onCycle={cycleSort} />
                <SortHeader field="translation" label={`Translation (${activeLang})`} className="w-1/3 shrink-0 border-l border-muted/15 px-4 pt-[0.5rem] pb-[0.6rem]" sort={sort} onCycle={cycleSort} />
                <SortHeader field="original" label="Original" className="w-1/3 min-w-0 border-l border-muted/15 pl-4 pt-[0.5rem] pb-[0.6rem]" sort={sort} onCycle={cycleSort} />
              </div>
              <EntryRows
                entries={visibleEntries}
                renderCount={renderCount}
                search={search}
                sort={sort}
                dirty={activeDirty}
                sortDirty={activeDirtyDebounced}
                updateDirty={updateDirty}
                sentinelRef={sentinelRef}
                hasMore={hasMore}
                fetching={entriesLoading}
                showFileDividers={activeFile === null || activeFile === OPEN_TAB}
              />
            </>
          )}
        </div>
      </main>
    </div>

    <Modal
      open={discardConfirmOpen}
      onClose={() => setDiscardConfirmOpen(false)}
      title="Discard unsaved changes?"
    >
      <div className="space-y-4">
        <p className="text-sm text-text">
          {dirtySize} unsaved change{dirtySize === 1 ? "" : "s"} in{" "}
          {activeMod ? displayModName(activeMod) : "this mod"} will be lost.
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDiscardConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDiscardConfirm}>
            Discard
          </Button>
        </div>
      </div>
    </Modal>
    </div>
  );
}
