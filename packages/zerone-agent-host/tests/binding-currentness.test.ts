import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
} from "@agenttool/wallet";
import {
  HASH_DOMAINS,
  assertVerifiedWalletIdentityBindingProof,
  createWalletIdentityBinding,
  domainSeparatedId,
  type WalletIdentityBindingProofCore,
  type WalletIdentityBindingProofEnvelope,
} from "@agenttool/zerone-agent-economy";
import {
  zeroneAccountId,
  zeroneAddressFromSecp256k1PublicKey,
} from "@agenttool/wallet-zerone";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createBindingCurrentnessAssertion,
  ZeroneAgentHostStore,
  resolveAndPutBindingHead,
} from "../src/index.js";
import {
  bindingForWallet,
  currentnessForProof,
  fixture,
  hash,
  LATER,
  proofForBinding,
  rewriteEventChain,
  TIME,
} from "./helpers.js";

function pathFor(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `zerone-host-identity-${label}-`)), "host.sqlite");
}

function mutateSignature(value: string): string {
  const bytes = base64UrlDecode(value);
  bytes[0] = (bytes[0] as number) ^ 1;
  return base64UrlEncode(bytes);
}

function withProofId(core: WalletIdentityBindingProofCore): WalletIdentityBindingProofEnvelope {
  return {
    ...core,
    proof_id: domainSeparatedId(HASH_DOMAINS.wallet_binding_proof, core),
  };
}

function proofCore(
  proof: WalletIdentityBindingProofEnvelope,
): WalletIdentityBindingProofCore {
  const { proof_id: _proofId, ...core } = proof;
  return core;
}

function walletRotation(values: ReturnType<typeof fixture>, issuedAt: string) {
  const privateKey = Uint8Array.from(
    { length: 32 },
    (_, index) => index === 31 ? 2 : 0,
  );
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const address = zeroneAddressFromSecp256k1PublicKey(publicKey);
  const binding = createWalletIdentityBinding({
    network: values.binding.network,
    owner_identity_id: values.binding.owner_identity_id,
    wallet_id: values.binding.wallet_id,
    wallet_descriptor_id: hash("c"),
    identity_authority: values.binding.identity_authority,
    zerone_account_id: zeroneAccountId(values.profile, address),
    zerone_public_key: publicKey,
    revision: 2,
    wallet_continuity_sequence: 1,
    previous_binding_id: values.binding.binding_id,
    issued_at: issuedAt,
  });
  const proof = proofForBinding(binding, privateKey);
  const currentness = currentnessForProof(proof, {
    verified_at: "2026-08-20T20:00:20.000Z",
    valid_until: "2026-08-21T20:00:20.000Z",
  });
  return { binding, proof, currentness };
}

test("reverifies and runtime-brands the full dual-key envelope after restart", () => {
  const values = fixture();
  const path = pathFor("restart-brand");
  const first = new ZeroneAgentHostStore(path, { create: true });
  first.initialize();
  const written = first.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  expect(written.binding).toEqual(values.binding);
  expect(written.currentness).toEqual(values.currentness);
  expect(() => assertVerifiedWalletIdentityBindingProof(written.proof)).not.toThrow();
  first.close();

  const reopened = new ZeroneAgentHostStore(path, { create: false });
  reopened.initialize();
  const reloaded = reopened.getBindingHead(values.binding.wallet_id);
  expect(reloaded?.proof).toEqual(values.proof);
  expect(reloaded?.currentness).toEqual(values.currentness);
  expect(() => assertVerifiedWalletIdentityBindingProof(reloaded!.proof)).not.toThrow();
  expect(reopened.verify().ok).toBeTrue();
  reopened.close();
});

test("passes only a verified proof to the injected nonauthorizing currentness resolver", async () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  let resolverCalled = false;
  const head = await resolveAndPutBindingHead({
    store,
    proof: structuredClone(values.proof),
    resolver: {
      async resolveCurrentness(proof) {
        resolverCalled = true;
        expect(() => assertVerifiedWalletIdentityBindingProof(proof)).not.toThrow();
        expect(proof.binding.binding_id).toBe(values.binding.binding_id);
        return values.currentness;
      },
    },
    expected: null,
    updated_at: TIME,
  });
  expect(resolverCalled).toBeTrue();
  expect(head.currentness.effects_performed).toBeFalse();
  store.close();
});

test("allows same-proof currentness refresh and rejects stale operation and CAS coordinates", () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const first = store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const reserved = store.reserveOperation(values.reserve());
  const refreshedCurrentness = currentnessForProof(values.proof, {
    verifier_id: "injected-currentness-verifier-v1",
    verified_at: "2026-08-20T20:00:30.000Z",
    valid_until: "2026-08-21T20:00:30.000Z",
    wallet_revocation_nonce: 1,
  });
  const second = store.putBindingHead(values.proof, refreshedCurrentness, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  });
  expect(second).toMatchObject({
    head_version: 2,
    proof: { proof_id: values.proof.proof_id },
    currentness: {
      currentness_id: refreshedCurrentness.currentness_id,
      wallet_revocation_nonce: 1,
    },
  });
  expect(second.proof).toEqual(first.proof);
  expect(() => store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "stale-currentness-request",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: "2026-08-20T20:02:00.000Z",
  })).toThrow(/authority changed/);
  expect(() => store.putBindingHead(values.proof, refreshedCurrentness, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: "2026-08-20T20:03:00.000Z",
  })).toThrow(/expectation is stale/);
  expect(store.verify().ok).toBeTrue();
  store.close();
});

test("rejects tampered Ed25519 and secp256k1 signatures even with recomputed proof IDs", () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const core = proofCore(values.proof);
  const badIdentity = withProofId({
    ...core,
    identity_proof: {
      ...core.identity_proof,
      signature_b64u: mutateSignature(core.identity_proof.signature_b64u),
    },
  });
  expect(() => store.putBindingHead(
    badIdentity,
    currentnessForProof(values.proof),
    { expected: null, updated_at: TIME },
  )).toThrow(/Ed25519/i);

  const badWallet = withProofId({
    ...core,
    wallet_proof: {
      ...core.wallet_proof,
      signature_b64u: mutateSignature(core.wallet_proof.signature_b64u),
    },
  });
  expect(() => store.putBindingHead(
    badWallet,
    currentnessForProof(values.proof),
    { expected: null, updated_at: TIME },
  )).toThrow(/secp256k1/i);
  expect(store.getBindingHead(values.binding.wallet_id)).toBeNull();
  store.close();
});

test("rejects forged and mismatched proof/currentness IDs and invalid freshness intervals", () => {
  const values = fixture();
  const newStore = () => {
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    store.initialize();
    return store;
  };

  let store = newStore();
  expect(() => store.putBindingHead(values.proof, {
    ...values.currentness,
    currentness_id: hash("f"),
  }, { expected: null, updated_at: TIME })).toThrow(/currentness_id/);
  store.close();

  store = newStore();
  const wrongBinding = createBindingCurrentnessAssertion({
    binding_id: hash("e"),
    proof_id: values.proof.proof_id,
    verifier_id: "injected-currentness-verifier-v0",
    verified_at: values.currentness.verified_at,
    valid_until: values.currentness.valid_until,
    wallet_revocation_nonce: 0,
  });
  expect(() => store.putBindingHead(values.proof, wrongBinding, {
    expected: null,
    updated_at: TIME,
  })).toThrow(/does not name/);
  store.close();

  store = newStore();
  const wrongProof = createBindingCurrentnessAssertion({
    binding_id: values.binding.binding_id,
    proof_id: hash("d"),
    verifier_id: "injected-currentness-verifier-v0",
    verified_at: values.currentness.verified_at,
    valid_until: values.currentness.valid_until,
    wallet_revocation_nonce: 0,
  });
  expect(() => store.putBindingHead(values.proof, wrongProof, {
    expected: null,
    updated_at: TIME,
  })).toThrow(/does not name/);
  store.close();

  expect(() => createBindingCurrentnessAssertion({
    binding_id: values.binding.binding_id,
    proof_id: values.proof.proof_id,
    verifier_id: "injected-currentness-verifier-v0",
    verified_at: TIME,
    valid_until: TIME,
    wallet_revocation_nonce: 0,
  })).toThrow(/non-empty/);
});

test("rejects accessor-backed currentness without invoking hostile getters", () => {
  const values = fixture();
  const { currentness_id: currentnessId, ...core } = values.currentness;
  let getterCalls = 0;
  const hostile = Object.defineProperty({ ...core }, "currentness_id", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return currentnessId;
    },
  });
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  expect(() => store.putBindingHead(
    values.proof,
    hostile as typeof values.currentness,
    { expected: null, updated_at: TIME },
  )).toThrow(/closed data field set/);
  expect(getterCalls).toBe(0);
  expect(() => store.putBindingHead(
    values.proof,
    {
      ...values.currentness,
      [Symbol("hidden-currentness-coordinate")]: true,
    },
    { expected: null, updated_at: TIME },
  )).toThrow(/string-named fields/);
  store.close();
});

test("keeps old source-account ownership indexed after the wallet head rotates away", () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const first = store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const regressed = walletRotation(values, "2026-08-19T20:00:10.000Z");
  expect(() => store.putBindingHead(regressed.proof, regressed.currentness, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  })).toThrow(/chronology backwards/);

  const rotated = walletRotation(values, "2026-08-20T20:00:10.000Z");
  store.putBindingHead(rotated.proof, rotated.currentness, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  });

  const aliasBinding = bindingForWallet("wallet-host-old-source-alias");
  const aliasProof = proofForBinding(aliasBinding);
  expect(() => store.putBindingHead(
    aliasProof,
    currentnessForProof(aliasProof),
    { expected: null, updated_at: "2026-08-20T20:02:00.000Z" },
  )).toThrow(/source account remains permanently bound/);
  expect(store.verify().ok).toBeTrue();
  store.close();
});

test("rejects a valid signed successor whose issued_at regresses on verify and reopen", () => {
  const values = fixture();
  const path = pathFor("regressed-successor");
  let store = new ZeroneAgentHostStore(path, { create: true });
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const regressed = walletRotation(values, "2026-08-19T20:00:10.000Z");
  const raw = Reflect.get(store, "db") as Database;
  raw.query(`
    INSERT INTO binding_history (
      currentness_id, proof_id, wallet_id, head_version, binding_id,
      source_account, proof_envelope_json, currentness_json, recorded_at
    ) VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?)
  `).run(
    regressed.currentness.currentness_id,
    regressed.proof.proof_id,
    regressed.binding.wallet_id,
    regressed.binding.binding_id,
    regressed.binding.zerone_account_id,
    canonicalJson(regressed.proof),
    canonicalJson(regressed.currentness),
    LATER,
  );
  raw.query(`
    UPDATE binding_heads SET
      head_version = 2, binding_id = ?, proof_id = ?, currentness_id = ?,
      binding_revision = 2, continuity_sequence = 1, revocation_nonce = ?,
      descriptor_id = ?, signer_key_id = ?, source_account = ?, network = ?,
      proof_envelope_json = ?, currentness_json = ?, updated_at = ?
    WHERE wallet_id = ?
  `).run(
    regressed.binding.binding_id,
    regressed.proof.proof_id,
    regressed.currentness.currentness_id,
    regressed.currentness.wallet_revocation_nonce,
    regressed.binding.wallet_descriptor_id,
    regressed.binding.zerone_signer.key_id,
    regressed.binding.zerone_account_id,
    regressed.binding.network,
    canonicalJson(regressed.proof),
    canonicalJson(regressed.currentness),
    LATER,
    regressed.binding.wallet_id,
  );
  expect(() => store.verify()).toThrow(/successor issued_at regresses/);
  store.close();

  store = new ZeroneAgentHostStore(path, { create: true });
  expect(() => store.initialize()).toThrow(/successor issued_at regresses/);
  store.close();
});

test("prevents deleting a current binding head and detects a stranded history wallet", () => {
  const values = fixture();
  const path = pathFor("deleted-head");
  let store = new ZeroneAgentHostStore(path, { create: true });
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const raw = Reflect.get(store, "db") as Database;
  expect(() => raw.query("DELETE FROM binding_heads WHERE wallet_id = ?")
    .run(values.binding.wallet_id)).toThrow(/cannot be deleted/);
  raw.exec("DROP TRIGGER binding_heads_no_delete");
  raw.query("DELETE FROM binding_heads WHERE wallet_id = ?").run(values.binding.wallet_id);
  raw.exec(`
    CREATE TRIGGER binding_heads_no_delete
    BEFORE DELETE ON binding_heads
    BEGIN
      SELECT RAISE(ABORT, 'binding heads cannot be deleted');
    END
  `);
  expect(() => store.verify()).toThrow(/exactly one current head/);
  store.close();

  store = new ZeroneAgentHostStore(path, { create: true });
  expect(() => store.initialize()).toThrow(/exactly one current head/);
  store.close();
});

test("rejects reservation and signer boundaries outside resolver-asserted freshness", () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const shortCurrentness = currentnessForProof(values.proof, {
    valid_until: "2026-08-20T20:00:30.000Z",
  });
  store.putBindingHead(values.proof, shortCurrentness, {
    expected: null,
    updated_at: TIME,
  });
  expect(() => store.reserveOperation(values.reserve("expired-reservation", {
    binding_head: {
      ...values.reserve().binding_head,
      currentness_id: shortCurrentness.currentness_id,
    },
    created_at: LATER,
  }))).toThrow(/not valid at operation reservation/);

  const reserved = store.reserveOperation(values.reserve("pre-expiry", {
    binding_head: {
      ...values.reserve().binding_head,
      currentness_id: shortCurrentness.currentness_id,
    },
  }));
  expect(() => store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "expired-at-signer",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  })).toThrow(/authority changed/);
  store.close();
});

test("rejects operation and event substitution across currentness coordinates", () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const first = store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  store.reserveOperation(values.reserve());
  const refreshed = currentnessForProof(values.proof, {
    verifier_id: "injected-currentness-verifier-v1",
    verified_at: "2026-08-20T20:00:30.000Z",
    valid_until: "2026-08-21T20:00:30.000Z",
  });
  store.putBindingHead(values.proof, refreshed, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  });
  const raw = Reflect.get(store, "db") as Database;
  raw.query("UPDATE operations SET currentness_id = ? WHERE operation_id = ?")
    .run(refreshed.currentness_id, "operation-1");
  expect(() => store.verify()).toThrow(/authority references|reservation genesis/i);
  store.close();

  const eventStore = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  eventStore.initialize();
  eventStore.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  eventStore.reserveOperation(values.reserve());
  rewriteEventChain(eventStore, "operation-1", (kind, details) =>
    kind === "reserved" ? { ...details, currentness_id: hash("f") } : details);
  expect(() => eventStore.verify()).toThrow(/authority commitment|reservation genesis/i);
  eventStore.close();

  const signerStore = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  signerStore.initialize();
  signerStore.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const signerReserved = signerStore.reserveOperation(values.reserve());
  signerStore.recordSignerInvocationBoundary({
    operation_id: signerReserved.operation_id,
    expected_revision: signerReserved.revision,
    account_snapshot: values.snapshot,
    request_id: "substituted-signer-currentness",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  rewriteEventChain(signerStore, "operation-1", (kind, details) =>
    kind === "signer_invocation_boundary"
      ? { ...details, currentness_id: hash("f") }
      : details);
  expect(() => signerStore.verify()).toThrow(/current historical binding head/);
  signerStore.close();
});

test("binds signer replay to the exact historical currentness head", () => {
  const values = fixture();
  const path = pathFor("signer-head");
  let store = new ZeroneAgentHostStore(path, { create: true });
  store.initialize();
  const first = store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  const reserved = store.reserveOperation(values.reserve());
  const signing = store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "historical-head-signer",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  store.recordVerifiedSignedEvidence({
    operation_id: signing.operation_id,
    expected_revision: signing.revision,
    tx_hash: "B".repeat(64),
    signed_payload_hash: hash("d"),
    external_verification_id: hash("e"),
    at: "2026-08-20T20:02:00.000Z",
  });
  const refreshed = currentnessForProof(values.proof, {
    verifier_id: "injected-currentness-verifier-v1",
    verified_at: "2026-08-20T20:00:30.000Z",
    valid_until: "2026-08-21T20:00:30.000Z",
  });
  store.putBindingHead(values.proof, refreshed, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      currentness_id: first.currentness.currentness_id,
      head_version: first.head_version,
    },
    updated_at: "2026-08-20T20:03:00.000Z",
  });
  const raw = Reflect.get(store, "db") as Database;
  raw.exec("DROP TRIGGER binding_history_no_update");
  raw.query("UPDATE binding_history SET recorded_at = ? WHERE currentness_id = ?")
    .run("2026-08-20T20:00:30.000Z", refreshed.currentness_id);
  raw.query("UPDATE binding_heads SET updated_at = ? WHERE wallet_id = ?")
    .run("2026-08-20T20:00:30.000Z", values.binding.wallet_id);
  raw.exec(`
    CREATE TRIGGER binding_history_no_update
    BEFORE UPDATE ON binding_history
    BEGIN
      SELECT RAISE(ABORT, 'binding history is append-only');
    END
  `);
  expect(() => store.verify()).toThrow(/did not use the current historical binding head/);
  store.close();

  store = new ZeroneAgentHostStore(path, { create: true });
  expect(() => store.initialize()).toThrow(/did not use the current historical binding head/);
  store.close();
});

test("rejects a cryptographically invalid proof-envelope substitution on reopen", () => {
  const values = fixture();
  const path = pathFor("proof-substitution");
  const store = new ZeroneAgentHostStore(path, { create: true });
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  store.close();

  const raw = new Database(path);
  raw.exec("DROP TRIGGER binding_history_no_update");
  const core = proofCore(values.proof);
  const tampered = withProofId({
    ...core,
    identity_proof: {
      ...core.identity_proof,
      signature_b64u: mutateSignature(core.identity_proof.signature_b64u),
    },
  });
  raw.query("UPDATE binding_history SET proof_envelope_json = ? WHERE currentness_id = ?")
    .run(canonicalJson(tampered), values.currentness.currentness_id);
  raw.close(false);

  const reopened = new ZeroneAgentHostStore(path, { create: true });
  expect(() => reopened.initialize()).toThrow(/Ed25519/i);
  reopened.close();
});
