import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import * as api from "../api.js";

function StatusCard({ title, path, found }) {
  return (
    <Card
      title={title}
      footer={
        <Tag tone={found ? "success" : "danger"}>
          {found ? "Gefunden" : "Nicht gefunden"}
        </Tag>
      }
    >
      <p className="text-xs text-muted">
        Pfad: <span className="font-mono text-text">{path}</span>
      </p>
    </Card>
  );
}

export default function Setup({ onOpenMods }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [gameRoot, setGameRoot] = useState("");
  const [workshopDir, setWorkshopDir] = useState("");
  const [targetLang, setTargetLang] = useState("DE");
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, current: "" });

  // Initial laden
  useEffect(() => {
    Promise.all([api.getConfig(), api.getStatus()])
      .then(([cfg, st]) => {
        setConfig(cfg);
        setGameRoot(cfg.gameRoot);
        setWorkshopDir(cfg.workshopDir);
        setTargetLang(cfg.targetLang);
        setStatus(st);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Polling während Scan: alle 1000 ms Status abfragen, bis scanRunning false ist.
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(async () => {
      try {
        const st = await api.getStatus();
        setStatus(st);
        if (st.scanProgress) setScanProgress(st.scanProgress);
        if (!st.scanRunning) {
          clearInterval(timer);
          setScanning(false);
          setScanDone(true);
        }
      } catch (err) {
        setError(err.message);
        clearInterval(timer);
        setScanning(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [scanning]);

  const handleSave = async () => {
    setError("");
    setScanDone(false);
    try {
      const saved = await api.saveConfig({ gameRoot, workshopDir, targetLang });
      setConfig(saved);
      setStatus(await api.getStatus());
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScan = async () => {
    setError("");
    setScanDone(false);
    setScanning(true);
    setScanProgress({ done: 0, total: 0, current: "" });
    try {
      await api.startScan();
    } catch (err) {
      setError(err.message);
      setScanning(false);
    }
  };

  // Wenn Scan abgeschlossen
  const scanComplete = status && !status.scanRunning && scanDone;

  if (!config || !status) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <p className="text-center text-muted">Lädt…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">Setup</h1>
        <p className="text-sm text-muted">Konfiguration prüfen, Pfade bearbeiten und Mods scannen.</p>
      </header>

      {/* Status-Karten */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard
          title="Spiel"
          path={status.gameFound ? gameRoot : "—"}
          found={status.gameFound}
        />
        <StatusCard
          title="Workshop"
          path={status.workshopFound ? workshopDir : "—"}
          found={status.workshopFound}
        />
      </div>

      {/* Config bearbeiten */}
      <Card title="Konfiguration" subtitle="Pfade und Zielsprache bearbeiten.">
        <div className="space-y-4">
          <Input label="Spiel-Ordner" value={gameRoot} onChange={(e) => setGameRoot(e.target.value)} className="font-mono" />
          <Input label="Workshop-Ordner" value={workshopDir} onChange={(e) => setWorkshopDir(e.target.value)} className="font-mono" />
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
        </div>
      </Card>

      {/* Scannen */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" icon={ScanSearch} onClick={handleScan} disabled={scanning}>
              Scannen
            </Button>
            {scanComplete && (
              <Button variant="secondary" size="sm" onClick={onOpenMods}>
                Zu den Mods
              </Button>
            )}
          </div>

          {/* Scan-Fortschritt */}
          {(scanning || scanProgress.done > 0) && (
            <div className="space-y-2">
              <ProgressBar
                value={scanProgress.done}
                max={scanProgress.total > 0 ? scanProgress.total : 1}
                label="Scannen…"
                color="dust"
                className="w-full"
              />
              {scanProgress.current && (
                <p className="text-xs font-mono text-muted">{scanProgress.current}</p>
              )}
            </div>
          )}

          {/* Ergebnis */}
          {scanComplete && !error && (
            <p className="text-sm text-success font-medium">
              Scan fertig — {status.modCount} Mods gefunden.
            </p>
          )}

          {/* Fehler */}
          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
