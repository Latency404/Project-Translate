import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyCheck, Download, Lock, LockOpen, Upload } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ModCard from "../components/ModCard.jsx";
import { loadDirty, saveDirty, reviewModIds, statusOf, FILTER_TONE_CLASS } from "../reviewStore.js";

// Anzeige-Name ohne den "(Base Game)"-Zusatz — der volle Name (mod.name) bleibt
// als Backend-Wert unverändert (Export-Ordnernamen etc. hängen daran).
function displayModName(mod) {
  return mod.name.replace(/\s*\(Base Game\)\s*$/, "");
}

const FILTERS = [
  { key: "all", label: "All Mods" },
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
  // Hover-Zustand des Lock-Buttons: im "Locked"-Zustand hell und "Unlock"
  // beim Hover, statt nur den Klick abzuwarten — reine :hover-CSS würde
  // keinen Text-Wechsel ("Locked" → "Unlock") erlauben.
  const [lockHover, setLockHover] = useState(false);
  // Für toggleOne (useCallback ohne `locked`-Dependency, s. dort).
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  // Persist the selection — Editor and the global Export-Mod popover read it.
  useEffect(() => {
    try {
      sessionStorage.setItem("pt_library_selected", JSON.stringify(Array.from(selected)));
    } catch { /* ignore */ }
  }, [selected]);

  // --- "Zu Prüfen" status: mods with pending (unsaved) import entries ---
  const [dirty, setDirty] = useState(() => loadDirty());
  const reviewIds = useMemo(() => reviewModIds(dirty), [dirty]);

  // Load data. If the API hasn't scanned mods yet, there's nothing useful to
  // show here — go straight to Settings (where scanning happens) instead of
  // a dead-end hint.
  useEffect(() => {
    api
      .getMods()
      .then((data) => setMods(data.mods || []))
      .catch((err) => {
        if (err.message && err.message.toLowerCase().includes('scan')) {
          onGoToSetup();
        } else {
          setError(err.message);
        }
      });
  }, [onGoToSetup]);

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

  // Toggle selection for a single card (no-op while locked). useCallback hält
  // die Referenz über Renders hinweg stabil, damit React.memo auf ModCard bei
  // 400+ Mods nur die tatsächlich betroffene Karte neu rendert.
  const toggleOne = useCallback((id) => {
    setSelected((prev) => {
      if (lockedRef.current) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  // === Error state (real errors only — "no scan yet" redirects to Settings instead) ===
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

  // === Loading state (also covers the moment before the "no scan yet" redirect) ===
  if (mods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-center text-muted">Loading…</p>
      </div>
    );
  }

  // === Main view ===
  // Zwei Ebenen (Außen-Padding, dann zentriert) statt Padding innerhalb des
  // zentrierten Blocks — nur so fluchtet der Inhalt auf breiten Monitoren
  // exakt mit PT-Logo/Export-Mod-Button der Navbar (dieselbe Struktur dort).
  return (
    <div className="px-6 py-4">
    <div className="mx-auto max-w-[90rem]">
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

      {/* Search + status filters + Export/Import/Select all/Lock */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search Mods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[12.5rem] shrink-0"
          />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`flex h-6 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-ui font-semibold transition-colors ${
                  statusFilter === f.key
                    ? FILTER_TONE_CLASS[f.key]
                    : "bg-raised text-muted hover:text-text"
                }`}
              >
                {f.label} ({filterCounts[f.key]})
              </button>
            ))}
          </div>
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
            variant="secondary"
            icon={CopyCheck}
            onClick={toggleAll}
            disabled={locked}
          >
            Select all
          </Button>
          <Button
            variant={locked && !lockHover ? "dustActive" : "dust"}
            icon={locked && !lockHover ? Lock : LockOpen}
            onClick={toggleLocked}
            onMouseEnter={() => setLockHover(true)}
            onMouseLeave={() => setLockHover(false)}
            title={locked ? "Unlock selection" : "Lock selection (cards and \"Select all\" won't change it)"}
          >
            {locked ? (lockHover ? "Unlock" : "Locked") : "Lock"}
          </Button>
        </div>
      </div>

      {actionError && <p className="mb-4 text-sm text-danger">{actionError}</p>}
      {!actionError && notice && <p className="mb-4 text-sm text-success">{notice}</p>}

      {/* Grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {filtered.map((mod) => (
          <ModCard
            key={mod.id}
            id={mod.id}
            mod={mod}
            name={displayModName(mod)}
            status={statusOf(mod, reviewIds)}
            active={selected.has(mod.id)}
            locked={locked}
            onToggle={toggleOne}
          />
        ))}
      </div>

      {filtered.length > 0 && (
        <footer className="mt-4">
          <p className="text-sm text-muted">
            {selected.size} mod{selected.size === 1 ? "" : "s"} selected
          </p>
        </footer>
      )}

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
    </div>
  );
}
