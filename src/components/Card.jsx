import { forwardRef } from "react";

/**
 * Card — Inhaltsfläche mit Rahmen. `title`/`subtitle` optional,
 * `footer` optional (z. B. Button-Zeile).
 */
const Card = forwardRef(function Card(
  { title, subtitle, footer, className = "", children, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      className={`rounded-lg border border-line bg-surface ${className}`}
      {...rest}
    >
      {(title || subtitle) && (
        <header className="space-y-1 border-b border-line px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </header>
      )}
      <div className={`p-4 ${className}`}>{children}</div>
      {footer && (
        <footer className="border-t border-line px-4 py-3">{footer}</footer>
      )}
    </section>
  );
});

export default Card;
