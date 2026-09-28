/**
 * Algerian phone normalization — the single definition.
 *
 * Two shapes exist in this product and they are not interchangeable:
 *
 *   E.164 ("+213551234567")   — what dzverify requires, and what a `wa.me`
 *                               link is built from.
 *   local  ("0551234567")     — what orders store and what customers are
 *                               deduplicated on.
 *
 * It lives in cod-shared because three callers now need it from two packages:
 * the storefront order schema, the OTP send path, and the merchant's own
 * WhatsApp number on the widget's write path. A second copy of these rules is
 * how "0551234567" and "+213551234567" become two customers, or a widget that
 * links to a number nobody answers.
 *
 * Accepted inputs (Algerian mobile):
 *   "0551234567"  "5 51-234 567"  "0551234567 "  → "+213551234567"
 *   "+213551234567" "213551234567" "00213…"      → "+213551234567"
 *   Other countries pass through when already "+CC…" shaped.
 */

const ALGERIAN_COUNTRY_CODE = "213";
const ALGERIAN_MOBILE_PREFIX = /^[567]/;

/** Strip visual separators — dzverify rejects spaces and dashes. */
function clean(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

export function normalizeAlgerianPhone(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let phone = clean(raw.trim());
  if (phone.length < 6 || phone.length > 20) return null;

  // International dialing prefix "00" (e.g. "00213551234567") — treat as "+".
  if (phone.startsWith("00")) {
    phone = `+${phone.slice(2)}`;
  }

  // Already international: keep the + form. E.164 allows 7–15 digits after +.
  if (phone.startsWith("+")) {
    return /^\+\d{7,15}$/.test(phone) ? phone : null;
  }

  // "213…" without the + — complete it.
  if (phone.startsWith(ALGERIAN_COUNTRY_CODE)) {
    const rest = phone.slice(ALGERIAN_COUNTRY_CODE.length);
    return ALGERIAN_MOBILE_PREFIX.test(rest) ? `+${phone}` : null;
  }

  // Local form: 0-prefixed or bare Algerian mobile.
  const local = phone.startsWith("0") ? phone.slice(1) : phone;
  if (local.length === 9 && ALGERIAN_MOBILE_PREFIX.test(local)) {
    return `+${ALGERIAN_COUNTRY_CODE}${local}`;
  }

  return null;
}

/**
 * Canonical local form of an Algerian mobile: "0551234567".
 * Returns null for anything that is not an Algerian mobile (foreign +CC,
 * landlines, too-short/long inputs). This is the format orders store and
 * customers are deduplicated on.
 */
export function toLocalAlgerianMobile(raw: string): string | null {
  const e164 = normalizeAlgerianPhone(raw);
  if (!e164 || !e164.startsWith("+213")) return null;
  const local = e164.slice(4); // strip "+213"
  return /^[567]\d{8}$/.test(local) ? `0${local}` : null;
}
