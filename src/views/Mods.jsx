import { useEffect, useState } from "react";
import { Check, LayoutGrid, Search } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";

export default function Mods({ onGoToSetup, onOpenEditor }) {
  const [mods, setMods] = useState([]);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());

  // Daten laden
  useEffect(() => {
    api
      .getMods()
      .then((data) => setMods(data.mods || []))
      .catch((err) => setError(err.message));
  }, []);

  // Filter nach Suchtext
  const filtered =
    search.trim() === ""
      ? mods
      : mods.filter((m) => {
          const q = search.toLowerCase();
          return (
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q)
          );
        });

  // Anzahl der aktuell sichtbaren Mods
  const visibleIds = new Set(filtered.map((m) => m.id));
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  // Toggle-Auswahl für einzelne Karte
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Alle an/aus (nur sichtbare)
  const toggleAll = () => {
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

  // Gesamtzahl
  const total = mods.length;

  // === Leerzustand (kein Scan durchgeführt) ===
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Mods">
          <p className="text-sm text-muted">
            Noch kein Scan durchgeführt. Gehen Sie zum Setup und starten Sie
            einen Scan.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onGoToSetup}>
              Zum Setup
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Ladezustand ===
  if (mods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-center text-muted">Lädt…</p>
      </div>
    );
  }

  // === Hauptansicht ===
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Kopfzeile */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold text-accent">
          Mods{" "}
          <span className="text-sm font-normal text-muted">
            ({total} {total === 1 ? "Mod" : "Mods"})
          </span>
        </h1>
      </header>

      {/* Suche + Alle */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-52"
        />
        <Button
          variant={allVisibleSelected ? "primary" : "secondary"}
          size="md"
          icon={Check}
          onClick={toggleAll}
        >
          Alle ({filtered.length})
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((mod) => {
          const isSelected = selected.has(mod.id);
          return (
            <div
              key={mod.id}
              className={`relative cursor-pointer rounded-lg border border-line bg-surface p-4 transition-colors duration-150 hover:border-line ${
                isSelected ? "border-accent" : ""
              }`}
              onClick={() => toggleOne(mod.id)}
            >
              {/* Häkchen oben rechts */}
              {isSelected && (
                <span className="absolute right-3 top-3 text-accent">
                  <Check size={16} />
                </span>
              )}

              {/* Name + Base-Game-Tag */}
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-text">{mod.name}</span>
                {mod.isBaseGame && <Tag tone="base">Base Game</Tag>}
              </div>

              {/* ID */}
              <p className="mb-3 font-mono text-xs text-muted">{mod.id}</p>

              {/* Poster-Platzhalter */}
              <div className="mb-3 flex h-24 items-center justify-center rounded-md bg-raised">
                <span className="text-xs text-muted">Poster</span>
              </div>

              {/* Einträge */}
              <p className="mb-2 text-xs text-muted">
                <span className="font-mono text-text">{mod.entryCount}</span>{" "}
                Einträge
              </p>

              {/* Fortschritt */}
              <ProgressBar
                value={mod.translatedCount}
                max={mod.entryCount}
                color="dust"
                showValue
              />
            </div>
          );
        })}
      </div>

      {/* Auswahl-Leiste unten */}
      <footer className="mt-6 flex items-center justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">
          {selected.size} Mod{selected.size === 1 ? "" : "s"} ausgewählt
        </span>
        <Button
          variant="primary"
          disabled={selected.size === 0}
          onClick={() => onOpenEditor(Array.from(selected))}
        >
          Übersetzen
        </Button>
      </footer>
    </div>
  );
}
