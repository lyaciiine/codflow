/**
 * The storefront serves AR, FR and EN stores from one deployment, so a message
 * that exists in one language and not another is a shopper staring at English
 * in an Arabic checkout. This is the same parity discipline the dashboard's
 * i18n guard applies to its locale files.
 */

import { describe, it, expect } from "vitest";
import { CHECKOUT_POLICY_MESSAGES, checkoutPolicyMessage, type StoreLanguage } from "./messages";
import type { CheckoutPolicyRejectionCode } from "./apply";

const LANGS: StoreLanguage[] = ["ar", "fr", "en"];

const ALL_CODES: CheckoutPolicyRejectionCode[] = [
  "DELIVERY_OPTION_UNAVAILABLE",
  "ADDRESS_REQUIRED",
  "EMAIL_REQUIRED",
  "EMAIL_INVALID",
  "CUSTOM_FIELD_REQUIRED",
  "CUSTOM_FIELD_INVALID_CHOICE",
  "CUSTOM_FIELD_NOT_A_NUMBER",
  "CUSTOM_FIELD_TOO_LONG",
];

describe("locale parity", () => {
  it.each(LANGS)("%s covers every rejection code", (lang) => {
    expect(Object.keys(CHECKOUT_POLICY_MESSAGES[lang]).sort()).toEqual([...ALL_CODES].sort());
  });

  it("has no language with extra or missing codes", () => {
    const [first, ...rest] = LANGS.map((lang) => Object.keys(CHECKOUT_POLICY_MESSAGES[lang]).sort());
    for (const keys of rest) expect(keys).toEqual(first);
  });

  it.each(LANGS)("%s produces a non-empty message for every code", (lang) => {
    for (const code of ALL_CODES) {
      const message = checkoutPolicyMessage(lang, { code, field: "x", label: "My question" });
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("checkoutPolicyMessage", () => {
  it("names the merchant's field in a custom-field message", () => {
    for (const lang of LANGS) {
      const message = checkoutPolicyMessage(lang, {
        code: "CUSTOM_FIELD_REQUIRED",
        field: "cf_abc12345",
        label: "Preferred time",
      });
      expect(message).toContain("Preferred time");
    }
  });

  it("answers in the store's language, not the platform's", () => {
    expect(checkoutPolicyMessage("fr", { code: "ADDRESS_REQUIRED", field: "address" })).toMatch(
      /adresse/i,
    );
    expect(checkoutPolicyMessage("en", { code: "ADDRESS_REQUIRED", field: "address" })).toMatch(
      /address/i,
    );
    expect(checkoutPolicyMessage("ar", { code: "ADDRESS_REQUIRED", field: "address" })).toContain(
      "العنوان",
    );
  });

  it.each([
    ["an unknown language", "de"],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to Arabic for %s, the column default", (_label, lang) => {
    expect(checkoutPolicyMessage(lang, { code: "EMAIL_REQUIRED", field: "email" })).toBe(
      CHECKOUT_POLICY_MESSAGES.ar.EMAIL_REQUIRED,
    );
  });
});
