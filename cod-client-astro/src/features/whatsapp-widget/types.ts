/**
 * Types for the WhatsApp Widget dashboard feature.
 */

export interface WhatsAppWidgetSurfaces {
  home: boolean;
  catalog: boolean;
  product: boolean;
  pages: boolean;
  thankYou: boolean;
  checkout: boolean;
  landing: boolean;
}

export type WhatsAppWidgetAccent = "whatsapp" | "primary";
export type WhatsAppWidgetPosition = "right" | "left";

export interface WhatsAppWidgetConfig {
  enabled: boolean;
  phone: string | null;
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
  accent: WhatsAppWidgetAccent;
  position: WhatsAppWidgetPosition;
  attention: boolean;
  surfaces: WhatsAppWidgetSurfaces;
}

export interface StorefrontWhatsAppPreview {
  href: string;
  agentName: string | null;
  caption: string | null;
  avatarUrl: string | null;
  welcomeMessage: string | null;
  launcherLabel: string | null;
  ctaLabel: string | null;
  prefillGeneral: string | null;
  prefillProduct: string | null;
  accent: WhatsAppWidgetAccent;
  position: WhatsAppWidgetPosition;
  attention: boolean;
  surfaces: WhatsAppWidgetSurfaces;
}

export interface WhatsAppWidgetCapabilities {
  textFields: Record<string, { max: number }>;
  surfaces: Record<string, { default: boolean }>;
  surfaceOrder: Array<keyof WhatsAppWidgetSurfaces>;
  accents: WhatsAppWidgetAccent[];
  positions: WhatsAppWidgetPosition[];
  prefillTokens: string[];
  limits: Record<string, number>;
}

export interface WhatsAppWidgetResponse {
  config: WhatsAppWidgetConfig;
  preview: StorefrontWhatsAppPreview | null;
  capabilities: WhatsAppWidgetCapabilities;
}

export interface WhatsAppWidgetDraft {
  enabled: boolean;
  phone: string;
  agentName: string;
  caption: string;
  avatarUrl: string;
  welcomeMessage: string;
  launcherLabel: string;
  ctaLabel: string;
  prefillGeneral: string;
  prefillProduct: string;
  thankYouButtonLabel: string;
  prefillThankYou: string;
  accent: WhatsAppWidgetAccent;
  position: WhatsAppWidgetPosition;
  attention: boolean;
  surfaces: WhatsAppWidgetSurfaces;
}

export interface SaveBlocker {
  field: string;
  message: string;
}
