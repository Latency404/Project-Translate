import { useEffect, useRef, useState } from "react";
import { Copy, RotateCcw, Rocket, X } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import Modal from "../components/Modal.jsx";

/* Standard tokens from src/styles/theme.css — the panel overrides them
   at runtime via CSS variables on :root. */
const DEFAULTS = {
  ink: "#121212",
  surface: "#121517",
  raised: "#21272b",
  slate: "#596973",
  track: "#2e2e2e",
  line: "#33383d",
  "file-bg": "#242729",
  "file-border": "#646566",
  text: "#f5f5f5",
  "text-inverse": "#141414",
  muted: "#ababab",
  dust: "#c4c4c4",
  accent: "#4dabf7",
  "accent-light": "#74c0fc",
  "accent-deep": "#2f8ce0",
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

function Swatch({ name, value, isOverridden, onPick, onResetOne }) {
  const inputRef = useRef(null);
  const openPicker = () => {
    const input = inputRef.current;
    if (input?.showPicker) {
      try {
        input.showPicker();
      } catch {
        /* Requires a user gesture — nothing to do */
      }
    }
  };
  return (
    <div className="group relative flex items-center gap-2">
      <button
        type="button"
        onClick={openPicker}
        className="h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded border border-line"
        style={{ backgroundColor: value }}
        aria-label={`Pick color for ${name}`}
        title={`Pick color for ${name}`}
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onPick(name, e.target.value.toLowerCase())}
        className="sr-only"
        aria-label={`Token ${name}`}
      />
      <span className="min-w-0">
        <span
          className={`block truncate text-xs font-medium ${
            isOverridden ? "text-accent" : "text-text"
          }`}
        >
          {name}
        </span>
        <span className="block font-mono text-[10px] text-muted">
          {value}
        </span>
      </span>
      {isOverridden && (
        <button
          type="button"
          onClick={() => onResetOne(name)}
          className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-line hover:text-text transition-colors"
          aria-label={`Reset ${name} to default`}
          title={`Reset ${name} to default`}
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

function ColorPanel({ colors, overrides, onPick, onReset, onResetOne }) {
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
      /* Clipboard not available — the button simply stays unconfirmed */
    }
  };

  return (
    <Card
      title="Colors"
      subtitle="For quick testing — overrides the tokens live (persists until reset; X on a swatch resets that color only)."
      footer={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>
            {copied ? "Copied!" : "Copy @theme"}
          </Button>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onReset}>
            Reset
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Object.entries(colors).map(([name, value]) => (
          <Swatch
            key={name}
            name={name}
            value={value}
            isOverridden={overrides[name] !== undefined}
            onPick={onPick}
            onResetOne={onResetOne}
          />
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

  const resetOne = (name) =>
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-2xl font-bold text-accent">
          Project Translate
        </h1>
        <p className="text-sm text-muted">
          Design foundation — tokens and components before building the screens.
        </p>
      </header>

      <ColorPanel
        colors={colors}
        overrides={overrides}
        onPick={pick}
        onReset={() => setOverrides({})}
        onResetOne={resetOne}
      />

      <Section
        title="Color usage"
        hint="This is how the tokens are used in the app (swatches above are live-editable)."
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

      <Section title="Fonts" hint="Sans for UI, mono for paths, keys and numbers.">
        <Card>
          <p className="text-base text-text">
            Sans — Project Zomboid Mod Translator
          </p>
          <p className="mt-2 font-mono text-sm text-muted">
            Mono — 42.20/media/lua/shared/Translate/EN/ItemName.json::ItemName_X
          </p>
        </Card>
      </Section>

      <Section title="Buttons" hint="Variants: primary, secondary, danger — sizes sm/md/lg.">
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

      <Section title="Card" hint="With title, subtitle and footer.">
        <Card
          title="More Traits"
          subtitle="1299328280 · 3 versions · 4,812 entries"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm">
                Translate
              </Button>
              <Button size="sm">Open</Button>
            </div>
          }
        >
          <p className="text-sm text-muted">
            Cards carry content, borders and an optional header/footer.
          </p>
        </Card>
      </Section>

      <Section title="Input" hint="With label and hint; focus shows the accent ring.">
        <Card className="space-y-4">
          <Input label="Game folder" placeholder="C:/Program Files (x86)/Steam/..." />
          <Input
            label="Target language"
            placeholder="DE"
            hint="2- or 4-letter code"
          />
        </Card>
      </Section>

      <Section title="ProgressBar" hint="Progress per mod — color tones per status.">
        <Card className="space-y-4">
          <ProgressBar label="More Traits" value={2410} max={4812} showValue color="dust" />
          <ProgressBar label="Base game (done)" value={100} max={100} color="success" />
          <ProgressBar label="Broken file" value={12} max={100} color="warning" />
          <ProgressBar label="Aborted" value={30} max={100} color="danger" />
        </Card>
      </Section>

      <Section title="Tag" hint="Status labels — e.g. Base Game, missing, translated.">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Tag tone="neutral">Neutral</Tag>
            <Tag tone="base">Base Game</Tag>
            <Tag tone="file">3 Files</Tag>
            <Tag tone="warning">Open</Tag>
            <Tag tone="success">Translated</Tag>
            <Tag tone="accent">Needs Review</Tag>
            <Tag tone="danger">Error</Tag>
          </div>
        </Card>
      </Section>

      <Section title="Modal" hint="Closes via X, backdrop click or Escape.">
        <Card>
          <Button onClick={() => setModalOpen(true)}>Open dialog</Button>
        </Card>
      </Section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Confirm export">
        <p className="text-sm text-muted">
          3 mods will be exported to <span className="font-mono text-text">export/llm/DE/</span>.{" "}
          Existing files will be overwritten.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setModalOpen(false)}>Export</Button>
        </div>
      </Modal>
    </div>
  );
}
