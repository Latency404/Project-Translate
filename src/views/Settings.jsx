import { useEffect, useState } from "react";
import { ScanSearch, Save, RotateCcw } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import Modal from "../components/Modal.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import { useToast } from "../components/Toast.jsx";
import * as api from "../api.js";

// saveErr ist eine oder mehrere Satz-für-Satz-Meldungen von POST /api/config
// (server/config.js validate()), z. B. "Game folder does not exist or is
// not a directory: ... . Source and target language must not be the same."
// Wir teilen sie am Feld auf, damit sie direkt bei der betroffenen Eingabe
// steht; alles Übrige (`otherErrs`) geht als Toast raus.
function splitSaveErr(saveErr) {
  const parts = saveErr ? saveErr.split(/(?<=\.)\s+/).filter(Boolean) : [];
  const gameRootErrs = parts.filter((p) => p.startsWith("Game folder"));
  const workshopErrs = parts.filter((p) => p.startsWith("Workshop folder"));
  const langErrs = parts.filter((p) => p.toLowerCase().includes("language"));
  const placed = new Set([...gameRootErrs, ...workshopErrs, ...langErrs]);
  const otherErrs = parts.filter((p) => !placed.has(p));
  return { gameRootErrs, workshopErrs, langErrs, otherErrs };
}

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
        Path:{" "}
        <span className="break-all font-mono leading-relaxed text-text">{path}</span>
      </p>
    </Card>
  );
}

export default function Settings({ onOpenMods }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const toast = useToast();
  const [gameRoot, setGameRoot] = useState("");
  const [workshopDir, setWorkshopDir] = useState("");
  const [sourceLang, setSourceLang] = useState("EN");
  const [targetLang, setTargetLang] = useState("DE");
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, current: "" });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

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
      .catch((err) => toast("error", err.message));
  }, [toast]);

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
          toast("success", `Scan complete — ${st.modCount} mods found.`);
        }
      } catch (err) {
        toast("error", err.message);
        clearInterval(timer);
        setScanning(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [scanning, toast]);

  const { gameRootErrs, workshopErrs, langErrs } = splitSaveErr(saveErr);

  // Unsaved changes: any field differs from the last loaded/saved config.
  const configDirty =
    !!config &&
    (gameRoot !== config.gameRoot ||
      workshopDir !== config.workshopDir ||
      sourceLang !== (config.sourceLang || "EN") ||
      targetLang !== config.targetLang);

  const handleSave = async () => {
    setSaveErr("");
    setSaving(true);
    const prevConfig = config;
    try {
      const saved = await api.saveConfig({
        gameRoot,
        workshopDir,
        sourceLang,
        targetLang,
      });
      setConfig(saved);
      setGameRoot(saved.gameRoot);
      setWorkshopDir(saved.workshopDir);
      setSourceLang(saved.sourceLang || "EN");
      setTargetLang(saved.targetLang);
      setStatus(await api.getStatus());
      // A changed path or language leaves the scan cache stale — the Mods page
      // and Editor keep showing entries from before the change until a new
      // scan runs. Say so instead of letting that surprise the user later.
      const rescanNeeded =
        !!prevConfig &&
        (saved.gameRoot !== prevConfig.gameRoot ||
          saved.workshopDir !== prevConfig.workshopDir ||
          saved.targetLang !== prevConfig.targetLang ||
          (saved.sourceLang || "EN") !== (prevConfig.sourceLang || "EN"));
      toast(
        "success",
        rescanNeeded
          ? "Configuration saved. Run a new scan to pick up the change — existing entries still reflect the previous settings."
          : "Configuration saved.",
      );
    } catch (err) {
      setSaveErr(err.message);
      const { otherErrs } = splitSaveErr(err.message);
      if (otherErrs.length > 0) toast("error", otherErrs.join(" "));
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async () => {
    setScanDone(false);
    setScanning(true);
    setScanProgress({ done: 0, total: 0, current: "" });
    try {
      await api.startScan();
    } catch (err) {
      toast("error", err.message);
      setScanning(false);
    }
  };

  const handleResetTranslations = async () => {
    setResetting(true);
    try {
      const result = await api.resetTranslations();
      // Reset betrifft nur die gespeicherten (Disk-)Übersetzungen — noch
      // ungespeicherte Eingaben im Editor leben als "dirty" im sessionStorage
      // (Editor.jsx DIRTY_KEY = "pt_editor_dirty") und überleben einen
      // View-Wechsel. Ohne diesen Schritt würde der Editor sie beim nächsten
      // Öffnen wieder anzeigen, als hätte Reset sie übersprungen.
      try {
        sessionStorage.removeItem("pt_editor_dirty");
      } catch { /* ignore */ }
      setResetModalOpen(false);
      toast(
        "success",
        result.resetCount > 0
          ? `Reset ${result.resetCount} translation(s) across ${result.modCount} mod(s), including unsaved edits. Translations that shipped with a mod were kept. A backup of every overwritten file was kept.`
          : "Nothing to reset — no translations were made through this app.",
      );
    } catch (err) {
      setResetModalOpen(false);
      toast("error", err.message);
    } finally {
      setResetting(false);
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
          <div>
            <Input label="Game folder" value={gameRoot} onChange={(e) => setGameRoot(e.target.value)} className="font-mono" />
            {gameRootErrs.length > 0 && (
              <p className="mt-1 text-xs text-danger">{gameRootErrs.join(" ")}</p>
            )}
          </div>
          <div>
            <Input label="Workshop folder" value={workshopDir} onChange={(e) => setWorkshopDir(e.target.value)} className="font-mono" />
            {workshopErrs.length > 0 && (
              <p className="mt-1 text-xs text-danger">{workshopErrs.join(" ")}</p>
            )}
          </div>
          <div>
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
            {langErrs.length > 0 && (
              <p className="mt-1 text-xs text-danger">{langErrs.join(" ")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              onClick={handleSave}
              disabled={!configDirty || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
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

        </div>
      </Card>

      {/* Reset translations */}
      <Card title="Reset Translations" subtitle="Undo everything you translated yourself, across every scanned mod.">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Undoes every change made through this app — including unsaved edits
            open in the Editor — as if it had never been used. Translations that
            already shipped with a mod (present before you first edited that
            file) are kept, not cleared. Original ({sourceLang}) files are never
            touched, and a backup of each overwritten file is kept under
            export/backups/ — same as any other save.
          </p>
          <Button
            variant="danger"
            icon={RotateCcw}
            onClick={() => setResetModalOpen(true)}
          >
            Reset Translations
          </Button>
        </div>
      </Card>

      <Modal
        open={resetModalOpen}
        onClose={() => (!resetting ? setResetModalOpen(false) : undefined)}
        title="Reset all translations?"
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            This undoes every translation you made through this app, in every
            scanned mod — the whole library, not just a selection — including
            any unsaved edits open in the Editor right now. Translations that
            already shipped with a mod are kept. This cannot be undone from
            within the app; a backup of each overwritten file is kept under
            export/backups/, but restoring it means copying files back by hand.
            Original ({sourceLang}) files are never modified.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setResetModalOpen(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleResetTranslations} disabled={resetting}>
              {resetting ? "Resetting..." : "Yes, reset everything"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
