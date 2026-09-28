/**
 * The write path. Strict where the read path is lenient, because the two answer
 * different questions: "can this store still sell?" versus "did the merchant
 * mean this?". A save that quietly drops what it does not understand is how a
 * settings screen lies to the person using it.
 */

import { describe, it, expect } from "vitest";
import { CHECKOUT_FORM_LIMITS, CUSTOM_FIELD_ID_PATTERN } from "./policy";
import { mintCustomFieldId, validateCheckoutFormPolicyInput } from "./validate";

/** Deterministic ids so a test can assert exactly which field got which id. */
function sequentialIds() {
  let n = 0;
  return () => `cf_mint000${n++}`;
}

const validate = (input: unknown, knownIds: string[] = []) =>
  validateCheckoutFormPolicyInput(input, { knownIds, mintId: sequentialIds() });

const codes = (result: ReturnType<typeof validate>) =>
  result.ok ? [] : result.issues.map((issue) => issue.code);

describe("shape", () => {
  it.each([
    ["a string", "policy"],
    ["an array", []],
    ["null", null],
    ["a number", 3],
  ])("rejects %s", (_label, input) => {
    expect(codes(validate(input))).toEqual(["NOT_AN_OBJECT"]);
  });

  it("accepts an empty document as 'reset to the defaults' (PUT replaces)", () => {
    const result = validate({});
    expect(result.ok && result.policy).toEqual({
      address: "optional",
      notes: "optional",
      email: "hidden",
      deliveryOptions: { home: true, stopDesk: true },
      customFields: [],
    });
  });

  it("rejects an unknown top-level key instead of ignoring it", () => {
    // The mirror of the read path: a typo here must not vanish silently.
    expect(codes(validate({ email: "optional", giftWrap: "required" }))).toEqual(["UNKNOWN_KEY"]);
  });

  it("rejects an unknown key inside a custom field", () => {
    expect(
      codes(validate({ customFields: [{ label: "A", type: "text", colour: "red" }] })),
    ).toEqual(["UNKNOWN_KEY"]);
  });
});

describe("built-in states", () => {
  it("accepts every state the registry allows", () => {
    const result = validate({ address: "required", notes: "hidden", email: "required" });
    expect(result.ok && result.policy.address).toBe("required");
    expect(result.ok && result.policy.notes).toBe("hidden");
    expect(result.ok && result.policy.email).toBe("required");
  });

  it("accepts a hidden address", () => {
    const result = validate({ address: "hidden" });
    expect(result.ok && result.policy.address).toBe("hidden");
  });

  it.each([
    ["notes", "required"],
    ["email", "sometimes"],
    ["address", 5],
  ])("rejects an invalid state for %s", (key, value) => {
    expect(codes(validate({ [key]: value }))).toEqual(["INVALID_STATE"]);
  });
});

describe("delivery options", () => {
  it("accepts one option turned off", () => {
    const result = validate({ deliveryOptions: { home: true, stopDesk: false } });
    expect(result.ok && result.policy.deliveryOptions).toEqual({ home: true, stopDesk: false });
  });

  it("refuses a form nobody could submit", () => {
    expect(codes(validate({ deliveryOptions: { home: false, stopDesk: false } }))).toEqual([
      "NO_DELIVERY_OPTION",
    ]);
  });

  it("rejects non-boolean switches rather than coercing them", () => {
    // "false" as a string is truthy in JS — the schema is what has to refuse it.
    expect(codes(validate({ deliveryOptions: { home: "false" } }))).toContain("INVALID_FIELD");
  });

  it("rejects an unknown delivery key", () => {
    expect(codes(validate({ deliveryOptions: { drone: true } }))).toEqual(["UNKNOWN_KEY"]);
  });
});

describe("custom fields", () => {
  it("mints an id for a new field", () => {
    const result = validate({ customFields: [{ label: "Preferred time", type: "text" }] });
    expect(result.ok && result.policy.customFields[0]).toEqual({
      id: "cf_mint0000",
      label: "Preferred time",
      type: "text",
      required: false,
    });
  });

  it("keeps an id the store already has", () => {
    const result = validate(
      { customFields: [{ id: "cf_abc12345", label: "Renamed", type: "text" }] },
      ["cf_abc12345"],
    );
    expect(result.ok && result.policy.customFields[0].id).toBe("cf_abc12345");
    expect(result.ok && result.policy.customFields[0].label).toBe("Renamed");
  });

  it("rejects an id the client invented", () => {
    // Ids key the answer snapshots on existing orders; a client that can choose
    // one can make a new question inherit an old question's history.
    expect(codes(validate({ customFields: [{ id: "cf_zzzzzzzz", label: "A", type: "text" }] })))
      .toEqual(["UNKNOWN_FIELD_ID"]);
  });

  it("rejects an id that is not server-shaped", () => {
    expect(
      codes(validate({ customFields: [{ id: "../etc", label: "A", type: "text" }] }, ["../etc"])),
    ).toEqual(["UNKNOWN_FIELD_ID"]);
  });

  it("rejects the same field twice", () => {
    const input = {
      customFields: [
        { id: "cf_abc12345", label: "One", type: "text" },
        { id: "cf_abc12345", label: "Two", type: "text" },
      ],
    };
    expect(codes(validate(input, ["cf_abc12345"]))).toContain("DUPLICATE_FIELD_ID");
  });

  it("rejects two fields sharing a label, case-insensitively", () => {
    expect(
      codes(
        validate({
          customFields: [
            { label: "Size", type: "text" },
            { label: " size ", type: "text" },
          ],
        }),
      ),
    ).toEqual(["DUPLICATE_LABEL"]);
  });

  it.each([
    ["a missing label", { type: "text" }],
    ["a blank label", { label: "   ", type: "text" }],
    [
      "an over-long label",
      { label: "x".repeat(CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH + 1), type: "text" },
    ],
  ])("rejects %s", (_label, entry) => {
    expect(codes(validate({ customFields: [entry] }))).toEqual(["INVALID_LABEL"]);
  });

  it("rejects an unknown type", () => {
    expect(codes(validate({ customFields: [{ label: "A", type: "date" }] }))).toEqual([
      "INVALID_TYPE",
    ]);
  });

  it("rejects a non-boolean required", () => {
    expect(codes(validate({ customFields: [{ label: "A", type: "text", required: "yes" }] })))
      .toEqual(["INVALID_FIELD"]);
  });

  it("accepts a dropdown with choices", () => {
    const result = validate({
      customFields: [{ label: "Colour", type: "select", options: [" Red ", "Blue"], required: true }],
    });
    expect(result.ok && result.policy.customFields[0]).toEqual({
      id: "cf_mint0000",
      label: "Colour",
      type: "select",
      required: true,
      options: ["Red", "Blue"],
    });
  });

  it.each([
    ["no options", { label: "C", type: "select" }],
    ["an empty options array", { label: "C", type: "select", options: [] }],
    ["a blank choice", { label: "C", type: "select", options: ["A", " "] }],
    ["duplicate choices", { label: "C", type: "select", options: ["A", "A"] }],
    [
      "an over-long choice",
      {
        label: "C",
        type: "select",
        options: ["x".repeat(CHECKOUT_FORM_LIMITS.MAX_OPTION_LENGTH + 1)],
      },
    ],
    [
      "too many choices",
      {
        label: "C",
        type: "select",
        options: Array.from({ length: CHECKOUT_FORM_LIMITS.MAX_OPTIONS + 1 }, (_, i) => `o${i}`),
      },
    ],
  ])("rejects a dropdown with %s", (_label, entry) => {
    expect(codes(validate({ customFields: [entry] }))).toEqual(["INVALID_OPTIONS"]);
  });

  it("rejects choices on a field that is not a dropdown", () => {
    expect(codes(validate({ customFields: [{ label: "A", type: "text", options: ["x"] }] })))
      .toEqual(["INVALID_OPTIONS"]);
  });

  it("rejects more fields than the cap", () => {
    const many = Array.from({ length: CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({
      label: `Field ${i}`,
      type: "text",
    }));
    expect(codes(validate({ customFields: many }))).toEqual(["TOO_MANY_FIELDS"]);
  });

  it("rejects customFields that is not an array", () => {
    expect(codes(validate({ customFields: { label: "A" } }))).toEqual(["INVALID_FIELD"]);
  });

  it("reports every problem at once, so one save fixes them all", () => {
    const result = validate({ email: "sometimes", deliveryOptions: { home: false, stopDesk: false } });
    expect(codes(result)).toEqual(["INVALID_STATE", "NO_DELIVERY_OPTION"]);
  });
});

describe("mintCustomFieldId", () => {
  it("always produces a server-shaped id", () => {
    for (let i = 0; i < 200; i++) {
      expect(mintCustomFieldId()).toMatch(CUSTOM_FIELD_ID_PATTERN);
    }
  });

  it("does not collide across a realistic number of fields", () => {
    const ids = new Set(Array.from({ length: 500 }, () => mintCustomFieldId()));
    expect(ids.size).toBe(500);
  });
});
