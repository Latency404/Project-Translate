import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import Settings from "./views/Settings.jsx";
import Showcase from "./views/Showcase.jsx";
import Mods from "./views/Mods.jsx";
import Editor from "./views/Editor.jsx";
import * as api from "./api.js";

const VIEWS = [
  { key: "mods", label: "Mods" },
  { key: "editor", label: "Editor" },
  { key: "settings", label: "Settings" },
  { key: "showcase", label: "Design" },
];

// Rendert sein Kind fixed-positioniert direkt unter `anchorRef`, als Portal
// in document.body — entkommt damit JEDER Stacking-/Overflow-Eigenart von
// Vorfahren (z. B. Editors eigener sticky Spalten-Header, der einmal
// "gestuckt" auf manchen Browsern über ein normales `absolute`-Popover in
// der Navbar gemalt wird, sobald man in den Einträgen scrollt). `right` hält
// die rechte Kante am Anker fest, wie zuvor `right-0` innerhalb des Anchors.
function FloatingPanel({ anchorRef, className, children }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [anchorRef]);
  if (!pos) return null;
  return createPortal(
    <div className={className} style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}>
      {children}
    </div>,
    document.body,
  );
}

// Globaler "Export Mod"-Button: exportiert die aktuelle Mods-Auswahl
// (pt_library_selected) als installierbare Mod — dieselbe Logik, die zuvor
// auf der eigenen "Export"-Seite (Exchange.jsx) lag, jetzt als Popover in der
// Kopfzeile, von jeder Seite aus erreichbar.
function ExportModPopover() {
  // Split button: die linke Hälfte baut die Mod server-seitig, packt sie in
  // eine ZIP (POST /api/export/mod/zip) und stößt denselben Blob-Download an
  // wie der LLM-Export — der Browser fragt danach ganz normal, wo die ZIP
  // gespeichert werden soll. Das Chevron rechts öffnet nur ein kleines
  // Settings-Dropdown (Zielsprache).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [targetLang, setTargetLang] = useState("DE");
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState(null); // { kind: "success"|"error", text }
  const ref = useRef(null);
  const statusTimer = useRef(null);

  useEffect(() => {
    api.getConfig().then((cfg) => setTargetLang(cfg.targetLang || "DE")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setSettingsOpen(false);
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

  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const showStatus = (kind, text) => {
    setStatus({ kind, text });
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 6000);
  };

  const selectedIds = () => {
    try {
      const raw = sessionStorage.getItem("pt_library_selected");
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };

  const handleExportClick = async () => {
    const modIds = selectedIds();
    if (modIds.length === 0) {
      showStatus("error", "Select mod(s) on the Mods page first.");
      return;
    }
    setExporting(true);
    setStatus(null);
    try {
      const { blob, filename } = await api.exportModZip(modIds, targetLang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showStatus("error", e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div className="flex h-8 items-stretch overflow-hidden rounded-lg bg-accent hover:bg-accent-light">
        <button
          onClick={handleExportClick}
          disabled={exporting}
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
        <FloatingPanel anchorRef={ref} className="w-56 space-y-1.5 rounded-lg border border-line bg-surface p-4 shadow-2xl">
          <label className="mb-1.5 block text-xs font-medium text-muted">Target language</label>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="h-8 w-full rounded-lg border border-line bg-raised px-3 text-ui text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="DE">DE</option>
            <option value="EN">EN</option>
            <option value="FR">FR</option>
            <option value="ES">ES</option>
          </select>
        </FloatingPanel>
      )}

      {status && (
        <FloatingPanel
          anchorRef={ref}
          className={`w-72 rounded-lg border border-line bg-surface p-3 text-xs shadow-2xl ${
            status.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {status.text}
        </FloatingPanel>
      )}
    </div>
  );
}

export default function App() {
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
          <div className="flex flex-1 items-center justify-end">
            <ExportModPopover />
          </div>
        </div>
      </nav>

      {/* Content — der Seiten-Scrollbar lebt hier, also unterhalb des Nav */}
      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {view === "mods" && (
          <Mods key={modsKey} onGoToSetup={() => setView("settings")} />
        )}
        {view === "settings" && (
          <Settings
            onOpenMods={() => {
              setModsKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
        {view === "showcase" && <Showcase />}
        {view === "editor" && (
          <Editor
            onReselect={() => {
              setModsKey((k) => k + 1);
              setView("mods");
            }}
            onGoToSettings={() => setView("settings")}
          />
        )}
      </main>
    </div>
  );
}
