/**
 * WhatsApp Widget routes — the storefront's contact handoff: the number, what
 * the chat panel shows, and which pages the launcher appears on.
 * See report-md/WHATSAPP_WIDGET_PLAN.md. Built with defineRoute().
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { StoreWhatsAppWidgetSchema } from "@/openapi/schemas";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const SurfacesSchema = z
  .object({
    home: z.boolean(),
    catalog: z.boolean(),
    product: z.boolean(),
    pages: z.boolean(),
    thankYou: z.boolean(),
    checkout: z.boolean(),
    landing: z.boolean(),
  })
  .openapi("WhatsAppWidgetSurfaces", {
    description:
      "Which kinds of storefront page the launcher appears on. A fixed registry rather " +
      "than URL patterns, and every surface off is a valid paused state.",
  });

const ConfigSchema = z
  .object({
    enabled: z.boolean(),
    phone: z.string().nullable().openapi({
      description: "Stored in E.164, however the merchant typed it.",
      example: "+213551234567",
    }),
    agentName: z.string().nullable(),
    caption: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    welcomeMessage: z.string().nullable(),
    launcherLabel: z.string().nullable(),
    ctaLabel: z.string().nullable(),
    prefillGeneral: z.string().nullable(),
    prefillProduct: z.string().nullable(),
    accent: z.enum(["whatsapp", "primary"]),
    position: z.enum(["right", "left"]),
    attention: z.boolean(),
    surfaces: SurfacesSchema,
  })
  .openapi("WhatsAppWidgetConfig");

/**
 * The request body is documented, not re-validated.
 *
 * A zod copy of the rules here would run BEFORE the handler and reject with a
 * generic message, hiding the coded, explainable issues the widget validator
 * produces (`PHONE_REQUIRED` is the clearest example: the merchant needs to be
 * told the widget cannot be switched on without a number, not that a field
 * failed a refinement). It would also be a second definition of the rules —
 * so the shape is described here by example and prose, and
 * `cod-shared/whatsapp-widget/validate.ts` remains the only thing that decides
 * what is acceptable.
 */
const ConfigInputSchema = z
  .record(z.string(), z.unknown())
  .openapi("WhatsAppWidgetConfigInput", {
    description:
      "A widget document. Same shape as WhatsAppWidgetConfig, with every key optional — " +
      "an omitted key takes its default. `phone` is accepted in any form the merchant " +
      "knows (0551234567, 00213…, +213…, spaced) and stored normalised. Unknown keys, an " +
      "unreachable number, a non-https avatar and every text cap are refused, with each " +
      "problem listed in `context.issues`.",
    example: {
      enabled: true,
      phone: "0551234567",
      agentName: "أمين",
      caption: "نرد خلال دقائق",
      welcomeMessage: "مرحبا 👋 كيفاش نعاونك؟",
      prefillProduct: "سلام، بغيت نسقسي على {product} — {url}",
      accent: "whatsapp",
      position: "right",
      surfaces: { home: true, catalog: true, product: true, pages: true, thankYou: true, checkout: false, landing: false },
    },
  });

const ResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  data: z.object({
    config: ConfigSchema,
    preview: StoreWhatsAppWidgetSchema.nullable().openapi({
      description:
        "Exactly what `/store/config` would hand the storefront for this configuration, " +
        "or null when nothing would render. The same function produces both, so the " +
        "dashboard's preview cannot drift from the shop window.",
    }),
    capabilities: z
      .object({
        textFields: z.record(z.string(), z.object({ max: z.number().int() })),
        surfaces: z.record(z.string(), z.object({ default: z.boolean() })),
        surfaceOrder: z.array(z.string()),
        accents: z.array(z.string()),
        positions: z.array(z.string()),
        prefillTokens: z.array(z.string()),
        limits: z.record(z.string(), z.number()),
      })
      .openapi({
        description:
          "The server's own rules — the text caps, the surface registry and its display " +
          "order, the allowed accents and sides, and the prefill tokens. The dashboard " +
          "renders its editor from these rather than keeping a second copy of them.",
      }),
  }),
});

const getWhatsAppWidgetRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.WHATSAPP_WIDGET_READ },
  tags: ["WhatsApp Widget"],
  summary: "Get the WhatsApp widget configuration",
  description:
    "The storefront's WhatsApp contact widget. A store that has never configured one gets " +
    "the defaults, which are 'no widget' — nothing renders until a number is saved and the " +
    "widget is switched on.",
  operationId: "getWhatsAppWidget",
  responses: {
    200: { description: "The current configuration", content: jsonContent(ResponseSchema) },
  },
  handler: h.getWhatsAppWidget,
});

const putWhatsAppWidgetRoute = defineRoute({
  method: "put",
  path: "/",
  auth: { scope: SCOPES.WHATSAPP_WIDGET_MANAGE },
  tags: ["WhatsApp Widget"],
  summary: "Replace the WhatsApp widget configuration",
  description: `Replaces the whole configuration — a key you omit takes its default rather than keeping the stored value, so what the screen shows is what the store gets.

**The number is normalised here, once.** Send it however the merchant typed it; it is stored in E.164 and every reader downstream sees the same string.

**Switching the widget on without a number is refused** (\`PHONE_REQUIRED\`): it would leave the merchant looking at an "on" switch and a storefront with no widget.

**Unknown keys are refused** rather than ignored, so a typo cannot silently vanish. Every problem is reported at once in \`context.issues\`.

Saving the defaults clears the stored configuration entirely (the column goes back to NULL), which is also the documented rollback for the feature.

Turning every surface off is accepted — it is a deliberate "paused" state and keeps the merchant's text.`,
  operationId: "putWhatsAppWidget",
  body: ConfigInputSchema,
  responses: {
    200: { description: "The saved configuration", content: jsonContent(ResponseSchema) },
    400: { description: "The configuration was refused — see `context.issues`" },
  },
  handler: h.putWhatsAppWidget,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getWhatsAppWidgetRoute.route, getWhatsAppWidgetRoute.handler);
router.openapi(putWhatsAppWidgetRoute.route, putWhatsAppWidgetRoute.handler);

export default router;
