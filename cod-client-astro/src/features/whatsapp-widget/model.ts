/**
 * Presentation logic for the WhatsApp Widget dashboard screen.
 * Pure model: no API imports, fully unit-testable.
 */

import { normalizeAlgerianPhone } from "../../../../cod-shared/lib/phone";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  WIDGET_LIMITS,
  WIDGET_TEXT_FIELDS,
  toWhatsAppHref,
} from "../../../../cod-shared/whatsapp-widget/config";
import type {
  WhatsAppWidgetConfig,
  WhatsAppWidgetDraft,
  WhatsAppWidgetCapabilities,
  StorefrontWhatsAppPreview,
  SaveBlocker,
} from "./types";

export { DEFAULT_WHATSAPP_WIDGET_CONFIG, WIDGET_LIMITS, WIDGET_TEXT_FIELDS };

export interface WhatsAppDefaults {
  caption: string;
  welcomeMessage: string;
  ctaLabel: string;
  prefillGeneral: string;
  prefillProduct: string;
  thankYouButtonLabel: string;
  prefillThankYou: string;
}

export function toDraft(
  config: WhatsAppWidgetConfig,
  defaults?: WhatsAppDefaults,
): WhatsAppWidgetDraft {
  return {
    enabled: config.enabled,
    phone: config.phone ?? "",
    agentName: config.agentName ?? "",
    caption: config.caption ?? defaults?.caption ?? "",
    avatarUrl: config.avatarUrl ?? "",
    welcomeMessage: config.welcomeMessage ?? defaults?.welcomeMessage ?? "",
    launcherLabel: config.launcherLabel ?? "",
    ctaLabel: config.ctaLabel ?? defaults?.ctaLabel ?? "",
    prefillGeneral: config.prefillGeneral ?? defaults?.prefillGeneral ?? "",
    prefillProduct: config.prefillProduct ?? defaults?.prefillProduct ?? "",
    thankYouButtonLabel: config.thankYouButtonLabel ?? defaults?.thankYouButtonLabel ?? "",
    prefillThankYou: config.prefillThankYou ?? defaults?.prefillThankYou ?? "",
    accent: config.accent,
    position: config.position,
    attention: config.attention,
    surfaces: { ...config.surfaces },
  };
}

function cleanText(val: string): string | null {
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toPayload(draft: WhatsAppWidgetDraft): WhatsAppWidgetConfig {
  const normalizedPhone = draft.phone ? normalizeAlgerianPhone(draft.phone) : null;

  return {
    enabled: draft.enabled,
    phone: normalizedPhone ?? cleanText(draft.phone),
    agentName: cleanText(draft.agentName),
    caption: cleanText(draft.caption),
    avatarUrl: cleanText(draft.avatarUrl),
    welcomeMessage: cleanText(draft.welcomeMessage),
    launcherLabel: cleanText(draft.launcherLabel),
    ctaLabel: cleanText(draft.ctaLabel),
    prefillGeneral: cleanText(draft.prefillGeneral),
    prefillProduct: cleanText(draft.prefillProduct),
    thankYouButtonLabel: cleanText(draft.thankYouButtonLabel),
    prefillThankYou: cleanText(draft.prefillThankYou),
    accent: draft.accent,
    position: draft.position,
    attention: draft.attention,
    surfaces: { ...draft.surfaces },
  };
}

export function isDirty(draft: WhatsAppWidgetDraft, saved: WhatsAppWidgetConfig): boolean {
  const payload = toPayload(draft);

  if (payload.enabled !== saved.enabled) return true;
  if (payload.phone !== saved.phone) return true;
  if (payload.agentName !== saved.agentName) return true;
  if (payload.caption !== saved.caption) return true;
  if (payload.avatarUrl !== saved.avatarUrl) return true;
  if (payload.welcomeMessage !== saved.welcomeMessage) return true;
  if (payload.launcherLabel !== saved.launcherLabel) return true;
  if (payload.ctaLabel !== saved.ctaLabel) return true;
  if (payload.prefillGeneral !== saved.prefillGeneral) return true;
  if (payload.prefillProduct !== saved.prefillProduct) return true;
  if (payload.thankYouButtonLabel !== saved.thankYouButtonLabel) return true;
  if (payload.prefillThankYou !== saved.prefillThankYou) return true;
  if (payload.accent !== saved.accent) return true;
  if (payload.position !== saved.position) return true;
  if (payload.attention !== saved.attention) return true;

  const draftSurfaces = payload.surfaces;
  const savedSurfaces = saved.surfaces;
  return (
    draftSurfaces.home !== savedSurfaces.home ||
    draftSurfaces.catalog !== savedSurfaces.catalog ||
    draftSurfaces.product !== savedSurfaces.product ||
    draftSurfaces.pages !== savedSurfaces.pages ||
    draftSurfaces.thankYou !== savedSurfaces.thankYou ||
    draftSurfaces.checkout !== savedSurfaces.checkout ||
    draftSurfaces.landing !== savedSurfaces.landing
  );
}

export function getPhonePreview(rawPhone: string): { e164: string | null; isValid: boolean } {
  if (!rawPhone || !rawPhone.trim()) {
    return { e164: null, isValid: false };
  }
  const normalized = normalizeAlgerianPhone(rawPhone);
  return {
    e164: normalized,
    isValid: normalized !== null,
  };
}

export function validateDraft(
  draft: WhatsAppWidgetDraft,
  caps?: WhatsAppWidgetCapabilities,
): SaveBlocker[] {
  const blockers: SaveBlocker[] = [];
  const textLimits = caps?.limits ?? {};

  if (draft.enabled) {
    if (!draft.phone || !draft.phone.trim()) {
      blockers.push({ field: "phone", message: "phone_required" });
    } else {
      const normalized = normalizeAlgerianPhone(draft.phone);
      if (!normalized) {
        blockers.push({ field: "phone", message: "phone_invalid" });
      }
    }
  } else if (draft.phone && draft.phone.trim()) {
    // If phone is provided even while disabled, validate it
    const normalized = normalizeAlgerianPhone(draft.phone);
    if (!normalized) {
      blockers.push({ field: "phone", message: "phone_invalid" });
    }
  }

  // Length limits - use WIDGET_TEXT_FIELDS as fallback
  if (draft.agentName.length > (textLimits.agentName ?? WIDGET_TEXT_FIELDS.agentName.max)) {
    blockers.push({ field: "agentName", message: "agent_name_too_long" });
  }
  if (draft.caption.length > (textLimits.caption ?? WIDGET_TEXT_FIELDS.caption.max)) {
    blockers.push({ field: "caption", message: "caption_too_long" });
  }
  if (draft.launcherLabel.length > (textLimits.launcherLabel ?? WIDGET_TEXT_FIELDS.launcherLabel.max)) {
    blockers.push({ field: "launcherLabel", message: "launcher_label_too_long" });
  }
  if (draft.ctaLabel.length > (textLimits.ctaLabel ?? WIDGET_TEXT_FIELDS.ctaLabel.max)) {
    blockers.push({ field: "ctaLabel", message: "cta_label_too_long" });
  }
  if (draft.welcomeMessage.length > (textLimits.welcomeMessage ?? WIDGET_TEXT_FIELDS.welcomeMessage.max)) {
    blockers.push({ field: "welcomeMessage", message: "welcome_message_too_long" });
  }
  if (draft.prefillGeneral.length > (textLimits.prefillGeneral ?? WIDGET_TEXT_FIELDS.prefillGeneral.max)) {
    blockers.push({ field: "prefillGeneral", message: "prefill_general_too_long" });
  }
  if (draft.prefillProduct.length > (textLimits.prefillProduct ?? WIDGET_TEXT_FIELDS.prefillProduct.max)) {
    blockers.push({ field: "prefillProduct", message: "prefill_product_too_long" });
  }
  if (draft.thankYouButtonLabel.length > (textLimits.thankYouButtonLabel ?? WIDGET_TEXT_FIELDS.thankYouButtonLabel.max)) {
    blockers.push({ field: "thankYouButtonLabel", message: "thank_you_button_label_too_long" });
  }
  if (draft.prefillThankYou.length > (textLimits.prefillThankYou ?? WIDGET_TEXT_FIELDS.prefillThankYou.max)) {
    blockers.push({ field: "prefillThankYou", message: "prefill_thank_you_too_long" });
  }

  // Avatar URL
  if (draft.avatarUrl && draft.avatarUrl.trim()) {
    const trimmed = draft.avatarUrl.trim();
    if (trimmed.length > (textLimits.avatarUrl ?? WIDGET_LIMITS.MAX_AVATAR_URL_LENGTH)) {
      blockers.push({ field: "avatarUrl", message: "avatar_url_too_long" });
    } else if (!trimmed.startsWith("https://")) {
      blockers.push({ field: "avatarUrl", message: "avatar_url_https_only" });
    }
  }

  return blockers;
}

export function resolveDraftPreview(
  draft: WhatsAppWidgetDraft,
): StorefrontWhatsAppPreview | null {
  if (!draft.enabled) return null;
  if (!draft.phone || !draft.phone.trim()) return null;

  const normalizedPhone = normalizeAlgerianPhone(draft.phone);
  if (!normalizedPhone) return null;

  const href = toWhatsAppHref(normalizedPhone);
  if (!href) return null;

  return {
    href,
    agentName: cleanText(draft.agentName),
    caption: cleanText(draft.caption),
    avatarUrl: cleanText(draft.avatarUrl),
    welcomeMessage: cleanText(draft.welcomeMessage),
    launcherLabel: cleanText(draft.launcherLabel),
    ctaLabel: cleanText(draft.ctaLabel),
    prefillGeneral: cleanText(draft.prefillGeneral),
    prefillProduct: cleanText(draft.prefillProduct),
    accent: draft.accent,
    position: draft.position,
    attention: draft.attention,
    surfaces: { ...draft.surfaces },
  };
}
