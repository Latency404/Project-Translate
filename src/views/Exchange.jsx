import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import * as api from "../api.js";

// The export selection IS the Library selection — one shared sessionStorage
// key, so whatever is ticked in the Library is exactly what can be exported.
const STORAGE_KEY = "pt_library_selected";

function loadStoredIds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) return ids;
    }
  } catch { /* ignore */ }
  return [];
}

export default function Exchange({ onReselect }) {
  const [mods, setMods] = useState([]);
  const [targetLang, setTargetLang] = useState("DE");
  const [selectedIds, setSelectedIds] = useState(() => loadStoredIds());
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

  const selectedMods = mods.filter((m) => selectedIds.includes(m.id));

  // Status — numbers only, no per-mod lists on this page.
  const totalEntries = selectedMods.reduce((s, m) => s + m.entryCount, 0);
  const totalTranslated = selectedMods.reduce((s, m) => s + m.translatedCount, 0);
  const readyMods = selectedMods.filter(
    (m) => m.entryCount > 0 && m.entryCount === m.translatedCount,
  );
  const pendingMods = selectedMods.filter(
    (m) => m.entryCount > 0 && m.translatedCount < m.entryCount,
  );
  const emptyMods = selectedMods.filter((m) => m.entryCount === 0);
  const allReady =
    selectedMods.length > 0 && pendingMods.length === 0 && totalEntries > 0;

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
          Export installable translation mods — your Library selection.
        </p>
      </header>

      {/* Status section — compact, no mod lists */}
      <Card
        title="Export Status"
        subtitle={`Selected in Library: ${selectedMods.length} ${selectedMods.length === 1 ? "mod" : "mods"}`}
      >
        <div className="space-y-4">
          {selectedMods.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                No mods selected in the Library.
              </p>
              <Button variant="secondary" onClick={onReselect}>
                Go to Library
              </Button>
            </div>
          ) : (
            <>
              {/* Overall progress */}
              {totalEntries > 0 && (
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

              {/* Ready / not ready — one status line each, no lists */}
              {totalEntries === 0 ? (
                <p className="text-sm text-muted">
                  The selected mods have no translatable entries — nothing to export yet.
                </p>
              ) : allReady ? (
                <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2">
                  <Tag tone="success">Ready</Tag>
                  <span className="text-sm text-success">
                    All {selectedMods.length} {selectedMods.length === 1 ? "mod is" : "mods are"} fully translated — ready for export.
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                  <Tag tone="warning">Open</Tag>
                  <span className="text-sm text-warning">
                    {pendingMods.length} of {selectedMods.length}{" "}
                    {pendingMods.length === 1 ? "mod is" : "mods are"} not yet complete
                    {totalEntries - totalTranslated > 0 && (
                      <span className="font-mono">
                        {" "}
                        ({totalEntries - totalTranslated} entries open)
                      </span>
                    )}
                    .
                  </span>
                </div>
              )}

              {allReady === false && readyMods.length > 0 && (
                <p className="text-xs text-muted">
                  {readyMods.length} {readyMods.length === 1 ? "mod is" : "mods are"} already fully translated.
                </p>
              )}

              {emptyMods.length > 0 && (
                <p className="text-xs text-muted">
                  {emptyMods.length} {emptyMods.length === 1 ? "mod has" : "mods have"} no translatable entries (ignored on export).
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
