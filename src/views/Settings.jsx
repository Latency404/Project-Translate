import { useEffect, useRef, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import Button from "../components/Button.jsx";
import Modal from "../components/Modal.jsx";
import LangSelect, { fieldBox, fieldFocus } from "../components/LangSelect.jsx";
import LangMultiSelect from "../components/LangMultiSelect.jsx";
import Tag from "../components/Tag.jsx";
import {
  AutoDetectIcon,
  EditIcon,
  FolderIcon,
  GoToModsIcon,
  NoIcon,
  ResetIcon,
  SaveIcon,
  SearchIcon,
  YesIcon,
} from "../components/Icons.jsx";
import { useToast } from "../components/Toast.jsx";
import * as api from "../api.js";

// saveErr ist eine oder mehrere Satz-für-Satz-Meldungen von POST /api/config
// (server/config.js validate()), z. B. "Select at least one target language.
// Unknown target language: XY." Jede Meldung ist ein Satz mit Punkt. Wir
// teilen sie am Feld auf, damit sie direkt bei der betroffenen Eingabe steht;
// alles Übrige (`otherErrs`) geht als Toast raus.
function splitSaveErr(saveErr) {
  const parts = saveErr ? saveErr.split(/(?<=\.)\s+/).filter(Boolean) : [];
  const gameRootErrs = parts.filter((p) => p.startsWith("Game folder"));
  const workshopErrs = parts.filter((p) => p.startsWith("Workshop folder"));
  const langErrs = parts.filter((p) => p.toLowerCase().includes("language"));
  const placed = new Set([...gameRootErrs, ...workshopErrs, ...langErrs]);
  const otherErrs = parts.filter((p) => !placed.has(p));
  return { gameRootErrs, workshopErrs, langErrs, otherErrs };
}

// `found`: true = Pfad gefunden (Haken), false = nicht gefunden (Kreuz),
// null = noch nicht geprüft (kein Icon). `locked`: nur lesbar.
// Anklicken leert das Feld für eine neue Eingabe (USER-Wahl); wird es ohne
// Eingabe verlassen, kommt genau der Wert zurück, der VOR dem Anklicken
// drinstand — nicht der gespeicherte, falls schon etwas Neues getippt war.
function PathField({ label, hint, value, onChange, errors, className, found, locked }) {
  const beforeFocus = useRef("");
  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <div className={`${fieldBox} ${locked ? "" : fieldFocus}`}>
          <FolderIcon size={14} className="shrink-0 text-text" />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            readOnly={locked}
            tabIndex={locked ? -1 : 0}
            onFocus={() => {
              if (locked) return;
              beforeFocus.current = value;
              onChange("");
            }}
            onBlur={() => !locked && value === "" && onChange(beforeFocus.current)}
            spellCheck={false}
            className={`h-full min-w-0 flex-1 bg-transparent p-0 text-xs leading-none outline-none ${className}`}
          />
          {found === true && <YesIcon size={14} className="shrink-0 text-success" />}
          {found === false && <NoIcon size={14} className="shrink-0 text-danger" />}
        </div>
      </label>
      {errors.length > 0 ? (
        <p className="text-xs text-danger">
          {errors.map((e) => e.replace(/^(Game|Workshop) folder/, "Folder")).join(" ")}
        </p>
      ) : (
        <p className="text-xs text-muted/80">{hint}</p>
      )}
    </div>
  );
}

// Englische Oberfläche, aber 24-Stunden-Zeit: "19 Sept 2026, 14:32".
function formatBackupDate(iso) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "Restore Backup": Karte im selben Aufbau wie "Reset Translations", der
// Dialog listet die Speicherpunkte (neueste zuerst) nur mit ihrem Zeitpunkt
// (USER-Wahl: mehr braucht es zur Auswahl nicht). Zurückspielen sichert
// serverseitig zuerst den aktuellen Stand als eigenen Punkt — ein Restore ist
// also selbst wieder rückgängig zu machen. Nicht zuordenbare Alt-Punkte (s.
// server/backups.js) erscheinen ausgegraut.
function RestoreBackupCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [backups, setBackups] = useState(null); // null = lädt
  const [selected, setSelected] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const openDialog = () => {
    setOpen(true);
    setSelected(null);
    setBackups(null);
    api
      .listBackups()
      .then((res) => setBackups(res.backups || []))
      .catch((err) => {
        setOpen(false);
        toast("error", err.message);
      });
  };

  const handleRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      const res = await api.restoreBackup(selected);
      setOpen(false);
      const skipped =
        res.skipped > 0 ? ` ${res.skipped} file(s) skipped.` : "";
      if (res.restored === 0) {
        toast("info", `Nothing to restore. The files already match this backup.${skipped}`);
      } else {
        toast(
          "success",
          `Restored ${res.restored} file(s). Your previous state was saved as a new backup.${skipped}`,
        );
      }
    } catch (err) {
      toast("error", err.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <section className="rounded-[0.625rem] border border-line bg-surface">
        <header className="flex items-center justify-between gap-4 p-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Restore Backup</h2>
            <p className="mt-1.5 text-xs text-muted">
              Roll your translation files back to an earlier save point.
            </p>
          </div>
          <Button
            variant="secondary"
            icon={ArchiveRestore}
            className="shrink-0 whitespace-nowrap"
            onClick={openDialog}
          >
            Restore Backup
          </Button>
        </header>
      </section>

      <Modal
        open={open}
        onClose={() => (!restoring ? setOpen(false) : undefined)}
        title="Restore a backup"
      >
        <div className="space-y-4">
          {backups === null ? (
            <p className="text-sm text-muted">Loading backups…</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted">
              No backups yet. A save point is created every time you save in the Editor.
            </p>
          ) : (
            <>
              <p className="text-sm text-text">
                Choose a save point. Its files go back to how they were before it.
                Your current state is backed up first, so this can be undone.
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {backups.map((b) => {
                  const on = selected === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={!b.restorable || restoring}
                      onClick={() => setSelected(b.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        on ? "border-accent bg-raised" : "border-line hover:bg-raised"
                      } ${b.restorable ? "cursor-pointer" : "cursor-not-allowed opacity-50 hover:bg-transparent"}`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                          on ? "border-accent" : "border-line"
                        }`}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </span>
                      <span className="text-ui font-semibold text-text">
                        {formatBackupDate(b.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={restoring}>
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={!selected || restoring}>
              {restoring ? "Restoring..." : "Restore"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function Settings({ onOpenMods, onLangsChanged, activeLang: activeLangProp, noScanNotice = false }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const toast = useToast();
  const [gameRoot, setGameRoot] = useState("");
  const [workshopDir, setWorkshopDir] = useState("");
  const [targetLangs, setTargetLangs] = useState(["DE"]);
  const [activeLang, setActiveLang] = useState("DE");
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Bearbeitungsmodus: beim Erststart offen, nach dem Speichern gesperrt
  // (Edit Paths öffnet ihn wieder). detect = Ergebnis von "Auto detect".
  const [editing, setEditing] = useState(false);
  const [detect, setDetect] = useState(null); // null | "detected" | "partial" | "failed"
  const [justSaved, setJustSaved] = useState(false);
  const [noticeGone, setNoticeGone] = useState(false);

  // Initial load
  useEffect(() => {
    Promise.all([api.getConfig(), api.getStatus()])
      .then(([cfg, st]) => {
        setConfig(cfg);
        setGameRoot(cfg.gameRoot);
        setWorkshopDir(cfg.workshopDir);
        setTargetLangs(cfg.targetLangs);
        setActiveLang(cfg.activeLang);
        setStatus(st);
        setEditing(!st.configSaved);
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
        if (!st.scanRunning) {
          clearInterval(timer);
          setScanning(false);
          setScanDone(true);
          if (st.error) {
            toast("error", st.error);
          } else {
            toast("success", `Scan complete. ${st.modCount} mods found.`);
          }
        }
      } catch (err) {
        toast("error", err.message);
        clearInterval(timer);
        setScanning(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [scanning, toast]);

  // Dieselbe Einstellung laesst sich auch ueber den Sprachumschalter in der
  // Navbar aendern. Ohne diesen Abgleich zeigt das Feld hier weiter die alte
  // Sprache — und ein spaeteres Speichern wuerde den Wechsel zurueckdrehen.
  useEffect(() => {
    if (!activeLangProp) return;
    setActiveLang(activeLangProp);
    setConfig((c) => (c && c.activeLang !== activeLangProp ? { ...c, activeLang: activeLangProp } : c));
  }, [activeLangProp]);

  // Bleibt die aktive Sprache erhalten, wenn sie aus der Zielsprachen-Auswahl
  // fliegt (server/config.js hält dieselbe Regel: activeLang muss in
  // targetLangs stecken, sonst gilt targetLangs[0]).
  useEffect(() => {
    if (targetLangs.length > 0 && !targetLangs.includes(activeLang)) {
      setActiveLang(targetLangs[0]);
    }
  }, [targetLangs, activeLang]);

  const { gameRootErrs, workshopErrs, langErrs } = splitSaveErr(saveErr);

  // Unsaved changes: any field differs from the last loaded/saved config.
  const targetLangsEqual = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);
  const configDirty =
    !!config &&
    (gameRoot !== config.gameRoot ||
      workshopDir !== config.workshopDir ||
      !targetLangsEqual(targetLangs, config.targetLangs) ||
      activeLang !== config.activeLang);

  const handleSave = async () => {
    setSaveErr("");
    setSaving(true);
    const prevConfig = config;
    try {
      const saved = await api.saveConfig({
        gameRoot,
        workshopDir,
        targetLangs,
        activeLang,
      });
      setConfig(saved);
      setGameRoot(saved.gameRoot);
      setWorkshopDir(saved.workshopDir);
      setTargetLangs(saved.targetLangs);
      setActiveLang(saved.activeLang);
      setStatus(await api.getStatus());
      setEditing(false);
      setDetect(null);
      setJustSaved(true);
      // Der Sprachumschalter in der Navbar lebt in App.jsx und muss die neue
      // Liste sofort sehen, nicht erst beim naechsten Seitenwechsel.
      onLangsChanged?.();
      // A changed path or an added/removed target language leaves the scan
      // cache stale — the Mods page and Editor keep showing entries from
      // before the change until a new scan runs. Say so instead of letting
      // that surprise the user later. Switching only the active language
      // needs no rescan: the cache already holds every target language.
      const rescanNeeded =
        !!prevConfig &&
        (saved.gameRoot !== prevConfig.gameRoot ||
          saved.workshopDir !== prevConfig.workshopDir ||
          !targetLangsEqual(saved.targetLangs, prevConfig.targetLangs));
      toast(
        "success",
        rescanNeeded
          ? "Configuration saved. Rescanning mods in the background."
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
    setJustSaved(false);
    setScanDone(false);
    setScanning(true);
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
          ? `Reset ${result.resetCount} translation(s) across ${result.modCount} mod(s), including unsaved edits. Translations that shipped with a mod were kept. A backup of every reset file was kept.`
          : "Nothing to reset. No translations were made through this app.",
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

  const locked = !editing;
  const hasScan = status.modCount > 0;
  const scanFailed = !scanning && !!status.error;
  const noMods = !scanning && scanDone && !scanFailed && status.modCount === 0;

  // Header-Badges: Erkennung (beim Bearbeiten), "Saved", oder Scan-Ergebnis.
  let badges = [];
  if (editing) {
    if (detect === "detected") badges = [{ tone: "success", text: "Detected" }];
    else if (detect === "partial") badges = [{ tone: "warning", text: "Partially detected" }];
    else if (detect === "failed") badges = [{ tone: "danger", text: "Detection failed" }];
  } else if (scanFailed) {
    badges = [{ tone: "danger", text: "Mod detection failed" }];
  } else if (noMods) {
    badges = [{ tone: "warning", text: "No Mods detected" }];
  } else if (hasScan) {
    badges = [
      { tone: "success", text: "Mods detected" },
      { tone: "base", text: `${status.modCount}x Mods` },
    ];
  } else if (justSaved) {
    badges = [{ tone: "base", text: "Saved" }];
  }

  // Weiterleitung von Mods/Editor ohne Scan: Hinweis-Pille, solange nichts anderes gilt.
  // Kommt eine andere Pille, verschwindet der Hinweis endgültig (noticeGone).
  if (badges.length > 0 && !noticeGone) setNoticeGone(true);
  if (badges.length === 0 && noScanNotice && !noticeGone && !hasScan) {
    badges = [{ tone: "warning", text: "Search for mods first" }];
  }

  // Haken/Kreuz an den Pfaden nur direkt nach "Auto detect".
  const showFound = editing && detect !== null;
  const gameFoundIcon = showFound ? status.gameFound : null;
  const workshopFoundIcon = showFound ? status.workshopFound : null;
  // Pfadtext hell, sobald die Felder bearbeitbar sind — so sieht man nach
  // "Edit Paths", dass man etwas eingeben kann. Beim Erststart (Figma "First
  // Start") bleiben die vorausgefüllten Standardpfade gedämpft, bis sie
  // geändert oder per Auto detect bestätigt sind. Gesperrt: gedämpft.
  const pathClass = (found) =>
    `font-mono ${
      editing && (status.configSaved || configDirty || found === true) ? "text-text" : "text-muted"
    }`;

  // Erkennung: die vom Server gelieferte Konfiguration (beim Erststart die
  // Standard-Steam-Pfade) übernehmen und prüfen, ob die Ordner existieren.
  const handleAutoDetect = async () => {
    try {
      const [cfg, st] = await Promise.all([api.getConfig(), api.getStatus()]);
      setGameRoot(cfg.gameRoot);
      setWorkshopDir(cfg.workshopDir);
      setStatus(st);
      setJustSaved(false);
      setDetect(
        st.gameFound && st.workshopFound ? "detected" : st.gameFound || st.workshopFound ? "partial" : "failed",
      );
    } catch (err) {
      toast("error", err.message);
    }
  };

  const handleEdit = () => {
    setJustSaved(false);
    setDetect(null);
    setEditing(true);
  };

  const footerBtn =
    "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-ui font-semibold transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed";
  // Drei Stufen wie im Figma: aktiv-hervorgehoben (slate), aktiv (line), inaktiv (raised, gedämpft).
  const primaryBtn = `${footerBtn} bg-slate text-text hover:brightness-110 disabled:bg-raised disabled:text-muted disabled:hover:brightness-100`;
  const secondaryBtn = `${footerBtn} bg-line text-text hover:brightness-110 disabled:bg-raised disabled:text-muted disabled:hover:brightness-100`;

  // Erststart (Figma "First Start"): erst nach Auto detect oder einer Eingabe.
  // Danach im Bearbeitungsmodus immer, auch ohne Änderung; sonst nur, wenn
  // etwas offen ist (dann sind es die Sprachen).
  const firstStart = !status.configSaved;
  const saveEnabled =
    !saving && (configDirty || (editing && (!firstStart || detect === "detected")));
  // Mit ungespeicherten Aenderungen wuerde der Scan noch die alte
  // Sprachliste lesen — erst speichern, dann suchen.
  const searchEnabled = locked && !scanning && !configDirty;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-text">Settings</h1>
        <p className="text-sm text-muted">Check the configuration, edit paths, and scan for mods.</p>
      </header>

      <section className="rounded-[0.625rem] border border-line bg-surface">
        <header className="flex items-center justify-between gap-4 border-b border-line p-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Configuration</h2>
            <p className="mt-1.5 text-xs text-muted">Edit paths and translation languages.</p>
          </div>
          {badges.length > 0 && (
            <div className="flex items-center gap-2">
              {badges.map((b) => (
                <Tag key={b.text} tone={b.tone}>
                  {b.text}
                </Tag>
              ))}
            </div>
          )}
        </header>

        <div className="space-y-4 p-4">
          <PathField
            label="Project Zomboid"
            hint="Please enter the path of your game root folder."
            value={gameRoot}
            onChange={(v) => {
              setGameRoot(v);
              setSaveErr("");
            }}
            errors={gameRootErrs}
            className={pathClass(gameFoundIcon)}
            found={gameFoundIcon}
            locked={locked}
          />
          <PathField
            label="Workshop Mods"
            hint="Please enter the path of your workshop mods folder."
            value={workshopDir}
            onChange={(v) => {
              setWorkshopDir(v);
              setSaveErr("");
            }}
            errors={workshopErrs}
            className={pathClass(workshopFoundIcon)}
            found={workshopFoundIcon}
            locked={locked}
          />
        </div>

        <div className="space-y-4 border-t border-line p-4">
          <LangMultiSelect
            label="Target Languages"
            hint="Select the languages to translate into."
            value={targetLangs}
            onChange={setTargetLangs}
          />
          {/* EN ist Quelle UND Ziel zugleich: die Änderungen liegen im
              Arbeitsordner, die Originaltexte der Mod bleiben unverändert. */}
          {targetLangs.includes("EN") && (
            <p className="text-xs text-warning">
              English is the source language too. Your English edits are kept
              separately and go into the exported mod. The original texts of the
              mods stay unchanged.
            </p>
          )}
          {targetLangs.length > 1 && (
            <LangSelect
              label="Active Language"
              hint="The language you are editing right now."
              value={activeLang}
              onChange={setActiveLang}
              codes={targetLangs}
            />
          )}
          {langErrs.length > 0 && <p className="text-xs text-danger">{langErrs.join(" ")}</p>}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={locked}
              className={secondaryBtn}
            >
              <AutoDetectIcon /> Auto detect
            </button>
            {editing || configDirty ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={!saveEnabled}
                className={primaryBtn}
              >
                {/* Ohne Bearbeitungsmodus koennen nur die Sprachen offen sein —
                    die Pfadfelder sind dann readOnly. */}
                <SaveIcon /> {saving ? "Saving..." : editing ? "Save Paths" : "Save Languages"}
              </button>
            ) : (
              <button type="button" onClick={handleEdit} className={secondaryBtn}>
                <EditIcon /> Edit Paths
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasScan && !editing ? (
              <>
                <button type="button" onClick={handleScan} disabled={!searchEnabled} className={secondaryBtn}>
                  <SearchIcon /> Search again
                </button>
                <button type="button" onClick={onOpenMods} className={primaryBtn}>
                  <GoToModsIcon /> Go to Mods
                </button>
              </>
            ) : (
              <button type="button" onClick={handleScan} disabled={!searchEnabled} className={primaryBtn}>
                <SearchIcon /> Search Mods
              </button>
            )}
          </div>
        </footer>
      </section>

      <RestoreBackupCard />

      {/* Reset translations */}
      <section className="rounded-[0.625rem] border border-line bg-surface">
        <header className="flex items-center justify-between gap-4 p-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Reset Translations</h2>
            <p className="mt-1.5 text-xs text-muted">
              Undo every translation you made, across every scanned mod.
            </p>
          </div>
          <Button
            variant="danger"
            icon={ResetIcon}
            className="shrink-0 whitespace-nowrap"
            onClick={() => setResetModalOpen(true)}
          >
            Reset Translations
          </Button>
        </header>
      </section>

      <Modal
        open={resetModalOpen}
        onClose={() => (!resetting ? setResetModalOpen(false) : undefined)}
        title="Reset all translations?"
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            This removes every translation you made in this app, in every
            target language, including unsaved edits. Translations that
            shipped with a mod are kept. Backups stay in export/backups/.
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
