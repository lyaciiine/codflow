import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { handleWebhook, requestTestCall } from "./handlers";
import routes from "./routes";

const db = {
  insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ get: vi.fn().mockResolvedValue(undefined) })),
    })),
  })),
} as any;

vi.mock("@/db", () => ({ getDb: vi.fn(() => db) }));
vi.mock("@/endpoints/orders/queries", () => ({
  getOrderById: vi.fn(),
  updateOrderStatusWebhook: vi.fn(),
}));
vi.mock("@/lib/elevenlabs/webhook", () => ({
  verifyElevenLabsSignature: vi.fn(),
}));

import { getOrderById, updateOrderStatusWebhook } from "@/endpoints/orders/queries";
import { verifyElevenLabsSignature } from "@/lib/elevenlabs/webhook";

function appFor(handler: typeof handleWebhook | typeof requestTestCall) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.env = { DB: db } as any;
    await next();
  });
  app.onError(errorHandler);
  app.post("/orders/:id", handler as any);
  return app;
}

describe("ElevenLabs order call handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrderById).mockResolvedValue({
      id: "order-1",
      phone: "0550000000",
      customerName: "Customer",
      orderNumber: "1001",
      price: 1000,
      status: "new",
    } as any);
    vi.mocked(verifyElevenLabsSignature).mockResolvedValue(true);
    vi.mocked(updateOrderStatusWebhook).mockResolvedValue({ updated: true });
  });

  it("records a disabled request without calling ElevenLabs", async () => {
    const response = await appFor(requestTestCall).request("/orders/order-1", { method: "POST" });
    expect(response.status).toBe(202);
    expect(db.insert).toHaveBeenCalled();
  });

  it("rejects an invalid order id", async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    const response = await appFor(requestTestCall).request("/orders/missing", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid Algerian customer phone before recording a call", async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      id: "order-1",
      phone: "0215500000",
      status: "new",
    } as any);
    const response = await appFor(requestTestCall).request("/orders/order-1", { method: "POST" });
    expect(response.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("records ambiguous outcomes without changing status", async () => {
    const body = JSON.stringify({
      type: "post_call_transcription",
      event_timestamp: 1700000000,
      data: { order_id: "order-1", conversation_id: "conv-1" },
    });
    const response = await appFor(handleWebhook).request("/orders/ignored", {
      method: "POST",
      headers: { "ElevenLabs-Signature": "t=1700000000,v0=test" },
      body,
    });
    expect(response.status).toBe(200);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
  });

  it("returns duplicate for an already recorded event", async () => {
    db.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ get: vi.fn().mockResolvedValue({ id: "call-1" }) }) }),
    });
    const body = JSON.stringify({
      type: "post_call_transcription",
      event_timestamp: 1700000000,
      data: { conversation_id: "conv-1" },
    });
    const response = await appFor(handleWebhook).request("/orders/ignored", {
      method: "POST",
      headers: { "ElevenLabs-Signature": "t=1700000000,v0=test" },
      body,
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it("does not apply a webhook to a different conversation for the same order", async () => {
    db.select
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ get: vi.fn().mockResolvedValue(undefined) }) }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            get: vi.fn().mockResolvedValue({
              id: "call-1",
              status: "started",
              conversationId: "other-conversation",
            }),
          }),
        }),
      });
    const body = JSON.stringify({
      type: "post_call_transcription",
      event_timestamp: 1700000000,
      data: {
        order_id: "order-1",
        conversation_id: "conversation-1",
        outcome: "confirmed",
      },
    });
    const response = await appFor(handleWebhook).request("/orders/ignored", {
      method: "POST",
      headers: { "ElevenLabs-Signature": "t=1700000000,v0=test" },
      body,
    });
    expect(response.status).toBe(200);
    expect(updateOrderStatusWebhook).not.toHaveBeenCalled();
  });

  it("rejects missing webhook configuration/signature", async () => {
    vi.mocked(verifyElevenLabsSignature).mockResolvedValue(false);
    const response = await appFor(handleWebhook).request("/orders/ignored", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(400);
  });

  it("protects the test-call endpoint with the order update scope", async () => {
    const unauthenticated = new Hono<AppContext>();
    unauthenticated.route("/api/elevenlabs", routes);
    expect((await unauthenticated.request("/api/elevenlabs/orders/order-1/test-call", { method: "POST" })).status)
      .toBe(401);

    const staff = new Hono<AppContext>();
    staff.use("*", async (c, next) => {
      c.set("user", {
        id: "staff-1",
        role: "staff",
        scopes: [],
      } as any);
      await next();
    });
    staff.route("/api/elevenlabs", routes);
    expect((await staff.request("/api/elevenlabs/orders/order-1/test-call", { method: "POST" })).status)
      .toBe(403);
  });
});
