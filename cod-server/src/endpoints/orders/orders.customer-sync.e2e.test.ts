/**
 * Order-edit customer sync — real-D1 probe
 *
 * Audit finding: PATCH /orders/:id updated only the orders row, leaving the
 * linked customers row with the old name/phone/wilaya — one phone on the
 * order, another on the customer. These probes prove the sync against real
 * migrations on real D1 (phone is the customer identity, UNIQUE since 0015):
 *
 *   S1  name/wilaya/commune/address edits flow into the linked customer
 *   S2  a corrected phone lands on the same customer when the number is new
 *   S3  a corrected phone that already belongs to another customer re-points
 *       the order to that record instead of hijacking its phone
 *   S4  order-only edits (notes, email) leave the customer untouched
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { updateOrder } from "../../../../cod-shared/queries/orders";

let db: AppDb;

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  const rawD1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const preparedStatements: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) {
      preparedStatements.push(rawD1.prepare(statement));
    }
  }
  for (let i = 0; i < preparedStatements.length; i += 50) {
    await rawD1.batch(preparedStatements.slice(i, i + 50));
  }
  db = drizzle(rawD1 as unknown as D1Database, { schema }) as unknown as AppDb;
  registry.push(mf);
}, 120_000);

const registry: Miniflare[] = [];
afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

let seq = 0;
const NOW = () => new Date().toISOString();

function nextPhone(): string {
  return `0560${String(100000 + ++seq).slice(-6)}`;
}

async function seedCustomer(
  overrides: Partial<typeof schema.customers.$inferSelect> = {},
) {
  const id = `cust-cs-${++seq}`;
  const phone = overrides.phone ?? nextPhone();
  const name = overrides.name ?? `CS Customer ${seq}`;
  await db.insert(schema.customers).values({
    id,
    name,
    phone,
    wilayaId: overrides.wilayaId ?? 16,
    communeId: overrides.communeId ?? "c-16-001",
    wilaya: overrides.wilaya ?? "الجزائر الوسطى",
    commune: overrides.commune ?? "الجزائر الوسطى",
    address: overrides.address ?? null,
    totalOrders: 0,
    totalSpent: 0,
    createdAt: NOW(),
  });
  return { id, phone, name };
}

async function seedOrder(customerId: string, customerName: string, phone: string) {
  const id = `ord-cs-${++seq}`;
  await db.insert(schema.orders).values({
    id,
    orderNumber: `CS-${String(seq).padStart(4, "0")}`,
    customerId,
    customerName,
    phone,
    wilayaId: 16,
    communeId: "c-16-001",
    address: "Rue des Lilas",
    price: 2500,
    status: "new",
    deliveryType: "home",
    deliveryFee: 400,
    driverFee: 0,
    codAmount: 2500,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  return id;
}

async function getOrder(id: string) {
  return db.select().from(schema.orders).where(eq(schema.orders.id, id)).get();
}

async function getCustomer(id: string) {
  return db.select().from(schema.customers).where(eq(schema.customers.id, id)).get();
}

describe("updateOrder — customer sync (real D1)", () => {
  it("S1: name/wilaya/commune/address edits flow into the linked customer", async () => {
    const { id: customerId, phone } = await seedCustomer();
    const orderId = await seedOrder(customerId, "Old Name", phone);

    await updateOrder(db, orderId, {
      customerName: "Amina Haddad",
      wilayaId: 31,
      communeId: "c-31-001",
      address: "45 Boulevard Front de Mer",
    });

    const order = await getOrder(orderId);
    const customer = await getCustomer(customerId);

    expect(order?.customerName).toBe("Amina Haddad");
    expect(order?.wilayaId).toBe(31);
    expect(order?.communeId).toBe("c-31-001");
    expect(order?.customerId).toBe(customerId);

    expect(customer?.name).toBe("Amina Haddad");
    expect(customer?.wilayaId).toBe(31);
    expect(customer?.communeId).toBe("c-31-001");
    expect(customer?.wilaya).toBe("وهران");
    expect(customer?.commune).toBe("وهران");
    expect(customer?.address).toBe("45 Boulevard Front de Mer");
    expect(customer?.phone).toBe(phone);
  });

  it("S2: a corrected phone lands on the same customer when the number is new", async () => {
    const { id: customerId, phone } = await seedCustomer();
    const orderId = await seedOrder(customerId, "CS Customer", phone);
    const newPhone = nextPhone();

    await updateOrder(db, orderId, { phone: newPhone });

    const order = await getOrder(orderId);
    const customer = await getCustomer(customerId);

    expect(order?.phone).toBe(newPhone);
    expect(order?.customerId).toBe(customerId);
    expect(customer?.phone).toBe(newPhone);
  });

  it("S3: a phone owned by another customer re-points the order instead of hijacking it", async () => {
    const first = await seedCustomer({ name: "First Holder" });
    const second = await seedCustomer({ name: "Second Holder" });
    const orderId = await seedOrder(first.id, "First Holder", first.phone);

    await updateOrder(db, orderId, {
      phone: second.phone,
      customerName: "Second Holder",
    });

    const order = await getOrder(orderId);
    const firstAfter = await getCustomer(first.id);
    const secondAfter = await getCustomer(second.id);

    expect(order?.customerId).toBe(second.id);
    expect(order?.phone).toBe(second.phone);

    expect(secondAfter?.name).toBe("Second Holder");
    expect(secondAfter?.phone).toBe(second.phone);

    expect(firstAfter?.phone).toBe(first.phone);
    expect(firstAfter?.name).toBe("First Holder");
  });

  it("S4: order-only edits (notes, email) leave the customer untouched", async () => {
    const { id: customerId, phone, name } = await seedCustomer({ address: "Rue des Lilas" });
    const orderId = await seedOrder(customerId, name, phone);

    await updateOrder(db, orderId, {
      notes: "Call before delivery",
      customerEmail: "shopper@example.com",
    });

    const customer = await getCustomer(customerId);
    const order = await getOrder(orderId);

    expect(order?.notes).toBe("Call before delivery");
    expect(order?.customerEmail).toBe("shopper@example.com");
    expect(customer?.name).toBe(name);
    expect(customer?.phone).toBe(phone);
    expect(customer?.address).toBe("Rue des Lilas");
    expect(customer?.wilayaId).toBe(16);
  });

  it("S5: healing a pre-existing divergence — order phone set to its own customer's phone", async () => {
    const { id: customerId, phone } = await seedCustomer();
    const stalePhone = nextPhone();
    const orderId = await seedOrder(customerId, "CS Customer", stalePhone);

    const orderBefore = await getOrder(orderId);
    expect(orderBefore?.phone).not.toBe(phone);

    await updateOrder(db, orderId, { phone });

    const order = await getOrder(orderId);
    const customer = await getCustomer(customerId);

    expect(order?.phone).toBe(phone);
    expect(order?.customerId).toBe(customerId);
    expect(customer?.phone).toBe(phone);
  });
});
