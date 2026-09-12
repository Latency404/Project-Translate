import { forwardRef } from "react";

/**
 * Button — Varianten: "primary" (Akzent), "secondary" (oberflächig), "danger".
 * Größen: "sm" | "md" | "lg". `icon` = optionales Lucide-Icon (Komponente).
 */
const VARIANTS = {
  primary:
    "bg-accent text-text hover:bg-accent-light font-semibold disabled:opacity-50 disabled:hover:bg-accent",
  secondary:
    "bg-raised text-text hover:bg-line border border-line disabled:opacity-50 disabled:hover:bg-raised",
  danger:
    "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 disabled:opacity-50",
};

const SIZES = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", icon: Icon, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-md transition-colors duration-150 select-none cursor-pointer disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} aria-hidden />}
      {children}
    </button>
  );
});

export default Button;
