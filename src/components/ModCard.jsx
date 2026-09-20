import { memo } from "react";
import ProgressBar from "./ProgressBar.jsx";
import Tag from "./Tag.jsx";

const STATUS_TAG = {
  open: { tone: "warning", label: "Open" },
  translated: { tone: "success", label: "Translated" },
  review: { tone: "accent", label: "Needs Review" },
};

/**
 * ModCard — die Kachel aus dem Figma-Redesign (grid-tile): Poster + Name +
 * Fortschrittsbalken mit Prozent + Status-/Dateien-Tags. Wird sowohl im
 * Mods-Grid als auch in der Editor-Sidebar verwendet — dort identisch
 * aufgebaut (nur der äußere Container unterscheidet sich).
 *
 * `id`/`onToggle` statt eines fertigen `onClick` — so bleibt die Funktion,
 * die App/Mods.jsx reinreicht, über Renders hinweg stabil (useCallback) und
 * React.memo kann nicht betroffene Karten beim Klick einer einzelnen
 * überspringen (bei 400+ Mods sonst spürbar zäh).
 */
function ModCard({ mod, name, status, active = false, locked = false, id, onToggle, className = "" }) {
  const complete = mod.entryCount > 0 && mod.translatedCount >= mod.entryCount;
  return (
    <div
      onClick={() => onToggle(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-100 focus-visible:outline-none focus-visible:border-accent ${
        active && locked
          ? "cursor-default border-muted bg-muted/10"
          : active
            ? "cursor-pointer border-accent bg-accent/10"
            : "cursor-pointer border-line bg-raised hover:border-accent/40"
      } ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {mod.poster && (
            <img
              src={mod.poster}
              alt={name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-text">{name}</p>
          <p className="truncate font-mono text-ui font-medium text-muted">
            {mod.isBaseGame ? "Base Game" : mod.id.split("/")[0]}
          </p>
        </div>
      </div>
      <ProgressBar
        value={mod.translatedCount}
        max={mod.entryCount}
        showPercent
        color={complete ? "success" : "warning"}
      />
      <div className="flex items-center gap-1">
        <Tag tone={STATUS_TAG[status].tone}>{STATUS_TAG[status].label}</Tag>
        <Tag tone="file">
          {mod.filesCount} {mod.filesCount === 1 ? "File" : "Files"}
        </Tag>
      </div>
    </div>
  );
}

export default memo(ModCard);
