/**
 * Migration 0032 against a real D1, not a mock.
 *
 * A migration is exactly the kind of thing a mock cannot prove: the mock db
 * answers from a queue and would happily "store" a column that does not exist.
 * This replays every migration in order into miniflare's D1 — the same engine
 * production runs — and then uses the column the way the storefront will.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { stores } from "@/db/schema";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  parseWhatsAppWidgetConfig,
  resolveStorefrontWidget,
  serializeWhatsAppWidgetConfig,
} from "../../../cod-shared/whatsapp-widget/config";

let harness: TestD1;
const NOW = new Date().toISOString();
const STORE_ID = "store_whatsapp_widget";

beforeAll(async () => {
  harness = await createTestD1();
  await harness.db.insert(stores).values({
    id: STORE_ID,
    name: "WhatsApp Widget Test Store",
    createdAt: NOW,
    updatedAt: NOW,
  });
});

afterAll(async () => {
  await harness?.dispose();
});

async function readColumn(): Promise<string | null> {
  const row = await harness.db.select().from(stores).where(eq(stores.id, STORE_ID)).get();
  return row?.whatsappWidgetJson ?? null;
}

async function write(json: string | null): Promise<void> {
  await harness.db
    .update(stores)
    .set({ whatsappWidgetJson: json })
    .where(eq(stores.id, STORE_ID));
}

describe("stores.whatsapp_widget_json", () => {
  it("starts NULL, which every existing store reads as no widget", async () => {
    expect(await readColumn()).toBeNull();
    expect(parseWhatsAppWidgetConfig(await readColumn())).toEqual(
      DEFAULT_WHATSAPP_WIDGET_CONFIG,
    );
    expect(resolveStorefrontWidget(await readColumn())).toBeNull();
  });

  it("round-trips a real configuration through D1", async () => {
    const config = {
      ...DEFAULT_WHATSAPP_WIDGET_CONFIG,
      enabled: true,
      phone: "+213551234567",
      agentName: "أمين",
      caption: "نرد خلال دقائق",
      welcomeMessage: "مرحبا 👋 كيفاش نعاونك؟",
      prefillProduct: "سلام، بغيت نسقسي على {product}",
      accent: "primary" as const,
      position: "left" as const,
      surfaces: { ...DEFAULT_WHATSAPP_WIDGET_CONFIG.surfaces, checkout: true },
    };

    await write(serializeWhatsAppWidgetConfig(config));

    expect(parseWhatsAppWidgetConfig(await readColumn())).toEqual(config);
    // Arabic and the emoji survive the round trip — the storefront renders the
    // merchant's own words, so a mangled column is a mangled shop window.
    const widget = resolveStorefrontWidget(await readColumn());
    expect(widget?.href).toBe("https://wa.me/213551234567");
    expect(widget?.welcomeMessage).toBe("مرحبا 👋 كيفاش نعاونك؟");
    expect(widget?.surfaces.checkout).toBe(true);
  });

  it("turns the whole feature off again with the documented rollback", async () => {
    await write(null);

    expect(await readColumn()).toBeNull();
    expect(resolveStorefrontWidget(await readColumn())).toBeNull();
  });

  it("keeps a store rendering when the column holds something unreadable", async () => {
    await write("{ this is not json");

    expect(parseWhatsAppWidgetConfig(await readColumn())).toEqual(
      DEFAULT_WHATSAPP_WIDGET_CONFIG,
    );
    expect(resolveStorefrontWidget(await readColumn())).toBeNull();

    await write(null);
  });
});
