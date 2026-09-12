/**
 * Tag — kleines Status-Label. `tone`: "neutral" | "accent" | "warning" |
 * "success" | "danger".
 */
const TONES = {
  neutral: "bg-raised text-muted border-line",
  accent: "bg-accent/15 text-accent border-accent/40",
  warning: "bg-warning/15 text-warning border-warning/40",
  success: "bg-success/15 text-success border-success/40",
  danger: "bg-danger/15 text-danger border-danger/40",
};

export default function Tag({ tone = "neutral", children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone] ?? TONES.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
