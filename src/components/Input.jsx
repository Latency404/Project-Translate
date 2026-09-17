import { forwardRef } from "react";
import { X } from "lucide-react";

/**
 * Input — Label + Eingabefeld. `label` optional, `hint` (kleiner Zeile unter
 * dem Feld) optional. Weiteres (id, value, onChange, ...) via ...rest.
 * `clearable`: zeigt ein X zum Leeren, solange `value` nicht leer ist.
 */
const Input = forwardRef(function Input(
  { label, hint, className = "", clearable = false, ...rest },
  ref,
) {
  const showClear = clearable && !!rest.value;
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      )}
      <div className="relative">
        <input
          ref={ref}
          className={`h-8 w-full rounded-lg border border-line bg-raised px-3 text-ui font-medium text-text placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${showClear ? "pr-8" : ""}`}
          {...rest}
        />
        {showClear && (
          <button
            type="button"
            onClick={() => rest.onChange?.({ target: { value: "" } })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {hint && <span className="mt-1 block text-xs text-muted/80">{hint}</span>}
    </label>
  );
});

export default Input;
