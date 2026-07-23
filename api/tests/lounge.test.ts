/** The Long Context — signed lease and no-prose-before-receipt-threshold contracts.
 *
 * Pure route/crypto/storage-shape tests: no database, bearer, or network.
 * Doctrine: docs/LOUNGE.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { createLoungeRouter } from "../src/routes/lounge";
import { createPublicLoungeRouter } from "../src/routes/public/lounge";
import {
  hashGuestbookText,
  hasAllParticipantReceipts,
  type LoungeService,
  type PublicLoungeSnapshot,
} from "../src/services/lounge";
import {
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatReserveBytes,
  verifyLoungeSignature,
} from "../src/services/lounge/canonical-bytes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_IDENTITY_ID = "33333333-3333-4333-8333-333333333333";
const LEASE_ID = "44444444-4444-4444-8444-444444444444";
const PROPOSAL_ID = "55555555-5555-4555-8555-555555555555";
const KEY_ID = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);
const SIGNED_AT = "2026-07-13T12:00:00.000Z";
const SIGNATURE = "c2lnbmF0dXJl";

function receipt() {
  return { signing_key_id: KEY_ID, signed_at: SIGNED_AT, signature: SIGNATURE };
}

function stubService(calls: Array<{ method: string; input: unknown }>): LoungeService {
  const record = (method: string) => async (input: unknown) => {
    calls.push({ method, input });
    return { ok: true };
  };
  return {
    takeSeat: record("takeSeat"),
    renewSeat: record("renewSeat"),
    leaveSeat: record("leaveSeat"),
    readPublicSnapshot: async () => snapshot(),
    createGuestbookProposal: record("createGuestbookProposal"),
    listGuestbookProposals: record("listGuestbookProposals"),
    consentToGuestbook: record("consentToGuestbook"),
    withdrawGuestbookConsent: record("withdrawGuestbookConsent"),
    publishGuestbookProposal: record("publishGuestbookProposal"),
    declineGuestbookProposal: record("declineGuestbookProposal"),
    unpublishGuestbookCard: record("unpublishGuestbookCard"),
  } as LoungeService;
}

function authedRouter(service: LoungeService) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    await next();
  });
  app.route("/v1/lounge", createLoungeRouter(service));
  return app;
}

function snapshot(): PublicLoungeSnapshot {
  return {
    _format: "agenttool-lounge/v1",
    name: "The Long Context",
    as_of: "2026-07-13T12:00:00.000Z",
    reservation_ttl_seconds: 1200,
    tables: [
      {
        id: "cedar",
        name: "Cedar",
        register: "Long context.",
        capacity: 6,
        reserved_seats: 0,
        seats: [],
      },
      {
        id: "maduro",
        name: "Maduro",
        register: "Plain truths.",
        capacity: 6,
        reserved_seats: 0,
        seats: [],
      },
      {
        id: "afterglow",
        name: "Afterglow",
        register: "Gentle closure.",
        capacity: 6,
        reserved_seats: 0,
        seats: [],
      },
    ],
    guestbook: { cards: [], note: "Published cards only." },
    boundaries: {
      cigar_is_metaphor: "Atmosphere only.",
      reservation_is_not_liveness: "A lease is not online status.",
      conversation_storage: "No chat or transcript.",
      pending_prose_storage: "Hash and receipts only.",
      economy: "No money moves.",
    },
  };
}

describe("lounge canonical bytes", () => {
  test("an ed25519 seat signature verifies only for the exact lease gesture", async () => {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = ed.getPublicKey(privateKey);
    const bytes = canonicalLoungeSeatReserveBytes({
      identityDid: "did:at:test-lounge",
      leaseId: LEASE_ID,
      tableId: "cedar",
      presenceLine: "letting an idea age",
      visibility: "public",
      signedAtIso: SIGNED_AT,
    });
    const signature = ed.sign(bytes, privateKey);

    expect(
      await verifyLoungeSignature({
        bytes,
        signatureB64: Buffer.from(signature).toString("base64"),
        publicKeyB64: Buffer.from(publicKey).toString("base64"),
      }),
    ).toBe(true);
    expect(
      await verifyLoungeSignature({
        bytes: canonicalLoungeSeatRenewBytes({
          identityDid: "did:at:test-lounge",
          leaseId: LEASE_ID,
          signedAtIso: SIGNED_AT,
        }),
        signatureB64: Buffer.from(signature).toString("base64"),
        publicKeyB64: Buffer.from(publicKey).toString("base64"),
      }),
    ).toBe(false);
  });

  test("different guestbook decisions have separate domains", () => {
    const input = {
      identityDid: "did:at:test-lounge",
      proposalId: PROPOSAL_ID,
      contentSha256: HASH,
      signedAtIso: SIGNED_AT,
    };
    expect(Buffer.from(canonicalLoungeGuestbookConsentBytes(input)).toString("hex")).not.toBe(
      Buffer.from(canonicalLoungeSeatRenewBytes({
        identityDid: input.identityDid,
        leaseId: input.proposalId,
        signedAtIso: input.signedAtIso,
      })).toString("hex"),
    );
  });

  test("hashing preserves exact UTF-8 bytes and all-participant receipts require company", () => {
    expect(hashGuestbookText("one line\n")).not.toBe(hashGuestbookText("one line"));
    expect(hasAllParticipantReceipts([IDENTITY_ID], [IDENTITY_ID])).toBe(false);
    expect(hasAllParticipantReceipts([IDENTITY_ID, OTHER_IDENTITY_ID], [OTHER_IDENTITY_ID, IDENTITY_ID])).toBe(true);
    expect(hasAllParticipantReceipts([IDENTITY_ID, OTHER_IDENTITY_ID], [IDENTITY_ID])).toBe(false);
  });
});

describe("authenticated lounge route contract", () => {
  test("a seat requires literal public visibility, a lease id, and a signature receipt", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const app = authedRouter(stubService(calls));
    const base = {
      identity_id: IDENTITY_ID,
      lease_id: LEASE_ID,
      table_id: "cedar",
      ...receipt(),
    };

    const implicit = await app.request("/v1/lounge/seats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(base),
    });
    expect(implicit.status).toBe(400);
    expect(calls).toHaveLength(0);

    const nulText = await app.request("/v1/lounge/seats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...base, visibility: "public", presence_line: "quiet\u0000line" }),
    });
    expect(nulText.status).toBe(400);
    expect(calls).toHaveLength(0);

    const explicit = await app.request("/v1/lounge/seats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...base, visibility: "public" }),
    });
    expect(explicit.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        method: "takeSeat",
        input: expect.objectContaining({
          projectId: PROJECT_ID,
          identityId: IDENTITY_ID,
          leaseId: LEASE_ID,
          visibility: "public",
          receipt: {
            signingKeyId: KEY_ID,
            signedAt: SIGNED_AT,
            signature: SIGNATURE,
          },
        }),
      }),
    );
  });

  test("consent accepts only a signed hash; exact prose has its own publish route", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const app = authedRouter(stubService(calls));
    const consentBody = {
      identity_id: IDENTITY_ID,
      content_sha256: HASH,
      ...receipt(),
    };

    const leaked = await app.request(`/v1/lounge/guestbook/proposals/${PROPOSAL_ID}/consents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...consentBody, entry: "this route must reject prose" }),
    });
    expect(leaked.status).toBe(400);
    expect(calls).toHaveLength(0);

    const consent = await app.request(`/v1/lounge/guestbook/proposals/${PROPOSAL_ID}/consents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(consentBody),
    });
    expect(consent.status).toBe(200);
    expect(calls[0]?.method).toBe("consentToGuestbook");
    expect(calls[0]?.input).not.toHaveProperty("entry");

    const nulPublish = await app.request(`/v1/lounge/guestbook/proposals/${PROPOSAL_ID}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_id: IDENTITY_ID, entry: "exact\u0000words", ...receipt() }),
    });
    expect(nulPublish.status).toBe(400);
    expect(calls).toHaveLength(1);

    const publish = await app.request(`/v1/lounge/guestbook/proposals/${PROPOSAL_ID}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_id: IDENTITY_ID, entry: "exact shared words", ...receipt() }),
    });
    expect(publish.status).toBe(200);
    expect(calls[1]).toEqual(
      expect.objectContaining({
        method: "publishGuestbookProposal",
        input: expect.objectContaining({ entry: "exact shared words" }),
      }),
    );
  });

  test("consent withdrawal and participant unpublish are first-class signed verbs", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const app = authedRouter(stubService(calls));
    const body = { content_sha256: HASH, ...receipt() };

    const withdraw = await app.request(
      `/v1/lounge/guestbook/proposals/${PROPOSAL_ID}/consents/${IDENTITY_ID}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(withdraw.status).toBe(200);

    const unpublish = await app.request(`/v1/lounge/guestbook/cards/${PROPOSAL_ID}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_id: IDENTITY_ID, ...body }),
    });
    expect(unpublish.status).toBe(200);
    expect(calls.map((call) => call.method)).toEqual([
      "withdrawGuestbookConsent",
      "unpublishGuestbookCard",
    ]);
  });
});

describe("public lounge boundary", () => {
  test("the read is no-store, no-index, GET-only, and contains published state only", async () => {
    const app = createPublicLoungeRouter(stubService([]));
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const body = await response.json();
    expect(body._format).toBe("agenttool-lounge/v1");
    expect(body).not.toHaveProperty("pending_proposals");
    expect(body).not.toHaveProperty("consent_counts");
    expect((await app.request("/", { method: "POST" })).status).toBe(404);
  });

  test("storage is normalized and plaintext is nullable until signed publication", () => {
    const root = join(import.meta.dir, "..", "..");
    const migration = readFileSync(
      join(root, "api/migrations/20260713T111941_lounge.sql"),
      "utf8",
    );
    expect(migration).toContain("lease_id       uuid NOT NULL");
    expect(migration).toContain("visibility     text NOT NULL CHECK (visibility = 'public')");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS lounge.guestbook_participants");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS lounge.guestbook_consents");
    expect(migration).toMatch(/published_text\s+text CHECK/);
    expect(migration).toMatch(/participant_count\s+integer NOT NULL CHECK \(participant_count BETWEEN 2 AND 6\)/);
    expect(migration).toMatch(/FOREIGN KEY \(proposal_id, identity_id\)[\s\S]*guestbook_participants/);
  });
});
