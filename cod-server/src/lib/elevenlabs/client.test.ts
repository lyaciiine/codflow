import { describe, expect, it } from "vitest";
import {
  ElevenLabsClient,
  ElevenLabsConfigurationError,
  ElevenLabsDisabledError,
} from "./client";

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
});
