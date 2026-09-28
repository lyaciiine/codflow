/**
 * WhatsApp Widget — the write path.
 *
 * Strict by design, and deliberately the mirror image of
 * `parseWhatsAppWidgetConfig`: reading a stored blob must never throw, but
 * accepting one from a human must refuse everything it does not understand. A
 * settings screen that silently drops a key is how "my changes didn't save"
 * bugs are born, and the merchant has no way to see the difference between
 * ignored and applied.
 *
 * The number is normalised here, once, so what is stored is always E.164 and
 * every reader downstream — the wa.me link, the dashboard, a future export —
 * sees the same string whichever way the merchant typed it.
 *
 * PUT semantics: the document replaces the whole config, so a key the caller
 * omits takes its default rather than keeping the stored value. That keeps
 * "what I see is what is saved" true for a screen that always sends the whole
 * form.
 */

import { normalizeAlgerianPhone } from "../lib/phone";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  WIDGET_ACCENTS,
  WIDGET_LIMITS,
  WIDGET_POSITIONS,
  WIDGET_SURFACE_KEYS,
  WIDGET_SURFACES,
  WIDGET_TEXT_FIELDS,
  WIDGET_TEXT_FIELD_KEYS,
  isHttpsUrl,
  type WhatsAppWidgetConfig,
  type WidgetAccent,
  type WidgetPosition,
  type WidgetSurfaces,
  type WidgetTextFieldKey,
} from "./config";

export type WidgetIssueCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_KEY"
  | "INVALID_FIELD"
  | "INVALID_PHONE"
  | "PHONE_REQUIRED"
  | "TEXT_TOO_LONG"
  | "INVALID_AVATAR_URL"
  | "INVALID_CHOICE";

export interface WidgetIssue {
  /** Dot path into the submitted document, e.g. `surfaces.checkout`. */
  path: string;
  code: WidgetIssueCode;
  /** Developer-facing English. The dashboard localises by `code`. */
  message: string;
}

export type WidgetValidationResult =
  | { ok: true; config: WhatsAppWidgetConfig }
  | { ok: false; issues: WidgetIssue[] };

const TOP_LEVEL_KEYS = new Set<string>([
  "enabled",
  "phone",
  "avatarUrl",
  "accent",
  "position",
  "attention",
  "surfaces",
  ...WIDGET_TEXT_FIELD_KEYS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(
  raw: Record<string, unknown>,
  key: string,
  fallback: boolean,
  issues: WidgetIssue[],
  path = key,
): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issues.push({ path, code: "INVALID_FIELD", message: `${path} must be true or false.` });
    return fallback;
  }
  return value;
}

function readTextStrict(
  raw: Record<string, unknown>,
  key: WidgetTextFieldKey,
  issues: WidgetIssue[],
): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issues.push({ path: key, code: "INVALID_FIELD", message: `${key} must be text.` });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const { max } = WIDGET_TEXT_FIELDS[key];
  if (trimmed.length > max) {
    issues.push({
      path: key,
      code: "TEXT_TOO_LONG",
      message: `${key} must be at most ${max} characters.`,
    });
    return null;
  }
  return trimmed;
}

function readEnumStrict<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  issues: WidgetIssue[],
): T {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push({
      path: key,
      code: "INVALID_CHOICE",
      message: `${key} must be one of: ${allowed.join(", ")}`,
    });
    return fallback;
  }
  return value as T;
}

function readAvatarUrlStrict(raw: Record<string, unknown>, issues: WidgetIssue[]): string | null {
  const value = raw.avatarUrl;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    issues.push({ path: "avatarUrl", code: "INVALID_FIELD", message: "avatarUrl must be text." });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > WIDGET_LIMITS.MAX_AVATAR_URL_LENGTH) {
    issues.push({
      path: "avatarUrl",
      code: "INVALID_AVATAR_URL",
      message: `avatarUrl must be at most ${WIDGET_LIMITS.MAX_AVATAR_URL_LENGTH} characters.`,
    });
    return null;
  }
  // Every shopper's browser loads this. An http image on an https storefront is
  // a mixed-content block in practice, so it is refused rather than stored.
  if (!isHttpsUrl(trimmed)) {
    issues.push({
      path: "avatarUrl",
      code: "INVALID_AVATAR_URL",
      message: "avatarUrl must be an https URL.",
    });
    return null;
  }
  return trimmed;
}

function readSurfacesStrict(raw: Record<string, unknown>, issues: WidgetIssue[]): WidgetSurfaces {
  const surfaces = {} as WidgetSurfaces;
  for (const key of WIDGET_SURFACE_KEYS) surfaces[key] = WIDGET_SURFACES[key].default;

  const value = raw.surfaces;
  if (value === undefined) return surfaces;
  if (!isRecord(value)) {
    issues.push({ path: "surfaces", code: "INVALID_FIELD", message: "surfaces must be an object." });
    return surfaces;
  }

  for (const key of Object.keys(value)) {
    if (!(WIDGET_SURFACE_KEYS as string[]).includes(key)) {
      issues.push({
        path: `surfaces.${key}`,
        code: "UNKNOWN_KEY",
        message: `Unknown surface: ${key}`,
      });
    }
  }
  for (const key of WIDGET_SURFACE_KEYS) {
    surfaces[key] = readBoolean(
      value,
      key,
      WIDGET_SURFACES[key].default,
      issues,
      `surfaces.${key}`,
    );
  }
  return surfaces;
}

/**
 * Validate a widget document submitted by the dashboard and normalise the
 * number.
 *
 * Every surface switched off is accepted: it is a deliberate "paused" state,
 * and refusing it would push the merchant into switching the whole widget off
 * and losing their text. The dashboard says plainly that it will not appear.
 */
export function validateWhatsAppWidgetInput(input: unknown): WidgetValidationResult {
  const issues: WidgetIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: "", code: "NOT_AN_OBJECT", message: "Expected a widget object." }],
    };
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({ path: key, code: "UNKNOWN_KEY", message: `Unknown key: ${key}` });
    }
  }

  const enabled = readBoolean(input, "enabled", DEFAULT_WHATSAPP_WIDGET_CONFIG.enabled, issues);

  let phone: string | null = null;
  const rawPhone = input.phone;
  if (rawPhone !== undefined && rawPhone !== null) {
    if (typeof rawPhone !== "string") {
      issues.push({ path: "phone", code: "INVALID_FIELD", message: "phone must be text." });
    } else if (rawPhone.trim() !== "") {
      // The merchant types what they know — "0551234567", "00213…", spaced,
      // or already international. One normaliser decides, the same one the OTP
      // path uses on a shopper's number.
      const e164 = normalizeAlgerianPhone(rawPhone);
      if (!e164) {
        issues.push({
          path: "phone",
          code: "INVALID_PHONE",
          message:
            "That is not a valid WhatsApp number. Use an Algerian mobile (0551234567) " +
            "or an international number with its country code (+33612345678).",
        });
      } else {
        phone = e164;
      }
    }
  }

  // Switched on with nowhere to go renders nothing, so the merchant would be
  // looking at an "on" switch and an empty storefront. Refused at the seam
  // where it can still be explained.
  if (enabled && phone === null && !issues.some((issue) => issue.path === "phone")) {
    issues.push({
      path: "phone",
      code: "PHONE_REQUIRED",
      message: "A WhatsApp number is required to turn the widget on.",
    });
  }

  const text = {} as Record<WidgetTextFieldKey, string | null>;
  for (const key of WIDGET_TEXT_FIELD_KEYS) text[key] = readTextStrict(input, key, issues);

  const avatarUrl = readAvatarUrlStrict(input, issues);
  const accent = readEnumStrict<WidgetAccent>(
    input,
    "accent",
    WIDGET_ACCENTS,
    DEFAULT_WHATSAPP_WIDGET_CONFIG.accent,
    issues,
  );
  const position = readEnumStrict<WidgetPosition>(
    input,
    "position",
    WIDGET_POSITIONS,
    DEFAULT_WHATSAPP_WIDGET_CONFIG.position,
    issues,
  );
  const attention = readBoolean(
    input,
    "attention",
    DEFAULT_WHATSAPP_WIDGET_CONFIG.attention,
    issues,
  );
  const surfaces = readSurfacesStrict(input, issues);

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    config: {
      enabled,
      phone,
      agentName: text.agentName,
      caption: text.caption,
      avatarUrl,
      welcomeMessage: text.welcomeMessage,
      launcherLabel: text.launcherLabel,
      ctaLabel: text.ctaLabel,
      prefillGeneral: text.prefillGeneral,
      prefillProduct: text.prefillProduct,
      thankYouButtonLabel: text.thankYouButtonLabel,
      prefillThankYou: text.prefillThankYou,
      accent,
      position,
      attention,
      surfaces,
    },
  };
}
