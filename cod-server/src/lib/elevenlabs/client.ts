import type { Env } from "@/types";
import { TimeoutError } from "@/lib/timeout";

export class ElevenLabsConfigurationError extends Error {}
export class ElevenLabsDisabledError extends Error {}
export class ElevenLabsProviderError extends Error {
  constructor(public readonly kind: "rate_limited" | "authentication" | "provider" | "malformed") {
    super(`ElevenLabs provider ${kind} error`);
  }
}

export interface ElevenLabsCallRequest {
  orderId: string;
  whatsappUserId: string;
  customerName: string;
  orderNumber: string;
  orderTotal: string;
}

export interface ElevenLabsCallResponse {
  conversationId: string;
  callSid: string | null;
}

export function normalizeAlgerianPhone(phone: string): string | null {
  const compact = phone.replace(/[\s().-]/g, "");
  if (/^0[5-7]\d{8}$/.test(compact)) return `+213${compact.slice(1)}`;
  if (/^\+213[5-7]\d{8}$/.test(compact)) return compact;
  if (/^213[5-7]\d{8}$/.test(compact)) return `+${compact}`;
  return null;
}

export function normalizeAlgerianWhatsAppUserId(phone: string): string | null {
  const normalized = normalizeAlgerianPhone(phone);
  return normalized?.slice(1) ?? null;
}

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call";
const ELEVENLABS_TIMEOUT_MS = 10_000;

export class ElevenLabsClient {
  constructor(
    private readonly env: Pick<
      Env,
      | "ELEVENLABS_API_KEY"
      | "ELEVENLABS_CALLS_ENABLED"
      | "ELEVENLABS_AGENT_ID"
      | "ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID"
      | "ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME"
      | "ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE"
    >,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.env.ELEVENLABS_API_KEY &&
      this.env.ELEVENLABS_AGENT_ID &&
      this.env.ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID &&
      this.env.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME &&
      this.env.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE,
    );
  }

  isEnabled(): boolean {
    return this.env.ELEVENLABS_CALLS_ENABLED === "true";
  }

  async requestTestCall(request: ElevenLabsCallRequest): Promise<ElevenLabsCallResponse> {
    if (!this.env.ELEVENLABS_API_KEY) {
      throw new ElevenLabsConfigurationError("ElevenLabs outbound configuration is incomplete");
    }
    if (!this.isEnabled()) {
      throw new ElevenLabsDisabledError("ElevenLabs calls are disabled");
    }
    if (!this.isConfigured()) {
      throw new ElevenLabsConfigurationError("ElevenLabs outbound configuration is incomplete");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(ELEVENLABS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": this.env.ELEVENLABS_API_KEY!,
        },
        body: JSON.stringify({
          agent_id: this.env.ELEVENLABS_AGENT_ID,
          whatsapp_phone_number_id: this.env.ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID,
          whatsapp_user_id: request.whatsappUserId,
          whatsapp_call_permission_request_template_name:
            this.env.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_NAME,
          whatsapp_call_permission_request_template_language_code:
            this.env.ELEVENLABS_WHATSAPP_CALL_PERMISSION_TEMPLATE_LANGUAGE,
          conversation_initiation_client_data: {
            dynamic_variables: {
              order_id: request.orderId,
              order_number: request.orderNumber,
              customer_name: request.customerName,
              order_total: request.orderTotal,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError("ElevenLabs outbound call", ELEVENLABS_TIMEOUT_MS);
      }
      throw new ElevenLabsProviderError("provider");
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ElevenLabsProviderError("authentication");
    }
    if (response.status === 429) {
      throw new ElevenLabsProviderError("rate_limited");
    }
    if (!response.ok) throw new ElevenLabsProviderError("provider");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ElevenLabsProviderError("malformed");
    }
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).conversation_id !== "string" ||
      !(body as Record<string, unknown>).conversation_id
    ) {
      throw new ElevenLabsProviderError("malformed");
    }
    const data = body as { conversation_id: string; callSid?: unknown };
    return {
      conversationId: data.conversation_id,
      callSid: typeof data.callSid === "string" ? data.callSid : null,
    };
  }
}
