import { useCallback, useEffect, useState } from "react";
import { FileInput, FileOutput, Save } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";

// The mod selection IS the Library selection — one shared sessionStorage key,
// so the Editor shows exactly what was picked in the Library (and vice versa).
const STORAGE_KEY = "pt_library_selected";
const LOCK_KEY = "pt_library_locked";

function loadStoredIds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return ids;
    }
  } catch { /* ignore */ }
  return [];
}

export default function Editor({ onReselect }) {
  // --- Mod selection (shared with the Library, persisted via sessionStorage) ---
  const [modIds, setModIds] = useState(() => loadStoredIds());
  // Lock set in the Library freezes the shared selection everywhere.
  const [locked, setLocked] = useState(() => {
    try {
      return sessionStorage.getItem(LOCK_KEY) === "1";
    } catch { /* ignore */ }
    return false;
  });

  // --- State ---
  const [allMods, setAllMods] = useState([]);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // --- LLM export / import ---
  const [targetLang, setTargetLang] = useState("DE");
  const [exportLoading, setExportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const [entriesByMod, setEntriesByMod] = useState(new Map());
  const [search, setSearch] = useState("");

  const [dirty, setDirty] = useState(new Map());
  const [loading, setLoading] = useState(false);

  // --- Persist mod selection (shared key — the Library reads it too) ---
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(modIds));
    } catch { /* ignore */ }
  }, [modIds]);

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

  // Sidebar: only the SELECTED mods, in selection order
  const sidebarMods = allMods.filter((m) => modIds.includes(m.id));

  // Selected mods only (for entries loading, dirty tracking, etc.)
  const entryMods = allMods.filter((m) => modIds.includes(m.id));
  const entryModsKey = entryMods.map((m) => m.id).join("\u0000");

  // --- Mod selection helpers (locked in the Library → frozen everywhere) ---
  const toggleMod = (id) => {
    if (locked) return;
    setModIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const allSelected =
    allMods.length > 0 && allMods.every((m) => modIds.includes(m.id));

  const toggleAllMods = () => {
    if (locked) return;
    if (allSelected) {
      setModIds([]);
    } else {
      setModIds(allMods.map((m) => m.id));
    }
  };

  // --- Load entries for every selected mod (recalled on selection/search) ---
  useEffect(() => {
    if (entryMods.length === 0) {
      setEntriesByMod(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      entryMods.map(async (mod) => {
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
  }, [entryModsKey, search]);

  // --- Search handler ---
  const handleSearch = (val) => {
    setSearch(val);
  };

  // --- Dirty tracking: dirty only when the value differs from the loaded one ---
  const updateDirty = useCallback((id, translation, original) => {
    const value = translation === null ? "" : String(translation);
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

  // Grouped dirty entries per selected mod, in selection order
  const dirtyByMod = entryMods
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
    setSaving(true);
    setSaveError("");
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
    // Reload entries + updated counts
    setEntriesByMod(new Map());
    setSearch((s) => s); // no-op, keep value
    api
      .getMods()
      .then((data) => setAllMods(data.mods || []))
      .catch(() => {});
  };

  // --- LLM export: selected mods to the configured target language ---
  const handleLlmExport = async () => {
    if (modIds.length === 0) return;
    setExportLoading(true);
    setSaveError("");
    try {
      await api.exportLlm(modIds, targetLang);
      const data = await api.getMods();
      setAllMods(data.mods || []);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  // --- LLM import: preview first, apply with confirmation ---
  const handleImportPreview = async () => {
    setImportLoading(true);
    setSaveError("");
    try {
      const result = await api.importPreview();
      setImportPreview(result);
      setImportModalOpen(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportApply = async () => {
    setApplyLoading(true);
    setSaveError("");
    try {
      await api.importApply();
      setImportModalOpen(false);
      setImportPreview(null);
      // Reload entries + counts so the editor shows the imported translations
      const data = await api.getMods();
      setAllMods(data.mods || []);
      setEntriesByMod(new Map());
      setSearch((s) => s);
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
      {/* Sidebar: selected mods only (shared Library selection), scrollable independently */}
      <aside className="w-64 shrink-0 self-stretch overflow-y-auto border-r border-line bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-mono font-medium text-muted uppercase">
            {locked ? "Selected (locked)" : "Selected"}
            {sidebarMods.length > 0 && (
              <span className="ml-1 text-muted">{`(${sidebarMods.length})`}</span>
            )}
          </p>
          <button
            onClick={toggleAllMods}
            disabled={locked}
            className="rounded-md px-2 py-0.5 text-xs font-mono text-muted transition-colors hover:bg-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {allSelected ? "None" : "All"}
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
                checked={modIds.includes(mod.id)}
                onChange={() => toggleMod(mod.id)}
                disabled={locked}
                className="size-4 shrink-0 cursor-pointer accent-[var(--color-accent)] disabled:cursor-default"
                aria-label={`Select ${mod.name}`}
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
          </div>
          {entryMods.length === 1 && (
            <ProgressBar
              value={entryMods[0].translatedCount}
              max={entryMods[0].entryCount}
              color="dust"
              showValue
            />
          )}
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
            disabled={modIds.length === 0 || exportLoading}
            title="Export selected mods as LLM JSON (EN originals)"
          >
            {exportLoading ? "Exporting..." : "Export"}
          </Button>
          <Button
            variant="secondary"
            icon={FileOutput}
            onClick={handleImportPreview}
            disabled={importLoading}
            title="Preview LLM import from the import folder"
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

        {/* Error display */}
        {saveError && (
          <p className="px-4 pt-2 text-sm text-danger">{saveError}</p>
        )}

        {/* Entry area — one block per selected mod */}
        <div className="flex-1 overflow-auto">
          {entryMods.length === 0 && (
            <div className="mx-auto max-w-md px-6 py-10">
              <Card title="Editor">
                <p className="text-sm text-muted">
                  No mods selected. Pick them in the Library
                  {locked ? " (unlock the selection there first)" : ""}.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" onClick={onReselect}>
                    Go to Library
                  </Button>
                </div>
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

                  {/* Column headers per mod block */}
                  <div className="border-b border-line bg-raised px-4 py-2 text-xs font-mono font-medium text-muted">
                    <div className="flex items-center">
                      <span className="w-[30%] shrink-0">Key</span>
                      <span className="w-[40%] shrink-0">Translation</span>
                      <span className="w-[30%]">Original</span>
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
                    entries.map((entry) => {
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
              No files found in the import folder.
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
