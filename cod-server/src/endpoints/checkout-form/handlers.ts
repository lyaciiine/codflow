/**
 * Checkout Form Policy — dashboard API.
 *
 * Its own endpoint rather than a field on `PATCH /api/stores/me`, for two
 * reasons that are both structural:
 *
 *   1. Custom-field ids are minted server-side. `updateMyStore` spreads its
 *      validated body straight into the store row, so a value that has to be
 *      transformed on the way in cannot ride that path.
 *   2. The policy is a resource with its own permissions. A merchant can let
 *      someone edit the order form without handing them the store's branding,
 *      domain, API key and status — which is what `auth: "admin"` on
 *      /stores/me means.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ValidationError, NotFoundError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getStore } from "../../../../cod-shared/queries/stores";
import {
  getCheckoutFormPolicy,
  saveCheckoutFormPolicy,
} from "../../../../cod-shared/queries/checkout-form";
import {
  BUILT_IN_FIELDS,
  CHECKOUT_FORM_LIMITS,
  CUSTOM_FIELD_TYPES,
} from "../../../../cod-shared/checkout-form/policy";
import { validateCheckoutFormPolicyInput } from "../../../../cod-shared/checkout-form/validate";

/**
 * The limits and allowed states travel with the policy so the dashboard renders
 * its editor from the server's rules rather than a second copy of them. A cap
 * changed here changes the UI on the next load, with no client deploy.
 */
const CAPABILITIES = {
  builtInFields: BUILT_IN_FIELDS,
  customFieldTypes: CUSTOM_FIELD_TYPES,
  limits: CHECKOUT_FORM_LIMITS,
} as const;

/** Single-tenant: one store per deployment, exactly like getMyStore. */
async function requireStoreId(c: Context<AppContext>): Promise<string> {
  const db = getDb(c.env.DB);
  const store = await getStore(db);
  if (!store) throw new NotFoundError("Store");
  return store.id;
}

export async function getCheckoutForm(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = await requireStoreId(c);
  const { policy } = await getCheckoutFormPolicy(db, storeId);
  return c.json({ success: true, data: { policy, capabilities: CAPABILITIES } }, 200);
}

export async function putCheckoutForm(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = await requireStoreId(c);

  // The route body is deliberately loose (a passthrough object): the policy's
  // own validator is the one definition of what is acceptable, and duplicating
  // its rules in a zod schema is exactly the drift this feature exists to end.
  const submitted = (c.req as any).valid?.("json") ?? (await c.req.json());

  // Ids are checked against what the store CURRENTLY has, so a stale editor
  // cannot resurrect a deleted field and a client cannot invent one.
  const { policy: stored } = await getCheckoutFormPolicy(db, storeId);
  const result = validateCheckoutFormPolicyInput(submitted, {
    knownIds: stored.customFields.map((field) => field.id),
  });

  if (!result.ok) {
    // Every problem at once: a settings screen that fixes one error per save
    // is a settings screen nobody finishes.
    throw new ValidationError(
      result.issues[0].message,
      ERROR_CODES.VALIDATION_FAILED,
      { issues: result.issues }
    );
  }

  const policy = await saveCheckoutFormPolicy(db, storeId, result.policy);
  return c.json({ success: true, data: { policy, capabilities: CAPABILITIES } }, 200);
}
