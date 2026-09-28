import { describe, it, expect } from "vitest";
import {
  stripTrackingParams,
  truncateAtWordBoundary,
  resolvePrefillText,
  buildWhatsAppHref,
} from "./whatsapp-prefill";

describe("stripTrackingParams", () => {
  it("strips common ad tracking parameters (utm_*, fbclid, gclid, ttclid)", () => {
    const input =
      "https://store.dz/products/watch?utm_source=fb&utm_medium=cpc&fbclid=IwAR123&gclid=Cjw456&color=black";
    const cleaned = stripTrackingParams(input);
    expect(cleaned).toBe("https://store.dz/products/watch?color=black");
  });

  it("removes query string completely if all params were tracking params", () => {
    const input = "https://store.dz/products/watch?fbclid=123&utm_campaign=winter";
    const cleaned = stripTrackingParams(input);
    expect(cleaned).toBe("https://store.dz/products/watch");
  });

  it("leaves URLs without tracking params untouched", () => {
    const input = "https://store.dz/products/watch?page=2&sort=price";
    expect(stripTrackingParams(input)).toBe(input);
  });

  it("handles invalid URLs gracefully without crashing", () => {
    expect(stripTrackingParams("invalid-url-string")).toBe("invalid-url-string");
  });
});

describe("truncateAtWordBoundary", () => {
  it("does not truncate text shorter than or equal to 900 characters", () => {
    const shortText = "Hello world";
    expect(truncateAtWordBoundary(shortText, 900)).toBe(shortText);
  });

  it("truncates at word boundary before 900 characters", () => {
    // 895 chars of 'a' + ' ' + 20 chars of 'b'
    const part1 = "a".repeat(895);
    const text = `${part1} word-to-be-cut-off`;
    const truncated = truncateAtWordBoundary(text, 900);
    expect(truncated.length).toBeLessThanOrEqual(900);
    expect(truncated).toBe(part1);
  });

  it("slices hard at maxLen if there is no space in the string", () => {
    const solid = "a".repeat(1000);
    expect(truncateAtWordBoundary(solid, 900)).toBe("a".repeat(900));
  });
});

describe("resolvePrefillText", () => {
  it("replaces all known tokens ({product}, {url}, {order}, {store})", () => {
    const template =
      "Hello {store}! I have a question about {product} on {url}. My order is #{order}.";
    const result = resolvePrefillText({
      template,
      storeName: "Boutique Dz",
      productName: "AirPods Pro",
      url: "https://store.dz/products/airpods?fbclid=xyz",
      orderNumber: "ORD-9999",
    });

    expect(result).toBe(
      "Hello Boutique Dz! I have a question about AirPods Pro on https://store.dz/products/airpods. My order is #ORD-9999.",
    );
  });

  it("falls back to store name when productName is null or empty", () => {
    const template = "I want to ask about {product}";
    const result = resolvePrefillText({
      template,
      storeName: "Boutique Dz",
      productName: null,
    });
    expect(result).toBe("I want to ask about Boutique Dz");
  });

  it("leaves unregistered tokens like {price} verbatim", () => {
    const template = "Does {product} cost {price}?";
    const result = resolvePrefillText({
      template,
      storeName: "Boutique Dz",
      productName: "Sneakers",
    });
    expect(result).toBe("Does Sneakers cost {price}?");
  });

  it("resolves {order} to empty string when not provided", () => {
    const template = "Order confirmation for {order}";
    const result = resolvePrefillText({
      template,
      storeName: "Boutique Dz",
      orderNumber: null,
    });
    expect(result).toBe("Order confirmation for ");
  });

  it("enforces 900-char cap on the resolved output", () => {
    const longStoreName = "Store ".repeat(200); // 1200 chars
    const template = "Welcome to {store}!";
    const result = resolvePrefillText({
      template,
      storeName: longStoreName,
    });
    expect(result.length).toBeLessThanOrEqual(900);
  });
});

describe("buildWhatsAppHref", () => {
  it("appends ?text= when base href has no query string", () => {
    const base = "https://wa.me/213551234567";
    const text = "Hello store";
    expect(buildWhatsAppHref(base, text)).toBe(
      "https://wa.me/213551234567?text=Hello%20store",
    );
  });

  it("appends &text= when base href already has query parameters", () => {
    const base = "https://wa.me/213551234567?lang=ar";
    const text = "مرحبا";
    expect(buildWhatsAppHref(base, text)).toBe(
      `https://wa.me/213551234567?lang=ar&text=${encodeURIComponent("مرحبا")}`,
    );
  });

  it("returns base href unchanged if text is empty", () => {
    const base = "https://wa.me/213551234567";
    expect(buildWhatsAppHref(base, "")).toBe(base);
  });
});
