/**
 * Orders Route Handlers - CRUD Operations
 * 
 * Basic HTTP handlers for orders listing, retrieval, creation, and deletion.
 * Complex operations (dispatch, status transitions) are in separate modules.
 */

import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { wilayas, communes, customers } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as queries from "./queries";
import * as validation from "./validation";
import { resolveDeliveryFee, applyFreeShippingOffer } from "./resolve-fee";
import { logActivity, ACTIONS } from "@/lib/activity";
import { getDeliveryCompanyById } from "@/endpoints/delivery-companies/queries";
import { NotFoundError, ValidationError, BusinessLogicError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

/**
 * GET /orders
 * List all orders with optional filters
 */
export async function listOrders(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);

    const queryData: any = (c.req as any).valid?.("query");
    const filters = queryData ?? validation.orderFiltersSchema.parse({
      status: c.req.query("status"),
      wilayaId: c.req.query("wilayaId"),
      search: c.req.query("search"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });

    const orders = await queries.getAllOrders(db, filters);

    return c.json({
      success: true,
      data: orders,
      count: orders.length,
    }, 200);
  } catch (error) {
    throw error;
  }
}

/**
 * GET /orders/:id
 * Get single order by ID
 */
export async function getOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);

  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  return c.json({
    success: true,
    data: order,
  }, 200);
}

/**
 * POST /orders
 * Create new order
 */
export async function createOrder(c: Context<AppContext>) {
  try {
    const db = getDb(c.env.DB);
    const bodyData: any = (c.req as any).valid?.("json");
    const validated: validation.CreateOrderInput =
      bodyData ?? validation.createOrderSchema.parse(await c.req.json());

    // Generate order number (format: ORD-YYYYMMDD-XXXX)
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const orderNumber = `ORD-${dateStr}-${random}`;

    const now = date.toISOString();
    const orderId = crypto.randomUUID();

    // Validate companyId if provided — it references a delivery_companies FK
    if (validated.companyId) {
      const company = await getDeliveryCompanyById(db, validated.companyId);
      if (!company) {
        throw new NotFoundError("Delivery company", validated.companyId);
      }
    }

    // Auto-resolve delivery fee from shipping profile.
    // Dashboard orders (orderType="offline") may pass an explicit fee override.
    // Online orders always use the shipping profile to enforce coverage rules.
    let deliveryFee = validated.deliveryFee ?? 0;
    if (validated.wilayaId) {
      try {
        const productIds = validated.products.map((p) => p.productId);
        const resolved = await resolveDeliveryFee(db, {
          wilayaId: validated.wilayaId,
          communeId: validated.communeId ?? null,
          deliveryType: validated.deliveryType,
          productIds,
        });
        // For online orders, always use resolved fee. For offline/dashboard orders,
        // use the resolved fee unless admin explicitly passed a fee override.
        if (validated.orderType === "online" || validated.deliveryFee == null) {
          deliveryFee = resolved.deliveryFee;
        }
        // Apply free-shipping offer override
        const productQuantities = new Map(validated.products.map((p) => [p.productId, p.quantity]));
        deliveryFee = await applyFreeShippingOffer(db, deliveryFee, productIds, productQuantities);
      } catch (err) {
        // If the order is offline (dashboard), allow fee=0 and skip coverage check errors.
        // Online orders: re-throw to block order creation for uncovered zones.
        if (validated.orderType === "online") throw err;
        deliveryFee = validated.deliveryFee ?? 0;
      }
    }

    // Auto-create customer if not in DB (walk-in / manual entry)
    const existingCustomer = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, validated.customerId))
      .get();

    if (!existingCustomer) {
      const [wilayaRow, communeRow] = await Promise.all([
        db.select({ nameAr: wilayas.nameAr }).from(wilayas).where(eq(wilayas.id, validated.wilayaId)).get(),
        validated.communeId
          ? db.select({ nameAr: communes.nameAr }).from(communes).where(eq(communes.id, validated.communeId)).get()
          : Promise.resolve(null),
      ]);

      await db.insert(customers).values({
        id: validated.customerId,
        name: validated.customerName,
        phone: validated.phone,
        phone2: null,
        wilayaId: validated.wilayaId,
        communeId: validated.communeId ?? null,
        wilaya: wilayaRow?.nameAr ?? String(validated.wilayaId),
        commune: communeRow?.nameAr ?? null,
        address: validated.address ?? null,
        totalOrders: 0,
        totalSpent: 0,
        createdAt: now,
        lastOrderAt: null,
      });
    }

    // Prepare order data
    const orderData = {
      id: orderId,
      orderNumber,
      customerId: validated.customerId,
      customerName: validated.customerName,
      phone: validated.phone,
      wilayaId: validated.wilayaId,
      communeId: validated.communeId ?? null,
      city: validated.city || null,
      address: validated.address || null,
      customerEmail: validated.customerEmail ?? null,
      price: validated.price,
      notes: validated.notes || null,
      status: "new" as const,
      orderType: validated.orderType,
      driverId: null,
      companyId: validated.companyId || null,
      deliveryType: validated.deliveryType,
      deliveryFee,
      codAmount: validated.price + deliveryFee,  // driver collects price + delivery fee
      photos: null,
      createdAt: now,
      updatedAt: now,
    };

    // Prepare order products
    const productsData = validated.products.map((p) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: p.productId,
      productName: p.productName,
      variantId: p.variantId || null,
      variantLabel: p.variantLabel || null,
      quantity: p.quantity,
      pricePerUnit: p.pricePerUnit,
      lineTotal: p.lineTotal,
      createdAt: now,
    }));

    const actor = c.get("user");
    // Create order — passes actor so stock movements are attributed correctly
    await queries.createOrder(db, orderData, productsData, actor ? { id: actor.id, name: actor.name ?? "Unknown" } : null);
    await logActivity(db, actor, ACTIONS.ORDER_CREATED, {
      type: "order", id: orderId, label: orderNumber,
    });

    return c.json(
      {
        success: true,
        data: {
          id: orderId,
          orderNumber,
          deliveryFee,
          price: validated.price,
          codAmount: validated.price + deliveryFee,
          customerId: validated.customerId,
          customerName: validated.customerName,
          phone: validated.phone,
          wilayaId: validated.wilayaId,
          communeId: validated.communeId ?? null,
          deliveryType: validated.deliveryType,
          orderType: validated.orderType,
          status: "new",
        },
        message: "Order created successfully",
      },
      201
    );
  } catch (error) {
    throw error;
  }
}

/**
 * PATCH /orders/:id
 * Edit customer/destination fields on an order — how a merchant records an
 * address collected over the phone when the checkout hid the field.
 *
 * Blocked once the parcel is with a carrier (the label already carries the
 * old details — route those edits through PATCH /orders/:id/update-shipment)
 * and on terminal states, whose books are already reconciled.
 */
export async function updateOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  if (order.trackingNumber) {
    throw new BusinessLogicError(
      `Order already dispatched — tracking number: ${order.trackingNumber}`,
      ERROR_CODES.ORDER_ALREADY_DISPATCHED,
      { orderId, trackingNumber: order.trackingNumber }
    );
  }

  const terminalStatuses = ["returned", "cancelled"];
  if (terminalStatuses.includes(order.status)) {
    throw new BusinessLogicError(
      `Cannot edit a ${order.status} order — it was already reconciled.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status }
    );
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.UpdateOrderInput =
    bodyData ?? validation.updateOrderSchema.parse(await c.req.json());

  // Reference-table checks: dispatch re-validates, but an edit should fail
  // with an actionable 400 instead of a per-parcel carrier rejection later.
  if (validated.wilayaId !== undefined) {
    const wilayaRow = await db
      .select({ id: wilayas.id })
      .from(wilayas)
      .where(eq(wilayas.id, validated.wilayaId))
      .get();
    if (!wilayaRow) {
      throw new ValidationError("Wilaya not found in reference tables", ERROR_CODES.MISSING_WILAYA_COMMUNE, { orderId, wilayaId: validated.wilayaId });
    }
  }
  if (validated.communeId !== undefined) {
    const communeRow = await db
      .select({ id: communes.id, wilayaId: communes.wilayaId })
      .from(communes)
      .where(eq(communes.id, validated.communeId))
      .get();
    if (!communeRow) {
      throw new ValidationError("Commune not found in reference tables", ERROR_CODES.MISSING_WILAYA_COMMUNE, { orderId, communeId: validated.communeId });
    }
    if (
      validated.wilayaId !== undefined &&
      communeRow.wilayaId !== validated.wilayaId
    ) {
      throw new ValidationError("Commune does not belong to the selected wilaya", ERROR_CODES.MISSING_WILAYA_COMMUNE, { orderId, communeId: validated.communeId, wilayaId: validated.wilayaId });
    }
  }

  // Reject a home delivery whose address the edit itself empties. Edits that
  // touch neither field pass through — a phone-collected order may legitimately
  // have no address yet, and the dispatch guard still fails closed.
  if (validated.address !== undefined || validated.deliveryType !== undefined) {
    const resultAddress = validated.address !== undefined ? validated.address : order.address;
    const resultDeliveryType = validated.deliveryType ?? order.deliveryType;
    if (resultDeliveryType === "home" && !(resultAddress ?? "").trim()) {
      throw new ValidationError(
        "Address is required for home delivery",
        ERROR_CODES.MISSING_ADDRESS,
        { orderId }
      );
    }
  }

  await queries.updateOrder(db, orderId, {
    customerName: validated.customerName,
    phone: validated.phone,
    customerEmail: validated.customerEmail,
    wilayaId: validated.wilayaId,
    communeId: validated.communeId,
    city: validated.city,
    address: validated.address,
    deliveryType: validated.deliveryType,
    notes: validated.notes,
  });

  const actor = c.get("user");
  await logActivity(db, actor, ACTIONS.ORDER_UPDATED, {
    type: "order", id: orderId, label: order.orderNumber,
  }, { fields: Object.keys(validated) });

  const updated = await queries.getOrderById(db, orderId);

  return c.json({
    success: true,
    data: updated,
    message: "Order updated successfully",
  }, 200);
}

/**
 * PATCH /orders/:id/products/:productLineId/return
 *
 * Record how many units on a single order line the customer refused at the
 * door. Used for the Algerian "open the box at delivery" workflow where a
 * customer may accept part of an order and return the rest.
 *
 * Body: { returnedQuantity: number }  // 0 ≤ n ≤ line.quantity
 *
 * Server:
 *  - computes status ("fulfilled" | "partially_returned" | "returned")
 *    from newReturnedQuantity / line.quantity
 *  - restocks the delta vs. the line's current returnedQuantity so repeated
 *    calls are idempotent and correcting an overstated return un-restocks
 *  - logs a stock_movement with type ORDER_RETURNED
 *
 * Only callable while the order is not already in a terminal state — once
 * the order itself is marked `returned` or `cancelled`, updateOrderStatus
 * has already restocked remaining units and further per-line edits would
 * desync inventory.
 */
export async function returnOrderProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");
  const productLineId = c.req.param("productLineId");

  if (!orderId || !productLineId) {
    throw new ValidationError("Order ID and product line ID are required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  // Block edits on orders whose overall state has already settled the books.
  const terminalStatuses = ["returned", "cancelled"];
  if (terminalStatuses.includes(order.status)) {
    throw new BusinessLogicError(
      `Cannot edit returns on a ${order.status} order — stock was already reconciled.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { orderId, currentStatus: order.status }
    );
  }

  const bodyData: any = (c.req as any).valid?.("json");
  const validated: validation.ReturnOrderProductInput =
    bodyData ?? validation.returnOrderProductSchema.parse(await c.req.json());

  const user = c.get("user");

  let result;
  try {
    result = await queries.setOrderProductReturn(
      db,
      orderId,
      productLineId,
      validated.returnedQuantity,
      user?.id,
      user?.name ?? undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(msg, ERROR_CODES.VALUE_OUT_OF_RANGE, { orderId, productLineId });
  }

  await logActivity(db, user, ACTIONS.ORDER_PRODUCT_RETURNED, {
    type: "order", id: orderId, label: order.orderNumber,
  }, { productLineId, returnedQuantity: result.returnedQuantity, status: result.status });

  return c.json({ success: true, data: result, message: "Return recorded" }, 200);
}

/**
 * DELETE /orders/:id
 * Permanently delete the order: restore tracked inventory, adjust customer
 * counters, then remove the order with its lines, shipments, and cascaded
 * history/reviews. No soft-delete exists for orders.
 */
export async function deleteOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");

  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }

  // Check if order exists
  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  await queries.deleteOrder(db, orderId);

  const deleteActor = c.get("user");
  await logActivity(db, deleteActor, ACTIONS.ORDER_DELETED, {
    type: "order", id: orderId,
  });

  return c.json({
    success: true,
    message: "Order deleted",
  }, 200);
}
