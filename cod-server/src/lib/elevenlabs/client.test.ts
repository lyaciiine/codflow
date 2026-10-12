import { describe, expect, it, vi } from "vitest";
import {
  ElevenLabsClient,
  ElevenLabsConfigurationError,
  ElevenLabsDisabledError,
  normalizeAlgerianPhone,
  normalizeAlgerianWhatsAppUserId,
} from "./client";

const request = {
  orderId: "order-1",
  whatsappUserId: "213550000000",
  customerName: "Customer",
  orderNumber: "1001",
  orderTotal: "1000",
};

const enabledEnv = {
  ELEVENLABS_API_KEY: "server-only",
  ELEVENLABS_AGENT_ID: "agent",
  ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID: "phone",
  ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME: "call_permission",
  ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE: "en",
  ELEVENLABS_CALLS_ENABLED: "true",
};

describe("ElevenLabsClient", () => {
  it("fails closed when the API key is missing", async () => {
    const client = new ElevenLabsClient({});
    expect(client.isConfigured()).toBe(false);
    await expect(client.requestTestCall(request))
      .rejects.toBeInstanceOf(ElevenLabsConfigurationError);
  });

  it("does not execute calls while the feature flag is disabled", async () => {
    const client = new ElevenLabsClient({ ELEVENLABS_API_KEY: "configured" });
    expect(client.isEnabled()).toBe(false);
    await expect(client.requestTestCall(request))
      .rejects.toBeInstanceOf(ElevenLabsDisabledError);
  });

  it("normalizes only valid Algerian mobile numbers to the documented WhatsApp ID", () => {
    expect(normalizeAlgerianPhone("0550 00 00 00")).toBe("+213550000000");
    expect(normalizeAlgerianPhone("+213 550000000")).toBe("+213550000000");
    expect(normalizeAlgerianPhone("021 5500000")).toBeNull();
    expect(normalizeAlgerianWhatsAppUserId("0550 00 00 00")).toBe("213550000000");
  });

  it("sends the documented WhatsApp outbound-call request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ conversation_id: "conv-1" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(new ElevenLabsClient(enabledEnv, fetcher).requestTestCall(request))
      .resolves.toEqual({ conversationId: "conv-1", callSid: null });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call",
      expect.objectContaining({
        body: expect.stringContaining('"whatsapp_user_id":"213550000000"'),
      }),
    );
  });

  it("handles malformed, rate-limited, auth, and provider responses", async () => {
    const response = (status: number, body: unknown) => vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
    await expect(new ElevenLabsClient(enabledEnv, response(200, {})).requestTestCall(request))
      .rejects.toMatchObject({ kind: "malformed" });
    await expect(new ElevenLabsClient(enabledEnv, response(429, {})).requestTestCall(request))
      .rejects.toMatchObject({ kind: "rate_limited" });
    await expect(new ElevenLabsClient(enabledEnv, response(401, {})).requestTestCall(request))
      .rejects.toMatchObject({ kind: "authentication" });
    await expect(new ElevenLabsClient(enabledEnv, response(500, {})).requestTestCall(request))
      .rejects.toMatchObject({ kind: "provider" });
  });

  it("classifies an aborted provider request as a timeout", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(new ElevenLabsClient(enabledEnv, fetcher).requestTestCall(request))
      .rejects.toMatchObject({ name: "TimeoutError" });
  });
});
