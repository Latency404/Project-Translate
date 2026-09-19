import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyCheck, Download, Lock, LockOpen, Upload } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ModCard from "../components/ModCard.jsx";
import { useToast } from "../components/Toast.jsx";
import { loadDirty, saveDirty, dirtyKey, reviewModIds, statusOf, FILTER_TONE_CLASS } from "../reviewStore.js";
import { langLabel } from "../langs.js";

// Anzeige-Name ohne den "(Base Game)"-Zusatz — der volle Name (mod.name) bleibt
// als Backend-Wert unverändert (Export-Ordnernamen etc. hängen daran).
function displayModName(mod) {
  return mod.name.replace(/\s*\(Base Game\)\s*$/, "");
}

const FILTERS = [
  { key: "all", label: "All Mods" },
  { key: "selected", label: "Selected" },
  { key: "open", label: "Open" },
  { key: "translated", label: "Translated" },
  { key: "review", label: "Needs Review" },
];

export default function Mods({ activeLang, onGoToSetup }) {
  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [loadFailed, setLoadFailed] = useState(false);
  // Alle konfigurierten Zielsprachen (nicht nur die aktive) — braucht der
  // LLM-Export, damit die erzeugte Datei alle Sprachen anfragt.
  const [targetLangs, setTargetLangs] = useState([]);

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
  const [dirty, setDirty] = useState(() => loadDirty(activeLang));
  const reviewIds = useMemo(() => reviewModIds(dirty), [dirty]);

  // Load data. If the API hasn't scanned mods yet, there's nothing useful to
  // show here — go straight to Settings (where scanning happens) instead of
  // a dead-end hint. `activeLang` bestimmt, für welche Sprache translatedCount
  // (und damit Open/Translated) gilt — ein Wechsel lädt die Mods neu.
  useEffect(() => {
    setLoading(true);
    api
      .getMods(activeLang)
      .then((data) => setMods(data.mods || []))
      .catch((err) => {
        if (err.message && err.message.toLowerCase().includes('scan')) {
          onGoToSetup();
        } else {
          setLoadFailed(true);
          toast("error", err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [activeLang, onGoToSetup, toast]);

  useEffect(() => {
    api.getConfig()
      .then((cfg) => setTargetLangs(Array.isArray(cfg.targetLangs) && cfg.targetLangs.length > 0 ? cfg.targetLangs : ["DE"]))
      .catch(() => {});
  }, []);

  // Filter by search text + status
  const filtered = mods.filter((m) => {
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "selected") return selected.has(m.id);
    return statusOf(m, reviewIds) === statusFilter;
  }).sort((a, b) => Number(b.isBaseGame) - Number(a.isBaseGame));
  const filterCounts = {
    all: mods.length,
    selected: selected.size,
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

  const handleLlmExport = async () => {
    if (selected.size === 0) return;
    setExportLoading(true);

    try {
      const result = await api.exportLlm(Array.from(selected), targetLangs);
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
      toast("error", err.message);
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
    try {
      const text = await file.text();
      const result = await api.importPreview(text);
      setImportPreview(result);
      setImportModalOpen(true);
    } catch (err) {
      toast("error", err.message);
    } finally {
      setImportLoading(false);
      e.target.value = "";
    }
  };

  const handleImportConfirm = () => {
    if (!importPreview) return;
    const next = new Map(dirty);
    // Treffer mehrerer Sprachen aus EINEM Import landen unter je eigenem
    // Sprachpräfix in der dirty-Map — dieselbe entryId kann so in DE und FR
    // gleichzeitig einen offenen Import-Wert haben.
    for (const { modId, entryId, translation, lang } of importPreview.matches) {
      next.set(dirtyKey(lang, entryId), { modId, value: translation, origin: "import", lang });
    }
    setDirty(next);
    const persisted = saveDirty(next);
    if (!persisted) {
      toast(
        "error",
        "Could not save the import for review because it is too large for the browser's session storage. Try importing fewer mods at once.",
      );
    }

    setImportModalOpen(false);
    setImportPreview(null);
  };

  const totalMatched = importPreview ? importPreview.matched : 0;
  const totalUnmatched = importPreview ? importPreview.unmatched : 0;
  const matchedModCount = importPreview
    ? Object.values(importPreview.perMod).filter((pm) => pm.matched > 0).length
    : 0;
  // Mehrere Sprachen in einer Datei: die Vorschau nennt sie einzeln. Bei
  // genau einer Sprache bleibt die Anzeige so schlicht wie zuvor.
  const detectedLangs = importPreview ? importPreview.detectedTargetLangs || [] : [];
  const perLang = importPreview ? importPreview.perLang || {} : {};
  // Sprachen, die die Datei mitbringt, die aber gar nicht konfiguriert sind:
  // der Server übernimmt sie bewusst NICHT (der Editor könnte sie weder
  // anzeigen noch speichern). Das muss sichtbar sein, sonst fehlen stillschweigend
  // Übersetzungen, für die das LLM gearbeitet hat.
  const unknownLangs = importPreview ? importPreview.unknownLangs || [] : [];
  const isMultiLangImport = detectedLangs.length > 1;

  // === Error state (real errors only — "no scan yet" redirects to Settings instead) ===
  if (loadFailed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Mods">
          <div>
            <Button variant="secondary" onClick={onGoToSetup}>
              Go to Settings
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading state (also covers the moment before the "no scan yet" redirect) ===
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-center text-muted">Loading…</p>
      </div>
    );
  }

  // === Empty state: scan finished but found no translatable mods ===
  if (mods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Mods">
          <div className="space-y-4">
            <p className="text-sm text-muted">No translatable mods found.</p>
            <Button variant="secondary" onClick={onGoToSetup}>
              Go to Settings
            </Button>
          </div>
        </Card>
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

      {/* Search + status filters + Export/Import/Select all/Lock. Bleibt beim
          Scrollen unter der Navbar kleben (sticky im Scroll-Container <main>);
          -mt-4/-mx-6 + pt-4/px-6 heben das Außen-Padding auf, damit der
          Hintergrund die Karten sauber überdeckt. */}
      <div className="sticky top-0 z-10 -mx-6 -mt-4 mb-1 flex flex-wrap items-center justify-between gap-3 bg-ink px-6 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search Mods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[12.5rem] shrink-0"
            clearable
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
          {activeLang && (
            <span className="text-xs text-muted">Status for {langLabel(activeLang)}</span>
          )}
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

      {/* Import confirmation modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Mark imported translations for review"
      >
        <div className="space-y-4">
          {unknownLangs.length > 0 && (
            <p className="text-sm text-warning">
              Skipped {unknownLangs.join(", ")}: not in your target languages. Add
              the language in Settings and import the file again.
            </p>
          )}
          {totalMatched === 0 && totalUnmatched === 0 ? (
            <p className="text-sm text-muted">
              No matching entries found in the chosen file.
            </p>
          ) : isMultiLangImport ? (
            <>
              <p className="text-sm text-text">
                Detected {detectedLangs.length} languages: {detectedLangs.map(langLabel).join(", ")}.
              </p>
              <ul className="space-y-1 text-sm text-muted">
                {detectedLangs.map((lang) => (
                  <li key={lang}>
                    {langLabel(lang)}: {perLang[lang]?.matched ?? 0} matched
                    {perLang[lang]?.unmatched > 0 && `, ${perLang[lang].unmatched} unmatched`}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-text">
                {totalMatched} entries across {matchedModCount} mods will be marked
                "Needs Review". Nothing is written to disk yet. Open the affected
                mods in the Editor to check and save them.
                {totalUnmatched > 0 && ` (${totalUnmatched} unmatched will be discarded.)`}
              </p>
            </>
          ) : (
            <p className="text-sm text-text">
              {totalMatched} entries across {matchedModCount} mods will be marked
              "Needs Review". Nothing is written to disk yet. Open the affected
              mods in the Editor to check and save them.
              {totalUnmatched > 0 && ` (${totalUnmatched} unmatched will be discarded.)`}
            </p>
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
