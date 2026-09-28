/**
 * GET / PUT /api/whatsapp-widget — real-D1 E2E through the real router.
 *
 * The save path is where this feature could quietly lie to a merchant: a
 * number that looks saved but never normalised produces a launcher that opens
 * a WhatsApp error page, and nobody finds out until a shopper tries. So these
 * run against real D1 and assert what actually landed in the column, not what
 * a handler returned.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import whatsappWidgetRouter from "./routes";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  WIDGET_TEXT_FIELDS,
  parseWhatsAppWidgetConfig,
} from "../../../../cod-shared/whatsapp-widget/config";

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
/** Same router, mounted for a staff user who may look but not change. */
let readOnlyApp: OpenAPIHono<AppContext>;
const NOW = () => new Date().toISOString();
const STORE_ID = "store-wa-api";

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
  instance.route("/api/whatsapp-widget", whatsappWidgetRouter);
  return instance;
}

beforeAll(async () => {
  harness = await createTestD1();
  app = mountWith(["whatsapp_widget:read", "whatsapp_widget:manage"]);
  readOnlyApp = mountWith(["whatsapp_widget:read"]);
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
  const res = await app.request("/api/whatsapp-widget");
  return { status: res.status, json: (await res.json()) as any };
}

async function put(body: unknown, instance = app) {
  const res = await instance.request("/api/whatsapp-widget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function storedColumn(): Promise<string | null> {
  const row = await harness.db
    .select({ json: schema.stores.whatsappWidgetJson })
    .from(schema.stores)
    .where(eq(schema.stores.id, STORE_ID))
    .get();
  return row?.json ?? null;
}

const ON = { enabled: true, phone: "0551234567" };

describe("GET /api/whatsapp-widget", () => {
  it("gives a store that never configured one the defaults, and no widget", async () => {
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.data.config).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    expect(json.data.preview).toBeNull();
  });

  it("ships the server's own rules so the dashboard renders the editor from them", async () => {
    const { json } = await get();
    expect(json.data.capabilities.textFields.caption.max).toBe(WIDGET_TEXT_FIELDS.caption.max);
    expect(json.data.capabilities.surfaceOrder).toEqual([
      "home",
      "catalog",
      "product",
      "pages",
      "thankYou",
      "checkout",
      "landing",
    ]);
    expect(json.data.capabilities.surfaces.checkout.default).toBe(false);
    expect(json.data.capabilities.accents).toEqual(["whatsapp", "primary"]);
    expect(json.data.capabilities.prefillTokens).toContain("product");
  });

  it("returns what a hand-edited row parses to, without throwing", async () => {
    await harness.db
      .update(schema.stores)
      .set({ whatsappWidgetJson: "{ not json" })
      .where(eq(schema.stores.id, STORE_ID));

    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.data.config).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
  });
});

describe("PUT — the number", () => {
  it.each([
    ["0551234567", "+213551234567"],
    ["055 12 34 567", "+213551234567"],
    ["00213661234567", "+213661234567"],
    ["+33612345678", "+33612345678"],
  ])("stores %s as %s, whichever way the merchant typed it", async (typed, stored) => {
    const { status, json } = await put({ enabled: true, phone: typed });
    expect(status).toBe(200);
    expect(json.data.config.phone).toBe(stored);
    // What landed in the column, not what the handler said.
    expect(parseWhatsAppWidgetConfig(await storedColumn()).phone).toBe(stored);
  });

  it("builds the wa.me link the storefront will use, with no +", async () => {
    const { json } = await put(ON);
    expect(json.data.preview.href).toBe("https://wa.me/213551234567");
  });

  it("refuses a number nobody can reach", async () => {
    const { status, json } = await put({ phone: "0211234567" });
    expect(status).toBe(400);
    expect(json.context.issues).toHaveLength(1);
    expect(json.context.issues[0]).toMatchObject({ path: "phone", code: "INVALID_PHONE" });
    expect(await storedColumn()).toBeNull();
  });

  it("refuses being switched on with nowhere to go", async () => {
    const { status, json } = await put({ enabled: true });
    expect(status).toBe(400);
    expect(json.context.issues[0]).toMatchObject({ path: "phone", code: "PHONE_REQUIRED" });
  });
});

describe("PUT — what is refused", () => {
  it("refuses an unknown key instead of dropping it silently", async () => {
    const { status, json } = await put({ ...ON, startMode: "compose" });
    expect(status).toBe(400);
    expect(json.context.issues[0]).toMatchObject({ path: "startMode", code: "UNKNOWN_KEY" });
  });

  it("refuses an unknown surface", async () => {
    const { status, json } = await put({ ...ON, surfaces: { blog: true } });
    expect(status).toBe(400);
    expect(json.context.issues[0]).toMatchObject({ path: "surfaces.blog", code: "UNKNOWN_KEY" });
  });

  it("refuses an avatar the shopper's browser would block", async () => {
    const { status, json } = await put({ ...ON, avatarUrl: "http://x.test/a.jpg" });
    expect(status).toBe(400);
    expect(json.context.issues[0].code).toBe("INVALID_AVATAR_URL");
  });

  it("refuses text past its cap", async () => {
    const { status, json } = await put({
      ...ON,
      caption: "x".repeat(WIDGET_TEXT_FIELDS.caption.max + 1),
    });
    expect(status).toBe(400);
    expect(json.context.issues[0]).toMatchObject({ path: "caption", code: "TEXT_TOO_LONG" });
  });

  it("reports every problem at once", async () => {
    const { json } = await put({ phone: "nope", accent: "neon", surfaces: { blog: true } });
    expect(json.context.issues.map((i: any) => i.code).sort()).toEqual([
      "INVALID_CHOICE",
      "INVALID_PHONE",
      "UNKNOWN_KEY",
    ]);
  });

  it("leaves the stored configuration untouched when it refuses", async () => {
    await put({ ...ON, agentName: "أمين" });
    const before = await storedColumn();

    await put({ ...ON, accent: "neon" });

    expect(await storedColumn()).toBe(before);
  });
});

describe("PUT — what is stored", () => {
  it("replaces the whole document: an omitted key takes its default", async () => {
    await put({ ...ON, agentName: "أمين", position: "left" });
    const { json } = await put(ON);

    expect(json.data.config.agentName).toBeNull();
    expect(json.data.config.position).toBe("right");
  });

  it("clears the column when the merchant saves their way back to nothing", async () => {
    await put({ ...ON, agentName: "أمين" });
    expect(await storedColumn()).not.toBeNull();

    const { status, json } = await put({});

    expect(status).toBe(200);
    expect(json.data.config).toEqual(DEFAULT_WHATSAPP_WIDGET_CONFIG);
    // The documented rollback state, reached from the UI.
    expect(await storedColumn()).toBeNull();
  });

  it("keeps Arabic and emoji intact through the column", async () => {
    const { json } = await put({
      ...ON,
      agentName: "أمين",
      welcomeMessage: "مرحبا 👋 كيفاش نعاونك؟",
      prefillProduct: "سلام، بغيت نسقسي على {product}",
    });

    expect(json.data.preview.welcomeMessage).toBe("مرحبا 👋 كيفاش نعاونك؟");
    expect(parseWhatsAppWidgetConfig(await storedColumn()).agentName).toBe("أمين");
  });

  it("accepts every surface off — a paused widget keeps the merchant's text", async () => {
    const off = Object.fromEntries(
      Object.keys(DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces).map((key) => [key, false]),
    );
    const { status, json } = await put({ ...ON, agentName: "أمين", surfaces: off });

    expect(status).toBe(200);
    expect(Object.values(json.data.config.surfaces).every((v) => v === false)).toBe(true);
    expect(json.data.config.agentName).toBe("أمين");
  });
});

describe("the preview is the shop window, not a second opinion", () => {
  it("is null while the widget is off, even with everything else filled in", async () => {
    const { json } = await put({ phone: "0551234567", agentName: "أمين" });
    expect(json.data.config.phone).toBe("+213551234567");
    expect(json.data.preview).toBeNull();
  });

  it("never carries the number itself — only the link built from it", async () => {
    const { json } = await put(ON);
    expect(json.data.preview).not.toHaveProperty("phone");
    expect(json.data.preview).not.toHaveProperty("enabled");
  });

  it("carries the surface map the theme gates on", async () => {
    const { json } = await put({ ...ON, surfaces: { checkout: true } });
    expect(json.data.preview.surfaces.checkout).toBe(true);
    expect(json.data.preview.surfaces.landing).toBe(false);
  });
});

describe("permissions", () => {
  it("lets a read-only member look", async () => {
    const res = await readOnlyApp.request("/api/whatsapp-widget");
    expect(res.status).toBe(200);
  });

  it("refuses a read-only member the save", async () => {
    const { status } = await put(ON, readOnlyApp);
    expect(status).toBe(403);
    expect(await storedColumn()).toBeNull();
  });

  it("refuses a member with no widget scopes at all", async () => {
    const outsider = mountWith(["orders:read"]);
    expect((await outsider.request("/api/whatsapp-widget")).status).toBe(403);
    expect((await put(ON, outsider)).status).toBe(403);
  });
});
