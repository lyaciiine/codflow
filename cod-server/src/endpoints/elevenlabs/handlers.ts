import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { elevenLabsCalls } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrderById } from "@/endpoints/orders/queries";
import { ElevenLabsClient, ElevenLabsConfigurationError, ElevenLabsDisabledError } from "@/lib/elevenlabs/client";
import { verifyElevenLabsSignature } from "@/lib/elevenlabs/webhook";
import { updateOrderStatusWebhook } from "@/endpoints/orders/queries";
import { ValidationError, NotFoundError } from "@/lib/errors/classes";
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

  const callId = crypto.randomUUID();
  const now = new Date().toISOString();
  const client = new ElevenLabsClient(c.env);
  let status = "disabled";
  let reason = "ElevenLabs calls are disabled";
  if (!client.isConfigured()) {
    status = "missing_configuration";
    reason = "ElevenLabs API key is not configured";
  } else if (client.isEnabled()) {
    reason = "Outbound phone provider and ElevenLabs method are not configured";
  }

  await db.insert(elevenLabsCalls).values({
    id: callId,
    orderId,
    status,
    reason,
    createdAt: now,
  });

  return c.json({
    success: true,
    data: { callId, status, executionStarted: false },
  }, 202);
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
    .select({ id: elevenLabsCalls.id, status: elevenLabsCalls.status })
    .from(elevenLabsCalls)
    .where(eq(elevenLabsCalls.orderId, orderId))
    .get();
  if (!callRequest || !["requested", "in_progress"].includes(callRequest.status)) {
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
