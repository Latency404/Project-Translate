import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Save } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Tag from "../components/Tag.jsx";
import { loadDirty, saveDirty, reviewModIds, statusOf } from "../reviewStore.js";

// Anzeige-Name ohne den "(Base Game)"-Zusatz — der volle Name (mod.name) bleibt
// als Backend-Wert unverändert (Export-Ordnernamen etc. hängen daran).
function displayModName(mod) {
  return mod.name.replace(/\s*\(Base Game\)\s*$/, "");
}

const STATUS_TAG = {
  open: { tone: "warning", label: "Open" },
  translated: { tone: "success", label: "Translated" },
  review: { tone: "accent", label: "Needs Review" },
};

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
      className={`flex items-center gap-1 text-left text-xs font-mono font-medium transition-colors hover:text-text ${
        active ? "text-accent" : "text-muted"
      } ${className || ""}`}
    >
      {label}
      <Icon size={12} className={active ? "text-accent" : "text-muted/50"} aria-hidden />
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
        const entryDirty = isDirtyEntry(entry, dirty);

        let statusClass = "outline-success";
        if (entryDirty) statusClass = "outline-accent";
        else if (!entry.translation) statusClass = "outline-warning";

        const sourceFile = sourceFileOf(entry);
        const showFileDivider = showFileDividers && sourceFile !== prevSourceFile;
        prevSourceFile = sourceFile;

        return (
          <div key={entry.id}>
            {showFileDivider && (
              <div className="border-t border-line/60 bg-raised/40 px-4 py-1.5 text-xs font-mono text-muted">
                {sourceFile}
              </div>
            )}
            <div className="flex items-center border-b border-line last:border-b-0 hover:bg-raised/30">
              <span className="w-[30%] shrink-0 truncate px-4 py-2 text-xs font-mono text-text">
                {entry.key}
              </span>
              <span className="w-[40%] shrink-0 px-2 py-2">
                <input
                  value={currentTranslation}
                  onChange={(e) => updateDirty(entry.id, e.target.value, entry.translation)}
                  placeholder="Translation..."
                  className={`h-9 w-full min-w-[20ch] rounded-md border border-line bg-raised px-3 text-sm text-text placeholder:text-muted/60 outline-2 outline-offset-1 focus-visible:outline-2 ${statusClass}`}
                />
              </span>
              <span className="w-[30%] truncate px-4 py-2 text-sm font-mono text-text">
                {entry.original}
              </span>
            </div>
          </div>
        );
      })}
      {hasMore && (
        <div ref={sentinelRef} className="px-4 py-3 text-xs font-mono text-muted">
          {fetching ? "Loading more..." : "Loading more..."}
        </div>
      )}
    </>
  );
}

export default function Editor({ onReselect }) {
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
  const [notice, setNotice] = useState("");
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

  // --- Load Library selection's mods ---
  useEffect(() => {
    api
      .getMods()
      .then((data) => setAllMods(data.mods || []))
      .catch((err) => {
        setError(err.message);
        setAllMods([]);
      });
  }, []);

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
  });
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
        if (val.modId === activeModId && !validIds.has(id)) {
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

  const visibleEntries = activeFile
    ? entries.filter((e) => sourceFileOf(e) === activeFile)
    : entries;

  // --- Dirty tracking: dirty only when the value differs from the loaded one.
  // Preserves an existing "import" origin (still unreviewed) when the user
  // edits an imported value further; brand-new edits are "manual". ---
  const updateDirty = useCallback((id, translation, original) => {
    const value = translation === null ? "" : String(translation);
    setNotice("");
    if (value === original) {
      setDirty((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else {
      setDirty((prev) => {
        const existing = prev.get(id);
        const next = new Map(prev);
        next.set(id, { modId: activeModId, value, origin: existing?.origin || "manual" });
        return next;
      });
    }
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
    setNotice("");
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
      setNotice(`Saved ${activeDirtyItems.length} entries.`);
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

  return (
    <div className="flex h-full">
      {/* Sidebar: the full Library selection, single-select — click a mod to
          open it. The Library selection itself is never touched here. */}
      <aside className="w-64 shrink-0 self-stretch overflow-y-auto border-r border-line bg-surface p-3">
        <Input
          placeholder="Search Mods..."
          value={modSearch}
          onChange={(e) => setModSearch(e.target.value)}
          className="mb-2"
        />
        <div className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setModFilter(f.key)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                modFilter === f.key
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-raised text-muted hover:text-text"
              }`}
            >
              {f.label} ({filterCounts[f.key]})
            </button>
          ))}
        </div>
        <nav className="space-y-1">
          {sidebarMods.map((mod) => {
            const status = statusOf(mod, reviewIds);
            const isActive = mod.id === activeModId;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveModId(mod.id)}
                className={`block w-full rounded-md border px-2 py-2 text-left transition-colors ${
                  isActive
                    ? "border-accent bg-accent/10"
                    : "border-transparent bg-raised/30 hover:bg-raised/50"
                }`}
              >
                <span className="block truncate text-sm text-text">{displayModName(mod)}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="text-xs font-mono text-muted">
                    {mod.translatedCount} / {mod.entryCount}
                  </span>
                  <Tag tone={STATUS_TAG[status].tone} className="ml-auto">
                    {STATUS_TAG[status].label}
                  </Tag>
                </span>
              </button>
            );
          })}
          {sidebarMods.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted">No mods match.</p>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-bold text-accent">
              {activeMod ? displayModName(activeMod) : "Editor"}
            </span>
            {activeMod && (
              <Tag tone={STATUS_TAG[statusOf(activeMod, reviewIds)].tone}>
                {STATUS_TAG[statusOf(activeMod, reviewIds)].label}
              </Tag>
            )}
          </div>
        </header>

        {/* File tabs + Search + Save */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Input
            placeholder="Search Entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 shrink-0"
          />
          <div className="flex flex-1 flex-wrap gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveFile(null)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                activeFile === null
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-raised text-muted hover:text-text"
              }`}
            >
              All Files
            </button>
            {files.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeFile === f
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-line bg-raised text-muted hover:text-text"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            icon={Save}
            onClick={handleSave}
            disabled={dirtySize === 0 || saving || !activeModId}
          >
            {saving ? "Saving..." : dirtySize === 0 ? "Save" : `Save (${dirtySize})`}
          </Button>
        </div>

        {/* Error / success display */}
        {saveError && (
          <p className="px-4 pt-2 text-sm text-danger">{saveError}</p>
        )}
        {!saveError && notice && (
          <p className="px-4 pt-2 text-sm text-success">{notice}</p>
        )}
        {orphanedDirtyModIds.length > 0 && (
          <p className="px-4 pt-2 text-sm text-warning">
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
              <div className="sticky top-0 z-10 border-b border-line bg-raised px-4 py-2 text-xs font-mono font-medium text-muted">
                <div className="flex items-center">
                  <SortHeader field="key" label="Key" className="w-[30%] shrink-0" sort={sort} onCycle={cycleSort} />
                  <SortHeader field="translation" label="Translation" className="w-[40%] shrink-0" sort={sort} onCycle={cycleSort} />
                  <SortHeader field="original" label="Original" className="w-[30%]" sort={sort} onCycle={cycleSort} />
                </div>
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
  );
}
