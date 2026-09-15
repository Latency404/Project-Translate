import { useCallback, useEffect, useRef, useState } from "react";
import { FileInput, FileOutput, Save } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";

// The universe of mods the Editor can show IS the Library selection — the
// Editor only ever READS this key (the Library writes it). Deselecting a mod in
// the Editor sidebar never touches the Library selection.
const UNIVERSE_KEY = "pt_library_selected";
// Editor-only visibility — the Editor's OWN selection, separate from the
// Library. Persisted in its own key so per-mod visibility survives view
// switches without touching the Library selection at all.
const VISIBLE_KEY = "pt_editor_visible";

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

// Sortable column header (Key / Translation / Original). Shared `sort`
// state across every mod block; click toggles asc → desc → server order.
function SortHeader({ field, label, className, sort, onCycle }) {
  const active = sort && sort.field === field;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
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
      <span className={`font-mono ${active ? "text-accent" : "text-muted/50"}`}>
        {arrow}
      </span>
    </button>
  );
}

export default function Editor({ onReselect }) {
  // --- Universe: the Library selection (read-only here) ---
  // The Editor only shows the mods picked in the Library. This key is written
  // by the Library; the Editor reads it on mount and never writes it back, so
  // the sidebar selection stays fully separate from the Library selection.
  const [universeIds] = useState(() => loadUniverseIds());
  // --- Editor-only visibility — the Editor's OWN selection ---
  // The sidebar checkboxes toggle this: it hides/shows mods in the Editor only,
  // never touching the Library selection. Persisted so per-mod visibility
  // survives view switches. null = everything in the universe is visible.
  const [visibleIds, setVisibleIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem(VISIBLE_KEY);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) return ids;
      }
    } catch { /* ignore */ }
    return null; // null = everything visible
  });

  // --- State ---
  const [allMods, setAllMods] = useState([]);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  // --- LLM export / import ---
  const [targetLang, setTargetLang] = useState("DE");
  const [exportLoading, setExportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Text der für den Import gewählten Datei (aus dem Browser-Open-Dialog) —
  // wird bei Apply unverändert nachgeschickt.
  const [importText, setImportText] = useState(null);
  const fileInputRef = useRef(null);

  const [entriesByMod, setEntriesByMod] = useState(new Map());
  const [search, setSearch] = useState("");
  // Column sort for Key / Translation / Original (asc | desc); null = server order.
  const [sort, setSort] = useState(null);

  const [dirty, setDirty] = useState(new Map());
  const [loading, setLoading] = useState(false);
  // Bumped after save/import: the entries effect depends on this, so the
  // list reloads after a save (the no-op setSearch() trick below is gone).
  const [reloadKey, setReloadKey] = useState(0);

  // --- Load config + library ---
  useEffect(() => {
    Promise.all([api.getConfig(), api.getMods()])
      .then(([cfg, data]) => {
        setTargetLang(cfg.targetLang || "DE");
        setAllMods(data.mods || []);
      })
      .catch((err) => {
        setError(err.message);
        setAllMods([]);
      });
  }, []);

  // --- Persist the Editor's own visibility so it survives view switches ---
  // (the universe key belongs to the Library — the Editor never writes it.)
  // null (everything visible) clears the key; a concrete list is stored.
  useEffect(() => {
    try {
      if (visibleIds === null) {
        sessionStorage.removeItem(VISIBLE_KEY);
      } else {
        sessionStorage.setItem(VISIBLE_KEY, JSON.stringify(visibleIds));
      }
    } catch { /* ignore */ }
  }, [visibleIds]);

  // Universe: the mods picked in the Library (read-only source for the Editor).
  const universe = allMods.filter((m) => universeIds.includes(m.id));
  // What is actually VISIBLE in the editor: the Editor's own selection on top
  // of the universe (stale ids not in the universe are dropped). null =
  // everything in the universe is visible.
  const visible = (visibleIds ?? universeIds).filter((id) =>
    universeIds.includes(id),
  );
  // Sidebar: the FULL Library selection — deselecting a mod keeps its entry
  // in the sidebar (unchecked), it never disappears, and the Library selection
  // stays untouched.
  const sidebarMods = universe;
  // Content: only the visible mods.
  const entryMods = universe.filter((m) => visible.includes(m.id));
  // Overall progress across all visible mods (header status bar: X/X).
  const totalEntries = entryMods.reduce((s, m) => s + m.entryCount, 0);
  const totalTranslated = entryMods.reduce((s, m) => s + m.translatedCount, 0);

  // Entries are loaded for the full Library selection, so hiding a mod is
  // display-only: its entries stay loaded, tracked, and savable.
  const loadModsKey = universe.map((m) => m.id).join("\u0000");

  // --- Mod visibility helpers (Editor only — the Library selection is read-only) ---
  const toggleMod = (id) => {
    setVisibleIds((prev) => {
      const current = prev ?? universeIds;
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return next.length === universeIds.length ? null : next;
    });
  };

  const allVisible =
    universeIds.length > 0 && universeIds.every((id) => visible.includes(id));

  const toggleAllMods = () => {
    setVisibleIds(allVisible ? [] : [...universeIds]);
  };

  // --- Load entries for the full Library selection (recalled on search) ---
  useEffect(() => {
    const mods = universe;
    if (mods.length === 0) {
      setEntriesByMod(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      mods.map(async (mod) => {
        const data = await api.getEntries(mod.id, {
          page: 1,
          pageSize: 99999,
          search,
        });
        return [mod.id, { entries: data.entries || [], total: data.total || 0 }];
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setEntriesByMod(new Map(pairs));
        setSaveError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadModsKey, search, reloadKey]);

  // --- Search handler ---
  const handleSearch = (val) => {
    setSearch(val);
  };

  // --- Dirty tracking: dirty only when the value differs from the loaded one ---
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
      setDirty((prev) => new Map(prev).set(id, value));
    }
  }, []);

  // Grouped dirty entries per SELECTED mod (visibility-independent: a hidden
  // mod keeps its edits savable — hiding is display-only).
  const dirtyByMod = sidebarMods
    .map((mod) => {
      const ids = new Set((entriesByMod.get(mod.id)?.entries || []).map((e) => e.id));
      return {
        mod,
        items: Array.from(dirty.entries()).filter(([id]) => ids.has(id)),
      };
    })
    .filter((g) => g.items.length > 0);

  const dirtySize = dirty.size;

  // --- Save all selected mods one after another ---
  const handleSave = async () => {
    const withDirty = dirtyByMod.filter((g) => g.items.length > 0);
    if (withDirty.length === 0) return;
    const dirtyCount = withDirty.reduce((s, g) => s + g.items.length, 0);
    setSaving(true);
    setSaveError("");
    setNotice("");
    for (const { mod, items } of withDirty) {
      try {
        await api.saveEntries(
          mod.id,
          items.map(([entryId, translation]) => ({ entryId, translation })),
        );
      } catch (err) {
        setSaveError(`${mod.name}: ${err.message}`);
      }
    }
    setDirty(new Map());
    setSaving(false);
    // Reload entries + updated counts. The save route awaits its rescan,
    // so the cache is already fresh when this fires — reloadKey re-triggers
    // the entries effect (the Library selection doesn't change on save).
    setNotice(`Gespeichert: ${dirtyCount} Einträge in ${withDirty.length} Mod(s).`);
    setReloadKey((k) => k + 1);
    api
      .getMods()
      .then((data) => setAllMods(data.mods || []))
      .catch(() => {});
  };

  // --- LLM export: alle sichtbaren Mods in EINE Datei (Browser-Save-Dialog) ---
  const handleLlmExport = async () => {
    if (visible.length === 0) return;
    setExportLoading(true);
    setSaveError("");
    setNotice("");
    try {
      const result = await api.exportLlm(visible, targetLang);
      const blob = new Blob([result.text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `Exportiert ${result.modCount} Mod(s), ${result.entryCount} Einträge als „${result.filename}" — die Datei kann direkt in die KI zum Übersetzen gegeben werden, danach „Import".`,
      );
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  // --- LLM import: Datei wählen (Browser-Open-Dialog) → Vorschau, Apply mit Bestätigung ---
  const handleImportClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleImportFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportLoading(true);
    setSaveError("");
    try {
      const text = await file.text();
      const result = await api.importPreview(text);
      setImportText(text);
      setImportPreview(result);
      setImportModalOpen(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setImportLoading(false);
      // Wert zurücksetzen, damit dieselbe Datei erneut wählbar ist.
      e.target.value = "";
    }
  };

  const handleImportApply = async () => {
    setApplyLoading(true);
    setSaveError("");
    try {
      await api.importApply(importText);
      setImportModalOpen(false);
      setImportPreview(null);
      setImportText(null);
      // Reload entries + counts so the editor shows the imported translations
      // (apply awaits its rescan — the cache is fresh; reloadKey re-triggers
      // the entries effect).
      const data = await api.getMods();
      setAllMods(data.mods || []);
      setNotice("Import übernommen — die importierten Übersetzungen sind gespeichert.");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setApplyLoading(false);
    }
  };

  const totalMatched = importPreview
    ? Object.values(importPreview.perMod).reduce((s, p) => s + p.matched, 0)
    : 0;
  const totalUnmatched = importPreview
    ? Object.values(importPreview.perMod).reduce((s, p) => s + p.unmatched, 0)
    : 0;

  // --- Entry-by-entry dirty check ---
  const getEntryTranslation = useCallback(
    (entry) => {
      return dirty.has(entry.id) ? dirty.get(entry.id) : entry.translation;
    },
    [dirty],
  );

  const isEntryDirty = useCallback(
    (entry) => {
      return dirty.has(entry.id);
    },
    [dirty],
  );

  // --- Column sort: click a header to toggle asc → desc → (server order) ---
  const cycleSort = (field) => {
    setSort((prev) => {
      if (prev && prev.field === field) {
        return prev.dir === "asc" ? { field, dir: "desc" } : null;
      }
      return { field, dir: "asc" };
    });
  };

  const sortEntries = (entries) => {
    if (!sort || entries.length <= 1) return entries;
    const { field, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    const val = (e) => {
      if (field === "key") return String(e.key ?? "");
      if (field === "translation") {
        const t = dirty.has(e.id) ? dirty.get(e.id) : e.translation;
        return t === null || t === undefined ? "" : String(t);
      }
      return String(e.original ?? "");
    };
    return [...entries].sort((a, b) =>
      val(a) < val(b) ? -factor : val(a) > val(b) ? factor : 0,
    );
  };

  // === Error state (e.g. no scan) ===
  if (error && allMods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Editor">
          <p className="text-sm text-danger">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onReselect}>
              Go to Library
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

  // === Main editor --- sidebar = ALL mods, content = selected mods ===
  return (
    <div className="flex h-full">
      {/* Verstecktes Dateifeld: „Import" öffnet den Browser-Open-Dialog. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* Sidebar: the full Library selection. The checkboxes only control
          what is VISIBLE in the editor — the Library selection is never
          touched, so a mod never disappears from the sidebar. */}
      <aside className="w-64 shrink-0 self-stretch overflow-y-auto border-r border-line bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-mono font-medium text-muted uppercase">
            Selected
            {sidebarMods.length > 0 && (
              <span className="ml-1 text-muted">
                {`(${visible.length}/${sidebarMods.length})`}
              </span>
            )}
          </p>
          <button
            onClick={toggleAllMods}
            title="Show/hide all mods in the editor (Library selection untouched)"
            className="rounded-md px-2 py-0.5 text-xs font-mono text-muted transition-colors hover:bg-raised hover:text-text"
          >
            {allVisible ? "Hide all" : "Show all"}
          </button>
        </div>
        <nav className="space-y-1">
          {sidebarMods.map((mod) => (
            <div
              key={mod.id}
              className="flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-raised/50 bg-raised/30"
            >
              <input
                type="checkbox"
                checked={visible.includes(mod.id)}
                onChange={() => toggleMod(mod.id)}
                className="size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                aria-label={`Show ${mod.name} in editor`}
              />
              <div className="min-w-0 flex-1 text-left text-sm">
                <span className="block truncate text-text">{mod.name}</span>
                <span className="mt-0.5 block text-xs font-mono text-muted">
                  {mod.translatedCount} / {mod.entryCount}
                </span>
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-bold text-accent">
              {entryMods.length === 0
                ? "Editor"
                : entryMods.length > 1
                  ? `${entryMods.length} Mods`
                  : entryMods[0]?.name || ""}
            </span>
            {entryMods.length === 1 && entryMods[0].isBaseGame && (
              <Tag tone="base">Base Game</Tag>
            )}
            <div className="flex-1" />
            {entryMods.length > 0 && (
              <ProgressBar
                label={`All ${entryMods.length === 1 ? "mod" : "mods"}`}
                value={totalTranslated}
                max={totalEntries}
                color="dust"
                showValue
                className="w-48"
              />
            )}
          </div>
        </header>

        {/* Search + Save + LLM Export/Import */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex-1">
            <Input
              placeholder="Search... (all mods)"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={FileInput}
            onClick={handleLlmExport}
            disabled={visible.length === 0 || exportLoading}
            title="Export visible mods as LLM JSON (EN originals)"
          >
            {exportLoading ? "Exporting..." : "Export"}
          </Button>
          <Button
            variant="secondary"
            icon={FileOutput}
            onClick={handleImportClick}
            disabled={importLoading}
            title="Choose a translated LLM file to import (browser file picker)"
          >
            {importLoading ? "Loading..." : "Import"}
          </Button>
          <Button
            variant="primary"
            icon={Save}
            onClick={handleSave}
            disabled={dirtySize === 0 || saving}
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

        {/* Entry area — one block per selected mod */}
        <div className="flex-1 overflow-auto">
          {entryMods.length === 0 && (
            <div className="mx-auto max-w-md px-6 py-10">
              <Card title="Editor">
                {universe.length > 0 ? (
                  <p className="text-sm text-muted">
                    All selected mods are hidden in the Editor. Show them via
                    the sidebar or „Show all" — the Library selection itself
                    is untouched.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      No mods selected. Pick them in the Library.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button variant="secondary" onClick={onReselect}>
                        Go to Library
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}

          {entryMods.length > 0 && loading && (
            <p className="px-4 py-6 text-sm text-muted">Loading...</p>
          )}

          {entryMods.length > 0 && !loading &&
            entryMods.map((mod, i) => {
              const info = entriesByMod.get(mod.id);
              const entries = info?.entries || [];
              return (
                <div key={mod.id}>
                  {/* Mod block header: visual separation between mods —
                      gleiche obere Trennlinie bei jedem Block (auch dem ersten) */}
                  <div
                    className="sticky top-0 z-10 border-t-4 border-t-line border-b-2 border-accent bg-surface px-4 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-text">
                        {mod.name}
                      </span>
                      {mod.isBaseGame && <Tag tone="base">Base Game</Tag>}
                      <span className="text-xs font-mono text-muted">
                        {info?.total ?? entries.length} entries
                      </span>
                      <div className="flex-1" />
                      <ProgressBar
                        value={mod.translatedCount}
                        max={mod.entryCount}
                        color="dust"
                        showValue
                        className="w-40"
                      />
                    </div>
                  </div>

                  {/* Column headers per mod block — click to sort (asc/desc/reset) */}
                  <div className="border-b border-line bg-raised px-4 py-2 text-xs font-mono font-medium text-muted">
                    <div className="flex items-center">
                      <SortHeader field="key" label="Key" className="w-[30%] shrink-0" sort={sort} onCycle={cycleSort} />
                      <SortHeader field="translation" label="Translation" className="w-[40%] shrink-0" sort={sort} onCycle={cycleSort} />
                      <SortHeader field="original" label="Original" className="w-[30%]" sort={sort} onCycle={cycleSort} />
                    </div>
                  </div>

                  {entries.length === 0 ? (
                    search !== "" ? (
                      <p className="px-4 py-3 text-sm text-muted">
                        No entries for this search.
                      </p>
                    ) : (
                      <p className="px-4 py-3 text-sm text-muted">
                        No entries.
                      </p>
                    )
                  ) : (
                    sortEntries(entries).map((entry) => {
                      const currentTranslation = getEntryTranslation(entry);
                      const entryDirty = isEntryDirty(entry);

                      let statusClass = "outline-success";
                      if (entryDirty) statusClass = "outline-accent";
                      else if (!entry.translation) statusClass = "outline-warning";

                      return (
                        <div
                          key={entry.id}
                          className="flex items-center border-b border-line last:border-b-0 hover:bg-raised/30"
                        >
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
                      );
                    })
                  )}
                </div>
              );
            })}
        </div>
      </main>

      {/* Import confirmation modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Apply LLM import"
      >
        <div className="space-y-4">
          {totalMatched === 0 && totalUnmatched === 0 ? (
            <p className="text-sm text-muted">
              No matching entries found in the chosen file.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                {Object.values(importPreview.perMod).map((pm) => (
                  <div
                    key={pm.mod}
                    className="flex items-center gap-2 rounded px-2 py-1"
                  >
                    <span className="flex-1 text-sm text-text">{pm.mod}</span>
                    <span className="font-mono text-sm text-success">
                      {pm.matched}
                    </span>
                    {pm.unmatched > 0 && (
                      <span className="font-mono text-sm text-warning">
                        {pm.unmatched}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-sm text-text">
                {totalMatched} entries will be written to {targetLang} files.
                {totalUnmatched > 0 &&
                  ` (${totalUnmatched} unmatched will be discarded).`}
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setImportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={applyLoading || totalMatched === 0}
              onClick={handleImportApply}
            >
              {applyLoading ? "Applying..." : "Yes, apply"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
