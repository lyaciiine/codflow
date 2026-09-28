import { useEffect, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  Home,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Truck,
  UserRound,
} from "lucide-react";
import { RequireAuth, canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StickyFormActions,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { getCheckoutForm, putCheckoutForm } from "@/features/checkout-form/api";
import {
  checkoutFormErrorMessage,
  draftBlockers,
  emptyCustomField,
  isDirty,
  moveCustomField,
  toDraft,
  toPayload,
} from "@/features/checkout-form/model";
import type {
  CheckoutFormCapabilities,
  CheckoutFormDraft,
  CheckoutFormPolicy,
  CustomFieldDraft,
  FieldState,
} from "@/features/checkout-form/types";
import { FieldStateControl } from "@/features/checkout-form/components/FieldStateControl";
import { CustomFieldEditor } from "@/features/checkout-form/components/CustomFieldEditor";
import { DeliveryOptionCards } from "@/features/checkout-form/components/DeliveryOptionCards";

/**
 * The Checkout Form screen.
 *
 * Its own page rather than a settings tab, because this is not one switch: it is
 * the shape of every order the store will ever take, and it earns a screen where
 * the merchant can see the whole form and what their change does to it.
 *
 * Two rules this screen holds to:
 *
 *   1. It never decides anything. The allowed states, the types and the limits
 *      all arrive from the server with the policy, and the server validates the
 *      save. Client checks here only spare the merchant a round trip.
 *   2. It never hides a refusal. A save that cannot succeed is blocked with the
 *      reason shown, and a refusal from the server is surfaced in its own words.
 */
function CheckoutFormContent() {
  const t = useT("checkout-form");
  const common = useT("common");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.CHECKOUT_FORM_MANAGE);

  const [saved, setSaved] = useState<CheckoutFormPolicy | null>(null);
  const [capabilities, setCapabilities] = useState<CheckoutFormCapabilities | null>(null);
  const [draft, setDraft] = useState<CheckoutFormDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const { policy, capabilities: caps } = await getCheckoutForm();
      setSaved(policy);
      setCapabilities(caps);
      setDraft(toDraft(policy));
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
          <p className="font-semibold">{t("errors.load_failed")}</p>
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

  const limits = capabilities.limits;
  const blockers = draftBlockers(draft);
  const dirty = isDirty(draft, saved);
  const stateLabel = (state: FieldState) => t(`state.${state}`);
  const fieldLabel = (key: string) => t(`fields.${key}`);

  function patch(next: Partial<CheckoutFormDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function patchField(index: number, next: CustomFieldDraft) {
    setDraft((current) =>
      current
        ? { ...current, customFields: current.customFields.map((f, i) => (i === index ? next : f)) }
        : current,
    );
  }

  async function handleSave() {
    if (!draft || blockers.length > 0) return;
    setSaving(true);
    try {
      const { policy, capabilities: caps } = await putCheckoutForm(toPayload(draft));
      // Adopt the server's answer, not the local draft: it carries the ids it
      // just minted, and a subsequent edit of a new field must send that id
      // rather than create a second question.
      setSaved(policy);
      setCapabilities(caps);
      setDraft(toDraft(policy));
      notify.success(t("saved_toast"));
    } catch (cause) {
      notify.error(checkoutFormErrorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  const atFieldLimit = draft.customFields.length >= limits.MAX_CUSTOM_FIELDS;

  return (
    <div className="space-y-6">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")} />

      <div className="mx-auto max-w-4xl space-y-6">
        <Alert tone="info">
          <p className="text-xs">{t("cache_notice")}</p>
        </Alert>
        <Card
          title={t("fields.section_title")}
          subtitle={t("fields.section_subtitle")}
          flush
        >
            <div className="divide-y divide-border/70">
              {/* Locked first, so the merchant sees what the platform holds and
                  why before reaching what they control. */}
              {(
                [
                  ["customerName", UserRound],
                  ["phone", Phone],
                  ["wilaya", MapPin],
                  ["commune", MapPin],
                ] as const
              ).map(([key, icon]) => (
                <FieldStateControl
                  key={key}
                  icon={icon}
                  label={fieldLabel(key)}
                  hint={t(`fields.${key}_why`)}
                  locked
                  lockedNote={t("fields.locked_note")}
                  stateLabel={stateLabel}
                />
              ))}

              <FieldStateControl
                icon={Home}
                label={fieldLabel("address")}
                hint={t("fields.address_hint")}
                value={draft.address}
                states={capabilities.builtInFields.address?.states}
                onChange={(state) => patch({ address: state as CheckoutFormDraft["address"] })}
                stateLabel={stateLabel}
              />
              <FieldStateControl
                icon={Mail}
                label={fieldLabel("email")}
                hint={t("fields.email_hint")}
                value={draft.email}
                states={capabilities.builtInFields.email?.states}
                onChange={(state) => patch({ email: state })}
                stateLabel={stateLabel}
              />
              <FieldStateControl
                icon={MessageSquare}
                label={fieldLabel("notes")}
                hint={t("fields.notes_hint")}
                value={draft.notes}
                states={capabilities.builtInFields.notes?.states}
                onChange={(state) => patch({ notes: state as CheckoutFormDraft["notes"] })}
                stateLabel={stateLabel}
              />
            </div>
          </Card>

          <Card
            title={t("delivery.section_title")}
            subtitle={t("delivery.section_subtitle")}
          >
            <DeliveryOptionCards
              value={draft.deliveryOptions}
              onChange={(deliveryOptions) => patch({ deliveryOptions })}
              homeLabel={t("delivery.home")}
              stopDeskLabel={t("delivery.stop_desk")}
              lastOneHint={t("delivery.last_one_hint")}
            />
          </Card>

          <Card
            title={t("custom.section_title")}
            subtitle={t("custom.section_subtitle").replace(
              "{max}",
              String(limits.MAX_CUSTOM_FIELDS),
            )}
            action={
              draft.customFields.length > 0 ? (
                <Badge tone="neutral">
                  {draft.customFields.length} / {limits.MAX_CUSTOM_FIELDS}
                </Badge>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {draft.customFields.length === 0 && (
                <EmptyState
                  compact
                  icon={<ListChecks size={20} />}
                  title={t("custom.empty")}
                  description={t("custom.empty_hint")}
                />
              )}

              {draft.customFields.map((field, index) => (
                <CustomFieldEditor
                  key={field.key ?? field.id ?? index}
                  field={field}
                  index={index}
                  total={draft.customFields.length}
                  types={capabilities.customFieldTypes}
                  maxOptions={limits.MAX_OPTIONS}
                  maxLabelLength={limits.MAX_LABEL_LENGTH}
                  t={t}
                  onChange={(next) => patchField(index, next)}
                  onMove={(direction) =>
                    patch({ customFields: moveCustomField(draft.customFields, index, direction) })
                  }
                  onRemove={() =>
                    patch({ customFields: draft.customFields.filter((_, i) => i !== index) })
                  }
                />
              ))}

              {atFieldLimit ? (
                <p className="text-xs text-muted-foreground">
                  {t("custom.limit_reached").replace("{max}", String(limits.MAX_CUSTOM_FIELDS))}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    patch({ customFields: [...draft.customFields, emptyCustomField()] })
                  }
                >
                  <Plus size={15} /> {t("custom.add")}
                </Button>
              )}

              <p className="text-xs text-muted-foreground">{t("custom.answers_note")}</p>
            </div>
          </Card>
      </div>

      {/*
        Sticky action bar (the same pattern as Pages and the product form): on a
        page this tall the primary action must never be the thing the merchant has
        to go looking for.

        The blockers live in the bar's own info slot rather than in a banner
        further up, because the button they disable is right here — an explanation
        of "why can't I save" belongs beside the thing that is refusing, not a
        scroll away from it. All of them are listed at once: fixing one problem
        per attempt is how a settings screen becomes a guessing game.
      */}
      {canManage && (
        <StickyFormActions
          info={
            blockers.length > 0 ? (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                <ul className="space-y-0.5">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{t(blocker)}</li>
                  ))}
                </ul>
              </div>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full bg-amber-500" />
                <span className="font-semibold text-foreground">{t("status.unsaved")}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleCheck size={13} className="text-emerald-500" />
                {t("status.saved")}
              </span>
            )
          }
        >
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(toDraft(saved))}
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

export default function CheckoutFormApp() {
  return (
    <RequireAuth>
      <DashboardChrome currentPath="/checkout-form" wide>
        <CheckoutFormContent />
      </DashboardChrome>
    </RequireAuth>
  );
}
