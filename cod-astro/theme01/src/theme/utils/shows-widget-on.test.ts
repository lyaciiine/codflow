import { describe, it, expect } from "vitest";
import { showsWidgetOn, type WidgetSurfaces } from "./shows-widget-on";

const ALL_ON: WidgetSurfaces = {
  home: true,
  catalog: true,
  product: true,
  pages: true,
  thankYou: true,
  checkout: true,
  landing: true,
};

const ALL_OFF: WidgetSurfaces = {
  home: false,
  catalog: false,
  product: false,
  pages: false,
  thankYou: false,
  checkout: false,
  landing: false,
};

describe("showsWidgetOn", () => {
  it("returns false when surfaces object is null or undefined", () => {
    expect(showsWidgetOn(null, "/")).toBe(false);
    expect(showsWidgetOn(undefined, "/products")).toBe(false);
  });

  describe("home surface", () => {
    it("matches root path", () => {
      expect(showsWidgetOn(ALL_ON, "/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/")).toBe(false);
    });

    it("matches empty string or query string at root", () => {
      expect(showsWidgetOn(ALL_ON, "")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/?ref=ad")).toBe(true);
    });
  });

  describe("catalog surface", () => {
    it("matches /products and /products/", () => {
      expect(showsWidgetOn(ALL_ON, "/products")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/products/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/products")).toBe(false);
    });

    it("matches /category/* routes", () => {
      expect(showsWidgetOn(ALL_ON, "/category/electronics")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/category/clothes/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/category/electronics")).toBe(false);
    });
  });

  describe("product surface", () => {
    it("matches /products/[slug]", () => {
      expect(showsWidgetOn(ALL_ON, "/products/special-item")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/products/special-item/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/products/special-item")).toBe(false);
    });

    it("differentiates between catalog /products and product /products/[slug]", () => {
      const catalogOffProductOn: WidgetSurfaces = { ...ALL_ON, catalog: false, product: true };
      expect(showsWidgetOn(catalogOffProductOn, "/products")).toBe(false);
      expect(showsWidgetOn(catalogOffProductOn, "/products/item-1")).toBe(true);

      const catalogOnProductOff: WidgetSurfaces = { ...ALL_ON, catalog: true, product: false };
      expect(showsWidgetOn(catalogOnProductOff, "/products")).toBe(true);
      expect(showsWidgetOn(catalogOnProductOff, "/products/item-1")).toBe(false);
    });
  });

  describe("checkout surface", () => {
    it("matches /checkout and /checkout/", () => {
      expect(showsWidgetOn(ALL_ON, "/checkout")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/checkout/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/checkout")).toBe(false);
    });
  });

  describe("thankYou surface", () => {
    it("matches /thank-you and /thank-you/", () => {
      expect(showsWidgetOn(ALL_ON, "/thank-you")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/thank-you/?order=123")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/thank-you")).toBe(false);
    });
  });

  describe("pages surface", () => {
    it("matches /pages/[slug]", () => {
      expect(showsWidgetOn(ALL_ON, "/pages/privacy-policy")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/pages/terms/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/pages/privacy-policy")).toBe(false);
    });

    it("returns false for bare /pages or /pages/", () => {
      expect(showsWidgetOn(ALL_ON, "/pages")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/pages/")).toBe(false);
    });
  });

  describe("landing surface", () => {
    it("matches /lp/[slug]", () => {
      expect(showsWidgetOn(ALL_ON, "/lp/summer-sale")).toBe(true);
      expect(showsWidgetOn(ALL_ON, "/lp/special/")).toBe(true);
      expect(showsWidgetOn(ALL_OFF, "/lp/summer-sale")).toBe(false);
    });

    it("returns false for bare /lp or /lp/", () => {
      expect(showsWidgetOn(ALL_ON, "/lp")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/lp/")).toBe(false);
    });
  });

  describe("prefix confusion & 404 safety", () => {
    it("returns false for /404", () => {
      expect(showsWidgetOn(ALL_ON, "/404")).toBe(false);
    });

    it("returns false for pathname prefix confusions", () => {
      expect(showsWidgetOn(ALL_ON, "/productsomething")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/product-xyz")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/checkout-success")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/thank-you-again")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/lp-deal")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/category")).toBe(false);
      expect(showsWidgetOn(ALL_ON, "/api/anything")).toBe(false);
    });
  });
});
