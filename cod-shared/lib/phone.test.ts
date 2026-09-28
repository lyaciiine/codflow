/**
 * Algerian phone normalization.
 *
 * These cases travelled with the module when it moved out of
 * `cod-server/src/endpoints/store-otp/phone.ts`: the OTP send path, the
 * storefront order schema and the WhatsApp widget's number all depend on the
 * same answers, so the tests belong beside the definition rather than beside
 * one of its callers.
 */

import { describe, it, expect } from "vitest";
import { normalizeAlgerianPhone, toLocalAlgerianMobile } from "./phone";

describe("normalizeAlgerianPhone", () => {
  it("normalizes every local Algerian mobile shape to +213 E.164", () => {
    expect(normalizeAlgerianPhone("0551234567")).toBe("+213551234567");
    expect(normalizeAlgerianPhone("551234567")).toBe("+213551234567");
    expect(normalizeAlgerianPhone("066 123-4567")).toBe("+213661234567");
    expect(normalizeAlgerianPhone(" 0771234567 ")).toBe("+213771234567");
    expect(normalizeAlgerianPhone("05 51 23 45 67")).toBe("+213551234567");
  });

  it("completes already-country-coded forms", () => {
    expect(normalizeAlgerianPhone("+213551234567")).toBe("+213551234567");
    expect(normalizeAlgerianPhone("213551234567")).toBe("+213551234567");
    expect(normalizeAlgerianPhone("00213551234567")).toBe("+213551234567");
  });

  it("passes other countries through in +CC form", () => {
    expect(normalizeAlgerianPhone("+33612345678")).toBe("+33612345678");
    expect(normalizeAlgerianPhone("+971501234567")).toBe("+971501234567");
  });

  it("returns null for garbage, landlines, and wrong lengths", () => {
    expect(normalizeAlgerianPhone("abc")).toBeNull();
    expect(normalizeAlgerianPhone("0211234567")).toBeNull(); // Algerian landline (021…)
    expect(normalizeAlgerianPhone("1234")).toBeNull();
    expect(normalizeAlgerianPhone("")).toBeNull();
    expect(normalizeAlgerianPhone("+21355123456712345")).toBeNull(); // too long after +CC
    expect(normalizeAlgerianPhone("0551234567x")).toBeNull();
    expect(normalizeAlgerianPhone("+abc12345")).toBeNull();
  });

  it("rejects non-Algerian mobiles given without a + prefix", () => {
    expect(normalizeAlgerianPhone("33612345678")).toBeNull();
  });
});

describe("toLocalAlgerianMobile", () => {
  it.each([
    ["0551234567", "0551234567"],
    ["055 12 34 567", "0551234567"],
    ["+213551234567", "0551234567"],
    ["213551234567", "0551234567"],
    ["00213551234567", "0551234567"],
    ["0661234567", "0661234567"],
    ["0771234567", "0771234567"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(toLocalAlgerianMobile(input)).toBe(expected);
  });

  it.each([
    "12345",           // garbage
    "05512345",        // too short
    "05512345678",     // too long
    "041123456",       // landline (04 prefix)
    "0812345678",      // invalid prefix
    "+33123456789",    // foreign number
    "0000000000",      // zeros
  ])("rejects %s", (input) => {
    expect(toLocalAlgerianMobile(input)).toBeNull();
  });
});
