/**
 * WhatsApp Widget dashboard API client.
 * Calls the API solely through `apiFetch` in `@/lib/api`.
 */

import { apiFetch } from "@/lib/api";
import type { WhatsAppWidgetResponse } from "./types";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function getWhatsAppWidget(): Promise<WhatsAppWidgetResponse> {
  const res = await apiFetch<Envelope<WhatsAppWidgetResponse>>("/api/whatsapp-widget");
  return res.data;
}

export async function putWhatsAppWidget(
  payload: Record<string, unknown>,
): Promise<WhatsAppWidgetResponse> {
  const res = await apiFetch<Envelope<WhatsAppWidgetResponse>>("/api/whatsapp-widget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.data;
}
