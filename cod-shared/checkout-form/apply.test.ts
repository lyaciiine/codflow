/**
 * Enforcement. Every case here is a thing a real request can do: a shopper on a
 * page the CDN cached before the merchant changed the form, a script posting
 * straight at the API, a field the merchant deleted this morning.
 *
 * The two outcomes are deliberate and tested as a pair — strip when honouring
 * the policy costs the shopper nothing, reject when "fixing" the order would
 * change what the shopper agreed to pay.
 */

import { describe, it, expect } from "vitest";
import {
  applyCheckoutPolicy,
  parseCustomFieldAnswers,
  serializeCustomFieldAnswers,
  type CheckoutFormInput,
} from "./apply";
import {
  CHECKOUT_FORM_LIMITS,
  DEFAULT_CHECKOUT_FORM_POLICY,
  type CheckoutFormPolicy,
  type CustomField,
} from "./policy";

const policyWith = (over: Partial<CheckoutFormPolicy> = {}): CheckoutFormPolicy => ({
  ...DEFAULT_CHECKOUT_FORM_POLICY,
  deliveryOptions: { ...DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions },
  customFields: [],
  ...over,
});

const submit = (over: Partial<CheckoutFormInput> = {}): CheckoutFormInput => ({
  deliveryType: "home",
  ...over,
});

const custom = (over: Partial<CustomField> = {}): CustomField => ({
  id: "cf_abc12345",
  label: "Preferred time",
  type: "text",
  required: false,
  ...over,
});

const responses = (answers: Array<{ id: string; value: unknown }>) => JSON.stringify(answers);

describe("the default policy leaves today's order untouched", () => {
  it("passes name-and-phone-only orders through", () => {
    const result = applyCheckoutPolicy(DEFAULT_CHECKOUT_FORM_POLICY, submit());
    expect(result).toEqual({
      ok: true,
      value: {
        deliveryType: "home",
        address: undefined,
        notes: undefined,
        email: undefined,
        customFieldAnswers: [],
      },
    });
  });

  it("keeps an address and notes exactly as they arrive, trimmed", () => {
    const result = applyCheckoutPolicy(
      DEFAULT_CHECKOUT_FORM_POLICY,
      submit({ address: "  Rue Didouche 12 ", notes: " ring twice " }),
    );
    expect(result.ok && result.value.address).toBe("Rue Didouche 12");
    expect(result.ok && result.value.notes).toBe("ring twice");
  });

  it("drops an email nobody asked for, because the field is hidden by default", () => {
    const result = applyCheckoutPolicy(
      DEFAULT_CHECKOUT_FORM_POLICY,
      submit({ email: "shopper@example.com" }),
    );
    expect(result.ok && result.value.email).toBeUndefined();
  });
});

describe("delivery options", () => {
  it("accepts an option the merchant still offers", () => {
    const policy = policyWith({ deliveryOptions: { home: true, stopDesk: false } });
    expect(applyCheckoutPolicy(policy, submit({ deliveryType: "home" })).ok).toBe(true);
  });

  it("refuses a disabled option instead of silently rewriting it", () => {
    // Rewriting stop_desk to home would change the delivery fee the shopper was
    // shown. Refusing is the same choice the order path already makes when a
    // wilaya has no rate: refuse, never quietly charge something else.
    const policy = policyWith({ deliveryOptions: { home: true, stopDesk: false } });
    const result = applyCheckoutPolicy(policy, submit({ deliveryType: "stop_desk" }));
    expect(result).toEqual({
      ok: false,
      rejection: { code: "DELIVERY_OPTION_UNAVAILABLE", field: "deliveryType" },
    });
  });

  it("refuses a disabled home delivery too", () => {
    const policy = policyWith({ deliveryOptions: { home: false, stopDesk: true } });
    expect(applyCheckoutPolicy(policy, submit({ deliveryType: "home" })).ok).toBe(false);
  });
});

describe("address", () => {
  it("requires it for home delivery when the merchant asked", () => {
    const policy = policyWith({ address: "required" });
    expect(applyCheckoutPolicy(policy, submit({ address: "" }))).toEqual({
      ok: false,
      rejection: { code: "ADDRESS_REQUIRED", field: "address" },
    });
  });

  it("rejects whitespace as an address", () => {
    const policy = policyWith({ address: "required" });
    expect(applyCheckoutPolicy(policy, submit({ address: "   \n " })).ok).toBe(false);
  });

  it("does not require it for a stop-desk order", () => {
    // The parcel is collected at the desk — an address rule there blocks orders
    // without helping a single delivery.
    const policy = policyWith({ address: "required", deliveryOptions: { home: true, stopDesk: true } });
    expect(applyCheckoutPolicy(policy, submit({ deliveryType: "stop_desk", address: "" })).ok).toBe(
      true,
    );
  });

  it("accepts a present address", () => {
    const policy = policyWith({ address: "required" });
    const result = applyCheckoutPolicy(policy, submit({ address: "Cité 5 Juillet" }));
    expect(result.ok && result.value.address).toBe("Cité 5 Juillet");
  });

  it("takes a home order with no address when the field is hidden", () => {
    // The merchant collects it by phone afterwards; the dispatch guard is what
    // keeps the parcel from leaving without one.
    const policy = policyWith({ address: "hidden" });
    const result = applyCheckoutPolicy(policy, submit({ address: "" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.address).toBeUndefined();
  });

  it("strips an address that still arrived while hidden", () => {
    // A page the CDN cached before the change, or a script posting directly.
    const policy = policyWith({ address: "hidden" });
    const result = applyCheckoutPolicy(policy, submit({ address: "12 Rue Didouche" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.address).toBeUndefined();
  });
});

describe("notes", () => {
  it("strips a hidden note that arrived from a stale page", () => {
    const policy = policyWith({ notes: "hidden" });
    const result = applyCheckoutPolicy(policy, submit({ notes: "leave at door" }));
    expect(result.ok && result.value.notes).toBeUndefined();
  });
});

describe("email", () => {
  it("requires it when the merchant made it required", () => {
    const policy = policyWith({ email: "required" });
    expect(applyCheckoutPolicy(policy, submit({ email: "  " }))).toEqual({
      ok: false,
      rejection: { code: "EMAIL_REQUIRED", field: "email" },
    });
  });

  it("normalises what it stores", () => {
    // Stored lowercase and trimmed so the same shopper is the same shopper when
    // digital delivery starts reading this column.
    const policy = policyWith({ email: "optional" });
    const result = applyCheckoutPolicy(policy, submit({ email: "  Shopper@Example.COM " }));
    expect(result.ok && result.value.email).toBe("shopper@example.com");
  });

  it("accepts an absent optional email", () => {
    const policy = policyWith({ email: "optional" });
    const result = applyCheckoutPolicy(policy, submit({ email: null }));
    expect(result.ok && result.value.email).toBeUndefined();
  });

  it.each([
    ["no @", "shopper.example.com"],
    ["no domain dot", "shopper@example"],
    ["a space", "shop per@example.com"],
    ["a trailing comma", "shopper@example.com,"],
    ["only a domain", "@example.com"],
  ])("rejects an address with %s", (_label, email) => {
    const policy = policyWith({ email: "optional" });
    expect(applyCheckoutPolicy(policy, submit({ email }))).toEqual({
      ok: false,
      rejection: { code: "EMAIL_INVALID", field: "email" },
    });
  });

  it("rejects rather than drops an invalid OPTIONAL email", () => {
    // The shopper typed it on purpose; discarding it loses the one thing they
    // meant to give and they never learn it went nowhere.
    const policy = policyWith({ email: "optional" });
    expect(applyCheckoutPolicy(policy, submit({ email: "typo@@example.com" })).ok).toBe(false);
  });

  it("rejects an address past the RFC length", () => {
    const long = `${"a".repeat(CHECKOUT_FORM_LIMITS.MAX_EMAIL_LENGTH)}@example.com`;
    const policy = policyWith({ email: "required" });
    expect(applyCheckoutPolicy(policy, submit({ email: long })).ok).toBe(false);
  });

  it("strips a hidden email even when it is well-formed", () => {
    const policy = policyWith({ email: "hidden" });
    const result = applyCheckoutPolicy(policy, submit({ email: "shopper@example.com" }));
    expect(result.ok && result.value.email).toBeUndefined();
  });
});

describe("custom field answers", () => {
  it("snapshots the answer with the label it had at order time", () => {
    const policy = policyWith({ customFields: [custom()] });
    const result = applyCheckoutPolicy(
      policy,
      submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: " evening " }]) }),
    );
    expect(result.ok && result.value.customFieldAnswers).toEqual([
      { id: "cf_abc12345", label: "Preferred time", type: "text", value: "evening" },
    ]);
  });

  it("returns answers in policy order, not payload order", () => {
    const policy = policyWith({
      customFields: [custom({ id: "cf_11111111", label: "First" }), custom({ id: "cf_22222222", label: "Second" })],
    });
    const result = applyCheckoutPolicy(
      policy,
      submit({
        customFieldResponses: responses([
          { id: "cf_22222222", value: "b" },
          { id: "cf_11111111", value: "a" },
        ]),
      }),
    );
    expect(result.ok && result.value.customFieldAnswers.map((a) => a.label)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("drops an answer for a field the merchant never created", () => {
    // Iterating the policy rather than the payload is what makes a forged field
    // definition unreachable.
    const policy = policyWith({ customFields: [custom()] });
    const result = applyCheckoutPolicy(
      policy,
      submit({
        customFieldResponses: responses([
          { id: "cf_abc12345", value: "ok" },
          { id: "cf_hacker00", value: "injected" },
        ]),
      }),
    );
    expect(result.ok && result.value.customFieldAnswers).toEqual([
      { id: "cf_abc12345", label: "Preferred time", type: "text", value: "ok" },
    ]);
  });

  it("drops an answer for a field deleted since the page was cached", () => {
    const result = applyCheckoutPolicy(
      policyWith(),
      submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: "stale" }]) }),
    );
    expect(result.ok && result.value.customFieldAnswers).toEqual([]);
  });

  it("requires an answer the merchant marked required", () => {
    const policy = policyWith({ customFields: [custom({ required: true })] });
    expect(applyCheckoutPolicy(policy, submit({ customFieldResponses: "[]" }))).toEqual({
      ok: false,
      rejection: {
        code: "CUSTOM_FIELD_REQUIRED",
        field: "cf_abc12345",
        label: "Preferred time",
      },
    });
  });

  it("treats a blank answer to a required field as missing", () => {
    const policy = policyWith({ customFields: [custom({ required: true })] });
    const result = applyCheckoutPolicy(
      policy,
      submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: "   " }]) }),
    );
    expect(result.ok).toBe(false);
  });

  it("omits an unanswered optional field rather than storing an empty row", () => {
    const policy = policyWith({ customFields: [custom()] });
    const result = applyCheckoutPolicy(policy, submit({ customFieldResponses: "[]" }));
    expect(result.ok && result.value.customFieldAnswers).toEqual([]);
  });

  it("accepts a choice from the merchant's list", () => {
    const policy = policyWith({
      customFields: [custom({ type: "select", options: ["Morning", "Evening"] })],
    });
    const result = applyCheckoutPolicy(
      policy,
      submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: "Evening" }]) }),
    );
    expect(result.ok && result.value.customFieldAnswers[0].value).toBe("Evening");
  });

  it("refuses a choice that is not on the list", () => {
    const policy = policyWith({
      customFields: [custom({ type: "select", options: ["Morning", "Evening"] })],
    });
    expect(
      applyCheckoutPolicy(
        policy,
        submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: "Midnight" }]) }),
      ),
    ).toEqual({
      ok: false,
      rejection: {
        code: "CUSTOM_FIELD_INVALID_CHOICE",
        field: "cf_abc12345",
        label: "Preferred time",
      },
    });
  });

  it("refuses a number field that did not get a number", () => {
    const policy = policyWith({ customFields: [custom({ type: "number" })] });
    expect(
      applyCheckoutPolicy(
        policy,
        submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: "soon" }]) }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a numeric answer sent as a JSON number", () => {
    const policy = policyWith({ customFields: [custom({ type: "number" })] });
    const result = applyCheckoutPolicy(
      policy,
      submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: 3 }]) }),
    );
    expect(result.ok && result.value.customFieldAnswers[0].value).toBe("3");
  });

  it.each([
    ["text", CHECKOUT_FORM_LIMITS.MAX_TEXT_ANSWER_LENGTH],
    ["textarea", CHECKOUT_FORM_LIMITS.MAX_TEXTAREA_ANSWER_LENGTH],
  ])("caps a %s answer", (type, limit) => {
    const policy = policyWith({ customFields: [custom({ type: type as "text" | "textarea" })] });
    const atLimit = "x".repeat(limit);
    const overLimit = "x".repeat(limit + 1);
    expect(
      applyCheckoutPolicy(
        policy,
        submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: atLimit }]) }),
      ).ok,
    ).toBe(true);
    expect(
      applyCheckoutPolicy(
        policy,
        submit({ customFieldResponses: responses([{ id: "cf_abc12345", value: overLimit }]) }),
      ),
    ).toEqual({
      ok: false,
      rejection: { code: "CUSTOM_FIELD_TOO_LONG", field: "cf_abc12345", label: "Preferred time" },
    });
  });

  it("accepts an already-parsed array, as the JSON API path sends it", () => {
    const policy = policyWith({ customFields: [custom()] });
    const result = applyCheckoutPolicy(
      policy,
      submit({ customFieldResponses: [{ id: "cf_abc12345", value: "evening" }] }),
    );
    expect(result.ok && result.value.customFieldAnswers[0].value).toBe("evening");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["an object instead of an array", '{"cf_abc12345":"x"}'],
    ["an oversized payload", `["${"x".repeat(CHECKOUT_FORM_LIMITS.MAX_RESPONSES_PAYLOAD_LENGTH)}"]`],
    ["undefined", undefined],
  ])("treats %s as no answers at all", (_label, raw) => {
    const optional = policyWith({ customFields: [custom()] });
    expect(
      applyCheckoutPolicy(optional, submit({ customFieldResponses: raw })).ok,
    ).toBe(true);

    // …and a required field then fails on its own terms, which names the field
    // instead of blaming the payload.
    const required = policyWith({ customFields: [custom({ required: true })] });
    const result = applyCheckoutPolicy(required, submit({ customFieldResponses: raw }));
    expect(!result.ok && result.rejection.code).toBe("CUSTOM_FIELD_REQUIRED");
  });

  it("keeps the first answer when an id is repeated in the payload", () => {
    const policy = policyWith({ customFields: [custom()] });
    const result = applyCheckoutPolicy(
      policy,
      submit({
        customFieldResponses: responses([
          { id: "cf_abc12345", value: "first" },
          { id: "cf_abc12345", value: "second" },
        ]),
      }),
    );
    expect(result.ok && result.value.customFieldAnswers[0].value).toBe("first");
  });
});

describe("answer snapshots", () => {
  it("stores nothing when there are no answers", () => {
    expect(serializeCustomFieldAnswers([])).toBeNull();
  });

  it("round-trips", () => {
    const answers = [
      { id: "cf_abc12345", label: "Preferred time", type: "text" as const, value: "evening" },
    ];
    expect(parseCustomFieldAnswers(serializeCustomFieldAnswers(answers))).toEqual(answers);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["malformed", "{oops"],
    ["not an array", '{"id":"cf_abc12345"}'],
  ])("reads %s as no answers rather than crashing an order page", (_label, raw) => {
    expect(parseCustomFieldAnswers(raw)).toEqual([]);
  });

  it("skips entries missing the fields the dashboard renders", () => {
    expect(parseCustomFieldAnswers('[{"id":"cf_abc12345"},{"id":"cf_b","label":"B","value":"v"}]'))
      .toEqual([{ id: "cf_b", label: "B", type: "text", value: "v" }]);
  });
});
