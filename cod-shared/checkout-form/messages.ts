/**
 * Shopper-facing text for a policy rejection, in the store's own language.
 *
 * These live in cod-shared rather than in the theme's content packs because the
 * server is what rejects: by the time the shopper sees this, the request has
 * left the storefront and the theme has no say in the outcome. A theme can
 * still restyle the banner; it cannot be asked to know why cod-server refused.
 *
 * `StoreLanguage` mirrors `stores.lang`. Every code must exist in all three —
 * `messages.test.ts` fails the build otherwise, the same discipline the
 * dashboard's i18n guard applies to its own locales.
 */

import type { CheckoutPolicyRejection, CheckoutPolicyRejectionCode } from "./apply";

export type StoreLanguage = "ar" | "en" | "fr";

type MessageTemplate = string | ((label: string) => string);

const MESSAGES: Record<StoreLanguage, Record<CheckoutPolicyRejectionCode, MessageTemplate>> = {
  ar: {
    DELIVERY_OPTION_UNAVAILABLE:
      "طريقة التوصيل المختارة لم تعد متاحة — يرجى تحديث الصفحة واختيار طريقة أخرى",
    ADDRESS_REQUIRED: "العنوان مطلوب للتوصيل إلى المنزل",
    EMAIL_REQUIRED: "البريد الإلكتروني مطلوب",
    EMAIL_INVALID: "البريد الإلكتروني غير صحيح",
    CUSTOM_FIELD_REQUIRED: (label) => `${label} مطلوب`,
    CUSTOM_FIELD_INVALID_CHOICE: (label) => `اختيار غير صحيح في ${label}`,
    CUSTOM_FIELD_NOT_A_NUMBER: (label) => `${label} يجب أن يكون رقماً`,
    CUSTOM_FIELD_TOO_LONG: (label) => `${label} طويل جداً`,
  },
  fr: {
    DELIVERY_OPTION_UNAVAILABLE:
      "Ce mode de livraison n'est plus disponible — actualisez la page et choisissez-en un autre",
    ADDRESS_REQUIRED: "L'adresse est obligatoire pour la livraison à domicile",
    EMAIL_REQUIRED: "L'e-mail est obligatoire",
    EMAIL_INVALID: "L'e-mail n'est pas valide",
    CUSTOM_FIELD_REQUIRED: (label) => `${label} est obligatoire`,
    CUSTOM_FIELD_INVALID_CHOICE: (label) => `Choix non valide pour ${label}`,
    CUSTOM_FIELD_NOT_A_NUMBER: (label) => `${label} doit être un nombre`,
    CUSTOM_FIELD_TOO_LONG: (label) => `${label} est trop long`,
  },
  en: {
    DELIVERY_OPTION_UNAVAILABLE:
      "That delivery option is no longer available — refresh the page and pick another",
    ADDRESS_REQUIRED: "An address is required for home delivery",
    EMAIL_REQUIRED: "Email is required",
    EMAIL_INVALID: "That email address is not valid",
    CUSTOM_FIELD_REQUIRED: (label) => `${label} is required`,
    CUSTOM_FIELD_INVALID_CHOICE: (label) => `Invalid choice for ${label}`,
    CUSTOM_FIELD_NOT_A_NUMBER: (label) => `${label} must be a number`,
    CUSTOM_FIELD_TOO_LONG: (label) => `${label} is too long`,
  },
};

/**
 * Resolve the message for a rejection.
 *
 * An unknown language falls back to Arabic, which is the column default and the
 * language of nearly every store on the platform — an English string in an
 * Arabic checkout is worse than a fallback nobody notices.
 */
export function checkoutPolicyMessage(
  lang: string | null | undefined,
  rejection: CheckoutPolicyRejection,
): string {
  const table = MESSAGES[(lang ?? "ar") as StoreLanguage] ?? MESSAGES.ar;
  const template = table[rejection.code];
  return typeof template === "function" ? template(rejection.label ?? "") : template;
}

/** Exported for the parity test — not part of the runtime surface. */
export const CHECKOUT_POLICY_MESSAGES = MESSAGES;
