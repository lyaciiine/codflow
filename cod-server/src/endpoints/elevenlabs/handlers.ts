import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { elevenLabsCalls } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrderById } from "@/endpoints/orders/queries";
import {
  ElevenLabsClient,
  ElevenLabsConfigurationError,
  ElevenLabsDisabledError,
  ElevenLabsProviderError,
  normalizeAlgerianWhatsAppUserId,
} from "@/lib/elevenlabs/client";
import { TimeoutError } from "@/lib/timeout";
import { verifyElevenLabsSignature } from "@/lib/elevenlabs/webhook";
import { updateOrderStatusWebhook } from "@/endpoints/orders/queries";
import { ValidationError, NotFoundError, ExternalApiError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { z } from "zod";

const webhookPayloadSchema = z.object({
  type: z.string().min(1),
  event_timestamp: z.union([z.string(), z.number()]),
  data: z.object({
    conversation_id: z.string().min(1).optional(),
    order_id: z.string().min(1).optional(),
    outcome: z.enum(["confirmed", "cancelled", "ambiguous"]).optional(),
    status: z.string().optional(),
  }).passthrough(),
}).passthrough();

export async function requestTestCall(c: Context<AppContext>) {
  const orderId = c.req.param("id");
  if (!orderId) throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  const db = getDb(c.env.DB);
  const order = await getOrderById(db, orderId);
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "new") {
    throw new ValidationError("Only new orders are eligible for WhatsApp confirmation calls");
  }

  const whatsappUserId = normalizeAlgerianWhatsAppUserId(order.phone);
  if (!whatsappUserId) {
    throw new ValidationError("Order phone cannot be mapped to a WhatsApp user ID");
  }

  const client = new ElevenLabsClient(c.env);
  if (!client.isEnabled()) {
    const callId = crypto.randomUUID();
    await db.insert(elevenLabsCalls).values({
      id: callId, orderId, status: "disabled", reason: "ElevenLabs calls are disabled",
      createdAt: new Date().toISOString(),
    });
    return c.json({
      success: true,
      data: { callId, status: "disabled", executionStarted: false },
    }, 202);
  }
  if (!client.isConfigured()) {
    throw new ValidationError("ElevenLabs outbound configuration is incomplete");
  }

  const callId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.insert(elevenLabsCalls).values({
      id: callId, orderId, status: "requested", createdAt: now,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.select({
      id: elevenLabsCalls.id,
      status: elevenLabsCalls.status,
      conversationId: elevenLabsCalls.conversationId,
    }).from(elevenLabsCalls).where(eq(elevenLabsCalls.orderId, orderId)).get();
    return c.json({
      success: true,
      data: {
        callId: existing?.id ?? callId,
        status: existing?.status ?? "requested",
        conversationId: existing?.conversationId ?? null,
        executionStarted: Boolean(existing?.conversationId),
      },
    }, 202);
  }

  try {
    const provider = await client.requestTestCall({
      orderId,
      whatsappUserId,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      orderTotal: String(order.price),
    });
    await db.update(elevenLabsCalls).set({
      status: "started",
      conversationId: provider.conversationId,
      providerCallId: provider.callSid,
      processedAt: new Date().toISOString(),
    }).where(eq(elevenLabsCalls.id, callId));
    return c.json({
      success: true,
      data: {
        callId,
        status: "started",
        conversationId: provider.conversationId,
        executionStarted: true,
      },
    }, 202);
  } catch (error) {
    const status = error instanceof TimeoutError ? "provider_ambiguous" : "failed";
    await db.update(elevenLabsCalls).set({
      status,
      reason: error instanceof TimeoutError
        ? "Provider response timed out; call may have started; no retry performed"
        : "ElevenLabs provider request failed",
      processedAt: new Date().toISOString(),
    }).where(eq(elevenLabsCalls.id, callId));
    if (error instanceof TimeoutError) {
      throw new ExternalApiError(
        "ElevenLabs",
        "Call request timed out; no retry was performed because the provider may have started it",
      );
    }
    if (error instanceof ElevenLabsProviderError) {
      throw new ExternalApiError("ElevenLabs", `Call request failed (${error.kind})`);
    }
    throw error;
  }
}

export async function handleWebhook(c: Context<AppContext>) {
  const rawBody = await c.req.text();
  const valid = await verifyElevenLabsSignature(
    rawBody,
    c.req.header("ElevenLabs-Signature") ?? null,
    c.env.ELEVENLABS_WEBHOOK_SECRET,
  );
  if (!valid) {
    throw new ValidationError("Invalid ElevenLabs webhook signature", ERROR_CODES.INVALID_WEBHOOK_PAYLOAD);
  }

  let payload: z.infer<typeof webhookPayloadSchema>;
  try {
    payload = webhookPayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new ValidationError("Invalid ElevenLabs webhook payload", ERROR_CODES.INVALID_WEBHOOK_PAYLOAD);
  }

  const conversationId = payload.data.conversation_id;
  const eventId = conversationId
    ? `${payload.type}:${conversationId}:${String(payload.event_timestamp)}`
    : `body:${await sha256(rawBody)}`;
  const db = getDb(c.env.DB);
  const existing = await db.select({ id: elevenLabsCalls.id })
    .from(elevenLabsCalls)
    .where(eq(elevenLabsCalls.eventId, eventId))
    .get();
  if (existing) return c.json({ received: true, duplicate: true }, 200);

  const orderId = payload.data.order_id;
  const outcome = payload.data.outcome;
  const now = new Date().toISOString();
  if (!orderId) {
    await db.insert(elevenLabsCalls).values({
      id: crypto.randomUUID(), orderId: null, eventId, conversationId: conversationId ?? null,
      outcome: outcome ?? null, status: "ambiguous", rawPayload: rawBody,
      reason: "Missing internal order_id", createdAt: now, processedAt: now,
    }).catch(() => {});
    return c.json({ received: true, outcome: "ambiguous" }, 200);
  }

  const order = await getOrderById(db, orderId);
  if (!order) throw new NotFoundError("Order", orderId);
  let status = "ignored";
  let reason: string | null = "Ambiguous or unsupported outcome";
  const callRequest = await db
    .select({
      id: elevenLabsCalls.id,
      status: elevenLabsCalls.status,
      conversationId: elevenLabsCalls.conversationId,
    })
    .from(elevenLabsCalls)
    .where(and(
      eq(elevenLabsCalls.orderId, orderId),
      inArray(elevenLabsCalls.status, ["requested", "in_progress", "started", "provider_ambiguous"]),
    ))
    .get();
  if (
    !callRequest ||
    (conversationId && callRequest.conversationId !== conversationId)
  ) {
    reason = "No eligible ElevenLabs call request for order";
  } else if (outcome === "confirmed" || outcome === "cancelled") {
    const result = await updateOrderStatusWebhook(db, orderId, outcome, "elevenlabs");
    status = result.updated ? "ok" : "ignored";
    reason = result.updated ? null : "Existing order transition rejected";
  }
  try {
    await db.insert(elevenLabsCalls).values({
      id: crypto.randomUUID(), orderId, eventId, conversationId: conversationId ?? null,
      outcome: outcome ?? null, status, rawPayload: rawBody,
      reason, createdAt: now, processedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ received: true, duplicate: true }, 200);
    throw error;
  }
  return c.json({ received: true, outcome: outcome ?? "ambiguous" }, 200);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.message.includes("UNIQUE constraint failed")) return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
