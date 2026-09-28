import { z } from "astro/zod";
import { 
  ProductSchema, 
  CategorySchema, 
  ProductImageSchema, 
  ProductVariantSchema,
  OfferSchema
} from "./validation";

export type Product = z.infer<typeof ProductSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type ProductImage = z.infer<typeof ProductImageSchema>;
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
export type Offer = z.infer<typeof OfferSchema>;

/**
 * The merchant's order-form configuration, as cod-server resolves it.
 *
 * A plain type, not a schema: cod-server has already applied the defaults and
 * validated every value by the time this arrives, and it enforces all of it
 * again on POST /store/orders. The theme's job is to render what it is told —
 * a theme that decided anything about form rules would be engine logic in a
 * swappable layer, and the two copies would drift.
 *
 * `address` may be "hidden" (some merchants take it by phone after the order).
 * A hidden field ships no markup at all; whether a HOME parcel may then leave
 * without an address is a platform decision, enforced at dispatch — not here.
 */
export interface CheckoutFormPolicy {
  address: "required" | "optional" | "hidden";
  notes: "optional" | "hidden";
  email: "required" | "optional" | "hidden";
  deliveryOptions: { home: boolean; stopDesk: boolean };
  customFields: CheckoutFormCustomField[];
}

export interface CheckoutFormCustomField {
  /** Server-minted. Answers are keyed by it, so it outlives label edits. */
  id: string;
  /** Merchant-authored text. Render as a text node — never as markup. */
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  /** `select` only. */
  options?: string[];
}

export interface StoreConfig {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
  themeId: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  fontFamily: string;
  fontUrl: string | null;
  lang: "ar" | "en" | "fr";
  currency: string;
  currencySymbol: string;
  contentJson: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  announcementBar: string | null;
  reviewsEnabled: boolean;
  /** When true the storefront renders the cart alongside the direct order form. */
  cartEnabled: boolean;
  /** Subtotal (DZD) at or above which delivery is free. null = no threshold. */
  freeShippingThreshold: number | null;
  otpEnabled: boolean;
  /** Cloudflare Turnstile — true only when a store_turnstile_config row exists AND is enabled. */
  turnstileEnabled: boolean;
  /** Public widget site key; null when Turnstile is disabled. The secret never leaves cod-server. */
  turnstileSiteKey: string | null;
  status: "active" | "inactive";
  /**
   * Absent when the storefront runs against a cod-server from before this
   * feature — components fall back to the defaults, which are this form's
   * behaviour as it has always been.
   */
  checkoutForm?: CheckoutFormPolicy;
  pixelId?: string | null;
  conversionEvent?: "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead" | null;
  /**
   * Published pages that opt into the footer, titled in the store's own
   * language, ordered for display. The checkout consent line resolves Terms/
   * Refund from here by `kind` — never a hardcoded slug, since a merchant may
   * rename any page's slug freely.
   */
  pages: StorePageLink[];
  /**
   * The public subset of the store's legal profile. Null until the merchant
   * saves one from the dashboard (Settings → Store Pages) — RC/NIF are never
   * exposed here, only inside the legal documents themselves.
   */
  legalContact: StoreLegalContact | null;
  /**
   * The WhatsApp contact widget, already resolved. Null whenever there is
   * nothing to render — switched off, no number, or an unparseable number.
   * Optional for backwards compatibility with pre-0032 servers.
   */
  whatsapp?: StoreWhatsAppWidget | null;
}

export interface StoreWhatsAppWidget {
  href: string;
  agentName: string | null;
  caption: string | null;
  avatarUrl: string | null;
  welcomeMessage: string | null;
  launcherLabel: string | null;
  ctaLabel: string | null;
  prefillGeneral: string | null;
  prefillProduct: string | null;
  prefillThankYou: string | null;
  thankYouButtonLabel: string | null;
  accent: "whatsapp" | "primary";
  position: "right" | "left";
  attention: boolean;
  surfaces: {
    home: boolean;
    catalog: boolean;
    product: boolean;
    pages: boolean;
    thankYou: boolean;
    checkout: boolean;
    landing: boolean;
  };
}

export interface StorePageLink {
  id: string;
  kind: "terms" | "privacy" | "refund" | "shipping" | "custom";
  slug: string;
  title: string;
  position: number;
}

export interface StoreLegalContact {
  contactEmail: string | null;
  contactPhone: string | null;
  deliveryMinDays: number;
  deliveryMaxDays: number;
}

/** A resolved store page — GET /store/pages/{slug}. */
export interface StorePagePublic {
  id: string;
  kind: "terms" | "privacy" | "refund" | "shipping" | "custom";
  slug: string;
  locale: "ar" | "en" | "fr";
  title: string;
  /** Sanitised HTML. Render with set:html and never re-sanitise. */
  bodyHtml: string;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface ShippingRates {
  [wilayaId: string]: { home: number; stopDesk: number };
}

export interface Wilaya {
  id: number;
  name: string;
  nameAr: string;
}

export interface Commune {
  id: string;
  name: string;
  nameAr: string;
}

export interface Review {
  id: string;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
}
