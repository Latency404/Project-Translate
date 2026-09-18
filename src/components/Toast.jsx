import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Toast — einheitliche, selbst-verschwindende Notification unten rechts für
 * ALLE Hinweise der Oberfläche (Erfolg, Fehler, Warnung, Info).
 * `ToastProvider` einmal um die App legen, dann `const toast = useToast()` und
 * `toast("success" | "error" | "warning" | "info", "Text")`. Gleicher Text
 * ersetzt einen bereits sichtbaren Toast (Timer startet neu) statt zu stapeln.
 */
const ToastContext = createContext(() => {});

const TONE_CLASS = {
  success: "border-success/40 text-success",
  error: "border-danger/40 text-danger",
  warning: "border-warning/40 text-warning",
  info: "border-line text-text",
};

// Fehler und Warnungen bleiben länger stehen als Bestätigungen.
const DURATION = { success: 4000, info: 4000, warning: 8000, error: 8000 };

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
      <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex w-80 max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full cursor-pointer rounded-md border bg-raised px-4 py-2.5 text-left text-sm shadow-lg ${TONE_CLASS[t.kind]}`}
          >
            {t.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
