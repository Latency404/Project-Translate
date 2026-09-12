import { useState } from "react";
import { Rocket, X } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Input from "../components/Input.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import Tag from "../components/Tag.jsx";
import Modal from "../components/Modal.jsx";

const SWATCHES = [
  ["ink", "bg-ink", "#0b090a"],
  ["surface", "bg-surface", "#161a1d"],
  ["raised", "bg-raised", "#21272b"],
  ["line", "bg-line", "#33383d"],
  ["text", "bg-text", "#f5f3f4"],
  ["muted", "bg-muted", "#b1a7a6"],
  ["dust", "bg-dust", "#d3d3d3"],
  ["accent", "bg-accent", "#b6db00"],
  ["accent-deep", "bg-accent-deep", "#8eaf00"],
  ["warning", "bg-warning", "#c9a24a"],
  ["success", "bg-success", "#15a33b"],
  ["danger", "bg-danger", "#a4161a"],
];

function Section({ title, hint, children }) {
  return (
    <section className="space-y-3">
      <div>
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

      <Section title="Farben" hint="Alle Farbwerte als Tokens in src/styles/theme.css.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SWATCHES.map(([name, bg, hex]) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border border-line bg-surface p-2"
            >
              <span className={`h-6 w-6 shrink-0 rounded ${bg}`} />
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
          <ProgressBar label="More Traits" value={2410} max={4812} showValue color="accent" />
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
