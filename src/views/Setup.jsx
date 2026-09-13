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
          {found ? "Found" : "Not found"}
        </Tag>
      }
    >
      <p className="text-xs text-muted">
        Path: <span className="font-mono text-text">{path}</span>
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
  const [sourceLang, setSourceLang] = useState("EN");
  const [targetLang, setTargetLang] = useState("DE");
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, current: "" });

  // Initial load
  useEffect(() => {
    Promise.all([api.getConfig(), api.getStatus()])
      .then(([cfg, st]) => {
        setConfig(cfg);
        setGameRoot(cfg.gameRoot);
        setWorkshopDir(cfg.workshopDir);
        setSourceLang(cfg.sourceLang || "EN");
        setTargetLang(cfg.targetLang);
        setStatus(st);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Polling during scan: query status every 1000 ms until scanRunning is false.
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
      const saved = await api.saveConfig({
        gameRoot,
        workshopDir,
        sourceLang,
        targetLang,
      });
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

  // When scan is complete
  const scanComplete = status && !status.scanRunning && scanDone;

  if (!config || !status) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <p className="text-center text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">Settings</h1>
        <p className="text-sm text-muted">Check configuration, edit paths, and scan mods.</p>
      </header>

      {/* Status cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard
          title="Game"
          path={status.gameFound ? gameRoot : "—"}
          found={status.gameFound}
        />
        <StatusCard
          title="Workshop"
          path={status.workshopFound ? workshopDir : "—"}
          found={status.workshopFound}
        />
      </div>

      {/* Edit configuration */}
      <Card title="Configuration" subtitle="Edit paths and languages.">
        <div className="space-y-4">
          <Input label="Game folder" value={gameRoot} onChange={(e) => setGameRoot(e.target.value)} className="font-mono" />
          <Input label="Workshop folder" value={workshopDir} onChange={(e) => setWorkshopDir(e.target.value)} className="font-mono" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">
                Source language
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <option value="EN">EN</option>
                <option value="DE">DE</option>
                <option value="FR">FR</option>
                <option value="ES">ES</option>
              </select>
            </div>
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
          </div>
        </div>
      </Card>

      {/* Scan */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" icon={ScanSearch} onClick={handleScan} disabled={scanning}>
              Scan
            </Button>
            {scanComplete && (
              <Button variant="secondary" size="sm" onClick={onOpenMods}>
                Go to Mods
              </Button>
            )}
          </div>

          {/* Scan progress */}
          {(scanning || scanProgress.done > 0) && (
            <div className="space-y-2">
              <ProgressBar
                value={scanProgress.done}
                max={scanProgress.total > 0 ? scanProgress.total : 1}
                label="Scanning…"
                color="dust"
                className="w-full"
              />
              {scanProgress.current && (
                <p className="text-xs font-mono text-muted">{scanProgress.current}</p>
              )}
            </div>
          )}

          {/* Result */}
          {scanComplete && !error && (
            <p className="text-sm text-success font-medium">
              Scan complete — {status.modCount} mods found.
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
