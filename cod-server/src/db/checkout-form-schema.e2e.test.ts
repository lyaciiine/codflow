/**
 * Migration 0031 against a real D1, not a mock.
 *
 * A migration is exactly the kind of thing a mock cannot prove: the mock db
 * answers from a queue and would happily "store" a column that does not exist.
 * This replays every migration in order into miniflare's D1 — the same engine
 * production runs — and then uses the columns the way the order path will.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { orders, stores, customers } from "@/db/schema";
import {
  DEFAULT_CHECKOUT_FORM_POLICY,
  parseCheckoutFormPolicy,
  serializeCheckoutFormPolicy,
} from "../../../cod-shared/checkout-form/policy";

let harness: TestD1;
const NOW = new Date().toISOString();
const STORE_ID = "store_checkout_form";

beforeAll(async () => {
  harness = await createTestD1();
  await harness.db.insert(stores).values({
    id: STORE_ID,
    name: "Checkout Form Test Store",
    createdAt: NOW,
    updatedAt: NOW,
  });
  // The 58 wilayas ship with the migrations — a test that re-inserted one
  // would be testing its own fixture rather than the schema.
  await harness.db.insert(customers).values({
    id: "cust_1",
    name: "Ahmed",
    phone: "0551234567",
    wilaya: "الجزائر",
    createdAt: NOW,
  });
});

afterAll(async () => {
  await harness?.dispose();
});

describe("stores.checkout_form_json", () => {
  it("starts NULL, which every existing store reads as today's form", async () => {
    const row = await harness.db.select().from(stores).where(eq(stores.id, STORE_ID)).get();
    expect(row?.checkoutFormJson).toBeNull();
    expect(parseCheckoutFormPolicy(row?.checkoutFormJson ?? null)).toEqual(
      DEFAULT_CHECKOUT_FORM_POLICY,
    );
  });

  it("round-trips a real policy through D1", async () => {
    const policy = {
      ...DEFAULT_CHECKOUT_FORM_POLICY,
      address: "required" as const,
      email: "required" as const,
      deliveryOptions: { home: true, stopDesk: false },
      customFields: [
        {
          id: "cf_abc12345",
          label: "Preferred time",
          type: "select" as const,
          required: true,
          options: ["Morning", "Evening"],
        },
      ],
    };

    await harness.db
      .update(stores)
      .set({ checkoutFormJson: serializeCheckoutFormPolicy(policy) })
      .where(eq(stores.id, STORE_ID))
      .run();

    const row = await harness.db.select().from(stores).where(eq(stores.id, STORE_ID)).get();
    expect(parseCheckoutFormPolicy(row?.checkoutFormJson ?? null)).toEqual(policy);
  });

  it("goes back to NULL — the documented rollback for the whole feature", async () => {
    await harness.db
      .update(stores)
      .set({ checkoutFormJson: null })
      .where(eq(stores.id, STORE_ID))
      .run();

    const row = await harness.db.select().from(stores).where(eq(stores.id, STORE_ID)).get();
    expect(row?.checkoutFormJson).toBeNull();
  });
});

describe("orders.customer_email / orders.custom_fields_json", () => {
  async function insertOrder(
    id: string,
    extra: { customerEmail?: string | null; customFieldsJson?: string | null },
  ) {
    await harness.db.insert(orders).values({
      id,
      orderNumber: `ORD-20260924-${id}`,
      customerId: "cust_1",
      customerName: "Ahmed",
      phone: "0551234567",
      wilayaId: 16,
      price: 2500,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    });
    return harness.db.select().from(orders).where(eq(orders.id, id)).get();
  }

  it("accepts an order that carries neither — every order placed before this feature", async () => {
    const row = await insertOrder("0001", {});
    expect(row?.customerEmail).toBeNull();
    expect(row?.customFieldsJson).toBeNull();
  });

  it("stores an email snapshot", async () => {
    const row = await insertOrder("0002", { customerEmail: "shopper@example.com" });
    expect(row?.customerEmail).toBe("shopper@example.com");
  });

  it("stores an answer snapshot that survives the field being deleted", async () => {
    // The label travels with the answer precisely so that deleting the field
    // from the policy cannot rewrite what an old order says.
    const snapshot = JSON.stringify([
      { id: "cf_abc12345", label: "Preferred time", type: "select", value: "Evening" },
    ]);
    const row = await insertOrder("0003", { customFieldsJson: snapshot });

    await harness.db
      .update(stores)
      .set({ checkoutFormJson: serializeCheckoutFormPolicy(DEFAULT_CHECKOUT_FORM_POLICY) })
      .where(eq(stores.id, STORE_ID))
      .run();

    const after = await harness.db.select().from(orders).where(eq(orders.id, "0003")).get();
    expect(JSON.parse(after!.customFieldsJson!)).toEqual(JSON.parse(snapshot));
  });
});
