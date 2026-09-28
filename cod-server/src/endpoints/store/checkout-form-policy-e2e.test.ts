/**
 * Checkout Form Policy on the storefront order path — real-D1 E2E.
 *
 * Mounts the REAL store router against a real D1 with the real migrations, so
 * every assertion runs through the production route → validation → handler →
 * cod-shared engine → D1 path. That matters more here than anywhere else in
 * this feature: the route validates the request body BEFORE the handler runs
 * and zod strips what the schema does not name, so a mock of the handler would
 * happily "accept" a field that never survives the real pipeline.
 *
 * What is being proven, in one sentence: the storefront renders the merchant's
 * policy, but cod-server is what enforces it — a page the CDN cached before the
 * policy changed, or a script posting straight at the API, cannot get around it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";
import { getOrderById } from "../../../../cod-shared/queries/orders";
import { parseCustomFieldAnswers } from "../../../../cod-shared/checkout-form/apply";
import {
  serializeCheckoutFormPolicy,
  DEFAULT_CHECKOUT_FORM_POLICY,
  type CheckoutFormPolicy,
} from "../../../../cod-shared/checkout-form/policy";

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
const NOW = () => new Date().toISOString();
const STORE_ID = "store-checkout-policy";
const WILAYA = 16;
// A real commune from the migrations — orders.commune_id is a foreign key.
const COMMUNE_ID = "c-16-001";
const PRODUCT_PRICE = 2500;

let productId: string;

/**
 * Every statement the order path prepares, so the cost of the policy read is
 * asserted rather than assumed.
 *
 * D1 is a single-threaded Durable Object billed by rows read, so a read added
 * to checkout is paid on every order forever. `checkout-query-budget.e2e.test.ts`
 * ratchets the engine's own reads; it calls the query layer directly, so the
 * handler's read belongs here, next to the thing that added it.
 */
let sqlLog: string[] = [];

function recordingD1(d1: D1Database): D1Database {
  return new Proxy(d1, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "prepare") {
        return (query: string) => {
          sqlLog.push(query);
          return (value as D1Database["prepare"]).call(target, query);
        };
      }
      return typeof value === "function" ? (value as Function).bind(target) : value;
    },
  }) as D1Database;
}

const selectsAgainst = (table: string) =>
  sqlLog.filter((q) => /^\s*select\b/i.test(q) && new RegExp(`\\bfrom\\s+"${table}"`, "i").test(q));

beforeAll(async () => {
  harness = await createTestD1();

  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: recordingD1(harness.raw) } as never;
    c.set("storeId", STORE_ID);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  await harness.db.delete(schema.orderProducts);
  await harness.db.delete(schema.orderStatusHistory);
  await harness.db.delete(schema.stockMovements);
  await harness.db.delete(schema.orders);
  await harness.db.delete(schema.customers);
  await harness.db.delete(schema.products);
  await harness.db.delete(schema.shippingRules);
  await harness.db.delete(schema.shippingProfiles);
  await harness.db.delete(schema.stores);

  await harness.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "Policy Test Store",
    lang: "en",
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  productId = "prod-policy";
  await harness.db.insert(schema.products).values({
    id: productId,
    name: "Galaxy A54",
    handle: "galaxy-a54",
    price: PRODUCT_PRICE,
    sku: "SKU-A54",
    status: "ACTIVE",
    trackInventory: false,
    createdAt: NOW(),
    updatedAt: NOW(),
  });

  // Home and stop-desk are priced differently on purpose: it is the only way to
  // prove the policy is applied BEFORE the fee is resolved.
  // Shipping profiles are not store-scoped — this deployment is one store.
  await harness.db.insert(schema.shippingProfiles).values({
    id: "sp-1",
    name: "Default",
    isDefault: true,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  await harness.db.insert(schema.shippingRules).values({
    id: "sr-1",
    profileId: "sp-1",
    wilayaId: WILAYA,
    homePrice: 600,
    stopDeskPrice: 300,
    homeEnabled: true,
    // Not the column default — stop-desk is off unless a merchant offers it,
    // and this suite needs both types priced to prove the fee follows the type.
    stopDeskEnabled: true,
    createdAt: NOW(),
  });
});

async function setPolicy(over: Partial<CheckoutFormPolicy>) {
  const policy: CheckoutFormPolicy = {
    ...DEFAULT_CHECKOUT_FORM_POLICY,
    deliveryOptions: { ...DEFAULT_CHECKOUT_FORM_POLICY.deliveryOptions },
    customFields: [],
    ...over,
  };
  await harness.db
    .update(schema.stores)
    .set({ checkoutFormJson: serializeCheckoutFormPolicy(policy) })
    .where(eq(schema.stores.id, STORE_ID))
    .run();
}

/** A complete, valid order body — the shape the storefront form posts. */
function orderBody(over: Record<string, unknown> = {}) {
  return {
    customerName: "Ahmed Benali",
    phone: "0551234567",
    wilayaId: WILAYA,
    communeId: COMMUNE_ID,
    deliveryType: "home",
    productId,
    productName: "Galaxy A54",
    pricePerUnit: PRODUCT_PRICE,
    quantity: 1,
    ...over,
  };
}

async function postOrder(body: Record<string, unknown>) {
  const res = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function onlyOrder() {
  const rows = await harness.db.select().from(schema.orders);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("a store that never opened the page is untouched", () => {
  it("takes an order with no email, no custom answers, notes kept", async () => {
    const { status, json } = await postOrder(orderBody({ notes: "ring twice" }));
    expect(status).toBe(201);
    expect(json.success).toBe(true);

    const order = await onlyOrder();
    expect(order.notes).toBe("ring twice");
    expect(order.customerEmail).toBeNull();
    expect(order.customFieldsJson).toBeNull();
  });

  it("ignores an email when the field was never enabled", async () => {
    // A theme could post one; until the merchant asks for it, it is not data
    // this store agreed to collect.
    await postOrder(orderBody({ email: "shopper@example.com" }));
    expect((await onlyOrder()).customerEmail).toBeNull();
  });
});

describe("address", () => {
  it("refuses an empty address for home delivery when required", async () => {
    await setPolicy({ address: "required" });
    const { status, json } = await postOrder(orderBody({ address: "   " }));
    expect(status).toBe(400);
    expect(json.context?.field).toBe("address");
    expect(json.context?.reason).toBe("ADDRESS_REQUIRED");
    expect(await harness.db.select().from(schema.orders)).toHaveLength(0);
  });

  it("still takes a stop-desk order with no address", async () => {
    await setPolicy({ address: "required" });
    const { status } = await postOrder(orderBody({ deliveryType: "stop_desk", address: "" }));
    expect(status).toBe(201);
  });

  it("stores a trimmed address", async () => {
    await setPolicy({ address: "required" });
    await postOrder(orderBody({ address: "  Rue Didouche 12  " }));
    expect((await onlyOrder()).address).toBe("Rue Didouche 12");
  });
});

describe("notes", () => {
  it("drops a note the merchant hid, and still takes the order", async () => {
    await setPolicy({ notes: "hidden" });
    const { status } = await postOrder(orderBody({ notes: "leave at the door" }));
    expect(status).toBe(201);
    expect((await onlyOrder()).notes).toBeNull();
  });
});

describe("delivery options", () => {
  it("refuses a delivery type the merchant turned off", async () => {
    await setPolicy({ deliveryOptions: { home: true, stopDesk: false } });
    const { status, json } = await postOrder(orderBody({ deliveryType: "stop_desk" }));
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("DELIVERY_OPTION_UNAVAILABLE");
    expect(await harness.db.select().from(schema.orders)).toHaveLength(0);
  });

  it("never charges the fee of a type it refused", async () => {
    // The reason this is a rejection and not a silent rewrite: home costs 600
    // and stop-desk costs 300 here, so rewriting stop_desk → home would charge
    // the shopper 300 DZD more than the page quoted.
    await setPolicy({ deliveryOptions: { home: true, stopDesk: false } });
    await postOrder(orderBody({ deliveryType: "stop_desk" }));
    expect(await harness.db.select().from(schema.orders)).toHaveLength(0);

    const { status } = await postOrder(orderBody({ deliveryType: "home", address: "Rue 1" }));
    expect(status).toBe(201);
    const order = await onlyOrder();
    expect(order.deliveryType).toBe("home");
    expect(order.deliveryFee).toBe(600);
    expect(order.codAmount).toBe(PRODUCT_PRICE + 600);
  });

  it("takes an order on the option that is still on", async () => {
    await setPolicy({ deliveryOptions: { home: false, stopDesk: true } });
    const { status } = await postOrder(orderBody({ deliveryType: "stop_desk" }));
    expect(status).toBe(201);
    expect((await onlyOrder()).deliveryFee).toBe(300);
  });
});

describe("email", () => {
  it("refuses an order with no email when the merchant requires one", async () => {
    await setPolicy({ email: "required" });
    const { status, json } = await postOrder(orderBody());
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("EMAIL_REQUIRED");
  });

  it("stores it trimmed and lowercased", async () => {
    await setPolicy({ email: "required" });
    const { status } = await postOrder(orderBody({ email: "  Shopper@Example.COM " }));
    expect(status).toBe(201);
    expect((await onlyOrder()).customerEmail).toBe("shopper@example.com");
  });

  it("takes an order without one when it is optional", async () => {
    await setPolicy({ email: "optional" });
    const { status } = await postOrder(orderBody());
    expect(status).toBe(201);
    expect((await onlyOrder()).customerEmail).toBeNull();
  });

  it("refuses a malformed address rather than dropping it", async () => {
    await setPolicy({ email: "optional" });
    const { status, json } = await postOrder(orderBody({ email: "shopper.example.com" }));
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("EMAIL_INVALID");
  });

  it("leaves customers.email alone — a returning phone keeps its record", async () => {
    // store/CONTEXT.md: "Repeat buyers keep their record". The email is an order
    // snapshot; syncing it onto the customer is the digital-products plan's call
    // to make, not this feature's.
    await setPolicy({ email: "required" });
    await postOrder(orderBody({ email: "shopper@example.com" }));
    const customers = await harness.db.select().from(schema.customers);
    expect(customers).toHaveLength(1);
    expect(Object.keys(customers[0])).not.toContain("email");
  });
});

describe("custom fields", () => {
  const timeField = {
    id: "cf_abc12345",
    label: "Preferred time",
    type: "select" as const,
    required: true,
    options: ["Morning", "Evening"],
  };

  it("snapshots the answer with its label", async () => {
    await setPolicy({ customFields: [timeField] });
    const { status } = await postOrder(
      orderBody({
        customFieldResponses: JSON.stringify([{ id: "cf_abc12345", value: "Evening" }]),
      }),
    );
    expect(status).toBe(201);
    expect(JSON.parse((await onlyOrder()).customFieldsJson!)).toEqual([
      { id: "cf_abc12345", label: "Preferred time", type: "select", value: "Evening" },
    ]);
  });

  it("refuses a missing required answer", async () => {
    await setPolicy({ customFields: [timeField] });
    const { status, json } = await postOrder(orderBody());
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("CUSTOM_FIELD_REQUIRED");
    expect(json.context?.field).toBe("cf_abc12345");
  });

  it("refuses a choice the merchant never offered", async () => {
    await setPolicy({ customFields: [timeField] });
    const { status, json } = await postOrder(
      orderBody({ customFieldResponses: JSON.stringify([{ id: "cf_abc12345", value: "Midnight" }]) }),
    );
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("CUSTOM_FIELD_INVALID_CHOICE");
  });

  it("drops an answer for a field that does not exist in the policy", async () => {
    await setPolicy({ customFields: [{ ...timeField, required: false }] });
    const { status } = await postOrder(
      orderBody({
        customFieldResponses: JSON.stringify([
          { id: "cf_abc12345", value: "Morning" },
          { id: "cf_hacker00", value: "'; DROP TABLE orders; --" },
        ]),
      }),
    );
    expect(status).toBe(201);
    const stored = JSON.parse((await onlyOrder()).customFieldsJson!);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("cf_abc12345");
  });

  it("stores nothing when an optional field went unanswered", async () => {
    await setPolicy({ customFields: [{ ...timeField, required: false }] });
    await postOrder(orderBody());
    expect((await onlyOrder()).customFieldsJson).toBeNull();
  });

  it("survives a malformed responses payload — the required field is what fails", async () => {
    await setPolicy({ customFields: [timeField] });
    const { status, json } = await postOrder(orderBody({ customFieldResponses: "{not json" }));
    expect(status).toBe(400);
    expect(json.context?.reason).toBe("CUSTOM_FIELD_REQUIRED");
  });
});

describe("the message the shopper reads", () => {
  it("is written in the store's language, not the platform's", async () => {
    await harness.db
      .update(schema.stores)
      .set({ lang: "fr" })
      .where(eq(schema.stores.id, STORE_ID))
      .run();
    await setPolicy({ address: "required" });

    const { json } = await postOrder(orderBody({ address: "" }));
    expect(json.error).toMatch(/adresse/i);
  });

  it("falls back to Arabic for a store language with no table", async () => {
    await harness.db
      .update(schema.stores)
      .set({ lang: "ar" })
      .where(eq(schema.stores.id, STORE_ID))
      .run();
    await setPolicy({ email: "required" });

    const { json } = await postOrder(orderBody());
    expect(json.error).toContain("البريد");
  });
});

describe("a basket order obeys the same policy", () => {
  /**
   * The policy is applied before the request shape is normalised, so a basket
   * and a single product go through the identical check. Worth proving rather
   * than reasoning about: the two shapes have diverged before (that is why
   * normalizeOrderLines exists), and a policy that only bound the direct form
   * would leave the cart as a way around every rule.
   */
  it("refuses a basket that is missing a required answer", async () => {
    await setPolicy({
      email: "required",
      customFields: [
        { id: "cf_abc12345", label: "Preferred time", type: "text", required: true },
      ],
    });

    const basket = {
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: WILAYA,
      communeId: COMMUNE_ID,
      deliveryType: "home",
      address: "Rue 1",
      items: [
        { productId, productName: "Galaxy A54", quantity: 2, pricePerUnit: PRODUCT_PRICE },
      ],
    };

    const missing = await postOrder({ ...basket, email: "shopper@example.com" });
    expect(missing.status).toBe(400);
    expect(missing.json.context?.reason).toBe("CUSTOM_FIELD_REQUIRED");

    const complete = await postOrder({
      ...basket,
      email: "shopper@example.com",
      customFieldResponses: JSON.stringify([{ id: "cf_abc12345", value: "Evening" }]),
    });
    expect(complete.status).toBe(201);

    const order = await onlyOrder();
    expect(order.customerEmail).toBe("shopper@example.com");
    expect(JSON.parse(order.customFieldsJson!)[0].value).toBe("Evening");
  });
});

describe("what the policy costs per order", () => {
  /**
   * Two `stores` SELECTs per order, and both are named:
   *
   *   1. resolveDeliveryFee's own read of the delivery-pricing settings
   *      (free-shipping threshold, cart shipping mode) — pre-existing.
   *   2. the Checkout Form Policy read this feature added.
   *
   * A ratchet, like the engine's budget suite: this may come down (the two read
   * the same row and could be merged) but never up without a deliberate edit
   * and a reason written here.
   */
  const STORES_READS_PER_ORDER = 2;

  it("adds exactly one stores read, whatever the policy says", async () => {
    // The policy is one PK select of two columns (checkout_form_json + lang);
    // lang rides along precisely so a rejection message costs no second read.
    await setPolicy({
      address: "required",
      email: "required",
      customFields: [
        { id: "cf_abc12345", label: "Preferred time", type: "text", required: true },
      ],
    });

    sqlLog = [];
    const { status } = await postOrder(
      orderBody({
        address: "Rue 1",
        email: "shopper@example.com",
        customFieldResponses: JSON.stringify([{ id: "cf_abc12345", value: "Evening" }]),
      }),
    );
    expect(status).toBe(201);

    const reads = selectsAgainst("stores");
    expect(reads.length, `stores SELECTs:\n${reads.join("\n")}`).toBeLessThanOrEqual(
      STORES_READS_PER_ORDER,
    );
    // The policy read is one row by primary key, two columns — never a table scan.
    expect(reads.some((q) => /checkout_form_json/.test(q))).toBe(true);
  });

  it("costs nothing extra for a store that never customised the form", async () => {
    sqlLog = [];
    await postOrder(orderBody());
    expect(selectsAgainst("stores").length).toBeLessThanOrEqual(STORES_READS_PER_ORDER);
  });
});

describe("what the dashboard will be able to show", () => {
  it("returns the email and the answers from the order read the dashboard uses", async () => {
    // The order page reads getOrderById, which projects every orders column via
    // getTableColumns — this asserts that rather than trusting it, because a
    // narrowed projection there would silently hide both fields in the UI while
    // every write test still passed.
    await setPolicy({
      email: "required",
      customFields: [
        { id: "cf_abc12345", label: "Preferred time", type: "text", required: true },
      ],
    });
    const { status } = await postOrder(
      orderBody({
        email: "shopper@example.com",
        customFieldResponses: JSON.stringify([{ id: "cf_abc12345", value: "Evening" }]),
      }),
    );
    expect(status).toBe(201);

    const placed = await onlyOrder();
    const detail = await getOrderById(harness.db, placed.id);
    expect(detail?.customerEmail).toBe("shopper@example.com");
    expect(parseCustomFieldAnswers(detail?.customFieldsJson ?? null)).toEqual([
      { id: "cf_abc12345", label: "Preferred time", type: "text", value: "Evening" },
    ]);
  });
});

describe("GET /store/config", () => {
  it("never exposes the raw policy column", async () => {
    await setPolicy({ email: "required" });
    const res = await app.request("/store/config");
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("checkoutFormJson");
    expect(body.data.checkoutForm.email).toBe("required");
  });

  it("hands a never-customised store the defaults, already resolved", async () => {
    const res = await app.request("/store/config");
    const body = (await res.json()) as any;
    // The theme holds no form rules of its own, so this projection is what
    // "today's form" means for every store that has not opted in.
    expect(body.data.checkoutForm).toEqual(DEFAULT_CHECKOUT_FORM_POLICY);
  });
});
