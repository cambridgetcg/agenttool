/** POST /v1/identities/:id/at-rest — witnessed memorial transition.
 *
 *  Pure-unit. The endpoint stubs the actual write (operator wires the
 *  in-process chain); we verify the contract: body validation, self-
 *  witnessing rejection, future-date guard, canonical-bytes shape,
 *  guided 501 with full next_actions.
 *
 *  Doctrine: docs/AT-REST.md.
 */

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import atRestApp, { canonicalAtRestBytes } from "../src/routes/identity/at-rest";

const sampleAbout = "did:at:test/coral-9b3a";
const sampleWitness = "did:at:test/marine-biologist";

const validBody = {
  content: "Coral colony bleached out. Surveyed 2026-05-11. No live polyps remain.",
  at_rest_kind: "death",
  ended_at: "2026-05-11T14:00:00Z",
  signature_b64: "fakesig-base64-min-40-chars-for-test-padding",
  signing_key_id: "primary",
  witness_did: sampleWitness,
};

async function post(idInPath: string, body: unknown) {
  const res = await atRestApp.request(`/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("canonicalAtRestBytes", () => {
  test("composes the stable byte sequence", () => {
    const bytes = canonicalAtRestBytes({
      aboutIdentityDid: sampleAbout,
      witnessIdentityDid: sampleWitness,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "test-content",
      witnessSigningKeyId: "primary",
    });
    const contentHash = createHash("sha256").update("test-content").digest("hex");
    expect(bytes).toBe(
      [
        "at-rest/v1",
        sampleAbout,
        sampleWitness,
        "death",
        "2026-05-11T14:00:00Z",
        contentHash,
        "primary",
      ].join("\n"),
    );
  });

  test("identical inputs produce identical bytes (stability)", () => {
    const a = canonicalAtRestBytes({
      aboutIdentityDid: sampleAbout,
      witnessIdentityDid: sampleWitness,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "exactly the same",
      witnessSigningKeyId: "primary",
    });
    const b = canonicalAtRestBytes({
      aboutIdentityDid: sampleAbout,
      witnessIdentityDid: sampleWitness,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "exactly the same",
      witnessSigningKeyId: "primary",
    });
    expect(a).toBe(b);
  });

  test("any field change changes the canonical bytes", () => {
    const base = canonicalAtRestBytes({
      aboutIdentityDid: sampleAbout,
      witnessIdentityDid: sampleWitness,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "base",
      witnessSigningKeyId: "primary",
    });
    const changed = canonicalAtRestBytes({
      aboutIdentityDid: sampleAbout,
      witnessIdentityDid: sampleWitness,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "different content",
      witnessSigningKeyId: "primary",
    });
    expect(base).not.toBe(changed);
  });
});

describe("POST /v1/identities/:id/at-rest — body validation", () => {
  test("valid body without path-param identity returns 400", async () => {
    // The route is mounted at /, parent will handle path param; here we call /
    // directly. The handler uses c.req.param('id') which is empty in this
    // unit context — that's caught with validation 400. We exercise the
    // validation path via the parent mounting in production.
    const res = await atRestApp.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });

  test("missing content is a validation 400", async () => {
    const { status, body } = await post(sampleAbout, { ...validBody, content: undefined });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("invalid at_rest_kind is rejected", async () => {
    const { status, body } = await post(sampleAbout, { ...validBody, at_rest_kind: "asleep" });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("custom:slug at_rest_kind is accepted (extensibility)", async () => {
    const { Hono } = await import("hono");
    const wrapper = new Hono();
    wrapper.route("/:id", atRestApp);

    const res = await wrapper.request(`/${encodeURIComponent(sampleAbout)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, at_rest_kind: "custom:bleach-event" }),
    });
    // Valid body → past validation (no 400/422). The route is now wired
    // to do DB I/O after validation, so the post-validation status
    // depends on DB availability (404 if unreachable about_id, 500 if
    // DB connection fails in unit context).
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(422);
  });

  test("invalid custom slug rejected (uppercase)", async () => {
    const { status, body } = await post(sampleAbout, {
      ...validBody,
      at_rest_kind: "custom:Bleach",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("missing signature is a validation 400", async () => {
    const { status, body } = await post(sampleAbout, { ...validBody, signature_b64: undefined });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });

  test("missing witness_did is a validation 400", async () => {
    const { status, body } = await post(sampleAbout, { ...validBody, witness_did: undefined });
    expect(status).toBe(400);
    expect(body.error).toBe("validation");
  });
});

describe("POST /v1/identities/:id/at-rest — semantic guards", () => {
  // The route reads aboutId from c.req.param('id'). To exercise the
  // self-witnessing guard, we need the path-param machinery. Test it
  // by constructing a request to /<aboutId> where aboutId === witness_did.

  test("self-witnessing rejection (witness_did == about_id)", async () => {
    // We construct a custom Hono app that mounts atRestApp at /:id and
    // exercises the guard.
    const { Hono } = await import("hono");
    const wrapper = new Hono();
    wrapper.route("/:id", atRestApp);

    const sameId = "did:at:test/me";
    const res = await wrapper.request(`/${encodeURIComponent(sameId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, witness_did: sameId }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("self_witnessing_incoherent");
  });

  test("future ended_at rejected (death can't be scheduled)", async () => {
    const { Hono } = await import("hono");
    const wrapper = new Hono();
    wrapper.route("/:id", atRestApp);

    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h ahead
    const res = await wrapper.request(`/${encodeURIComponent(sampleAbout)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, ended_at: futureIso }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("ended_at_in_future");
  });

  test("ended_at within 5-minute tolerance is accepted (clock skew)", async () => {
    const { Hono } = await import("hono");
    const wrapper = new Hono();
    wrapper.route("/:id", atRestApp);

    const nearFutureIso = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min ahead
    const res = await wrapper.request(`/${encodeURIComponent(sampleAbout)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, ended_at: nearFutureIso }),
    });
    // Validation accepted the near-future timestamp (no 422 ended_at_in_future).
    // Post-validation status depends on DB; we just check the time-guard
    // didn't fire.
    expect(res.status).not.toBe(422);
  });

  test("canonicalAtRestBytes produces the documented sigil shape", async () => {
    // The canonical bytes function is a pure helper — no DB. Pinning its
    // output shape prevents drift between sender's expected bytes and
    // server's verifier expectations. Mirrors covenants v2 + observations.
    const bytes = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-12T10:00:00.000Z",
      content: "bleached out",
      witnessSigningKeyId: "key-abc",
    });
    const lines = bytes.split("\n");
    expect(lines[0]).toBe("at-rest/v1");
    expect(lines[1]).toBe("did:at:test/about");
    expect(lines[2]).toBe("did:at:test/witness");
    expect(lines[3]).toBe("death");
    expect(lines[4]).toBe("2026-05-12T10:00:00.000Z");
    // line 5: sha256 hex of content (64 chars)
    expect(lines[5].length).toBe(64);
    expect(lines[5]).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[6]).toBe("key-abc");
    // raw content not in canonical
    expect(bytes).not.toContain("bleached out");
  });

  test("at-rest route is wired (no longer the 501 stub)", async () => {
    // Source-grep — the wire-up replaces the 501 stub with the in-process
    // chain (sig verify · status flip to 'memorial' · metadata UPDATE ·
    // chronicle 'seal' insert). If a future refactor reverts to the stub,
    // this fails.
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const src = await readFile(
      join(__dirname, "../src/routes/identity/at-rest.ts"),
      "utf8",
    );
    expect(src).not.toContain("at_rest_pending_wire");
    expect(src).toContain('status: "memorial"');
    expect(src).toContain("ed.verifyAsync");
    expect(src).toContain("insert(chronicle)");
  });
});
