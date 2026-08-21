import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveLocalWireDid } from "../src/services/covenants/wire-identity";
import { federatedV2DeclarationWireStatus } from "../src/services/covenants/federation";
import {
  COVENANT_COSIGN_ARRIVAL_GRACE_MS,
  COVENANT_ESTABLISHED_FUTURE_SKEW_MS,
  COVENANT_INBOUND_BODY_MAX_BYTES,
  COVENANT_METADATA_MAX_BYTES,
  COVENANT_NOTES_MAX_CHARS,
  COVENANT_PROPOSAL_TTL_MS,
  COVENANT_VOW_MAX_CHARS,
  COVENANT_VOW_MAX_COUNT,
  COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
  COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
  COVENANT_REJECTION_REASON_METADATA_KEY,
  COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY,
  covenantCallerDeclarationMetadata,
  covenantDeclarationWireFieldsAreBounded,
  covenantDeclarationWirePayloadIsBounded,
  covenantEstablishedAtIsAdmissible,
  covenantMetadataHasReservedKey,
  covenantMetadataHasCurrentV2AuthorityGeneration,
  covenantMetadataWithWireDidBinding,
  parseCovenantV2AuthorityGeneration,
  covenantWireDidBindingMatches,
  isCanonicalEd25519Signature,
  isCanonicalCovenantId,
  isCanonicalSignedUuid,
  isCanonicalUtcMillisecondTimestamp,
  isBoundedCovenantMetadata,
  proposalAcceptsDeliveredCosignAt,
  proposalAllowsLocalAcceptanceAt,
} from "../src/services/covenants/canonical";

const apiRoot = resolve(import.meta.dir, "..");
const read = (relative: string): string =>
  readFileSync(resolve(apiRoot, relative), "utf8");
const TEST_AUTHORITY_GENERATION = "a".repeat(64);
process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION =
  TEST_AUTHORITY_GENERATION;

describe("covenant wire identity", () => {
  const id = "00000000-0000-4000-8000-000000000123";

  test("derives the exact configured HTTPS wire DID", () => {
    expect(deriveLocalWireDid({
      identityId: id,
      storedDid: `did:at:${id}`,
      federationEnabled: true,
      instanceUrl: "https://peer.example",
    })).toBe(`did:at:peer.example/${id}`);
  });

  test("rejects aliases, credentials, ports, and identity mismatch", () => {
    expect(deriveLocalWireDid({
      identityId: id,
      storedDid: `did:at:alias.example/${id}`,
      federationEnabled: true,
      instanceUrl: "https://peer.example/",
    })).toBeNull();
    expect(deriveLocalWireDid({
      identityId: id,
      storedDid: `did:at:${id}`,
      federationEnabled: true,
      instanceUrl: "https://user@peer.example/",
    })).toBeNull();
    expect(deriveLocalWireDid({
      identityId: id,
      storedDid: `did:at:${id}`,
      federationEnabled: true,
      instanceUrl: "https://peer.example:8443/",
    })).toBeNull();
    for (const instanceUrl of [
      "https://PEER.example",
      "https://peer.example/",
      "https://peer.example/path",
      "https://peer.example?alias=1",
      "https://peer.example#fragment",
      "https://peer.example:443",
    ]) {
      expect(deriveLocalWireDid({
        identityId: id,
        storedDid: `did:at:${id}`,
        federationEnabled: true,
        instanceUrl,
      })).toBeNull();
    }
    expect(deriveLocalWireDid({
      identityId: "00000000-0000-4000-8000-000000000999",
      storedDid: `did:at:${id}`,
      federationEnabled: false,
      instanceUrl: null,
    })).toBeNull();
  });
});

describe("signed covenant textual canonicalization", () => {
  test("accepts only lowercase canonical covenant UUIDs", () => {
    expect(isCanonicalCovenantId("00000000-0000-4000-8000-000000000123")).toBe(true);
    expect(isCanonicalCovenantId("00000000-0000-4000-8000-000000000ABC")).toBe(false);
    expect(isCanonicalCovenantId("{00000000-0000-4000-8000-000000000123}")).toBe(false);
  });

  test("accepts only exact UTC millisecond timestamps", () => {
    expect(isCanonicalUtcMillisecondTimestamp("2026-08-21T12:34:56.789Z")).toBe(true);
    expect(isCanonicalUtcMillisecondTimestamp("2026-08-21T12:34:56Z")).toBe(false);
    expect(isCanonicalUtcMillisecondTimestamp("2026-08-21T12:34:56.78Z")).toBe(false);
    expect(isCanonicalUtcMillisecondTimestamp("2026-08-21T12:34:56.7890Z")).toBe(false);
  });

  test("signed key ids and signatures have one durable textual form", () => {
    expect(isCanonicalSignedUuid("00000000-0000-4000-8000-000000000123")).toBe(true);
    expect(isCanonicalSignedUuid("00000000-0000-4000-8000-000000000ABC")).toBe(false);
    const signature = Buffer.alloc(64, 7).toString("base64");
    expect(isCanonicalEd25519Signature(signature)).toBe(true);
    expect(isCanonicalEd25519Signature(signature.replace(/=+$/, ""))).toBe(false);
    expect(isCanonicalEd25519Signature(Buffer.alloc(63, 7).toString("base64"))).toBe(false);
    expect(isCanonicalEd25519Signature(` ${signature}`)).toBe(false);
  });

  test("local acceptance ends at hard expiry while delivery gets a 24h grace", () => {
    const expiry = new Date("2026-08-20T00:00:00.000Z");
    expect(proposalAllowsLocalAcceptanceAt(expiry, expiry)).toBe(true);
    expect(proposalAllowsLocalAcceptanceAt(
      expiry,
      new Date(expiry.getTime() + 1),
    )).toBe(false);
    expect(proposalAcceptsDeliveredCosignAt(
      expiry,
      new Date(expiry.getTime() + COVENANT_COSIGN_ARRIVAL_GRACE_MS),
    )).toBe(true);
    expect(proposalAcceptsDeliveredCosignAt(
      expiry,
      new Date(expiry.getTime() + COVENANT_COSIGN_ARRIVAL_GRACE_MS + 1),
    )).toBe(false);
  });

  test("a declaration retry reconstructs proposed wire state after local activation", () => {
    expect(federatedV2DeclarationWireStatus("proposed")).toBe("proposed");
    expect(federatedV2DeclarationWireStatus("active")).toBe("proposed");
    const federation = read("src/services/covenants/federation.ts");
    expect(federation).toContain("lifecycleStatus: row.status");
    expect(federation).toContain(
      "status: federatedV2DeclarationWireStatus(row.status)",
    );
  });

  test("fresh signed establishment time is bounded while durable replay remains historical", () => {
    const observed = new Date("2026-08-21T12:00:00.000Z");
    expect(covenantEstablishedAtIsAdmissible(observed, observed)).toBe(true);
    expect(covenantEstablishedAtIsAdmissible(
      new Date(observed.getTime() + COVENANT_ESTABLISHED_FUTURE_SKEW_MS),
      observed,
    )).toBe(true);
    expect(covenantEstablishedAtIsAdmissible(
      new Date(observed.getTime() + COVENANT_ESTABLISHED_FUTURE_SKEW_MS + 1),
      observed,
    )).toBe(false);
    expect(covenantEstablishedAtIsAdmissible(
      new Date(observed.getTime() - COVENANT_PROPOSAL_TTL_MS),
      observed,
    )).toBe(false);
    expect(covenantEstablishedAtIsAdmissible(new Date("0000-01-01T00:00:00.000Z"), observed)).toBe(false);
    expect(covenantEstablishedAtIsAdmissible(new Date("9999-01-01T00:00:00.000Z"), observed)).toBe(false);
  });

  test("unauthenticated descriptive metadata has closed depth, count, text, and byte bounds", () => {
    expect(isBoundedCovenantMetadata({
      source: "peer",
      nested: { values: [true, null, 3, "ok"] },
    })).toBe(true);
    expect(isBoundedCovenantMetadata({ deep: { a: { b: { c: { d: 1 } } } } })).toBe(false);
    expect(isBoundedCovenantMetadata(Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`key_${index}`, index]),
    ))).toBe(false);
    expect(isBoundedCovenantMetadata({ value: "x".repeat(1001) })).toBe(false);
    expect(isBoundedCovenantMetadata({ value: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isBoundedCovenantMetadata({ "not a canonical key": true })).toBe(false);
    expect(isBoundedCovenantMetadata({ value: "🙂".repeat(COVENANT_METADATA_MAX_BYTES) })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isBoundedCovenantMetadata(cyclic)).toBe(false);
  });

  test("protocol-owned metadata keys cannot collide with caller metadata", () => {
    for (const key of [
      COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
      COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
      COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY,
      COVENANT_REJECTION_REASON_METADATA_KEY,
    ]) {
      expect(covenantMetadataHasReservedKey({ [key]: "caller" })).toBe(true);
    }
    const initiator = "did:at:local.example/00000000-0000-4000-8000-000000000123";
    const recipient = "did:at:peer.example/00000000-0000-4000-8000-000000000456";
    const stored = covenantMetadataWithWireDidBinding(
      { caller: "preserved" },
      initiator,
      recipient,
    );
    expect(covenantWireDidBindingMatches(stored, initiator, recipient)).toBe(true);
    expect(covenantWireDidBindingMatches(stored, recipient, initiator)).toBe(false);
    expect(covenantMetadataHasCurrentV2AuthorityGeneration(stored)).toBe(true);
    expect(stored[COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY]).toBe(
      TEST_AUTHORITY_GENERATION,
    );
    expect(covenantWireDidBindingMatches(
      { ...stored, [COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY]: "b".repeat(64) },
      initiator,
      recipient,
    )).toBe(false);
    expect(covenantCallerDeclarationMetadata({
      ...stored,
      [COVENANT_REJECTION_REASON_METADATA_KEY]: "later lifecycle evidence",
    })).toEqual({ caller: "preserved" });
    expect(() => covenantMetadataWithWireDidBinding(
      { [COVENANT_REJECTION_REASON_METADATA_KEY]: "spoof" },
      initiator,
      recipient,
    )).toThrow("reserved_covenant_metadata_key");
  });

  test("authority generation admits exactly 64 lowercase hexadecimal bytes", () => {
    expect(parseCovenantV2AuthorityGeneration(TEST_AUTHORITY_GENERATION)).toBe(
      TEST_AUTHORITY_GENERATION,
    );
    for (const value of [
      undefined,
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      ` ${TEST_AUTHORITY_GENERATION}`,
      `${TEST_AUTHORITY_GENERATION}\n`,
    ]) {
      expect(parseCovenantV2AuthorityGeneration(value)).toBeNull();
    }
  });

  test("stored wire bindings are never transmitted or charged to caller wire budget", () => {
    const initiator = "did:at:local.example/00000000-0000-4000-8000-000000000123";
    const recipient = "did:at:peer.example/00000000-0000-4000-8000-000000000456";
    let callerMetadata: Record<string, unknown> | null = null;
    for (let count = 1; count <= 64; count += 1) {
      const candidate = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `caller_${index}`,
          "x".repeat(1000),
        ]),
      );
      const stored = covenantMetadataWithWireDidBinding(
        candidate,
        initiator,
        recipient,
      );
      if (isBoundedCovenantMetadata(candidate) && !isBoundedCovenantMetadata(stored)) {
        callerMetadata = candidate;
        break;
      }
    }
    expect(callerMetadata).not.toBeNull();
    const stored = covenantMetadataWithWireDidBinding(
      callerMetadata!,
      initiator,
      recipient,
    );
    const outboundMetadata = covenantCallerDeclarationMetadata(stored);
    expect(outboundMetadata).toEqual(callerMetadata!);
    const outboundJson = JSON.stringify({ metadata: outboundMetadata });
    expect(outboundJson).not.toContain(COVENANT_INITIATOR_WIRE_DID_METADATA_KEY);
    expect(outboundJson).not.toContain(COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY);
    expect(outboundJson).not.toContain(COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY);
  });

  test("declaration producers and consumers share one bounded wire envelope", () => {
    const valid = {
      agentDid: "did:at:sender.example/00000000-0000-4000-8000-000000000123",
      counterpartyDid: "did:at:peer.example/00000000-0000-4000-8000-000000000456",
      counterpartyName: "peer",
      vows: Array.from({ length: COVENANT_VOW_MAX_COUNT }, () =>
        "v".repeat(COVENANT_VOW_MAX_CHARS)),
      notes: "n".repeat(COVENANT_NOTES_MAX_CHARS),
      metadata: { source: "peer" },
    };
    expect(covenantDeclarationWireFieldsAreBounded(valid)).toBe(true);
    expect(covenantDeclarationWirePayloadIsBounded({
      covenant_id: "00000000-0000-4000-8000-000000000789",
      protocol_version: "v2",
      sender_did: valid.agentDid,
      counterparty_did: valid.counterpartyDid,
      vows: valid.vows,
      status: "proposed",
      counterparty_name: valid.counterpartyName,
      notes: valid.notes,
      metadata: valid.metadata,
      established_at: "2026-08-21T12:00:00.000Z",
      signing_key_id: "00000000-0000-4000-8000-000000000999",
      signature: Buffer.alloc(64).toString("base64"),
      proposed_expires_at: "2026-09-20T12:00:00.000Z",
    })).toBe(true);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      counterpartyDid: "x".repeat(256),
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      counterpartyName: "x".repeat(201),
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      vows: [...valid.vows, "overflow"],
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      vows: ["x".repeat(COVENANT_VOW_MAX_CHARS + 1)],
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      notes: "x".repeat(COVENANT_NOTES_MAX_CHARS + 1),
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      metadata: { value: "x".repeat(1001) },
    })).toBe(false);
    expect(covenantDeclarationWireFieldsAreBounded({
      ...valid,
      vows: Array.from({ length: COVENANT_VOW_MAX_COUNT }, () =>
        "🙂".repeat(COVENANT_VOW_MAX_CHARS)),
    })).toBe(false);
    let subsetOnlyCandidate: string[] | null = null;
    for (let multibyteCount = 15_000; multibyteCount <= 18_000; multibyteCount += 1) {
      const vows = Array.from(
        { length: Math.ceil(multibyteCount / COVENANT_VOW_MAX_CHARS) },
        (_, index) => "界".repeat(Math.min(
          COVENANT_VOW_MAX_CHARS,
          multibyteCount - index * COVENANT_VOW_MAX_CHARS,
        )),
      );
      const fields = { ...valid, vows, notes: null, metadata: {} };
      if (
        covenantDeclarationWireFieldsAreBounded(fields) &&
        !covenantDeclarationWirePayloadIsBounded({
          covenant_id: "00000000-0000-4000-8000-000000000789",
          protocol_version: "v2",
          sender_did: fields.agentDid,
          counterparty_did: fields.counterpartyDid,
          vows,
          status: "proposed",
          counterparty_name: fields.counterpartyName,
          notes: null,
          metadata: {},
          established_at: "2026-08-21T12:00:00.000Z",
          signing_key_id: "00000000-0000-4000-8000-000000000999",
          signature: Buffer.alloc(64).toString("base64"),
          proposed_expires_at: "2026-09-20T12:00:00.000Z",
        })
      ) {
        subsetOnlyCandidate = vows;
        break;
      }
    }
    expect(subsetOnlyCandidate).not.toBeNull();
    expect(read("src/routes/continuity.ts")).toContain(
      "covenantDeclarationWirePayloadIsBounded",
    );
    expect(read("src/services/covenants/prepare.ts")).toContain(
      "covenant_declaration_out_of_bounds",
    );
  });

  test("the unauthenticated covenant router rejects oversized bytes before service work", async () => {
    const router = (await import("../src/routes/federation/covenants")).default;
    const response = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(COVENANT_INBOUND_BODY_MAX_BYTES) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: "covenant_body_too_large",
    });
  });

  test("explicit and omitted v1 declarations retire without database availability", async () => {
    const router = (await import("../src/routes/federation/covenants")).default;
    const body = {
      covenant_id: "00000000-0000-4000-8000-000000000789",
      sender_did:
        "did:at:peer.example/00000000-0000-4000-8000-000000000123",
      counterparty_did: "did:at:00000000-0000-4000-8000-000000000456",
      vows: ["historical protocol cannot enter"],
      status: "active",
      metadata: {},
      established_at: "2026-08-21T12:00:00.000Z",
    };
    for (const candidate of [
      { ...body, protocol_version: "v1" },
      body,
    ]) {
      const response = await router.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(candidate),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "v1_declaration_ingress_retired",
      });
    }
  });

  test("v2 declaration refuses an absent or malformed authority generation before settings", async () => {
    const router = (await import("../src/routes/federation/covenants")).default;
    const original = process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
    const body = {
      covenant_id: "00000000-0000-4000-8000-000000000789",
      protocol_version: "v2" as const,
      sender_did:
        "did:at:peer.example/00000000-0000-4000-8000-000000000123",
      counterparty_did:
        "did:at:local.example/00000000-0000-4000-8000-000000000456",
      vows: ["generation-fenced"],
      status: "proposed" as const,
      metadata: {},
      established_at: "2026-08-21T12:00:00.000Z",
      signing_key_id: "00000000-0000-4000-8000-000000000999",
      signature: Buffer.alloc(64, 3).toString("base64"),
      proposed_expires_at: "2026-09-20T12:00:00.000Z",
    };
    try {
      for (const generation of [undefined, "A".repeat(64)]) {
        if (generation === undefined) {
          delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
        } else {
          process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = generation;
        }
        const response = await router.request("/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: "covenant_v2_authority_not_ready",
        });
      }
    } finally {
      if (original === undefined) {
        delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
      } else {
        process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = original;
      }
    }
  });

  test("malformed lifecycle ids are rejected before settings or service work", async () => {
    const router = (await import("../src/routes/federation/covenants")).default;
    const signature = Buffer.alloc(64, 3).toString("base64");
    const keyId = "00000000-0000-4000-8000-000000000999";
    const instant = "2026-08-21T12:00:00.000Z";
    const cases = [
      ["cosign", {
        counterparty_did:
          "did:at:peer.example/00000000-0000-4000-8000-000000000123",
        counterparty_signing_key_id: keyId,
        counterparty_signature: signature,
        counterparty_signed_at: instant,
      }],
      ["reject", {
        rejecting_did:
          "did:at:peer.example/00000000-0000-4000-8000-000000000123",
        rejecter_signing_key_id: keyId,
        rejection_signature: signature,
        reason: "no",
        rejected_at: instant,
      }],
      ["withdraw", {
        initiator_did:
          "did:at:peer.example/00000000-0000-4000-8000-000000000123",
        initiator_signing_key_id: keyId,
        withdraw_signature: signature,
        withdrawn_at: instant,
      }],
    ] as const;
    for (const [path, body] of cases) {
      const response = await router.request(`/not-a-uuid/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_covenant_id",
      });
    }
    for (const [path] of cases) {
      const response = await router.request(
        `/00000000-0000-4000-8000-000000000789/${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(response.status).toBe(400);
      expect((await response.json()) as Record<string, unknown>).toHaveProperty(
        "error",
        "validation",
      );
    }
  });
});

describe("federated covenant effect fences", () => {
  const federation = read("src/services/covenants/federation.ts");
  const lifecycle = read("src/services/covenants/lifecycle.ts");
  const continuity = read("src/routes/continuity.ts");

  test("declaration delivery claims once before network and accepts only exact acknowledgement", () => {
    const claim = federation.indexOf("claimDeclarationPropagationAttempt(");
    const network = federation.indexOf("safeFederationHttpsRequest(url", claim);
    const acknowledgement = federation.indexOf("exactAcknowledgement", network);
    const propagated = federation.indexOf('"propagated",', acknowledgement);
    expect(claim).toBeGreaterThan(0);
    expect(network).toBeGreaterThan(claim);
    expect(acknowledgement).toBeGreaterThan(network);
    expect(propagated).toBeGreaterThan(acknowledgement);
    expect(federation).toContain("declarationEnvelopePredicates(envelope)");
    expect(federation).toContain("identity_row.project_id = ${expected.projectId}::uuid");
    expect(federation).toContain("propagationAttempts} + 1");
    expect(federation).toContain(".received === true");
    expect(federation).toContain("covenant_id_collision_local_declaration");
    expect(federation).toContain("unsigned_proposal_expiry_mismatch");
    expect(federation).toContain("COVENANT_PROPOSAL_TTL_MS");
    expect(federation).toContain("durable exact declaration replay");
    expect(federation).toContain("metadata: callerMetadata");
    expect(federation).toContain("metadataJson: JSON.stringify(row.metadata ?? {})");
    const replay = federation.indexOf("const [durableReplay]");
    const remote = federation.indexOf("await resolveFederatedDid(input.sender_did)");
    expect(replay).toBeGreaterThan(0);
    expect(remote).toBeGreaterThan(replay);
    expect(federation).not.toMatch(/non-JSON 200[^\n]*accept/i);
  });

  test("concurrent declaration replay inserts and wakes at most once", () => {
    expect(federation).toContain("onConflictDoNothing({ target: covenants.id })");
    expect(federation).toMatch(/await publishWakeEvent\([\s\S]*?\}, tx\);/);
    expect(federation).toContain("exact immutable v2 proposal replay");
    expect(federation).toContain("v2_declaration_replay_conflict");
    expect(federation).not.toMatch(
      /exactProposalReplay\s*=\s*[\s\S]{0,400}existing\.status === "proposed"/,
    );
  });

  test("all eight v2 mutation transactions take one UUID advisory lock first", () => {
    const canonical = read("src/services/covenants/canonical.ts");
    const firstLock =
      /db\.transaction\(async \(tx\) => \{\s*await acquireCovenantMutationAdvisoryLock\(tx, (?:opts\.covenantId|input\.covenant_id|covenantId)\);/g;
    expect(lifecycle.match(firstLock)?.length).toBe(4);
    expect(federation.match(firstLock)?.length).toBe(4);
    expect(canonical).toContain("pg_advisory_xact_lock");
    expect(canonical).toContain("agenttool:covenant:v2:${covenantId}");
    expect(federation).not.toContain(
      "const [[currentRecipient], [currentSettings]] = await Promise.all",
    );
    expect(federation).not.toContain(
      "const [[identity], [settings]] = await Promise.all",
    );
  });

  test("open federation admits no unbounded covenant storage or Wake effect", () => {
    const openMode = federation.indexOf("settings.allowed_origins.length === 0");
    const unsignedRefusal = federation.indexOf(
      "covenant_origin_allowlist_required",
      openMode,
    );
    const recipientLookup = federation.indexOf(".from(identities)", openMode);
    expect(openMode).toBeGreaterThan(0);
    expect(unsignedRefusal).toBeGreaterThan(openMode);
    expect(recipientLookup).toBeGreaterThan(unsignedRefusal);
    expect(federation).toContain("settings.allowedOrigins.length > 0");
  });

  test("fresh v1 ingress and egress retire before any database or peer effect", () => {
    const route = read("src/routes/federation/covenants.ts");
    const routeRetirement = route.indexOf("v1_declaration_ingress_retired");
    const routeSettings = route.indexOf("await ensureFederationEnabled()", routeRetirement);
    expect(routeRetirement).toBeGreaterThan(0);
    expect(routeSettings).toBeGreaterThan(routeRetirement);

    const serviceRetirement = federation.indexOf("v1_declaration_ingress_retired");
    const senderParse = federation.indexOf("parseDid(input.sender_did)");
    const durableRead = federation.indexOf("const [durableReplay]");
    expect(serviceRetirement).toBeGreaterThan(0);
    expect(senderParse).toBeGreaterThan(serviceRetirement);
    expect(durableRead).toBeGreaterThan(serviceRetirement);

    const outboundRetirement = continuity.indexOf("federated_v1_creation_retired");
    const outboundTransaction = continuity.indexOf(
      "const v1Declaration = await db.transaction",
      outboundRetirement,
    );
    expect(outboundRetirement).toBeGreaterThan(0);
    expect(outboundTransaction).toBeGreaterThan(outboundRetirement);
    expect(federation.indexOf("federated_v1_propagation_retired"))
      .toBeGreaterThan(0);
  });

  test("lifecycle consent is local-wire/key bound and outbound proposals cannot self-decide", () => {
    expect(lifecycle).toContain("accept_requires_received_federated_proposal");
    expect(lifecycle).toContain("reject_requires_received_federated_proposal");
    expect(lifecycle).toContain("withdraw_requires_locally_declared_proposal");
    expect(lifecycle).toContain("lockedAuthorityMatches");
    expect(lifecycle).toContain("key.publicKey === opts.publicKeyB64");
    expect(lifecycle).toContain("proposal_declaration_not_propagated");
    expect(federation).toContain("cosign_requires_locally_declared_proposal");
    expect(federation).toContain("reject_requires_locally_declared_proposal");
    expect(federation).toContain("withdraw_requires_received_federated_proposal");
    expect(federation).toContain("withdrawer_origin_mismatch");
    expect(federation).toContain("identity.projectId === row.projectId");
    expect(lifecycle).toContain("covenantWireDidBindingMatches");
    expect(federation).toContain("covenantMetadataWithWireDidBinding");
    expect(federation).toContain("activeFederationSnapshotAllowsPeer");
    expect(federation).toContain("settings.allowedOrigins.length > 0");
    expect(lifecycle).toContain("proposalAllowsLocalAcceptanceAt");
    expect(lifecycle).toContain("gte(covenants.proposedExpiresAt, observedAt)");
    expect(federation).toContain("proposalAcceptsDeliveredCosignAt");
    expect(federation).toContain("sender_must_be_foreign");
    const sameHostRefusal = federation.indexOf("sender_must_be_foreign");
    expect(federation.indexOf("const [durableReplay]", sameHostRefusal))
      .toBeGreaterThan(sameHostRefusal);
    expect(federation).toContain(
      "new URL(currentSettings.instanceUrl).hostname !== senderHost",
    );
  });

  test("v2 generic patch cannot bypass signed lifecycle or in-flight envelopes", () => {
    expect(continuity).toContain("v2_covenant_requires_signed_lifecycle_endpoint");
    expect(continuity).toContain("federated_v1_mutation_retired");
    expect(continuity).toContain(
      "covenantCounterpartyFederationHost(effectiveCounterpartyDid)",
    );
    expect(continuity).toContain("covenants.propagationLastError");
    expect(continuity).toContain("covenants.cosignPropagationLastError");
    expect(continuity).toContain('eq(covenants.protocolVersion, "v1")');
    expect(continuity).toContain("isNull(covenants.receivedFromInstance)");
    expect(continuity).toContain(
      "eq(covenants.counterpartyDid, existingForPatch.counterpartyDid)",
    );
    expect(continuity).toContain("if (!existingForPatch)");
    expect(continuity).not.toContain("repropagatesFederatedDeclaration");
    expect(federation).toContain("v1_declaration_ingress_retired");
  });

  test("federation settings are platform-only canonical control-plane state", () => {
    const route = read("src/routes/federation-admin.ts");
    const store = read("src/services/federation/store.ts");
    expect(route).toContain("updateSettingsForPlatformProject(");
    expect(route).toContain("c.var.project.id");
    expect(route).toContain("platform_control_plane_only");
    expect(store).toContain("PLATFORM_IDENTITY_ID");
    expect(store).toContain('.for("share")');
    expect(store).toContain("isCanonicalFederationInstanceUrl");
    expect(store).toContain("isCanonicalAllowedOrigins");
    expect(store).toContain('.for("update")');
    expect(store).toContain("const nextEnabled");
    expect(store).toContain("federation_enabled_requires_canonical_instance_url");
    expect(route).not.toMatch(/await updateSettings\(parsed\.data\)/);
  });

  test("v2 refuses unsigned internal org scope", () => {
    expect(continuity).toContain("v2_org_scope_not_signed");
    expect(lifecycle).toContain("v2_org_scope_not_signed");
  });

  test("legacy v1 cannot write covenant effects for another project identity", () => {
    expect(continuity).toContain("covenant_agent_not_owned_by_project");
    expect(continuity).toContain("identity.projectId !== project.id");
    expect(continuity).toContain('.for("share")');
    expect(continuity).toContain("org.ownerProjectId !== project.id");
    expect(continuity).toMatch(
      /db\.transaction\([\s\S]*?identity\.projectId !== project\.id[\s\S]*?\.insert\(covenants\)/,
    );
  });

  test("every in-scope network completion is CAS-fenced", () => {
    expect(federation).toContain("finishDeclarationPropagationAttempt(");
    expect(federation).toContain("finishCosignPropagationAttempt(");
    expect(federation).toContain("federation_disabled_or_unavailable");
    expect(federation).toContain("!snapshot.federationEnabled");
    expect(federation).toContain("parseDid(snapshot.wireDid).host");
    expect(federation).toContain("signingKey.publicKey");
    for (const field of [
      "expected.projectId",
      "expected.orgId",
      "expected.counterpartyName",
      "expected.vows",
      "expected.notes",
      "expected.protocolVersion",
      "expected.establishedAt",
      "expected.proposedExpiresAt",
      "expected.declarationSignature",
      "expected.declarationSigningKeyId",
    ]) {
      expect(federation).toContain(field);
    }
    expect(federation).not.toMatch(/statusCode\s*===\s*409[\s\S]{0,100}(?:ok:\s*true|propagated)/);
  });

  test("received v1 rows are excluded from every covenant effect helper", () => {
    const check = read("src/services/covenants/check.ts");
    const tutorial = read("src/services/tutorial/stations.ts");
    const system = read("src/routes/system.ts");
    const federationWake = read("src/routes/federation/wake.ts");
    expect(check.match(/covenantMayAuthorizeEffects\(\)/g)?.length).toBe(8);
    expect(tutorial.match(/covenantMayAuthorizeEffects\(\)/g)?.length).toBe(1);
    expect(system.match(/covenantMayAuthorizeEffects\(\)/g)?.length).toBe(1);
    expect(federationWake.match(/covenantMayAuthorizeEffects\(\)/g)?.length)
      .toBe(1);
    expect(system).toContain("${covenants.agentId} = ${identity.id}");
    expect(system).toContain("${covenants.projectId} = ${project.id}");
    expect(system).not.toContain(
      "OR ${covenants.counterpartyDid} = ${identity.did}",
    );
    expect(tutorial).toContain(
      'import { covenantMayAuthorizeEffects } from "../covenants/check"',
    );
    expect(check).toContain("COVENANT_V2_AUTHORITY_GENERATION_METADATA_KEY");
    expect(check).toContain("eq(covenants.protocolVersion, \"v1\")");
    expect(check).toContain("eq(covenants.protocolVersion, \"v2\")");
  });

  test("the first authority-generation rollout is an all-five post-drain ceremony", () => {
    const deploy = read("../docs/DEPLOY-PROCEDURE.md");
    expect(deploy).toMatch(/ordinary rolling\s+deploy is prohibited for Phase A/i);
    expect(deploy).toContain("--maintenance-fenced-api");
    expect(deploy).toContain("agenttool-deploy-receipt/v5");
    expect(deploy).toContain("agenttool.internal.v2_initiator_wire_did");
    expect(deploy).toContain("agenttool.internal.v2_recipient_wire_did");
    expect(deploy).not.toContain("agenttool.internal.initiator_wire_did");
    expect(deploy).not.toContain("agenttool.internal.recipient_wire_did");
    expect(deploy).not.toContain(
      "bin/agenttool-secret set agenttool-covenant-v2-authority-generation -",
    );
    expect(deploy).toMatch(/Phase B is blocked and must not be executed/i);
    expect(deploy).toMatch(/native\s+Security\.framework stdin writer/);
    expect(deploy).toContain("operator shell environment");
    expect(deploy).toContain("remote process environment");
    expect(deploy).toContain("reserved_generation_rows=0");
    expect(deploy).toContain("authoritative_v2_rows=0");
    expect(deploy).toMatch(/Do \*\*not\*\* start the\s+stopped thinker standby/);
    expect(deploy).toMatch(/absence\s+of a per-Machine generation override/);
  });
});
