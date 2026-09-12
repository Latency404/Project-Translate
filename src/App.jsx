import { useState } from "react";
import Button from "./components/Button.jsx";
import Setup from "./views/Setup.jsx";
import Showcase from "./views/Showcase.jsx";
import Mods from "./views/Mods.jsx";
import Editor from "./views/Editor.jsx";

const VIEWS = [
  { key: "setup", label: "Setup" },
  { key: "mods", label: "Mods" },
  { key: "showcase", label: "Design" },
];

export default function App() {
  const [view, setView] = useState("setup");
  const [selectedModIds, setSelectedModIds] = useState([]);

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
                onClick={() => setView(v.key)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main>
        {view === "setup" && <Setup onOpenMods={() => setView("mods")} />}
        {view === "mods" && (
          <Mods
            onGoToSetup={() => setView("setup")}
            onOpenEditor={(ids) => {
              setSelectedModIds(ids);
              setView("editor");
            }}
          />
        )}
        {view === "showcase" && <Showcase />}
        {view === "editor" && <Editor modIds={selectedModIds} onBack={() => setView("mods")} />}
      </main>
    </div>
  );
}
