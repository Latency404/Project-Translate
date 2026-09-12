/**
 * ProgressBar — `value`/`max` (0..max), `label` optional, `color` =
 * Token-Name ("accent" | "success" | "warning" | "danger"), default "accent".
 * Zeigt bei `showValue` rechts den Wert.
 */
export default function ProgressBar({
  value = 0,
  max = 100,
  label,
  color = "accent",
  showValue = false,
  className = "",
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = {
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[color] ?? "bg-accent";

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-xs">
          {label && <span className="text-muted">{label}</span>}
          {showValue && (
            <span className="font-mono text-text">
              {Math.round(value)} / {Math.round(max)}
            </span>
          )}
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
