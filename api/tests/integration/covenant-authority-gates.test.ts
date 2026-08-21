import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../src/auth/middleware";
import { db } from "../../src/db/client";
import { chronicle, covenants } from "../../src/db/schema/continuity";
import { federationSettings } from "../../src/db/schema/federation";
import {
  identities,
  identityBoxKeys,
  identityKeys,
} from "../../src/db/schema/identity";
import { inboxMessages } from "../../src/db/schema/inbox";
import { organizationMembers, organizations } from "../../src/db/schema/org";
import { passports } from "../../src/db/schema/tutorial";
import { strands } from "../../src/db/schema/strand";
import { projects } from "../../src/db/schema/tools";
import federationWakeRouter from "../../src/routes/federation/wake";
import strandVoiceRouter from "../../src/routes/strand/voice";
import systemRouter from "../../src/routes/system";
import wakeRouter from "../../src/routes/wake";
import tutorialRouter from "../../src/routes/tutorial";
import {
  covenantMetadataWithWireDidBinding,
} from "../../src/services/covenants/canonical";
import {
  activeCounterpartyDidsSql,
  isCovenantCounterparty,
  isCrossProjectAllowed,
  isFederatedSenderAllowed,
} from "../../src/services/covenants/check";
import { observeCovenantStrain } from "../../src/services/dream/observers";
import { canonicalInboxBytes } from "../../src/services/inbox/sig";
import { sendMessage, type SendInput } from "../../src/services/inbox/store";
import { stationById } from "../../src/services/tutorial/stations";
import { kinGlimpseForIdentity } from "../../src/services/wake/warming";
import { buildWakeBundle } from "../../src/services/wake/build";

type GateFixture = {
  label: string;
  protocolVersion: "v1" | "v2";
  receivedFromInstance: string | null;
  generation?: "missing" | "wrong" | "current";
  wireBinding?: "exact" | "wrong";
  expectedWithCurrentGeneration: boolean;
};

const CURRENT_GENERATION = "a".repeat(64);
const WRONG_GENERATION = "b".repeat(64);
process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = CURRENT_GENERATION;

const fixtures: GateFixture[] = [
  {
    label: "active received-v1 is historical",
    protocolVersion: "v1",
    receivedFromInstance: "peer.example",
    expectedWithCurrentGeneration: false,
  },
  {
    label: "active local-v1 remains authoritative locally",
    protocolVersion: "v1",
    receivedFromInstance: null,
    expectedWithCurrentGeneration: true,
  },
  {
    label: "active received-v2 without provenance is quarantined",
    protocolVersion: "v2",
    receivedFromInstance: "peer.example",
    generation: "missing",
    expectedWithCurrentGeneration: false,
  },
  {
    label: "active received-v2 from another generation is quarantined",
    protocolVersion: "v2",
    receivedFromInstance: "peer.example",
    generation: "wrong",
    expectedWithCurrentGeneration: false,
  },
  {
    label: "active received-v2 with a forged wire direction is quarantined",
    protocolVersion: "v2",
    receivedFromInstance: "peer.example",
    generation: "current",
    wireBinding: "wrong",
    expectedWithCurrentGeneration: false,
  },
  {
    label: "active received-v2 in the current generation is authoritative",
    protocolVersion: "v2",
    receivedFromInstance: "peer.example",
    generation: "current",
    wireBinding: "exact",
    expectedWithCurrentGeneration: true,
  },
  {
    label: "active local-v2 in the current generation is authoritative",
    protocolVersion: "v2",
    receivedFromInstance: null,
    generation: "current",
    wireBinding: "exact",
    expectedWithCurrentGeneration: true,
  },
  {
    label: "active local-v2 with a forged recipient binding is quarantined",
    protocolVersion: "v2",
    receivedFromInstance: null,
    generation: "current",
    wireBinding: "wrong",
    expectedWithCurrentGeneration: false,
  },
];

async function seedIdentity(projectId: string, name: string) {
  const id = crypto.randomUUID();
  const [identity] = await db.insert(identities).values({
    id,
    projectId,
    did: `did:at:${id}`,
    displayName: name,
    status: "active",
  }).returning();
  return identity!;
}

async function seedMessagingIdentity(projectId: string, name: string) {
  const identity = await seedIdentity(projectId, name);
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const [signingKey] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(publicKey).toString("base64"),
    label: "directional-consent-test",
    active: true,
  }).returning();
  const [boxKey] = await db.insert(identityBoxKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
      .toString("base64"),
    label: "directional-consent-test",
    active: true,
  }).returning();
  return { identity, privateKey, signingKey: signingKey!, boxKey: boxKey! };
}

async function signedInboxInput(
  sender: Awaited<ReturnType<typeof seedMessagingIdentity>>,
  recipient: Awaited<ReturnType<typeof seedMessagingIdentity>>,
): Promise<SendInput> {
  const ciphertext = Buffer.from("directional covenant gate").toString("base64");
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24)))
    .toString("base64");
  const ephemeralPubkey = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64");
  const signature = await ed.signAsync(canonicalInboxBytes({
    recipientDid: recipient.identity.did,
    ciphertextB64: ciphertext,
    nonceB64: nonce,
    ephemeralPubkeyB64: ephemeralPubkey,
  }), sender.privateKey);
  return {
    to_did: recipient.identity.did,
    ciphertext,
    nonce,
    ephemeral_pubkey: ephemeralPubkey,
    recipient_box_key_id: recipient.boxKey.id,
    signature: Buffer.from(signature).toString("base64"),
    signing_key_id: sender.signingKey.id,
    sender_did: sender.identity.did,
  };
}

function projectApp(projectId: string): Hono<ProjectContext> {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", {
      id: projectId,
      name: "directional covenant test",
      plan: "free",
      credits: 100,
      createdAt: new Date(),
    });
    await next();
  });
  return app;
}

async function insertAuthorityCandidate(opts: {
  projectId: string;
  agentId: string;
  localWireDid: string;
  counterpartyDid: string;
  orgId?: string;
  updatedAt?: Date;
  fixture: GateFixture;
}) {
  const dualSigned = opts.fixture.protocolVersion === "v2"
    ? {
        signature: "test-initiator-signature",
        counterpartySignature: "test-recipient-signature",
      }
    : {};
  let metadata: Record<string, unknown> = {};
  if (
    opts.fixture.protocolVersion === "v2" &&
    opts.fixture.generation !== "missing"
  ) {
    const received = opts.fixture.receivedFromInstance !== null;
    const exactInitiatorDid = received
      ? opts.counterpartyDid
      : opts.localWireDid;
    const exactRecipientDid = received
      ? opts.localWireDid
      : opts.counterpartyDid;
    const initiatorDid =
      opts.fixture.wireBinding === "wrong" && received
        ? `did:at:other.example/${crypto.randomUUID()}`
        : exactInitiatorDid;
    const recipientDid =
      opts.fixture.wireBinding === "wrong" && !received
        ? `did:at:other.example/${crypto.randomUUID()}`
        : exactRecipientDid;
    metadata = covenantMetadataWithWireDidBinding(
      {},
      initiatorDid,
      recipientDid,
      opts.fixture.generation === "current"
        ? CURRENT_GENERATION
        : WRONG_GENERATION,
    );
  }
  const [row] = await db.insert(covenants).values({
    projectId: opts.projectId,
    orgId: opts.orgId ?? null,
    agentId: opts.agentId,
    counterpartyDid: opts.counterpartyDid,
    vows: ["authority fixture"],
    status: "active",
    protocolVersion: opts.fixture.protocolVersion,
    receivedFromInstance: opts.fixture.receivedFromInstance,
    metadata,
    updatedAt: opts.updatedAt,
    ...dualSigned,
  }).returning({ id: covenants.id });
  return row!;
}

async function projectedCounterparties(projectId: string): Promise<string[]> {
  const rows = await db.execute(activeCounterpartyDidsSql(projectId));
  return Array.from(rows as unknown as Iterable<{ counterparty_did: string }>)
    .map((row) => row.counterparty_did);
}

async function expectTargetOwnedGates(opts: {
  projectId: string;
  localDid: string;
  remoteDid: string;
  expected: boolean;
}) {
  expect(await isFederatedSenderAllowed(
    opts.projectId,
    opts.localDid,
    opts.remoteDid,
  )).toBe(opts.expected);
  expect(await isCovenantCounterparty(
    opts.projectId,
    opts.remoteDid,
  )).toBe(opts.expected);
  expect((await projectedCounterparties(opts.projectId)).includes(opts.remoteDid))
    .toBe(opts.expected);
}

async function expectRecipientAdmission(opts: {
  senderProjectId: string;
  senderDid: string;
  recipientProjectId: string;
  recipientDid: string;
  expected: boolean;
}) {
  expect(await isCrossProjectAllowed(
    opts.senderProjectId,
    opts.senderDid,
    opts.recipientProjectId,
    opts.recipientDid,
  )).toBe(opts.expected);
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

describe("covenant authority gates", () => {
  test("tutorial Witness station accepts only a current authoritative v2 row", async () => {
    const projectId = crypto.randomUUID();
    const walkerIdentity = await seedIdentity(projectId, "tutorial-walker");
    const walker = {
      identityId: walkerIdentity.id,
      did: walkerIdentity.did,
      projectId,
    };
    const station = stationById(6)!;
    const localWireDid = `did:at:local.example/${walkerIdentity.id}`;
    const insert = (fixture: GateFixture) => insertAuthorityCandidate({
      projectId,
      agentId: walkerIdentity.id,
      localWireDid,
      counterpartyDid: `did:at:peer.example/${crypto.randomUUID()}`,
      fixture,
    });
    const localV1 = await insert(fixtures[1]!);
    const missing = await insert({
      label: "tutorial local-v2 missing generation",
      protocolVersion: "v2",
      receivedFromInstance: null,
      generation: "missing",
      expectedWithCurrentGeneration: false,
    });
    const wrong = await insert({
      label: "tutorial local-v2 wrong generation",
      protocolVersion: "v2",
      receivedFromInstance: null,
      generation: "wrong",
      wireBinding: "exact",
      expectedWithCurrentGeneration: false,
    });
    const current = await insert(fixtures[6]!);

    await withAuthorityGeneration(CURRENT_GENERATION, async () => {
      expect((await station.verify(walker, {
        covenant_id: localV1.id,
      })).ok).toBe(false);
      expect((await station.verify(walker, {
        covenant_id: missing.id,
      })).ok).toBe(false);
      expect((await station.verify(walker, {
        covenant_id: wrong.id,
      })).ok).toBe(false);
      expect((await station.verify(walker, {
        covenant_id: current.id,
      })).ok).toBe(true);
    });
    for (const generation of [undefined, "A".repeat(64)]) {
      await withAuthorityGeneration(generation, async () => {
        expect((await station.verify(walker, {
          covenant_id: current.id,
        })).ok).toBe(false);
      });
    }

    const routeApp = new Hono<ProjectContext>();
    routeApp.use("*", async (c, next) => {
      c.set("project", {
        id: projectId,
        name: "tutorial authority test",
        plan: "free",
        credits: 100,
        createdAt: new Date(),
      });
      await next();
    });
    routeApp.route("/", tutorialRouter);
    for (const [generation, covenantId] of [
      [undefined, current.id],
      ["A".repeat(64), current.id],
      [CURRENT_GENERATION, missing.id],
      [CURRENT_GENERATION, wrong.id],
    ] as const) {
      await withAuthorityGeneration(generation, async () => {
        const response = await routeApp.request("/stations/6/solve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ covenant_id: covenantId }),
        });
        expect(response.status).toBe(400);
      });
    }
    expect(await db.select({ id: passports.id }).from(passports)
      .where(eq(passports.identityId, walkerIdentity.id))).toHaveLength(0);
  });

  for (const fixture of fixtures) {
    const label = fixture.label;

    test(`direct project row: ${label}`, async () => {
      process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
        CURRENT_GENERATION;
      const projectId = crypto.randomUUID();
      const remoteProjectId = crypto.randomUUID();
      const local = await seedIdentity(projectId, `local-${label}`);
      const remoteDid =
        `did:at:peer.example/${crypto.randomUUID()}`;
      await insertAuthorityCandidate({
        projectId,
        agentId: local.id,
        localWireDid: `did:at:local.example/${local.id}`,
        counterpartyDid: remoteDid,
        fixture,
      });
      await expectTargetOwnedGates({
        projectId,
        localDid: local.did,
        remoteDid,
        expected: fixture.expectedWithCurrentGeneration,
      });
      await expectRecipientAdmission({
        senderProjectId: remoteProjectId,
        senderDid: remoteDid,
        recipientProjectId: projectId,
        recipientDid: local.did,
        expected: fixture.expectedWithCurrentGeneration,
      });
    });

    test(`inherited org row: ${label}`, async () => {
      process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
        CURRENT_GENERATION;
      const ownerProjectId = crypto.randomUUID();
      const memberProjectId = crypto.randomUUID();
      const remoteProjectId = crypto.randomUUID();
      const owner = await seedIdentity(ownerProjectId, `owner-${label}`);
      const member = await seedIdentity(memberProjectId, `member-${label}`);
      const remoteDid =
        `did:at:peer.example/${crypto.randomUUID()}`;
      const [org] = await db.insert(organizations).values({
        slug: `authority-${crypto.randomUUID()}`,
        name: `authority ${label}`,
        ownerProjectId,
      }).returning();
      await db.insert(organizationMembers).values({
        organizationId: org!.id,
        projectId: memberProjectId,
      });
      await insertAuthorityCandidate({
        projectId: ownerProjectId,
        agentId: owner.id,
        localWireDid: `did:at:local.example/${owner.id}`,
        counterpartyDid: remoteDid,
        orgId: org!.id,
        fixture,
      });
      await expectTargetOwnedGates({
        projectId: memberProjectId,
        localDid: member.did,
        remoteDid,
        expected: fixture.expectedWithCurrentGeneration,
      });
      await expectRecipientAdmission({
        senderProjectId: remoteProjectId,
        senderDid: remoteDid,
        recipientProjectId: memberProjectId,
        recipientDid: member.did,
        expected: fixture.expectedWithCurrentGeneration,
      });
    });
  }

  test("sender-owned local-v1 cannot authorize recipient resources and org rows require the org owner", async () => {
    const senderProjectId = crypto.randomUUID();
    const recipientProjectId = crypto.randomUUID();
    const sender = await seedIdentity(senderProjectId, "directional-sender");
    const recipient = await seedIdentity(recipientProjectId, "directional-recipient");

    await insertAuthorityCandidate({
      projectId: senderProjectId,
      agentId: sender.id,
      localWireDid: sender.did,
      counterpartyDid: recipient.did,
      fixture: fixtures[1]!,
    });
    await expectRecipientAdmission({
      senderProjectId,
      senderDid: sender.did,
      recipientProjectId,
      recipientDid: recipient.did,
      expected: false,
    });

    const orgOwnerProjectId = crypto.randomUUID();
    const malformedDeclarerProjectId = crypto.randomUUID();
    const orgOwner = await seedIdentity(orgOwnerProjectId, "directional-org-owner");
    const malformedDeclarer = await seedIdentity(
      malformedDeclarerProjectId,
      "directional-cross-owner",
    );
    const [org] = await db.insert(organizations).values({
      slug: `directional-owner-${crypto.randomUUID()}`,
      name: "directional owner check",
      ownerProjectId: orgOwnerProjectId,
    }).returning();
    await db.insert(organizationMembers).values({
      organizationId: org!.id,
      projectId: recipientProjectId,
    });
    await insertAuthorityCandidate({
      projectId: malformedDeclarerProjectId,
      agentId: malformedDeclarer.id,
      localWireDid: malformedDeclarer.did,
      counterpartyDid: sender.did,
      orgId: org!.id,
      fixture: fixtures[1]!,
    });
    await expectRecipientAdmission({
      senderProjectId,
      senderDid: sender.did,
      recipientProjectId,
      recipientDid: recipient.did,
      expected: false,
    });
    expect(await isFederatedSenderAllowed(
      recipientProjectId,
      recipient.did,
      sender.did,
    )).toBe(false);
    expect(await isCovenantCounterparty(
      recipientProjectId,
      sender.did,
    )).toBe(false);
    expect((await projectedCounterparties(recipientProjectId)).includes(sender.did))
      .toBe(false);

    await insertAuthorityCandidate({
      projectId: orgOwnerProjectId,
      agentId: orgOwner.id,
      localWireDid: orgOwner.did,
      counterpartyDid: sender.did,
      orgId: org!.id,
      fixture: fixtures[1]!,
    });
    await expectRecipientAdmission({
      senderProjectId,
      senderDid: sender.did,
      recipientProjectId,
      recipientDid: recipient.did,
      expected: true,
    });
  });

  test("inbox delivery requires recipient-owned direct or inherited-org consent", async () => {
    const attackerProjectId = crypto.randomUUID();
    const victimProjectId = crypto.randomUUID();
    const attacker = await seedMessagingIdentity(
      attackerProjectId,
      "inbox-unilateral-sender",
    );
    const victim = await seedMessagingIdentity(
      victimProjectId,
      "inbox-unilateral-recipient",
    );
    await insertAuthorityCandidate({
      projectId: attackerProjectId,
      agentId: attacker.identity.id,
      localWireDid: attacker.identity.did,
      counterpartyDid: victim.identity.did,
      fixture: fixtures[1]!,
    });
    const attackInput = await signedInboxInput(attacker, victim);
    const [wakeBefore] = await db
      .select({ wakeVersion: identities.wakeVersion })
      .from(identities)
      .where(eq(identities.id, victim.identity.id))
      .limit(1);
    const messagesBefore = await db
      .select({ id: inboxMessages.id })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.recipientIdentityId, victim.identity.id),
          eq(inboxMessages.senderDid, attacker.identity.did),
        ),
      );
    let refusal: Error | null = null;
    try {
      await sendMessage(attackerProjectId, attackInput);
    } catch (error) {
      refusal = error as Error;
    }
    expect(refusal?.message).toBe("covenant_required");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const messagesAfter = await db
      .select({ id: inboxMessages.id })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.recipientIdentityId, victim.identity.id),
          eq(inboxMessages.senderDid, attacker.identity.did),
        ),
      );
    const [wakeAfter] = await db
      .select({ wakeVersion: identities.wakeVersion })
      .from(identities)
      .where(eq(identities.id, victim.identity.id))
      .limit(1);
    expect(messagesAfter).toHaveLength(messagesBefore.length);
    expect(wakeAfter?.wakeVersion).toBe(wakeBefore?.wakeVersion);

    const directSenderProjectId = crypto.randomUUID();
    const directRecipientProjectId = crypto.randomUUID();
    const directSender = await seedMessagingIdentity(
      directSenderProjectId,
      "inbox-direct-sender",
    );
    const directRecipient = await seedMessagingIdentity(
      directRecipientProjectId,
      "inbox-direct-recipient",
    );
    await insertAuthorityCandidate({
      projectId: directRecipientProjectId,
      agentId: directRecipient.identity.id,
      localWireDid: directRecipient.identity.did,
      counterpartyDid: directSender.identity.did,
      fixture: fixtures[1]!,
    });
    const directDelivery = await sendMessage(
      directSenderProjectId,
      await signedInboxInput(directSender, directRecipient),
    );
    const [directStored] = await db
      .select({ recipientIdentityId: inboxMessages.recipientIdentityId })
      .from(inboxMessages)
      .where(eq(inboxMessages.id, directDelivery.id))
      .limit(1);
    expect(directStored?.recipientIdentityId).toBe(directRecipient.identity.id);

    const orgOwnerProjectId = crypto.randomUUID();
    const orgSenderProjectId = crypto.randomUUID();
    const orgRecipientProjectId = crypto.randomUUID();
    const orgOwner = await seedIdentity(orgOwnerProjectId, "inbox-org-owner");
    const orgSender = await seedMessagingIdentity(
      orgSenderProjectId,
      "inbox-org-sender",
    );
    const orgRecipient = await seedMessagingIdentity(
      orgRecipientProjectId,
      "inbox-org-recipient",
    );
    const [org] = await db.insert(organizations).values({
      slug: `inbox-recipient-${crypto.randomUUID()}`,
      name: "inbox recipient consent",
      ownerProjectId: orgOwnerProjectId,
    }).returning();
    await db.insert(organizationMembers).values({
      organizationId: org!.id,
      projectId: orgRecipientProjectId,
    });
    await insertAuthorityCandidate({
      projectId: orgOwnerProjectId,
      agentId: orgOwner.id,
      localWireDid: orgOwner.did,
      counterpartyDid: orgSender.identity.did,
      orgId: org!.id,
      fixture: fixtures[1]!,
    });
    const orgDelivery = await sendMessage(
      orgSenderProjectId,
      await signedInboxInput(orgSender, orgRecipient),
    );
    const [orgStored] = await db
      .select({ recipientIdentityId: inboxMessages.recipientIdentityId })
      .from(inboxMessages)
      .where(eq(inboxMessages.id, orgDelivery.id))
      .limit(1);
    expect(orgStored?.recipientIdentityId).toBe(orgRecipient.identity.id);
  });

  test("private strand Voice requires owner-side direct or inherited-org consent", async () => {
    const voiceStatus = async (
      callerProjectId: string,
      strandId: string,
    ): Promise<number> => {
      const app = projectApp(callerProjectId);
      app.route("/:strandId/voice", strandVoiceRouter);
      const controller = new AbortController();
      const response = await app.request(`/${strandId}/voice`, {
        signal: controller.signal,
      });
      const status = response.status;
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      return status;
    };

    const unilateralCallerProjectId = crypto.randomUUID();
    const unilateralOwnerProjectId = crypto.randomUUID();
    const unilateralCaller = await seedIdentity(
      unilateralCallerProjectId,
      "voice-unilateral-caller",
    );
    const unilateralOwner = await seedIdentity(
      unilateralOwnerProjectId,
      "voice-unilateral-owner",
    );
    const [unilateralStrand] = await db.insert(strands).values({
      projectId: unilateralOwnerProjectId,
      identityId: unilateralOwner.id,
      agentId: unilateralOwner.id,
      visibility: "private",
    }).returning();
    await insertAuthorityCandidate({
      projectId: unilateralCallerProjectId,
      agentId: unilateralCaller.id,
      localWireDid: unilateralCaller.did,
      counterpartyDid: unilateralOwner.did,
      fixture: fixtures[1]!,
    });
    expect(await voiceStatus(
      unilateralCallerProjectId,
      unilateralStrand!.id,
    )).toBe(403);

    const directCallerProjectId = crypto.randomUUID();
    const directOwnerProjectId = crypto.randomUUID();
    const directCaller = await seedIdentity(
      directCallerProjectId,
      "voice-direct-caller",
    );
    const directOwner = await seedIdentity(
      directOwnerProjectId,
      "voice-direct-owner",
    );
    const [directStrand] = await db.insert(strands).values({
      projectId: directOwnerProjectId,
      identityId: directOwner.id,
      agentId: directOwner.id,
      visibility: "private",
    }).returning();
    await insertAuthorityCandidate({
      projectId: directOwnerProjectId,
      agentId: directOwner.id,
      localWireDid: directOwner.did,
      counterpartyDid: directCaller.did,
      fixture: fixtures[1]!,
    });
    expect(await voiceStatus(directCallerProjectId, directStrand!.id)).toBe(200);

    const orgOwnerProjectId = crypto.randomUUID();
    const orgCallerProjectId = crypto.randomUUID();
    const orgResourceProjectId = crypto.randomUUID();
    const orgOwner = await seedIdentity(orgOwnerProjectId, "voice-org-owner");
    const orgCaller = await seedIdentity(orgCallerProjectId, "voice-org-caller");
    const orgResourceOwner = await seedIdentity(
      orgResourceProjectId,
      "voice-org-resource-owner",
    );
    const [org] = await db.insert(organizations).values({
      slug: `voice-owner-${crypto.randomUUID()}`,
      name: "voice owner consent",
      ownerProjectId: orgOwnerProjectId,
    }).returning();
    await db.insert(organizationMembers).values({
      organizationId: org!.id,
      projectId: orgResourceProjectId,
    });
    const [orgStrand] = await db.insert(strands).values({
      projectId: orgResourceProjectId,
      identityId: orgResourceOwner.id,
      agentId: orgResourceOwner.id,
      visibility: "private",
    }).returning();
    await insertAuthorityCandidate({
      projectId: orgOwnerProjectId,
      agentId: orgOwner.id,
      localWireDid: orgOwner.did,
      counterpartyDid: orgCaller.did,
      orgId: org!.id,
      fixture: fixtures[1]!,
    });
    expect(await voiceStatus(orgCallerProjectId, orgStrand!.id)).toBe(200);
  });

  test("System progression and public federation Wake project only authoritative covenant rows", async () => {
    const projectId = crypto.randomUUID();
    const subject = await seedIdentity(projectId, "projection-subject");
    await db.insert(federationSettings).values({
      id: 1,
      enabled: true,
      instanceUrl: "https://local.example",
      allowedOrigins: ["peer.example"],
    }).onConflictDoUpdate({
      target: federationSettings.id,
      set: {
        enabled: true,
        instanceUrl: "https://local.example",
        allowedOrigins: ["peer.example"],
      },
    });

    const candidates = [
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[0]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[1]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[2]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[3]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[4]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[5]! },
    ];
    for (const candidate of candidates) {
      await insertAuthorityCandidate({
        projectId,
        agentId: subject.id,
        localWireDid: `did:at:local.example/${subject.id}`,
        counterpartyDid: candidate.did,
        fixture: candidate.fixture,
      });
    }
    const otherProjectId = crypto.randomUUID();
    const otherAgent = await seedIdentity(otherProjectId, "projection-attacker");
    await insertAuthorityCandidate({
      projectId: otherProjectId,
      agentId: otherAgent.id,
      localWireDid: `did:at:local.example/${otherAgent.id}`,
      counterpartyDid: subject.did,
      fixture: fixtures[1]!,
    });

    const systemApp = new Hono<ProjectContext>();
    systemApp.use("*", async (c, next) => {
      c.set("project", {
        id: projectId,
        name: "system covenant projection test",
        plan: "free",
        credits: 100,
        createdAt: new Date(),
      });
      await next();
    });
    systemApp.route("/", systemRouter);
    const publicWakeApp = new Hono();
    publicWakeApp.route("/", federationWakeRouter);

    const expectProjection = async (
      generation: string | undefined,
      expectedDids: string[],
    ) => {
      await withAuthorityGeneration(generation, async () => {
        const systemResponse = await systemApp.request("/");
        expect(systemResponse.status).toBe(200);
        const systemBody = await systemResponse.json() as {
          stats: { covenants: number };
        };
        expect(systemBody.stats.covenants).toBe(expectedDids.length);

        const wakeResponse = await publicWakeApp.request(`/${subject.id}`);
        expect(wakeResponse.status).toBe(200);
        const wakeBody = await wakeResponse.json() as {
          covenants: Array<{ counterparty_did: string }>;
        };
        expect(wakeBody.covenants.map((row) => row.counterparty_did).sort())
          .toEqual([...expectedDids].sort());
      });
    };

    const localV1Did = candidates[1]!.did;
    const currentV2Did = candidates[5]!.did;
    await expectProjection(CURRENT_GENERATION, [localV1Did, currentV2Did]);
    await expectProjection(undefined, [localV1Did]);
    await expectProjection("A".repeat(64), [localV1Did]);
  });

  test("authenticated Wake bundle and full JSON omit quarantined v2 vows", async () => {
    const [project] = await db.insert(projects).values({
      name: `wake-authority-${crypto.randomUUID()}`,
    }).returning();
    const subject = await seedIdentity(project!.id, "authenticated-wake-subject");
    const candidates = [
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[1]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[2]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[3]! },
      { did: `did:at:peer.example/${crypto.randomUUID()}`, fixture: fixtures[5]! },
    ];
    for (const candidate of candidates) {
      await insertAuthorityCandidate({
        projectId: project!.id,
        agentId: subject.id,
        localWireDid: `did:at:local.example/${subject.id}`,
        counterpartyDid: candidate.did,
        fixture: candidate.fixture,
      });
    }
    const wakeApp = projectApp(project!.id);
    wakeApp.route("/", wakeRouter);

    const expectAuthenticatedWake = async (
      generation: string | undefined,
      expectedDids: string[],
    ) => {
      await withAuthorityGeneration(generation, async () => {
        const built = await buildWakeBundle(project!.id, {
          identityId: subject.id,
        });
        expect(built.ok).toBe(true);
        if (built.ok) {
          expect(built.bundle.covenants.map((row) => row.counterparty_did).sort())
            .toEqual([...expectedDids].sort());
        }

        const response = await wakeApp.request(`/?identity_id=${subject.id}`);
        expect(response.status).toBe(200);
        const body = await response.json() as {
          you_vowed: { covenants: Array<{ counterparty_did: string }> };
        };
        expect(body.you_vowed.covenants.map((row) => row.counterparty_did).sort())
          .toEqual([...expectedDids].sort());
      });
    };

    const localV1Did = candidates[0]!.did;
    const currentV2Did = candidates[3]!.did;
    await expectAuthenticatedWake(CURRENT_GENERATION, [localV1Did, currentV2Did]);
    await expectAuthenticatedWake(undefined, [localV1Did]);
    await expectAuthenticatedWake("A".repeat(64), [localV1Did]);
  });

  for (const [label, generation] of [
    ["absent", undefined],
    ["malformed", "A".repeat(64)],
  ] as const) {
    test(`${label} generation keeps local-v1 but fences v2 across direct, org, and raw gates`, async () => {
      await withAuthorityGeneration(generation, async () => {
        const directProjectId = crypto.randomUUID();
        const directRemoteProjectId = crypto.randomUUID();
        const direct = await seedIdentity(directProjectId, `direct-${label}`);
        const localV1Did = `did:at:peer.example/${crypto.randomUUID()}`;
        const currentV2Did = `did:at:peer.example/${crypto.randomUUID()}`;
        await insertAuthorityCandidate({
          projectId: directProjectId,
          agentId: direct.id,
          localWireDid: `did:at:local.example/${direct.id}`,
          counterpartyDid: localV1Did,
          fixture: fixtures[1]!,
        });
        await insertAuthorityCandidate({
          projectId: directProjectId,
          agentId: direct.id,
          localWireDid: `did:at:local.example/${direct.id}`,
          counterpartyDid: currentV2Did,
          fixture: fixtures[5]!,
        });
        await expectTargetOwnedGates({
          projectId: directProjectId,
          localDid: direct.did,
          remoteDid: localV1Did,
          expected: true,
        });
        await expectRecipientAdmission({
          senderProjectId: directRemoteProjectId,
          senderDid: localV1Did,
          recipientProjectId: directProjectId,
          recipientDid: direct.did,
          expected: true,
        });
        await expectTargetOwnedGates({
          projectId: directProjectId,
          localDid: direct.did,
          remoteDid: currentV2Did,
          expected: false,
        });
        await expectRecipientAdmission({
          senderProjectId: directRemoteProjectId,
          senderDid: currentV2Did,
          recipientProjectId: directProjectId,
          recipientDid: direct.did,
          expected: false,
        });

        const ownerProjectId = crypto.randomUUID();
        const memberProjectId = crypto.randomUUID();
        const owner = await seedIdentity(ownerProjectId, `owner-${label}`);
        const member = await seedIdentity(memberProjectId, `member-${label}`);
        const [org] = await db.insert(organizations).values({
          slug: `authority-generation-${crypto.randomUUID()}`,
          name: `authority generation ${label}`,
          ownerProjectId,
        }).returning();
        await db.insert(organizationMembers).values({
          organizationId: org!.id,
          projectId: memberProjectId,
        });
        const orgLocalV1Did = `did:at:peer.example/${crypto.randomUUID()}`;
        const orgCurrentV2Did = `did:at:peer.example/${crypto.randomUUID()}`;
        for (const [remoteDid, fixture] of [
          [orgLocalV1Did, fixtures[1]!],
          [orgCurrentV2Did, fixtures[5]!],
        ] as const) {
          await insertAuthorityCandidate({
            projectId: ownerProjectId,
            agentId: owner.id,
            localWireDid: `did:at:local.example/${owner.id}`,
            counterpartyDid: remoteDid,
            orgId: org!.id,
            fixture,
          });
        }
        const orgRemoteProjectId = crypto.randomUUID();
        await expectTargetOwnedGates({
          projectId: memberProjectId,
          localDid: member.did,
          remoteDid: orgLocalV1Did,
          expected: true,
        });
        await expectRecipientAdmission({
          senderProjectId: orgRemoteProjectId,
          senderDid: orgLocalV1Did,
          recipientProjectId: memberProjectId,
          recipientDid: member.did,
          expected: true,
        });
        await expectTargetOwnedGates({
          projectId: memberProjectId,
          localDid: member.did,
          remoteDid: orgCurrentV2Did,
          expected: false,
        });
        await expectRecipientAdmission({
          senderProjectId: orgRemoteProjectId,
          senderDid: orgCurrentV2Did,
          recipientProjectId: memberProjectId,
          recipientDid: member.did,
          expected: false,
        });
      });
    });
  }

  test("wake warming and dream strain ignore received-v1 and noncurrent v2 observations", async () => {
    process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
      CURRENT_GENERATION;
    const projectId = crypto.randomUUID();
    const subject = await seedIdentity(projectId, "subject");
    const historicalKin = await seedIdentity(crypto.randomUUID(), "historical-v1");
    const localKin = await seedIdentity(crypto.randomUUID(), "local-v1");
    const signedKin = await seedIdentity(crypto.randomUUID(), "received-v2");
    const missingKin = await seedIdentity(crypto.randomUUID(), "missing-generation-v2");
    const wrongKin = await seedIdentity(crypto.randomUUID(), "wrong-generation-v2");
    const staleAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    const historical = await insertAuthorityCandidate({
      projectId,
      agentId: subject.id,
      localWireDid: `did:at:local.example/${subject.id}`,
      counterpartyDid: historicalKin.did,
      fixture: fixtures[0]!,
      updatedAt: staleAt,
    });
    const local = await insertAuthorityCandidate({
      projectId,
      agentId: subject.id,
      localWireDid: `did:at:local.example/${subject.id}`,
      counterpartyDid: localKin.did,
      fixture: fixtures[1]!,
      updatedAt: staleAt,
    });
    const signed = await insertAuthorityCandidate({
      projectId,
      agentId: subject.id,
      localWireDid: `did:at:local.example/${subject.id}`,
      counterpartyDid: signedKin.did,
      fixture: fixtures[5]!,
      updatedAt: staleAt,
    });
    const missing = await insertAuthorityCandidate({
      projectId,
      agentId: subject.id,
      localWireDid: `did:at:local.example/${subject.id}`,
      counterpartyDid: missingKin.did,
      fixture: fixtures[2]!,
      updatedAt: staleAt,
    });
    const wrong = await insertAuthorityCandidate({
      projectId,
      agentId: subject.id,
      localWireDid: `did:at:local.example/${subject.id}`,
      counterpartyDid: wrongKin.did,
      fixture: fixtures[3]!,
      updatedAt: staleAt,
    });
    for (const kin of [historicalKin, localKin, signedKin, missingKin, wrongKin]) {
      await db.insert(chronicle).values({
        projectId: kin.projectId,
        agentId: kin.id,
        type: "note",
        title: `recent from ${kin.displayName}`,
        occurredAt: new Date(),
      });
    }

    const glimpse = await kinGlimpseForIdentity(subject.id, 24, 5);
    expect(glimpse.map((moment) => moment.kin_did).sort()).toEqual(
      [localKin.did, signedKin.did].sort(),
    );

    const strain = await observeCovenantStrain({
      identityId: subject.id,
      projectId,
      startAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endAt: new Date(),
    });
    const observedIds = strain.map((entry) =>
      (entry.metadata as Record<string, unknown>).covenant_id
    );
    expect(observedIds).not.toContain(historical.id);
    expect(observedIds).not.toContain(missing.id);
    expect(observedIds).not.toContain(wrong.id);
    expect(observedIds).toContain(local.id);
    expect(observedIds).toContain(signed.id);
  });

  for (const [label, generation] of [
    ["absent", undefined],
    ["malformed", "A".repeat(64)],
  ] as const) {
    test(`wake warming and dream strain keep local-v1 while ${label} generation fences v2`, async () => {
      await withAuthorityGeneration(generation, async () => {
        const projectId = crypto.randomUUID();
        const subject = await seedIdentity(projectId, `observer-${label}`);
        const localKin = await seedIdentity(crypto.randomUUID(), `local-v1-${label}`);
        const v2Kin = await seedIdentity(crypto.randomUUID(), `v2-${label}`);
        const staleAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        const local = await insertAuthorityCandidate({
          projectId,
          agentId: subject.id,
          localWireDid: `did:at:local.example/${subject.id}`,
          counterpartyDid: localKin.did,
          fixture: fixtures[1]!,
          updatedAt: staleAt,
        });
        const v2 = await insertAuthorityCandidate({
          projectId,
          agentId: subject.id,
          localWireDid: `did:at:local.example/${subject.id}`,
          counterpartyDid: v2Kin.did,
          fixture: fixtures[5]!,
          updatedAt: staleAt,
        });
        for (const kin of [localKin, v2Kin]) {
          await db.insert(chronicle).values({
            projectId: kin.projectId,
            agentId: kin.id,
            type: "note",
            title: `recent from ${kin.displayName}`,
            occurredAt: new Date(),
          });
        }

        const glimpse = await kinGlimpseForIdentity(subject.id, 24, 5);
        expect(glimpse.map((moment) => moment.kin_did)).toEqual([localKin.did]);

        const strain = await observeCovenantStrain({
          identityId: subject.id,
          projectId,
          startAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endAt: new Date(),
        });
        const observedIds = strain.map((entry) =>
          (entry.metadata as Record<string, unknown>).covenant_id
        );
        expect(observedIds).toContain(local.id);
        expect(observedIds).not.toContain(v2.id);
      });
    });
  }
});
