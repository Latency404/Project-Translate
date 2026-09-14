import { useCallback, useEffect, useState } from "react";
import { Check, LayoutGrid, Search } from "lucide-react";
import * as api from "../api.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";

export default function Library({ onGoToSetup, onSelectionChange }) {
  const [mods, setMods] = useState([]);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());

  // Notify parent whenever the selection changes (immediately, not on Save)
  useEffect(() => {
    onSelectionChange && onSelectionChange(Array.from(selected));
  }, [selected, onSelectionChange]);

  // Load data. If the API hasn't been scanned yet (e.g. after a server
  // restart during dev), automatically trigger a scan and retry once it
  // finishes.
  const [autoScanning, setAutoScanning] = useState(false);

  const doScanAndLoad = useCallback(async () => {
    setAutoScanning(true);
    try {
      await api.startScan();
      // Poll until the scan completes
      const timer = setInterval(async () => {
        try {
          const st = await api.getStatus();
          if (!st.scanRunning) {
            clearInterval(timer);
            const data = await api.getMods();
            setMods(data.mods || []);
          }
        } catch {
          clearInterval(timer);
        } finally {
          setAutoScanning(false);
        }
      }, 1000);
    } catch (err) {
      setError(err.message);
      setAutoScanning(false);
    }
  }, []);

  useEffect(() => {
    api
      .getMods()
      .then((data) => setMods(data.mods || []))
      .catch((err) => {
        // 404 means no scan yet — try to auto-scan
        if (err.message && err.message.includes('Scan')) {
          doScanAndLoad();
        } else {
          setError(err.message);
        }
      });
  }, [doScanAndLoad]);

  // Filter by search text
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

  // Number of currently visible mods
  const visibleIds = new Set(filtered.map((m) => m.id));
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  // Toggle selection for a single card
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle all on/off (only visible ones)
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

  // Total count
  const total = mods.length;

  // === Empty state (no scan performed) ===
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Card title="Mods">
          <p className="text-sm text-muted">
            No scan has been performed yet. Go to Settings and start a scan.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onGoToSetup}>
              Go to Settings
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // === Loading state (includes auto-scan) ===
  if (mods.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        {autoScanning ? (
          <div className="text-center space-y-2">
            <p className="text-muted">Scanning mods…</p>
            <ProgressBar value={0} max={1} color="dust" className="w-40 mx-auto" />
          </div>
        ) : (
          <p className="text-center text-muted">Loading…</p>
        )}
      </div>
    );
  }

  // === Main view ===
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold text-accent">
          Library{" "}
          <span className="text-sm font-normal text-muted">
            ({total} {total === 1 ? "Mod" : "Mods"})
          </span>
        </h1>
      </header>

      {/* Search + All */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search…"
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
          All ({filtered.length})
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
              {/* Checkmark top right */}
              {isSelected && (
                <span className="absolute right-3 top-3 text-accent">
                  <Check size={16} />
                </span>
              )}

              {/* Name + Base Game tag */}
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-text">{mod.name}</span>
                {mod.isBaseGame && <Tag tone="base">Base Game</Tag>}
              </div>

              {/* ID */}
              <p className="mb-3 font-mono text-xs text-muted">{mod.id}</p>

              {/* Poster */}
              <div className="mb-3 flex h-24 items-center justify-center overflow-hidden rounded-md bg-raised">
                {mod.poster ? (
                  <img
                    src={mod.poster}
                    alt={mod.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-muted">No poster</span>
                )}
              </div>

              {/* Entries */}
              <p className="mb-2 text-xs text-muted">
                <span className="font-mono text-text">{mod.entryCount}</span>{" "}
                entries
              </p>

              {/* Progress */}
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

      <footer className="mt-6 border-t border-line pt-4">
        <p className="text-sm text-muted">
          {selected.size} mod{selected.size === 1 ? "" : "s"} selected
        </p>
      </footer>
    </div>
  );
}
