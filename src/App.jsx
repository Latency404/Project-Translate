import { useState } from "react";
import Button from "./components/Button.jsx";
import Setup from "./views/Settings.jsx";
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
  // The Editor owns its own mod selection (persisted via sessionStorage).
  // initialModIds is only the first-time selection from the Library.
  const [initialModIds, setInitialModIds] = useState([]);

  return (
    <div className="min-h-screen bg-ink">
      {/* NavBar */}
      <nav className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-2">
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

      {/* Content */}
      <main>
        {view === "mods" && (
          <Library
            key={libraryKey}
            onGoToSetup={() => setView("settings")}
            onSelectionChange={setInitialModIds}
          />
        )}
        {view === "settings" && (
          <Setup
            onOpenMods={() => {
              setLibraryKey((k) => k + 1);
              setView("mods");
            }}
          />
        )}
        {view === "showcase" && <Showcase />}
        {view === "export" && <Exchange />}
        {view === "editor" && (
          <Editor
            initialModIds={initialModIds}
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
