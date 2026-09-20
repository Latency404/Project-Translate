import { useEffect } from "react";

// Schließt ein offenes Dropdown/Popover bei Klick außerhalb aller `refs`
// oder bei Escape.
export function useDismiss(open, refs, onClose) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (refs.every((r) => r.current && !r.current.contains(e.target))) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
