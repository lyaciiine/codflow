/**
 * Checkout Form API calls.
 *
 * Through `apiFetch` only — components never call fetch, and this feature is no
 * exception (the API seam is what keeps authorization in cod-server).
 */

import { apiFetch } from "@/lib/api";
import type { CheckoutFormPolicy, CheckoutFormResponse } from "./types";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function getCheckoutForm(): Promise<CheckoutFormResponse> {
  return (await apiFetch<Envelope<CheckoutFormResponse>>("/api/checkout-form")).data;
}

/**
 * Replace the whole policy.
 *
 * A full replace rather than a patch, because the screen always shows the whole
 * form: what the merchant is looking at is what gets saved, and nothing can
 * survive in the stored policy that is no longer on screen.
 *
 * Custom fields are sent WITHOUT an id when they are new — the server mints it
 * and returns the saved policy, which the caller should adopt as the new state.
 */
export async function putCheckoutForm(
  policy: Omit<CheckoutFormPolicy, "customFields"> & {
    customFields: Array<{
      id?: string;
      label: string;
      type: string;
      required: boolean;
      options?: string[];
    }>;
  },
): Promise<CheckoutFormResponse> {
  return (
    await apiFetch<Envelope<CheckoutFormResponse>>("/api/checkout-form", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    })
  ).data;
}
