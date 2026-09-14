import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import * as api from "../api.js";

const STORAGE_KEY = "pt_editor_selection";

function loadStoredIds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length > 0) return ids;
    }
  } catch { /* ignore */ }
  return null;
}

export default function Exchange() {
  const [mods, setMods] = useState([]);
  const [targetLang, setTargetLang] = useState("DE");
  const [selectedIds, setSelectedIds] = useState(() => loadStoredIds() || []);
  const [targetDir, setTargetDir] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportOk, setExportOk] = useState(null);
  const [exportErr, setExportErr] = useState("");

  // Load data
  useEffect(() => {
    api.getMods()
      .then((data) => setMods(data.mods || []))
      .catch(() => {});
  }, []);

  // Load target lang from config
  useEffect(() => {
    api.getConfig()
      .then((cfg) => setTargetLang(cfg.targetLang || "DE"))
      .catch(() => {});
  }, []);

  // Deselect all / select all
  const toggleAll = () => {
    if (selectedIds.length === 0) {
      setSelectedIds(mods.map((m) => m.id));
    } else {
      setSelectedIds([]);
    }
  };

  const selectedMods = mods.filter((m) => selectedIds.includes(m.id));

  // Status calculation
  const totalEntries = selectedMods.reduce((s, m) => s + m.entryCount, 0);
  const totalTranslated = selectedMods.reduce((s, m) => s + m.translatedCount, 0);
  const allReady = selectedMods.length > 0 && selectedMods.every((m) => m.entryCount > 0 && m.entryCount === m.translatedCount);
  const hasAnyEntry = selectedMods.some((m) => m.entryCount > 0);

  const readyMods = selectedMods.filter((m) => m.entryCount > 0 && m.entryCount === m.translatedCount);
  const pendingMods = selectedMods.filter((m) => m.entryCount > 0 && m.translatedCount < m.entryCount);
  const emptyMods = selectedMods.filter((m) => m.entryCount === 0);

  // Export
  const handleExport = async () => {
    setExportErr("");
    setExportOk(null);
    setExportLoading(true);
    try {
      const result = await api.exportMod(
        selectedIds,
        targetDir.trim() || undefined,
        targetLang
      );
      setExportOk(result);
    } catch (err) {
      setExportErr(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">Export</h1>
        <p className="text-sm text-muted">
          Export installable translation mods.
        </p>
      </header>

      {/* Status section */}
      <Card title="Export Status" subtitle={`Selected: ${selectedMods.length} of ${mods.length} mods`}>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={toggleAll}>
              {selectedIds.length === 0 ? "Select all" : "Clear selection"}
            </Button>
          </div>

          {selectedMods.length === 0 ? (
            <p className="text-sm text-muted">
              No mods selected. Use the Library to select mods for export, or click "Select all".
            </p>
          ) : (
            <>
              {/* Overall progress */}
              {hasAnyEntry && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text">Overall progress</span>
                    <span className="font-mono text-muted">
                      {totalTranslated} / {totalEntries}
                    </span>
                  </div>
                  <ProgressBar
                    value={totalTranslated}
                    max={totalEntries}
                    color="dust"
                    showValue
                  />
                </div>
              )}

              {/* Status cards */}
              {allReady && (
                <p className="text-sm text-success">✓ All selected mods are fully translated and ready for export.</p>
              )}

              {pendingMods.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-warning">
                    {pendingMods.length} mod{pendingMods.length !== 1 ? "s" : ""} not yet complete:
                  </p>
                  <div className="max-h-60 space-y-1 overflow-y-auto">
                    {pendingMods.map((mod) => (
                      <div
                        key={mod.id}
                        className="flex items-center gap-2 rounded px-2 py-1 hover:bg-raised"
                      >
                        <span className="flex-1 text-sm text-text">{mod.name}</span>
                        {mod.isBaseGame && <Tag tone="base">Base Game</Tag>}
                        <span className="font-mono text-xs text-muted">
                          {mod.translatedCount}/{mod.entryCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {emptyMods.length > 0 && (
                <p className="text-sm text-muted">
                  {emptyMods.length} mod{emptyMods.length !== 1 ? "s" : ""} have no translatable entries.
                </p>
              )}
            </>
          )}

          <Input
            label="Target folder"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            hint="Empty = default export/mods"
            className="font-mono"
          />

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              Target language
            </label>
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

          <div>
            <Button
              variant="primary"
              disabled={selectedIds.length === 0 || exportLoading}
              onClick={handleExport}
            >
              {exportLoading ? "Exporting…" : "Export"}
            </Button>
          </div>

          {exportOk && (
            <div className="space-y-2">
              <p className="text-sm text-success">
                {exportOk.results.length} mod{exportOk.results.length !== 1 ? "s" : ""} exported to{" "}
                <span className="font-mono">{exportOk.targetDir}</span>
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {exportOk.results.map((r) => (
                  <div key={r.modId} className="space-y-0.5">
                    <p className="font-mono text-xs text-muted">{r.targetPath}</p>
                    {r.written.map((p) => (
                      <p key={p} className="pl-3 font-mono text-xs text-muted">
                        {p}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {exportErr && <p className="text-sm text-danger">{exportErr}</p>}
        </div>
      </Card>
    </div>
  );
}
