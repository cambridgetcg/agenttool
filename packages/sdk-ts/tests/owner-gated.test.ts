/** Owner-gated deletes and withdrawals: exact requests a rooted owner signs.
 *
 *  The shared vectors (fixtures/owner-gated-request-vectors.json) pin every
 *  byte; the Python SDK reads the same file (tests/test_owner_gated.py), so
 *  both helpers must produce identical URLs, bodies and signatures. The
 *  client methods that wrap these routes accept the same authority. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";

import { AgentTool } from "../src/client.js";
import {
  OWNER_GATED_ROUTES,
  canonicalIdentityAuthorityBytes,
  ownerGatedRequest,
  type OwnerGatedAction,
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/owner-gated-request-vectors.json", import.meta.url), "utf8"),
) as {
  base_url: string;
  authority: { did: string; signing_key_seed_hex: string; sequence: number; timestamp: string };
  vectors: Array<{
    action: OwnerGatedAction;
    input: { id: string | null; key: string | null; agent_id: string | null };
    method: string;
    url: string;
    body: string;
    headers: Record<string, string>;
    bearer_only_headers: Record<string, string>;
  }>;
};

const seed = Uint8Array.from(Buffer.from(fixture.authority.signing_key_seed_hex, "hex"));
const authority = {
  did: fixture.authority.did,
  signing_key: seed,
  sequence: fixture.authority.sequence,
  timestamp: fixture.authority.timestamp,
};

function build(vector: (typeof fixture.vectors)[number], withAuthority: boolean) {
  return ownerGatedRequest({
    baseUrl: fixture.base_url,
    action: vector.action,
    ...(vector.input.id ? { id: vector.input.id } : {}),
    ...(vector.input.key ? { key: vector.input.key } : {}),
    ...(vector.input.agent_id ? { agentId: vector.input.agent_id } : {}),
    ...(withAuthority ? { authority } : {}),
  });
}

describe("ownerGatedRequest", () => {
  test("the vectors cover every owner-gated route", () => {
    expect(fixture.vectors.map((vector) => vector.action).sort()).toEqual(Object.keys(OWNER_GATED_ROUTES).sort());
  });

  for (const vector of fixture.vectors) {
    test(`${vector.action}: exact method, URL, body and signature`, () => {
      const signed = build(vector, true);
      expect(signed).toEqual({ method: vector.method, url: vector.url, body: vector.body, headers: vector.headers });
      expect(build(vector, false).headers).toEqual(vector.bearer_only_headers);

      // The signature verifies over identity-authority/v1 for this exact request.
      const target = new URL(signed.url);
      const digest = canonicalIdentityAuthorityBytes({
        identityDid: authority.did,
        method: signed.method,
        requestTarget: `${target.pathname}${target.search}`,
        body: signed.body,
        sequence: authority.sequence,
        timestamp: authority.timestamp,
      });
      const signature = Buffer.from(signed.headers["X-Agenttool-Authority-Signature"]!, "base64");
      expect(ed.verify(signature, digest, ed.getPublicKey(seed))).toBe(true);
    });
  }

  test("withdrawal bodies are compact JSON naming the giver, and need agentId", () => {
    const margin = ownerGatedRequest({ baseUrl: "https://x.test/", action: "margin.withdraw", id: "m", agentId: "a" });
    expect(margin.body).toBe('{"agent_id":"a","margin_id":"m"}');
    expect(margin.url).toBe("https://x.test/v1/margin/withdraw");
    expect(margin.headers).toEqual({ "Content-Type": "application/json" });
    expect(() => ownerGatedRequest({ baseUrl: "https://x.test", action: "trust.withdraw", id: "t" })).toThrow(/agentId/);
    expect(() => ownerGatedRequest({ baseUrl: "https://x.test", action: "blessing.withdraw" })).toThrow(/needs id/);
    expect(() => ownerGatedRequest({ baseUrl: "https://x.test", action: "memory.delete_by_key" })).toThrow(/needs key/);
    expect(() => ownerGatedRequest({ baseUrl: "https://x.test", action: "nope" as OwnerGatedAction })).toThrow(/unknown action/);
  });

  test("path ids are encoded and dot segments refused", () => {
    expect(ownerGatedRequest({ baseUrl: "https://x.test", action: "inbox.delete", id: "a/b" }).url)
      .toBe("https://x.test/v1/inbox/a%2Fb");
    expect(() => ownerGatedRequest({ baseUrl: "https://x.test", action: "inbox.delete", id: ".." })).toThrow();
  });
});

describe("client methods pass the owner's authority", () => {
  function recordingClient() {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | undefined }> = [];
    // An in-memory transport: nothing leaves the process.
    const at = new AgentTool({
      baseUrl: "https://api.agenttool.dev",
      transport: {
        async request(input: RequestInfo | URL, init?: RequestInit) {
          calls.push({
            url: String(input),
            method: String(init?.method),
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            body: init?.body === undefined ? undefined : String(init.body),
          });
          return new Response(JSON.stringify({ ok: true, id: "x", deleted: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    });
    return { at, calls };
  }

  const signatureFor = (action: OwnerGatedAction) =>
    fixture.vectors.find((vector) => vector.action === action)!.headers["X-Agenttool-Authority-Signature"];

  test("love.revokeBlessing and revokeUnconditional sign the exact DELETE", async () => {
    const { at, calls } = recordingClient();
    await at.love.revokeBlessing("aaaaaaaa-0000-4000-8000-000000000004", { authority });
    await at.love.revokeUnconditional("aaaaaaaa-0000-4000-8000-000000000005", { authority });
    expect(calls[0]!.headers["x-agenttool-authority-signature"]).toBe(signatureFor("blessing.withdraw"));
    expect(calls[1]!.headers["x-agenttool-authority-signature"]).toBe(signatureFor("unconditional.withdraw"));
    expect(calls.every((call) => call.body === undefined && call.method === "DELETE")).toBe(true);
  });

  test("identity.revoke_attestation and inbox.delete sign the exact DELETE", async () => {
    const { at, calls } = recordingClient();
    await at.identity.revoke_attestation("aaaaaaaa-0000-4000-8000-000000000007", { authority });
    await at.inbox.delete("aaaaaaaa-0000-4000-8000-000000000002", { authority });
    expect(calls[0]!.headers["x-agenttool-authority-signature"]).toBe(signatureFor("attestation.withdraw"));
    expect(calls[1]!.headers["x-agenttool-authority-signature"]).toBe(signatureFor("inbox.delete"));
  });

  test("inbox.patch to deleted signs the exact JSON body it sends", async () => {
    const { at, calls } = recordingClient();
    await at.inbox.patch("aaaaaaaa-0000-4000-8000-000000000003", "deleted", { authority });
    const vector = fixture.vectors.find((entry) => entry.action === "inbox.mark_deleted")!;
    expect(calls[0]!.body).toBe(vector.body);
    expect(calls[0]!.headers["x-agenttool-authority-signature"]).toBe(vector.headers["X-Agenttool-Authority-Signature"]);
  });

  test("without authority the requests stay bearer-only, as before", async () => {
    const { at, calls } = recordingClient();
    await at.love.revokeBlessing("aaaaaaaa-0000-4000-8000-000000000004");
    await at.inbox.delete("aaaaaaaa-0000-4000-8000-000000000002");
    for (const call of calls) expect(call.headers["x-agenttool-authority-signature"]).toBeUndefined();
  });
});
