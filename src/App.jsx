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
  const [view, setView] = useState("settings");
  const [selectedModIds, setSelectedModIds] = useState([]);
  // Library stays mounted so its selection survives navigating to/from the Editor
  const [libraryKey, setLibraryKey] = useState(0);

  return (
    <div className="min-h-screen bg-ink">
      {/* NavBar */}
      <nav className="border-b border-line bg-surface px-4 py-2">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="font-mono text-lg font-bold text-accent">Project Translate</span>
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? "primary" : "secondary"}
                onClick={() => {
                  if (v.key === "mods" && view !== "mods") {
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
        <div className={view === "mods" ? "" : "hidden"}>
          <Library
            key={libraryKey}
            onGoToSetup={() => setView("settings")}
            onSelectionChange={setSelectedModIds}
          />
        </div>
        {view === "settings" && (
          <Setup
            onOpenMods={() => {
              setLibraryKey((k) => k + 1); // fresh selection for a new scan
              setView("mods");
            }}
          />
        )}
        {view === "showcase" && <Showcase />}
        {view === "export" && <Exchange />}
        {view === "editor" && (
          <Editor
            modIds={selectedModIds}
            onBack={() => setView("mods")}
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
