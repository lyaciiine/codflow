/**
 * Authentication Middleware
 *
 * Validates API keys and loads user scopes for RBAC.
 * Supports both Bearer JWT tokens (from dashboard) and X-API-Key (programmatic access).
 */

import { Context, Next } from "hono";
import type { AppContext } from "@/types";
import { verifySessionJwt } from "@/lib/session-auth";
import { getDb } from "@/db";
import { users, userScopes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "../../../cod-shared/errors/codes";
import { TimeoutError, withTimeout } from "@/lib/timeout";

const AUTH_DB_TIMEOUT_MS = 5_000;

export async function authMiddleware(c: Context<AppContext>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const apiKey = c.req.header("X-API-Key");

  const db = getDb(c.env.DB);
  let user: typeof users.$inferSelect | undefined;

  if (bearerMatch) {
    try {
      const payload = await verifySessionJwt(bearerMatch[1], c.env);
      user = await withTimeout(
        db.select().from(users).where(eq(users.id, payload.sub)).get(),
        AUTH_DB_TIMEOUT_MS,
        "user lookup",
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        return c.json({
          error: "Authentication temporarily unavailable",
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          category: "INTERNAL",
        }, 503);
      }
      console.error("[auth] JWT verification failed:", err);
      return c.json({ 
        error: "Invalid token", 
        code: ERROR_CODES.AUTHENTICATION_FAILED,
        category: "AUTHENTICATION"
      }, 401);
    }
  } else if (apiKey) {
    try {
      user = await withTimeout(
        db.select().from(users).where(eq(users.apiKey, apiKey)).get(),
        AUTH_DB_TIMEOUT_MS,
        "API key lookup",
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        return c.json({
          error: "Authentication temporarily unavailable",
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          category: "INTERNAL",
        }, 503);
      }
      throw err;
    }
  } else {
    return c.json({ 
      error: "Missing authorization", 
      code: ERROR_CODES.MISSING_API_KEY,
      category: "AUTHENTICATION"
    }, 401);
  }

  if (!user) {
    return c.json({ 
      error: "User not found", 
      code: ERROR_CODES.AUTHENTICATION_FAILED,
      category: "AUTHENTICATION"
    }, 401);
  }

  if (user.status !== "active") {
    return c.json({ 
      error: "User account is inactive",
      code: ERROR_CODES.USER_INACTIVE,
      category: "AUTHENTICATION"
    }, 403);
  }

  let scopes: string[];
  if (user.role === "admin") {
    scopes = ["*"];
  } else {
    try {
      scopes = (await withTimeout(
          db.select({ scope: userScopes.scope }).from(userScopes).where(eq(userScopes.userId, user.id)),
          AUTH_DB_TIMEOUT_MS,
          "scope lookup",
        )).map((r) => r.scope);
    } catch (err) {
      if (err instanceof TimeoutError) {
        return c.json({
          error: "Authentication temporarily unavailable",
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          category: "INTERNAL",
        }, 503);
      }
      throw err;
    }
  }

  c.set("user", { ...user, scopes });
  await next();
}
