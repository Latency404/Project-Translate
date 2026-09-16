/**
 * ProgressBar — `value`/`max` (0..max), `label` optional, `color` =
 * Token-Name ("success" | "warning" | "danger" | "dust"), default "success".
 * "dust" = neutraler Verlauf (z. B. Scan-Fortschritt). accent kommt
 * bewusst NICHT vor — der Akzent-Ton ist auch der Danger-Ton und
 * darf sich nicht in einer Bar kreuzen.
 * `showValue` zeigt darüber "value / max" (mit `label` kombinierbar).
 * `showPercent` zeigt "NN%" — Figma-Layout: rechts NEBEN der Bar, nicht
 * darüber (ModCard-Fortschritt).
 */
export default function ProgressBar({
  value = 0,
  max = 100,
  label,
  color = "success",
  showValue = false,
  showPercent = false,
  className = "",
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    dust: "bg-dust",
  }[color] ?? "bg-success";

  const track = (
    <div
      className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track"
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
  );

  // Figma: Prozent sitzt neben der Bar, nicht als Label darüber.
  if (showPercent && !label && !showValue) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {track}
        <span className="shrink-0 text-ui font-semibold text-muted">{Math.round(pct)}%</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1 flex items-center justify-between text-ui">
          {label && <span className="text-muted">{label}</span>}
          {showValue && (
            <span className="font-mono text-text">
              {Math.round(value)} / {Math.round(max)}
            </span>
          )}
        </div>
      )}
      {track}
    </div>
  );
}
