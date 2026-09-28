/**
 * Checkout Form Policy — storage access.
 *
 * Two reads, deliberately different:
 *
 *   - `getCheckoutFormPolicy` runs on the storefront ORDER path, which is the
 *     busiest query path in the product. It selects two columns from one row by
 *     primary key and nothing else. `lang` rides along because a rejection has
 *     to be written in the store's own language, and fetching it separately
 *     would double the cost of the cheapest read in the checkout.
 *   - the dashboard read returns the same policy plus the raw column, because
 *     the save path needs to know which custom-field ids the store already has
 *     before it will accept any.
 *
 * Writes store NULL when the policy is the default, so "never customised" and
 * "customised back to the defaults" are one row state — and the documented
 * rollback (`UPDATE stores SET checkout_form_json = NULL`) is also what a
 * merchant can do from the dashboard.
 */

import { eq } from "drizzle-orm";
import { stores } from "../db/schema";
import type { AppDb } from "../db/client";
import {
  isDefaultCheckoutFormPolicy,
  parseCheckoutFormPolicy,
  serializeCheckoutFormPolicy,
  type CheckoutFormPolicy,
} from "../checkout-form/policy";

export interface StoreCheckoutForm {
  policy: CheckoutFormPolicy;
  /** `stores.lang` — the language a policy rejection must be written in. */
  lang: string;
}

/**
 * The policy as the order path needs it. A store that does not exist resolves
 * to the defaults rather than throwing: the caller is already past store
 * authentication by this point, and a missing row must not be the thing that
 * stops an order.
 */
export async function getCheckoutFormPolicy(
  db: AppDb,
  storeId: string,
): Promise<StoreCheckoutForm> {
  const row = await db
    .select({ checkoutFormJson: stores.checkoutFormJson, lang: stores.lang })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get();

  return {
    policy: parseCheckoutFormPolicy(row?.checkoutFormJson ?? null),
    lang: row?.lang ?? "ar",
  };
}

export async function saveCheckoutFormPolicy(
  db: AppDb,
  storeId: string,
  policy: CheckoutFormPolicy,
): Promise<CheckoutFormPolicy> {
  await db
    .update(stores)
    .set({
      checkoutFormJson: isDefaultCheckoutFormPolicy(policy)
        ? null
        : serializeCheckoutFormPolicy(policy),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(stores.id, storeId))
    .run();

  return policy;
}
