import { Info, TriangleAlert } from "lucide-react";
import { NoIcon, YesIcon } from "./Icons.jsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Toast — einheitliche, selbst-verschwindende Notification unten rechts für
 * ALLE Hinweise der Oberfläche (Erfolg, Fehler, Warnung, Info).
 * `ToastProvider` einmal um die App legen, dann `const toast = useToast()` und
 * `toast("success" | "error" | "warning" | "info", "Text")`. Gleicher Text
 * ersetzt einen bereits sichtbaren Toast (Timer startet neu) statt zu stapeln.
 */
const ToastContext = createContext(() => {});

// Rahmen in der Tonfarbe, Icon in der Tonfarbe, Text bleibt hell — wie die
// übrigen Karten/Pillen der App (bg-surface, border-line, text-ui).
const TONE_CLASS = {
  success: "border-success/40",
  error: "border-danger/40",
  warning: "border-warning/40",
  info: "border-line",
};

const TONE_ICON = {
  success: { Icon: YesIcon, className: "text-success" },
  error: { Icon: NoIcon, className: "text-danger" },
  warning: { Icon: TriangleAlert, className: "text-warning" },
  info: { Icon: Info, className: "text-accent" },
};

// Fehler und Warnungen bleiben länger stehen als Bestätigungen.
const DURATION = { success: 5000, info: 5000, warning: 10000, error: 10000 };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toastsRef = useRef([]);
  const nextId = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    toastsRef.current = toastsRef.current.filter((t) => t.id !== id);
    setToasts(toastsRef.current);
  }, []);

  const toast = useCallback(
    (kind, text) => {
      if (!text) return;
      const tone = TONE_CLASS[kind] ? kind : "info";
      const existing = toastsRef.current.find((t) => t.text === text && t.kind === tone);
      const id = existing ? existing.id : ++nextId.current;
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), DURATION[tone]));
      if (!existing) {
        toastsRef.current = [...toastsRef.current, { id, kind: tone, text }];
        setToasts(toastsRef.current);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        {toasts.map((t) => {
          const { Icon, className } = TONE_ICON[t.kind];
          return (
            <button
              key={t.id}
              onClick={() => dismiss(t.id)}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-fit max-w-[40rem] cursor-pointer items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left text-ui font-semibold text-text shadow-[0_8px_24px_rgba(0,0,0,0.5)] ${TONE_CLASS[t.kind]}`}
            >
              <Icon size={16} className={`shrink-0 ${className}`} />
              <span>{t.text}</span>
            </button>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
