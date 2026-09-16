import { useState } from "react";
import Button from "./components/Button.jsx";
import Settings from "./views/Settings.jsx";
import Showcase from "./views/Showcase.jsx";
import Library from "./views/Library.jsx";
import Editor from "./views/Editor.jsx";
import Exchange from "./views/Exchange.jsx";

const VIEWS = [
  { key: "settings", label: "Settings" },
  { key: "mods", label: "Library" },
  { key: "editor", label: "Editor" },
  { key: "export", label: "Export" },
  { key: "showcase", label: "Design" },
];

export default function App() {
  // Persist the active view in sessionStorage so it survives Vite HMR reloads
  // (triggered by server restarts during save operations).
  const [view, setViewState] = useState(() => {
    try {
      const stored = sessionStorage.getItem("pt_active_view");
      if (stored && VIEWS.some((v) => v.key === stored)) return stored;
    } catch { /* ignore */ }
    return "settings";
  });
  const setView = (v) => {
    setViewState(v);
    try { sessionStorage.setItem("pt_active_view", v); } catch { /* ignore */ }
  };
  const [libraryKey, setLibraryKey] = useState(0);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink">
      {/* NavBar — fix oben; jeder View-Scroll-Container beginnt darunter */}
      <nav className="z-10 shrink-0 border-b border-line bg-surface px-4 py-2">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="font-mono text-lg font-bold text-accent">Project Translate</span>
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? "primary" : "secondary"}
                onClick={() => {
                  // Fresh Library on every navigation to it
                  if (v.key === "mods") {
                    setLibraryKey((k) => k + 1);
                  }
                  setView(v.key);
                }}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content — der Seiten-Scrollbar lebt hier, also unterhalb des Nav */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {view === "mods" && (
          <Library key={libraryKey} onGoToSetup={() => setView("settings")} />
        )}
        {view === "settings" && (
          <Settings
            onOpenMods={() => {
              setLibraryKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
        {view === "showcase" && <Showcase />}
        {view === "export" && (
          <Exchange
            onReselect={() => {
              setLibraryKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
        {view === "editor" && (
          <Editor
            onReselect={() => {
              setLibraryKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
      </main>
    </div>
  );
}
