import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  Image as ImageIcon,
  Loader2,
  Phone,
  Trash2,
  Upload,
} from "lucide-react";
import { RequireAuth, canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  StickyFormActions,
  Textarea,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import { getWhatsAppWidget, putWhatsAppWidget } from "@/features/whatsapp-widget/api";
import {
  getPhonePreview,
  isDirty,
  toDraft,
  toPayload,
  validateDraft,
  type WhatsAppDefaults,
} from "@/features/whatsapp-widget/model";
import type {
  SaveBlocker,
  WhatsAppWidgetCapabilities,
  WhatsAppWidgetConfig,
  WhatsAppWidgetDraft,
  WhatsAppWidgetSurfaces,
} from "@/features/whatsapp-widget/types";

function WhatsAppWidgetContent() {
  const t = useT("whatsapp");
  const common = useT("common");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.WHATSAPP_WIDGET_MANAGE);

  const [saved, setSaved] = useState<WhatsAppWidgetConfig | null>(null);
  const [capabilities, setCapabilities] = useState<WhatsAppWidgetCapabilities | null>(null);
  const [draft, setDraft] = useState<WhatsAppWidgetDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  // Avatar upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { upload: uploadAvatar, progress: uploadProgress } = useImageUpload("products");

  // Get translated defaults for prefilling empty fields
  function getDefaults(): WhatsAppDefaults {
    return {
      caption: t("default_caption"),
      welcomeMessage: t("default_welcome"),
      ctaLabel: t("default_cta"),
      prefillGeneral: t("default_prefill_general"),
      prefillProduct: t("default_prefill_product"),
      thankYouButtonLabel: t("default_thank_you_button"),
      prefillThankYou: t("default_prefill_thank_you"),
    };
  }

  async function load() {
    setLoadError(null);
    try {
      const { config, capabilities: caps } = await getWhatsAppWidget();
      setSaved(config);
      setCapabilities(caps);
      setDraft(toDraft(config, getDefaults()));
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <AlertCircle size={18} className="shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{t("load_failed")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (!draft || !saved || !capabilities) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-60 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  // Capabilities & limits read directly from the API response
  const limits = capabilities.limits;
  const blockers: SaveBlocker[] = validateDraft(draft, capabilities);
  const dirty = isDirty(draft, saved);
  const phonePreview = getPhonePreview(draft.phone);

  function patch(next: Partial<WhatsAppWidgetDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function patchSurface(surfaceKey: keyof WhatsAppWidgetSurfaces, value: boolean) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        surfaces: {
          ...current.surfaces,
          [surfaceKey]: value,
        },
      };
    });
  }

  function insertToken(field: "prefillGeneral" | "prefillProduct" | "prefillThankYou", token: string) {
    setDraft((current) => {
      if (!current) return current;
      const currentVal = current[field];
      const nextVal = currentVal ? `${currentVal} {${token}}` : `{${token}}`;
      return {
        ...current,
        [field]: nextVal,
      };
    });
  }

  async function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadAvatar(file);
      patch({ avatarUrl: uploaded.url });
    } catch {
      // error is surfaced in useImageUpload state
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!draft || blockers.length > 0) return;
    setSaving(true);
    try {
      const { config, capabilities: caps } = await putWhatsAppWidget(toPayload(draft) as unknown as Record<string, unknown>);
      setSaved(config);
      setCapabilities(caps);
      setDraft(toDraft(config, getDefaults()));
      notify.success(t("saved_toast"));
    } catch (cause: any) {
      notify.error(cause?.message || t("save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const allSurfacesOff = Object.values(draft.surfaces).every((on) => !on);

  const surfaceKeys: Array<{ key: keyof WhatsAppWidgetSurfaces; label: string; hint: string }> = [
    { key: "home", label: t("surface_home"), hint: t("surface_home_hint") },
    { key: "catalog", label: t("surface_catalog"), hint: t("surface_catalog_hint") },
    { key: "product", label: t("surface_product"), hint: t("surface_product_hint") },
    { key: "pages", label: t("surface_pages"), hint: t("surface_pages_hint") },
    { key: "thankYou", label: t("surface_thank_you"), hint: t("surface_thank_you_hint") },
    { key: "checkout", label: t("surface_checkout"), hint: t("surface_checkout_hint") },
    { key: "landing", label: t("surface_landing"), hint: t("surface_landing_hint") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")} />

      <div className="mx-auto max-w-4xl space-y-6">
        <Alert tone="info">
          <p className="text-xs">{t("cache_notice")}</p>
        </Alert>
          {/* 1. Connect */}
          <Card title={t("connect_title")} subtitle={t("connect_subtitle")}>
            <div className="space-y-4">
              {/* Enable Switch */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {t("enable_label")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("enable_description")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.enabled}
                  aria-label={t("enable_label")}
                  disabled={!canManage}
                  onClick={() => patch({ enabled: !draft.enabled })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    draft.enabled ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
                      draft.enabled ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Phone Input with Normalisation Echo */}
              <Field
                label={t("phone_label")}
                hint={t("phone_hint")}
                error={
                  draft.phone && !phonePreview.isValid
                    ? t("phone_invalid_reason")
                    : undefined
                }
              >
                <div className="relative">
                  <Input
                    type="tel"
                    dir="ltr"
                    disabled={!canManage}
                    value={draft.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                    placeholder={t("phone_placeholder")}
                    className="font-mono"
                  />
                  <Phone size={14} className="absolute right-3 top-3 text-muted-foreground" />
                </div>
                {phonePreview.isValid && phonePreview.e164 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CircleCheck size={13} className="shrink-0" />
                    <span>{t("phone_valid").replace("{number}", phonePreview.e164)}</span>
                  </p>
                )}
              </Field>
            </div>
          </Card>

          {/* 2. Identity */}
          <Card title={t("identity_title")} subtitle={t("identity_subtitle")}>
            <div className="space-y-4">
              {/* Avatar Upload */}
              <div className="space-y-2">
                <span className="block text-[13px] font-semibold tracking-tight text-foreground select-none">
                  {t("avatar_label")}
                </span>
                <div className="flex items-center gap-4">
                  {draft.avatarUrl ? (
                    <div className="relative size-14 rounded-full border border-border/80 overflow-hidden bg-muted/40 shrink-0">
                      <img
                        src={draft.avatarUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-full border border-dashed border-border/80 bg-muted/30 text-muted-foreground shrink-0">
                      <ImageIcon size={20} />
                    </div>
                  )}

                  <div className="space-y-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => void handleAvatarFileSelect(e)}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canManage || uploadProgress !== null}
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs gap-1.5"
                      >
                        {uploadProgress !== null ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Upload size={13} />
                        )}
                        {t("avatar_upload")}
                      </Button>
                      {draft.avatarUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canManage}
                          onClick={() => patch({ avatarUrl: "" })}
                          className="text-xs text-destructive hover:text-destructive gap-1"
                        >
                          <Trash2 size={13} />
                          {t("avatar_remove")}
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("avatar_hint")}</p>
                  </div>
                </div>
              </div>

              {/* Agent Name */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("agent_name_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.agentName.length}/{limits.agentName ?? 40}
                    </span>
                  </div>
                }
              >
                <Input
                  disabled={!canManage}
                  value={draft.agentName}
                  maxLength={limits.agentName ?? 40}
                  onChange={(e) => patch({ agentName: e.target.value })}
                  placeholder={t("agent_name_placeholder")}
                />
              </Field>

              {/* Status Caption */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("caption_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.caption.length}/{limits.caption ?? 60}
                    </span>
                  </div>
                }
              >
                <Input
                  disabled={!canManage}
                  value={draft.caption}
                  maxLength={limits.caption ?? 60}
                  onChange={(e) => patch({ caption: e.target.value })}
                  placeholder={t("caption_placeholder")}
                />
              </Field>
            </div>
          </Card>

          {/* 3. Message */}
          <Card title={t("message_title")} subtitle={t("message_subtitle")}>
            <div className="space-y-4">
              {/* Welcome Message */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("welcome_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.welcomeMessage.length}/{limits.welcomeMessage ?? 300}
                    </span>
                  </div>
                }
                hint={t("welcome_hint")}
              >
                <Textarea
                  rows={2}
                  disabled={!canManage}
                  value={draft.welcomeMessage}
                  maxLength={limits.welcomeMessage ?? 300}
                  onChange={(e) => patch({ welcomeMessage: e.target.value })}
                  placeholder={t("welcome_placeholder")}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Launcher Button Label */}
                <Field
                  label={
                    <div className="flex items-center justify-between">
                      <span>{t("launcher_label")}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {draft.launcherLabel.length}/{limits.launcherLabel ?? 30}
                      </span>
                    </div>
                  }
                >
                  <Input
                    disabled={!canManage}
                    value={draft.launcherLabel}
                    maxLength={limits.launcherLabel ?? 30}
                    onChange={(e) => patch({ launcherLabel: e.target.value })}
                    placeholder={t("launcher_placeholder")}
                  />
                </Field>

                {/* CTA Label */}
                <Field
                  label={
                    <div className="flex items-center justify-between">
                      <span>{t("cta_label")}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {draft.ctaLabel.length}/{limits.ctaLabel ?? 30}
                      </span>
                    </div>
                  }
                >
                  <Input
                    disabled={!canManage}
                    value={draft.ctaLabel}
                    maxLength={limits.ctaLabel ?? 30}
                    onChange={(e) => patch({ ctaLabel: e.target.value })}
                    placeholder={t("cta_placeholder")}
                  />
                </Field>
              </div>

              {/* Prefill General */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("prefill_general_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.prefillGeneral.length}/{limits.prefillTemplate ?? 300}
                    </span>
                  </div>
                }
              >
                <Textarea
                  rows={2}
                  disabled={!canManage}
                  value={draft.prefillGeneral}
                  maxLength={limits.prefillTemplate ?? 300}
                  onChange={(e) => patch({ prefillGeneral: e.target.value })}
                  placeholder={t("prefill_general_placeholder")}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{t("tokens_hint")}</span>
                  {(capabilities.prefillTokens || ["store"]).map((token) => (
                    <button
                      key={token}
                      type="button"
                      disabled={!canManage}
                      onClick={() => insertToken("prefillGeneral", token)}
                      className="inline-flex items-center rounded-md border border-border/80 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted transition-colors"
                    >
                      {`{${token}}`}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Prefill Product */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("prefill_product_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.prefillProduct.length}/{limits.prefillTemplate ?? 300}
                    </span>
                  </div>
                }
              >
                <Textarea
                  rows={2}
                  disabled={!canManage}
                  value={draft.prefillProduct}
                  maxLength={limits.prefillTemplate ?? 300}
                  onChange={(e) => patch({ prefillProduct: e.target.value })}
                  placeholder={t("prefill_product_placeholder")}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{t("tokens_hint")}</span>
                  {(capabilities.prefillTokens || ["product", "url", "order", "store"]).map((token) => (
                    <button
                      key={token}
                      type="button"
                      disabled={!canManage}
                      onClick={() => insertToken("prefillProduct", token)}
                      className="inline-flex items-center rounded-md border border-border/80 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted transition-colors"
                    >
                      {`{${token}}`}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          {/* 4. Thank-You Page */}
          <Card title={t("thank_you_page_title")} subtitle={t("thank_you_page_subtitle")}>
            <div className="space-y-4">
              {/* Thank-You Button Label */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("thank_you_button_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.thankYouButtonLabel.length}/{limits.thankYouButtonLabel ?? 40}
                    </span>
                  </div>
                }
              >
                <Input
                  disabled={!canManage}
                  value={draft.thankYouButtonLabel}
                  maxLength={limits.thankYouButtonLabel ?? 40}
                  onChange={(e) => patch({ thankYouButtonLabel: e.target.value })}
                  placeholder={t("thank_you_button_placeholder")}
                />
              </Field>

              {/* Prefill Thank You */}
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("prefill_thank_you_label")}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {draft.prefillThankYou.length}/{limits.prefillThankYou ?? 300}
                    </span>
                  </div>
                }
              >
                <Textarea
                  rows={2}
                  disabled={!canManage}
                  value={draft.prefillThankYou}
                  maxLength={limits.prefillThankYou ?? 300}
                  onChange={(e) => patch({ prefillThankYou: e.target.value })}
                  placeholder={t("prefill_thank_you_placeholder")}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{t("tokens_hint")}</span>
                  {(capabilities.prefillTokens || ["order", "store"]).map((token) => (
                    <button
                      key={token}
                      type="button"
                      disabled={!canManage}
                      onClick={() => insertToken("prefillThankYou", token)}
                      className="inline-flex items-center rounded-md border border-border/80 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted transition-colors"
                    >
                      {`{${token}}`}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          {/* 5. Where it shows (Surfaces) */}
          <Card title={t("surfaces_title")} subtitle={t("surfaces_subtitle")}>
            <div className="space-y-3">
              {allSurfacesOff && (
                <Alert tone="warning">
                  <AlertCircle size={15} className="shrink-0" />
                  <p className="text-xs">{t("surfaces_all_off_warning")}</p>
                </Alert>
              )}

              <div className="divide-y divide-border/60">
                {surfaceKeys.map(({ key, label, hint }) => {
                  const isChecked = draft.surfaces[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground">{label}</span>
                        <p className="text-xs text-muted-foreground">{hint}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isChecked}
                        aria-label={label}
                        disabled={!canManage}
                        onClick={() => patchSurface(key, !isChecked)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                          isChecked ? "bg-primary" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
                            isChecked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* 6. Look & Placement */}
          <Card title={t("look_title")} subtitle={t("look_subtitle")}>
            <div className="space-y-4">
              {/* Accent selection */}
              <div>
                <span className="block text-[13px] font-semibold tracking-tight text-foreground select-none mb-2">
                  {t("accent_label")}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => patch({ accent: "whatsapp" })}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                      draft.accent === "whatsapp"
                        ? "border-[#25D366] bg-[#25D366]/5 shadow-xs ring-1 ring-[#25D366]"
                        : "border-border/80 bg-card hover:bg-muted/30"
                    }`}
                  >
                    <span className="size-4 rounded-full bg-[#25D366] shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{t("accent_whatsapp")}</p>
                      <p className="text-[10px] text-muted-foreground">#25D366</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => patch({ accent: "primary" })}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                      draft.accent === "primary"
                        ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                        : "border-border/80 bg-card hover:bg-muted/30"
                    }`}
                  >
                    <span className="size-4 rounded-full bg-primary shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{t("accent_primary")}</p>
                      <p className="text-[10px] text-muted-foreground">Brand theme</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Position selection */}
              <div>
                <span className="block text-[13px] font-semibold tracking-tight text-foreground select-none mb-2">
                  {t("position_label")}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => patch({ position: "right" })}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      draft.position === "right"
                        ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary font-semibold text-foreground"
                        : "border-border/80 bg-card hover:bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <span className="text-xs">{t("position_right")}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => patch({ position: "left" })}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      draft.position === "left"
                        ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary font-semibold text-foreground"
                        : "border-border/80 bg-card hover:bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <span className="text-xs">{t("position_left")}</span>
                  </button>
                </div>
              </div>

              {/* Attention Pulse Toggle */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {t("attention_label")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("attention_hint")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.attention}
                  aria-label={t("attention_label")}
                  disabled={!canManage}
                  onClick={() => patch({ attention: !draft.attention })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    draft.attention ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
                      draft.attention ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          </Card>
        </div>

      {/* Sticky Action Bar */}
      {canManage && (
        <StickyFormActions
          info={
            blockers.length > 0 ? (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                <ul className="space-y-0.5">
                  {blockers.map((b) => (
                    <li key={b.field}>{t(b.message as any)}</li>
                  ))}
                </ul>
              </div>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full bg-amber-500" />
                <span className="font-semibold text-foreground">{t("status_unsaved")}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleCheck size={13} className="text-emerald-500" />
                {t("status_saved")}
              </span>
            )
          }
        >
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(toDraft(saved, getDefaults()))}
              disabled={saving}
              className="text-xs"
            >
              {t("reset")}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty || blockers.length > 0}
            className="gap-2 px-5 font-semibold"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("save")}
          </Button>
        </StickyFormActions>
      )}
    </div>
  );
}

export default function WhatsAppWidgetApp() {
  return (
    <RequireAuth>
      <DashboardChrome currentPath="/whatsapp" wide>
        <WhatsAppWidgetContent />
      </DashboardChrome>
    </RequireAuth>
  );
}
