import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { TARGET_LANGS, langLabel, langName } from "../langs.js";

/**
 * LangMultiSelect — Auswahl MEHRERER Zielsprachen (Settings).
 * Bei 27 möglichen Sprachen wäre eine reine Liste unbrauchbar: das Feld zeigt
 * die gewählten Sprachen als Pillen und klappt eine durchsuchbare Liste auf.
 * `value` ist ein Array von Codes, `onChange` bekommt das neue Array.
 * Mindestens eine Sprache bleibt immer gewählt — die letzte lässt sich nicht
 * abwählen (der Rest der App hat sonst keine Zielsprache mehr).
 */
export default function LangMultiSelect({ label, hint, value = [], onChange, locked = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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

  const toggle = (code) => {
    if (value.includes(code)) {
      if (value.length === 1) return; // letzte Sprache bleibt
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code].sort());
    }
  };

  const q = search.trim().toLowerCase();
  const visible = q
    ? TARGET_LANGS.filter(
        (c) => c.toLowerCase().includes(q) || langName(c).toLowerCase().includes(q),
      )
    : TARGET_LANGS;

  return (
    <div className="space-y-2">
      {label && <span className="block text-xs font-medium text-muted">{label}</span>}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => !locked && setOpen((v) => !v)}
          disabled={locked}
          className={`flex min-h-8 w-full items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1 text-left text-ui ${
            locked ? "cursor-default" : "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
            {value.length === 0 ? (
              <span className="text-muted">No language selected</span>
            ) : (
              value.map((code) => (
                <span
                  key={code}
                  className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border border-dust/40 bg-dust/10 px-2 text-xs font-semibold text-dust"
                >
                  {code}
                  {!locked && value.length > 1 && (
                    <X
                      size={11}
                      className="cursor-pointer hover:text-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(code);
                      }}
                      aria-hidden
                    />
                  )}
                </span>
              ))
            )}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
        </button>

        {open && !locked && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
            <div className="border-b border-line p-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search language..."
                autoFocus
                className="h-7 w-full rounded-md border border-line bg-raised px-2 text-xs text-text placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {visible.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted">No language matches this search.</p>
              ) : (
                visible.map((code) => {
                  const on = value.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggle(code)}
                      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                        on ? "text-text" : "text-muted hover:text-text"
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          on ? "border-accent bg-accent text-text-inverse" : "border-line"
                        }`}
                      >
                        {on && <Check size={10} strokeWidth={3} aria-hidden />}
                      </span>
                      {langLabel(code)}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
      {hint && <p className="text-xs text-muted/80">{hint}</p>}
    </div>
  );
}
