import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Save } from "lucide-react";
import nextIcon from "../assets/file-tabs-next.svg";
import previousIcon from "../assets/file-tabs-previous.svg";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Tag from "../components/Tag.jsx";
import ModCard from "../components/ModCard.jsx";
import { loadDirty, saveDirty, reviewModIds, statusOf, FILTER_TONE_CLASS } from "../reviewStore.js";

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
              <span className="flex w-1/3 shrink-0 items-center border-l border-muted/15 px-4 py-2">
                <input
                  value={currentTranslation}
                  onChange={(e) => updateDirty(entry.id, e.target.value, entry.translation)}
                  placeholder="Translation..."
                  className={`h-10 w-full min-w-[20ch] rounded-lg border-2 bg-raised px-3 text-ui font-semibold text-text placeholder:text-muted placeholder:font-semibold focus-visible:outline-none focus-visible:border-accent ${borderClass}`}
                />
              </span>
              <span className="flex w-1/3 min-w-0 items-center border-l border-muted/15 py-2 pl-4">
                <span className="truncate text-ui leading-none font-semibold text-text">{entry.original}</span>
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

export default function Editor({ onReselect, onGoToSettings }) {
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
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");

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
  const [renderCount, setRenderCount] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [activeFile, setActiveFile] = useState(null); // null = "All Files"
  const [sort, setSort] = useState(null);
  const [fileTabPage, setFileTabPage] = useState(0);
  const [fileTabPages, setFileTabPages] = useState([[]]);
  const fileTabBarRef = useRef(null);
  const fileTabMeasureRef = useRef(null);

  const [dirty, setDirty] = useState(() => loadDirty());
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
    api
      .getMods()
      .then((data) => setAllMods(data.mods || []))
      .catch((err) => {
        if (err.message && err.message.toLowerCase().includes('scan')) {
          onGoToSettings();
        } else {
          setError(err.message);
          setAllMods([]);
        }
      });
  }, [onGoToSettings]);

  // --- Persist dirty edits so they survive a view switch ---
  useEffect(() => {
    saveDirty(dirty);
  }, [dirty]);

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
    setEntries([]);
    setEntriesTotal(Infinity);
    setRenderCount(0);
    if (!activeModId) return;
    let cancelled = false;
    setEntriesLoading(true);
    (async () => {
      let all = [];
      let total = Infinity;
      let page = 1;
      let guard = 0;
      while (all.length < total && guard < 1000) {
        const data = await api.getEntries(activeModId, { page, pageSize: FETCH_PAGE_SIZE, search });
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
      setRenderCount(Math.min(all.length, PAGE_SIZE));
      setSaveError("");
    })()
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeModId, search, reloadKey]);

  // --- Prune stale dirty ids for the ACTIVE mod, once its full (unfiltered)
  // stock is known — a rescan can remove/rename an entry, leaving a stale
  // entryId that would fail to save. Only prunes what's currently loaded &
  // fully known (search === ""), never touches dirty entries of other mods. ---
  useEffect(() => {
    if (search !== "" || !activeModId) return;
    if (entries.length < entriesTotal) return;
    setDirty((prev) => {
      const validIds = new Set(entries.map((e) => e.id));
      let next = null;
      for (const [id, val] of prev) {
        if (val.modId === activeModId && val.origin !== "import" && !validIds.has(id)) {
          if (!next) next = new Map(prev);
          next.delete(id);
        }
      }
      return next || prev;
    });
  }, [entries, entriesTotal, search, activeModId]);

  // --- Backward-compat: fill in modId for dirty entries restored from an
  // older sessionStorage shape (modId: null), once identifiable from the
  // currently loaded mod. Never deletes anything — only annotates. ---
  useEffect(() => {
    if (entries.length === 0 || !activeModId) return;
    setDirty((prev) => {
      let next = null;
      for (const [id, val] of prev) {
        if (val.modId != null) continue;
        if (entries.some((e) => e.id === id)) {
          if (!next) next = new Map(prev);
          next.set(id, { ...val, modId: activeModId });
        }
      }
      return next || prev;
    });
  }, [entries, activeModId]);

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
    if (activeFile && !files.includes(activeFile)) setActiveFile(null);
  }, [files, activeFile]);

  useLayoutEffect(() => {
    const tabBar = fileTabBarRef.current;
    const measure = fileTabMeasureRef.current;
    if (!tabBar || !measure) return undefined;

    const calculatePages = () => {
      const items = Array.from(measure.children);
      const previousWidth = items[0]?.getBoundingClientRect().width || 0;
      const allFilesWidth = items[1]?.getBoundingClientRect().width || 0;
      const nextWidth = items.at(-1)?.getBoundingClientRect().width || 0;
      const fileWidths = items.slice(2, -1).map((item) => item.getBoundingClientRect().width);
      const gap = Number.parseFloat(getComputedStyle(tabBar).gap) || 0;
      const fileWidthsTotal = fileWidths.reduce((total, width) => total + width, 0)
        + Math.max(0, fileWidths.length - 1) * gap;
      const needsNextButton = previousWidth + allFilesWidth + fileWidthsTotal
        + (fileWidths.length > 0 ? gap * 2 : gap) > tabBar.clientWidth;
      const availableFileWidth = tabBar.clientWidth - previousWidth - allFilesWidth
        - (needsNextButton ? nextWidth : 0) - gap * (needsNextButton ? 3 : 2);

      const pages = [];
      let page = [];
      let usedWidth = 0;
      files.forEach((file, index) => {
        const width = fileWidths[index] || 0;
        const requiredWidth = page.length === 0 ? width : width + gap;
        if (page.length > 0 && usedWidth + requiredWidth > availableFileWidth) {
          pages.push(page);
          page = [];
          usedWidth = 0;
        }
        page.push(file);
        usedWidth += page.length === 1 ? width : width + gap;
      });
      if (page.length > 0) pages.push(page);
      if (pages.length === 0) pages.push([]);

      setFileTabPages((current) => (
        current.length === pages.length && current.every((currentPage, index) =>
          currentPage.length === pages[index].length
          && currentPage.every((file, fileIndex) => file === pages[index][fileIndex]))
          ? current
          : pages
      ));
    };

    calculatePages();
    const resizeObserver = new ResizeObserver(calculatePages);
    resizeObserver.observe(tabBar);
    return () => resizeObserver.disconnect();
  }, [files]);

  useEffect(() => {
    setFileTabPage(0);
  }, [files]);

  useEffect(() => {
    setFileTabPage((page) => Math.min(page, Math.max(0, fileTabPages.length - 1)));
  }, [fileTabPages]);

  const visibleFileTabs = fileTabPages[fileTabPage] || [];
  const hasPreviousFileTabPage = fileTabPage > 0;
  const hasNextFileTabPage = fileTabPage < fileTabPages.length - 1;

  const visibleEntries = activeFile
    ? entries.filter((e) => sourceFileOf(e) === activeFile)
    : entries;

  // --- Dirty tracking: dirty only when the value differs from the loaded one.
  // Preserves an existing "import" origin (still unreviewed) when the user
  // edits an imported value further; brand-new edits are "manual". ---
  const updateDirty = useCallback((id, translation, original) => {
    const value = translation === null ? "" : String(translation);
    const originalValue = original === null || original === undefined ? "" : String(original);

    setDirty((prev) => {
      const existing = prev.get(id);
      // Ein Import bleibt bis zum erfolgreichen Save ein Review-Eintrag —
      // auch wenn sein Wert während der Prüfung wieder dem Original gleicht.
      if (value === originalValue && existing?.origin !== "import") {
        if (!existing) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      }
      const next = new Map(prev);
      next.set(id, { modId: activeModId, value, origin: existing?.origin || "manual" });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModId]);

  // Dirty items of the ACTIVE mod only — Save only ever touches the mod
  // currently open (that's the whole point of "Mod für Mod").
  const activeDirtyItems = Array.from(dirty.entries())
    .filter(([, val]) => val.modId === activeModId)
    .map(([id, val]) => [id, val.value]);
  const dirtySize = activeDirtyItems.length;

  // Unsaved edits whose mod is no longer part of the Library selection: kept
  // (never deleted), but invisible and unsavable until the mod is reselected.
  const orphanedDirtyModIds = Array.from(
    new Set(
      Array.from(dirty.values())
        .map((v) => v.modId)
        .filter((modId) => modId != null && !universeIds.includes(modId)),
    ),
  );

  // --- Save the active mod's dirty entries ---
  const handleSave = async () => {
    if (dirtySize === 0 || !activeModId) return;
    setSaving(true);
    setSaveError("");

    try {
      await api.saveEntries(
        activeModId,
        activeDirtyItems.map(([entryId, translation]) => ({ entryId, translation })),
      );
      setDirty((prev) => {
        const next = new Map(prev);
        for (const [id] of activeDirtyItems) next.delete(id);
        return next;
      });

      setReloadKey((k) => k + 1);
      api
        .getMods()
        .then((data) => setAllMods(data.mods || []))
        .catch(() => {});
    } catch (err) {
      setSaveError(`${activeMod ? activeMod.name : activeModId}: ${err.message}`);
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
  if (error && allMods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Editor">
          <p className="text-sm text-danger">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onReselect}>
              Go to Mods
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading mods ===
  if (allMods.length === 0) {
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
      <aside className="flex w-[19.0625rem] shrink-0 flex-col gap-3 self-stretch overflow-y-auto border-r border-line py-4 pr-4">
        <Input
          placeholder="Search Mods..."
          value={modSearch}
          onChange={(e) => setModSearch(e.target.value)}
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
          />
          <div ref={fileTabBarRef} className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <div ref={fileTabMeasureRef} aria-hidden="true" className="pointer-events-none absolute invisible flex gap-1 whitespace-nowrap">
              <span className="h-6 w-6 shrink-0" />
              <button type="button" tabIndex={-1} className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold">All Files</button>
              {files.map((file) => (
                <button key={file} type="button" tabIndex={-1} className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold">{file}</button>
              ))}
              <span className="h-6 w-6 shrink-0" />
            </div>
            <button
              type="button"
              disabled={!hasPreviousFileTabPage}
              onClick={() => setFileTabPage((page) => Math.max(0, page - 1))}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-raised hover:bg-line disabled:cursor-default disabled:opacity-40 disabled:hover:bg-raised"
              aria-label="Show previous files"
              title="Previous files"
            >
              <img src={previousIcon} alt="" className="h-3 w-3" />
            </button>
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
            {visibleFileTabs.map((f) => (
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

            {hasNextFileTabPage && (
              <button
                type="button"
                onClick={() => setFileTabPage((page) => page + 1)}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-raised hover:bg-line"
                aria-label="Show next files"
                title="Next files"
              >
                <img src={nextIcon} alt="" className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="secondary"
            icon={Save}
            onClick={handleSave}
            disabled={dirtySize === 0 || saving || !activeModId}
          >
            {saving ? "Saving..." : dirtySize === 0 ? "Save" : `Save (${dirtySize})`}
          </Button>
        </div>

        {/* Error / success display */}
        {saveError && (
          <p className="px-4 pb-2 text-sm text-danger">{saveError}</p>
        )}

        {orphanedDirtyModIds.length > 0 && (
          <p className="px-4 pb-2 text-sm text-warning">
            You have unsaved changes in {orphanedDirtyModIds.length} mod(s) no
            longer selected on the Mods page — reselect{" "}
            {orphanedDirtyModIds.length === 1 ? "it" : "them"} there to save or
            discard those changes.
          </p>
        )}

        {/* Entry area */}
        <div className="flex-1 overflow-auto">
          {!activeMod && (
            <div className="mx-auto max-w-md px-6 py-10">
              <Card title="Editor">
                {universe.length > 0 ? (
                  <p className="text-sm text-muted">No mod selected — pick one from the sidebar.</p>
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
                <SortHeader field="translation" label="Translation" className="w-1/3 shrink-0 border-l border-muted/15 px-4 pt-[0.5rem] pb-[0.6rem]" sort={sort} onCycle={cycleSort} />
                <SortHeader field="original" label="Original" className="w-1/3 min-w-0 border-l border-muted/15 pl-4 pt-[0.5rem] pb-[0.6rem]" sort={sort} onCycle={cycleSort} />
              </div>
              <EntryRows
                entries={visibleEntries}
                renderCount={renderCount}
                search={search}
                sort={sort}
                dirty={dirty}
                sortDirty={dirtyDebounced}
                updateDirty={updateDirty}
                sentinelRef={sentinelRef}
                hasMore={hasMore}
                fetching={entriesLoading}
                showFileDividers={activeFile === null}
              />
            </>
          )}
        </div>
      </main>
    </div>
    </div>
  );
}
