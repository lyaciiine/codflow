import { useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { listCommunes, listWilayas, updateOrder } from "@/features/orders/api";
import type { Commune, OrderDetail, Wilaya } from "@/features/orders/types";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

const PHONE_PATTERN = /^0[5-7]\d{8}$/;

/**
 * Edit the customer/destination fields of a pre-dispatch order — how a
 * merchant records an address collected over the phone when the checkout
 * hid the address field.
 *
 * Only changed fields are sent: the server leaves omitted fields untouched,
 * and a notes-only edit on an address-less home order must not look like an
 * attempt to clear the address.
 */
export function EditOrderDialog({
  order,
  onClose,
  onChanged,
  onError,
}: {
  order: OrderDetail;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT("orders");
  const common = useT("common");
  const locale = useLocale();

  const [customerName, setCustomerName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.phone);
  const [customerEmail, setCustomerEmail] = useState(order.customerEmail ?? "");
  const [wilayaId, setWilayaId] = useState(
    order.wilayaId != null ? String(order.wilayaId) : "",
  );
  const [communeId, setCommuneId] = useState(order.communeId ?? "");
  const [address, setAddress] = useState(order.address ?? "");
  const [deliveryType, setDeliveryType] = useState(order.deliveryType);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loadingCommunes, setLoadingCommunes] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listWilayas()
      .then((rows) => {
        if (alive) setWilayas(rows);
      })
      .catch(() => {
        if (alive) setWilayas([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!wilayaId) {
      setCommunes([]);
      return;
    }
    let alive = true;
    setLoadingCommunes(true);
    listCommunes(Number(wilayaId))
      .then((rows) => {
        if (alive) setCommunes(rows);
      })
      .catch(() => {
        if (alive) setCommunes([]);
      })
      .finally(() => {
        if (alive) setLoadingCommunes(false);
      });
    return () => {
      alive = false;
    };
  }, [wilayaId]);

  const wilayaChanged = wilayaId !== "" && String(order.wilayaId ?? "") !== wilayaId;

  async function submit() {
    const nextErrors: Record<string, string> = {};
    if (!customerName.trim()) nextErrors.customerName = t("form.error_customer_name");
    if (!phone.trim()) nextErrors.phone = t("form.error_phone");
    else if (!PHONE_PATTERN.test(phone.trim()))
      nextErrors.phone = t("form.error_invalid_phone");
    if (wilayaChanged && !communeId)
      nextErrors.communeId = t("form.error_commune");
    if (deliveryType === "home" && !address.trim())
      nextErrors.address = t("form.error_address");
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    const patch: Record<string, unknown> = {};
    const trimmedName = customerName.trim();
    if (trimmedName !== order.customerName) patch.customerName = trimmedName;
    const trimmedPhone = phone.trim();
    if (trimmedPhone !== order.phone) patch.phone = trimmedPhone;
    const trimmedEmail = customerEmail.trim().toLowerCase();
    if (trimmedEmail !== (order.customerEmail ?? ""))
      patch.customerEmail = trimmedEmail === "" ? null : trimmedEmail;
    const nextWilayaId = wilayaId === "" ? null : Number(wilayaId);
    if (nextWilayaId !== (order.wilayaId ?? null)) patch.wilayaId = nextWilayaId;
    if (communeId !== (order.communeId ?? "")) patch.communeId = communeId;
    const trimmedAddress = address.trim();
    if (trimmedAddress !== (order.address ?? ""))
      patch.address = trimmedAddress === "" ? null : trimmedAddress;
    if (deliveryType !== order.deliveryType) patch.deliveryType = deliveryType;
    const trimmedNotes = notes.trim();
    if (trimmedNotes !== (order.notes ?? ""))
      patch.notes = trimmedNotes === "" ? null : trimmedNotes;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    try {
      await updateOrder(order.id, patch);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(t("edit_dialog.error"));
      setBusy(false);
      return;
    }
    notify.success(t("edit_dialog.success"));
    try {
      await onChanged();
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("edit_dialog.title")} onClose={onClose}>
      <p className="mb-4 text-xs font-medium text-muted-foreground">
        {order.orderNumber}
      </p>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.customer_name_label")} error={errors.customerName}>
            <Input
              value={customerName}
              onChange={(event) => setCustomerName(event.currentTarget.value)}
              placeholder={t("form.customer_name_placeholder")}
            />
          </Field>
          <Field label={t("form.phone_label")} error={errors.phone}>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              placeholder={t("form.phone_placeholder")}
              inputMode="tel"
              dir="ltr"
            />
          </Field>
          <Field label={t("form.email_label")}>
            <Input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.currentTarget.value)}
              placeholder={t("form.email_placeholder")}
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              dir="ltr"
            />
          </Field>
          <Field label={t("form.delivery_type_label")}>
            <Select
              value={deliveryType}
              onChange={(event) =>
                setDeliveryType(
                  event.currentTarget.value === "stop_desk"
                    ? "stop_desk"
                    : "home",
                )
              }
            >
              <option value="home">{t("form.delivery_type_home")}</option>
              <option value="stop_desk">{t("form.delivery_type_desk")}</option>
            </Select>
          </Field>
          <Field label={t("form.wilaya_label")}>
            <Select
              value={wilayaId}
              onChange={(event) => {
                setWilayaId(event.currentTarget.value);
                setCommuneId("");
              }}
            >
              <option value="">{t("form.wilaya_placeholder")}</option>
              {wilayas.map((wilaya) => (
                <option key={wilaya.id} value={wilaya.id}>
                  {locale === "ar" ? wilaya.nameAr : wilaya.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.commune_label")} error={errors.communeId}>
            <Select
              value={communeId}
              onChange={(event) => setCommuneId(event.currentTarget.value)}
              disabled={!wilayaId}
            >
              <option value="">
                {loadingCommunes ? t("form.commune_loading") : t("form.commune_placeholder")}
              </option>
              {communes.map((commune) => (
                <option key={commune.id} value={commune.id}>
                  {locale === "ar" ? commune.nameAr : commune.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("form.address_label")} error={errors.address}>
          <Textarea
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder={t("form.address_placeholder")}
          />
        </Field>
        <Field label={t("form.notes_label")}>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            placeholder={t("form.notes_label")}
          />
        </Field>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={busy}
          >
            {common("cancel")}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? t("form.saving") : t("edit_dialog.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
