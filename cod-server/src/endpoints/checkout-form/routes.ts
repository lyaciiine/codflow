/**
 * Checkout Form Policy routes — which fields the storefront order form asks
 * for, and how strictly each is enforced.
 * See report-md/STOREFRONT_FORM_CONTROL_PLAN.md. Built with defineRoute().
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const CustomFieldSchema = z
  .object({
    id: z
      .string()
      .regex(/^cf_[a-z0-9]{8}$/)
      .optional()
      .openapi({
        description:
          "Server-minted id. Omit it to create a field; send it to edit the field it names. " +
          "An id the store does not already have is rejected — ids key the answer snapshots " +
          "on existing orders.",
        example: "cf_a1b2c3d4",
      }),
    label: z.string().min(1).max(60).openapi({ example: "Preferred delivery time" }),
    type: z.enum(["text", "textarea", "number", "select"]),
    required: z.boolean().optional().openapi({ example: false }),
    options: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(20)
      .optional()
      .openapi({ description: "Dropdown choices — `select` only, and required for it." }),
  })
  .openapi("CheckoutFormCustomField");

const PolicySchema = z
  .object({
    address: z.enum(["required", "optional", "hidden"]).openapi({
      description:
        "Home delivery only. Hidden is allowed; the dispatch guard ensures a home parcel " +
        "has an address before leaving.",
    }),
    notes: z.enum(["optional", "hidden"]),
    email: z.enum(["required", "optional", "hidden"]).openapi({
      description:
        "Defaults to hidden, which is the storefront's behaviour before this feature. " +
        "Stored on the order (`orders.customer_email`) when the shopper supplies one.",
    }),
    deliveryOptions: z.object({ home: z.boolean(), stopDesk: z.boolean() }).openapi({
      description: "At least one must stay on — a form with neither cannot be submitted.",
    }),
    customFields: z.array(CustomFieldSchema).max(5),
  })
  .openapi("CheckoutFormPolicy");

/**
 * The request body is documented, not re-validated.
 *
 * A zod copy of the policy rules here would run BEFORE the handler and reject
 * with a generic message, hiding the coded, explainable issues the policy
 * validator produces. It would also be a second definition of the rules, which is
 * precisely the drift this feature exists to remove — so the shape is described
 * for the spec by example and prose, and `cod-shared/checkout-form/validate.ts`
 * remains the only thing that decides what is acceptable.
 */
const PolicyInputSchema = z
  .record(z.string(), z.unknown())
  .openapi("CheckoutFormPolicyInput", {
    description:
      "A policy document. Same shape as CheckoutFormPolicy, with `customFields[].id` " +
      "optional (omit it to create a field). Validated server-side by the policy module: " +
      "unknown keys, an empty delivery-option pair, an unknown field id " +
      "and every authoring limit are refused, with each problem listed in `context.issues`.",
    example: {
      address: "required",
      notes: "hidden",
      email: "required",
      deliveryOptions: { home: true, stopDesk: false },
      customFields: [
        { label: "Preferred delivery time", type: "select", required: true, options: ["Morning", "Evening"] },
      ],
    },
  });

const ResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  data: z.object({
    policy: PolicySchema,
    capabilities: z.object({
      builtInFields: z.record(z.string(), z.unknown()),
      customFieldTypes: z.array(z.string()),
      limits: z.record(z.string(), z.number()),
    }).openapi({
      description:
        "The server's own rules — allowed states per built-in field, the custom field types, " +
        "and the authoring limits. The dashboard renders its editor from these rather than " +
        "keeping a second copy of them.",
    }),
  }),
});

const getCheckoutFormRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.CHECKOUT_FORM_READ },
  tags: ["Checkout Form"],
  summary: "Get the checkout form policy",
  description:
    "The storefront order form's configuration. A store that has never customised it returns " +
    "the defaults, which describe the form exactly as it behaved before this feature existed.",
  operationId: "getCheckoutForm",
  responses: {
    200: { description: "The current policy", content: jsonContent(ResponseSchema) },
  },
  handler: h.getCheckoutForm,
});

const putCheckoutFormRoute = defineRoute({
  method: "put",
  path: "/",
  auth: { scope: SCOPES.CHECKOUT_FORM_MANAGE },
  tags: ["Checkout Form"],
  summary: "Replace the checkout form policy",
  description: `Replaces the whole policy — a key you omit takes its default rather than keeping the stored value, so what the screen shows is what the store gets.

**Ids are server-owned.** Omit \`id\` on a field to create it; the response carries the minted id. An id the store does not already have is refused, because ids key the answer snapshots on existing orders.

**Unknown keys are refused** rather than ignored, so a typo cannot silently vanish. Every problem is reported at once in \`context.issues\`.

Saving the defaults clears the stored policy entirely (the column goes back to NULL), which is also the documented rollback for the feature.

Fixed fields — name, phone, wilaya, commune — are not configurable: COD dispatch, customer identity and delivery pricing all depend on them.`,
  operationId: "putCheckoutForm",
  body: PolicyInputSchema,
  responses: {
    200: { description: "The saved policy", content: jsonContent(ResponseSchema) },
    400: { description: "The policy was refused — see `context.issues`" },
  },
  handler: h.putCheckoutForm,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getCheckoutFormRoute.route, getCheckoutFormRoute.handler);
router.openapi(putCheckoutFormRoute.route, putCheckoutFormRoute.handler);

export default router;
