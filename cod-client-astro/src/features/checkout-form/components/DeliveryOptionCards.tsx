import { Check, Home, Store } from "lucide-react";

/**
 * The delivery options, as selectable cards.
 *
 * Cards rather than checkboxes because they mirror what the shopper actually
 * sees on the storefront — the merchant is choosing which of those two cards
 * exists, and a list of tickboxes hides that connection.
 *
 * The last option left on cannot be switched off. Preventing the state is better
 * than reporting it: a form with no delivery option takes no orders at all, so
 * there is no moment where letting the merchant reach it helps them. The server
 * refuses it too — the API is its own trust boundary — but nobody should have to
 * be told by an error what the screen could simply not offer.
 */
export function DeliveryOptionCards({
  value,
  onChange,
  homeLabel,
  stopDeskLabel,
  lastOneHint,
}: {
  value: { home: boolean; stopDesk: boolean };
  onChange: (next: { home: boolean; stopDesk: boolean }) => void;
  homeLabel: string;
  stopDeskLabel: string;
  lastOneHint: string;
}) {
  const enabledCount = (value.home ? 1 : 0) + (value.stopDesk ? 1 : 0);

  const options = [
    { key: "home", label: homeLabel, icon: Home, on: value.home },
    { key: "stopDesk", label: stopDeskLabel, icon: Store, on: value.stopDesk },
  ] as const;

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ key, label, icon: Icon, on }) => {
          const isLastOn = on && enabledCount === 1;
          return (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={label}
              disabled={isLastOn}
              title={isLastOn ? lastOneHint : undefined}
              onClick={() => onChange({ ...value, [key]: !on })}
              className={`group relative flex items-center gap-3 rounded-xl border p-3.5 text-start transition-all ${
                on
                  ? "border-primary/40 bg-primary/5 shadow-xs"
                  : "border-border/80 bg-card hover:border-input hover:bg-muted/40"
              } ${isLastOn ? "cursor-default" : ""}`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm font-semibold ${
                    on ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </span>
              {on && (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {enabledCount === 1 && <p className="text-xs text-muted-foreground">{lastOneHint}</p>}
    </div>
  );
}
