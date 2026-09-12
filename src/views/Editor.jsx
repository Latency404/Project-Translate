import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Save } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";

export default function Editor({ modIds, onBack }) {
  // --- State ---
  const [modsMeta, setModsMeta] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");

  const [dirty, setDirty] = useState(new Map());
  const [loading, setLoading] = useState(false);

  // --- Load mod metadata ---
  useEffect(() => {
    if (!modIds || modIds.length === 0) return;
    api
      .getMods()
      .then((data) => {
        const mods = (data.mods || []).filter((m) => modIds.includes(m.id));
        setModsMeta(mods);
        setActiveIdx(0);
      })
      .catch((err) => {
        setError(err.message);
        setModsMeta([]);
      });
  }, [modIds]);

  // --- Derived active mod ---
  const activeMod = modsMeta[activeIdx] || null;

  // --- Load entries (recalled on mod change, page, search) ---
  const loadEntries = useCallback(
    async (p, s) => {
      if (!activeMod) return;
      setLoading(true);
      try {
        const data = await api.getEntries(activeMod.id, { page: p, pageSize, search: s });
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        setSaveError("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [activeMod, pageSize],
  );

  useEffect(() => {
    loadEntries(page, search);
  }, [activeMod, page, search, loadEntries]);

  // --- Search handler ---
  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
  };

  // --- Dirty tracking: dirty nur wenn der Wert vom geladenen abweicht ---
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

  const dirtySize = dirty.size;

  // --- Save ---
  const handleSave = async () => {
    if (!activeMod) return;
    const entriesArr = Array.from(dirty.entries());
    setSaveError("");
    try {
      await api.saveEntries(activeMod.id, entriesArr.map(([entryId, translation]) => ({ entryId, translation })));
      setDirty(new Map());
      loadEntries(page, search);
      // Reload mod metadata for updated counts
      api
        .getMods()
        .then((data) => {
          const mods = (data.mods || []).filter((m) => modIds.includes(m.id));
          setModsMeta(mods);
        })
        .catch(() => {});
    } catch (err) {
      setSaveError(err.message);
    }
  };

  // --- Navigation ---
  const goToPrev = () => {
    setPage(1);
    setSearch("");
    setActiveIdx((prev) => (prev - 1 + modsMeta.length) % modsMeta.length);
  };

  const goToNext = () => {
    setPage(1);
    setSearch("");
    setActiveIdx((prev) => (prev + 1) % modsMeta.length);
  };

  // --- Max pages ---
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

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

  // === Empty state: no modIds ===
  if (!modIds || modIds.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Editor">
          <p className="text-sm text-muted">Kein Mod ausgewählt.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onBack}>
              Zurück zu den Mods
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Error state (e.g. no scan) ===
  if (error && modsMeta.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Editor">
          <p className="text-sm text-danger">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onBack}>
              Zurück zu den Mods
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading mods ===
  if (modsMeta.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-center text-muted">Lädt…</p>
      </div>
    );
  }

  // === Main editor ===
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Kopfzeile */}
      <header className="mb-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xl font-bold text-accent">
            {activeMod?.name || ""}
          </span>
          {activeMod?.isBaseGame && <Tag tone="base">Base Game</Tag>}
          <div className="flex-1" />
          {/* Mod-Navigation */}
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronLeft}
            onClick={goToPrev}
            disabled={modsMeta.length <= 1}
          >
            Vorheriger
          </Button>
          <span className="font-mono text-sm text-muted">
            {activeIdx + 1} / {modsMeta.length}
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronRight}
            onClick={goToNext}
            disabled={modsMeta.length <= 1}
          >
            Nächster
          </Button>
        </div>
        {/* Fortschrittsbalken */}
        {activeMod && (
          <ProgressBar
            value={activeMod.translatedCount}
            max={activeMod.entryCount}
            color="dust"
            showValue
          />
        )}
      </header>

      {/* Seitenstatus */}
      <p className="mb-2 text-xs text-muted">
        {total} Einträge — {activeMod?.translatedCount || 0} übersetzt
      </p>

      {/* Suche + Speichern */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <Input
            placeholder="Suchen…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          icon={Save}
          onClick={handleSave}
          disabled={dirtySize === 0}
        >
          {dirtySize === 0 ? "Speichern" : `Speichern (${dirtySize})`}
        </Button>
      </div>

      {/* Fehleranzeige */}
      {saveError && (
        <p className="mb-2 text-sm text-danger">{saveError}</p>
      )}

      {/* Eintragsliste */}
      {loading && <p className="text-sm text-muted">Lädt…</p>}

      {!loading && entries.length === 0 && total === 0 && search !== "" && (
        <p className="text-sm text-muted">Keine Einträge für diese Suche.</p>
      )}

      <div className="grid max-h-[50vh] grid-cols-2 gap-x-6 gap-y-2 overflow-y-auto rounded-lg border border-line bg-surface p-4">
        {entries.map((entry) => {
          const currentTranslation = getEntryTranslation(entry);
          const entryDirty = isEntryDirty(entry);

          // Statusring: gelb = fehlt, grün = vorhanden, Akzent = ungespeicherte Änderung
          let statusClass = "outline-success";
          if (entryDirty) statusClass = "outline-accent";
          else if (!entry.translation) statusClass = "outline-warning";

          return (
            <div key={entry.id} className="flex flex-col gap-1 sm:flex-row sm:gap-4 sm:items-start">
              {/* Links: Übersetzung */}
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-mono text-muted">
                  {entry.key}
                </label>
                <input
                  value={currentTranslation}
                  onChange={(e) => updateDirty(entry.id, e.target.value, entry.translation)}
                  placeholder="Übersetzung…"
                  className={`h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-text placeholder:text-muted/60 outline-2 outline-offset-1 focus-visible:outline-2 ${statusClass}`}
                />
              </div>
              {/* Rechts: Original (readonly) */}
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-mono text-muted">
                  Original
                </label>
                <div className="rounded-md bg-raised p-2">
                  <p className="whitespace-pre-wrap break-words text-sm text-text font-mono">
                    {entry.original}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Paginierung */}
      <footer className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="text-xs font-mono text-muted">
          Seite {page} von {maxPage}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronLeft}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Zurück
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={ChevronRight}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
          >
            Weiter
          </Button>
        </div>
      </footer>
    </div>
  );
}
