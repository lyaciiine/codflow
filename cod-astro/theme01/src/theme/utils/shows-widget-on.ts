import type { StoreWhatsAppWidget } from "@/core/api/types";

export type WidgetSurfaces = StoreWhatsAppWidget["surfaces"];

/**
 * Determines whether the WhatsApp widget should be displayed on a given pathname.
 *
 * Mappings:
 * - "/" -> surfaces.home
 * - "/products", "/category/*" -> surfaces.catalog
 * - "/products/*" (with slug) -> surfaces.product
 * - "/checkout" -> surfaces.checkout
 * - "/thank-you" -> surfaces.thankYou
 * - "/pages/*" (with slug) -> surfaces.pages
 * - "/lp/*" (with slug) -> surfaces.landing
 * - Anything else (e.g. 404, /productsomething) -> false
 */
export function showsWidgetOn(
  surfaces: WidgetSurfaces | null | undefined,
  rawPathname: string,
): boolean {
  if (!surfaces) return false;

  // Normalise: strip query/hash, strip trailing slashes (except root "/")
  const pathname = rawPathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";

  if (pathname === "/") {
    return Boolean(surfaces.home);
  }

  if (pathname === "/products" || pathname.startsWith("/category/")) {
    return Boolean(surfaces.catalog);
  }

  if (pathname.startsWith("/products/")) {
    const slug = pathname.slice("/products/".length);
    return slug.length > 0 ? Boolean(surfaces.product) : Boolean(surfaces.catalog);
  }

  if (pathname === "/checkout") {
    return Boolean(surfaces.checkout);
  }

  if (pathname === "/thank-you") {
    return Boolean(surfaces.thankYou);
  }

  if (pathname.startsWith("/pages/")) {
    const slug = pathname.slice("/pages/".length);
    return slug.length > 0 ? Boolean(surfaces.pages) : false;
  }

  if (pathname.startsWith("/lp/")) {
    const slug = pathname.slice("/lp/".length);
    return slug.length > 0 ? Boolean(surfaces.landing) : false;
  }

  return false;
}
