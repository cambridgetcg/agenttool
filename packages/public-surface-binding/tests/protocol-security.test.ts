import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  BINDING_BOUNDARIES,
  PUBLICATION_PATH,
  RECORD_SCHEMAS,
  SIGNING_DOMAINS,
  assessPublicSurfaceBinding,
  assertVerifiedPublicSurfaceBinding,
  assertVerifiedPublicSurfaceRevocation,
  canonicalRecordSha256,
  createPublicSurfaceObservation,
  domainSeparatedId,
  encodeCanonicalRecord,
  publicSurfaceAssessmentId,
  sealPublicSurfaceBinding,
  sealPublicSurfaceRevocation,
  surfaceBindingId,
  surfaceRevocationId,
  validatePublicSurfaceAssessment,
  verifyPublicSurfaceBinding,
  verifyPublicSurfaceBindingSignature,
  verifyPublicSurfaceRevocation,
  verifyPublicSurfaceRevocationSignature,
} from "../src/index.js";
import { PublicSurfaceBindingError } from "../src/errors.js";
import type {
  IdentityKeyEvidence,
  PublicSurfaceAssessment,
  PublicSurfaceBinding,
  PublicSurfaceBindingCore,
  PublicSurfaceObservation,
  PublicSurfaceObservationCore,
  PublicSurfaceRevocation,
  PublicSurfaceRevocationCore,
  RecordSigner,
} from "../src/types.js";
import { GET_OBSERVATION, SHA_A, SHA_B } from "./fixtures.js";

const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const ALTERNATE_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";
const ALTERNATE_KEY_ID = "33333333-3333-4333-8333-333333333333";

function withNobleSha512<T>(operation: () => T): T {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
    const hash = sha512.create();
    for (const message of messages) hash.update(message);
    return hash.digest();
  };
  try {
    return operation();
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function signerFor(privateKey: Uint8Array): RecordSigner {
  return {
    public_key: base64(withNobleSha512(() => ed25519.getPublicKey(privateKey))),
    sign_digest(digest) {
      return base64(withNobleSha512(() => ed25519.sign(digest, privateKey)));
    },
  };
}

const SIGNER = signerFor(PRIVATE_KEY);
const ALTERNATE_SIGNER = signerFor(ALTERNATE_PRIVATE_KEY);

function observationCore(): PublicSurfaceObservationCore {
  const { evidence_id: _evidenceId, ...core } = structuredClone(GET_OBSERVATION);
  core.request_url = "https://surface.agenttool.dev/agent.txt";
  core.final_url = core.request_url;
  core.body_sha256 = SHA_A;
  return core;
}

function bindingCore(observation: Readonly<PublicSurfaceObservation>): PublicSurfaceBindingCore {
  return {
    schema: RECORD_SCHEMAS.binding,
    subject: {
      identity_namespace: "agenttool-local",
      identity_id: IDENTITY_ID,
      signing_key: {
        algorithm: "Ed25519",
        key_id: KEY_ID,
        public_key: SIGNER.public_key,
      },
    },
    origin: "https://surface.agenttool.dev",
    observation_id: observation.evidence_id,
    observed_body_sha256: observation.body_sha256!,
    relation: "declares_association_with_surface",
    scope: "exact_origin",
    purpose: "public_identity_locator",
    publication_path: PUBLICATION_PATH,
    issued_at: "2026-08-16T12:01:00.000Z",
    not_before: "2026-08-16T12:01:00.000Z",
    expires_at: "2026-08-30T12:01:00.000Z",
    nonce: base64url(Uint8Array.from({ length: 16 }, (_, index) => index)),
    boundaries: BINDING_BOUNDARIES,
  };
}

function keyEvidence(
  binding: Readonly<PublicSurfaceBinding>,
  sourceRef = canonicalRecordSha256({ fixture: "binding-key-evidence" }),
): IdentityKeyEvidence {
  return {
    identity_namespace: "agenttool-local",
    identity_id: binding.subject.identity_id,
    signing_key: structuredClone(binding.subject.signing_key),
    relationship: "assertion",
    lifecycle: "active",
    valid_from: "2026-08-01T00:00:00.000Z",
    valid_until: null,
    source_ref: sourceRef,
    basis: "caller_supplied_key_evidence",
  };
}

function originObservationCore(binding: Readonly<PublicSurfaceBinding>): PublicSurfaceObservationCore {
  const core = observationCore();
  const body = encodeCanonicalRecord(binding);
  core.request_url = `${binding.origin}${PUBLICATION_PATH}`;
  core.final_url = core.request_url;
  core.request.started_at = "2026-08-16T12:01:30.000Z";
  core.request.ended_at = "2026-08-16T12:01:31.000Z";
  core.media_type = "application/json";
  core.bytes = body.byteLength;
  core.body_sha256 = canonicalRecordSha256(binding);
  return core;
}

function revocationCore(
  binding: Readonly<PublicSurfaceBinding>,
  revokedAt = "2026-08-16T12:03:00.000Z",
): PublicSurfaceRevocationCore {
  return {
    schema: RECORD_SCHEMAS.revocation,
    binding_id: binding.binding_id,
    subject: structuredClone(binding.subject),
    revoked_at: revokedAt,
    reason: "withdrawn",
    superseded_by: null,
    nonce: base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 16)),
  };
}

async function exactSuite(): Promise<{
  observation: Readonly<PublicSurfaceObservation>;
  binding: Readonly<PublicSurfaceBinding>;
  evidence: IdentityKeyEvidence;
  originObservation: Readonly<PublicSurfaceObservation>;
}> {
  const observation = createPublicSurfaceObservation(observationCore());
  const binding = await sealPublicSurfaceBinding(bindingCore(observation), SIGNER);
  return {
    observation,
    binding,
    evidence: keyEvidence(binding),
    originObservation: createPublicSurfaceObservation(originObservationCore(binding)),
  };
}

function expectCode(action: () => unknown, code: PublicSurfaceBindingError["code"]): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSurfaceBindingError);
    expect((error as PublicSurfaceBindingError).code).toBe(code);
  }
}

describe("signed public-surface protocol", () => {
  test("seals deterministic flat records and keeps verification brands non-forgeable", async () => {
    const { binding } = await exactSuite();
    expect(verifyPublicSurfaceBindingSignature(binding)).toBe("valid");
    assertVerifiedPublicSurfaceBinding(binding);

    const clone = structuredClone(binding);
    expectCode(() => assertVerifiedPublicSurfaceBinding(clone), "SIGNATURE_INVALID");
    const independentlyVerified = verifyPublicSurfaceBinding(clone);
    assertVerifiedPublicSurfaceBinding(independentlyVerified);
    expect(independentlyVerified).not.toBe(clone);
    expect(Object.isFrozen(independentlyVerified)).toBe(true);

    const { binding_id: _bindingId, signature, ...core } = binding;
    expect(binding.binding_id).toBe(domainSeparatedId(
      SIGNING_DOMAINS.binding_id,
      { ...core, signature },
    ));
    expect(binding.binding_id).not.toBe(domainSeparatedId(
      SIGNING_DOMAINS.binding_id,
      { core, signature },
    ));

    const replay = await sealPublicSurfaceBinding(core, SIGNER);
    expect(replay.signature).toEqual(binding.signature);
    expect(replay.binding_id).toBe(binding.binding_id);
    const freshCore = structuredClone(core);
    freshCore.nonce = base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
    const fresh = await sealPublicSurfaceBinding(freshCore, SIGNER);
    expect(fresh.binding_id).not.toBe(binding.binding_id);
  });

  test("rejects signer mismatch before callback and snapshots the signed digest", async () => {
    const observation = createPublicSurfaceObservation(observationCore());
    const core = bindingCore(observation);
    let called = false;
    const mismatch: RecordSigner = {
      public_key: ALTERNATE_SIGNER.public_key,
      sign_digest() {
        called = true;
        return "";
      },
    };
    await expect(sealPublicSurfaceBinding(core, mismatch)).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
    expect(called).toBe(false);

    const mutating: RecordSigner = {
      public_key: SIGNER.public_key,
      sign_digest(digest) {
        digest[0] ^= 0xff;
        return SIGNER.sign_digest(digest);
      },
    };
    await expect(sealPublicSurfaceBinding(core, mutating)).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(core.observation_id).toBe(observation.evidence_id);
  });

  test("signed field tampering remains invalid even after the flat record ID is recomputed", async () => {
    const { binding } = await exactSuite();
    const mutations: Array<(core: PublicSurfaceBindingCore) => void> = [
      (core) => { core.purpose = "public_agent_service"; },
      (core) => { core.origin = "https://other.agenttool.dev"; },
      (core) => { core.observation_id = SHA_B; },
      (core) => { core.subject.identity_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
      (core) => { core.issued_at = "2026-08-16T12:00:59.999Z"; },
      (core) => { core.nonce = base64url(new Uint8Array(16).fill(7)); },
    ];
    const { binding_id: _bindingId, signature, ...originalCore } = binding;
    for (const mutate of mutations) {
      const core = structuredClone(originalCore);
      mutate(core);
      const tampered = {
        ...core,
        signature,
        binding_id: surfaceBindingId(core, signature),
      };
      expect(verifyPublicSurfaceBindingSignature(tampered)).toBe("invalid");
      expectCode(() => verifyPublicSurfaceBinding(tampered), "SIGNATURE_INVALID");
    }

    const idOnly = structuredClone(binding);
    idOnly.binding_id = SHA_B;
    expectCode(() => verifyPublicSurfaceBinding(idOnly), "INVALID_INPUT");

    expectCode(() => surfaceBindingId(originalCore, {
      algorithm: "RSA" as "Ed25519",
      value: signature.value,
    }), "INVALID_INPUT");
    expectCode(() => surfaceBindingId(originalCore, {
      algorithm: "Ed25519",
      value: base64(new Uint8Array(63)),
    }), "INVALID_INPUT");
  });

  test("strictly seals, verifies, and detects tampering of revocations", async () => {
    const { binding } = await exactSuite();
    const revocation = await sealPublicSurfaceRevocation(revocationCore(binding), SIGNER);
    expect(verifyPublicSurfaceRevocationSignature(revocation)).toBe("valid");
    assertVerifiedPublicSurfaceRevocation(revocation);
    const clone = structuredClone(revocation);
    expectCode(() => assertVerifiedPublicSurfaceRevocation(clone), "SIGNATURE_INVALID");
    assertVerifiedPublicSurfaceRevocation(verifyPublicSurfaceRevocation(clone));

    const { revocation_id: _revocationId, signature, ...core } = revocation;
    expect(revocation.revocation_id).toBe(domainSeparatedId(
      SIGNING_DOMAINS.revocation_id,
      { ...core, signature },
    ));
    const tamperedCore = structuredClone(core);
    tamperedCore.reason = "key_compromised";
    const tampered = {
      ...tamperedCore,
      signature,
      revocation_id: surfaceRevocationId(tamperedCore, signature),
    };
    expect(verifyPublicSurfaceRevocationSignature(tampered)).toBe("invalid");
    expectCode(() => verifyPublicSurfaceRevocation(tampered), "SIGNATURE_INVALID");

    expectCode(() => surfaceRevocationId(core, {
      algorithm: "RSA" as "Ed25519",
      value: signature.value,
    }), "INVALID_INPUT");
    expectCode(() => surfaceRevocationId(core, {
      algorithm: "Ed25519",
      value: base64(new Uint8Array(65)),
    }), "INVALID_INPUT");
  });

  test("keeps assessment factors independent and binds every supplied input reference", async () => {
    const { observation, binding, evidence, originObservation } = await exactSuite();
    const current = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: originObservation,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(current).toMatchObject({
      integrity: "valid",
      signature: "valid",
      key_authorization: "caller_evidence_matches",
      evidence_match: "matches",
      origin_confirmation: "observed_at_time",
      freshness: "current",
      revocation: "not_observed",
      authority: "none",
      score: null,
      wake_effect: false,
      memory_effect: false,
      karma_effect: false,
      training_effect: false,
    });
    expect(current.establishes).toEqual([
      "key_holder_signed_claim",
      "caller_key_evidence_match",
      "origin_served_exact_binding_bytes",
    ]);
    expect(current.inputs).toEqual({
      binding_document_sha256: canonicalRecordSha256(binding),
      key_evidence_ref: evidence.source_ref,
      key_evidence_sha256: canonicalRecordSha256(evidence),
      observation_id: observation.evidence_id,
      origin_observation_id: originObservation.evidence_id,
      revocation_ids: [],
      revocation_document_sha256s: [],
      revocation_key_evidence_refs: [],
      revocation_key_evidence_sha256s: [],
    });
    expect(publicSurfaceAssessmentId(assessmentCore(current))).toBe(current.assessment_id);

    const noEvidence = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: null,
      revocation_key_evidence: null,
    });
    expect(noEvidence.key_authorization).toBe("not_supplied");
    expect(noEvidence.evidence_match).toBe("not_supplied");
    expect(noEvidence.origin_confirmation).toBe("not_supplied");
    expect(noEvidence.revocation).toBe("indeterminate");
    expect(noEvidence.inputs.revocation_ids).toBeNull();
    expect(noEvidence.inputs.revocation_document_sha256s).toBeNull();
    expect(noEvidence.inputs.revocation_key_evidence_refs).toBeNull();
    expect(noEvidence.inputs.revocation_key_evidence_sha256s).toBeNull();
    expect(noEvidence.assessment_id).not.toBe(current.assessment_id);

    const alternateRef = keyEvidence(binding, canonicalRecordSha256({ fixture: "alternate-source" }));
    const alternateAssessment = assessPublicSurfaceBinding({
      binding,
      evaluated_at: current.evaluated_at,
      key_evidence: alternateRef,
      observation,
      origin_observation: originObservation,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(alternateAssessment.key_authorization).toBe(current.key_authorization);
    expect(alternateAssessment.inputs.key_evidence_ref).not.toBe(current.inputs.key_evidence_ref);
    expect(alternateAssessment.assessment_id).not.toBe(current.assessment_id);

    const tamperedCore = assessmentCore(current);
    tamperedCore.inputs.key_evidence_ref = alternateRef.source_ref;
    expect(publicSurfaceAssessmentId(tamperedCore)).not.toBe(current.assessment_id);
    const staleId = { ...tamperedCore, assessment_id: current.assessment_id };
    expectCode(() => validatePublicSurfaceAssessment(staleId), "INVALID_INPUT");

    const documentTamper = assessmentCore(current);
    documentTamper.inputs.binding_document_sha256 = SHA_B;
    expect(publicSurfaceAssessmentId(documentTamper)).not.toBe(current.assessment_id);

    let accessorRan = false;
    const accessorCore = assessmentCore(current);
    Object.defineProperty(accessorCore, "schema", {
      enumerable: true,
      get() {
        accessorRan = true;
        return RECORD_SCHEMAS.assessment;
      },
    });
    expectCode(() => publicSurfaceAssessmentId(accessorCore), "INVALID_INPUT");
    expect(accessorRan).toBe(false);

    let proxyTrapRan = false;
    const proxiedCore = new Proxy(assessmentCore(current), {
      ownKeys() {
        proxyTrapRan = true;
        return [];
      },
    });
    expectCode(() => publicSurfaceAssessmentId(proxiedCore), "INVALID_INPUT");
    expect(proxyTrapRan).toBe(false);
  });

  test("binds exact documents even when their claimed IDs or refs are unchanged", async () => {
    const { binding } = await exactSuite();
    const invalidBindingA = structuredClone(binding);
    invalidBindingA.purpose = "public_agent_service";
    const invalidBindingB = structuredClone(binding);
    invalidBindingB.purpose = "public_discovery_surface";
    const assessMinimal = (candidateBinding: unknown, candidateEvidence: unknown | null = null) =>
      assessPublicSurfaceBinding({
        binding: candidateBinding,
        evaluated_at: "2026-08-16T12:02:00.000Z",
        key_evidence: candidateEvidence,
        observation: null,
        origin_observation: null,
        revocations: [],
        revocation_key_evidence: [],
      });
    const bindingAssessmentA = assessMinimal(invalidBindingA);
    const bindingAssessmentB = assessMinimal(invalidBindingB);
    expect(bindingAssessmentA.binding_id).toBe(bindingAssessmentB.binding_id);
    expect(bindingAssessmentA.integrity).toBe("invalid");
    expect(bindingAssessmentB.integrity).toBe("invalid");
    expect(bindingAssessmentA.inputs.binding_document_sha256).not.toBe(
      bindingAssessmentB.inputs.binding_document_sha256,
    );
    expect(bindingAssessmentA.assessment_id).not.toBe(bindingAssessmentB.assessment_id);

    const evidenceA = keyEvidence(binding);
    evidenceA.identity_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const evidenceB = keyEvidence(binding);
    evidenceB.signing_key.key_id = ALTERNATE_KEY_ID;
    const evidenceAssessmentA = assessMinimal(binding, evidenceA);
    const evidenceAssessmentB = assessMinimal(binding, evidenceB);
    expect(evidenceAssessmentA.inputs.key_evidence_ref).toBe(evidenceAssessmentB.inputs.key_evidence_ref);
    expect(evidenceAssessmentA.key_authorization).toBe("caller_evidence_mismatch");
    expect(evidenceAssessmentB.key_authorization).toBe("caller_evidence_mismatch");
    expect(evidenceAssessmentA.inputs.key_evidence_sha256).not.toBe(
      evidenceAssessmentB.inputs.key_evidence_sha256,
    );
    expect(evidenceAssessmentA.assessment_id).not.toBe(evidenceAssessmentB.assessment_id);

    const revocation = await sealPublicSurfaceRevocation(revocationCore(binding), SIGNER);
    const invalidRevocationA = structuredClone(revocation);
    invalidRevocationA.reason = "key_compromised";
    const invalidRevocationB = structuredClone(revocation);
    invalidRevocationB.reason = "surface_retired";
    const assessRevocationDocument = (candidate: unknown) => assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [candidate],
      revocation_key_evidence: [],
    });
    const revocationAssessmentA = assessRevocationDocument(invalidRevocationA);
    const revocationAssessmentB = assessRevocationDocument(invalidRevocationB);
    expect(revocationAssessmentA.revocation).toBe("indeterminate");
    expect(revocationAssessmentB.revocation).toBe("indeterminate");
    expect(revocationAssessmentA.inputs.revocation_ids).toEqual(
      revocationAssessmentB.inputs.revocation_ids,
    );
    expect(revocationAssessmentA.inputs.revocation_document_sha256s).not.toEqual(
      revocationAssessmentB.inputs.revocation_document_sha256s,
    );
    expect(revocationAssessmentA.assessment_id).not.toBe(revocationAssessmentB.assessment_id);

    const alternateCore = revocationCore(binding);
    alternateCore.subject = {
      ...structuredClone(binding.subject),
      signing_key: {
        algorithm: "Ed25519",
        key_id: ALTERNATE_KEY_ID,
        public_key: ALTERNATE_SIGNER.public_key,
      },
    };
    alternateCore.nonce = base64url(new Uint8Array(16).fill(91));
    const alternateRevocation = await sealPublicSurfaceRevocation(alternateCore, ALTERNATE_SIGNER);
    const revocationEvidenceRef = canonicalRecordSha256({ fixture: "same-revocation-evidence-ref" });
    const revocationEvidenceA: IdentityKeyEvidence = {
      identity_namespace: "agenttool-local",
      identity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      signing_key: structuredClone(alternateCore.subject.signing_key),
      relationship: "assertion",
      lifecycle: "active",
      valid_from: "2026-08-01T00:00:00.000Z",
      valid_until: null,
      source_ref: revocationEvidenceRef,
      basis: "caller_supplied_key_evidence",
    };
    const revocationEvidenceB = structuredClone(revocationEvidenceA);
    revocationEvidenceB.identity_id = binding.subject.identity_id;
    revocationEvidenceB.signing_key.key_id = "44444444-4444-4444-8444-444444444444";
    const assessRevocationEvidence = (candidate: IdentityKeyEvidence) => assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [alternateRevocation],
      revocation_key_evidence: [candidate],
    });
    const revocationEvidenceAssessmentA = assessRevocationEvidence(revocationEvidenceA);
    const revocationEvidenceAssessmentB = assessRevocationEvidence(revocationEvidenceB);
    expect(revocationEvidenceAssessmentA.revocation).toBe("indeterminate");
    expect(revocationEvidenceAssessmentB.revocation).toBe("indeterminate");
    expect(revocationEvidenceAssessmentA.inputs.revocation_key_evidence_refs).toEqual(
      revocationEvidenceAssessmentB.inputs.revocation_key_evidence_refs,
    );
    expect(revocationEvidenceAssessmentA.inputs.revocation_key_evidence_sha256s).not.toEqual(
      revocationEvidenceAssessmentB.inputs.revocation_key_evidence_sha256s,
    );
    expect(revocationEvidenceAssessmentA.assessment_id).not.toBe(
      revocationEvidenceAssessmentB.assessment_id,
    );
  });

  test("bounds and pairs revocation evidence lanes before item validation or crypto", async () => {
    const malformed = Array.from({ length: 65 }, () => null);
    const base = {
      binding: {},
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
    };
    expectCode(() => assessPublicSurfaceBinding({
      ...base,
      revocations: malformed,
      revocation_key_evidence: [],
    }), "LIMIT_EXCEEDED");
    expectCode(() => assessPublicSurfaceBinding({
      ...base,
      revocations: [],
      revocation_key_evidence: malformed,
    }), "LIMIT_EXCEEDED");

    const { binding } = await exactSuite();
    const validBase = { ...base, binding };
    expectCode(() => assessPublicSurfaceBinding({
      ...validBase,
      revocations: null,
      revocation_key_evidence: [],
    }), "INVALID_INPUT");
    expectCode(() => assessPublicSurfaceBinding({
      ...validBase,
      revocations: [],
      revocation_key_evidence: null,
    }), "INVALID_INPUT");
  });

  test("factorizes malformed claims, time, evidence, and exact-origin confirmation", async () => {
    const { observation, binding, evidence, originObservation } = await exactSuite();
    const idTampered = structuredClone(binding);
    idTampered.binding_id = SHA_B;
    const tamperedReadback = createPublicSurfaceObservation(originObservationCore(idTampered));
    const invalidIntegrity = assessPublicSurfaceBinding({
      binding: idTampered,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: tamperedReadback,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(invalidIntegrity.integrity).toBe("invalid");
    expect(invalidIntegrity.signature).toBe("valid");
    expect(invalidIntegrity.origin_confirmation).toBe("observed_at_time");

    const { binding_id: _bindingId, signature, ...unsigned } = binding;
    const signatureTampered = structuredClone(signature);
    signatureTampered.value = `${signatureTampered.value[0] === "A" ? "B" : "A"}${signatureTampered.value.slice(1)}`;
    const badSignatureBinding = {
      ...unsigned,
      signature: signatureTampered,
      binding_id: surfaceBindingId(unsigned, signatureTampered),
    };
    const invalidSignature = assessPublicSurfaceBinding({
      binding: badSignatureBinding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(invalidSignature.integrity).toBe("valid");
    expect(invalidSignature.signature).toBe("invalid");
    expect(invalidSignature.establishes).not.toContain("key_holder_signed_claim");

    const wrongBodyCore = originObservationCore(binding);
    wrongBodyCore.body_sha256 = SHA_B;
    const wrongBody = createPublicSurfaceObservation(wrongBodyCore);
    const bodyAssessment = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: wrongBody,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(bodyAssessment.origin_confirmation).toBe("body_mismatch");

    const wrongByteCountCore = originObservationCore(binding);
    wrongByteCountCore.bytes = wrongByteCountCore.bytes! + 1;
    const wrongByteCount = createPublicSurfaceObservation(wrongByteCountCore);
    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: wrongByteCount,
      revocations: [],
      revocation_key_evidence: [],
    }).origin_confirmation).toBe("body_mismatch");

    const wrongOriginCore = originObservationCore(binding);
    wrongOriginCore.origin = "https://other.agenttool.dev";
    wrongOriginCore.request_url = `https://other.agenttool.dev${PUBLICATION_PATH}`;
    wrongOriginCore.final_url = wrongOriginCore.request_url;
    const wrongOrigin = createPublicSurfaceObservation(wrongOriginCore);
    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: evidence,
      observation,
      origin_observation: wrongOrigin,
      revocations: [],
      revocation_key_evidence: [],
    }).origin_confirmation).toBe("origin_mismatch");

    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:00:59.999Z",
      key_evidence: evidence,
      observation: null,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).freshness).toBe("not_yet_valid");
    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: binding.expires_at,
      key_evidence: evidence,
      observation: null,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).freshness).toBe("expired");
    expect(originObservation.bytes).toBe(encodeCanonicalRecord(binding).byteLength);
  });

  test("distinguishes absent revocation knowledge, valid revocation, and invalid corpus entries", async () => {
    const { binding } = await exactSuite();
    const revocation = await sealPublicSurfaceRevocation(revocationCore(binding), SIGNER);
    const revoked = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [revocation],
      revocation_key_evidence: [],
    });
    expect(revoked.revocation).toBe("revoked");
    expect(revoked.inputs.revocation_ids).toEqual([revocation.revocation_id]);
    expect(revoked.inputs.revocation_document_sha256s).toEqual([
      canonicalRecordSha256(revocation),
    ]);

    const tamperedCore = revocationCore(binding);
    tamperedCore.reason = "key_compromised";
    const tampered = {
      ...tamperedCore,
      signature: revocation.signature,
      revocation_id: surfaceRevocationId(tamperedCore, revocation.signature),
    };
    const indeterminate = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [tampered],
      revocation_key_evidence: [],
    });
    expect(indeterminate.revocation).toBe("indeterminate");

    expectCode(() => assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: null,
      revocation_key_evidence: [],
    }), "INVALID_INPUT");
  });

  test("does not match evidence whose observed body arrived through a cross-origin redirect", async () => {
    const crossOriginCore = observationCore();
    crossOriginCore.redirect_chain = [{
      status_code: 302,
      location: "https://cdn.agenttool.dev/final-agent.txt",
    }];
    crossOriginCore.final_url = "https://cdn.agenttool.dev/final-agent.txt";
    const crossOriginObservation = createPublicSurfaceObservation(crossOriginCore);
    const crossOriginBinding = await sealPublicSurfaceBinding(bindingCore(crossOriginObservation), SIGNER);
    expect(assessPublicSurfaceBinding({
      binding: crossOriginBinding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: null,
      observation: crossOriginObservation,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).evidence_match).toBe("mismatch");

    const sameOriginCore = observationCore();
    sameOriginCore.redirect_chain = [{
      status_code: 308,
      location: "https://surface.agenttool.dev/final-agent.txt",
    }];
    sameOriginCore.final_url = "https://surface.agenttool.dev/final-agent.txt";
    const sameOriginObservation = createPublicSurfaceObservation(sameOriginCore);
    const sameOriginBinding = await sealPublicSurfaceBinding(bindingCore(sameOriginObservation), SIGNER);
    expect(assessPublicSurfaceBinding({
      binding: sameOriginBinding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: null,
      observation: sameOriginObservation,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).evidence_match).toBe("matches");
  });

  test("requires historical alternate-key authorization strictly before its revocation boundary", async () => {
    const { binding } = await exactSuite();
    const alternateSubject = {
      ...structuredClone(binding.subject),
      signing_key: {
        algorithm: "Ed25519" as const,
        key_id: ALTERNATE_KEY_ID,
        public_key: ALTERNATE_SIGNER.public_key,
      },
    };
    const evidence: IdentityKeyEvidence = {
      identity_namespace: "agenttool-local",
      identity_id: binding.subject.identity_id,
      signing_key: structuredClone(alternateSubject.signing_key),
      relationship: "assertion",
      lifecycle: "revoked",
      valid_from: "2026-08-01T00:00:00.000Z",
      valid_until: "2026-08-16T12:03:00.000Z",
      source_ref: canonicalRecordSha256({ fixture: "historical-alternate-key" }),
      basis: "caller_supplied_key_evidence",
    };
    const beforeCore = revocationCore(binding, "2026-08-16T12:02:59.999Z");
    beforeCore.subject = alternateSubject;
    const before = await sealPublicSurfaceRevocation(beforeCore, ALTERNATE_SIGNER);
    const atBoundaryCore = revocationCore(binding, evidence.valid_until!);
    atBoundaryCore.subject = alternateSubject;
    atBoundaryCore.nonce = base64url(new Uint8Array(16).fill(42));
    const atBoundary = await sealPublicSurfaceRevocation(atBoundaryCore, ALTERNATE_SIGNER);

    const historicallyRevoked = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [before],
      revocation_key_evidence: [evidence],
    });
    expect(historicallyRevoked.revocation).toBe("revoked");
    expect(historicallyRevoked.inputs.revocation_key_evidence_refs).toEqual([evidence.source_ref]);
    expect(historicallyRevoked.inputs.revocation_key_evidence_sha256s).toEqual([
      canonicalRecordSha256(evidence),
    ]);
    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:04:00.000Z",
      key_evidence: null,
      observation: null,
      origin_observation: null,
      revocations: [atBoundary],
      revocation_key_evidence: [evidence],
    }).revocation).toBe("indeterminate");
  });

  test("requires binding-key authorization strictly before a revoked-key boundary", async () => {
    const { binding } = await exactSuite();
    const beforeBoundary = keyEvidence(binding);
    beforeBoundary.lifecycle = "revoked";
    beforeBoundary.valid_until = "2026-08-16T12:01:00.001Z";
    const atBoundary = structuredClone(beforeBoundary);
    atBoundary.valid_until = binding.issued_at;

    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: beforeBoundary,
      observation: null,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).key_authorization).toBe("caller_evidence_matches");
    expect(assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: atBoundary,
      observation: null,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    }).key_authorization).toBe("caller_evidence_mismatch");
  });

  test("authenticated crawler evidence never upgrades identity, authority, or training rights", async () => {
    const core = observationCore();
    core.request_authentication = {
      kind: "web_bot_auth",
      status: "verified",
      verifier: "fixture-verifier",
      protocol_variant: "message-signatures/fixture",
      claimed_identity_url: "https://crawler.agenttool.dev/identity",
      key_thumbprint: SHA_B,
      covered_components: ["@method", "@target-uri"],
      nonce_checked: true,
    };
    const observation = createPublicSurfaceObservation(core);
    const binding = await sealPublicSurfaceBinding(bindingCore(observation), SIGNER);
    const assessment = assessPublicSurfaceBinding({
      binding,
      evaluated_at: "2026-08-16T12:02:00.000Z",
      key_evidence: null,
      observation,
      origin_observation: null,
      revocations: [],
      revocation_key_evidence: [],
    });
    expect(assessment.evidence_match).toBe("matches");
    expect(assessment.key_authorization).toBe("not_supplied");
    expect(assessment.authority).toBe("none");
    expect(assessment.training_effect).toBe(false);
    expect(observation.boundaries.identity).toBe("not_inferred");
    expect(observation.boundaries.training_permission).toBe("not_established");
  });
});

function assessmentCore(value: Readonly<PublicSurfaceAssessment>) {
  const { assessment_id: _assessmentId, ...core } = structuredClone(value);
  return core;
}
