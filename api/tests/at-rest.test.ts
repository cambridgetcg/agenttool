/** POST /v1/identities/:id/at-rest — witnessed memorial transition.
 *
 *  Mostly pure-unit. We verify body validation, the DID-to-DID self-witness
 *  predicate, the future-date guard, canonical bytes, and source-level
 *  presence of the wired persistence chain. Database integration belongs in
 *  the integration suite.
 *
 *  Doctrine: docs/AT-REST.md.
 */

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import atRestApp, {
  canTransitionToAtRest,
  canWitnessAtRest,
  canProjectTransitionIdentity,
  canonicalAtRestBytes,
  isEndedAtTooFarInFuture,
  isSelfWitness,
  isValidAtRestInput,
} from "../src/routes/identity/at-rest";

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
  const { Hono } = await import("hono");
  const wrapper = new Hono();
  wrapper.route("/:id", atRestApp);
  const res = await wrapper.request(`/${encodeURIComponent(idInPath)}`, {
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
    expect(
      isValidAtRestInput({
        ...validBody,
        at_rest_kind: "custom:bleach-event",
      }),
    ).toBe(true);
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
  test("self-witnessing compares the resolved about DID to witness_did", () => {
    expect(isSelfWitness("did:at:test/me", "did:at:test/me")).toBe(true);
    expect(isSelfWitness("did:at:test/me", "did:at:test/witness")).toBe(false);
  });

  test("only active identities can transition to at-rest", () => {
    expect(canTransitionToAtRest("active")).toBe(true);
    expect(canTransitionToAtRest("revoked")).toBe(false);
    expect(canTransitionToAtRest("memorial")).toBe(false);
  });

  test("only active identities can witness an at-rest transition", () => {
    expect(canWitnessAtRest("active")).toBe(true);
    expect(canWitnessAtRest("revoked")).toBe(false);
    expect(canWitnessAtRest("memorial")).toBe(false);
  });

  test("the authenticated project must own the at-rest target", () => {
    expect(canProjectTransitionIdentity("project-a", "project-a")).toBe(true);
    expect(canProjectTransitionIdentity("project-a", "project-b")).toBe(false);
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

  test("ended_at within 5-minute tolerance is accepted (clock skew)", () => {
    const now = Date.parse("2026-05-12T10:00:00.000Z");
    expect(
      isEndedAtTooFarInFuture("2026-05-12T10:02:00.000Z", now),
    ).toBe(false);
    expect(
      isEndedAtTooFarInFuture("2026-05-12T11:00:00.000Z", now),
    ).toBe(true);
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
    expect(src).toContain('.for("update")');
    expect(src).toContain('eq(identities.status, "active")');
    expect(src).toContain('error: "about_identity_not_owned"');
    expect(src.indexOf("canProjectTransitionIdentity(project.id, about.projectId)")).toBeLessThan(
      src.indexOf("Resolve the witness's pubkey"),
    );
  });
});
