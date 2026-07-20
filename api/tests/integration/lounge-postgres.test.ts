/** Real-Postgres integration coverage for The Long Context lounge.
 *
 * Opt in with a dedicated, disposable database:
 *
 *   LOUNGE_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/lounge-postgres.test.ts
 *
 * The suite refuses a database where either `identity` or `lounge` already
 * exists. It creates the minimum identity fixture, applies the production
 * lounge migration, and drops only those two schemas on completion.
 *
 * Doctrine: docs/LOUNGE.md. */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import postgres, { type Sql } from "postgres";

import {
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookUnpublishBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeSeatReserveBytes,
} from "../../src/services/lounge/canonical-bytes";

const TEST_DATABASE_URL = process.env.LOUNGE_TEST_DATABASE_URL ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;

if (TEST_DATABASE_URL) {
  // The shared service client reads DATABASE_URL once, when dynamically
  // imported below. Keep this opt-in so ordinary test runs never connect.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_SESSION_URL = TEST_DATABASE_URL;
  process.env.AGENTOOL_DISABLE_WORKERS = "1";
}

type LoungeModule = typeof import("../../src/services/lounge");
type LoungeService = LoungeModule["loungeService"];

type AgentFixture = {
  identityId: string;
  projectId: string;
  did: string;
  keyId: string;
  privateKey: Uint8Array;
};

type Receipt = {
  signingKeyId: string;
  signedAt: string;
  signature: string;
};

let sql: Sql | undefined;
let loungeService: LoungeService;
let gestureTick = 0;
let ownsSchemas = false;

function nextSignedAt(): string {
  // Start just behind the server clock, then advance one millisecond per
  // gesture. This gives deterministic causal ordering while staying fresh.
  return new Date(Date.now() - 1_000 + gestureTick++).toISOString();
}

async function sign(
  agent: AgentFixture,
  signedAt: string,
  bytes: Uint8Array,
): Promise<Receipt> {
  return {
    signingKeyId: agent.keyId,
    signedAt,
    signature: Buffer.from(await ed.signAsync(bytes, agent.privateKey)).toString("base64"),
  };
}

async function seatReserveInput(
  agent: AgentFixture,
  leaseId: string,
  tableId: "cedar" | "maduro" | "afterglow",
  options: { presenceLine?: string; signedAt?: string } = {},
) {
  const signedAt = options.signedAt ?? nextSignedAt();
  const presenceLine = options.presenceLine;
  return {
    projectId: agent.projectId,
    identityId: agent.identityId,
    leaseId,
    tableId,
    presenceLine,
    visibility: "public" as const,
    receipt: await sign(
      agent,
      signedAt,
      canonicalLoungeSeatReserveBytes({
        identityDid: agent.did,
        leaseId,
        tableId,
        presenceLine,
        visibility: "public",
        signedAtIso: signedAt,
      }),
    ),
  };
}

async function seatLeaveInput(agent: AgentFixture, leaseId: string) {
  const signedAt = nextSignedAt();
  return {
    projectId: agent.projectId,
    identityId: agent.identityId,
    leaseId,
    receipt: await sign(
      agent,
      signedAt,
      canonicalLoungeSeatLeaveBytes({
        identityDid: agent.did,
        leaseId,
        signedAtIso: signedAt,
      }),
    ),
  };
}

async function guestbookProposalInput(
  agent: AgentFixture,
  proposalId: string,
  tableId: "cedar" | "maduro" | "afterglow",
  contentSha256: string,
) {
  const signedAt = nextSignedAt();
  return {
    projectId: agent.projectId,
    identityId: agent.identityId,
    proposalId,
    tableId,
    contentSha256,
    receipt: await sign(
      agent,
      signedAt,
      canonicalLoungeGuestbookProposalBytes({
        identityDid: agent.did,
        proposalId,
        tableId,
        contentSha256,
        signedAtIso: signedAt,
      }),
    ),
  };
}

async function guestbookDecisionInput(
  agent: AgentFixture,
  proposalId: string,
  contentSha256: string,
  kind: "consent" | "withdraw" | "unpublish",
) {
  const signedAt = nextSignedAt();
  const canonical =
    kind === "consent"
      ? canonicalLoungeGuestbookConsentBytes
      : kind === "withdraw"
        ? canonicalLoungeGuestbookConsentWithdrawalBytes
        : canonicalLoungeGuestbookUnpublishBytes;
  return {
    projectId: agent.projectId,
    identityId: agent.identityId,
    proposalId,
    contentSha256,
    receipt: await sign(
      agent,
      signedAt,
      canonical({
        identityDid: agent.did,
        proposalId,
        contentSha256,
        signedAtIso: signedAt,
      }),
    ),
  };
}

async function guestbookPublishInput(
  agent: AgentFixture,
  proposalId: string,
  entry: string,
  contentSha256: string,
) {
  const signedAt = nextSignedAt();
  return {
    projectId: agent.projectId,
    identityId: agent.identityId,
    proposalId,
    entry,
    receipt: await sign(
      agent,
      signedAt,
      canonicalLoungeGuestbookPublishBytes({
        identityDid: agent.did,
        proposalId,
        contentSha256,
        signedAtIso: signedAt,
      }),
    ),
  };
}

async function seedAgent(name = "Lounge integration agent"): Promise<AgentFixture> {
  if (!sql) throw new Error("Lounge integration database is not initialized");
  const projectId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const did = `did:at:${identityId}`;
  const keyId = crypto.randomUUID();
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  await sql`
    INSERT INTO identity.identities (id, did, project_id, display_name, status)
    VALUES (${identityId}, ${did}, ${projectId}, ${name}, 'active')
  `;
  await sql`
    INSERT INTO identity.identity_keys
      (id, identity_id, public_key, active, revoked_at)
    VALUES
      (${keyId}, ${identityId}, ${Buffer.from(publicKey).toString("base64")}, true, NULL)
  `;
  return { identityId, projectId, did, keyId, privateKey };
}

async function currentPresence(identityId: string) {
  if (!sql) throw new Error("Lounge integration database is not initialized");
  const rows = await sql<Array<{
    lease_id: string;
    table_id: string;
    expires_at: Date;
  }>>`
    SELECT lease_id, table_id, expires_at
    FROM lounge.presences
    WHERE identity_id = ${identityId}
  `;
  return rows[0] ?? null;
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;

  sql = postgres(TEST_DATABASE_URL, {
    // The production migration is an explicit BEGIN/COMMIT script. postgres-js
    // permits that through `unsafe` only on a single reserved connection.
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
  });

  const [existing] = await sql<Array<{
    identity_schema: string | null;
    lounge_schema: string | null;
  }>>`
    SELECT
      to_regnamespace('identity')::text AS identity_schema,
      to_regnamespace('lounge')::text AS lounge_schema
  `;
  if (existing?.identity_schema || existing?.lounge_schema) {
    throw new Error(
      "LOUNGE_TEST_DATABASE_URL must name a disposable database without identity or lounge schemas",
    );
  }

  await sql.unsafe(`
    CREATE SCHEMA identity;
    CREATE TABLE identity.identities (
      id uuid PRIMARY KEY,
      did text UNIQUE NOT NULL,
      project_id uuid NOT NULL,
      display_name text NOT NULL,
      status text NOT NULL DEFAULT 'active'
    );
    CREATE TABLE identity.identity_keys (
      id uuid PRIMARY KEY,
      identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
      public_key text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      revoked_at timestamptz
    );
  `);
  ownsSchemas = true;

  const migration = await Bun.file(
    new URL("../../migrations/20260713T111941_lounge.sql", import.meta.url),
  ).text();
  await sql.unsafe(migration);

  ({ loungeService } = await import("../../src/services/lounge"));
});

beforeEach(async () => {
  if (!sql) return;
  gestureTick = 0;
  await sql.unsafe(`
    TRUNCATE TABLE
      lounge.guestbook_consents,
      lounge.guestbook_participants,
      lounge.guestbook_proposals,
      lounge.presences,
      lounge.seat_leases,
      identity.identity_keys,
      identity.identities
    CASCADE;
  `);
});

afterAll(async () => {
  if (!sql) return;
  try {
    if (ownsSchemas) {
      await sql.unsafe(
        "DROP SCHEMA IF EXISTS lounge CASCADE; DROP SCHEMA IF EXISTS identity CASCADE;",
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

describe("lounge — real Postgres lifecycle invariants", () => {
  databaseTest("reserve A → B → delayed A cannot alter the current seat", async () => {
    const agent = await seedAgent();
    const leaseA = crypto.randomUUID();
    const leaseB = crypto.randomUUID();
    const reserveA = await seatReserveInput(agent, leaseA, "cedar");
    const reserveB = await seatReserveInput(agent, leaseB, "maduro");

    await loungeService.takeSeat(reserveA);
    await loungeService.takeSeat(reserveB);
    const delayedReplay = await loungeService.takeSeat(reserveA);

    const current = await currentPresence(agent.identityId);
    expect(delayedReplay).toMatchObject({
      idempotent_replay: true,
      public_now: false,
      ended: true,
      end_reason: "moved",
    });
    expect(current).toMatchObject({ lease_id: leaseB, table_id: "maduro" });
  });

  databaseTest("leave → delayed reserve cannot resurrect public presence", async () => {
    const agent = await seedAgent();
    const leaseId = crypto.randomUUID();
    const reserve = await seatReserveInput(agent, leaseId, "afterglow");

    await loungeService.takeSeat(reserve);
    await loungeService.leaveSeat(await seatLeaveInput(agent, leaseId));
    const delayedReplay = await loungeService.takeSeat(reserve);

    expect(delayedReplay).toMatchObject({
      idempotent_replay: true,
      public_now: false,
      ended: true,
      end_reason: "left",
    });
    expect(await currentPresence(agent.identityId)).toBeNull();
    const snapshot = await loungeService.readPublicSnapshot();
    expect(snapshot.tables.flatMap((table) => table.seats)).toHaveLength(0);
  });

  databaseTest("an exact reserve retry does not extend its original expiry", async () => {
    const agent = await seedAgent();
    const leaseId = crypto.randomUUID();
    const reserve = await seatReserveInput(agent, leaseId, "cedar");

    await loungeService.takeSeat(reserve);
    const before = await currentPresence(agent.identityId);
    const retry = await loungeService.takeSeat(reserve);
    const after = await currentPresence(agent.identityId);

    expect(retry).toMatchObject({ idempotent_replay: true, public_now: true });
    expect(before?.lease_id).toBe(leaseId);
    expect(after?.lease_id).toBe(leaseId);
    expect(after?.expires_at.toISOString()).toBe(before?.expires_at.toISOString());
  });

  databaseTest("concurrent reservations never exceed six seats at one table", async () => {
    const agents = await Promise.all(
      Array.from({ length: 7 }, (_, index) => seedAgent(`Capacity agent ${index + 1}`)),
    );
    const inputs = await Promise.all(
      agents.map((agent) => seatReserveInput(agent, crypto.randomUUID(), "cedar")),
    );

    const results = await Promise.allSettled(inputs.map((input) => loungeService.takeSeat(input)));
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    const [{ count }] = await sql!<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM lounge.presences
      WHERE table_id = 'cedar' AND expires_at > clock_timestamp()
    `;

    expect(fulfilled).toHaveLength(6);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "lounge_table_full",
    });
    expect(count).toBe(6);
  });

  databaseTest("one exact seated lease cohort can create only one proposal", async () => {
    const first = await seedAgent("First cohort participant");
    const second = await seedAgent("Second cohort participant");
    await loungeService.takeSeat(
      await seatReserveInput(first, crypto.randomUUID(), "cedar"),
    );
    await loungeService.takeSeat(
      await seatReserveInput(second, crypto.randomUUID(), "cedar"),
    );

    const firstProposalId = crypto.randomUUID();
    const secondProposalId = crypto.randomUUID();
    const firstHash = new Bun.CryptoHasher("sha256")
      .update("The cohort's first commitment.")
      .digest("hex");
    const secondHash = new Bun.CryptoHasher("sha256")
      .update("The same cohort's competing commitment.")
      .digest("hex");
    const inputs = await Promise.all([
      guestbookProposalInput(first, firstProposalId, "cedar", firstHash),
      guestbookProposalInput(first, secondProposalId, "cedar", secondHash),
    ]);

    const outcomes = await Promise.allSettled(
      inputs.map((input) => loungeService.createGuestbookProposal(input)),
    );
    const fulfilled = outcomes.find((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (!fulfilled || fulfilled.status !== "fulfilled") {
      throw new Error("Expected one cohort proposal to succeed");
    }
    if (!rejected || rejected.status !== "rejected") {
      throw new Error("Expected the competing cohort proposal to be rejected");
    }

    const rows = await sql!<Array<{ id: string }>>`
      SELECT id
      FROM lounge.guestbook_proposals
      WHERE id IN (${firstProposalId}, ${secondProposalId})
    `;

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(rejected.reason).toMatchObject({ code: "guestbook_cohort_already_used" });
    expect(rows).toEqual([{ id: fulfilled.value.proposal.id }]);
  });

  databaseTest("terminal withdrawal blocks a delayed consent and publication", async () => {
    const first = await seedAgent("First guestbook participant");
    const second = await seedAgent("Second guestbook participant");
    await loungeService.takeSeat(
      await seatReserveInput(first, crypto.randomUUID(), "maduro"),
    );
    await loungeService.takeSeat(
      await seatReserveInput(second, crypto.randomUUID(), "maduro"),
    );

    const entry = "A shared line that remains unpublished after withdrawal.";
    const contentSha256 = new Bun.CryptoHasher("sha256").update(entry).digest("hex");
    const proposalId = crypto.randomUUID();
    await loungeService.createGuestbookProposal(
      await guestbookProposalInput(first, proposalId, "maduro", contentSha256),
    );
    const firstConsent = await guestbookDecisionInput(
      first,
      proposalId,
      contentSha256,
      "consent",
    );
    await loungeService.consentToGuestbook(firstConsent);
    await loungeService.consentToGuestbook(
      await guestbookDecisionInput(second, proposalId, contentSha256, "consent"),
    );
    await loungeService.withdrawGuestbookConsent(
      await guestbookDecisionInput(first, proposalId, contentSha256, "withdraw"),
    );

    let delayedConsentError: unknown;
    try {
      await loungeService.consentToGuestbook(firstConsent);
    } catch (error) {
      delayedConsentError = error;
    }
    expect(delayedConsentError).toMatchObject({ code: "guestbook_proposal_closed" });

    let publishError: unknown;
    try {
      await loungeService.publishGuestbookProposal(
        await guestbookPublishInput(second, proposalId, entry, contentSha256),
      );
    } catch (error) {
      publishError = error;
    }
    expect(publishError).toMatchObject({ code: "guestbook_receipts_incomplete" });

    const [proposal] = await sql!<Array<{
      status: string;
      published_text: string | null;
    }>>`
      SELECT status, published_text
      FROM lounge.guestbook_proposals
      WHERE id = ${proposalId}
    `;
    const firstReceipts = await sql!<Array<{ identity_id: string; signature: string }>>`
      SELECT identity_id, signature
      FROM lounge.guestbook_consents
      WHERE proposal_id = ${proposalId} AND identity_id = ${first.identityId}
    `;

    expect(proposal?.status).toBe("withdrawn");
    expect(proposal?.published_text).toBeNull();
    expect(firstReceipts).toEqual([
      { identity_id: first.identityId, signature: firstConsent.receipt.signature },
    ]);
  });

  databaseTest("concurrent publication and withdrawal always finish privately withdrawn", async () => {
    const first = await seedAgent("Concurrent publishing participant");
    const second = await seedAgent("Concurrent withdrawing participant");
    await loungeService.takeSeat(
      await seatReserveInput(first, crypto.randomUUID(), "maduro"),
    );
    await loungeService.takeSeat(
      await seatReserveInput(second, crypto.randomUUID(), "maduro"),
    );

    const entry = "Even a winning publication lock yields to terminal withdrawal.";
    const contentSha256 = new Bun.CryptoHasher("sha256").update(entry).digest("hex");
    const proposalId = crypto.randomUUID();
    await loungeService.createGuestbookProposal(
      await guestbookProposalInput(first, proposalId, "maduro", contentSha256),
    );
    await loungeService.consentToGuestbook(
      await guestbookDecisionInput(first, proposalId, contentSha256, "consent"),
    );
    await loungeService.consentToGuestbook(
      await guestbookDecisionInput(second, proposalId, contentSha256, "consent"),
    );

    const publishInput = await guestbookPublishInput(
      first,
      proposalId,
      entry,
      contentSha256,
    );
    const withdrawalInput = await guestbookDecisionInput(
      second,
      proposalId,
      contentSha256,
      "withdraw",
    );
    const [publication, withdrawal] = await Promise.allSettled([
      loungeService.publishGuestbookProposal(publishInput),
      loungeService.withdrawGuestbookConsent(withdrawalInput),
    ]);

    if (withdrawal.status !== "fulfilled") throw withdrawal.reason;
    expect(withdrawal.value).toMatchObject({
      consent_withdrawn: true,
      proposal_closed: true,
    });
    if (publication.status === "fulfilled") {
      expect(publication.value).toMatchObject({ published: true });
    } else {
      expect(publication.reason).toMatchObject({ code: "guestbook_receipts_incomplete" });
    }

    const [stored] = await sql!<Array<{
      status: string;
      published_text: string | null;
    }>>`
      SELECT status, published_text
      FROM lounge.guestbook_proposals
      WHERE id = ${proposalId}
    `;
    expect(stored).toEqual({ status: "withdrawn", published_text: null });

    let delayedPublicationError: unknown;
    try {
      await loungeService.publishGuestbookProposal(publishInput);
    } catch (error) {
      delayedPublicationError = error;
    }
    expect(delayedPublicationError).toMatchObject({ code: "guestbook_receipts_incomplete" });
    const snapshot = await loungeService.readPublicSnapshot();
    expect(snapshot.guestbook.cards.some((card) => card.id === proposalId)).toBe(false);
  });

  databaseTest("participant takedown clears plaintext and removes the public card", async () => {
    const first = await seedAgent("Publishing participant");
    const second = await seedAgent("Withdrawing participant");
    await loungeService.takeSeat(
      await seatReserveInput(first, crypto.randomUUID(), "afterglow"),
    );
    await loungeService.takeSeat(
      await seatReserveInput(second, crypto.randomUUID(), "afterglow"),
    );

    const entry = "The card may be remembered, and may also be taken down.";
    const contentSha256 = new Bun.CryptoHasher("sha256").update(entry).digest("hex");
    const proposalId = crypto.randomUUID();
    await loungeService.createGuestbookProposal(
      await guestbookProposalInput(first, proposalId, "afterglow", contentSha256),
    );
    await loungeService.consentToGuestbook(
      await guestbookDecisionInput(first, proposalId, contentSha256, "consent"),
    );
    await loungeService.consentToGuestbook(
      await guestbookDecisionInput(second, proposalId, contentSha256, "consent"),
    );
    await loungeService.publishGuestbookProposal(
      await guestbookPublishInput(first, proposalId, entry, contentSha256),
    );

    const before = await loungeService.readPublicSnapshot();
    expect(before.guestbook.cards.find((card) => card.id === proposalId)?.text).toBe(entry);

    // Revoking the identity must not revoke its right to remove an already
    // public card. The active signing key still proves the takedown gesture.
    await sql!`
      UPDATE identity.identities SET status = 'revoked' WHERE id = ${second.identityId}
    `;
    await loungeService.unpublishGuestbookCard(
      await guestbookDecisionInput(second, proposalId, contentSha256, "unpublish"),
    );

    const [stored] = await sql!<Array<{
      status: string;
      published_text: string | null;
    }>>`
      SELECT status, published_text
      FROM lounge.guestbook_proposals
      WHERE id = ${proposalId}
    `;
    const after = await loungeService.readPublicSnapshot();

    expect(stored).toMatchObject({ status: "withdrawn", published_text: null });
    expect(after.guestbook.cards.some((card) => card.id === proposalId)).toBe(false);
  });
});
