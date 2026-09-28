/**
 * Checkout Form Policy — the write path.
 *
 * Strict by design, and deliberately the mirror image of `parseCheckoutFormPolicy`:
 * reading a stored blob must never throw, but accepting one from a human must
 * refuse everything it does not understand. A settings screen that silently
 * drops a key is how "my changes didn't save" bugs are born, and the merchant
 * has no way to see the difference between ignored and applied.
 *
 * This is also where custom-field ids are minted. Ids are server-owned: an id
 * the client invented is rejected rather than stored, because an order's answer
 * snapshot is keyed by id, and a client that can choose ids can make a new
 * field inherit the history of an old one.
 */

import {
  BUILT_IN_FIELDS,
  CHECKOUT_FORM_LIMITS,
  CUSTOM_FIELD_ID_PATTERN,
  CUSTOM_FIELD_TYPES,
  DEFAULT_CHECKOUT_FORM_POLICY,
  type CheckoutFormPolicy,
  type CustomField,
  type CustomFieldType,
  type FieldState,
} from "./policy";

export type PolicyIssueCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_KEY"
  | "INVALID_STATE"
  | "NO_DELIVERY_OPTION"
  | "TOO_MANY_FIELDS"
  | "INVALID_FIELD"
  | "INVALID_LABEL"
  | "DUPLICATE_LABEL"
  | "INVALID_TYPE"
  | "INVALID_OPTIONS"
  | "UNKNOWN_FIELD_ID"
  | "DUPLICATE_FIELD_ID";

export interface PolicyIssue {
  /** Dot path into the submitted document, e.g. `customFields.2.options`. */
  path: string;
  code: PolicyIssueCode;
  message: string;
}

export type PolicyValidationResult =
  | { ok: true; policy: CheckoutFormPolicy }
  | { ok: false; issues: PolicyIssue[] };

export interface ValidatePolicyOptions {
  /**
   * Ids present in the store's CURRENT stored policy. An incoming id must be
   * one of these; anything else is either a stale editor or a forged id, and
   * both are safer rejected than silently re-minted.
   */
  knownIds: Iterable<string>;
  /** Injectable for deterministic tests. Defaults to `mintCustomFieldId`. */
  mintId?: () => string;
}

const TOP_LEVEL_KEYS = new Set([
  "address",
  "notes",
  "email",
  "deliveryOptions",
  "customFields",
]);
const DELIVERY_KEYS = new Set(["home", "stopDesk"]);
const FIELD_KEYS = new Set(["id", "label", "type", "required", "options"]);

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `cf_` + 8 chars from [a-z0-9]. Matches CUSTOM_FIELD_ID_PATTERN by construction. */
export function mintCustomFieldId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "cf_";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStateStrict(
  raw: Record<string, unknown>,
  key: keyof typeof BUILT_IN_FIELDS,
  issues: PolicyIssue[],
): FieldState {
  const value = raw[key];
  if (value === undefined) return BUILT_IN_FIELDS[key].default;

  const allowed: readonly string[] = BUILT_IN_FIELDS[key].states;
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({
      path: key,
      code: "INVALID_STATE",
      message: `${key} must be one of: ${allowed.join(", ")}`,
    });
    return BUILT_IN_FIELDS[key].default;
  }
  return value as FieldState;
}

function readOptionsStrict(raw: unknown, path: string, issues: PolicyIssue[]): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push({
      path,
      code: "INVALID_OPTIONS",
      message: "A dropdown needs at least one choice.",
    });
    return null;
  }
  if (raw.length > CHECKOUT_FORM_LIMITS.MAX_OPTIONS) {
    issues.push({
      path,
      code: "INVALID_OPTIONS",
      message: `At most ${CHECKOUT_FORM_LIMITS.MAX_OPTIONS} choices.`,
    });
    return null;
  }

  const options: string[] = [];
  for (const entry of raw) {
    const option = typeof entry === "string" ? entry.trim() : "";
    if (!option || option.length > CHECKOUT_FORM_LIMITS.MAX_OPTION_LENGTH) {
      issues.push({
        path,
        code: "INVALID_OPTIONS",
        message: `Each choice must be 1–${CHECKOUT_FORM_LIMITS.MAX_OPTION_LENGTH} characters.`,
      });
      return null;
    }
    // Two identical choices render as two identical rows the shopper cannot
    // tell apart, and the answer would be ambiguous in the dashboard.
    if (options.includes(option)) {
      issues.push({ path, code: "INVALID_OPTIONS", message: "Choices must be unique." });
      return null;
    }
    options.push(option);
  }
  return options;
}

function readCustomFieldStrict(
  raw: unknown,
  index: number,
  ctx: { knownIds: Set<string>; usedIds: Set<string>; labels: Set<string>; mintId: () => string },
  issues: PolicyIssue[],
): CustomField | null {
  const path = `customFields.${index}`;
  if (!isRecord(raw)) {
    issues.push({ path, code: "INVALID_FIELD", message: "Each field must be an object." });
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!FIELD_KEYS.has(key)) {
      issues.push({ path: `${path}.${key}`, code: "UNKNOWN_KEY", message: `Unknown key: ${key}` });
      return null;
    }
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label || label.length > CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH) {
    issues.push({
      path: `${path}.label`,
      code: "INVALID_LABEL",
      message: `A label is required and must be at most ${CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH} characters.`,
    });
    return null;
  }
  // Two questions with the same label produce an answers card the merchant
  // cannot read. Compared case-insensitively because that is how a human reads it.
  const labelKey = label.toLocaleLowerCase();
  if (ctx.labels.has(labelKey)) {
    issues.push({
      path: `${path}.label`,
      code: "DUPLICATE_LABEL",
      message: "Two fields cannot share a label.",
    });
    return null;
  }

  const type = raw.type;
  if (typeof type !== "string" || !CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) {
    issues.push({
      path: `${path}.type`,
      code: "INVALID_TYPE",
      message: `type must be one of: ${CUSTOM_FIELD_TYPES.join(", ")}`,
    });
    return null;
  }

  if (raw.required !== undefined && typeof raw.required !== "boolean") {
    issues.push({
      path: `${path}.required`,
      code: "INVALID_FIELD",
      message: "required must be true or false.",
    });
    return null;
  }

  let id: string;
  if (raw.id === undefined || raw.id === null || raw.id === "") {
    id = ctx.mintId();
  } else if (
    typeof raw.id !== "string" ||
    !CUSTOM_FIELD_ID_PATTERN.test(raw.id) ||
    !ctx.knownIds.has(raw.id)
  ) {
    // Either invented client-side or left over from a policy this store no
    // longer has. Minting silently would quietly re-point an id that old order
    // snapshots are keyed by, so it is refused instead.
    issues.push({
      path: `${path}.id`,
      code: "UNKNOWN_FIELD_ID",
      message: "Unknown field id — omit it to create a new field.",
    });
    return null;
  } else {
    id = raw.id;
  }

  if (ctx.usedIds.has(id)) {
    issues.push({
      path: `${path}.id`,
      code: "DUPLICATE_FIELD_ID",
      message: "The same field appears twice.",
    });
    return null;
  }

  const field: CustomField = {
    id,
    label,
    type: type as CustomFieldType,
    required: raw.required === true,
  };

  if (field.type === "select") {
    const options = readOptionsStrict(raw.options, `${path}.options`, issues);
    if (!options) return null;
    field.options = options;
  } else if (raw.options !== undefined) {
    issues.push({
      path: `${path}.options`,
      code: "INVALID_OPTIONS",
      message: "Only a dropdown can have choices.",
    });
    return null;
  }

  ctx.usedIds.add(id);
  ctx.labels.add(labelKey);
  return field;
}

/**
 * Validate a policy document submitted by the dashboard and mint ids for new
 * custom fields.
 *
 * PUT semantics: the document replaces the whole policy, so a key the caller
 * omits takes its default rather than keeping the stored value. That keeps
 * "what I see is what is saved" true for a screen that always sends the whole
 * form, and it means the defaults can never be reached only by a DELETE.
 */
export function validateCheckoutFormPolicyInput(
  input: unknown,
  options: ValidatePolicyOptions,
): PolicyValidationResult {
  const issues: PolicyIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: "", code: "NOT_AN_OBJECT", message: "Expected a policy object." }],
    };
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({ path: key, code: "UNKNOWN_KEY", message: `Unknown key: ${key}` });
    }
  }

  const address = readStateStrict(input, "address", issues) as CheckoutFormPolicy["address"];
  const notes = readStateStrict(input, "notes", issues) as CheckoutFormPolicy["notes"];
  const email = readStateStrict(input, "email", issues);

  let home = DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions.home;
  let stopDesk = DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions.stopDesk;
  if (input.deliveryOptions !== undefined) {
    if (!isRecord(input.deliveryOptions)) {
      issues.push({
        path: "deliveryOptions",
        code: "INVALID_FIELD",
        message: "deliveryOptions must be an object.",
      });
    } else {
      for (const key of Object.keys(input.deliveryOptions)) {
        if (!DELIVERY_KEYS.has(key)) {
          issues.push({
            path: `deliveryOptions.${key}`,
            code: "UNKNOWN_KEY",
            message: `Unknown key: ${key}`,
          });
        }
      }
      const rawHome = input.deliveryOptions.home;
      const rawStopDesk = input.deliveryOptions.stopDesk;
      if (rawHome !== undefined && typeof rawHome !== "boolean") {
        issues.push({
          path: "deliveryOptions.home",
          code: "INVALID_FIELD",
          message: "home must be true or false.",
        });
      }
      if (rawStopDesk !== undefined && typeof rawStopDesk !== "boolean") {
        issues.push({
          path: "deliveryOptions.stopDesk",
          code: "INVALID_FIELD",
          message: "stopDesk must be true or false.",
        });
      }
      home = rawHome === undefined ? true : rawHome === true;
      stopDesk = rawStopDesk === undefined ? true : rawStopDesk === true;
      if (!home && !stopDesk) {
        // A form with no delivery option cannot be submitted by anyone. The
        // dashboard blocks this too, but the API is a trust boundary of its own.
        issues.push({
          path: "deliveryOptions",
          code: "NO_DELIVERY_OPTION",
          message: "At least one delivery option must stay on.",
        });
      }
    }
  }

  const customFields: CustomField[] = [];
  if (input.customFields !== undefined) {
    if (!Array.isArray(input.customFields)) {
      issues.push({
        path: "customFields",
        code: "INVALID_FIELD",
        message: "customFields must be an array.",
      });
    } else if (input.customFields.length > CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS) {
      issues.push({
        path: "customFields",
        code: "TOO_MANY_FIELDS",
        message: `At most ${CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS} custom fields.`,
      });
    } else {
      const ctx = {
        knownIds: new Set(options.knownIds),
        usedIds: new Set<string>(),
        labels: new Set<string>(),
        mintId: options.mintId ?? mintCustomFieldId,
      };
      input.customFields.forEach((entry, index) => {
        const field = readCustomFieldStrict(entry, index, ctx, issues);
        if (field) customFields.push(field);
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    policy: { address, notes, email, deliveryOptions: { home, stopDesk }, customFields },
  };
}
