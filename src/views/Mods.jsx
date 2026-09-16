import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Lock, LockOpen, Upload } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
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

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "translated", label: "Translated" },
  { key: "review", label: "Needs Review" },
];

export default function Mods({ onGoToSetup }) {
  const [mods, setMods] = useState([]);
  const [error, setError] = useState("");
  const [targetLang, setTargetLang] = useState("DE");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Selection persists across visits (sessionStorage) so returning to the
  // Mods page keeps the checkmarks — the Editor + global Export-Mod popover
  // read this same key.
  const [selected, setSelected] = useState(() => {
    try {
      const stored = sessionStorage.getItem("pt_library_selected");
      if (stored) return new Set(JSON.parse(stored));
    } catch { /* ignore */ }
    return new Set();
  });
  // Lock: freezes the selection so cards / "All" can't change it by accident.
  // Persisted like the selection itself (sessionStorage).
  const [locked, setLocked] = useState(() => {
    try {
      return sessionStorage.getItem("pt_library_locked") === "1";
    } catch { /* ignore */ }
    return false;
  });
  const toggleLocked = () => {
    setLocked((prev) => {
      try {
        sessionStorage.setItem("pt_library_locked", prev ? "0" : "1");
      } catch { /* ignore */ }
      return !prev;
    });
  };

  // Persist the selection — Editor and the global Export-Mod popover read it.
  useEffect(() => {
    try {
      sessionStorage.setItem("pt_library_selected", JSON.stringify(Array.from(selected)));
    } catch { /* ignore */ }
  }, [selected]);

  // --- "Zu Prüfen" status: mods with pending (unsaved) import entries ---
  const [dirty, setDirty] = useState(() => loadDirty());
  const reviewIds = useMemo(() => reviewModIds(dirty), [dirty]);

  // Load data. If the API hasn't been scanned yet (e.g. after a server
  // restart during dev), automatically trigger a scan and retry once it
  // finishes.
  const [autoScanning, setAutoScanning] = useState(false);

  const doScanAndLoad = useCallback(async () => {
    setAutoScanning(true);
    try {
      await api.startScan();
      // Poll until the scan completes
      const timer = setInterval(async () => {
        try {
          const st = await api.getStatus();
          if (!st.scanRunning) {
            clearInterval(timer);
            const data = await api.getMods();
            setMods(data.mods || []);
          }
        } catch {
          clearInterval(timer);
        } finally {
          setAutoScanning(false);
        }
      }, 1000);
    } catch (err) {
      setError(err.message);
      setAutoScanning(false);
    }
  }, []);

  useEffect(() => {
    api
      .getMods()
      .then((data) => setMods(data.mods || []))
      .catch((err) => {
        // 404 means no scan yet — try to auto-scan
        if (err.message && err.message.includes('Scan')) {
          doScanAndLoad();
        } else {
          setError(err.message);
        }
      });
  }, [doScanAndLoad]);

  useEffect(() => {
    api.getConfig()
      .then((cfg) => setTargetLang(cfg.targetLang || "DE"))
      .catch(() => {});
  }, []);

  // Filter by search text + status
  const filtered = mods.filter((m) => {
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
    }
    if (statusFilter === "all") return true;
    return statusOf(m, reviewIds) === statusFilter;
  });
  const filterCounts = {
    all: mods.length,
    open: mods.filter((m) => statusOf(m, reviewIds) === "open").length,
    translated: mods.filter((m) => statusOf(m, reviewIds) === "translated").length,
    review: mods.filter((m) => statusOf(m, reviewIds) === "review").length,
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  // Toggle selection for a single card (no-op while locked)
  const toggleOne = (id) => {
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle all on/off (only visible ones; no-op while locked)
  const toggleAll = () => {
    if (locked) return;
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((m) => next.delete(m.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((m) => next.add(m.id));
        return next;
      });
    }
  };

  // --- LLM export: die Selektion in EINE Datei (Browser-Save-Dialog) ---
  const [exportLoading, setExportLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const handleLlmExport = async () => {
    if (selected.size === 0) return;
    setExportLoading(true);
    setActionError("");
    setNotice("");
    try {
      const result = await api.exportLlm(Array.from(selected), targetLang);
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
        `Exported ${result.modCount} mod(s), ${result.entryCount} entries as "${result.filename}" — hand the file to the LLM for translation, then use "Import".`,
      );
    } catch (err) {
      setActionError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  // --- LLM import: Datei wählen → Vorschau → auf Bestätigung als dirty
  // ("Zu Prüfen") übernehmen. Es wird NICHTS auf die Platte geschrieben — das
  // passiert erst, wenn die Übersetzungen im Editor Mod für Mod geprüft und
  // gespeichert werden. ---
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const fileInputRef = useRef(null);

  const handleImportClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleImportFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportLoading(true);
    setActionError("");
    try {
      const text = await file.text();
      const result = await api.importPreview(text);
      setImportPreview(result);
      setImportModalOpen(true);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setImportLoading(false);
      e.target.value = "";
    }
  };

  const handleImportConfirm = () => {
    if (!importPreview) return;
    const next = new Map(dirty);
    for (const { modId, entryId, translation } of importPreview.matches) {
      next.set(entryId, { modId, value: translation, origin: "import" });
    }
    setDirty(next);
    saveDirty(next);
    const modCount = Object.keys(importPreview.perMod).length;
    setNotice(
      `${importPreview.matches.length} entries in ${modCount} mod(s) marked "Needs Review" — open them in the Editor to check and save.`,
    );
    setImportModalOpen(false);
    setImportPreview(null);
  };

  const totalMatched = importPreview ? importPreview.matched : 0;
  const totalUnmatched = importPreview ? importPreview.unmatched : 0;

  // Total count
  const total = mods.length;

  // === Error state (real errors only — the no-scan-yet case auto-scans instead) ===
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Mods">
          <p className="text-sm text-danger">{error}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onGoToSetup}>
              Go to Settings
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading state (includes auto-scan) ===
  if (mods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        {autoScanning ? (
          <div className="text-center space-y-2">
            <p className="text-muted">Scanning mods…</p>
            <ProgressBar value={0} max={1} color="dust" className="w-40 mx-auto" />
          </div>
        ) : (
          <p className="text-center text-muted">Loading…</p>
        )}
      </div>
    );
  }

  // === Main view ===
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
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

      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold text-accent">
          Mods{" "}
          <span className="text-sm font-normal text-muted">
            ({total} {total === 1 ? "Mod" : "Mods"})
          </span>
        </h1>
      </header>

      {/* Search + status filters + Export/Import/Select all/Lock */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search Mods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-52 flex-1"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === f.key
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-line bg-raised text-muted hover:text-text"
              }`}
            >
              {f.label} ({filterCounts[f.key]})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={Upload}
            onClick={handleLlmExport}
            disabled={selected.size === 0 || exportLoading}
            title="Export selected mods as LLM JSON (EN originals)"
          >
            {exportLoading ? "Exporting..." : "Export"}
          </Button>
          <Button
            variant="secondary"
            icon={Download}
            onClick={handleImportClick}
            disabled={importLoading}
            title="Choose a translated LLM file to import (browser file picker)"
          >
            {importLoading ? "Loading..." : "Import"}
          </Button>
          <Button
            variant={allVisibleSelected ? "primary" : "secondary"}
            icon={Check}
            onClick={toggleAll}
            disabled={locked}
          >
            Select all ({filtered.length})
          </Button>
          <Button
            variant={locked ? "secondary" : "primary"}
            icon={locked ? Lock : LockOpen}
            onClick={toggleLocked}
            title={locked ? "Unlock selection" : "Lock selection (cards and \"Select all\" won't change it)"}
          >
            {locked ? "Locked" : "Lock"}
          </Button>
        </div>
      </div>

      {actionError && <p className="mb-4 text-sm text-danger">{actionError}</p>}
      {!actionError && notice && <p className="mb-4 text-sm text-success">{notice}</p>}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((mod) => {
          const isSelected = selected.has(mod.id);
          const status = statusOf(mod, reviewIds);
          return (
            <div
              key={mod.id}
              className={`relative rounded-lg border border-line bg-surface p-4 transition-colors duration-150 hover:border-line ${
                locked ? "cursor-default" : "cursor-pointer"
              } ${isSelected ? "border-accent" : ""}`}
              onClick={() => toggleOne(mod.id)}
            >
              {/* Checkmark top right */}
              {isSelected && (
                <span className="absolute right-3 top-3 text-accent">
                  <Check size={16} />
                </span>
              )}

              {/* Name */}
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-text">{displayModName(mod)}</span>
              </div>

              {/* ID */}
              <p className="mb-3 font-mono text-xs text-muted">
                {mod.isBaseGame ? "Base Game" : mod.id}
              </p>

              {/* Poster */}
              <div className="mb-3 flex h-24 items-center justify-center overflow-hidden rounded-md bg-raised">
                {mod.poster ? (
                  <img
                    src={mod.poster}
                    alt={mod.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-muted">No poster</span>
                )}
              </div>

              {/* Progress */}
              <ProgressBar
                value={mod.translatedCount}
                max={mod.entryCount}
                color="dust"
                showValue
                className="mb-3"
              />

              {/* Status + files */}
              <div className="flex items-center gap-2">
                <Tag tone={STATUS_TAG[status].tone}>{STATUS_TAG[status].label}</Tag>
                <Tag tone="neutral">{mod.filesCount} {mod.filesCount === 1 ? "File" : "Files"}</Tag>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="mt-6 border-t border-line pt-4">
        <p className="text-sm text-muted">
          {selected.size} mod{selected.size === 1 ? "" : "s"} selected
        </p>
      </footer>

      {/* Import confirmation modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Mark imported translations for review"
      >
        <div className="space-y-4">
          {totalMatched === 0 && totalUnmatched === 0 ? (
            <p className="text-sm text-muted">
              No matching entries found in the chosen file.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                {importPreview && Object.values(importPreview.perMod).map((pm) => (
                  <div key={pm.mod} className="flex items-center gap-2 rounded px-2 py-1">
                    <span className="flex-1 text-sm text-text">{pm.mod}</span>
                    <span className="font-mono text-sm text-success">{pm.matched}</span>
                    {pm.unmatched > 0 && (
                      <span className="font-mono text-sm text-warning">{pm.unmatched}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-sm text-text">
                {totalMatched} entries will be marked "Needs Review" — nothing is
                written to disk yet. Open the affected mods in the Editor to
                check and save them.
                {totalUnmatched > 0 && ` (${totalUnmatched} unmatched will be discarded.)`}
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={totalMatched === 0} onClick={handleImportConfirm}>
              Yes, mark for review
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
