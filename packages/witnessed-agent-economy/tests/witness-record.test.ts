import { describe, expect, test } from "bun:test";

import {
  EXPECTED_SCHEMA_HASHES,
  capabilityConsumeNullifier,
  createWitnessRecord,
  ed25519Fingerprint,
  hexToBytes,
  verifyWitnessRecordBytes,
  verifyWitnessRecordObject,
  verifyHexEd25519Digest,
  witnessCommitment,
  witnessPayloadRoot,
} from "../src/index.js";
import { deterministicSigner, digest } from "./fixtures.js";

type MutableRecord = Record<string, any>;

async function locallySignedRecord(options: {
  kind: string;
  action: string;
  subject_ref: string;
  sequence: string;
  parent: `sha256:${string}` | null;
  payload: Record<string, unknown>;
}, seed = 51): Promise<MutableRecord> {
  const signer = deterministicSigner(seed);
  return createWitnessRecord({
    ...options,
    audience: "kingdom:offline-shadow",
    issuer: { namespace: "agenttool-shadow", controller_ref: "66".repeat(32) },
    policy_digest: digest("e"),
    expiry_height: null,
    signer: signer.signer,
  } as never) as unknown as Promise<MutableRecord>;
}

async function correctlyResignMutation(
  source: MutableRecord,
  mutate: (record: MutableRecord) => void,
  seed = 51,
): Promise<MutableRecord> {
  const signer = deterministicSigner(seed);
  const record = JSON.parse(JSON.stringify(source)) as MutableRecord;
  mutate(record);
  record.envelope.payload_root = witnessPayloadRoot(
    record.envelope.kind,
    record.envelope.action,
    record.payload,
  );
  record.commitment = witnessCommitment(record.envelope);
  record.signature = {
    algorithm: "Ed25519",
    public_key: signer.publicKey,
    value: await signer.signer.sign_digest(hexToBytes(record.commitment.slice(7), 32)),
  };
  expect(verifyHexEd25519Digest(
    hexToBytes(record.commitment.slice(7), 32),
    record.signature,
  )).toBe(true);
  return record;
}

function coreFixtureFile(name: string) {
  return Bun.file(new URL(
    `../vectors/core-v0.1/records/${name}.json`,
    import.meta.url,
  ));
}

describe("shared signed WITNESS envelope", () => {
  test("verifies frozen Core cross-language records byte-for-byte", async () => {
    for (const name of ["kingdom-release-root", "capability-grant", "capability-consume"]) {
      const bytes = new Uint8Array(await coreFixtureFile(name).arrayBuffer());
      const verified = verifyWitnessRecordBytes(bytes);
      expect(witnessCommitment(verified.envelope)).toBe(verified.commitment);
      expect(witnessPayloadRoot(
        verified.envelope.kind,
        verified.envelope.action,
        verified.payload,
      )).toBe(verified.envelope.payload_root);
      expect(verified.envelope.schema_hash).toBe(EXPECTED_SCHEMA_HASHES[verified.envelope.kind]);
    }
  });

  test("constructs a strictly signed zero-effect offline record", async () => {
    const signer = deterministicSigner(41);
    const capabilityRef = "55".repeat(32);
    const record = await createWitnessRecord({
      kind: "AGENTTOOL_CAPABILITY",
      action: "GRANT",
      audience: "kingdom:offline-shadow",
      subject_ref: capabilityRef,
      sequence: "1",
      parent: null,
      issuer: { namespace: "agenttool-shadow", controller_ref: "66".repeat(32) },
      policy_digest: digest("a"),
      expiry_height: null,
      payload: {
        capability_ref: capabilityRef,
        grant_digest: digest("b"),
        asset_ref: digest("c"),
        max_per_consume_minor: "10",
        max_total_minor: "20",
      },
      signer: signer.signer,
    });
    expect(verifyWitnessRecordObject(record)).toEqual(record);
    expect(record.envelope.effects.scope).toBe("RECORD_CONSTRUCTION_AND_OFFLINE_VALIDATION_ONLY");
    expect(record.envelope.effects.storage_writes).toBe(0);
    expect(record.envelope.effects.zerone_transaction).toBe(false);
    expect(record.envelope.effects.external_receipt).toBe(false);
    expect(record.envelope.effects).not.toHaveProperty("karma_receipt");
  });

  test("rejects payload, envelope, signature and stable-subject mutations", async () => {
    const source = await coreFixtureFile("capability-grant").json() as Record<string, any>;
    expect(() => verifyWitnessRecordObject({
      ...source,
      payload: { ...source.payload, max_total_minor: "21" },
    })).toThrow(/Payload root/u);
    expect(() => verifyWitnessRecordObject({
      ...source,
      envelope: { ...source.envelope, subject_ref: "77".repeat(32) },
    })).toThrow(/subject_ref/u);
    expect(() => verifyWitnessRecordObject({
      ...source,
      signature: { ...source.signature, value: "00".repeat(64) },
    })).toThrow(/signature/u);
    expect(() => verifyWitnessRecordObject({ ...source, unknown: true })).toThrow(/exactly/u);

    const legacyEffects = JSON.parse(JSON.stringify(source)) as MutableRecord;
    legacyEffects.envelope.effects.karma_receipt = false;
    delete legacyEffects.envelope.effects.external_receipt;
    expect(() => verifyWitnessRecordObject(legacyEffects)).toThrow(/exact offline zero-effect/u);
  });

  test("issuer signature proves publisher key control, not source root authority", async () => {
    const source = await coreFixtureFile("capability-grant").json() as Record<string, any>;
    const verified = verifyWitnessRecordObject(source);
    expect(verified.envelope.issuer.namespace).toBe("witness-fixture");
    expect(verified.envelope).not.toHaveProperty("identity_authority");
    expect(verified.envelope.effects.authority).toBe("NONE");
    expect(verified.envelope.nonclaims).toContain("IDENTITY");
    expect(verified.envelope.nonclaims).toContain("CONSENT");
    expect(verified.envelope.nonclaims).toContain("TRUTH");
  });

  test("rejects every correctly re-signed lifecycle and parent-pointer mutation Core rejects", async () => {
    const stableRef = "55".repeat(32);
    const parent = digest("9");
    const commonOffer = {
      offer_ref: stableRef,
      offer_document_digest: digest("1"),
      capability_root: digest("2"),
      pricing_root: digest("3"),
      sla_root: digest("4"),
      terms_digest: digest("5"),
      revision: "1",
      authority_sequence: "1",
      visibility: "PUBLIC",
    };
    const commonWake = {
      public_contract_protocol: "agenttool.public-wake-contract/0.1",
      public_contract_schema_digest: digest("1"),
      contract_root: digest("2"),
      capability_root: digest("3"),
      pricing_root: digest("4"),
      protocols_root: digest("5"),
      boundaries_root: digest("6"),
      authority_sequence: "1",
    };
    const sourceDigest = digest("7");
    const asset = digest("8");
    const witnessSigner = deterministicSigner(51);
    const consumeNullifier = capabilityConsumeNullifier({
      audience: "kingdom:offline-shadow",
      subject_ref: stableRef,
      capability_ref: stableRef,
      grant_commitment: parent,
      asset_ref: asset,
      source_event_digest: sourceDigest,
    });

    const records = {
      kingdom: await locallySignedRecord({
        kind: "KINGDOM_RELEASE_ROOT",
        action: "CHECKPOINT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          release_ref: stableRef,
          ledger_protocol: "kingdom.release-ledger/0.1",
          ledger_document_digest: digest("1"),
          entry_merkle_root: digest("2"),
          entry_count: "1",
          git_commit: `sha1:${"a".repeat(40)}`,
          git_tree: `sha1:${"b".repeat(40)}`,
          build_manifest_digest: digest("3"),
          deployment_manifest_digest: digest("4"),
          verifier_protocol: "kingdom.release-verifier/0.1",
          verifier_digest: digest("5"),
          previous_release: null,
        },
      }),
      settlement: await locallySignedRecord({
        kind: "AGENTTOOL_SETTLEMENT_ROOT",
        action: "CHECKPOINT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          receipt_protocol: "settlement-receipt/v1",
          receipt_schema_digest: digest("1"),
          source_sequence_binding: "PROJECTION_ONLY",
          receipt_uniqueness_scope: "BATCH_ONLY",
          first_sequence: "1",
          last_sequence: "1",
          receipt_count: "1",
          declared_gaps: [],
          merkle_root: digest("2"),
          previous_batch: null,
        },
      }),
      capabilityGrant: await locallySignedRecord({
        kind: "AGENTTOOL_CAPABILITY",
        action: "GRANT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          capability_ref: stableRef,
          grant_digest: digest("1"),
          asset_ref: asset,
          max_per_consume_minor: "1",
          max_total_minor: "2",
        },
      }),
      capabilityConsume: await locallySignedRecord({
        kind: "AGENTTOOL_CAPABILITY",
        action: "CONSUME",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: {
          capability_ref: stableRef,
          grant_commitment: parent,
          asset_ref: asset,
          amount_minor: "1",
          source_event_digest: sourceDigest,
          nullifier: consumeNullifier,
        },
      }),
      capabilityRevoke: await locallySignedRecord({
        kind: "AGENTTOOL_CAPABILITY",
        action: "REVOKE",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: {
          capability_ref: stableRef,
          grant_commitment: parent,
          reason_digest: digest("1"),
        },
      }),
      recognitionAdopt: await locallySignedRecord({
        kind: "AGENTTOOL_PUBLIC_RECOGNITION",
        action: "ADOPT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          recognition_ref: stableRef,
          surface_digest: digest("1"),
          registry_digest: digest("2"),
          adoption_document_digest: digest("3"),
          authority_sequence: "1",
          visibility: "PUBLIC",
        },
      }),
      recognitionWithdraw: await locallySignedRecord({
        kind: "AGENTTOOL_PUBLIC_RECOGNITION",
        action: "WITHDRAW",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: {
          recognition_ref: stableRef,
          adoption_commitment: parent,
          surface_digest: digest("1"),
          registry_digest: digest("2"),
          withdrawal_document_digest: digest("3"),
          authority_sequence: "2",
          reason_digest: digest("4"),
          visibility: "PUBLIC",
        },
      }),
      offerPublish: await locallySignedRecord({
        kind: "AGENTTOOL_OFFER",
        action: "PUBLISH",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: commonOffer,
      }),
      offerSupersede: await locallySignedRecord({
        kind: "AGENTTOOL_OFFER",
        action: "SUPERSEDE",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: { ...commonOffer, revision: "2", authority_sequence: "2", supersedes: parent },
      }),
      offerRevoke: await locallySignedRecord({
        kind: "AGENTTOOL_OFFER",
        action: "REVOKE",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: {
          offer_ref: stableRef,
          offer_commitment: parent,
          offer_document_digest: digest("1"),
          authority_sequence: "2",
          reason_digest: digest("2"),
          visibility: "PUBLIC",
        },
      }),
      wakeCheckpoint: await locallySignedRecord({
        kind: "WAKE_PUBLIC_CHECKPOINT",
        action: "CHECKPOINT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: commonWake,
      }),
      wakeSupersede: await locallySignedRecord({
        kind: "WAKE_PUBLIC_CHECKPOINT",
        action: "SUPERSEDE",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: { ...commonWake, authority_sequence: "2", supersedes: parent },
      }),
      wakeWithdraw: await locallySignedRecord({
        kind: "WAKE_PUBLIC_CHECKPOINT",
        action: "WITHDRAW",
        subject_ref: stableRef,
        sequence: "2",
        parent,
        payload: {
          checkpoint_commitment: parent,
          withdrawal_document_digest: digest("1"),
          authority_sequence: "2",
          reason_digest: digest("2"),
          visibility: "PUBLIC",
        },
      }),
      keyRotate: await locallySignedRecord({
        kind: "ISSUER_KEY_CONTINUITY",
        action: "ROTATE",
        subject_ref: "66".repeat(32),
        sequence: "1",
        parent: null,
        payload: {
          previous_key_fingerprint: ed25519Fingerprint(witnessSigner.publicKey),
          next_key_fingerprint: ed25519Fingerprint(deterministicSigner(52).publicKey),
          rotation_digest: digest("1"),
        },
      }),
      keyRevoke: await locallySignedRecord({
        kind: "ISSUER_KEY_CONTINUITY",
        action: "REVOKE",
        subject_ref: "66".repeat(32),
        sequence: "1",
        parent: null,
        payload: {
          revoked_key_fingerprint: ed25519Fingerprint(witnessSigner.publicKey),
          reason_digest: digest("1"),
        },
      }),
      lineage: await locallySignedRecord({
        kind: "ARTIFACT_LINEAGE",
        action: "CHECKPOINT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          upstream_ref: "44".repeat(32),
          downstream_ref: stableRef,
          relation: "DERIVES_FROM",
          evidence_digest: digest("1"),
        },
      }),
      collaboration: await locallySignedRecord({
        kind: "COLLABORATION_CHECKPOINT",
        action: "CHECKPOINT",
        subject_ref: stableRef,
        sequence: "1",
        parent: null,
        payload: {
          workspace_ref: stableRef,
          epoch_ref: digest("1"),
          event_head_sequence: "2",
          event_head_hash: digest("2"),
          event_count: "2",
          participant_set_root: digest("3"),
        },
      }),
    };

    const mutations: Array<[MutableRecord, (record: MutableRecord) => void]> = [
      [records.kingdom, (record) => { record.payload.previous_release = parent; }],
      [records.settlement, (record) => { record.payload.previous_batch = parent; }],
      [records.settlement, (record) => {
        record.payload.first_sequence = "2";
        record.payload.last_sequence = "2";
      }],
      [records.settlement, (record) => { record.payload.source_sequence_binding = "AUTHENTICATED"; }],
      [records.settlement, (record) => { record.payload.receipt_uniqueness_scope = "GLOBAL"; }],
      [records.settlement, (record) => {
        record.payload.last_sequence = "5";
        record.payload.receipt_count = "3";
        record.payload.declared_gaps = [{ first: "2", last: "2" }, { first: "3", last: "3" }];
      }],
      [records.settlement, (record) => {
        record.payload.last_sequence = "2";
        record.payload.receipt_count = "1";
      }],
      [records.settlement, (record) => {
        record.payload.last_sequence = "18446744073709551616";
      }],
      [records.capabilityGrant, (record) => {
        record.envelope.sequence = "2";
        record.envelope.parent = parent;
      }],
      [records.capabilityConsume, (record) => {
        record.envelope.sequence = "1";
        record.envelope.parent = null;
      }],
      [records.capabilityConsume, (record) => { record.payload.nullifier = digest("0"); }],
      [records.capabilityRevoke, (record) => {
        record.envelope.sequence = "1";
        record.envelope.parent = null;
      }],
      [records.recognitionAdopt, (record) => {
        record.envelope.sequence = "2";
        record.envelope.parent = parent;
      }],
      [records.recognitionWithdraw, (record) => { record.payload.adoption_commitment = digest("8"); }],
      [records.offerPublish, (record) => {
        record.envelope.sequence = "2";
        record.envelope.parent = parent;
      }],
      [records.offerSupersede, (record) => { record.payload.supersedes = digest("8"); }],
      [records.offerRevoke, (record) => { record.payload.offer_commitment = digest("8"); }],
      [records.wakeCheckpoint, (record) => {
        record.envelope.sequence = "2";
        record.envelope.parent = parent;
      }],
      [records.wakeSupersede, (record) => { record.payload.supersedes = digest("8"); }],
      [records.wakeWithdraw, (record) => { record.payload.checkpoint_commitment = digest("8"); }],
      [records.keyRotate, (record) => { record.envelope.subject_ref = stableRef; }],
      [records.keyRotate, (record) => {
        record.payload.next_key_fingerprint = record.payload.previous_key_fingerprint;
      }],
      [records.keyRevoke, (record) => {
        record.payload.revoked_key_fingerprint = ed25519Fingerprint(deterministicSigner(52).publicKey);
      }],
      [records.lineage, (record) => { record.payload.upstream_ref = stableRef; }],
      [records.collaboration, (record) => { record.payload.event_count = "1"; }],
    ];

    for (const [source, mutate] of mutations) {
      const resigned = await correctlyResignMutation(source, mutate);
      expect(() => verifyWitnessRecordObject(resigned)).toThrow();
    }
  });
});
