import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button, IconButton, Input, Select } from "@/components/ui";
import type { CustomFieldDraft, CustomFieldType } from "@/features/checkout-form/types";

/**
 * The builder for one merchant-authored question.
 *
 * Order is changed with up/down buttons rather than drag-and-drop: it needs no
 * dependency, it works with a keyboard and a screen reader without extra work,
 * and with at most five questions dragging buys nothing.
 *
 * The position number is shown because order is the one property of a question
 * that is invisible in its own row — the merchant is arranging what the shopper
 * reads top to bottom, and "Question 2" is how they know what they are moving.
 */
export function CustomFieldEditor({
  field,
  index,
  total,
  types,
  maxOptions,
  maxLabelLength,
  t,
  onChange,
  onMove,
  onRemove,
}: {
  field: CustomFieldDraft;
  index: number;
  total: number;
  types: CustomFieldType[];
  maxOptions: number;
  maxLabelLength: number;
  t: (key: string) => string;
  onChange: (next: CustomFieldDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const options = field.options ?? [];

  function setOption(optionIndex: number, value: string) {
    const next = [...options];
    next[optionIndex] = value;
    onChange({ ...field, options: next });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="flex size-5 items-center justify-center rounded-md bg-card text-[11px] font-bold text-foreground shadow-xs ring-1 ring-border/60">
            {index + 1}
          </span>
          {t("custom.question_n").replace("{n}", String(index + 1))}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            type="button"
            aria-label={t("custom.move_up")}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={14} />
          </IconButton>
          <IconButton
            type="button"
            aria-label={t("custom.move_down")}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={14} />
          </IconButton>
          <IconButton type="button" aria-label={t("custom.remove")} onClick={onRemove}>
            <Trash2 size={14} className="text-destructive" />
          </IconButton>
        </div>
      </header>

      <div className="space-y-3 p-3.5">
        <Input
          aria-label={t("custom.label")}
          value={field.label}
          maxLength={maxLabelLength}
          placeholder={t("custom.label_placeholder")}
          onChange={(event) => onChange({ ...field, label: event.target.value })}
          className="font-medium"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("custom.type")}
            size="sm"
            value={field.type}
            onChange={(event) => {
              const type = event.target.value as CustomFieldType;
              onChange({
                ...field,
                type,
                // A list needs somewhere to type the first choice; every other
                // type must send no choices at all, or the server refuses it.
                options: type === "select" ? (options.length > 0 ? options : [""]) : undefined,
              });
            }}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`custom.type_${type}`)}
              </option>
            ))}
          </Select>

          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              field.required
                ? "border-primary/40 bg-primary/6 text-foreground"
                : "border-border/80 bg-card text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <input
              type="checkbox"
              className="size-3.5 rounded border-border"
              checked={field.required}
              onChange={(event) => onChange({ ...field, required: event.target.checked })}
            />
            {t("custom.required")}
          </label>
        </div>

        {field.type === "select" && (
          <div className="space-y-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("custom.options")}
            </span>
            {options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-1.5">
                <Input
                  aria-label={`${t("custom.option_placeholder")} ${optionIndex + 1}`}
                  value={option}
                  placeholder={`${t("custom.option_placeholder")} ${optionIndex + 1}`}
                  onChange={(event) => setOption(optionIndex, event.target.value)}
                />
                <IconButton
                  type="button"
                  aria-label={t("custom.remove_option")}
                  // Never down to zero: a list with no choices cannot be
                  // answered, and the server refuses it.
                  disabled={options.length <= 1}
                  onClick={() =>
                    onChange({ ...field, options: options.filter((_, i) => i !== optionIndex) })
                  }
                >
                  <X size={13} />
                </IconButton>
              </div>
            ))}
            {options.length < maxOptions && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...field, options: [...options, ""] })}
                className="gap-1.5"
              >
                <Plus size={13} /> {t("custom.add_option")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
