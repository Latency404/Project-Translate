import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import Tag from "../components/Tag.jsx";
import * as api from "../api.js";

export default function Exchange() {
  const [mods, setMods] = useState([]);
  const [targetLang, setTargetLang] = useState("DE");
  const [selected, setSelected] = useState(new Set());
  const [exportLoading, setExportLoading] = useState(false);
  const [exportOk, setExportOk] = useState(null);
  const [exportErr, setExportErr] = useState("");

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyOk, setApplyOk] = useState(null);
  const [applyErr, setApplyErr] = useState("");

  // Daten laden
  useEffect(() => {
    Promise.all([api.getConfig(), api.getMods()])
      .then(([cfg, data]) => {
        setTargetLang(cfg.targetLang || "DE");
        setMods(data.mods || []);
      })
      .catch((err) => {
        setExportErr(err.message);
      });
  }, []);

  // Alle aus / auswählen
  const toggleAll = () => {
    if (selected.size === 0) {
      setSelected(new Set(mods.map((m) => m.id)));
    } else {
      setSelected(new Set());
    }
  };

  // Export
  const handleExport = async () => {
    setExportErr("");
    setExportOk(null);
    setExportLoading(true);
    try {
      const result = await api.exportLlm(Array.from(selected), targetLang);
      setExportOk(result);
    } catch (err) {
      setExportErr(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  // Vorschau
  const handlePreview = async () => {
    setPreviewErr("");
    setPreview(null);
    setPreviewLoading(true);
    try {
      const result = await api.importPreview();
      setPreview(result);
    } catch (err) {
      setPreviewErr(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Summen
  const totalMatched = preview
    ? Object.values(preview.perMod).reduce((s, p) => s + p.matched, 0)
    : 0;
  const totalUnmatched = preview
    ? Object.values(preview.perMod).reduce((s, p) => s + p.unmatched, 0)
    : 0;

  // Apply
  const handleApply = async () => {
    setApplyErr("");
    setApplyOk(null);
    setApplyLoading(true);
    try {
      const result = await api.importApply();
      setApplyOk(result);
      setModalOpen(false);
    } catch (err) {
      setApplyErr(err.message);
    } finally {
      setApplyLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">Exchange</h1>
        <p className="text-sm text-muted">
          LLM-Export und -Import für Mods verwalten.
        </p>
      </header>

      {/* LLM-Export */}
      <Card title="LLM-Export" subtitle="Wähle Mods und Sprache für den Export.">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={toggleAll}>
              {selected.size === 0 ? "Alle auswählen" : "Auswahl löschen"}
            </Button>
          </div>

          <div className="space-y-1.5">
            {mods.map((mod) => (
              <label
                key={mod.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-raised"
              >
                <input
                  type="checkbox"
                  checked={selected.has(mod.id)}
                  onChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(mod.id)) next.delete(mod.id);
                      else next.add(mod.id);
                      return next;
                    });
                  }}
                  className="h-4 w-4 rounded border-line bg-raised accent-accent"
                />
                <span className="text-sm text-text">{mod.name}</span>
                {mod.isBaseGame && <Tag tone="base">Base Game</Tag>}
                <span className="ml-auto font-mono text-xs text-muted">
                  {mod.entryCount}
                </span>
              </label>
            ))}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              Zielsprache
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
              disabled={selected.size === 0 || exportLoading}
              onClick={handleExport}
            >
              {exportLoading ? "Exportiere…" : "Exportieren"}
            </Button>
          </div>

          {exportOk && (
            <div className="space-y-1">
              <p className="text-sm text-success">
                {exportOk.written.length} Datei{exportOk.written.length !== 1 ? "en" : ""} geschrieben.
              </p>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {exportOk.written.map((p) => (
                  <p key={p} className="font-mono text-xs text-muted">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          )}
          {exportErr && <p className="text-sm text-danger">{exportErr}</p>}
        </div>
      </Card>

      {/* LLM-Import */}
      <Card title="LLM-Import" subtitle="Vorschau und Übernahme von LLM-Übersetzungen.">
        <div className="space-y-4">
          <Button
            variant="secondary"
            disabled={previewLoading}
            onClick={handlePreview}
          >
            {previewLoading ? "Lädt…" : "Vorschau laden"}
          </Button>

          {preview && (
            <>
              {totalMatched === 0 && totalUnmatched === 0 ? (
                <p className="text-sm text-muted">
                  Keine Dateien im Import-Ordner gefunden.
                </p>
              ) : (
                <>
                  <div className="space-y-1">
                    {Object.values(preview.perMod).map((pm) => (
                      <div
                        key={pm.mod}
                        className="flex items-center gap-2 rounded px-2 py-1"
                      >
                        <span className="flex-1 text-sm text-text">
                          {pm.mod}
                        </span>
                        <span className="font-mono text-sm text-success">
                          {pm.matched}
                        </span>
                        {pm.unmatched > 0 && (
                          <>
                            <span className="font-mono text-sm text-warning">
                              {pm.unmatched}
                            </span>
                            <Tag tone="warning">Warnung</Tag>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 border-t border-line pt-3">
                    <span className="text-sm font-medium text-text">
                      Gesamt: {totalMatched} matched, {totalUnmatched} unmatched
                    </span>
                  </div>

                  <Button variant="primary" onClick={() => setModalOpen(true)}>
                    Übernehmen
                  </Button>
                </>
              )}
            </>
          )}

          {previewErr && <p className="text-sm text-danger">{previewErr}</p>}
          {applyOk && (
            <p className="text-sm text-success">
              {applyOk.saved} Einträge übernommen.
            </p>
          )}
        </div>
      </Card>

      {/* Bestätigungs-Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Import übernehmen"
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            {totalMatched} Einträge werden in {targetLang}-Dateien geschrieben{" "}
            {totalUnmatched > 0 &&
              `(${totalUnmatched} unmatched werden verworfen).`}
          </p>

          {applyErr && <p className="text-sm text-danger">{applyErr}</p>}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={applyLoading}
              onClick={handleApply}
            >
              {applyLoading ? "Übernehme…" : "Ja, übernehmen"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
