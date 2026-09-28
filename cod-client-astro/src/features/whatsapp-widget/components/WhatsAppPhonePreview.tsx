import { useState } from "react";
import { MessageCircle, X, Wifi, Battery, Check } from "lucide-react";
import { Select } from "@/components/ui";
import type {
  StorefrontWhatsAppPreview,
  WhatsAppWidgetDraft,
  WhatsAppWidgetSurfaces,
} from "../types";

export function WhatsAppPhonePreview({
  draft,
  preview,
  t,
}: {
  draft: WhatsAppWidgetDraft;
  preview: StorefrontWhatsAppPreview | null;
  t: (key: string) => string;
}) {
  const [surface, setSurface] = useState<keyof WhatsAppWidgetSurfaces>("product");
  const [panelOpen, setPanelOpen] = useState(true);

  const surfaceKeys: Array<keyof WhatsAppWidgetSurfaces> = [
    "product",
    "home",
    "catalog",
    "pages",
    "thankYou",
    "checkout",
    "landing",
  ];

  const surfaceLabels: Record<keyof WhatsAppWidgetSurfaces, string> = {
    product: t("surface_product"),
    home: t("surface_home"),
    catalog: t("surface_catalog"),
    pages: t("surface_pages"),
    thankYou: t("surface_thank_you"),
    checkout: t("surface_checkout"),
    landing: t("surface_landing"),
  };

  const isSurfaceActive = preview ? preview.surfaces[surface] : false;

  // Resolve prefill preview text according to surface and honest tokens
  function getPreviewPrefillText(): string {
    if (!preview) return "";
    const store = t("preview_sample_store");
    const product = t("preview_sample_product");
    const order = t("preview_sample_order");
    const url = "store.example/p/headphones";

    const rawTemplate =
      surface === "product"
        ? (preview.prefillProduct || preview.prefillGeneral || "")
        : (preview.prefillGeneral || "");

    return rawTemplate
      .replace(/{product}/g, product)
      .replace(/{url}/g, url)
      .replace(/{order}/g, order)
      .replace(/{store}/g, store);
  }

  const prefillText = getPreviewPrefillText();

  // Accent styling
  const isWaGreen = preview?.accent === "whatsapp";
  const launcherBgClass = isWaGreen ? "bg-[#25D366] text-white" : "bg-primary text-primary-foreground";
  const ctaBgClass = isWaGreen ? "bg-[#128C7E] hover:bg-[#075E54] text-white" : "bg-primary text-primary-foreground";
  const positionClass = preview?.position === "left" ? "left-3" : "right-3";

  return (
    <div className="space-y-3">
      {/* Surface Selector Bar */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 p-1.5">
        <label htmlFor="preview-surface-select" className="text-xs font-semibold text-muted-foreground px-1">
          {t("preview_surface")}
        </label>
        <div className="w-44">
          <Select
            id="preview-surface-select"
            size="sm"
            value={surface}
            onChange={(e) => setSurface(e.target.value as keyof WhatsAppWidgetSurfaces)}
          >
            {surfaceKeys.map((s) => (
              <option key={s} value={s}>
                {surfaceLabels[s]} {draft.surfaces[s] ? "" : "(off)"}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Phone Frame */}
      <div className="mx-auto w-full max-w-76 rounded-[2.25rem] border-[6px] border-foreground/10 bg-muted/20 p-2 shadow-md">
        <div className="relative flex flex-col h-[520px] overflow-hidden rounded-[1.75rem] bg-card border border-border/60">
          {/* Phone Top Notch / Status Bar */}
          <div className="flex h-6 shrink-0 items-center justify-between px-4 pt-1 text-[10px] font-semibold text-foreground/70">
            <span>9:41</span>
            <div className="h-3 w-16 rounded-full bg-foreground/15" />
            <div className="flex items-center gap-1">
              <Wifi size={10} />
              <Battery size={10} />
            </div>
          </div>

          {/* Simulated Storefront Header */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3 py-1">
            <span className="text-xs font-bold tracking-tight text-foreground truncate max-w-[130px]">
              {t("preview_sample_store")}
            </span>
            <span className="text-[10px] text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
              COD
            </span>
          </div>

          {/* Simulated Page Content */}
          <div className="flex-1 overflow-y-auto p-3 text-xs space-y-3 bg-muted/10">
            {surface === "product" && (
              <div className="space-y-2">
                <div className="aspect-4/3 w-full rounded-lg bg-muted/60 flex items-center justify-center text-muted-foreground/50 text-[11px]">
                  🎧 Product Image
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-xs leading-tight">
                    {t("preview_sample_product")}
                  </h4>
                  <p className="mt-0.5 font-bold text-primary text-xs">4,500 DZD</p>
                </div>
                <div className="h-12 rounded bg-muted/40 p-2 text-[10px] text-muted-foreground leading-relaxed">
                  High quality wireless sound with active noise cancellation.
                </div>
              </div>
            )}

            {surface === "home" && (
              <div className="space-y-2">
                <div className="h-24 w-full rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                  🔥 Big Summer Sale
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-20 rounded bg-muted/40" />
                  <div className="h-20 rounded bg-muted/40" />
                </div>
              </div>
            )}

            {surface === "catalog" && (
              <div className="space-y-2">
                <p className="font-semibold text-xs text-foreground">Catalog</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-24 rounded bg-muted/40" />
                  <div className="h-24 rounded bg-muted/40" />
                  <div className="h-24 rounded bg-muted/40" />
                  <div className="h-24 rounded bg-muted/40" />
                </div>
              </div>
            )}

            {surface === "thankYou" && (
              <div className="mt-8 text-center space-y-2">
                <div className="mx-auto size-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <Check size={16} />
                </div>
                <p className="font-bold text-xs text-foreground">Order Confirmed!</p>
                <p className="text-[11px] text-muted-foreground">
                  Order #<span className="font-mono">{t("preview_sample_order")}</span>
                </p>
              </div>
            )}

            {surface === "checkout" && (
              <div className="space-y-2 pt-2">
                <p className="font-semibold text-xs text-foreground">Checkout</p>
                <div className="h-7 rounded border border-border/60 bg-card" />
                <div className="h-7 rounded border border-border/60 bg-card" />
                <div className="h-7 rounded border border-border/60 bg-card" />
              </div>
            )}

            {surface === "pages" && (
              <div className="space-y-2 pt-2">
                <p className="font-semibold text-xs text-foreground">About Us</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  We are Algeria's trusted e-commerce destination with express home delivery.
                </p>
              </div>
            )}

            {surface === "landing" && (
              <div className="space-y-2">
                <div className="h-28 rounded-lg bg-muted/50" />
                <div className="h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-bold text-[10px]">
                  Order Now - COD
                </div>
              </div>
            )}
          </div>

          {/* Sticky CTA on product page */}
          {surface === "product" && (
            <div className="h-10 border-t border-border/60 bg-card/95 px-3 py-1 flex items-center justify-between">
              <span className="text-[11px] font-bold text-foreground">4,500 DZD</span>
              <button
                type="button"
                className="h-7 px-3 rounded bg-primary text-primary-foreground text-[10px] font-bold"
              >
                Order Now
              </button>
            </div>
          )}

          {/* Widget Overlay / Inactive States */}
          {!preview ? (
            <div className="absolute inset-x-3 bottom-6 rounded-xl border border-border/80 bg-card/95 p-3 text-center shadow-lg backdrop-blur-xs">
              <MessageCircle size={20} className="mx-auto text-muted-foreground mb-1" />
              <p className="font-semibold text-xs text-foreground">{t("preview_disabled_title")}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("preview_disabled_desc")}</p>
            </div>
          ) : !isSurfaceActive ? (
            <div className="absolute inset-x-3 bottom-6 rounded-xl border border-dashed border-border/90 bg-card/95 p-2.5 text-center shadow-sm">
              <p className="font-semibold text-xs text-muted-foreground">{t("preview_hidden_on_surface")}</p>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">{t("preview_hidden_desc")}</p>
            </div>
          ) : (
            <>
              {/* Chat Panel (if open) */}
              {panelOpen && (
                <div
                  className={`absolute bottom-16 ${positionClass} w-[240px] rounded-2xl border border-border/80 bg-card shadow-xl overflow-hidden flex flex-col animate-in fade-in-0 slide-in-from-bottom-2 duration-150 z-20`}
                >
                  {/* Panel Header */}
                  <div className={`p-2.5 flex items-center justify-between ${isWaGreen ? "bg-[#075E54] text-white" : "bg-primary text-primary-foreground"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {preview.avatarUrl ? (
                        <img
                          src={preview.avatarUrl}
                          alt=""
                          className="size-7 rounded-full object-cover shrink-0 ring-1 ring-white/40"
                        />
                      ) : (
                        <div className="size-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold shrink-0">
                          <MessageCircle size={14} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold truncate leading-tight">
                          {preview.agentName || t("preview_sample_store")}
                        </p>
                        <p className="text-[9px] opacity-90 truncate leading-tight">
                          {preview.caption || t("caption_placeholder")}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPanelOpen(false)}
                      className="size-5 rounded-full hover:bg-black/10 flex items-center justify-center shrink-0 opacity-80 hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Panel Message Body */}
                  <div className="p-2.5 space-y-2 bg-[#EFEAE2]/30 dark:bg-muted/30">
                    {/* Welcome message bubble */}
                    <div className="max-w-[85%] rounded-lg rounded-tl-none bg-card p-2 shadow-xs border border-border/50 text-[10.5px] leading-relaxed text-foreground">
                      {preview.welcomeMessage || t("welcome_placeholder")}
                    </div>

                    {/* Prefill preview (if configured) */}
                    {prefillText && (
                      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#DCF8C6] dark:bg-emerald-950/60 p-2 shadow-xs border border-emerald-300/40 text-[10px] leading-relaxed text-foreground">
                        <span className="block text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Prefill preview
                        </span>
                        {prefillText}
                      </div>
                    )}
                  </div>

                  {/* Panel CTA Button */}
                  <div className="p-2 border-t border-border/60 bg-card">
                    <button
                      type="button"
                      className={`w-full py-1.5 px-2.5 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition-colors ${ctaBgClass}`}
                    >
                      <MessageCircle size={13} />
                      <span className="truncate">{preview.ctaLabel || t("cta_placeholder")}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Launcher Button */}
              <button
                type="button"
                onClick={() => setPanelOpen(!panelOpen)}
                className={`absolute bottom-3 ${positionClass} h-11 px-3 rounded-full shadow-lg flex items-center gap-1.5 font-bold text-xs transition-transform active:scale-95 z-20 ${launcherBgClass} ${preview.attention ? "ring-4 ring-[#25D366]/30 animate-pulse" : ""}`}
              >
                <MessageCircle size={18} />
                {preview.launcherLabel && (
                  <span className="text-[11px] font-semibold truncate max-w-[90px]">
                    {preview.launcherLabel}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-center text-[10px] text-muted-foreground">
        {t("preview_click_to_open")}
      </p>
    </div>
  );
}
