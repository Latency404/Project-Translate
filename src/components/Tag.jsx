/**
 * Tag — kleines Status-Label (Pille). `tone`: "neutral" | "accent" |
 * "base" (Dust Grey) | "file" (Files-Tag Mod-Kachel) | "warning" | "success"
 * | "danger".
 */
const TONES = {
  neutral: "bg-raised text-muted border-line",
  accent: "bg-accent/15 text-accent border-accent/40",
  base: "bg-dust/10 text-dust border-dust/40",
  file: "bg-file-bg text-dust border-file-border",
  warning: "bg-warning/15 text-warning border-warning/40",
  success: "bg-success/15 text-success border-success/40",
  danger: "bg-danger/15 text-danger border-danger/40",
};

export default function Tag({ tone = "neutral", children, className = "" }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-ui font-semibold ${TONES[tone] ?? TONES.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
