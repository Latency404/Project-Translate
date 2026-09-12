import { useEffect, useState } from "react";
import { Copy, RotateCcw, Rocket, X } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import Modal from "../components/Modal.jsx";

/* Standard-Tokens aus src/styles/theme.css — das Panel überschreibt sie
   zur Laufzeit über CSS-Variablen am :root. */
const DEFAULTS = {
  ink: "#0a0a0a",
  surface: "#121517",
  raised: "#21272b",
  line: "#33383d",
  text: "#f5f5f5",
  muted: "#ababab",
  dust: "#c4c4c4",
  accent: "#e21d1d",
  "accent-light": "#ff4040",
  "accent-deep": "#8a1414",
  warning: "#e2901d",
  success: "#1de252",
  danger: "#e21d1d",
};

const STORAGE_KEY = "pt-theme-overrides";

function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(
      Object.keys(DEFAULTS).filter((k) => parsed[k]).map((k) => [k, parsed[k]]),
    );
  } catch {
    return {};
  }
}

function ColorPanel({ colors, overrides, onPick, onReset }) {
  const [copied, setCopied] = useState(false);

  const cssBlock =
    "@theme {\n" +
    Object.entries(colors)
      .map(([k, v]) => `  --color-${k}: ${v};`)
      .join("\n") +
    "\n}";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cssBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard nicht verfügbar — Button bleibt einfach unbestätigt */
    }
  };

  return (
    <Card
      title="Farben"
      subtitle="Zum schnellen Testen — überschreibt die Tokens live (bleibt bis Zurücksetzen)."
      footer={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>
            {copied ? "Kopiert!" : "@theme kopieren"}
          </Button>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onReset}>
            Zurücksetzen
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Object.entries(colors).map(([name, value]) => (
          <label key={name} className="flex items-center gap-2">
            <input
              type="color"
              value={value}
              onChange={(e) => onPick(name, e.target.value.toLowerCase())}
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-raised p-0.5"
              aria-label={`Token ${name}`}
            />
            <span className="min-w-0">
              <span
                className={`block truncate text-xs font-medium ${overrides[name] ? "text-accent" : "text-text"}`}
              >
                {name}
              </span>
              <span className="block font-mono text-[10px] text-muted">
                {value}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted/70">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function Showcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [overrides, setOverrides] = useState(loadOverrides);
  const colors = { ...DEFAULTS, ...overrides };

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (overrides[key]) root.style.setProperty(`--color-${key}`, overrides[key]);
      else root.style.removeProperty(`--color-${key}`);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const pick = (name, value) =>
    setOverrides((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">
          Project Translate
        </h1>
        <p className="text-sm text-muted">
          Design-Fundament — Tokens und Komponenten vor dem Aufbau der Screens.
        </p>
      </header>

      <ColorPanel
        colors={colors}
        overrides={overrides}
        onPick={pick}
        onReset={() => setOverrides({})}
      />

      <Section
        title="Farbverwendung"
        hint="So werden die Tokens in der App eingesetzt (Swatches oben live veränderbar)."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(colors).map(([name, hex]) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border border-line bg-surface p-2"
            >
              <span
                className="h-6 w-6 shrink-0 rounded"
                style={{ backgroundColor: hex }}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-text">
                  {name}
                </span>
                <span className="block font-mono text-[10px] text-muted">
                  {hex}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Schriften" hint="Sans für UI, Mono für Pfade, Keys und Zahlen.">
        <Card>
          <p className="text-base text-text">
            Sans — Project Zomboid Mod Translator
          </p>
          <p className="mt-2 font-mono text-sm text-muted">
            Mono — 42.20/media/lua/shared/Translate/EN/ItemName.json::ItemName_X
          </p>
        </Card>
      </Section>

      <Section title="Buttons" hint="Varianten: primary, secondary, danger — Größen sm/md/lg.">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Rocket}>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm" icon={X}>
              Small
            </Button>
            <Button size="lg">Large</Button>
          </div>
        </Card>
      </Section>

      <Section title="Card" hint="Mit Titel, Untertitel und Footer.">
        <Card
          title="More Traits"
          subtitle="1299328280 · 3 Versionen · 4.812 Einträge"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm">
                Übersetzen
              </Button>
              <Button size="sm">Öffnen</Button>
            </div>
          }
        >
          <p className="text-sm text-muted">
            Karten tragen Inhalt, Rahmen und optional Kopf-/Fußzeile.
          </p>
        </Card>
      </Section>

      <Section title="Input" hint="Mit Label und Hinweis; Fokus zeigt den Akzent-Ring.">
        <Card className="space-y-4">
          <Input label="Spiel-Ordner" placeholder="C:/Program Files (x86)/Steam/..." />
          <Input
            label="Zielsprache"
            placeholder="DE"
            hint="2- oder 4-Buchstaben-Code"
          />
        </Card>
      </Section>

      <Section title="ProgressBar" hint="Fortschritt pro Mod — Farbtöne je Status.">
        <Card className="space-y-4">
          <ProgressBar label="More Traits" value={2410} max={4812} showValue color="dust" />
          <ProgressBar label="Basisspiel (fertig)" value={100} max={100} color="success" />
          <ProgressBar label="Defekte Datei" value={12} max={100} color="warning" />
          <ProgressBar label="Abbruch" value={30} max={100} color="danger" />
        </Card>
      </Section>

      <Section title="Tag" hint="Status-Labels — z. B. Base Game, missing, translated.">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Tag tone="neutral">Neutral</Tag>
            <Tag tone="base">Base Game</Tag>
            <Tag tone="warning">Missing</Tag>
            <Tag tone="success">Translated</Tag>
            <Tag tone="danger">Fehler</Tag>
          </div>
        </Card>
      </Section>

      <Section title="Modal" hint="Schließt über X, Backdrop-Klick oder Escape.">
        <Card>
          <Button onClick={() => setModalOpen(true)}>Dialog öffnen</Button>
        </Card>
      </Section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Export bestätigen">
        <p className="text-sm text-muted">
          3 Mods werden nach <span className="font-mono text-text">export/llm/DE/</span>{" "}
          exportiert. Bestehende Dateien werden überschrieben.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => setModalOpen(false)}>Exportieren</Button>
        </div>
      </Modal>
    </div>
  );
}
