import {
  canonicalRecordSha256,
  domainSeparatedId,
  encodeCanonicalRecord,
  signingDigest,
  snapshotJsonData,
  type JsonValue,
} from "./canonical.js";
import { verifyEd25519Digest } from "./crypto.js";
import {
  ASSESSMENT_NON_CLAIMS,
  LIMITS,
  PUBLICATION_PATH,
  RECORD_SCHEMAS,
  SIGNING_DOMAINS,
} from "./constants.js";
import { PublicSurfaceBindingError, invalid, limit } from "./errors.js";
import type {
  IdentityKeyEvidence,
  KeyAuthorizationAssessment,
  MathVerifiedBinding,
  MathVerifiedRevocation,
  OriginConfirmationAssessment,
  PublicSurfaceAssessment,
  PublicSurfaceAssessmentCore,
  PublicSurfaceBinding,
  PublicSurfaceBindingCore,
  PublicSurfaceObservation,
  PublicSurfaceObservationCore,
  PublicSurfaceRevocation,
  PublicSurfaceRevocationCore,
  RecordSignature,
  RecordSigner,
  RevocationAssessment,
  Sha256Id,
  SignatureAssessment,
} from "./types.js";
import {
  assertCanonicalInstant,
  validateIdentityKeyEvidence,
  validatePublicSurfaceAssessment,
  validatePublicSurfaceAssessmentCore,
  validatePublicSurfaceBinding,
  validatePublicSurfaceBindingCore,
  validatePublicSurfaceBindingShape,
  validatePublicSurfaceObservation,
  validatePublicSurfaceObservationCore,
  validatePublicSurfaceRevocation,
  validatePublicSurfaceRevocationCore,
  validatePublicSurfaceRevocationShape,
} from "./validation.js";

const verifiedBindings = new WeakSet<object>();
const verifiedRevocations = new WeakSet<object>();

function bindingCore(record: PublicSurfaceBinding): PublicSurfaceBindingCore {
  const { signature: _signature, binding_id: _bindingId, ...core } = record;
  return core;
}

function revocationCore(record: PublicSurfaceRevocation): PublicSurfaceRevocationCore {
  const { signature: _signature, revocation_id: _revocationId, ...core } = record;
  return core;
}

function fullBindingId(core: PublicSurfaceBindingCore, signature: RecordSignature): Sha256Id {
  return domainSeparatedId(SIGNING_DOMAINS.binding_id, { ...core, signature });
}

function fullRevocationId(core: PublicSurfaceRevocationCore, signature: RecordSignature): Sha256Id {
  return domainSeparatedId(SIGNING_DOMAINS.revocation_id, { ...core, signature });
}

export function createPublicSurfaceObservation(value: PublicSurfaceObservationCore): Readonly<PublicSurfaceObservation> {
  const core = validatePublicSurfaceObservationCore(value);
  return validatePublicSurfaceObservation({
    ...core,
    evidence_id: domainSeparatedId(SIGNING_DOMAINS.observation_id, core),
  });
}

export function surfaceObservationId(value: PublicSurfaceObservationCore): Sha256Id {
  const core = validatePublicSurfaceObservationCore(value);
  return domainSeparatedId(SIGNING_DOMAINS.observation_id, core);
}

export function surfaceBindingDigest(value: PublicSurfaceBindingCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.binding, validatePublicSurfaceBindingCore(value));
}

export function surfaceBindingId(
  value: PublicSurfaceBindingCore,
  signature: RecordSignature,
): Sha256Id {
  const core = validatePublicSurfaceBindingCore(value);
  const checked = validatePublicSurfaceBindingShape({
    ...core,
    signature,
    binding_id: `sha256:${"0".repeat(64)}`,
  });
  return fullBindingId(core, checked.signature);
}

export async function sealPublicSurfaceBinding(
  value: PublicSurfaceBindingCore,
  signer: RecordSigner,
): Promise<MathVerifiedBinding> {
  const core = validatePublicSurfaceBindingCore(value);
  if (signer.public_key !== core.subject.signing_key.public_key) {
    throw new PublicSurfaceBindingError(
      "SIGNER_MISMATCH",
      "Signer public key does not match the binding subject key.",
    );
  }
  const returned = await signer.sign_digest(surfaceBindingDigest(core));
  const signature: RecordSignature = { algorithm: "Ed25519", value: returned };
  const candidate = validatePublicSurfaceBinding({
    ...core,
    signature,
    binding_id: fullBindingId(core, signature),
  });
  if (verifyPublicSurfaceBindingSignature(candidate) !== "valid") {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Signer returned an invalid binding signature.");
  }
  verifiedBindings.add(candidate);
  return candidate as MathVerifiedBinding;
}

export function verifyPublicSurfaceBindingSignature(value: unknown): SignatureAssessment {
  const record = validatePublicSurfaceBindingShape(value);
  return verifyEd25519Digest(
    signingDigest(SIGNING_DOMAINS.binding, bindingCore(record)),
    record.subject.signing_key.public_key,
    record.signature,
  ) ? "valid" : "invalid";
}

export function verifyPublicSurfaceBinding(value: unknown): MathVerifiedBinding {
  const record = validatePublicSurfaceBinding(value);
  if (verifyPublicSurfaceBindingSignature(record) !== "valid") {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Public-surface binding signature is invalid.");
  }
  verifiedBindings.add(record);
  return record as MathVerifiedBinding;
}

export function assertVerifiedPublicSurfaceBinding(
  value: Readonly<PublicSurfaceBinding>,
): asserts value is MathVerifiedBinding {
  if (!verifiedBindings.has(value)) {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Binding has not passed strict verification.");
  }
}

export function surfaceRevocationDigest(value: PublicSurfaceRevocationCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.revocation, validatePublicSurfaceRevocationCore(value));
}

export function surfaceRevocationId(
  value: PublicSurfaceRevocationCore,
  signature: RecordSignature,
): Sha256Id {
  const core = validatePublicSurfaceRevocationCore(value);
  const checked = validatePublicSurfaceRevocationShape({
    ...core,
    signature,
    revocation_id: `sha256:${"0".repeat(64)}`,
  });
  return fullRevocationId(core, checked.signature);
}

export async function sealPublicSurfaceRevocation(
  value: PublicSurfaceRevocationCore,
  signer: RecordSigner,
): Promise<MathVerifiedRevocation> {
  const core = validatePublicSurfaceRevocationCore(value);
  if (signer.public_key !== core.subject.signing_key.public_key) {
    throw new PublicSurfaceBindingError(
      "SIGNER_MISMATCH",
      "Signer public key does not match the revocation subject key.",
    );
  }
  const returned = await signer.sign_digest(surfaceRevocationDigest(core));
  const signature: RecordSignature = { algorithm: "Ed25519", value: returned };
  const candidate = validatePublicSurfaceRevocation({
    ...core,
    signature,
    revocation_id: fullRevocationId(core, signature),
  });
  if (verifyPublicSurfaceRevocationSignature(candidate) !== "valid") {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Signer returned an invalid revocation signature.");
  }
  verifiedRevocations.add(candidate);
  return candidate as MathVerifiedRevocation;
}

export function verifyPublicSurfaceRevocationSignature(value: unknown): SignatureAssessment {
  const record = validatePublicSurfaceRevocationShape(value);
  return verifyEd25519Digest(
    signingDigest(SIGNING_DOMAINS.revocation, revocationCore(record)),
    record.subject.signing_key.public_key,
    record.signature,
  ) ? "valid" : "invalid";
}

export function verifyPublicSurfaceRevocation(value: unknown): MathVerifiedRevocation {
  const record = validatePublicSurfaceRevocation(value);
  if (verifyPublicSurfaceRevocationSignature(record) !== "valid") {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Public-surface revocation signature is invalid.");
  }
  verifiedRevocations.add(record);
  return record as MathVerifiedRevocation;
}

export function assertVerifiedPublicSurfaceRevocation(
  value: Readonly<PublicSurfaceRevocation>,
): asserts value is MathVerifiedRevocation {
  if (!verifiedRevocations.has(value)) {
    throw new PublicSurfaceBindingError("SIGNATURE_INVALID", "Revocation has not passed strict verification.");
  }
}

export interface AssessPublicSurfaceBindingInput {
  binding: unknown;
  evaluated_at: string;
  key_evidence: unknown | null;
  observation: unknown | null;
  origin_observation: unknown | null;
  revocations: unknown[] | null;
  revocation_key_evidence: unknown[] | null;
}

function sameAuthority(left: IdentityKeyEvidence["signing_key"], right: PublicSurfaceBinding["subject"]["signing_key"]): boolean {
  return left.algorithm === right.algorithm
    && left.key_id === right.key_id
    && left.public_key === right.public_key;
}

function keyEvidenceAssessment(
  binding: Readonly<PublicSurfaceBinding>,
  evidence: Readonly<IdentityKeyEvidence> | null,
): KeyAuthorizationAssessment {
  if (evidence === null) return "not_supplied";
  if (
    evidence.identity_namespace !== binding.subject.identity_namespace
    || evidence.identity_id !== binding.subject.identity_id
    || !sameAuthority(evidence.signing_key, binding.subject.signing_key)
  ) return "caller_evidence_mismatch";
  if (evidence.lifecycle === "unknown") return "indeterminate";
  const issued = new Date(binding.issued_at).getTime();
  const starts = new Date(evidence.valid_from).getTime();
  const ends = evidence.valid_until === null ? null : new Date(evidence.valid_until).getTime();
  return issued >= starts && (ends === null || issued < ends)
    ? "caller_evidence_matches"
    : "caller_evidence_mismatch";
}

function evidenceAssessment(
  binding: Readonly<PublicSurfaceBinding>,
  observation: Readonly<PublicSurfaceObservation> | null,
): "matches" | "mismatch" | "not_supplied" {
  if (observation === null) return "not_supplied";
  return observation.evidence_id === binding.observation_id
    && observation.origin === binding.origin
    && observation.request.method === "GET"
    && observation.final_url !== null
    && new URL(observation.final_url).origin === binding.origin
    && observation.body_sha256 === binding.observed_body_sha256
    && new Date(observation.request.ended_at).getTime() <= new Date(binding.issued_at).getTime()
    ? "matches"
    : "mismatch";
}

function originAssessment(
  binding: Readonly<PublicSurfaceBinding>,
  observation: Readonly<PublicSurfaceObservation> | null,
  evaluatedAt: string,
): OriginConfirmationAssessment {
  if (observation === null) return "not_supplied";
  const expectedUrl = `${binding.origin}${PUBLICATION_PATH}`;
  if (
    observation.origin !== binding.origin
    || observation.request_url !== expectedUrl
    || observation.final_url !== expectedUrl
    || observation.redirect_chain.length !== 0
  ) return "origin_mismatch";
  const observedStart = new Date(observation.request.started_at).getTime();
  const observedEnd = new Date(observation.request.ended_at).getTime();
  if (
    observedStart < new Date(binding.issued_at).getTime()
    || observedEnd > new Date(evaluatedAt).getTime()
  ) return "indeterminate";
  const bindingBytes = encodeCanonicalRecord(binding);
  if (
    observation.request.method !== "GET"
    || observation.status_code !== 200
    || observation.media_type !== "application/json"
    || observation.bytes !== bindingBytes.byteLength
    || observation.body_sha256 !== canonicalRecordSha256(binding)
  ) return "body_mismatch";
  return "observed_at_time";
}

function freshness(binding: Readonly<PublicSurfaceBinding>, evaluatedAt: string): "current" | "not_yet_valid" | "expired" {
  const evaluated = new Date(evaluatedAt).getTime();
  if (evaluated < new Date(binding.not_before).getTime()) return "not_yet_valid";
  if (evaluated >= new Date(binding.expires_at).getTime()) return "expired";
  return "current";
}

function evidenceAuthorizesAt(
  evidence: Readonly<IdentityKeyEvidence>,
  revocation: Readonly<PublicSurfaceRevocation>,
): boolean | null {
  if (evidence.lifecycle === "unknown") return null;
  if (
    evidence.identity_namespace !== revocation.subject.identity_namespace
    || evidence.identity_id !== revocation.subject.identity_id
    || !sameAuthority(evidence.signing_key, revocation.subject.signing_key)
  ) return false;
  const at = new Date(revocation.revoked_at).getTime();
  const from = new Date(evidence.valid_from).getTime();
  const until = evidence.valid_until === null ? null : new Date(evidence.valid_until).getTime();
  return at >= from && (until === null || at < until);
}

function assessRevocations(options: {
  binding: Readonly<PublicSurfaceBinding>;
  evaluated_at: string;
  revocations: Readonly<PublicSurfaceRevocation>[] | null;
  key_evidence: Readonly<IdentityKeyEvidence>[];
}): RevocationAssessment {
  if (options.revocations === null) return "indeterminate";
  if (options.revocations.length === 0) return "not_observed";
  let indeterminate = false;
  for (const revocation of options.revocations) {
    const core = revocationCore(revocation);
    const integrity = revocation.revocation_id === fullRevocationId(core, revocation.signature);
    const signature = verifyPublicSurfaceRevocationSignature(revocation) === "valid";
    const sameSubject = revocation.subject.identity_namespace === options.binding.subject.identity_namespace
      && revocation.subject.identity_id === options.binding.subject.identity_id;
    const sameBindingKey = sameAuthority(revocation.subject.signing_key, options.binding.subject.signing_key);
    const time = new Date(revocation.revoked_at).getTime();
    const timeApplies = time >= new Date(options.binding.issued_at).getTime()
      && time <= new Date(options.evaluated_at).getTime();
    const alternateAuthorization = sameBindingKey
      ? true
      : options.key_evidence.map((evidence) => evidenceAuthorizesAt(evidence, revocation)).find((result) => result === true) ?? null;
    if (
      integrity
      && signature
      && revocation.binding_id === options.binding.binding_id
      && sameSubject
      && timeApplies
      && alternateAuthorization === true
    ) return "revoked";
    indeterminate = true;
  }
  return indeterminate ? "indeterminate" : "not_observed";
}

function assessmentCore(value: PublicSurfaceAssessment): PublicSurfaceAssessmentCore {
  const { assessment_id: _assessmentId, ...core } = value;
  return core;
}

function boundedAssessmentLane(value: JsonValue, path: string): JsonValue[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) invalid(`${path} must be null or an array.`, path);
  if (value.length > LIMITS.max_assessment_evidence_items) {
    limit(`${path} exceeds ${LIMITS.max_assessment_evidence_items} entries.`, path);
  }
  return value;
}

function sortedUniqueDocumentShas(values: Sha256Id[], path: string): Sha256Id[] {
  const sorted = values.sort();
  if (new Set(sorted).size !== sorted.length) invalid(`${path} must not contain duplicate documents.`, path);
  return sorted;
}

export function assessPublicSurfaceBinding(input: AssessPublicSurfaceBindingInput): Readonly<PublicSurfaceAssessment> {
  const snapshot = snapshotJsonData(input) as JsonValue;
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") invalid("Assessment input must be an object.");
  const keys = Object.keys(snapshot).sort();
  const expectedKeys = ["binding", "evaluated_at", "key_evidence", "observation", "origin_observation", "revocations", "revocation_key_evidence"].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    invalid("Assessment input must contain every explicit evidence lane.");
  }
  const revocationInput = boundedAssessmentLane(snapshot.revocations!, "$assessment_input.revocations");
  const revocationEvidenceInput = boundedAssessmentLane(
    snapshot.revocation_key_evidence!,
    "$assessment_input.revocation_key_evidence",
  );
  if ((revocationInput === null) !== (revocationEvidenceInput === null)) {
    invalid("Revocations and revocation key evidence must both be null or both be arrays.", "$assessment_input");
  }
  const evaluatedAt = assertCanonicalInstant(snapshot.evaluated_at!, "$assessment_input.evaluated_at");
  const binding = validatePublicSurfaceBindingShape(snapshot.binding);
  const bindingDocumentSha = canonicalRecordSha256(binding);
  const bindingCoreValue = bindingCore(binding);
  const integrity = binding.binding_id === fullBindingId(bindingCoreValue, binding.signature) ? "valid" : "invalid";
  const signature = verifyPublicSurfaceBindingSignature(binding);
  const keyEvidence = snapshot.key_evidence === null ? null : validateIdentityKeyEvidence(snapshot.key_evidence);
  const keyEvidenceDocumentSha = keyEvidence === null ? null : canonicalRecordSha256(keyEvidence);
  const observation = snapshot.observation === null ? null : validatePublicSurfaceObservation(snapshot.observation);
  const originObservation = snapshot.origin_observation === null ? null : validatePublicSurfaceObservation(snapshot.origin_observation);
  const revocationValues = revocationInput === null
    ? null
    : revocationInput.map((value) => validatePublicSurfaceRevocationShape(value));
  const revocationEvidence = revocationEvidenceInput === null
    ? null
    : revocationEvidenceInput.map((value) => validateIdentityKeyEvidence(value));

  const keyAuthorization = keyEvidenceAssessment(binding, keyEvidence);
  const evidenceMatch = evidenceAssessment(binding, observation);
  const originConfirmation = originAssessment(binding, originObservation, evaluatedAt);
  const revocation = assessRevocations({
    binding,
    evaluated_at: evaluatedAt,
    revocations: revocationValues,
    key_evidence: revocationEvidence ?? [],
  });
  const revocationIds = revocationValues === null
    ? null
    : revocationValues.map((value) => value.revocation_id).sort();
  if (revocationIds !== null && new Set(revocationIds).size !== revocationIds.length) {
    invalid("Revocation corpus must not contain duplicate IDs.");
  }
  const revocationDocumentShas = revocationValues === null
    ? null
    : sortedUniqueDocumentShas(
        revocationValues.map((value) => canonicalRecordSha256(value)),
        "$assessment_input.revocations",
      );
  const revocationKeyRefs = revocationEvidence === null
    ? null
    : revocationEvidence.map((value) => value.source_ref).sort();
  if (revocationKeyRefs !== null && new Set(revocationKeyRefs).size !== revocationKeyRefs.length) {
    invalid("Revocation key evidence must not contain duplicate source refs.");
  }
  const revocationKeyDocumentShas = revocationEvidence === null
    ? null
    : sortedUniqueDocumentShas(
        revocationEvidence.map((value) => canonicalRecordSha256(value)),
        "$assessment_input.revocation_key_evidence",
      );
  const core: PublicSurfaceAssessmentCore = {
    schema: RECORD_SCHEMAS.assessment,
    binding_id: binding.binding_id,
    evaluated_at: evaluatedAt,
    inputs: {
      binding_document_sha256: bindingDocumentSha,
      key_evidence_ref: keyEvidence?.source_ref ?? null,
      key_evidence_sha256: keyEvidenceDocumentSha,
      observation_id: observation?.evidence_id ?? null,
      origin_observation_id: originObservation?.evidence_id ?? null,
      revocation_ids: revocationIds,
      revocation_document_sha256s: revocationDocumentShas,
      revocation_key_evidence_refs: revocationKeyRefs,
      revocation_key_evidence_sha256s: revocationKeyDocumentShas,
    },
    integrity,
    signature,
    key_authorization: keyAuthorization,
    evidence_match: evidenceMatch,
    origin_confirmation: originConfirmation,
    freshness: freshness(binding, evaluatedAt),
    revocation,
    establishes: [
      ...(signature === "valid" ? ["key_holder_signed_claim" as const] : []),
      ...(keyAuthorization === "caller_evidence_matches" ? ["caller_key_evidence_match" as const] : []),
      ...(originConfirmation === "observed_at_time" ? ["origin_served_exact_binding_bytes" as const] : []),
    ],
    does_not_establish: [...ASSESSMENT_NON_CLAIMS],
    authority: "none",
    score: null,
    wake_effect: false,
    memory_effect: false,
    karma_effect: false,
    training_effect: false,
  };
  const candidate = validatePublicSurfaceAssessment({
    ...core,
    assessment_id: domainSeparatedId(SIGNING_DOMAINS.assessment_id, core),
  });
  return candidate;
}

export function publicSurfaceAssessmentId(value: PublicSurfaceAssessmentCore): Sha256Id {
  const core = validatePublicSurfaceAssessmentCore(value);
  return domainSeparatedId(SIGNING_DOMAINS.assessment_id, core);
}

export function publicSurfaceBindingDocumentSha256(value: unknown): Sha256Id {
  return canonicalRecordSha256(validatePublicSurfaceBinding(value));
}
