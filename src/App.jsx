import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import Settings from "./views/Settings.jsx";
import Mods from "./views/Mods.jsx";
import Editor from "./views/Editor.jsx";
import LangSelect from "./components/LangSelect.jsx";
import { langLabel, langName } from "./langs.js";
import { ToastProvider, useToast } from "./components/Toast.jsx";
import { hasDirty, loadDirty } from "./reviewStore.js";
import * as api from "./api.js";

const VIEWS = [
  { key: "mods", label: "Mods" },
  { key: "editor", label: "Editor" },
  { key: "settings", label: "Settings" },
];

// Rendert sein Kind fixed-positioniert direkt unter `anchorRef`, als Portal
// in document.body — entkommt damit JEDER Stacking-/Overflow-Eigenart von
// Vorfahren (z. B. Editors eigener sticky Spalten-Header, der einmal
// "gestuckt" auf manchen Browsern über ein normales `absolute`-Popover in
// der Navbar gemalt wird, sobald man in den Einträgen scrollt). `right` hält
// die rechte Kante am Anker fest, wie zuvor `right-0` innerhalb des Anchors.
function FloatingPanel({ anchorRef, panelRef, className, children }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [anchorRef]);
  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

// Kompakter Umschalter für die im Editor/auf den anderen Seiten aktive
// Sprache — Kernstück von "mehrere Sprachen ohne Umweg": ein Klick wechselt
// serverseitig nur ein Feld (POST /api/active-lang), kein Rescan. Erscheint
// nur, wenn mehr als eine Zielsprache konfiguriert ist. Bis zu drei Sprachen
// als Pillen-Reihe im Look der View-Tabs, darüber als kompaktes Dropdown.
// Bei genau einer Zielsprache zeigt eine nicht klickbare Pille die aktive Sprache.
function LangSwitcher({ targetLangs, activeLang, onChange }) {
  if (targetLangs.length === 0) return null;
  if (targetLangs.length === 1) {
    return (
      <span
        title={langName(targetLangs[0])}
        className="rounded-full bg-raised px-3 py-1.5 text-ui font-semibold text-text"
      >
        {targetLangs[0]}
      </span>
    );
  }

  if (targetLangs.length <= 3) {
    return (
      <div className="flex items-center gap-0.5">
        {targetLangs.map((code) => (
          <button
            key={code}
            onClick={() => onChange(code)}
            title={langName(code)}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-ui font-semibold transition-colors ${
              activeLang === code ? "bg-raised text-text" : "text-muted hover:text-text"
            }`}
          >
            {code}
          </button>
        ))}
      </div>
    );
  }

  return <LangSelect codes={targetLangs} value={activeLang} onChange={onChange} compact className="w-20" />;
}

// Globaler "Export Mod"-Button: exportiert die aktuelle Mods-Auswahl
// (pt_library_selected) als installierbare Mod — dieselbe Logik, die zuvor
// auf der eigenen "Export"-Seite (Exchange.jsx) lag, jetzt als Popover in der
// Kopfzeile, von jeder Seite aus erreichbar.
function ExportModPopover({ targetLangs }) {
  // Split button: die linke Hälfte baut die Mod server-seitig, packt sie in
  // eine ZIP (POST /api/export/mod/zip) und stößt denselben Blob-Download an
  // wie der LLM-Export — der Browser fragt danach ganz normal, wo die ZIP
  // gespeichert werden soll. Das Chevron rechts öffnet nur ein kleines
  // Settings-Dropdown (Zielsprachen) — die Mod enthält am Ende alle dort
  // ausgewählten Sprachen in einem Stück.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState(targetLangs);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const ref = useRef(null);
  const panelRef = useRef(null);

  // Vorauswahl folgt der Konfiguration (alle konfigurierten Sprachen) — ändert
  // sich die Liste (z. B. in den Settings), zieht die Auswahl hier nach.
  useEffect(() => {
    setSelectedLangs(targetLangs);
  }, [targetLangs]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (e) => {
      const inAnchor = ref.current && ref.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inAnchor && !inPanel) setSettingsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  const selectedIds = () => {
    try {
      const raw = sessionStorage.getItem("pt_library_selected");
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };

  const toggleLang = (code) => {
    setSelectedLangs((prev) => {
      if (prev.includes(code)) {
        if (prev.length === 1) return prev; // mindestens eine Sprache bleibt gewählt
        return prev.filter((c) => c !== code);
      }
      return [...prev, code];
    });
  };

  const handleExportClick = async () => {
    const modIds = selectedIds();
    if (modIds.length === 0) {
      toast("error", "Select mod(s) on the Mods page first.");
      return;
    }
    if (selectedLangs.length === 0) return;
    setExporting(true);
    try {
      const { blob, filename } = await api.exportModZip(modIds, selectedLangs);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // The exported mod only ever contains what's already on disk — any
      // dirty (unsaved manual edit or unreviewed import) entry for one of the
      // selected mods/languages just got silently left out. Warn so that
      // doesn't go unnoticed.
      const dirty = loadDirty();
      let unsavedCount = 0;
      for (const val of dirty.values()) {
        if (val.modId != null && modIds.includes(val.modId) && val.lang && selectedLangs.includes(val.lang)) {
          unsavedCount += 1;
        }
      }
      if (unsavedCount > 0) {
        toast(
          "warning",
          `${unsavedCount} unsaved or unreviewed entries are not included. Save them in the Editor first.`,
        );
      }
    } catch (e) {
      toast("error", e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div className="flex h-8 items-stretch overflow-hidden rounded-lg bg-accent hover:bg-accent-light">
        <button
          onClick={handleExportClick}
          disabled={exporting || targetLangs.length === 0}
          className="flex items-center px-3 text-ui font-semibold text-text-inverse cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
        >
          {exporting ? "Exporting…" : "Export Mod"}
        </button>
        <span className="w-px shrink-0 bg-surface" aria-hidden />
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Export settings"
          className="flex w-8 items-center justify-center text-text-inverse cursor-pointer"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>

      {settingsOpen && (
        <FloatingPanel anchorRef={ref} panelRef={panelRef} className="w-64 rounded-lg border border-line bg-surface p-3 shadow-2xl">
          {targetLangs.length > 1 ? (
            <div className="space-y-2">
              <span className="block text-xs font-medium text-muted">Target languages</span>
              <div className="max-h-56 overflow-y-auto">
                {targetLangs.map((code) => {
                  const on = selectedLangs.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleLang(code)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                        on ? "text-text" : "text-muted hover:text-text"
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          on ? "border-accent bg-accent text-text-inverse" : "border-line"
                        }`}
                      >
                        {on && <Check size={10} strokeWidth={3} aria-hidden />}
                      </span>
                      {langLabel(code)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            targetLangs.length === 1 && (
              <p className="text-ui text-text">
                Target language: <span className="font-semibold">{langLabel(targetLangs[0])}</span>
              </p>
            )
          )}
        </FloatingPanel>
      )}

    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function AppShell() {
  // Persist the active view in sessionStorage so it survives Vite HMR reloads
  // (triggered by server restarts during save operations).
  const [view, setViewState] = useState(() => {
    try {
      const stored = sessionStorage.getItem("pt_active_view");
      if (stored && VIEWS.some((v) => v.key === stored)) return stored;
    } catch { /* ignore */ }
    return "mods";
  });
  const setView = (v) => {
    setViewState(v);
    try { sessionStorage.setItem("pt_active_view", v); } catch { /* ignore */ }
  };
  const [modsKey, setModsKey] = useState(0);
  const toast = useToast();

  // Konfigurierte Zielsprachen + die gerade aktive — Basis für den
  // Sprachumschalter und die Vorauswahl im Export-Popover. Wird beim Start
  // geladen und erneut, sobald die Settings-Seite (targetLangs betreffend)
  // zurück zu Mods führt.
  const [targetLangs, setTargetLangs] = useState([]);
  const [activeLang, setActiveLangState] = useState("");

  const loadLangConfig = useCallback(() => {
    api
      .getConfig()
      .then((cfg) => {
        const langs = Array.isArray(cfg.targetLangs) ? cfg.targetLangs : [];
        setTargetLangs(langs);
        setActiveLangState(cfg.activeLang && langs.includes(cfg.activeLang) ? cfg.activeLang : langs[0] || "");
      })
      .catch(() => { /* Navbar bleibt ohne Umschalter, bis der Scan/Settings-Fluss greift */ });
  }, []);

  useEffect(() => {
    loadLangConfig();
  }, [loadLangConfig]);

  // Unsaved editor entries (incl. a whole unreviewed LLM import) live only in
  // sessionStorage (pt_editor_dirty, s. reviewStore.js) — closing the tab or
  // reloading loses them silently, with no chance to save first. The
  // browser's native leave-confirmation is the only hook available for that.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!hasDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Sprachwechsel: nur die aktive Sprache umschalten, kein Rescan. Optimistisch
  // im UI, mit Rollback + Toast, falls der Server ablehnt (z. B. Sprache nicht
  // mehr in targetLangs).
  const handleLangChange = useCallback(
    (lang) => {
      if (lang === activeLang) return;
      const prev = activeLang;
      setActiveLangState(lang);
      api.setActiveLang(lang).catch((e) => {
        setActiveLangState(prev);
        toast("error", e.message);
      });
    },
    [activeLang, toast],
  );

  // Mods und Editor leiten ohne Scan nach Settings um. Dort erscheint dann
  // eine gelbe Pille, dazu ein Toast. Stabil (useCallback), weil die Views
  // ihr Laden davon abhängig machen.
  const [noScanNotice, setNoScanNotice] = useState(false);
  const goToSettingsNoScan = useCallback(() => {
    setNoScanNotice(true);
    setViewState("settings");
    try { sessionStorage.setItem("pt_active_view", "settings"); } catch { /* ignore */ }
    toast("warning", "Search for mods first");
  }, [toast]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink">
      {/* NavBar — fix oben; jeder View-Scroll-Container beginnt darunter.
          Inhalt auf die Figma-Entwurfsbreite (1440px) begrenzt und zentriert
          — sonst wirken die (bewusst pixelgenauen) Figma-Maße auf einem
          breiteren Monitor als das 1440px-Canvas verloren/winzig. */}
      <nav className="relative z-10 flex shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-6 py-3">
        <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-6">
          <div className="flex flex-1 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-ui font-bold text-text-inverse">
              PT
            </span>
            <span className="text-lg font-bold text-text">Project Translate</span>
          </div>
          <div className="flex flex-1 items-center justify-center gap-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => {
                  // Fresh Mods page on every navigation to it
                  if (v.key === "mods") {
                    setModsKey((k) => k + 1);
                  }
                  setNoScanNotice(false);
                  setView(v.key);
                }}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-ui font-semibold transition-colors ${
                  view === v.key
                    ? "bg-raised text-text"
                    : "text-muted hover:text-text"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <LangSwitcher targetLangs={targetLangs} activeLang={activeLang} onChange={handleLangChange} />
            <ExportModPopover targetLangs={targetLangs} />
          </div>
        </div>
      </nav>

      {/* Content — der Seiten-Scrollbar lebt hier, also unterhalb des Nav */}
      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {view === "mods" && (
          <Mods key={`${modsKey}-${activeLang}`} activeLang={activeLang} onGoToSetup={goToSettingsNoScan} />
        )}
        {view === "settings" && (
          <Settings
            activeLang={activeLang}
            noScanNotice={noScanNotice}
            onLangsChanged={loadLangConfig}
            onOpenMods={() => {
              loadLangConfig();
              setModsKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
        {view === "editor" && (
          <Editor
            key={`editor-${activeLang}`}
            activeLang={activeLang}
            onReselect={() => {
              setModsKey((k) => k + 1);
              setView("mods");
            }}
            onGoToSettings={goToSettingsNoScan}
          />
        )}
      </main>
    </div>
  );
}
