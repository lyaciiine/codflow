/**
 * WhatsApp Widget — dashboard API.
 *
 * Its own endpoint rather than a field on `PATCH /api/stores/me`, for two
 * reasons that are both structural:
 *
 *   1. The number is normalised on the way in. `updateMyStore` spreads its
 *      validated body straight into the store row, so a value that has to be
 *      transformed before it is stored cannot ride that path.
 *   2. The widget is a resource with its own permissions. A merchant can let
 *      whoever answers WhatsApp edit the widget without handing them the
 *      store's branding, domain, API key and status — which is what
 *      `auth: "admin"` on /stores/me means.
 *
 * Neither handler adds a read: the single-tenant store lookup both of them
 * already do returns the whole row, `whatsapp_widget_json` included.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ValidationError, NotFoundError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getStore } from "../../../../cod-shared/queries/stores";
import { saveWhatsAppWidgetConfig } from "../../../../cod-shared/queries/whatsapp-widget";
import {
  WIDGET_ACCENTS,
  WIDGET_LIMITS,
  WIDGET_POSITIONS,
  WIDGET_PREFILL_TOKENS,
  WIDGET_SURFACE_KEYS,
  WIDGET_SURFACES,
  WIDGET_TEXT_FIELDS,
  parseWhatsAppWidgetConfig,
  resolveStorefrontWidget,
  serializeWhatsAppWidgetConfig,
  type WhatsAppWidgetConfig,
} from "../../../../cod-shared/whatsapp-widget/config";
import { validateWhatsAppWidgetInput } from "../../../../cod-shared/whatsapp-widget/validate";

/**
 * The server's own rules, travelling with the config so the dashboard renders
 * its editor from them rather than keeping a second copy. A cap changed here
 * changes the UI on the next load, with no client deploy.
 */
const CAPABILITIES = {
  textFields: WIDGET_TEXT_FIELDS,
  surfaces: WIDGET_SURFACES,
  surfaceOrder: WIDGET_SURFACE_KEYS,
  accents: WIDGET_ACCENTS,
  positions: WIDGET_POSITIONS,
  prefillTokens: WIDGET_PREFILL_TOKENS,
  limits: WIDGET_LIMITS,
} as const;

/** Single-tenant: one store per deployment, exactly like getMyStore. */
async function requireStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await getStore(db);
  if (!store) throw new NotFoundError("Store");
  return store;
}

/**
 * The config, plus what the storefront would actually render from it.
 *
 * `preview` is the same projection `/store/config` serves, so the dashboard's
 * preview cannot drift from the shop window: if the widget will not render,
 * the merchant sees null here and the screen says why. It is not a second
 * opinion — it is the same function.
 */
function payload(config: WhatsAppWidgetConfig) {
  return {
    config,
    preview: resolveStorefrontWidget(serializeWhatsAppWidgetConfig(config)),
    capabilities: CAPABILITIES,
  };
}

export async function getWhatsAppWidget(c: Context<AppContext>) {
  const store = await requireStore(c);
  const config = parseWhatsAppWidgetConfig(store.whatsappWidgetJson);
  return c.json({ success: true, data: payload(config) }, 200);
}

export async function putWhatsAppWidget(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await requireStore(c);

  // The route body is deliberately loose (a passthrough object): the widget's
  // own validator is the one definition of what is acceptable, and duplicating
  // its rules in a zod schema is the drift this module exists to prevent.
  const submitted = (c.req as any).valid?.("json") ?? (await c.req.json());

  const result = validateWhatsAppWidgetInput(submitted);
  if (!result.ok) {
    // Every problem at once: a settings screen that fixes one error per save
    // is a settings screen nobody finishes.
    throw new ValidationError(result.issues[0].message, ERROR_CODES.VALIDATION_FAILED, {
      issues: result.issues,
    });
  }

  const config = await saveWhatsAppWidgetConfig(db, store.id, result.config);
  return c.json({ success: true, data: payload(config) }, 200);
}
