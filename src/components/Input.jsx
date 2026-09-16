import { forwardRef } from "react";

/**
 * Input — Label + Eingabefeld. `label` optional, `hint` (kleiner Zeile unter
 * dem Feld) optional. Weiteres (id, value, onChange, ...) via ...rest.
 */
const Input = forwardRef(function Input(
  { label, hint, className = "", ...rest },
  ref,
) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      )}
      <input
        ref={ref}
        className="h-8 w-full rounded-lg border border-line bg-raised px-3 text-ui font-medium text-text placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        {...rest}
      />
      {hint && <span className="mt-1 block text-xs text-muted/80">{hint}</span>}
    </label>
  );
});

export default Input;
