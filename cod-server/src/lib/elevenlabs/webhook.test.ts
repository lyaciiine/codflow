import { describe, expect, it } from "vitest";
import { verifyElevenLabsSignature } from "./webhook";

async function signature(body: string, timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("ElevenLabs webhook signatures", () => {
  it("accepts the documented raw-body HMAC signature", async () => {
    const body = '{"type":"post_call_transcription","data":{}}';
    const timestamp = "1700000000";
    const digest = await signature(body, timestamp, "secret");

    await expect(
      verifyElevenLabsSignature(body, `t=${timestamp},v0=${digest}`, "secret", 1700000000),
    ).resolves.toBe(true);
  });

  it("rejects invalid signatures, stale timestamps, and missing configuration", async () => {
    await expect(
      verifyElevenLabsSignature("{}", "t=1700000000,v0=bad", "secret", 1700000000),
    ).resolves.toBe(false);
    await expect(
      verifyElevenLabsSignature("{}", "t=1,v0=bad", "secret", 1700000000),
    ).resolves.toBe(false);
    await expect(
      verifyElevenLabsSignature("{}", "t=1700000000,v0=bad", undefined, 1700000000),
    ).resolves.toBe(false);
  });
});
