import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { TARGET_LANGS, langLabel } from "../langs.js";

/**
 * LangSelect — Dropdown für GENAU EINE Sprache (Settings "Active Language",
 * Sprachumschalter in der Navbar). `codes` schränkt die Auswahl ein (Default:
 * alle Zielsprachen), `hint` ist die Zeile darunter, `locked` macht das Feld
 * unbedienbar (ohne Fokus-Rahmen).
 *
 * Bewusst KEIN natives <select>: dessen Optionsliste zeichnet das
 * Betriebssystem, sie ignoriert das dunkle Theme (weißes Windows-Dropdown mit
 * blauer Markierung). Deshalb dieselbe eigene Liste wie in LangMultiSelect.
 *
 * `fieldBox`/`fieldFocus` sind der gemeinsame Feld-Rahmen (auch Pfad-Felder).
 */
export const fieldBox =
  "flex h-8 w-full items-center gap-3 rounded-lg border border-line bg-raised px-3 text-ui";
export const fieldFocus = "focus-within:outline focus-within:outline-2 focus-within:outline-accent";

export default function LangSelect({
  label,
  hint,
  value,
  onChange,
  locked = false,
  codes = TARGET_LANGS,
  className = "",
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <span className="block text-xs font-medium text-muted">{label}</span>}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => !locked && setOpen((v) => !v)}
          disabled={locked}
          className={`${compact ? fieldBox.replace("gap-3", "gap-1.5").replace("px-3", "px-2.5") : fieldBox} ${
            locked
              ? "cursor-default"
              : "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          } justify-between text-left`}
        >
          <span className="min-w-0 flex-1 truncate text-text">{compact ? value : langLabel(value)}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
        </button>

        {open && !locked && (
          <div className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-max min-w-full max-w-[18rem] overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
            <div className="max-h-56 overflow-y-auto py-1">
              {codes.map((code) => {
                const on = code === value;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => pick(code)}
                    className={`flex w-full cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors ${
                      on ? "text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {on && <Check size={11} strokeWidth={3} className="text-accent" aria-hidden />}
                    </span>
                    {langLabel(code)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {hint && <p className="text-xs text-muted/80">{hint}</p>}
    </div>
  );
}
