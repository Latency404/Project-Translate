import { forwardRef } from "react";

/**
 * Button — Varianten: "primary" (Akzent), "secondary" (raised), "dust"
 * (helle Neutral-Fläche, z. B. Lock), "dustActive" (dunkler — Lock im
 * gesperrten Zustand), "danger". Größen: "sm" | "md" | "lg".
 * `icon` = optionales Lucide-Icon (Komponente).
 */
const VARIANTS = {
  primary:
    "bg-accent text-text-inverse hover:bg-accent-light disabled:opacity-50 disabled:hover:bg-accent",
  secondary:
    "bg-raised text-text hover:bg-line disabled:opacity-50 disabled:hover:bg-raised",
  dust:
    "bg-dust text-text-inverse hover:brightness-95 disabled:opacity-50 disabled:hover:brightness-100",
  dustActive:
    "bg-dust/60 text-text-inverse hover:bg-dust/70 disabled:opacity-50",
  danger:
    "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 disabled:opacity-50",
};

const SIZES = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-ui gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", icon: Icon, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg font-semibold leading-none transition-colors duration-150 select-none cursor-pointer disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} className="shrink-0" aria-hidden />}
      {children}
    </button>
  );
});

export default Button;
