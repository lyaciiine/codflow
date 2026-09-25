/**
 * Store Authentication Middleware
 *
 * Validates the X-Store-API-Key header by comparing a SHA-256 hash
 * of the provided key against the stored hash in store_api_keys.
 */

import { Context, Next } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { storeApiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TimeoutError, withTimeout } from "@/lib/timeout";

const STORE_AUTH_DB_TIMEOUT_MS = 5_000;

async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function storeAuthMiddleware(c: Context<AppContext>, next: Next) {
  const rawKey = c.req.header("X-Store-API-Key");
  if (!rawKey) {
    return c.json({ error: "Missing store API key" }, 401);
  }

  try {
    const db = getDb(c.env.DB);
    const keyHash = await sha256hex(rawKey);

    const record = await withTimeout(
      db
        .select()
        .from(storeApiKeys)
        .where(eq(storeApiKeys.keyHash, keyHash))
        .get(),
      STORE_AUTH_DB_TIMEOUT_MS,
      "store API key lookup",
    );

    if (!record) {
      return c.json({ error: "Invalid store API key" }, 401);
    }

    c.set("storeId", record.storeId);

    // Update lastUsedAt fire-and-forget (non-critical)
    db.update(storeApiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(storeApiKeys.id, record.id))
      .run()
      .catch(() => {});

    await next();
  } catch (err) {
    console.error("[storeAuth]", err);
    if (err instanceof TimeoutError) {
      return c.json({ error: "Store authentication temporarily unavailable" }, 503);
    }
    return c.json({ error: "Authentication failed" }, 500);
  }
}
