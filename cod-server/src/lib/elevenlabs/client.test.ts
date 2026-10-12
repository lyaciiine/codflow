import { describe, expect, it, vi } from "vitest";
import {
  ElevenLabsClient,
  ElevenLabsConfigurationError,
  ElevenLabsDisabledError,
} from "./client";
import { normalizeAlgerianPhone } from "./client";

describe("ElevenLabsClient", () => {
  it("fails closed when the API key is missing", async () => {
    const client = new ElevenLabsClient({});
    expect(client.isConfigured()).toBe(false);
    await expect(client.requestTestCall({ orderId: "order-1", phone: "0550000000" }))
      .rejects.toBeInstanceOf(ElevenLabsConfigurationError);
  });

  it("does not execute calls while the feature flag is disabled", async () => {
    const client = new ElevenLabsClient({ ELEVENLABS_API_KEY: "configured" });
    expect(client.isEnabled()).toBe(false);
    await expect(client.requestTestCall({ orderId: "order-1", phone: "0550000000" }))
      .rejects.toBeInstanceOf(ElevenLabsDisabledError);
  });

  it("normalizes only valid Algerian mobile numbers", () => {
    expect(normalizeAlgerianPhone("0550 00 00 00")).toBe("+213550000000");
    expect(normalizeAlgerianPhone("+213 550000000")).toBe("+213550000000");
    expect(normalizeAlgerianPhone("021 5500000")).toBeNull();
  });

  it("handles successful, malformed, rate-limited, auth, and provider responses", async () => {
    const env = {
      ELEVENLABS_API_KEY: "server-only",
      ELEVENLABS_AGENT_ID: "agent",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phone",
      ELEVENLABS_CALLS_ENABLED: "true",
    };
    const response = (status: number, body: unknown) => vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
    const success = new ElevenLabsClient(env, response(200, {
      conversation_id: "conv-1", callSid: "CA1",
    }));
    await expect(success.requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .resolves.toEqual({ conversationId: "conv-1", callSid: "CA1" });
    await expect(new ElevenLabsClient(env, response(200, {}))
      .requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .rejects.toMatchObject({ kind: "malformed" });
    await expect(new ElevenLabsClient(env, response(429, {})
      ).requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .rejects.toMatchObject({ kind: "rate_limited" });
    await expect(new ElevenLabsClient(env, response(401, {})
      ).requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .rejects.toMatchObject({ kind: "authentication" });
    await expect(new ElevenLabsClient(env, response(500, {})
      ).requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .rejects.toMatchObject({ kind: "provider" });
  });

  it("classifies an aborted provider request as a timeout", async () => {
    const env = {
      ELEVENLABS_API_KEY: "server-only",
      ELEVENLABS_AGENT_ID: "agent",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phone",
      ELEVENLABS_CALLS_ENABLED: "true",
    };
    const fetcher = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(new ElevenLabsClient(env, fetcher)
      .requestTestCall({ orderId: "order-1", phone: "+213550000000" }))
      .rejects.toMatchObject({ name: "TimeoutError" });
  });
});
