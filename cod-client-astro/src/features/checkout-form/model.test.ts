/**
 * The Checkout Form screen's own logic: draft in, payload out, and the reasons a
 * save is blocked before it costs a round trip.
 *
 * None of this is the rule — cod-server decides, and its e2e suite proves it.
 * What these tests pin is that the screen cannot LOSE a merchant's intent on the
 * way: a trimmed label, a dropped id, an `options` array sent for a field that
 * must not have one are all silent corruptions of a save that "worked".
 */

import { describe, it, expect } from "vitest";
import {
  CHECKOUT_FORM_LIMITS,
  DEFAULT_CHECKOUT_FORM_POLICY,
  checkoutFormErrorMessage,
  checkoutFormIssues,
  draftBlockers,
  emptyCustomField,
  isDefaultDraft,
  isDirty,
  moveCustomField,
  toDraft,
  toPayload,
} from "./model";
import type { CheckoutFormDraft, CheckoutFormPolicy } from "./types";

const policy = (over: Partial<CheckoutFormPolicy> = {}): CheckoutFormPolicy => ({
  ...DEFAULT_CHECKOUT_FORM_POLICY,
  deliveryOptions: { ...DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions },
  customFields: [],
  ...over,
});

const draft = (over: Partial<CheckoutFormDraft> = {}): CheckoutFormDraft => ({
  ...toDraft(DEFAULT_CHECKOUT_FORM_POLICY),
  ...over,
});

describe("toDraft / toPayload", () => {
  it("round-trips a saved policy without changing it", () => {
    const saved = policy({
      address: "required",
      notes: "hidden",
      email: "optional",
      deliveryOptions: { home: true, stopDesk: false },
      customFields: [
        { id: "cf_abc12345", label: "Colour", type: "select", required: true, options: ["Red"] },
      ],
    });
    expect(toPayload(toDraft(saved))).toEqual({
      address: "required",
      notes: "hidden",
      email: "optional",
      deliveryOptions: { home: true, stopDesk: false },
      customFields: [
        { id: "cf_abc12345", label: "Colour", type: "select", required: true, options: ["Red"] },
      ],
    });
  });

  it("keeps the id of a field that already exists", () => {
    // Ids key the answer snapshots on existing orders; dropping one here would
    // make the server treat an edit as a brand-new question.
    const saved = policy({
      customFields: [{ id: "cf_abc12345", label: "Time", type: "text", required: false }],
    });
    expect(toPayload(toDraft(saved)).customFields[0].id).toBe("cf_abc12345");
  });

  it("omits the id for a new field, because the server mints it", () => {
    const next = draft({ customFields: [{ ...emptyCustomField(), label: "New" }] });
    expect(toPayload(next).customFields[0]).not.toHaveProperty("id");
  });

  it("trims the label the merchant typed", () => {
    const next = draft({ customFields: [{ ...emptyCustomField(), label: "  Preferred time  " }] });
    expect(toPayload(next).customFields[0].label).toBe("Preferred time");
  });

  it("sends choices only for a dropdown", () => {
    const text = draft({ customFields: [{ ...emptyCustomField("text"), label: "A" }] });
    expect(toPayload(text).customFields[0]).not.toHaveProperty("options");

    const select = draft({
      customFields: [{ ...emptyCustomField("select"), label: "B", options: [" Red ", "", "Blue"] }],
    });
    // Trimmed, and the blank row a merchant left behind is dropped rather than
    // sent as a choice the server would refuse.
    expect(toPayload(select).customFields[0].options).toEqual(["Red", "Blue"]);
  });
});

describe("reordering", () => {
  const three = () => [
    { ...emptyCustomField(), label: "A" },
    { ...emptyCustomField(), label: "B" },
    { ...emptyCustomField(), label: "C" },
  ];

  it("moves a field down", () => {
    expect(moveCustomField(three(), 0, 1).map((f) => f.label)).toEqual(["B", "A", "C"]);
  });

  it("moves a field up", () => {
    expect(moveCustomField(three(), 2, -1).map((f) => f.label)).toEqual(["A", "C", "B"]);
  });

  it("does nothing at either end", () => {
    expect(moveCustomField(three(), 0, -1).map((f) => f.label)).toEqual(["A", "B", "C"]);
    expect(moveCustomField(three(), 2, 1).map((f) => f.label)).toEqual(["A", "B", "C"]);
  });

  it("does nothing for an index that is not there", () => {
    expect(moveCustomField(three(), 9, -1)).toHaveLength(3);
  });
});

describe("draftBlockers", () => {
  it("passes a clean draft", () => {
    expect(draftBlockers(draft())).toEqual([]);
  });

  it("blocks a form with no delivery option", () => {
    expect(draftBlockers(draft({ deliveryOptions: { home: false, stopDesk: false } }))).toEqual([
      "errors.no_delivery_option",
    ]);
  });

  it("blocks an unlabelled question", () => {
    expect(draftBlockers(draft({ customFields: [emptyCustomField()] }))).toContain(
      "errors.label_required",
    );
  });

  it("blocks an over-long label", () => {
    const long = "x".repeat(CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH + 1);
    expect(draftBlockers(draft({ customFields: [{ ...emptyCustomField(), label: long }] })))
      .toContain("errors.label_too_long");
  });

  it("blocks two questions sharing a label", () => {
    const fields = [
      { ...emptyCustomField(), label: "Size" },
      { ...emptyCustomField(), label: " size " },
    ];
    expect(draftBlockers(draft({ customFields: fields }))).toContain("errors.duplicate_label");
  });

  it("blocks a dropdown with no usable choice", () => {
    const fields = [{ ...emptyCustomField("select"), label: "Colour", options: ["  "] }];
    expect(draftBlockers(draft({ customFields: fields }))).toContain("errors.options_required");
  });

  it("blocks duplicate choices", () => {
    const fields = [{ ...emptyCustomField("select"), label: "Colour", options: ["Red", "Red"] }];
    expect(draftBlockers(draft({ customFields: fields }))).toContain("errors.duplicate_options");
  });

  it("blocks more questions than the cap", () => {
    const fields = Array.from({ length: CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({
      ...emptyCustomField(),
      label: `F${i}`,
    }));
    expect(draftBlockers(draft({ customFields: fields }))).toContain("errors.too_many_fields");
  });

  it("reports one blocker per problem, not one per field", () => {
    const fields = [emptyCustomField(), emptyCustomField(), emptyCustomField()];
    const blockers = draftBlockers(draft({ customFields: fields }));
    expect(blockers.filter((b) => b === "errors.label_required")).toHaveLength(1);
  });
});

describe("dirty tracking", () => {
  it("is clean right after loading", () => {
    const saved = policy({ email: "required" });
    expect(isDirty(toDraft(saved), saved)).toBe(false);
  });

  it("notices a changed state", () => {
    const saved = policy();
    expect(isDirty({ ...toDraft(saved), email: "required" }, saved)).toBe(true);
  });

  it("notices a reorder even though nothing else changed", () => {
    const saved = policy({
      customFields: [
        { id: "cf_11111111", label: "A", type: "text", required: false },
        { id: "cf_22222222", label: "B", type: "text", required: false },
      ],
    });
    const reordered = toDraft(saved);
    reordered.customFields = moveCustomField(reordered.customFields, 0, 1);
    expect(isDirty(reordered, saved)).toBe(true);
  });

  it("knows when the draft is the storefront's original form", () => {
    expect(isDefaultDraft(draft())).toBe(true);
    expect(isDefaultDraft(draft({ notes: "hidden" }))).toBe(false);
  });
});

describe("server refusals", () => {
  const refusal = {
    message: "The address field cannot be hidden — carriers need it for home delivery.",
    context: {
      issues: [
        { path: "address", code: "ADDRESS_CANNOT_BE_HIDDEN", message: "carriers need it" },
        { path: "customFields.0.label", code: "INVALID_LABEL", message: "label required" },
      ],
    },
  };

  it("surfaces every issue, so one save fixes them all", () => {
    expect(checkoutFormIssues(refusal)).toHaveLength(2);
    expect(checkoutFormIssues(refusal)[1].path).toBe("customFields.0.label");
  });

  it("prefers the server's own wording over a generic message", () => {
    expect(checkoutFormErrorMessage(refusal, () => "generic")).toBe("carriers need it");
  });

  it("falls back to the error message, then to a translated default", () => {
    expect(checkoutFormErrorMessage({ message: "Network down" }, () => "generic")).toBe(
      "Network down",
    );
    expect(checkoutFormErrorMessage(null, () => "generic")).toBe("generic");
  });

  it("survives a refusal with no issues attached", () => {
    expect(checkoutFormIssues({ message: "boom" })).toEqual([]);
    expect(checkoutFormIssues(undefined)).toEqual([]);
  });
});
