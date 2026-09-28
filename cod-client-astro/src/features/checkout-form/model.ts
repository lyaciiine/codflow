/**
 * Presentation logic for the Checkout Form screen.
 *
 * The RULES are not here. Which states a field may take, how many custom fields
 * are allowed, what makes a dropdown valid — all of that lives in
 * `cod-shared/checkout-form` and is enforced by cod-server. This file turns a
 * saved policy into an editable draft and back, and answers the questions a
 * screen has that a server does not: is this draft different from what was
 * saved, and can this one be saved at all.
 *
 * Client-side checks here exist so a merchant is never told "no" by a round trip
 * they could have been spared. They are a copy of the server's rules only in the
 * sense that a speed bump is a copy of a wall — the wall still decides.
 *
 * Deliberately avoids importing `@/lib/api`: that module pulls in
 * `astro:env/client`, which resolves only under Astro's pipeline and would drag
 * that requirement into the tests of this pure logic.
 */

import {
  CHECKOUT_FORM_LIMITS,
  DEFAULT_CHECKOUT_FORM_POLICY,
} from "../../../../cod-shared/checkout-form/policy";
import type {
  CheckoutFormDraft,
  CheckoutFormIssue,
  CheckoutFormPolicy,
  CustomFieldDraft,
  CustomFieldType,
} from "./types";

export { CHECKOUT_FORM_LIMITS, DEFAULT_CHECKOUT_FORM_POLICY };

let keySeq = 0;
/** A stable React key for a row that has no server id yet. */
export function newDraftKey(): string {
  keySeq += 1;
  return `draft-${keySeq}`;
}

export function toDraft(policy: CheckoutFormPolicy): CheckoutFormDraft {
  return {
    address: policy.address,
    notes: policy.notes,
    email: policy.email,
    deliveryOptions: { ...policy.deliveryOptions },
    customFields: policy.customFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.options ? { options: [...field.options] } : {}),
      key: field.id,
    })),
  };
}

/**
 * The document to PUT.
 *
 * Trims what the merchant typed, drops `id` for new fields (ids are server
 * owned), and sends `options` only for a dropdown — the server refuses choices
 * on a field that cannot have them, and silently sending an empty array would
 * make a perfectly good save fail.
 */
export function toPayload(draft: CheckoutFormDraft) {
  return {
    address: draft.address,
    notes: draft.notes,
    email: draft.email,
    deliveryOptions: { ...draft.deliveryOptions },
    customFields: draft.customFields.map((field) => ({
      ...(field.id ? { id: field.id } : {}),
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      ...(field.type === "select"
        ? { options: (field.options ?? []).map((option) => option.trim()).filter(Boolean) }
        : {}),
    })),
  };
}

export function emptyCustomField(type: CustomFieldType = "text"): CustomFieldDraft {
  return {
    label: "",
    type,
    required: false,
    ...(type === "select" ? { options: [""] } : {}),
    key: newDraftKey(),
  };
}

/** Moving a field changes which question a shopper is asked first, nothing more. */
export function moveCustomField(
  fields: CustomFieldDraft[],
  index: number,
  direction: -1 | 1,
): CustomFieldDraft[] {
  const target = index + direction;
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Why a draft cannot be saved yet, as translation keys.
 *
 * Keys rather than sentences so the screen stays translatable, and a list rather
 * than a boolean so a merchant sees everything to fix at once — the server
 * reports all its problems together too.
 */
export function draftBlockers(draft: CheckoutFormDraft): string[] {
  const blockers: string[] = [];

  if (!draft.deliveryOptions.home && !draft.deliveryOptions.stopDesk) {
    blockers.push("errors.no_delivery_option");
  }
  if (draft.customFields.length > CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS) {
    blockers.push("errors.too_many_fields");
  }

  const labels = new Set<string>();
  for (const field of draft.customFields) {
    const label = field.label.trim();
    if (!label) {
      blockers.push("errors.label_required");
    } else if (label.length > CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH) {
      blockers.push("errors.label_too_long");
    } else if (labels.has(label.toLocaleLowerCase())) {
      blockers.push("errors.duplicate_label");
    } else {
      labels.add(label.toLocaleLowerCase());
    }

    if (field.type === "select") {
      const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
      if (options.length === 0) blockers.push("errors.options_required");
      else if (new Set(options).size !== options.length) blockers.push("errors.duplicate_options");
      else if (options.length > CHECKOUT_FORM_LIMITS.MAX_OPTIONS) {
        blockers.push("errors.too_many_options");
      }
    }
  }

  // Deduplicated: five empty labels are one thing to fix, not five.
  return [...new Set(blockers)];
}

export function isDirty(draft: CheckoutFormDraft, saved: CheckoutFormPolicy): boolean {
  return JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(toDraft(saved)));
}

/** True when the draft is the platform default — the storefront's original form. */
export function isDefaultDraft(draft: CheckoutFormDraft): boolean {
  return !isDirty(draft, DEFAULT_CHECKOUT_FORM_POLICY);
}

function isApiError(cause: unknown): cause is { message: string; context?: unknown } {
  return typeof cause === "object" && cause !== null && "message" in cause;
}

/**
 * The server's refusal, as something a merchant can act on.
 *
 * `context.issues` carries every problem with its path; showing the first is
 * the honest summary for a toast, and the full list belongs next to the fields.
 */
export function checkoutFormIssues(cause: unknown): CheckoutFormIssue[] {
  if (!isApiError(cause)) return [];
  const context = cause.context as { issues?: unknown } | undefined;
  if (!context || !Array.isArray(context.issues)) return [];
  return context.issues.filter(
    (issue): issue is CheckoutFormIssue =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as CheckoutFormIssue).message === "string",
  );
}

export function checkoutFormErrorMessage(
  cause: unknown,
  t: (key: string) => string,
): string {
  const issues = checkoutFormIssues(cause);
  if (issues.length > 0) return issues[0].message;
  if (isApiError(cause) && cause.message) return cause.message;
  return t("errors.save_failed");
}
