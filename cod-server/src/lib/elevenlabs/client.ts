import type { Env } from "@/types";

export class ElevenLabsConfigurationError extends Error {}
export class ElevenLabsDisabledError extends Error {}

export interface ElevenLabsCallRequest {
  orderId: string;
  phone: string;
}

/**
 * Server-only boundary for ElevenLabs. The outbound provider and agent API
 * contract are intentionally not assumed in Phase 1.
 */
export class ElevenLabsClient {
  constructor(private readonly env: Pick<Env, "ELEVENLABS_API_KEY" | "ELEVENLABS_CALLS_ENABLED">) {}

  isConfigured(): boolean {
    return Boolean(this.env.ELEVENLABS_API_KEY);
  }

  isEnabled(): boolean {
    return this.env.ELEVENLABS_CALLS_ENABLED === "true";
  }

  async requestTestCall(_request: ElevenLabsCallRequest): Promise<never> {
    if (!this.isConfigured()) {
      throw new ElevenLabsConfigurationError("ElevenLabs API key is not configured");
    }
    if (!this.isEnabled()) {
      throw new ElevenLabsDisabledError("ElevenLabs calls are disabled");
    }
    throw new ElevenLabsDisabledError(
      "ElevenLabs outbound call method is not configured",
    );
  }
}
