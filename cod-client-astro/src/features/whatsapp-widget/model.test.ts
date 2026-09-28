import { describe, it, expect } from "vitest";
import {
  toDraft,
  toPayload,
  isDirty,
  getPhonePreview,
  validateDraft,
  resolveDraftPreview,
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
} from "./model";
import type { WhatsAppWidgetConfig, WhatsAppWidgetDraft } from "./types";

const SAVED_CONFIG: WhatsAppWidgetConfig = {
  ...DEFAULT_WHATSAPP_WIDGET_CONFIG,
  enabled: true,
  phone: "+213551234567",
  agentName: "Amine",
  caption: "Replies in minutes",
  avatarUrl: "https://example.com/avatar.jpg",
  welcomeMessage: "Hello!",
  launcherLabel: "Chat with us",
  ctaLabel: "Open WhatsApp",
  prefillGeneral: "General question",
  prefillProduct: "Product question",
  accent: "whatsapp",
  position: "right",
  attention: true,
  surfaces: {
    home: true,
    catalog: true,
    product: true,
    pages: true,
    thankYou: true,
    checkout: false,
    landing: false,
  },
};

describe("toDraft and toPayload round-trip", () => {
  it("converts null fields in config to empty strings in draft", () => {
    const draft = toDraft(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    expect(draft.phone).toBe("");
    expect(draft.agentName).toBe("");
    expect(draft.caption).toBe("");
    expect(draft.avatarUrl).toBe("");
    expect(draft.welcomeMessage).toBe("");
    expect(draft.launcherLabel).toBe("");
    expect(draft.ctaLabel).toBe("");
    expect(draft.prefillGeneral).toBe("");
    expect(draft.prefillProduct).toBe("");
  });

  it("converts empty strings in draft to null in payload", () => {
    const draft = toDraft(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    const payload = toPayload(draft);
    expect(payload.phone).toBeNull();
    expect(payload.agentName).toBeNull();
    expect(payload.caption).toBeNull();
    expect(payload.avatarUrl).toBeNull();
  });

  it("trims whitespace from text fields when constructing payload", () => {
    const draft = toDraft(SAVED_CONFIG);
    draft.agentName = "  Amine  ";
    draft.caption = "  Replies soon  ";
    const payload = toPayload(draft);
    expect(payload.agentName).toBe("Amine");
    expect(payload.caption).toBe("Replies soon");
  });
});

describe("isDirty", () => {
  it("returns false when draft matches saved config", () => {
    const draft = toDraft(SAVED_CONFIG);
    expect(isDirty(draft, SAVED_CONFIG)).toBe(false);
  });

  it("returns true when enabled state changes", () => {
    const draft = toDraft(SAVED_CONFIG);
    draft.enabled = false;
    expect(isDirty(draft, SAVED_CONFIG)).toBe(true);
  });

  it("returns true when text field changes", () => {
    const draft = toDraft(SAVED_CONFIG);
    draft.caption = "Something else";
    expect(isDirty(draft, SAVED_CONFIG)).toBe(true);
  });

  it("returns true when a surface toggle changes", () => {
    const draft = toDraft(SAVED_CONFIG);
    draft.surfaces.checkout = true;
    expect(isDirty(draft, SAVED_CONFIG)).toBe(true);
  });
});

describe("getPhonePreview (normalisation echo)", () => {
  it("echoes normalised E.164 for Algerian local number 0551234567", () => {
    const preview = getPhonePreview("0551234567");
    expect(preview.isValid).toBe(true);
    expect(preview.e164).toBe("+213551234567");
  });

  it("handles spaced or dashed inputs", () => {
    const preview = getPhonePreview("055 12-34 567");
    expect(preview.isValid).toBe(true);
    expect(preview.e164).toBe("+213551234567");
  });

  it("handles international prefix 00213...", () => {
    const preview = getPhonePreview("00213551234567");
    expect(preview.isValid).toBe(true);
    expect(preview.e164).toBe("+213551234567");
  });

  it("accepts valid foreign international number +33612345678", () => {
    const preview = getPhonePreview("+33612345678");
    expect(preview.isValid).toBe(true);
    expect(preview.e164).toBe("+33612345678");
  });

  it("rejects Algerian landlines (021...)", () => {
    const preview = getPhonePreview("021123456");
    expect(preview.isValid).toBe(false);
    expect(preview.e164).toBeNull();
  });

  it("rejects empty or gibberish input", () => {
    expect(getPhonePreview("").isValid).toBe(false);
    expect(getPhonePreview("abc").isValid).toBe(false);
  });
});

describe("validateDraft (save blockers)", () => {
  it("blocks saving when enabled is true but phone is missing", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      phone: "",
      enabled: true,
    };
    const blockers = validateDraft(draft);
    expect(blockers).toEqual([{ field: "phone", message: "phone_required" }]);
  });

  it("blocks saving when phone is invalid", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      phone: "invalid-phone",
      enabled: true,
    };
    const blockers = validateDraft(draft);
    expect(blockers).toEqual([{ field: "phone", message: "phone_invalid" }]);
  });

  it("blocks saving when text exceeds max length", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      agentName: "A".repeat(50), // max 40
    };
    const blockers = validateDraft(draft);
    expect(blockers).toEqual([{ field: "agentName", message: "agent_name_too_long" }]);
  });

  it("blocks saving when avatarUrl is http instead of https", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      avatarUrl: "http://insecure.com/pic.jpg",
    };
    const blockers = validateDraft(draft);
    expect(blockers).toEqual([{ field: "avatarUrl", message: "avatar_url_https_only" }]);
  });
});

describe("resolveDraftPreview", () => {
  it("returns null when widget is disabled", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      enabled: false,
    };
    expect(resolveDraftPreview(draft)).toBeNull();
  });

  it("returns null when phone is missing or unparseable", () => {
    const draft: WhatsAppWidgetDraft = {
      ...toDraft(SAVED_CONFIG),
      enabled: true,
      phone: "021999999", // landline
    };
    expect(resolveDraftPreview(draft)).toBeNull();
  });

  it("returns complete preview with digits-only wa.me href when valid", () => {
    const draft = toDraft(SAVED_CONFIG);
    const preview = resolveDraftPreview(draft);
    expect(preview).not.toBeNull();
    expect(preview?.href).toBe("https://wa.me/213551234567");
    expect(preview?.agentName).toBe("Amine");
  });
});
