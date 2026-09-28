/**
 * GET / PUT /api/checkout-form — real-D1 E2E through the real router.
 *
 * The save path is where this feature could quietly corrupt itself: ids are
 * minted here, and an id is what every existing order's answer snapshot is
 * keyed by. So these run against real D1 and assert what actually landed in the
 * column, not what a handler returned.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import checkoutFormRouter from "./routes";
import {
  DEFAULT_CHECKOUT_FORM_POLICY,
  CUSTOM_FIELD_ID_PATTERN,
} from "../../../../cod-shared/checkout-form/policy";

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
/** Same router, mounted for a staff user who may look but not change. */
let readOnlyApp: OpenAPIHono<AppContext>;
const NOW = () => new Date().toISOString();
const STORE_ID = "store-cf-api";

/**
 * A STAFF user with explicit scopes, not an admin.
 *
 * `requireScope` short-circuits for `role: "admin"`, so stubbing an admin would
 * mean the scopes were never actually consulted — the suite would pass with the
 * wrong scope on the route, or with no scope at all.
 */
function staff(scopes: string[]) {
  return {
    id: "staff_001",
    email: "staff@example.com",
    name: "Staff",
    role: "staff",
    status: "active",
    apiKey: "cod_staff_key",
    scopes,
  } as never;
}

function mountWith(scopes: string[]) {
  const instance = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  instance.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    c.set("user", staff(scopes));
    await next();
  });
  instance.onError(errorHandler);
  instance.route("/api/checkout-form", checkoutFormRouter);
  return instance;
}

beforeAll(async () => {
  harness = await createTestD1();
  app = mountWith(["checkout_form:read", "checkout_form:manage"]);
  readOnlyApp = mountWith(["checkout_form:read"]);
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  await harness.db.delete(schema.stores);
  await harness.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "API Test Store",
    createdAt: NOW(),
    updatedAt: NOW(),
  });
});

async function get() {
  const res = await app.request("/api/checkout-form");
  return { status: res.status, json: (await res.json()) as any };
}

async function put(body: unknown) {
  const res = await app.request("/api/checkout-form", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function storedColumn() {
  const row = await harness.db
    .select({ json: schema.stores.checkoutFormJson })
    .from(schema.stores)
    .where(eq(schema.stores.id, STORE_ID))
    .get();
  return row?.json ?? null;
}

const fullPolicy = (over: Record<string, unknown> = {}) => ({
  address: "optional",
  notes: "optional",
  email: "hidden",
  deliveryOptions: { home: true, stopDesk: true },
  customFields: [],
  ...over,
});

describe("GET", () => {
  it("returns the defaults for a store that never customised the form", async () => {
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.data.policy).toEqual(DEFAULT_CHECKOUT_FORM_POLICY);
  });

  it("ships the server's own rules, so the dashboard holds no second copy", async () => {
    const { json } = await get();
    expect(json.data.capabilities.builtInFields.address.states).toEqual([
      "required",
      "optional",
      "hidden",
    ]);
    expect(json.data.capabilities.builtInFields.email.states).toEqual([
      "required",
      "optional",
      "hidden",
    ]);
    expect(json.data.capabilities.customFieldTypes).toEqual([
      "text",
      "textarea",
      "number",
      "select",
    ]);
    expect(json.data.capabilities.limits.MAX_CUSTOM_FIELDS).toBe(5);
  });
});

describe("PUT", () => {
  it("saves a customised policy and reads it back", async () => {
    const { status, json } = await put(
      fullPolicy({ address: "required", email: "required", notes: "hidden" }),
    );
    expect(status).toBe(200);
    expect(json.data.policy.address).toBe("required");

    const after = await get();
    expect(after.json.data.policy).toEqual(json.data.policy);
  });

  it("clears the column when the policy is the defaults", async () => {
    // "Never customised" and "customised back to the defaults" are one row
    // state, which is also the documented rollback for the whole feature.
    await put(fullPolicy({ email: "required" }));
    expect(await storedColumn()).not.toBeNull();

    await put(fullPolicy());
    expect(await storedColumn()).toBeNull();
  });

  it("replaces rather than merges — an omitted key takes its default", async () => {
    await put(fullPolicy({ email: "required", address: "required" }));
    const { json } = await put({ address: "required" });
    expect(json.data.policy.address).toBe("required");
    expect(json.data.policy.email).toBe("hidden");
  });

  it("refuses an unknown key instead of dropping it", async () => {
    const { status, json } = await put(fullPolicy({ giftWrap: "required" }));
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("UNKNOWN_KEY");
    expect(await storedColumn()).toBeNull();
  });

  it("accepts hiding the address", async () => {
    const { status, json } = await put(fullPolicy({ address: "hidden" }));
    expect(status).toBe(200);
    expect(json.data.policy.address).toBe("hidden");
  });

  it("refuses a form with no delivery option left", async () => {
    const { status, json } = await put(
      fullPolicy({ deliveryOptions: { home: false, stopDesk: false } }),
    );
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("NO_DELIVERY_OPTION");
  });

  it("reports every problem at once", async () => {
    const { json } = await put(
      fullPolicy({ email: "sometimes", deliveryOptions: { home: false, stopDesk: false } }),
    );
    expect(json.context.issues.map((i: any) => i.code)).toEqual([
      "INVALID_STATE",
      "NO_DELIVERY_OPTION",
    ]);
  });
});

describe("custom field ids are server-owned", () => {
  it("mints an id for a new field", async () => {
    const { status, json } = await put(
      fullPolicy({ customFields: [{ label: "Preferred time", type: "text" }] }),
    );
    expect(status).toBe(200);
    expect(json.data.policy.customFields[0].id).toMatch(CUSTOM_FIELD_ID_PATTERN);
  });

  it("keeps the id across an edit, so old orders stay linked", async () => {
    const created = await put(
      fullPolicy({ customFields: [{ label: "Preferred time", type: "text" }] }),
    );
    const id = created.json.data.policy.customFields[0].id;

    const renamed = await put(
      fullPolicy({ customFields: [{ id, label: "Best time to call", type: "text" }] }),
    );
    expect(renamed.status).toBe(200);
    expect(renamed.json.data.policy.customFields[0]).toMatchObject({
      id,
      label: "Best time to call",
    });
  });

  it("refuses an id the client invented", async () => {
    const { status, json } = await put(
      fullPolicy({ customFields: [{ id: "cf_zzzzzzzz", label: "A", type: "text" }] }),
    );
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("UNKNOWN_FIELD_ID");
  });

  it("refuses an id from a field the merchant already deleted", async () => {
    // A second browser tab still showing the old form must not be able to
    // resurrect a field, because its id keys answers on existing orders.
    const created = await put(
      fullPolicy({ customFields: [{ label: "Preferred time", type: "text" }] }),
    );
    const id = created.json.data.policy.customFields[0].id;
    await put(fullPolicy({ customFields: [] }));

    const stale = await put(fullPolicy({ customFields: [{ id, label: "Preferred time", type: "text" }] }));
    expect(stale.status).toBe(400);
    expect(stale.json.context.issues[0].code).toBe("UNKNOWN_FIELD_ID");
  });

  it("mints distinct ids for fields added in the same save", async () => {
    const { json } = await put(
      fullPolicy({
        customFields: [
          { label: "One", type: "text" },
          { label: "Two", type: "number" },
        ],
      }),
    );
    const [a, b] = json.data.policy.customFields;
    expect(a.id).not.toBe(b.id);
  });

  it("refuses a dropdown with no choices", async () => {
    const { status, json } = await put(
      fullPolicy({ customFields: [{ label: "Colour", type: "select" }] }),
    );
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("INVALID_OPTIONS");
  });

  it("refuses more fields than the cap", async () => {
    const { status, json } = await put(
      fullPolicy({
        customFields: Array.from({ length: 6 }, (_, i) => ({ label: `F${i}`, type: "text" })),
      }),
    );
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("TOO_MANY_FIELDS");
  });

  it("keeps the merchant's order", async () => {
    const { json } = await put(
      fullPolicy({
        customFields: [
          { label: "First", type: "text" },
          { label: "Second", type: "text" },
          { label: "Third", type: "text" },
        ],
      }),
    );
    expect(json.data.policy.customFields.map((f: any) => f.label)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });
});

describe("permissions", () => {
  it("lets a read-only member see the policy", async () => {
    const res = await readOnlyApp.request("/api/checkout-form");
    expect(res.status).toBe(200);
  });

  it("refuses a save from a member who may only read", async () => {
    // Editing the order form is a separate grant from seeing it: the form is
    // where every order's data comes from.
    const res = await readOnlyApp.request("/api/checkout-form", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPolicy({ email: "required" })),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as any).required).toBe("checkout_form:manage");
    expect(await storedColumn()).toBeNull();
  });

  it("refuses both verbs for a member with neither scope", async () => {
    const none = mountWith([]);
    expect((await none.request("/api/checkout-form")).status).toBe(403);
    const put = await none.request("/api/checkout-form", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPolicy()),
    });
    expect(put.status).toBe(403);
  });
});

describe("a merchant-authored label is never trusted as markup", () => {
  it("stores it as the text it is", async () => {
    const label = "<img src=x onerror=alert(1)>";
    const { status, json } = await put(fullPolicy({ customFields: [{ label, type: "text" }] }));
    expect(status).toBe(200);
    // Stored verbatim — escaping belongs to the renderer, and the storefront
    // renders it as an Astro text node (never set:html). Storing an escaped
    // copy instead would double-escape it in the dashboard.
    expect(json.data.policy.customFields[0].label).toBe(label);
    expect(await storedColumn()).toContain("onerror");
  });
});
