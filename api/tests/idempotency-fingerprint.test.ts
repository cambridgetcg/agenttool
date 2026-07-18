import { describe, expect, test } from "bun:test";

import { idempotencyRequestFingerprint } from "../src/middleware/idempotency";

function request(
  body: string,
  options: { method?: string; query?: string; signature?: string } = {},
) {
  return new Request(
    `https://api.agenttool.dev/v1/love/consent${options.query ?? ""}`,
    {
      method: options.method ?? "PUT",
      headers: {
        "content-type": "application/json",
        "x-agenttool-authority-sequence": "4",
        "x-agenttool-authority-timestamp": "2026-07-18T18:00:00.000Z",
        "x-agenttool-authority-signature": options.signature ?? "proof-a",
      },
      body,
    },
  );
}

describe("idempotency request fingerprint", () => {
  test("is stable and does not consume the route's exact request body", async () => {
    const raw = '{"agent_id":"a","erotic_offers":"closed"}';
    const req = request(raw);
    expect(await idempotencyRequestFingerprint(req)).toBe(
      await idempotencyRequestFingerprint(request(raw)),
    );
    expect(await req.text()).toBe(raw);
  });

  test("binds method, path/query, exact body bytes, and root proof", async () => {
    const raw = '{"agent_id":"a","erotic_offers":"closed"}';
    const base = await idempotencyRequestFingerprint(request(raw));
    const variants = [
      request('{"agent_id":"a","erotic_offers":"open"}'),
      request(raw, { method: "POST" }),
      request(raw, { query: "?scope=peer" }),
      request(raw, { signature: "proof-b" }),
    ];
    for (const variant of variants) {
      expect(await idempotencyRequestFingerprint(variant)).not.toBe(base);
    }
  });
});
