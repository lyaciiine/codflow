/**
 * The write path: what the dashboard is allowed to save.
 *
 * Every refusal here is one a merchant can reach by typing, so each one has to
 * name what is wrong rather than fail generically — the code is what the
 * dashboard localises, and the message is what an API caller reads.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_WHATSAPP_WIDGET_CONFIG, WIDGET_TEXT_FIELDS } from "./config";
import { validateWhatsAppWidgetInput, type WidgetIssue } from "./validate";

function expectOk(input: unknown) {
  const result = validateWhatsAppWidgetInput(input);
  if (!result.ok) {
    throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
  }
  return result.config;
}

function issuesOf(input: unknown): WidgetIssue[] {
  const result = validateWhatsAppWidgetInput(input);
  return result.ok ? [] : result.issues;
}

function codesOf(input: unknown): string[] {
  return issuesOf(input).map((issue) => issue.code);
}

describe("shape", () => {
  it.each([null, undefined, "widget", 7, [], true])("refuses %p", (input) => {
    expect(codesOf(input)).toEqual(["NOT_AN_OBJECT"]);
  });

  it("accepts an empty document as 'no widget'", () => {
    expect(expectOk({})).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
  });

  it("refuses an unknown key rather than dropping it silently", () => {
    const issues = issuesOf({ startMode: "compose" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "startMode", code: "UNKNOWN_KEY" });
  });

  it("refuses an unknown surface", () => {
    const issues = issuesOf({ surfaces: { blog: true } });
    expect(issues[0]).toMatchObject({ path: "surfaces.blog", code: "UNKNOWN_KEY" });
  });

  it("replaces the whole document — an omitted key takes its default, not the stored value", () => {
    const config = expectOk({ phone: "0551234567" });
    expect(config.enabled).toBe(false);
    expect(config.agentName).toBeNull();
    expect(config.surfaces).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces);
  });
});

describe("the number", () => {
  it.each([
    ["0551234567", "+213551234567"],
    ["055 12 34 567", "+213551234567"],
    ["00213551234567", "+213551234567"],
    ["213661234567", "+213661234567"],
    ["+213771234567", "+213771234567"],
    ["+33612345678", "+33612345678"],
  ])("normalises %s → %s, whichever way the merchant typed it", (input, expected) => {
    expect(expectOk({ phone: input }).phone).toBe(expected);
  });

  it.each(["0211234567", "12345", "garbage", "05512345678"])("refuses %s", (input) => {
    const issues = issuesOf({ phone: input });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "phone", code: "INVALID_PHONE" });
  });

  it.each([null, "", "   ", undefined])("reads %p as no number", (input) => {
    expect(expectOk({ phone: input }).phone).toBeNull();
  });

  it("refuses a non-string", () => {
    expect(codesOf({ phone: 213551234567 })).toEqual(["INVALID_FIELD"]);
  });

  it("refuses being switched on with nowhere to go", () => {
    const issues = issuesOf({ enabled: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "phone", code: "PHONE_REQUIRED" });
  });

  it("reports the bad number once, not twice, when it is also switched on", () => {
    expect(codesOf({ enabled: true, phone: "0211234567" })).toEqual(["INVALID_PHONE"]);
  });

  it("accepts being switched on with a number", () => {
    const config = expectOk({ enabled: true, phone: "0551234567" });
    expect(config.enabled).toBe(true);
    expect(config.phone).toBe("+213551234567");
  });
});

describe("text", () => {
  it("trims and reads a blank as nothing set", () => {
    const config = expectOk({ agentName: "  Amine  ", caption: "  " });
    expect(config.agentName).toBe("Amine");
    expect(config.caption).toBeNull();
  });

  it.each(Object.entries(WIDGET_TEXT_FIELDS))("refuses %s past its cap", (key, { max }) => {
    const issues = issuesOf({ [key]: "x".repeat(max + 1) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: key, code: "TEXT_TOO_LONG" });
  });

  it.each(Object.entries(WIDGET_TEXT_FIELDS))("accepts %s exactly at its cap", (key, { max }) => {
    expect(expectOk({ [key]: "x".repeat(max) })[key as "agentName"]).toHaveLength(max);
  });

  it("refuses a non-string", () => {
    expect(codesOf({ welcomeMessage: { text: "hi" } })).toEqual(["INVALID_FIELD"]);
  });

  it("keeps prefill tokens verbatim — resolving them is the theme's job", () => {
    const config = expectOk({ prefillProduct: "سلام، بغيت {product} — {url}" });
    expect(config.prefillProduct).toBe("سلام، بغيت {product} — {url}");
  });

  it("keeps an unknown token rather than editing the merchant's sentence", () => {
    expect(expectOk({ prefillGeneral: "price is {price}" }).prefillGeneral).toBe(
      "price is {price}",
    );
  });
});

describe("avatar", () => {
  it("accepts an https URL", () => {
    const url = "https://media.example.com/agent.jpg";
    expect(expectOk({ avatarUrl: url }).avatarUrl).toBe(url);
  });

  it.each(["http://media.example.com/a.jpg", "javascript:alert(1)", "/relative.jpg", "nope"])(
    "refuses %s",
    (url) => {
      const issues = issuesOf({ avatarUrl: url });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ path: "avatarUrl", code: "INVALID_AVATAR_URL" });
    },
  );

  it("refuses one past the length cap", () => {
    const url = `https://media.example.com/${"a".repeat(600)}.jpg`;
    expect(codesOf({ avatarUrl: url })).toEqual(["INVALID_AVATAR_URL"]);
  });

  it.each([null, "", "  "])("reads %p as no avatar", (input) => {
    expect(expectOk({ avatarUrl: input }).avatarUrl).toBeNull();
  });
});

describe("appearance", () => {
  it("accepts the two accents and the two sides", () => {
    expect(expectOk({ accent: "primary" }).accent).toBe("primary");
    expect(expectOk({ position: "left" }).position).toBe("left");
  });

  it.each([
    ["accent", "neon"],
    ["position", "middle"],
  ])("refuses an unlisted %s", (key, value) => {
    const issues = issuesOf({ [key]: value });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: key, code: "INVALID_CHOICE" });
  });

  it("refuses a non-boolean switch", () => {
    expect(codesOf({ attention: "yes" })).toEqual(["INVALID_FIELD"]);
    expect(codesOf({ enabled: 1 })).toEqual(["INVALID_FIELD"]);
  });
});

describe("surfaces", () => {
  it("takes the merchant's choices and defaults the rest", () => {
    const config = expectOk({ surfaces: { checkout: true, home: false } });
    expect(config.surfaces.checkout).toBe(true);
    expect(config.surfaces.home).toBe(false);
    expect(config.surfaces.product).toBe(true);
    expect(config.surfaces.landing).toBe(false);
  });

  it("refuses a non-boolean surface", () => {
    const issues = issuesOf({ surfaces: { product: "yes" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: "surfaces.product", code: "INVALID_FIELD" });
  });

  it("refuses a surfaces value that is not an object", () => {
    expect(codesOf({ surfaces: ["product"] })).toEqual(["INVALID_FIELD"]);
  });

  it("accepts every surface off — a paused widget is a real state", () => {
    const off = Object.fromEntries(
      Object.keys(DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces).map((key) => [key, false]),
    );
    const config = expectOk({ enabled: true, phone: "0551234567", surfaces: off });
    expect(Object.values(config.surfaces).every((value) => value === false)).toBe(true);
  });
});

describe("reporting", () => {
  it("reports every problem at once, so the merchant fixes the form once", () => {
    const issues = issuesOf({
      phone: "0211234567",
      accent: "neon",
      avatarUrl: "http://x.test/a.jpg",
      caption: "x".repeat(WIDGET_TEXT_FIELDS.caption.max + 1),
      surfaces: { blog: true },
    });
    expect(issues.map((issue) => issue.code).sort()).toEqual([
      "INVALID_AVATAR_URL",
      "INVALID_CHOICE",
      "INVALID_PHONE",
      "TEXT_TOO_LONG",
      "UNKNOWN_KEY",
    ]);
  });

  it("points at the field, so the dashboard can mark it", () => {
    expect(issuesOf({ surfaces: { checkout: 1 } })[0].path).toBe("surfaces.checkout");
  });
});
