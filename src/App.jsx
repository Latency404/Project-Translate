import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "./components/Button.jsx";
import Input from "./components/Input.jsx";
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

// Globaler "Export Mod"-Button: exportiert die aktuelle Mods-Auswahl
// (pt_library_selected) als installierbare Mod — dieselbe Logik, die zuvor
// auf der eigenen "Export"-Seite (Exchange.jsx) lag, jetzt als Popover in der
// Kopfzeile, von jeder Seite aus erreichbar.
function ExportModPopover() {
  const [open, setOpen] = useState(false);
  const [targetLang, setTargetLang] = useState("DE");
  const [targetDir, setTargetDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    api.getConfig().then((cfg) => setTargetLang(cfg.targetLang || "DE")).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedIds = () => {
    try {
      const raw = sessionStorage.getItem("pt_library_selected");
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };

  const handleExport = async () => {
    const modIds = selectedIds();
    if (modIds.length === 0) return;
    setErr("");
    setResult(null);
    setLoading(true);
    try {
      const res = await api.exportMod(modIds, targetDir.trim() || undefined, targetLang);
      setResult(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div className="flex overflow-hidden rounded-md">
        <Button
          variant="primary"
          size="sm"
          className="rounded-r-none"
          onClick={() => {
            setErr("");
            setResult(null);
            setOpen((v) => !v);
          }}
        >
          Export Mod
        </Button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Export options"
          className="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-accent-deep bg-accent text-text hover:bg-accent-light"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-lg border border-line bg-surface p-4 shadow-2xl">
          <p className="text-xs text-muted">
            {selectedIds().length} mod(s) selected on the Mods page.
          </p>
          <Input
            label="Target folder"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            hint="Empty = default export/mods"
            className="font-mono"
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Target language</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <option value="DE">DE</option>
              <option value="EN">EN</option>
              <option value="FR">FR</option>
              <option value="ES">ES</option>
            </select>
          </div>
          <Button
            variant="primary"
            className="w-full justify-center"
            disabled={selectedIds().length === 0 || loading}
            onClick={handleExport}
          >
            {loading ? "Exporting…" : "Export"}
          </Button>
          {result && (
            <p className="text-xs text-success">
              {result.results.length} mod{result.results.length !== 1 ? "s" : ""} exported to{" "}
              <span className="font-mono">{result.targetDir}</span>
            </p>
          )}
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
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
      {/* NavBar — fix oben; jeder View-Scroll-Container beginnt darunter */}
      <nav className="z-10 shrink-0 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent font-mono text-xs font-bold text-text">
              PT
            </span>
            <span className="font-mono text-lg font-bold text-text">Project Translate</span>
          </div>
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? "primary" : "secondary"}
                onClick={() => {
                  // Fresh Mods page on every navigation to it
                  if (v.key === "mods") {
                    setModsKey((k) => k + 1);
                  }
                  setView(v.key);
                }}
              >
                {v.label}
              </Button>
            ))}
          </div>
          <ExportModPopover />
        </div>
      </nav>

      {/* Content — der Seiten-Scrollbar lebt hier, also unterhalb des Nav */}
      <main className="min-h-0 flex-1 overflow-y-auto">
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
          />
        )}
      </main>
    </div>
  );
}
