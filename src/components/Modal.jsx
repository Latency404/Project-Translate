import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Modal — `open` (ja/nein), `onClose`, `title` optional. Inhalt in children.
 * Schließt über X, Backdrop-Klick und Escape.
 */
export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-lg border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-raised hover:text-text cursor-pointer"
            aria-label="Schließen"
          >
            <X size={16} />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
