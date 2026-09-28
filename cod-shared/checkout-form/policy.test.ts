/**
 * The read path. Its whole contract is "never throw, always usable", because it
 * runs on the storefront's order path: a store whose policy blob is unreadable
 * must keep selling with today's form rather than stop taking orders.
 */

import { describe, it, expect } from "vitest";
import {
  CHECKOUT_FORM_LIMITS,
  DEFAULT_CHECKOUT_FORM_POLICY,
  isDefaultCheckoutFormPolicy,
  parseCheckoutFormPolicy,
  serializeCheckoutFormPolicy,
  type CheckoutFormPolicy,
} from "./policy";

const field = (over: Partial<CheckoutFormPolicy["customFields"][number]> = {}) => ({
  id: "cf_abc12345",
  label: "Preferred time",
  type: "text" as const,
  required: false,
  ...over,
});

describe("parseCheckoutFormPolicy — defaults are today's form", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", "   "],
    ["malformed JSON", "{not json"],
    ["a JSON array", "[]"],
    ["a JSON string", '"hello"'],
    ["a JSON number", "42"],
    ["JSON null", "null"],
    ["an empty object", "{}"],
  ])("falls back to the defaults for %s", (_label, input) => {
    expect(parseCheckoutFormPolicy(input as string | null)).toEqual(DEFAULT_CHECKOUT_FORM_POLICY);
  });

  it("defaults describe the storefront as it behaves without this feature", () => {
    // If any of these change, every existing store's checkout changes with it.
    expect(DEFAULT_CHECKOUT_FORM_POLICY).toEqual({
      address: "optional",
      notes: "optional",
      email: "hidden",
      deliveryOptions: { home: true, stopDesk: true },
      customFields: [],
    });
  });

  it("cannot be mutated by a caller", () => {
    expect(() => {
      (DEFAULT_CHECKOUT_FORM_POLICY as { address: string }).address = "required";
    }).toThrow();
  });
});

describe("parseCheckoutFormPolicy — leniency", () => {
  it("keeps valid keys when a sibling key is unreadable", () => {
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({ address: "required", notes: "nonsense", email: 7 }),
    );
    expect(policy.address).toBe("required");
    expect(policy.notes).toBe("optional");
    expect(policy.email).toBe("hidden");
  });

  it("ignores unknown keys so a newer deploy's policy still parses", () => {
    // Rollback safety: an older Worker must read a blob written by a newer one.
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({ email: "required", giftMessage: "required", version: 9 }),
    );
    expect(policy.email).toBe("required");
    expect(policy).not.toHaveProperty("giftMessage");
  });

  it("reads a hidden address — a merchant may take it by phone instead", () => {
    // The dispatch guard, not the policy, is what stops a home parcel leaving
    // without one; the read path must return what the merchant saved.
    expect(parseCheckoutFormPolicy(JSON.stringify({ address: "hidden" })).address).toBe("hidden");
  });

  it("falls back to the default for a state the registry does not allow", () => {
    expect(parseCheckoutFormPolicy(JSON.stringify({ address: "sometimes" })).address).toBe(
      "optional",
    );
  });

  it("repairs a policy with no delivery option left on", () => {
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({ deliveryOptions: { home: false, stopDesk: false } }),
    );
    expect(policy.deliveryOptions).toEqual({ home: true, stopDesk: true });
  });

  it("reads one disabled delivery option", () => {
    expect(
      parseCheckoutFormPolicy(JSON.stringify({ deliveryOptions: { stopDesk: false } }))
        .deliveryOptions,
    ).toEqual({ home: true, stopDesk: false });
  });
});

describe("parseCheckoutFormPolicy — custom fields", () => {
  it("reads a well-formed field", () => {
    const policy = parseCheckoutFormPolicy(JSON.stringify({ customFields: [field()] }));
    expect(policy.customFields).toEqual([field()]);
  });

  it("preserves array order as display order", () => {
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({
        customFields: [
          field({ id: "cf_bbbbbbbb", label: "Second" }),
          field({ id: "cf_aaaaaaaa", label: "First" }),
        ],
      }),
    );
    expect(policy.customFields.map((f) => f.label)).toEqual(["Second", "First"]);
  });

  it.each([
    ["a client-shaped id", field({ id: "my-field" })],
    ["an empty label", field({ label: "   " })],
    ["an over-long label", field({ label: "x".repeat(CHECKOUT_FORM_LIMITS.MAX_LABEL_LENGTH + 1) })],
    ["an unknown type", field({ type: "date" as never })],
    ["a select with no options", field({ type: "select" as const })],
    ["a select with only blank options", field({ type: "select" as const, options: ["", " "] })],
    ["a non-object entry", "nope" as never],
  ])("drops %s", (_label, entry) => {
    expect(parseCheckoutFormPolicy(JSON.stringify({ customFields: [entry] })).customFields).toEqual(
      [],
    );
  });

  it("drops a duplicate id rather than letting two questions share an answer", () => {
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({ customFields: [field({ label: "One" }), field({ label: "Two" })] }),
    );
    expect(policy.customFields).toHaveLength(1);
    expect(policy.customFields[0].label).toBe("One");
  });

  it("caps the list at the documented maximum", () => {
    const many = Array.from({ length: CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS + 3 }, (_, i) =>
      field({ id: `cf_0000000${i}`, label: `Field ${i}` }),
    );
    expect(
      parseCheckoutFormPolicy(JSON.stringify({ customFields: many })).customFields,
    ).toHaveLength(CHECKOUT_FORM_LIMITS.MAX_CUSTOM_FIELDS);
  });

  it("de-duplicates and trims select options", () => {
    const policy = parseCheckoutFormPolicy(
      JSON.stringify({
        customFields: [field({ type: "select" as const, options: [" Red ", "Red", "Blue"] })],
      }),
    );
    expect(policy.customFields[0].options).toEqual(["Red", "Blue"]);
  });
});

describe("serialize / isDefault", () => {
  it("round-trips a customised policy", () => {
    const policy: CheckoutFormPolicy = {
      address: "required",
      notes: "hidden",
      email: "required",
      deliveryOptions: { home: true, stopDesk: false },
      customFields: [field({ type: "select", options: ["A", "B"] })],
    };
    expect(parseCheckoutFormPolicy(serializeCheckoutFormPolicy(policy))).toEqual(policy);
  });

  it("writes a stable key order, so a no-op save is a no-op diff", () => {
    const a = serializeCheckoutFormPolicy(DEFAULT_CHECKOUT_FORM_POLICY);
    const b = serializeCheckoutFormPolicy(parseCheckoutFormPolicy(a));
    expect(a).toBe(b);
  });

  it("recognises the defaults, so the column can go back to NULL", () => {
    expect(isDefaultCheckoutFormPolicy(DEFAULT_CHECKOUT_FORM_POLICY)).toBe(true);
    expect(
      isDefaultCheckoutFormPolicy({ ...DEFAULT_CHECKOUT_FORM_POLICY, email: "optional" }),
    ).toBe(false);
    expect(
      isDefaultCheckoutFormPolicy({ ...DEFAULT_CHECKOUT_FORM_POLICY, customFields: [field()] }),
    ).toBe(false);
  });
});
