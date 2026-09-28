/**
 * WhatsApp Widget — the single definition.
 *
 * The widget is the merchant's contact handoff on the storefront: a floating
 * launcher that opens a small panel and hands the shopper to WhatsApp with a
 * message already written. It is stored as one JSON blob on
 * `stores.whatsapp_widget_json` and consumed by three callers — cod-server's
 * public `/store/config`, cod-server's dashboard API, and the dashboard UI.
 * The storefront theme never sees this module: it receives an already-resolved
 * projection, so no widget logic can drift into a swappable theme.
 *
 * No zod here, for the reason cod-shared already holds to: it declares exactly
 * one dependency (drizzle-orm), and hand-rolling expresses the split this
 * module needs anyway —
 *
 *   1. A LENIENT read path and a STRICT write path. Reading must never throw:
 *      a store whose blob was written by a newer deploy (or edited by hand)
 *      has to keep rendering, so unknown keys are ignored and bad values fall
 *      back to a safe default. Writing must refuse the same input, because a
 *      dashboard typo that silently vanishes is how settings "don't save".
 *   2. One resolved answer for the storefront. `resolveStorefrontWidget`
 *      returns the widget or `null`; "enabled but no number" and "a number
 *      that no longer normalises" are not the theme's problem to reason about.
 *
 * NULL means "no widget", and no widget is the default, which is what makes
 * the rollout a no-op and the rollback a single UPDATE.
 */

import { normalizeAlgerianPhone } from "../lib/phone";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Which colour the launcher and the CTA take. */
export type WidgetAccent = "whatsapp" | "primary";

/** Which physical side of the viewport the launcher sits on. */
export type WidgetPosition = "right" | "left";

/**
 * One kind of storefront page the widget may appear on.
 *
 * A fixed registry rather than URL patterns: a merchant typing a path glob
 * into a settings box is a support ticket, and every one of these maps to a
 * route that actually exists in the theme (`src/pages/`).
 */
export type WidgetSurfaceKey =
  | "home"
  | "catalog"
  | "product"
  | "pages"
  | "thankYou"
  | "checkout"
  | "landing";

export type WidgetSurfaces = Record<WidgetSurfaceKey, boolean>;

export interface WhatsAppWidgetConfig {
  enabled: boolean;
  /** E.164, e.g. "+213551234567". The write path normalises before storing. */
  phone: string | null;
  // ── Identity. Null means "the theme's own default", never an empty widget. ──
  agentName: string | null;
  caption: string | null;
  avatarUrl: string | null;
  // ── Text ──
  welcomeMessage: string | null;
  launcherLabel: string | null;
  ctaLabel: string | null;
  prefillGeneral: string | null;
  prefillProduct: string | null;
  thankYouButtonLabel: string | null;
  prefillThankYou: string | null;
  // ── Appearance ──
  accent: WidgetAccent;
  position: WidgetPosition;
  attention: boolean;
  // ── Placement ──
  surfaces: WidgetSurfaces;
}

/**
 * What `/store/config` hands the storefront: everything resolved, nothing to
 * decide. The theme's entire gate is `whatsapp && surfaces[thisSurface]`.
 */
export interface StorefrontWhatsAppWidget {
  /** Ready to use: "https://wa.me/213551234567". Never carries the "+". */
  href: string;
  agentName: string | null;
  caption: string | null;
  avatarUrl: string | null;
  welcomeMessage: string | null;
  launcherLabel: string | null;
  ctaLabel: string | null;
  prefillGeneral: string | null;
  prefillProduct: string | null;
  thankYouButtonLabel: string | null;
  prefillThankYou: string | null;
  accent: WidgetAccent;
  position: WidgetPosition;
  attention: boolean;
  surfaces: WidgetSurfaces;
}

// ─── Registries ───────────────────────────────────────────────────────────────

export const WIDGET_ACCENTS: readonly WidgetAccent[] = ["whatsapp", "primary"];
export const WIDGET_POSITIONS: readonly WidgetPosition[] = ["right", "left"];

/**
 * The surfaces, defined once, in the order the dashboard lists them.
 *
 * `checkout` and `landing` default OFF: both are single-purpose conversion
 * surfaces that already carry their own sticky order CTA, and a second
 * floating control competing for the same thumb on a 360px screen costs the
 * order the widget was meant to help. Both are one switch away.
 */
export const WIDGET_SURFACES = {
  home: { default: true },
  catalog: { default: true },
  product: { default: true },
  pages: { default: true },
  thankYou: { default: true },
  checkout: { default: false },
  landing: { default: false },
} as const satisfies Record<WidgetSurfaceKey, { default: boolean }>;

export const WIDGET_SURFACE_KEYS = Object.keys(WIDGET_SURFACES) as WidgetSurfaceKey[];

/**
 * The merchant-authored text fields and their caps, defined once so the
 * dashboard counts against the same numbers the server enforces.
 *
 * The caps are shaped by where the text lands, not by storage: a caption that
 * wraps to three lines breaks the panel header, and a prefill longer than a
 * message anyone reads is a message nobody reads.
 */
export const WIDGET_TEXT_FIELDS = {
  agentName: { max: 40 },
  caption: { max: 60 },
  welcomeMessage: { max: 300 },
  launcherLabel: { max: 30 },
  ctaLabel: { max: 30 },
  prefillGeneral: { max: 300 },
  prefillProduct: { max: 300 },
  thankYouButtonLabel: { max: 40 },
  prefillThankYou: { max: 300 },
} as const;

export type WidgetTextFieldKey = keyof typeof WIDGET_TEXT_FIELDS;

export const WIDGET_TEXT_FIELD_KEYS = Object.keys(WIDGET_TEXT_FIELDS) as WidgetTextFieldKey[];

export const WIDGET_LIMITS = {
  MAX_AVATAR_URL_LENGTH: 500,
  /**
   * The hard cap on a prefilled message AFTER tokens resolve, before it is
   * encoded into the wa.me URL. Browsers and WhatsApp both truncate silently
   * past a point; truncating deliberately at a word boundary is the difference
   * between a short message and a mangled one.
   */
  MAX_RESOLVED_PREFILL_LENGTH: 900,
} as const;

/**
 * The placeholders a prefill template may carry, resolved by the theme from
 * the page it is rendered on. Listed here because the dashboard previews the
 * same set, and an unknown token must look the same in both places.
 */
export const WIDGET_PREFILL_TOKENS = ["product", "url", "order", "store"] as const;

export type WidgetPrefillToken = (typeof WIDGET_PREFILL_TOKENS)[number];

/**
 * No widget.
 *
 * Frozen because this object is handed out as the fallback on every read; a
 * caller that mutated it would change every store's defaults for the lifetime
 * of the isolate.
 */
export const DEFAULT_WHATSAPP_WIDGET_CONFIG: WhatsAppWidgetConfig = {
  enabled: false,
  phone: null,
  agentName: null,
  caption: null,
  avatarUrl: null,
  welcomeMessage: null,
  launcherLabel: null,
  ctaLabel: null,
  prefillGeneral: null,
  prefillProduct: null,
  thankYouButtonLabel: null,
  prefillThankYou: null,
  accent: "whatsapp",
  position: "right",
  attention: true,
  surfaces: {
    home: WIDGET_SURFACES.home.default,
    catalog: WIDGET_SURFACES.catalog.default,
    product: WIDGET_SURFACES.product.default,
    pages: WIDGET_SURFACES.pages.default,
    thankYou: WIDGET_SURFACES.thankYou.default,
    checkout: WIDGET_SURFACES.checkout.default,
    landing: WIDGET_SURFACES.landing.default,
  },
};
Object.freeze(DEFAULT_WHATSAPP_WIDGET_CONFIG);
Object.freeze(DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces);

// ─── Read path (lenient — never throws) ───────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Trim, drop to null when empty, clamp to the cap.
 *
 * Clamping rather than discarding: an over-long stored value can only come
 * from a hand-edited row or a deploy with a larger cap, and keeping most of
 * the merchant's sentence beats replacing all of it with the theme default.
 */
function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * An avatar is loaded by every shopper's browser, so a stored value that is
 * not a plain https URL is dropped rather than rendered. The write path
 * refuses the same thing; this is the backstop for a row nobody wrote through
 * the API.
 */
function readAvatarUrl(raw: unknown): string | null {
  const value = readText(raw, WIDGET_LIMITS.MAX_AVATAR_URL_LENGTH);
  return value && isHttpsUrl(value) ? value : null;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function readSurfaces(raw: unknown): WidgetSurfaces {
  const source = isRecord(raw) ? raw : {};
  const surfaces = {} as WidgetSurfaces;
  for (const key of WIDGET_SURFACE_KEYS) {
    const value = source[key];
    surfaces[key] = typeof value === "boolean" ? value : WIDGET_SURFACES[key].default;
  }
  return surfaces;
}

/**
 * Resolve a stored blob into a usable config. Never throws, for any input.
 *
 * Per-key leniency is deliberate: one unreadable value falls back to its
 * default rather than discarding the merchant's other settings. Unknown keys
 * are ignored so a config written by a newer deploy still parses on an older
 * one — a Worker rollback must not take the widget down with it.
 */
export function parseWhatsAppWidgetConfig(
  json: string | null | undefined,
): WhatsAppWidgetConfig {
  if (typeof json !== "string" || json.trim() === "") return DEFAULT_WHATSAPP_WIDGET_CONFIG;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_WHATSAPP_WIDGET_CONFIG;
  }
  if (!isRecord(raw)) return DEFAULT_WHATSAPP_WIDGET_CONFIG;

  return {
    enabled: raw.enabled === true,
    // Kept exactly as stored, not re-normalised: the dashboard has to be able
    // to show a merchant the number that is failing. `resolveStorefrontWidget`
    // is where a number has to be usable.
    phone: readText(raw.phone, 20),
    agentName: readText(raw.agentName, WIDGET_TEXT_FIELDS.agentName.max),
    caption: readText(raw.caption, WIDGET_TEXT_FIELDS.caption.max),
    avatarUrl: readAvatarUrl(raw.avatarUrl),
    welcomeMessage: readText(raw.welcomeMessage, WIDGET_TEXT_FIELDS.welcomeMessage.max),
    launcherLabel: readText(raw.launcherLabel, WIDGET_TEXT_FIELDS.launcherLabel.max),
    ctaLabel: readText(raw.ctaLabel, WIDGET_TEXT_FIELDS.ctaLabel.max),
    prefillGeneral: readText(raw.prefillGeneral, WIDGET_TEXT_FIELDS.prefillGeneral.max),
    prefillProduct: readText(raw.prefillProduct, WIDGET_TEXT_FIELDS.prefillProduct.max),
    thankYouButtonLabel: readText(raw.thankYouButtonLabel, WIDGET_TEXT_FIELDS.thankYouButtonLabel.max),
    prefillThankYou: readText(raw.prefillThankYou, WIDGET_TEXT_FIELDS.prefillThankYou.max),
    accent: readEnum(raw.accent, WIDGET_ACCENTS, DEFAULT_WHATSAPP_WIDGET_CONFIG.accent),
    position: readEnum(raw.position, WIDGET_POSITIONS, DEFAULT_WHATSAPP_WIDGET_CONFIG.position),
    attention: raw.attention !== false,
    surfaces: readSurfaces(raw.surfaces),
  };
}

/**
 * The wa.me link for a number, or null when the number cannot be dialled.
 *
 * wa.me takes digits only — a "+" in the path yields a page that tells the
 * shopper the number is invalid, which is worse than no button at all.
 */
export function toWhatsAppHref(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const e164 = normalizeAlgerianPhone(phone);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}

/**
 * What the storefront gets: the widget, or `null` when there is nothing to
 * render.
 *
 * Three different failures collapse into that one null — switched off, no
 * number, and a stored number that no longer normalises — because the theme
 * should hold exactly one rule about this feature: render it, or don't.
 */
export function resolveStorefrontWidget(
  json: string | null | undefined,
): StorefrontWhatsAppWidget | null {
  const config = parseWhatsAppWidgetConfig(json);
  if (!config.enabled) return null;

  const href = toWhatsAppHref(config.phone);
  if (!href) return null;

  return {
    href,
    agentName: config.agentName,
    caption: config.caption,
    avatarUrl: config.avatarUrl,
    welcomeMessage: config.welcomeMessage,
    launcherLabel: config.launcherLabel,
    ctaLabel: config.ctaLabel,
    prefillGeneral: config.prefillGeneral,
    prefillProduct: config.prefillProduct,
    thankYouButtonLabel: config.thankYouButtonLabel,
    prefillThankYou: config.prefillThankYou,
    accent: config.accent,
    position: config.position,
    attention: config.attention,
    surfaces: config.surfaces,
  };
}

/**
 * True when the config is byte-for-byte "no widget".
 *
 * The save path stores NULL in that case instead of an equivalent blob, so
 * "never configured" and "configured back to nothing" are the same row state,
 * and the documented rollback (`SET whatsapp_widget_json = NULL`) is also what
 * a merchant can do from the UI.
 */
export function isDefaultWhatsAppWidgetConfig(config: WhatsAppWidgetConfig): boolean {
  const d = DEFAULT_WHATSAPP_WIDGET_CONFIG;
  return (
    config.enabled === d.enabled &&
    config.phone === d.phone &&
    config.accent === d.accent &&
    config.position === d.position &&
    config.attention === d.attention &&
    WIDGET_TEXT_FIELD_KEYS.every((key) => config[key] === d[key]) &&
    config.avatarUrl === d.avatarUrl &&
    WIDGET_SURFACE_KEYS.every((key) => config.surfaces[key] === d.surfaces[key])
  );
}

/** Canonical JSON for storage — key order fixed so a no-op save is a no-op diff. */
export function serializeWhatsAppWidgetConfig(config: WhatsAppWidgetConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    phone: config.phone,
    agentName: config.agentName,
    caption: config.caption,
    avatarUrl: config.avatarUrl,
    welcomeMessage: config.welcomeMessage,
    launcherLabel: config.launcherLabel,
    ctaLabel: config.ctaLabel,
    prefillGeneral: config.prefillGeneral,
    prefillProduct: config.prefillProduct,
    thankYouButtonLabel: config.thankYouButtonLabel,
    prefillThankYou: config.prefillThankYou,
    accent: config.accent,
    position: config.position,
    attention: config.attention,
    surfaces: WIDGET_SURFACE_KEYS.reduce<Record<string, boolean>>((acc, key) => {
      acc[key] = config.surfaces[key];
      return acc;
    }, {}),
  });
}
