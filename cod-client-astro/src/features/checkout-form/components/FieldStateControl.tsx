import { Lock, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import type { FieldState } from "@/features/checkout-form/types";

/**
 * One row of the form editor: what the field is, why it matters, and how
 * strictly it is asked for.
 *
 * A segmented control rather than a switch, because the useful answer is rarely
 * yes/no — "optional" is the state most merchants actually want, and a toggle
 * cannot say it.
 *
 * Locked rows keep the same shape but read as platform-owned: muted, a lock, and
 * a badge where the control would be. A merchant should be able to see that name
 * and phone were considered and held back, not forgotten — otherwise the first
 * assumption is that the page is unfinished.
 */
export function FieldStateControl({
  icon: Icon,
  label,
  hint,
  value,
  states,
  onChange,
  stateLabel,
  locked = false,
  lockedNote,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  value?: FieldState;
  states?: readonly FieldState[];
  onChange?: (state: FieldState) => void;
  stateLabel: (state: FieldState) => string;
  locked?: boolean;
  lockedNote?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 ${
        locked ? "bg-muted/25" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${
            locked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{label}</span>
            {locked && <Lock size={11} className="shrink-0 text-muted-foreground" aria-hidden />}
          </div>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </div>

      {locked || !states || !value ? (
        <Badge tone="neutral" className="shrink-0 self-start sm:self-auto">
          {lockedNote}
        </Badge>
      ) : (
        <div
          role="radiogroup"
          aria-label={label}
          className="flex shrink-0 self-start rounded-lg border border-border/80 bg-muted/40 p-0.5 sm:self-auto"
        >
          {states.map((state) => {
            const active = state === value;
            return (
              <button
                key={state}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange?.(state)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {stateLabel(state)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
