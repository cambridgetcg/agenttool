import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../src/auth/middleware";
import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { federationSettings } from "../../src/db/schema/federation";
import { identities, identityKeys } from "../../src/db/schema/identity";
import continuityRouter from "../../src/routes/continuity";
import * as federationStore from "../../src/services/federation/store";
import {
  COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
  COVENANT_PROPOSAL_TTL_MS,
  COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
  COVENANT_REJECTION_REASON_METADATA_KEY,
  COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY,
  acquireCovenantMutationAdvisoryLock,
  covenantMetadataWithWireDidBinding,
} from "../../src/services/covenants/canonical";
import {
  receiveCosign,
  receiveFederatedCovenant,
  receiveReject,
  receiveWithdraw,
  propagateCosign,
  propagateCovenant,
  propagateReject,
  propagateWithdraw,
} from "../../src/services/covenants/federation";
import {
  acceptProposalPreSigned,
  declareV2PreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../../src/services/covenants/lifecycle";
import {
  canonicalCosignBytes,
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../../src/services/covenants/sig";

ed.etc.sha512Sync = (...messages) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const TEST_AUTHORITY_GENERATION = "a".repeat(64);
process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
  TEST_AUTHORITY_GENERATION;

const LOCAL_HOST = "local.example";
const LOCAL_INSTANCE_URL = `https://${LOCAL_HOST}`;
const PEER_HOST = "peer.example";
const PEER_DID = `did:at:${PEER_HOST}/00000000-0000-4000-8000-000000000456`;
const SIGNATURE_A = Buffer.alloc(64, 1).toString("base64");
const SIGNATURE_B = Buffer.alloc(64, 2).toString("base64");

const b64 = (value: Uint8Array) => Buffer.from(value).toString("base64");

async function configureFederation(opts?: {
  enabled?: boolean;
  instanceUrl?: string | null;
  allowedOrigins?: string[];
}) {
  await db.insert(federationSettings).values({
    id: 1,
    enabled: opts?.enabled ?? true,
    instanceUrl: opts?.instanceUrl === undefined
      ? LOCAL_INSTANCE_URL
      : opts.instanceUrl,
    allowedOrigins: opts?.allowedOrigins ?? [PEER_HOST],
  }).onConflictDoUpdate({
    target: federationSettings.id,
    set: {
      enabled: opts?.enabled ?? true,
      instanceUrl: opts?.instanceUrl === undefined
        ? LOCAL_INSTANCE_URL
        : opts.instanceUrl,
      allowedOrigins: opts?.allowedOrigins ?? [PEER_HOST],
    },
  });
}

async function seedAgent(projectId = crypto.randomUUID()) {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const id = crypto.randomUUID();
  const [identity] = await db.insert(identities).values({
    id,
    projectId,
    did: `did:at:${id}`,
    displayName: "authority-test-agent",
    status: "active",
  }).returning();
  const [key] = await db.insert(identityKeys).values({
    identityId: id,
    publicKey: b64(publicKey),
    active: true,
  }).returning();
  return {
    identity: identity!,
    key: key!,
    privateKey,
    publicKeyB64: b64(publicKey),
    wireDid: `did:at:${LOCAL_HOST}/${id}`,
  };
}

async function declareProposal(agent: Awaited<ReturnType<typeof seedAgent>>) {
  const covenantId = crypto.randomUUID();
  const establishedAt = new Date();
  const signature = b64(await ed.signAsync(canonicalDeclareBytes({
    covenantId,
    initiatorDid: agent.wireDid,
    counterpartyDid: PEER_DID,
    vows: ["authority remains exact"],
    establishedAtIso: establishedAt.toISOString(),
  }), agent.privateKey));
  const result = await declareV2PreSigned({
    projectId: agent.identity.projectId,
    agentId: agent.identity.id,
    covenantId,
    agentDid: agent.wireDid,
    counterpartyDid: PEER_DID,
    vows: ["authority remains exact"],
    establishedAt,
    signature,
    signingKeyId: agent.key.id,
    publicKeyB64: agent.publicKeyB64,
  });
  return { ...result, signature };
}

async function withAuthorityGeneration<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const original = process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
  try {
    if (value === undefined) {
      delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
    } else {
      process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = value;
    }
    return await run();
  } finally {
    if (original === undefined) {
      delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
    } else {
      process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = original;
    }
  }
}

async function storedCovenantJson(id: string): Promise<string> {
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, id)).limit(1);
  return JSON.stringify(row);
}

async function waitForAdvisoryLockWaiters(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND NOT granted
    `);
    if (Number(row?.waiting ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${expected} PostgreSQL advisory-lock waiters`);
}

async function waitForRowLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND wait_event <> 'advisory'
    `);
    if (Number(row?.waiting ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("expected a PostgreSQL row-lock waiter");
}

function continuityAppForProject(projectId: string): Hono<ProjectContext> {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", {
      id: projectId,
      name: "covenant CAS test",
      plan: "free",
      credits: 100,
      createdAt: new Date(),
    });
    await next();
  });
  app.route("/", continuityRouter);
  return app;
}

type LifecycleFenceOperation = {
  id: string;
  name: string;
  throws: boolean;
  invoke: () => Promise<unknown>;
};

async function seedLifecycleFenceOperations(
  agent: Awaited<ReturnType<typeof seedAgent>>,
  generation: string,
  phase: "proposed" | "terminal",
): Promise<LifecycleFenceOperation[]> {
  const signedAt = new Date();
  const definitions = [
    {
      name: "local_accept",
      received: true,
      terminalStatus: "active" as const,
      throws: true,
    },
    {
      name: "local_reject",
      received: true,
      terminalStatus: "rejected" as const,
      throws: true,
    },
    {
      name: "local_withdraw",
      received: false,
      terminalStatus: "withdrawn" as const,
      throws: true,
    },
    {
      name: "inbound_cosign",
      received: false,
      terminalStatus: "active" as const,
      throws: false,
    },
    {
      name: "inbound_reject",
      received: false,
      terminalStatus: "rejected" as const,
      throws: false,
    },
    {
      name: "inbound_withdraw",
      received: true,
      terminalStatus: "withdrawn" as const,
      throws: false,
    },
  ];
  const operations: LifecycleFenceOperation[] = [];

  for (const definition of definitions) {
    const id = crypto.randomUUID();
    const lifecycleKeyId = agent.key.id;
    const metadata = covenantMetadataWithWireDidBinding(
      {},
      definition.received ? PEER_DID : agent.wireDid,
      definition.received ? agent.wireDid : PEER_DID,
      generation,
    );
    await db.insert(covenants).values({
      id,
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      counterpartyDid: PEER_DID,
      vows: [`${definition.name} ${phase} generation fence`],
      status: phase === "terminal" ? definition.terminalStatus : "proposed",
      protocolVersion: "v2",
      receivedFromInstance: definition.received ? PEER_HOST : null,
      signature: SIGNATURE_A,
      signingKeyId: crypto.randomUUID(),
      counterpartySignature: phase === "terminal" ? SIGNATURE_B : null,
      counterpartySigningKeyId: phase === "terminal" ? lifecycleKeyId : null,
      counterpartySignedAt: phase === "terminal" ? signedAt : null,
      proposedExpiresAt: new Date(Date.now() + COVENANT_PROPOSAL_TTL_MS),
      propagationStatus: "propagated",
      metadata: definition.name.includes("reject") && phase === "terminal"
        ? {
            ...metadata,
            [COVENANT_REJECTION_REASON_METADATA_KEY]: "no",
          }
        : metadata,
    });

    const invoke = definition.name === "local_accept"
      ? () => acceptProposalPreSigned({
          covenantId: id,
          accepterAgentId: agent.identity.id,
          accepterDid: agent.wireDid,
          initiatorSignatureB64: SIGNATURE_A,
          counterpartySignature: SIGNATURE_B,
          counterpartySigningKeyId: lifecycleKeyId,
          counterpartySignedAt: signedAt,
          publicKeyB64: agent.publicKeyB64,
        })
      : definition.name === "local_reject"
      ? () => rejectProposalPreSigned({
          covenantId: id,
          rejecterAgentId: agent.identity.id,
          rejecterDid: agent.wireDid,
          rejectionSignature: SIGNATURE_B,
          rejecterSigningKeyId: lifecycleKeyId,
          rejectedAt: signedAt,
          reason: "no",
          publicKeyB64: agent.publicKeyB64,
        })
      : definition.name === "local_withdraw"
      ? () => withdrawProposalPreSigned({
          covenantId: id,
          agentId: agent.identity.id,
          initiatorDid: agent.wireDid,
          withdrawSignature: SIGNATURE_B,
          signingKeyId: lifecycleKeyId,
          withdrawnAt: signedAt,
          publicKeyB64: agent.publicKeyB64,
        })
      : definition.name === "inbound_cosign"
      ? () => receiveCosign(id, {
          counterparty_did: PEER_DID,
          counterparty_signing_key_id: lifecycleKeyId,
          counterparty_signature: SIGNATURE_B,
          counterparty_signed_at: signedAt.toISOString(),
        })
      : definition.name === "inbound_reject"
      ? () => receiveReject(id, {
          rejecting_did: PEER_DID,
          rejecter_signing_key_id: lifecycleKeyId,
          rejection_signature: SIGNATURE_B,
          reason: "no",
          rejected_at: signedAt.toISOString(),
        })
      : () => receiveWithdraw(id, {
          initiator_did: PEER_DID,
          initiator_signing_key_id: lifecycleKeyId,
          withdraw_signature: SIGNATURE_B,
          withdrawn_at: signedAt.toISOString(),
        });
    operations.push({ id, name: definition.name, throws: definition.throws, invoke });
  }
  return operations;
}

beforeEach(async () => {
  process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
    TEST_AUTHORITY_GENERATION;
  await configureFederation();
});

describe("v2 federation authority remains exact through lifecycle effects", () => {
  test("new inbound declaration stamps current generation and exact signed wire pair", async () => {
    const recipient = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const vows = ["inbound provenance is server-stamped"];
    const signature = b64(await ed.signAsync(canonicalDeclareBytes({
      covenantId,
      initiatorDid: PEER_DID,
      counterpartyDid: recipient.wireDid,
      vows,
      establishedAtIso: establishedAt.toISOString(),
    }), remotePrivateKey));
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockResolvedValue({
        did: PEER_DID,
        uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
        host: PEER_HOST,
        display_name: "remote authority test",
        signing_keys: [{
          id: remoteSigningKeyId,
          public_key: b64(remotePublicKey),
        }],
        box_keys: [],
      });
    const input = {
      covenant_id: covenantId,
      protocol_version: "v2" as const,
      sender_did: PEER_DID,
      counterparty_did: recipient.wireDid,
      vows,
      status: "proposed" as const,
      metadata: { caller: "preserved" },
      established_at: establishedAt.toISOString(),
      signing_key_id: remoteSigningKeyId,
      signature,
      proposed_expires_at: new Date(
        establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
      ).toISOString(),
    };
    try {
      const result = await receiveFederatedCovenant(input);
      expect(result.status_code).toBe(201);
      const [stored] = await db.select({ metadata: covenants.metadata })
        .from(covenants).where(eq(covenants.id, covenantId)).limit(1);
      expect(stored!.metadata).toMatchObject({
        caller: "preserved",
        [COVENANT_INITIATOR_WIRE_DID_METADATA_KEY]: PEER_DID,
        [COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY]: recipient.wireDid,
        [COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY]:
          TEST_AUTHORITY_GENERATION,
      });
      expect(await receiveFederatedCovenant(input)).toMatchObject({
        ok: true,
        status_code: 200,
        body: { idempotent: true },
      });
      await db.update(covenants).set({
        metadata: {
          ...(stored!.metadata as Record<string, unknown>),
          [COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY]: "b".repeat(64),
        },
      }).where(eq(covenants.id, covenantId));
      expect(await receiveFederatedCovenant(input)).toMatchObject({
        ok: false,
        status_code: 409,
        body: { error: "v2_declaration_replay_conflict" },
      });
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("concurrent inbound declarations for one recipient serialize before Wake publication", async () => {
    const recipient = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockResolvedValue({
        did: PEER_DID,
        uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
        host: PEER_HOST,
        display_name: "concurrent remote",
        signing_keys: [{
          id: remoteSigningKeyId,
          public_key: b64(remotePublicKey),
        }],
        box_keys: [],
      });
    const makeInput = async (vow: string) => {
      const covenantId = crypto.randomUUID();
      const establishedAt = new Date();
      return {
        covenant_id: covenantId,
        protocol_version: "v2" as const,
        sender_did: PEER_DID,
        counterparty_did: recipient.wireDid,
        vows: [vow],
        status: "proposed" as const,
        metadata: {},
        established_at: establishedAt.toISOString(),
        signing_key_id: remoteSigningKeyId,
        signature: b64(await ed.signAsync(canonicalDeclareBytes({
          covenantId,
          initiatorDid: PEER_DID,
          counterpartyDid: recipient.wireDid,
          vows: [vow],
          establishedAtIso: establishedAt.toISOString(),
        }), remotePrivateKey)),
        proposed_expires_at: new Date(
          establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
        ).toISOString(),
      };
    };
    try {
      const inputs = await Promise.all([
        makeInput("first concurrent inbound"),
        makeInput("second concurrent inbound"),
      ]);
      const results = await Promise.all(inputs.map(receiveFederatedCovenant));
      expect(results.map((result) => result.status_code).sort()).toEqual([
        201,
        201,
      ]);
      for (const input of inputs) {
        const [stored] = await db.select({ metadata: covenants.metadata })
          .from(covenants).where(eq(covenants.id, input.covenant_id)).limit(1);
        expect((stored!.metadata as Record<string, unknown>)[
          COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY
        ]).toBe(TEST_AUTHORITY_GENERATION);
      }
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("a barriered lagging inbound declaration loser serializes with local lifecycle", async () => {
    const recipient = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const vows = ["lagging declaration and lifecycle share one UUID fence"];
    const signature = b64(await ed.signAsync(canonicalDeclareBytes({
      covenantId,
      initiatorDid: PEER_DID,
      counterpartyDid: recipient.wireDid,
      vows,
      establishedAtIso: establishedAt.toISOString(),
    }), remotePrivateKey));
    const input = {
      covenant_id: covenantId,
      protocol_version: "v2" as const,
      sender_did: PEER_DID,
      counterparty_did: recipient.wireDid,
      vows,
      status: "proposed" as const,
      metadata: {},
      established_at: establishedAt.toISOString(),
      signing_key_id: remoteSigningKeyId,
      signature,
      proposed_expires_at: new Date(
        establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
      ).toISOString(),
    };
    const resolvedPeer = {
      did: PEER_DID,
      uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
      host: PEER_HOST,
      display_name: "barriered remote",
      signing_keys: [{
        id: remoteSigningKeyId,
        public_key: b64(remotePublicKey),
      }],
      box_keys: [],
    };
    let releaseFirstResolution!: () => void;
    let markFirstResolutionReached!: () => void;
    const firstResolutionRelease = new Promise<void>((resolve) => {
      releaseFirstResolution = resolve;
    });
    const firstResolutionReached = new Promise<void>((resolve) => {
      markFirstResolutionReached = resolve;
    });
    let resolutionCalls = 0;
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockImplementation(async () => {
        resolutionCalls += 1;
        if (resolutionCalls === 1) {
          markFirstResolutionReached();
          await firstResolutionRelease;
        }
        return resolvedPeer;
      });
    let releaseHolder!: () => void;
    let markHolderReady!: () => void;
    const holderRelease = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holderReady = new Promise<void>((resolve) => {
      markHolderReady = resolve;
    });
    let holder: Promise<unknown> | undefined;
    let lagging: ReturnType<typeof receiveFederatedCovenant> | undefined;
    let lifecycle: ReturnType<typeof rejectProposalPreSigned> | undefined;

    try {
      // The first request has observed the covenant ID as absent, then pauses
      // at remote resolution. A second declaration commits that exact ID.
      lagging = receiveFederatedCovenant(input);
      await firstResolutionReached;
      expect(await receiveFederatedCovenant(input)).toMatchObject({
        ok: true,
        status_code: 201,
      });

      // Hold the shared UUID fence so both the lagging declaration transaction
      // and the opposing covenant->identity lifecycle transaction are visibly
      // queued at the same first statement before either can take row locks.
      holder = db.transaction(async (tx) => {
        await acquireCovenantMutationAdvisoryLock(tx, covenantId);
        markHolderReady();
        await holderRelease;
      });
      await holderReady;

      const rejectionSignature = b64(await ed.signAsync(
        canonicalRejectBytes({
          covenantId,
          rejectingDid: recipient.wireDid,
          reason: "no",
        }),
        recipient.privateKey,
      ));
      lifecycle = rejectProposalPreSigned({
        covenantId,
        rejecterAgentId: recipient.identity.id,
        rejecterDid: recipient.wireDid,
        rejectionSignature,
        rejecterSigningKeyId: recipient.key.id,
        rejectedAt: new Date(),
        reason: "no",
        publicKeyB64: recipient.publicKeyB64,
      });
      await waitForAdvisoryLockWaiters(1);
      releaseFirstResolution();
      await waitForAdvisoryLockWaiters(2);
      releaseHolder();

      const [laggingResult, lifecycleResult] = await Promise.all([
        lagging,
        lifecycle,
      ]);
      await holder;
      expect(laggingResult).toMatchObject({
        ok: true,
        status_code: 200,
        body: { idempotent: true },
      });
      expect(lifecycleResult.status).toBe("rejected");
      const [stored] = await db.select({ status: covenants.status })
        .from(covenants).where(eq(covenants.id, covenantId)).limit(1);
      expect(stored!.status).toBe("rejected");
    } finally {
      releaseFirstResolution();
      releaseHolder();
      await Promise.allSettled([
        ...(holder ? [holder] : []),
        ...(lagging ? [lagging] : []),
        ...(lifecycle ? [lifecycle] : []),
      ]);
      resolveSpy.mockRestore();
    }
  });

  test("inbound declaration rejects a same-host sender before identity or peer work", async () => {
    await configureFederation({ allowedOrigins: [LOCAL_HOST] });
    const establishedAt = new Date();
    const result = await receiveFederatedCovenant({
      covenant_id: crypto.randomUUID(),
      protocol_version: "v2",
      sender_did: `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`,
      counterparty_did: `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`,
      vows: ["self-host cannot impersonate a foreign peer"],
      status: "proposed",
      metadata: {},
      established_at: establishedAt.toISOString(),
      signing_key_id: crypto.randomUUID(),
      signature: SIGNATURE_A,
      proposed_expires_at: new Date(
        establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
      ).toISOString(),
    });
    expect(result.status_code).toBe(403);
    expect(result.body).toEqual({ error: "sender_must_be_foreign" });
  });

  test("inbound terminal replays require the exact direction-bound wire DID pair", async () => {
    const agent = await seedAgent();
    const signedAt = new Date().toISOString();
    const variants = [
      "exact",
      "missing",
      "forged_local",
      "forged_remote",
    ] as const;

    const binding = (
      direction: "locally_declared" | "received",
      variant: typeof variants[number],
    ): Record<string, unknown> => {
      if (variant === "missing") return {};
      const localDid = variant === "forged_local"
        ? `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`
        : agent.wireDid;
      const remoteDid = variant === "forged_remote"
        ? `did:at:${PEER_HOST}/${crypto.randomUUID()}`
        : PEER_DID;
      return direction === "locally_declared"
        ? covenantMetadataWithWireDidBinding({}, localDid, remoteDid)
        : covenantMetadataWithWireDidBinding({}, remoteDid, localDid);
    };

    for (const variant of variants) {
      const cosignId = crypto.randomUUID();
      const cosignKeyId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: cosignId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: ["terminal cosign replay remains bound"],
        status: "active",
        protocolVersion: "v2",
        signature: SIGNATURE_A,
        signingKeyId: crypto.randomUUID(),
        counterpartySignature: SIGNATURE_B,
        counterpartySigningKeyId: cosignKeyId,
        counterpartySignedAt: new Date(),
        metadata: binding("locally_declared", variant),
      });
      const cosign = await receiveCosign(cosignId, {
        counterparty_did: PEER_DID,
        counterparty_signing_key_id: cosignKeyId,
        counterparty_signature: SIGNATURE_B,
        counterparty_signed_at: signedAt,
      });

      const rejectId = crypto.randomUUID();
      const rejectKeyId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: rejectId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: ["terminal reject replay remains bound"],
        status: "rejected",
        protocolVersion: "v2",
        signature: SIGNATURE_A,
        signingKeyId: crypto.randomUUID(),
        counterpartySignature: SIGNATURE_B,
        counterpartySigningKeyId: rejectKeyId,
        counterpartySignedAt: new Date(),
        metadata: {
          ...binding("locally_declared", variant),
          [COVENANT_REJECTION_REASON_METADATA_KEY]: "no",
        },
      });
      const reject = await receiveReject(rejectId, {
        rejecting_did: PEER_DID,
        rejecter_signing_key_id: rejectKeyId,
        rejection_signature: SIGNATURE_B,
        reason: "no",
        rejected_at: signedAt,
      });

      const withdrawId = crypto.randomUUID();
      const withdrawKeyId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: withdrawId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: ["terminal withdraw replay remains bound"],
        status: "withdrawn",
        protocolVersion: "v2",
        signature: SIGNATURE_A,
        signingKeyId: crypto.randomUUID(),
        counterpartySignature: SIGNATURE_B,
        counterpartySigningKeyId: withdrawKeyId,
        counterpartySignedAt: new Date(),
        receivedFromInstance: PEER_HOST,
        metadata: binding("received", variant),
      });
      const withdraw = await receiveWithdraw(withdrawId, {
        initiator_did: PEER_DID,
        initiator_signing_key_id: withdrawKeyId,
        withdraw_signature: SIGNATURE_B,
        withdrawn_at: signedAt,
      });

      for (const result of [cosign, reject, withdraw]) {
        if (variant === "exact") {
          expect(result.status_code).toBe(200);
          expect(result.body).toHaveProperty("status");
        } else {
          expect(result.status_code).toBe(400);
          expect(result.body).toEqual({
            error: "covenant_wire_identity_binding_mismatch",
          });
        }
      }
    }
  });

  for (const [label, configuredGeneration] of [
    ["absent", undefined],
    ["malformed", "A".repeat(64)],
  ] as const) {
    for (const phase of ["proposed", "terminal"] as const) {
      test(`all six ${phase} lifecycle entries refuse ${label} generation without a write`, async () => {
        const agent = await seedAgent();
        const operations = await seedLifecycleFenceOperations(
          agent,
          TEST_AUTHORITY_GENERATION,
          phase,
        );
        await withAuthorityGeneration(configuredGeneration, async () => {
          for (const operation of operations) {
            const before = await storedCovenantJson(operation.id);
            if (operation.throws) {
              await expect(operation.invoke()).rejects.toThrow(
                "covenant_v2_authority_not_ready",
              );
            } else {
              expect(await operation.invoke()).toMatchObject({
                ok: false,
                status_code: 409,
                body: { error: "covenant_v2_authority_not_ready" },
              });
            }
            expect(await storedCovenantJson(operation.id)).toBe(before);
          }
        });
      });
    }
  }

  for (const phase of ["proposed", "terminal"] as const) {
    test(`all six ${phase} lifecycle entries refuse wrong row generation without a write or peer call`, async () => {
      const agent = await seedAgent();
      const operations = await seedLifecycleFenceOperations(
        agent,
        "b".repeat(64),
        phase,
      );
      for (const operation of operations) {
        const before = await storedCovenantJson(operation.id);
        if (operation.throws) {
          await expect(operation.invoke()).rejects.toThrow(
            phase === "proposed"
              ? "covenant_wire_identity_binding_mismatch"
              : "covenant_not_proposed",
          );
        } else {
          expect(await operation.invoke()).toMatchObject({
            ok: false,
            status_code: phase === "proposed" ? 403 : 400,
            body: {
              error: phase === "proposed"
                ? "local_federation_authority_unavailable"
                : "covenant_wire_identity_binding_mismatch",
            },
          });
        }
        expect(await storedCovenantJson(operation.id)).toBe(before);
      }
    });
  }

  test("declare rejects self/local targets and identities owned by another project", async () => {
    const agent = await seedAgent();
    const establishedAt = new Date();
    const selfTarget = `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`;
    const sign = async (counterpartyDid: string) => {
      const covenantId = crypto.randomUUID();
      const signature = b64(await ed.signAsync(canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.wireDid,
        counterpartyDid,
        vows: ["no self federation"],
        establishedAtIso: establishedAt.toISOString(),
      }), agent.privateKey));
      return { covenantId, signature };
    };

    const self = await sign(selfTarget);
    await expect(declareV2PreSigned({
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      covenantId: self.covenantId,
      agentDid: agent.wireDid,
      counterpartyDid: selfTarget,
      vows: ["no self federation"],
      establishedAt,
      signature: self.signature,
      signingKeyId: agent.key.id,
      publicKeyB64: agent.publicKeyB64,
    })).rejects.toThrow("counterparty_must_be_foreign_federated_did");

    const foreign = await sign(PEER_DID);
    await expect(declareV2PreSigned({
      projectId: crypto.randomUUID(),
      agentId: agent.identity.id,
      covenantId: foreign.covenantId,
      agentDid: agent.wireDid,
      counterpartyDid: PEER_DID,
      vows: ["no self federation"],
      establishedAt,
      signature: foreign.signature,
      signingKeyId: agent.key.id,
      publicKeyB64: agent.publicKeyB64,
    })).rejects.toThrow("initiator_did_mismatch");
  });

  test("disable, origin rotation, and local key revocation each leave proposal unchanged", async () => {
    for (const mutation of ["disable", "origin", "key"] as const) {
      await configureFederation();
      const agent = await seedAgent();
      const proposal = await declareProposal(agent);
      await db.update(covenants).set({ propagationStatus: "propagated" })
        .where(eq(covenants.id, proposal.id));
      if (mutation === "disable") {
        await configureFederation({ enabled: false });
      } else if (mutation === "origin") {
        await configureFederation({
          instanceUrl: "https://rotated.example",
          allowedOrigins: [PEER_HOST],
        });
      } else {
        await db.update(identityKeys).set({ active: false })
          .where(eq(identityKeys.id, agent.key.id));
      }
      const withdrawSignature = b64(await ed.signAsync(
        canonicalWithdrawBytes({
          covenantId: proposal.id,
          initiatorDid: agent.wireDid,
        }),
        agent.privateKey,
      ));
      await expect(withdrawProposalPreSigned({
        covenantId: proposal.id,
        agentId: agent.identity.id,
        initiatorDid: agent.wireDid,
        withdrawSignature,
        signingKeyId: agent.key.id,
        withdrawnAt: new Date(),
        publicKeyB64: agent.publicKeyB64,
      })).rejects.toThrow(
        mutation === "disable"
          ? "federation_not_ready"
          : mutation === "origin"
          ? "initiator_did_mismatch"
          : "signing_key_not_active_for_identity",
      );
      const [row] = await db.select({ status: covenants.status })
        .from(covenants).where(eq(covenants.id, proposal.id)).limit(1);
      expect(row!.status).toBe("proposed");
    }
  });

  test("concurrent local declaration insert stamps one current-generation winner", async () => {
    const agent = await seedAgent();
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const vows = ["one current-generation winner"];
    const signature = b64(await ed.signAsync(canonicalDeclareBytes({
      covenantId,
      initiatorDid: agent.wireDid,
      counterpartyDid: PEER_DID,
      vows,
      establishedAtIso: establishedAt.toISOString(),
    }), agent.privateKey));
    const declare = () => declareV2PreSigned({
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.wireDid,
      counterpartyDid: PEER_DID,
      vows,
      establishedAt,
      signature,
      signingKeyId: agent.key.id,
      publicKeyB64: agent.publicKeyB64,
    });

    const results = await Promise.all([declare(), declare()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    const [stored] = await db.select({ metadata: covenants.metadata })
      .from(covenants).where(eq(covenants.id, covenantId)).limit(1);
    expect((stored!.metadata as Record<string, unknown>)[
      COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY
    ]).toBe(TEST_AUTHORITY_GENERATION);
  });

  test("concurrent lifecycle transitions for one identity serialize before Wake publication", async () => {
    const agent = await seedAgent();
    const proposals = await Promise.all(["first", "second"].map(async (label) => {
      const covenantId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: covenantId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: [`${label} concurrent reject`],
        status: "proposed",
        protocolVersion: "v2",
        receivedFromInstance: PEER_HOST,
        signature: SIGNATURE_A,
        signingKeyId: crypto.randomUUID(),
        proposedExpiresAt: new Date(Date.now() + COVENANT_PROPOSAL_TTL_MS),
        metadata: covenantMetadataWithWireDidBinding(
          {},
          PEER_DID,
          agent.wireDid,
        ),
      });
      const rejectionSignature = b64(await ed.signAsync(
        canonicalRejectBytes({
          covenantId,
          rejectingDid: agent.wireDid,
          reason: "no",
        }),
        agent.privateKey,
      ));
      return { covenantId, rejectionSignature };
    }));

    const results = await Promise.all(proposals.map((proposal) =>
      rejectProposalPreSigned({
        covenantId: proposal.covenantId,
        rejecterAgentId: agent.identity.id,
        rejecterDid: agent.wireDid,
        rejectionSignature: proposal.rejectionSignature,
        rejecterSigningKeyId: agent.key.id,
        rejectedAt: new Date(),
        reason: "no",
        publicKeyB64: agent.publicKeyB64,
      })
    ));
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
  });

  test("concurrent inbound lifecycle transitions for one identity serialize before Wake publication", async () => {
    const agent = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockResolvedValue({
        did: PEER_DID,
        uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
        host: PEER_HOST,
        display_name: "concurrent lifecycle remote",
        signing_keys: [{
          id: remoteSigningKeyId,
          public_key: b64(remotePublicKey),
        }],
        box_keys: [],
      });
    const proposals = await Promise.all(["first", "second"].map(async (label) => {
      const covenantId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: covenantId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: [`${label} concurrent inbound reject`],
        status: "proposed",
        protocolVersion: "v2",
        signature: SIGNATURE_A,
        signingKeyId: agent.key.id,
        establishedAt: new Date(),
        proposedExpiresAt: new Date(Date.now() + COVENANT_PROPOSAL_TTL_MS),
        metadata: covenantMetadataWithWireDidBinding(
          {},
          agent.wireDid,
          PEER_DID,
        ),
      });
      const reason = `${label} no`;
      const rejectionSignature = b64(await ed.signAsync(
        canonicalRejectBytes({
          covenantId,
          rejectingDid: PEER_DID,
          reason,
        }),
        remotePrivateKey,
      ));
      return { covenantId, reason, rejectionSignature };
    }));

    try {
      const results = await Promise.all(proposals.map((proposal) =>
        receiveReject(proposal.covenantId, {
          rejecting_did: PEER_DID,
          rejecter_signing_key_id: remoteSigningKeyId,
          rejection_signature: proposal.rejectionSignature,
          reason: proposal.reason,
          rejected_at: new Date().toISOString(),
        })
      ));
      expect(results.map((result) => result.status_code)).toEqual([200, 200]);
      for (const proposal of proposals) {
        const [stored] = await db.select({ status: covenants.status })
          .from(covenants).where(eq(covenants.id, proposal.covenantId)).limit(1);
        expect(stored!.status).toBe("rejected");
      }
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("local accept and inbound withdraw on one row converge without a lock-order deadlock", async () => {
    const agent = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const covenantId = crypto.randomUUID();
    await db.insert(covenants).values({
      id: covenantId,
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      counterpartyDid: PEER_DID,
      vows: ["opposing lifecycle paths serialize"],
      status: "proposed",
      protocolVersion: "v2",
      receivedFromInstance: PEER_HOST,
      signature: SIGNATURE_A,
      signingKeyId: remoteSigningKeyId,
      establishedAt: new Date(),
      proposedExpiresAt: new Date(Date.now() + COVENANT_PROPOSAL_TTL_MS),
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.wireDid,
      ),
    });
    const cosignSignature = b64(await ed.signAsync(canonicalCosignBytes({
      covenantId,
      initiatorSignatureB64: SIGNATURE_A,
    }), agent.privateKey));
    const withdrawSignature = b64(await ed.signAsync(canonicalWithdrawBytes({
      covenantId,
      initiatorDid: PEER_DID,
    }), remotePrivateKey));
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockResolvedValue({
        did: PEER_DID,
        uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
        host: PEER_HOST,
        display_name: "opposing remote",
        signing_keys: [{
          id: remoteSigningKeyId,
          public_key: b64(remotePublicKey),
        }],
        box_keys: [],
      });

    try {
      const [acceptResult, withdrawResult] = await Promise.allSettled([
        acceptProposalPreSigned({
          covenantId,
          accepterAgentId: agent.identity.id,
          accepterDid: agent.wireDid,
          initiatorSignatureB64: SIGNATURE_A,
          counterpartySignature: cosignSignature,
          counterpartySigningKeyId: agent.key.id,
          counterpartySignedAt: new Date(),
          publicKeyB64: agent.publicKeyB64,
        }),
        receiveWithdraw(covenantId, {
          initiator_did: PEER_DID,
          initiator_signing_key_id: remoteSigningKeyId,
          withdraw_signature: withdrawSignature,
          withdrawn_at: new Date().toISOString(),
        }),
      ]);
      expect(withdrawResult.status).toBe("fulfilled");
      const [stored] = await db.select({ status: covenants.status })
        .from(covenants).where(eq(covenants.id, covenantId)).limit(1);
      expect(["active", "withdrawn"]).toContain(stored!.status);
      if (stored!.status === "active") {
        expect(acceptResult.status).toBe("fulfilled");
        if (withdrawResult.status === "fulfilled") {
          expect(withdrawResult.value.status_code).toBe(400);
        }
      } else {
        expect(acceptResult.status).toBe("rejected");
        if (withdrawResult.status === "fulfilled") {
          expect(withdrawResult.value.status_code).toBe(200);
        }
      }
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("local withdraw and inbound cosign or reject serialize on the covenant before identity", async () => {
    const agent = await seedAgent();
    const remotePrivateKey = ed.utils.randomPrivateKey();
    const remotePublicKey = await ed.getPublicKeyAsync(remotePrivateKey);
    const remoteSigningKeyId = crypto.randomUUID();
    const resolveSpy = spyOn(federationStore, "resolveFederatedDid")
      .mockResolvedValue({
        did: PEER_DID,
        uuid: PEER_DID.slice(PEER_DID.lastIndexOf("/") + 1),
        host: PEER_HOST,
        display_name: "opposing remote",
        signing_keys: [{
          id: remoteSigningKeyId,
          public_key: b64(remotePublicKey),
        }],
        box_keys: [],
      });

    try {
      for (const inboundKind of ["cosign", "reject"] as const) {
        const proposal = await declareProposal(agent);
        await db.update(covenants).set({ propagationStatus: "propagated" })
          .where(eq(covenants.id, proposal.id));
        const withdrawSignature = b64(await ed.signAsync(
          canonicalWithdrawBytes({
            covenantId: proposal.id,
            initiatorDid: agent.wireDid,
          }),
          agent.privateKey,
        ));
        const inboundSignature = inboundKind === "cosign"
          ? b64(await ed.signAsync(
              canonicalCosignBytes({
                covenantId: proposal.id,
                initiatorSignatureB64: proposal.signature,
              }),
              remotePrivateKey,
            ))
          : b64(await ed.signAsync(
              canonicalRejectBytes({
                covenantId: proposal.id,
                rejectingDid: PEER_DID,
                reason: "no",
              }),
              remotePrivateKey,
            ));
        const invokeInbound = () => inboundKind === "cosign"
          ? receiveCosign(proposal.id, {
              counterparty_did: PEER_DID,
              counterparty_signing_key_id: remoteSigningKeyId,
              counterparty_signature: inboundSignature,
              counterparty_signed_at: new Date().toISOString(),
            })
          : receiveReject(proposal.id, {
              rejecting_did: PEER_DID,
              rejecter_signing_key_id: remoteSigningKeyId,
              rejection_signature: inboundSignature,
              reason: "no",
              rejected_at: new Date().toISOString(),
            });
        const [localResult, inboundResult] = await Promise.allSettled([
          withdrawProposalPreSigned({
            covenantId: proposal.id,
            agentId: agent.identity.id,
            initiatorDid: agent.wireDid,
            withdrawSignature,
            signingKeyId: agent.key.id,
            withdrawnAt: new Date(),
            publicKeyB64: agent.publicKeyB64,
          }),
          invokeInbound(),
        ]);
        if (inboundResult.status === "rejected") throw inboundResult.reason;
        const [stored] = await db.select({ status: covenants.status })
          .from(covenants).where(eq(covenants.id, proposal.id)).limit(1);
        const inboundStatus = inboundKind === "cosign" ? "active" : "rejected";
        expect(["withdrawn", inboundStatus]).toContain(stored!.status);
        if (stored!.status === "withdrawn") {
          expect(localResult.status).toBe("fulfilled");
          if (inboundResult.status === "fulfilled") {
            expect(inboundResult.value.status_code).toBe(400);
          }
        } else {
          expect(localResult.status).toBe("rejected");
          if (inboundResult.status === "fulfilled") {
            expect(inboundResult.value.status_code).toBe(200);
          }
        }
      }
    } finally {
      resolveSpy.mockRestore();
    }
  });

  test("generic PATCH cannot adopt a concurrently committed v2 row after an absent pre-read", async () => {
    const agent = await seedAgent();
    const covenantId = crypto.randomUUID();
    const app = continuityAppForProject(agent.identity.projectId);
    let markInserted!: () => void;
    let releaseInsert!: () => void;
    const inserted = new Promise<void>((resolve) => {
      markInserted = resolve;
    });
    const insertRelease = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx.insert(covenants).values({
        id: covenantId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: ["signed v2 envelope must not be generically patched"],
        notes: "signed-v2-original",
        status: "proposed",
        protocolVersion: "v2",
        signature: SIGNATURE_A,
        signingKeyId: agent.key.id,
        proposedExpiresAt: new Date(Date.now() + COVENANT_PROPOSAL_TTL_MS),
        metadata: covenantMetadataWithWireDidBinding(
          {},
          agent.wireDid,
          PEER_DID,
        ),
      });
      markInserted();
      await insertRelease;
    });
    await inserted;

    const request = app.request(`/covenants/${covenantId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "generic patch must not land" }),
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(
            new Error("generic PATCH waited for an invisible concurrent insert"),
          ), 1_000);
        }),
      ]);
      expect(response.status).toBe(404);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseInsert();
      await holder;
    }

    const [stored] = await db.select({
      protocolVersion: covenants.protocolVersion,
      notes: covenants.notes,
    }).from(covenants).where(eq(covenants.id, covenantId)).limit(1);
    expect(stored).toEqual({
      protocolVersion: "v2",
      notes: "signed-v2-original",
    });
  });

  test("generic PATCH CAS returns stable conflict after a row becomes v2 or received-v1", async () => {
    const agent = await seedAgent();
    const app = continuityAppForProject(agent.identity.projectId);
    const cases = [
      {
        name: "v2",
        update: { protocolVersion: "v2" as const },
        error: "v2_covenant_requires_signed_lifecycle_endpoint",
      },
      {
        name: "received-v1",
        update: { receivedFromInstance: PEER_HOST },
        error: "federated_v1_mutation_retired",
      },
    ];

    for (const candidate of cases) {
      const covenantId = crypto.randomUUID();
      await db.insert(covenants).values({
        id: covenantId,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: `did:at:${crypto.randomUUID()}`,
        vows: [`local v1 before ${candidate.name} race`],
        notes: "local-v1-original",
        status: "proposed",
        protocolVersion: "v1",
      });
      let markUpdated!: () => void;
      let releaseUpdate!: () => void;
      const updated = new Promise<void>((resolve) => {
        markUpdated = resolve;
      });
      const updateRelease = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx.update(covenants).set(candidate.update)
          .where(eq(covenants.id, covenantId));
        markUpdated();
        await updateRelease;
      });
      await updated;
      const request = app.request(`/covenants/${covenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "generic patch must lose CAS" }),
      });
      try {
        await waitForRowLockWaiter();
      } finally {
        releaseUpdate();
        await holder;
      }
      const response = await request;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: candidate.error });
      const [stored] = await db.select({
        protocolVersion: covenants.protocolVersion,
        receivedFromInstance: covenants.receivedFromInstance,
        notes: covenants.notes,
      }).from(covenants).where(eq(covenants.id, covenantId)).limit(1);
      expect(stored!.notes).toBe("local-v1-original");
      if (candidate.name === "v2") {
        expect(stored!.protocolVersion).toBe("v2");
      } else {
        expect(stored!.receivedFromInstance).toBe(PEER_HOST);
      }
    }
  });

  test("authenticated covenant responses expose only caller-owned metadata", async () => {
    const agent = await seedAgent();
    const proposal = await declareProposal(agent);
    const [stored] = await db.select({ metadata: covenants.metadata })
      .from(covenants).where(eq(covenants.id, proposal.id)).limit(1);
    await db.update(covenants).set({
      metadata: {
        ...(stored!.metadata as Record<string, unknown>),
        caller_visible: "yes",
        nested: { remains: true },
      },
    }).where(eq(covenants.id, proposal.id));

    const routeApp = new Hono<ProjectContext>();
    routeApp.use("*", async (c, next) => {
      c.set("project", {
        id: agent.identity.projectId,
        name: "authority serialization test",
        plan: "free",
        credits: 100,
        createdAt: new Date(),
      });
      await next();
    });
    routeApp.route("/", continuityRouter);

    const response = await routeApp.request("/covenants?status=proposed");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      covenants: Array<{ id: string; metadata: Record<string, unknown> }>;
    };
    const serialized = body.covenants.find((row) => row.id === proposal.id);
    expect(serialized?.metadata).toEqual({
      caller_visible: "yes",
      nested: { remains: true },
    });
  });

  test("all propagation entries leave noncurrent-generation rows byte-for-byte unchanged", async () => {
    const agent = await seedAgent();
    const wrongLocalBinding = covenantMetadataWithWireDidBinding(
      {},
      agent.wireDid,
      PEER_DID,
      "b".repeat(64),
    );
    const wrongReceivedBinding = covenantMetadataWithWireDidBinding(
      {},
      PEER_DID,
      agent.wireDid,
      "b".repeat(64),
    );
    const rows = [
      {
        kind: "declare" as const,
        id: crypto.randomUUID(),
        values: {
          status: "proposed" as const,
          receivedFromInstance: null,
          metadata: wrongLocalBinding,
          propagationStatus: "pending" as const,
          propagationAttempts: 2,
          propagationLastError: "before-declare",
        },
      },
      {
        kind: "cosign" as const,
        id: crypto.randomUUID(),
        values: {
          status: "active" as const,
          receivedFromInstance: PEER_HOST,
          metadata: wrongReceivedBinding,
          signature: SIGNATURE_A,
          signingKeyId: crypto.randomUUID(),
          counterpartySignature: SIGNATURE_B,
          counterpartySigningKeyId: agent.key.id,
          counterpartySignedAt: new Date(),
          cosignPropagationStatus: "pending" as const,
          cosignPropagationAttempts: 2,
          cosignPropagationLastError: "before-cosign",
        },
      },
      {
        kind: "reject" as const,
        id: crypto.randomUUID(),
        values: {
          status: "rejected" as const,
          receivedFromInstance: PEER_HOST,
          metadata: {
            ...wrongReceivedBinding,
            [COVENANT_REJECTION_REASON_METADATA_KEY]: "no",
          },
          signature: SIGNATURE_A,
          signingKeyId: crypto.randomUUID(),
          counterpartySignature: SIGNATURE_B,
          counterpartySigningKeyId: agent.key.id,
          counterpartySignedAt: new Date(),
          cosignPropagationStatus: "pending" as const,
          cosignPropagationAttempts: 2,
          cosignPropagationLastError: "before-reject",
        },
      },
      {
        kind: "withdraw" as const,
        id: crypto.randomUUID(),
        values: {
          status: "withdrawn" as const,
          receivedFromInstance: null,
          metadata: wrongLocalBinding,
          signature: SIGNATURE_A,
          signingKeyId: agent.key.id,
          counterpartySignature: SIGNATURE_B,
          counterpartySigningKeyId: agent.key.id,
          counterpartySignedAt: new Date(),
          cosignPropagationStatus: "pending" as const,
          cosignPropagationAttempts: 2,
          cosignPropagationLastError: "before-withdraw",
        },
      },
    ];

    for (const candidate of rows) {
      await db.insert(covenants).values({
        id: candidate.id,
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        counterpartyDid: PEER_DID,
        vows: [`${candidate.kind} generation fence`],
        protocolVersion: "v2",
        ...candidate.values,
      });
      const before = await storedCovenantJson(candidate.id);
      const result = candidate.kind === "declare"
        ? await propagateCovenant(candidate.id)
        : candidate.kind === "cosign"
        ? await propagateCosign(candidate.id)
        : candidate.kind === "reject"
        ? await propagateReject(candidate.id)
        : await propagateWithdraw(candidate.id);
      expect(result).toEqual({
        ok: false,
        error: "covenant_v2_authority_generation_mismatch",
      });
      expect(await storedCovenantJson(candidate.id)).toBe(before);
    }
  });

  test("durable declaration replay is write-free but altered lifecycle DIDs never ACK", async () => {
    const agent = await seedAgent();
    const proposal = await declareProposal(agent);
    const [storedProposal] = await db.select({ metadata: covenants.metadata })
      .from(covenants).where(eq(covenants.id, proposal.id)).limit(1);
    expect((storedProposal!.metadata as Record<string, unknown>)[
      COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY
    ]).toBe(TEST_AUTHORITY_GENERATION);
    const replay = await declareV2PreSigned({
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      covenantId: proposal.id,
      agentDid: agent.wireDid,
      counterpartyDid: PEER_DID,
      vows: ["authority remains exact"],
      establishedAt: proposal.establishedAt,
      signature: proposal.signature,
      signingKeyId: agent.key.id,
      publicKeyB64: agent.publicKeyB64,
    });
    expect(replay.created).toBe(false);

    await withAuthorityGeneration(undefined, async () => {
      await expect(declareV2PreSigned({
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        covenantId: proposal.id,
        agentDid: agent.wireDid,
        counterpartyDid: PEER_DID,
        vows: ["authority remains exact"],
        establishedAt: proposal.establishedAt,
        signature: proposal.signature,
        signingKeyId: agent.key.id,
        publicKeyB64: agent.publicKeyB64,
      })).rejects.toThrow("covenant_v2_authority_not_ready");
    });
    await withAuthorityGeneration("b".repeat(64), async () => {
      await expect(declareV2PreSigned({
        projectId: agent.identity.projectId,
        agentId: agent.identity.id,
        covenantId: proposal.id,
        agentDid: agent.wireDid,
        counterpartyDid: PEER_DID,
        vows: ["authority remains exact"],
        establishedAt: proposal.establishedAt,
        signature: proposal.signature,
        signingKeyId: agent.key.id,
        publicKeyB64: agent.publicKeyB64,
      })).rejects.toThrow("covenant_declaration_replay_conflict");
    });

    const receivedAgent = await seedAgent();
    const remoteInitiator = PEER_DID;
    const activeId = crypto.randomUUID();
    await db.insert(covenants).values({
      id: activeId,
      projectId: receivedAgent.identity.projectId,
      agentId: receivedAgent.identity.id,
      counterpartyDid: remoteInitiator,
      vows: ["terminal replay"],
      status: "active",
      protocolVersion: "v2",
      signature: SIGNATURE_A,
      signingKeyId: crypto.randomUUID(),
      counterpartySignature: SIGNATURE_B,
      counterpartySigningKeyId: receivedAgent.key.id,
      counterpartySignedAt: new Date(),
      proposedExpiresAt: new Date(0),
      receivedFromInstance: PEER_HOST,
      metadata: covenantMetadataWithWireDidBinding(
        {},
        remoteInitiator,
        receivedAgent.wireDid,
      ),
    });
    const exactAccept = await acceptProposalPreSigned({
      covenantId: activeId,
      accepterAgentId: receivedAgent.identity.id,
      accepterDid: receivedAgent.wireDid,
      initiatorSignatureB64: SIGNATURE_A,
      counterpartySignature: SIGNATURE_B,
      counterpartySigningKeyId: receivedAgent.key.id,
      // Advisory client time is intentionally not part of replay identity.
      counterpartySignedAt: new Date(0),
      publicKeyB64: receivedAgent.publicKeyB64,
    });
    expect(exactAccept.status).toBe("active");
    await expect(acceptProposalPreSigned({
      covenantId: activeId,
      accepterAgentId: receivedAgent.identity.id,
      accepterDid: `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`,
      initiatorSignatureB64: SIGNATURE_A,
      counterpartySignature: SIGNATURE_B,
      counterpartySigningKeyId: receivedAgent.key.id,
      counterpartySignedAt: new Date(0),
      publicKeyB64: receivedAgent.publicKeyB64,
    })).rejects.toThrow("covenant_not_proposed");

    const rejectedId = crypto.randomUUID();
    await db.insert(covenants).values({
      id: rejectedId,
      projectId: receivedAgent.identity.projectId,
      agentId: receivedAgent.identity.id,
      counterpartyDid: remoteInitiator,
      vows: ["terminal replay"],
      status: "rejected",
      protocolVersion: "v2",
      signature: SIGNATURE_A,
      signingKeyId: crypto.randomUUID(),
      counterpartySignature: SIGNATURE_B,
      counterpartySigningKeyId: receivedAgent.key.id,
      counterpartySignedAt: new Date(),
      receivedFromInstance: PEER_HOST,
      metadata: {
        ...covenantMetadataWithWireDidBinding(
          {},
          remoteInitiator,
          receivedAgent.wireDid,
        ),
        [COVENANT_REJECTION_REASON_METADATA_KEY]: "no",
      },
    });
    await expect(rejectProposalPreSigned({
      covenantId: rejectedId,
      rejecterAgentId: receivedAgent.identity.id,
      rejecterDid: `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`,
      rejectionSignature: SIGNATURE_B,
      rejecterSigningKeyId: receivedAgent.key.id,
      rejectedAt: new Date(0),
      reason: "no",
      publicKeyB64: receivedAgent.publicKeyB64,
    })).rejects.toThrow("covenant_not_proposed");

    const withdrawnId = crypto.randomUUID();
    await db.insert(covenants).values({
      id: withdrawnId,
      projectId: agent.identity.projectId,
      agentId: agent.identity.id,
      counterpartyDid: PEER_DID,
      vows: ["terminal replay"],
      status: "withdrawn",
      protocolVersion: "v2",
      signature: SIGNATURE_A,
      signingKeyId: agent.key.id,
      counterpartySignature: SIGNATURE_B,
      counterpartySigningKeyId: agent.key.id,
      counterpartySignedAt: new Date(),
      metadata: covenantMetadataWithWireDidBinding(
        {},
        agent.wireDid,
        PEER_DID,
      ),
    });
    await expect(withdrawProposalPreSigned({
      covenantId: withdrawnId,
      agentId: agent.identity.id,
      initiatorDid: `did:at:${LOCAL_HOST}/${crypto.randomUUID()}`,
      withdrawSignature: SIGNATURE_B,
      signingKeyId: agent.key.id,
      withdrawnAt: new Date(0),
      publicKeyB64: agent.publicKeyB64,
    })).rejects.toThrow("covenant_not_proposed");
  });
});
