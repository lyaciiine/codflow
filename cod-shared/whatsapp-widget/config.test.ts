/**
 * The read path: a stored blob in, a usable widget out — or nothing at all.
 *
 * The claim these tests defend is that no stored value can stop a storefront
 * rendering. Every case below is something a row can actually contain: NULL
 * before the feature was used, a blob from a newer deploy, a hand-edited row,
 * a number that stopped being valid.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  WIDGET_SURFACE_KEYS,
  WIDGET_TEXT_FIELDS,
  isDefaultWhatsAppWidgetConfig,
  parseWhatsAppWidgetConfig,
  resolveStorefrontWidget,
  serializeWhatsAppWidgetConfig,
  toWhatsAppHref,
  type WhatsAppWidgetConfig,
} from "./config";

function stored(overrides: Partial<WhatsAppWidgetConfig> = {}): string {
  return serializeWhatsAppWidgetConfig({
    ...DEFAULT_WHATSAPP_WIDGET_CONFIG,
    enabled: true,
    phone: "+213551234567",
    ...overrides,
    surfaces: { ...DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces, ...(overrides.surfaces ?? {}) },
  });
}

describe("parseWhatsAppWidgetConfig — nothing stored", () => {
  it.each([null, undefined, "", "   "])("reads %p as no widget", (input) => {
    expect(parseWhatsAppWidgetConfig(input as string | null)).toEqual(
      DEFAULT_WHATSAPP_WIDGET_CONFIG,
    );
  });

  it("never throws on malformed JSON", () => {
    expect(parseWhatsAppWidgetConfig("{not json")).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
  });

  it("falls back for JSON that is not an object", () => {
    expect(parseWhatsAppWidgetConfig("[1,2,3]")).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    expect(parseWhatsAppWidgetConfig('"a string"')).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    expect(parseWhatsAppWidgetConfig("null")).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
  });

  it("hands out a frozen default, so no caller can change every store's defaults", () => {
    const config = parseWhatsAppWidgetConfig(null);
    expect(() => {
      (config as { enabled: boolean }).enabled = true;
    }).toThrow();
    expect(DEFAULT_WHATSAPP_WIDGET_CONFIG.enabled).toBe(false);
  });
});

describe("parseWhatsAppWidgetConfig — rollback safety", () => {
  it("ignores keys a newer deploy wrote", () => {
    const config = parseWhatsAppWidgetConfig(
      JSON.stringify({ enabled: true, phone: "+213551234567", startMode: "compose", theme: "dark" }),
    );
    expect(config.enabled).toBe(true);
    expect(config.phone).toBe("+213551234567");
    expect(config).not.toHaveProperty("startMode");
  });

  it("keeps the merchant's other settings when one value is unreadable", () => {
    const config = parseWhatsAppWidgetConfig(
      JSON.stringify({
        enabled: true,
        phone: "+213551234567",
        agentName: "Amine",
        accent: "neon",
        position: 42,
      }),
    );
    expect(config.agentName).toBe("Amine");
    expect(config.accent).toBe("whatsapp");
    expect(config.position).toBe("right");
  });

  it("defaults a missing surface rather than dropping the map", () => {
    const config = parseWhatsAppWidgetConfig(
      JSON.stringify({ enabled: true, phone: "+213551234567", surfaces: { product: false } }),
    );
    expect(config.surfaces.product).toBe(false);
    expect(config.surfaces.home).toBe(true);
    expect(config.surfaces.checkout).toBe(false);
    expect(Object.keys(config.surfaces).sort()).toEqual([...WIDGET_SURFACE_KEYS].sort());
  });
});

describe("parseWhatsAppWidgetConfig — text", () => {
  it("trims, and treats a blank string as nothing set", () => {
    const config = parseWhatsAppWidgetConfig(
      JSON.stringify({ agentName: "  Amine  ", caption: "   " }),
    );
    expect(config.agentName).toBe("Amine");
    expect(config.caption).toBeNull();
  });

  it("clamps an over-long stored value instead of discarding the sentence", () => {
    const long = "ا".repeat(WIDGET_TEXT_FIELDS.caption.max + 50);
    const config = parseWhatsAppWidgetConfig(JSON.stringify({ caption: long }));
    expect(config.caption).toHaveLength(WIDGET_TEXT_FIELDS.caption.max);
  });

  it("ignores a non-string where text belongs", () => {
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ agentName: 7 })).agentName).toBeNull();
  });
});

describe("parseWhatsAppWidgetConfig — the stored number", () => {
  it("trims what is stored", () => {
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ phone: "  +213551234567 " })).phone).toBe(
      "+213551234567",
    );
  });

  it("guarantees a string or null, whatever the row holds", () => {
    // The dashboard renders this value and the API returns it. A number that
    // leaked through would be a type the rest of the product does not expect.
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ phone: 213551234567 })).phone).toBeNull();
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ phone: { e164: "x" } })).phone).toBeNull();
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ phone: "  " })).phone).toBeNull();
  });
});

describe("parseWhatsAppWidgetConfig — switches absent from an older blob", () => {
  it("keeps the attention pulse on, which is its default", () => {
    // A config written before this switch existed has no key for it. Reading
    // that as "off" would quietly disable it for every store that upgraded.
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ enabled: true })).attention).toBe(true);
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ attention: false })).attention).toBe(false);
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ attention: "no" })).attention).toBe(true);
  });
});

describe("parseWhatsAppWidgetConfig — avatar", () => {
  it("keeps an https URL", () => {
    const url = "https://media.example.com/agent.jpg";
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ avatarUrl: url })).avatarUrl).toBe(url);
  });

  it.each([
    "http://media.example.com/agent.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "not a url",
  ])("drops %s — every shopper's browser would load it", (url) => {
    expect(parseWhatsAppWidgetConfig(JSON.stringify({ avatarUrl: url })).avatarUrl).toBeNull();
  });
});

describe("toWhatsAppHref", () => {
  it.each([
    ["0551234567", "https://wa.me/213551234567"],
    ["+213551234567", "https://wa.me/213551234567"],
    ["00213551234567", "https://wa.me/213551234567"],
    ["055 12 34 567", "https://wa.me/213551234567"],
    ["+33612345678", "https://wa.me/33612345678"],
  ])("builds %s → %s", (input, expected) => {
    expect(toWhatsAppHref(input)).toBe(expected);
  });

  it("never leaves the + in the path — wa.me answers that with an error page", () => {
    expect(toWhatsAppHref("+213551234567")).not.toContain("+");
  });

  it.each([null, undefined, "", "0211234567", "garbage"])("returns null for %p", (input) => {
    expect(toWhatsAppHref(input as string | null)).toBeNull();
  });
});

describe("resolveStorefrontWidget", () => {
  it("returns the widget when it is on and dialable", () => {
    const widget = resolveStorefrontWidget(stored({ agentName: "Amine", attention: false }));
    expect(widget).not.toBeNull();
    expect(widget?.href).toBe("https://wa.me/213551234567");
    expect(widget?.agentName).toBe("Amine");
    expect(widget?.attention).toBe(false);
  });

  it("is null when the merchant switched it off", () => {
    expect(resolveStorefrontWidget(stored({ enabled: false }))).toBeNull();
  });

  it("is null when it is on but has no number", () => {
    expect(resolveStorefrontWidget(stored({ phone: null }))).toBeNull();
  });

  it("is null when the stored number no longer normalises", () => {
    expect(resolveStorefrontWidget(stored({ phone: "0211234567" }))).toBeNull();
  });

  it("is null for an unconfigured store", () => {
    expect(resolveStorefrontWidget(null)).toBeNull();
  });

  it("never exposes the raw phone — only the link built from it", () => {
    const widget = resolveStorefrontWidget(stored());
    expect(widget).not.toHaveProperty("phone");
    expect(widget).not.toHaveProperty("enabled");
  });

  it("carries every field the theme renders — a dropped one is a silent default", () => {
    const widget = resolveStorefrontWidget(
      stored({
        agentName: "Amine",
        caption: "Online",
        avatarUrl: "https://media.example.com/a.jpg",
        welcomeMessage: "Hi",
        launcherLabel: "Chat",
        ctaLabel: "Message us",
        prefillGeneral: "Hello",
        prefillProduct: "About {product}",
        accent: "primary",
        position: "left",
        attention: false,
      }),
    );
    expect(widget).toEqual({
      href: "https://wa.me/213551234567",
      agentName: "Amine",
      caption: "Online",
      avatarUrl: "https://media.example.com/a.jpg",
      welcomeMessage: "Hi",
      launcherLabel: "Chat",
      ctaLabel: "Message us",
      prefillGeneral: "Hello",
      prefillProduct: "About {product}",
      thankYouButtonLabel: null,
      prefillThankYou: null,
      accent: "primary",
      position: "left",
      attention: false,
      surfaces: DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces,
    });
  });

  it("carries the surface map the theme gates on", () => {
    const widget = resolveStorefrontWidget(stored({ surfaces: { checkout: true } as never }));
    expect(widget?.surfaces.checkout).toBe(true);
    expect(widget?.surfaces.landing).toBe(false);
  });
});

describe("isDefaultWhatsAppWidgetConfig", () => {
  it("is true for the default, so the save path can store NULL", () => {
    expect(isDefaultWhatsAppWidgetConfig(DEFAULT_WHATSAPP_WIDGET_CONFIG)).toBe(true);
    expect(isDefaultWhatsAppWidgetConfig(parseWhatsAppWidgetConfig(null))).toBe(true);
  });

  it.each([
    ["a number", { phone: "+213551234567" }],
    ["being on", { enabled: true }],
    ["a caption", { caption: "Online" }],
    ["an avatar", { avatarUrl: "https://media.example.com/a.jpg" }],
    ["the accent", { accent: "primary" as const }],
    ["the side", { position: "left" as const }],
    ["the pulse off", { attention: false }],
  ])("is false once the merchant set %s", (_label, overrides) => {
    expect(
      isDefaultWhatsAppWidgetConfig({ ...DEFAULT_WHATSAPP_WIDGET_CONFIG, ...overrides }),
    ).toBe(false);
  });

  it("is false once a surface differs from its default", () => {
    expect(
      isDefaultWhatsAppWidgetConfig({
        ...DEFAULT_WHATSAPP_WIDGET_CONFIG,
        surfaces: { ...DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces, checkout: true },
      }),
    ).toBe(false);
  });
});

describe("serializeWhatsAppWidgetConfig", () => {
  it("round-trips through the parser unchanged", () => {
    const config: WhatsAppWidgetConfig = {
      ...DEFAULT_WHATSAPP_WIDGET_CONFIG,
      enabled: true,
      phone: "+213551234567",
      agentName: "Amine",
      caption: "نرد خلال دقائق",
      avatarUrl: "https://media.example.com/agent.jpg",
      welcomeMessage: "مرحبا 👋",
      launcherLabel: "تواصل معنا",
      ctaLabel: "راسلنا على واتساب",
      prefillGeneral: "سلام، عندي سؤال",
      prefillProduct: "سلام، بغيت نسقسي على {product}",
      accent: "primary",
      position: "left",
      attention: false,
      surfaces: { ...DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces, checkout: true, home: false },
    };
    expect(parseWhatsAppWidgetConfig(serializeWhatsAppWidgetConfig(config))).toEqual(config);
  });

  it("writes the same bytes for the same config, so a no-op save is a no-op diff", () => {
    const a = serializeWhatsAppWidgetConfig(parseWhatsAppWidgetConfig(stored()));
    const b = serializeWhatsAppWidgetConfig(parseWhatsAppWidgetConfig(stored()));
    expect(a).toBe(b);
  });
});
