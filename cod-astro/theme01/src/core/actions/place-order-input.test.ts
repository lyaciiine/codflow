/**
 * The order form's input whitelist.
 *
 * This schema is the narrowest point in the whole checkout: zod strips every
 * key it does not name, so a field the storefront renders but this schema
 * forgets is dropped here — silently, with a 200, and the merchant only finds
 * out when the data never arrives. The Checkout Form Policy makes that risk
 * permanent rather than one-off, because a merchant can add a field at any time
 * without a theme deploy.
 *
 * So these tests pin both directions: the keys the policy needs survive, and a
 * key nobody declared does not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { placeOrderInput } from "./input";

const base = {
  customerName: "Ahmed Benali",
  phone: "0551234567",
  wilayaId: "16",
  communeId: "c-16-001",
  productId: "prod_1",
  productName: "Galaxy A54",
  pricePerUnit: "2500",
};

const parse = (extra: Record<string, unknown> = {}) => placeOrderInput.parse({ ...base, ...extra });

describe("the keys the Checkout Form Policy depends on", () => {
  it("lets an email through", () => {
    expect(parse({ email: "shopper@example.com" }).email).toBe("shopper@example.com");
  });

  it("lets the custom-field answers through as one JSON string", () => {
    const json = JSON.stringify([{ id: "cf_abc12345", value: "Evening" }]);
    expect(parse({ customFieldResponses: json }).customFieldResponses).toBe(json);
  });

  it("does not validate the email itself", () => {
    // cod-server decides, and answers in the store's language. A rule here
    // would reject first, in this worker's words, and be a second definition
    // of the same rule.
    expect(() => parse({ email: "not-an-email" })).not.toThrow();
  });

  it("turns the empty strings a form always submits into nothing", () => {
    // Every hidden input posts, even when the shopper left it alone, so an
    // untouched field must not arrive as "".
    const parsed = parse({ email: "", customFieldResponses: "" });
    expect(parsed.email).toBeUndefined();
    expect(parsed.customFieldResponses).toBeUndefined();
  });

  it("treats an empty answer array as no answers", () => {
    expect(parse({ customFieldResponses: "[]" }).customFieldResponses).toBeUndefined();
  });

  it("refuses an answer payload past the cap", () => {
    // Bounded here as well as server-side: an unbounded string would be
    // forwarded to cod-server before anything could reject it.
    expect(() => parse({ customFieldResponses: "x".repeat(4001) })).toThrow();
  });
});

describe("every whitelisted field is actually forwarded", () => {
  /**
   * The second silent failure mode, and the one a schema test alone misses: a
   * key passes validation here and is then never passed to `placeOrder`, so it
   * dies one line later with the same 200 and the same missing data. Reading
   * the action's source is the only way to see that from a test — the action
   * itself imports server-only modules and cannot be loaded here.
   */
  it("passes every key from the schema into the API call", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    const call = source.slice(source.indexOf("await placeOrder({"), source.indexOf("}, forwardedHeaders)"));

    const notForwarded = Object.keys(placeOrderInput.shape).filter(
      (key) => !new RegExp(`\\b${key}:`).test(call),
    );
    expect(notForwarded, `whitelisted but never sent to cod-server: ${notForwarded.join(", ")}`)
      .toEqual([]);
  });
});

describe("the whitelist itself", () => {
  it("strips a key nobody declared", () => {
    const parsed = parse({ cf_abc12345: "answered as a flat input" }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("cf_abc12345");
  });

  it("keeps the fields the form has always sent", () => {
    const parsed = parse({
      address: "Rue Didouche 12",
      notes: "ring twice",
      deliveryType: "stop_desk",
      otpToken: "0123456789abcdef",
      turnstileToken: "tok",
      landingPageSlug: "promo-ete",
    });
    expect(parsed).toMatchObject({
      address: "Rue Didouche 12",
      notes: "ring twice",
      deliveryType: "stop_desk",
      landingPageSlug: "promo-ete",
    });
  });
});
