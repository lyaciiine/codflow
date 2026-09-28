/**
 * Checkout Form Policy — enforcement on the order path.
 *
 * One pure function turns "what the shopper posted" into "what the merchant's
 * policy allows", or into a rejection. It is pure on purpose: the storefront
 * order handler is already the busiest code path in the product, and every rule
 * here is testable without a database, a request, or a store.
 *
 * Why a function in the handler rather than a smarter request schema: the route
 * validates `storeOrderSchema` BEFORE the handler runs (cod-server route-builder
 * passes it as the OpenAPI body), and zod strips unknown keys. A schema built
 * per-request from the policy would never see a field the static schema had
 * already dropped. So the static schema carries the transport, and the policy is
 * applied here — after the wire is parsed, before anything is priced or written.
 *
 * The ordering matters and is asserted by tests: this runs before the delivery
 * fee is resolved, because the fee depends on the delivery type, and a delivery
 * type the merchant disabled must never reach pricing.
 */

import {
  CHECKOUT_FORM_LIMITS,
  type CheckoutFormPolicy,
  type CustomField,
  type CustomFieldType,
} from "./policy";

export type DeliveryType = "home" | "stop_desk";

/** One answer, snapshotted onto the order. */
export interface CustomFieldAnswer {
  id: string;
  /**
   * The label as it read when the order was placed. Stored with the answer
   * because the merchant may rename or delete the field afterwards, and an
   * order must keep reading the way it read on the day it was placed.
   */
  label: string;
  type: CustomFieldType;
  value: string;
}

export interface CheckoutFormInput {
  deliveryType: DeliveryType;
  address?: string | null;
  notes?: string | null;
  email?: string | null;
  /** Raw wire value: a JSON string from the form, or an already-parsed array. */
  customFieldResponses?: unknown;
}

export interface CheckoutFormApplied {
  deliveryType: DeliveryType;
  address?: string;
  notes?: string;
  email?: string;
  customFieldAnswers: CustomFieldAnswer[];
}

export type CheckoutPolicyRejectionCode =
  | "DELIVERY_OPTION_UNAVAILABLE"
  | "ADDRESS_REQUIRED"
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "CUSTOM_FIELD_REQUIRED"
  | "CUSTOM_FIELD_INVALID_CHOICE"
  | "CUSTOM_FIELD_NOT_A_NUMBER"
  | "CUSTOM_FIELD_TOO_LONG";

export interface CheckoutPolicyRejection {
  code: CheckoutPolicyRejectionCode;
  /** Wire field name, for the error context (`address`, `email`, `cf_abc12345`). */
  field: string;
  /** The merchant's label, when the rejection is about a custom field. */
  label?: string;
}

export type CheckoutPolicyResult =
  | { ok: true; value: CheckoutFormApplied }
  | { ok: false; rejection: CheckoutPolicyRejection };

/**
 * Deliberately permissive: one @, something either side, a dot in the domain.
 *
 * A stricter pattern rejects addresses that deliver perfectly well, and the
 * only real test of an address is sending to it. This catches the mistakes a
 * shopper actually makes on a phone keyboard — a missing @, a trailing comma,
 * a bare domain.
 */
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function answerLimitFor(type: CustomFieldType): number {
  return type === "textarea"
    ? CHECKOUT_FORM_LIMITS.MAX_TEXTAREA_ANSWER_LENGTH
    : CHECKOUT_FORM_LIMITS.MAX_TEXT_ANSWER_LENGTH;
}

/**
 * Read the one JSON field custom answers travel in.
 *
 * They travel as a single field because the theme's core action validates form
 * input against a fixed zod whitelist and strips everything else: N flat inputs
 * would each need whitelisting, while one whitelisted JSON field survives any
 * policy the merchant configures.
 *
 * Anything unreadable is treated as "no answers", not as an error. A required
 * field then rejects on its own terms, with a message naming the field, which
 * is far more useful to a shopper than "malformed payload".
 */
function readResponses(raw: unknown): Map<string, string> {
  const answers = new Map<string, string>();

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "" || raw.length > CHECKOUT_FORM_LIMITS.MAX_RESPONSES_PAYLOAD_LENGTH) {
      return answers;
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      return answers;
    }
  }

  if (!Array.isArray(parsed)) return answers;

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, value } = entry as { id?: unknown; value?: unknown };
    if (typeof id !== "string") continue;
    // Numbers arrive as numbers when the payload was built in JS; everything
    // is stored as text, so normalise here rather than in four call sites.
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : "";
    // First writer wins: a duplicated id in the payload cannot overwrite the
    // answer the shopper actually saw first.
    if (!answers.has(id)) answers.set(id, text);
  }

  return answers;
}

function validateAnswer(
  field: CustomField,
  value: string,
): CheckoutPolicyRejection | null {
  if (value.length > answerLimitFor(field.type)) {
    return { code: "CUSTOM_FIELD_TOO_LONG", field: field.id, label: field.label };
  }

  if (field.type === "select" && !(field.options ?? []).includes(value)) {
    // The choices are the merchant's; an answer outside them did not come from
    // the form as rendered.
    return { code: "CUSTOM_FIELD_INVALID_CHOICE", field: field.id, label: field.label };
  }

  if (field.type === "number" && !Number.isFinite(Number(value))) {
    return { code: "CUSTOM_FIELD_NOT_A_NUMBER", field: field.id, label: field.label };
  }

  return null;
}

/**
 * Apply the merchant's policy to one submitted order form.
 *
 * Two shapes of outcome, and which one a rule gets is a deliberate decision:
 *
 *   - STRIP, when honouring the policy costs the shopper nothing. A hidden
 *     notes or email value that still arrives from an edge-cached page is
 *     dropped and the order goes through.
 *   - REJECT, when silently "fixing" the order would change what the shopper
 *     agreed to. A delivery type the merchant turned off is refused rather than
 *     rewritten, because rewriting it changes the delivery fee the shopper was
 *     shown — the same reasoning behind the existing DELIVERY_NOT_AVAILABLE
 *     refusal instead of shipping for free.
 */
export function applyCheckoutPolicy(
  policy: CheckoutFormPolicy,
  input: CheckoutFormInput,
): CheckoutPolicyResult {
  const deliveryType = input.deliveryType;
  const allowed =
    deliveryType === "home" ? policy.deliveryOptions.home : policy.deliveryOptions.stopDesk;
  if (!allowed) {
    return {
      ok: false,
      rejection: { code: "DELIVERY_OPTION_UNAVAILABLE", field: "deliveryType" },
    };
  }

  // Hidden means the storefront renders no address input at all, so anything
  // that still arrives is a stale page or a script posting straight at the API —
  // dropped, like a hidden note or email. The dispatch guard refuses a HOME
  // parcel with no address at the carrier boundary, so the platform never
  // quietly ships one the carrier would bounce (orders/dispatch.ts).
  const address = policy.address === "hidden" ? "" : trimmed(input.address);
  // Home delivery only: a stop-desk parcel is collected at the desk, so an
  // address requirement there would block orders for no delivery benefit.
  if (policy.address === "required" && deliveryType === "home" && address === "") {
    return { ok: false, rejection: { code: "ADDRESS_REQUIRED", field: "address" } };
  }

  const notes = policy.notes === "hidden" ? "" : trimmed(input.notes);

  let email = "";
  if (policy.email !== "hidden") {
    email = trimmed(input.email).toLocaleLowerCase();
    if (email === "") {
      if (policy.email === "required") {
        return { ok: false, rejection: { code: "EMAIL_REQUIRED", field: "email" } };
      }
    } else if (email.length > CHECKOUT_FORM_LIMITS.MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
      // Rejected rather than dropped even when the field is optional: the
      // shopper typed an address, and silently discarding it loses the one
      // thing they meant to give.
      return { ok: false, rejection: { code: "EMAIL_INVALID", field: "email" } };
    }
  }

  const responses = readResponses(input.customFieldResponses);
  const customFieldAnswers: CustomFieldAnswer[] = [];
  // Iterating the POLICY, never the payload, is what makes a forged field
  // definition unreachable: an id the merchant never created is never read.
  for (const field of policy.customFields) {
    const value = trimmed(responses.get(field.id));
    if (value === "") {
      if (field.required) {
        return {
          ok: false,
          rejection: { code: "CUSTOM_FIELD_REQUIRED", field: field.id, label: field.label },
        };
      }
      continue;
    }

    const rejection = validateAnswer(field, value);
    if (rejection) return { ok: false, rejection };

    customFieldAnswers.push({
      id: field.id,
      label: field.label,
      type: field.type,
      value,
    });
  }

  return {
    ok: true,
    value: {
      deliveryType,
      address: address === "" ? undefined : address,
      notes: notes === "" ? undefined : notes,
      email: email === "" ? undefined : email,
      customFieldAnswers,
    },
  };
}

/** Storage shape for `orders.custom_fields_json`. NULL when there is nothing to keep. */
export function serializeCustomFieldAnswers(answers: CustomFieldAnswer[]): string | null {
  return answers.length === 0 ? null : JSON.stringify(answers);
}

/**
 * Read an order's answer snapshot back.
 *
 * Lenient like the policy reader, and for the same reason: a dashboard order
 * page must render even if the column holds something older or odder than the
 * current shape. An unreadable snapshot shows as no answers, never as a crash.
 */
export function parseCustomFieldAnswers(json: string | null | undefined): CustomFieldAnswer[] {
  if (typeof json !== "string" || json.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const answers: CustomFieldAnswer[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, label, type, value } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string" || typeof value !== "string") continue;
    answers.push({
      id,
      label,
      type: (typeof type === "string" ? type : "text") as CustomFieldType,
      value,
    });
  }
  return answers;
}
