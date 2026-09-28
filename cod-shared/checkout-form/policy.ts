/**
 * Checkout Form Policy — the single definition.
 *
 * The policy is the merchant's answer to one question: which fields does the
 * storefront order form ask for, and how strictly is each one enforced. It is
 * stored as one JSON blob on `stores.checkout_form_json` and consumed by three
 * callers — cod-server's order path, cod-server's dashboard API, and the
 * dashboard UI. The storefront theme never sees this module: it receives an
 * already-resolved policy in `GET /store/config`, so no form logic can drift
 * into a swappable theme.
 *
 * No zod here on purpose. cod-shared declares exactly one dependency
 * (drizzle-orm) and nothing else, and this module is imported by both apps;
 * hand-rolled parsing keeps that promise and buys two things zod would make
 * awkward anyway:
 *
 *   1. A LENIENT read path and a STRICT write path. Reading must never throw:
 *      a store whose blob was written by a newer deploy (or corrupted by hand)
 *      has to keep selling, so unknown keys are ignored and bad values fall
 *      back to today's behaviour. Writing must refuse the same input, because
 *      a dashboard typo that silently vanishes is how settings "don't save".
 *   2. Precise rejection codes, so the storefront can answer the shopper in
 *      the store's own language (see ./messages.ts).
 *
 * The defaults ARE today's form. A store with `checkout_form_json = NULL`
 * behaves exactly as it did before this feature existed, which is what makes
 * the rollout a no-op and the rollback a single UPDATE.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** How strictly one field is enforced. Not a boolean: merchants need "optional". */
export type FieldState = "required" | "optional" | "hidden";

export type CustomFieldType = "text" | "textarea" | "number" | "select";

/**
 * A merchant-authored question.
 *
 * `id` is minted server-side (never by the client) and is what an order's
 * answer snapshot is keyed by, so renaming a label never orphans history.
 * Display order is the array order — a separate `position` would be a second
 * source of truth for the same fact.
 */
export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  /** `select` only: the choices, in display order. */
  options?: string[];
}

export interface CheckoutFormPolicy {
  /**
   * Asked for home delivery only, and "hidden" is allowed: some merchants take
   * the address by phone after the order lands. Hiding it is safe because the
   * platform closes the loop it opens — dispatching a HOME order with no
   * address is refused (orders/dispatch.ts), and the merchant adds it through
   * the order's edit dialog, which is the same path every other data-entry
   * mistake takes. A stop-desk parcel is collected at the desk and needs none.
   */
  address: FieldState;
  notes: "optional" | "hidden";
  email: FieldState;
  deliveryOptions: { home: boolean; stopDesk: boolean };
  customFields: CustomField[];
}

// ─── Built-in field registry ──────────────────────────────────────────────────

/**
 * The controllable built-ins, defined once.
 *
 * Both the policy parser and the dashboard's editor rows derive from this, so
 * adding a controllable field later is one entry here plus its normaliser and
 * its markup — not an edit in eight files. The fixed fields (customerName,
 * phone, wilayaId, communeId) are deliberately absent: they are not policy.
 * COD dispatch needs name and phone, customer identity is the normalised phone,
 * and the delivery fee is resolved from wilaya → commune. Offering a control
 * for them would only offer a way to break every order.
 */
export const BUILT_IN_FIELDS = {
  address: { states: ["required", "optional", "hidden"], default: "optional" },
  notes: { states: ["optional", "hidden"], default: "optional" },
  email: { states: ["required", "optional", "hidden"], default: "hidden" },
} as const satisfies Record<string, { states: readonly FieldState[]; default: FieldState }>;

export type BuiltInFieldKey = keyof typeof BUILT_IN_FIELDS;

export const BUILT_IN_FIELD_KEYS = Object.keys(BUILT_IN_FIELDS) as BuiltInFieldKey[];

/**
 * Authoring bounds, shared by the dashboard and the server so the two cannot
 * disagree about what "too many" means.
 *
 * MAX_CUSTOM_FIELDS is 5 because the answers ride one order row and every extra
 * question costs conversion on the ad traffic these stores live on; the cap is a
 * product decision, not a storage limit.
 */
export const CHECKOUT_FORM_LIMITS = {
  MAX_CUSTOM_FIELDS: 5,
  MAX_LABEL_LENGTH: 60,
  MAX_OPTIONS: 20,
  MAX_OPTION_LENGTH: 100,
  /** Answer caps, mirroring the built-in text fields (notes is max 500). */
  MAX_TEXT_ANSWER_LENGTH: 200,
  MAX_TEXTAREA_ANSWER_LENGTH: 500,
  /** The whole `customFieldResponses` payload, before parsing. */
  MAX_RESPONSES_PAYLOAD_LENGTH: 4000,
  MAX_EMAIL_LENGTH: 254,
} as const;

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
];

/** Server-minted ids only. The write path rejects anything else. */
export const CUSTOM_FIELD_ID_PATTERN = /^cf_[a-z0-9]{8}$/;

/**
 * Today's form, exactly.
 *
 * Frozen because this object is handed out as the fallback on every read; a
 * caller that mutated it would change every store's defaults for the lifetime
 * of the isolate.
 */
export const DEFAULT_CHECKOUT_FORM_POLICY: CheckoutFormPolicy = {
  address: "optional",
  notes: "optional",
  email: "hidden",
  deliveryOptions: { home: true, stopDesk: true },
  customFields: [],
};
Object.freeze(DEFAULT_CHECKOUT_FORM_POLICY);
Object.freeze(DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions);
Object.freeze(DEFAULT_CHECKOUT_FORM_POLICY.customFields);

// ─── Read path (lenient — never throws) ───────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readState<K extends BuiltInFieldKey>(
  raw: Record<string, unknown>,
  key: K,
): CheckoutFormPolicy[K] {
  const value = raw[key];
  const allowed: readonly FieldState[] = BUILT_IN_FIELDS[key].states;
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? value
      : BUILT_IN_FIELDS[key].default
  ) as CheckoutFormPolicy[K];
}

function readCustomField(raw: unknown): CustomField | null {
  if (!isRecord(raw)) return null;
  const { id, label, type, required, options } = raw;

  if (typeof id !== "string" || !CUSTOM_FIELD_ID_PATTERN.test(id)) return null;
  if (typeof label !== "string") return null;
  const trimmedLabel = label.trim();
  if (!trimmedLabel || trimmedLabel.length > CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH) return null;
  if (typeof type !== "string" || !CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) {
    return null;
  }

  const field: CustomField = {
    id,
    label: trimmedLabel,
    type: type as CustomFieldType,
    required: required === true,
  };

  if (field.type === "select") {
    if (!Array.isArray(options)) return null;
    const cleaned = options
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim())
      .filter(
        (option) => option.length > 0 && option.length <= CHECKOUT_FORM_LIMITS.MAX_OPTION_LENGTH,
      )
      .slice(0, CHECKOUT_FORM_LIMITS.MAX_OPTIONS);
    // A select with no choices cannot be answered, so it cannot be rendered:
    // dropping the field is the only reading that leaves a usable form.
    const unique = [...new Set(cleaned)];
    if (unique.length === 0) return null;
    field.options = unique;
  }

  return field;
}

/**
 * Resolve a stored blob into a usable policy. Never throws, for any input.
 *
 * Per-key leniency is deliberate: one unreadable field falls back to its
 * default rather than discarding the merchant's other settings. Unknown keys
 * are ignored so a policy written by a newer deploy still parses on an older
 * one — a Worker rollback must not take the storefront's form with it.
 */
export function parseCheckoutFormPolicy(json: string | null | undefined): CheckoutFormPolicy {
  if (typeof json !== "string" || json.trim() === "") return DEFAULT_CHECKOUT_FORM_POLICY;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_CHECKOUT_FORM_POLICY;
  }
  if (!isRecord(raw)) return DEFAULT_CHECKOUT_FORM_POLICY;

  const deliveryRaw = isRecord(raw.deliveryOptions) ? raw.deliveryOptions : {};
  const home = deliveryRaw.home !== false;
  const stopDesk = deliveryRaw.stopDesk !== false;

  const seen = new Set<string>();
  const customFields: CustomField[] = [];
  if (Array.isArray(raw.customFields)) {
    for (const entry of raw.customFields) {
      if (customFields.length >= CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS) break;
      const field = readCustomField(entry);
      // A duplicate id would make two questions share one answer slot.
      if (!field || seen.has(field.id)) continue;
      seen.add(field.id);
      customFields.push(field);
    }
  }

  return {
    address: readState(raw, "address"),
    notes: readState(raw, "notes"),
    email: readState(raw, "email"),
    // Both options off leaves a form nobody can submit. Whatever wrote that,
    // the shopper is not the one who should pay for it: fall back to offering
    // both, and let the strict write path be the thing that refuses it.
    deliveryOptions: home || stopDesk ? { home, stopDesk } : { home: true, stopDesk: true },
    customFields,
  };
}

/**
 * True when the policy is byte-for-byte today's behaviour.
 *
 * The save path stores NULL in that case instead of an equivalent blob, so
 * "never customised" and "customised back to the defaults" are the same row
 * state, and the documented rollback (`SET checkout_form_json = NULL`) is also
 * what a merchant can do from the UI.
 */
export function isDefaultCheckoutFormPolicy(policy: CheckoutFormPolicy): boolean {
  return (
    policy.address === DEFAULT_CHECKOUT_FORM_POLICY.address &&
    policy.notes === DEFAULT_CHECKOUT_FORM_POLICY.notes &&
    policy.email === DEFAULT_CHECKOUT_FORM_POLICY.email &&
    policy.deliveryOptions.home &&
    policy.deliveryOptions.stopDesk &&
    policy.customFields.length === 0
  );
}

/** Canonical JSON for storage — key order fixed so a no-op save is a no-op diff. */
export function serializeCheckoutFormPolicy(policy: CheckoutFormPolicy): string {
  return JSON.stringify({
    address: policy.address,
    notes: policy.notes,
    email: policy.email,
    deliveryOptions: {
      home: policy.deliveryOptions.home,
      stopDesk: policy.deliveryOptions.stopDesk,
    },
    customFields: policy.customFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.type === "select" ? { options: field.options ?? [] } : {}),
    })),
  });
}
