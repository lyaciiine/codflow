/**
 * Orders Validation Schemas
 * 
 * Zod schemas for request validation.
 */

import { z } from "zod";
import { parseOrderCursor } from "../../../../cod-shared/queries/orders";

export const createOrderSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  phone: z.string().regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number"),
  wilayaId: z.number().int().min(1).max(58),
  communeId: z.string().min(1, "Commune is required"),
  city: z.string().nullish(),
  /**
   * Optional on this path, whatever the storefront's Checkout Form Policy says.
   *
   * That policy governs what SHOPPERS are asked for; staff taking an order over
   * the phone are a different actor with different information in front of them,
   * and requiring an address they do not have would only produce invented ones.
   * The same reasoning the address rule here already follows.
   *
   * Normalised exactly like the storefront path so one customer's email is one
   * string in the column, whichever way the order was created.
   */
  customerEmail: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v ?? undefined;
      const trimmed = v.trim().toLowerCase();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().max(254).email("Invalid email address").optional()
  ),
  address: z.string().nullish(),
  price: z.number().positive(),
  notes: z.string().nullish(),
  orderType: z.enum(["online", "offline"]).default("online"),
  deliveryType: z.enum(["home", "stop_desk"]).default("home"),
  /** Optional explicit fee — for offline/dashboard orders. Online orders ignore this and auto-resolve from shipping profile. */
  deliveryFee: z.number().min(0).optional(),
  companyId: z.string().min(1).nullish(),
  products: z.array(
    z.object({
      productId: z.string().min(1),
      productName: z.string(),
      variantId: z.string().min(1).nullish(),
      variantLabel: z.string().nullish(),
      quantity: z.number().int().positive(),
      pricePerUnit: z.number().positive(),
      lineTotal: z.number().positive(),
    })
  ).min(1, "At least one product is required"),
}).superRefine((data, ctx) => {
  if (data.deliveryType === "home" && !data.address?.trim()) {
    ctx.addIssue({ code: "custom", path: ["address"], message: "Address is required for home delivery" });
  }
});

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "unreachable",
  "preparing",
  "ready",
  "assigned",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

/**
 * PATCH /orders/:id — partial edit of customer/destination fields.
 * All fields optional; omitted fields are left untouched.
 *
 * customerEmail: "" (or whitespace) clears the email, a value is trimmed and
 * lower-cased — the same canonical form the storefront and POST /orders write.
 * address: "" (or whitespace) clears the address — how a merchant records a
 * phone-collected address later, or removes a wrong one.
 */
export const updateOrderSchema = z.object({
  customerName: z.string().min(1, "Name is required").optional(),
  phone: z
    .string()
    .regex(/^0[5-7]\d{8}$/, "Invalid Algerian phone number")
    .optional(),
  customerEmail: z.preprocess(
    (v) => {
      if (v === null) return null;
      if (typeof v !== "string") return v ?? undefined;
      const trimmed = v.trim().toLowerCase();
      return trimmed === "" ? null : trimmed;
    },
    z.string().max(254).email("Invalid email address").nullable().optional()
  ),
  wilayaId: z.number().int().min(1).max(58).optional(),
  communeId: z.string().min(1, "Commune is required").optional(),
  city: z.string().nullish(),
  address: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().nullable().optional()
  ),
  deliveryType: z.enum(["home", "stop_desk"]).optional(),
  notes: z.string().nullish(),
});

export const assignDriverSchema = z.object({
  driverId: z.string().min(1),
});

/**
 * PATCH /orders/:id/products/:productLineId/return
 * Records how many units on a single order line the customer refused at the door.
 * Server computes status ("fulfilled" | "partially_returned" | "returned") from
 * the ratio of returnedQuantity to the line's original quantity.
 */
export const returnOrderProductSchema = z.object({
  returnedQuantity: z.number().int().min(0),
});

export const orderFiltersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  wilayaId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z
    .string()
    .min(1)
    .max(300)
    .refine((v) => parseOrderCursor(v) !== null, "Invalid cursor")
    .optional()
    .describe(
      "Keyset pagination cursor (takes precedence over offset). " +
        "Pass the (createdAt, id) cursor of the last row of the current page " +
        "to fetch the next page; deep pages stay index-served unlike offset."
    ),
});

/**
 * POST /orders/bulk-dispatch — dispatch multiple existing orders to a delivery company.
 * Uses the provider's bulk creation API (up to 100 orders per request).
 */
export const bulkDispatchSchema = z.object({
  companyId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1).max(100, "Maximum 100 orders per bulk dispatch"),
});

export type BulkDispatchInput = z.infer<typeof bulkDispatchSchema>;

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type OrderFiltersInput = z.infer<typeof orderFiltersSchema>;
export type ReturnOrderProductInput = z.infer<typeof returnOrderProductSchema>;
