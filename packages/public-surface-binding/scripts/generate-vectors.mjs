import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  BINDING_BOUNDARIES,
  OBSERVATION_BOUNDARIES,
  PACKAGE_VERSION,
  PUBLICATION_PATH,
  RECORD_SCHEMAS,
  SIGNING_DOMAINS,
  assessPublicSurfaceBinding,
  canonicalJson,
  canonicalRecordSha256,
  createPublicSurfaceObservation,
  encodeCanonicalRecord,
  sealPublicSurfaceBinding,
  sealPublicSurfaceRevocation,
  signingBytes,
  surfaceBindingDigest,
  surfaceRevocationDigest,
} from "../dist/index.js";

const packageRoot = new URL("..", import.meta.url);
const vectorUrl = new URL("vectors/agenttool-public-surface-binding-v0.1-vectors.json", packageRoot);
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index);

function withNobleSha512(operation) {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages) => {
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

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

const signer = {
  public_key: base64(withNobleSha512(() => ed25519.getPublicKey(privateKey))),
  sign_digest(digest) {
    return base64(withNobleSha512(() => ed25519.sign(digest, privateKey)));
  },
};

function observationCore() {
  return {
    schema: RECORD_SCHEMAS.observation,
    origin: "https://surface.agenttool.dev",
    request_url: "https://surface.agenttool.dev/agent.txt",
    request: {
      method: "GET",
      credential_mode: "omit",
      started_at: "2026-08-16T12:00:00.000Z",
      ended_at: "2026-08-16T12:00:00.250Z",
      crawler_version: "agenttool-vector-crawler/0.1",
    },
    status_code: 200,
    final_url: "https://surface.agenttool.dev/agent.txt",
    redirect_chain: [],
    media_type: "text/plain",
    bytes: 37,
    body_sha256: canonicalRecordSha256({ fixture: "observed-agent-body-v1" }),
    collector: {
      name: "agenttool-vector-collector",
      version: "0.1.0",
      report_schema: "agenttool.vector-collector-report/0.1",
      report_sha256: canonicalRecordSha256({ fixture: "collector-report-v1" }),
      source_id: "deterministic-vector",
    },
    robots: {
      source: "rfc9309_snapshot",
      robots_url: "https://surface.agenttool.dev/robots.txt",
      snapshot_sha256: canonicalRecordSha256({ fixture: "robots-body-v1" }),
      matched_group: "agenttool-vector-crawler",
      directive: "allow",
      is_access_authorization: false,
    },
    usage_preferences: [{
      namespace: "tdmrep",
      category: "model-training",
      value: "disallowed",
      is_permission: false,
    }],
    request_authentication: {
      kind: "web_bot_auth",
      status: "verified",
      verifier: "deterministic-vector-verifier",
      protocol_variant: "message-signatures/vector-v1",
      claimed_identity_url: "https://crawler.agenttool.dev/identity",
      key_thumbprint: canonicalRecordSha256({ fixture: "crawler-key-v1" }),
      covered_components: ["@method", "@target-uri"],
      nonce_checked: true,
    },
    boundaries: OBSERVATION_BOUNDARIES,
  };
}

function recordDetails(record) {
  const bytes = encodeCanonicalRecord(record);
  return {
    canonical_json: canonicalJson(record),
    canonical_utf8_hex: hex(bytes),
    canonical_sha256: canonicalRecordSha256(record),
    record,
  };
}

const observationCoreValue = observationCore();
const observation = createPublicSurfaceObservation(observationCoreValue);
const bindingCore = {
  schema: RECORD_SCHEMAS.binding,
  subject: {
    identity_namespace: "agenttool-local",
    identity_id: "11111111-1111-4111-8111-111111111111",
    signing_key: {
      algorithm: "Ed25519",
      key_id: "22222222-2222-4222-8222-222222222222",
      public_key: signer.public_key,
    },
  },
  origin: "https://surface.agenttool.dev",
  observation_id: observation.evidence_id,
  observed_body_sha256: observation.body_sha256,
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
const binding = await sealPublicSurfaceBinding(bindingCore, signer);

const bindingBytes = encodeCanonicalRecord(binding);
const originObservationCore = {
  ...observationCore(),
  request_url: `${binding.origin}${PUBLICATION_PATH}`,
  request: {
    ...observationCoreValue.request,
    started_at: "2026-08-16T12:01:30.000Z",
    ended_at: "2026-08-16T12:01:31.000Z",
  },
  final_url: `${binding.origin}${PUBLICATION_PATH}`,
  media_type: "application/json",
  bytes: bindingBytes.byteLength,
  body_sha256: canonicalRecordSha256(binding),
};
const originObservation = createPublicSurfaceObservation(originObservationCore);

const keyEvidence = {
  identity_namespace: "agenttool-local",
  identity_id: binding.subject.identity_id,
  signing_key: binding.subject.signing_key,
  relationship: "assertion",
  lifecycle: "active",
  valid_from: "2026-08-01T00:00:00.000Z",
  valid_until: null,
  source_ref: canonicalRecordSha256({ fixture: "identity-key-evidence-v1" }),
  basis: "caller_supplied_key_evidence",
};

const revocationCore = {
  schema: RECORD_SCHEMAS.revocation,
  binding_id: binding.binding_id,
  subject: binding.subject,
  revoked_at: "2026-08-16T12:03:00.000Z",
  reason: "withdrawn",
  superseded_by: null,
  nonce: base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 16)),
};
const revocation = await sealPublicSurfaceRevocation(revocationCore, signer);

const currentAssessment = assessPublicSurfaceBinding({
  binding,
  evaluated_at: "2026-08-16T12:02:00.000Z",
  key_evidence: keyEvidence,
  observation,
  origin_observation: originObservation,
  revocations: [],
  revocation_key_evidence: [],
});
const revokedAssessment = assessPublicSurfaceBinding({
  binding,
  evaluated_at: "2026-08-16T12:04:00.000Z",
  key_evidence: keyEvidence,
  observation,
  origin_observation: originObservation,
  revocations: [revocation],
  revocation_key_evidence: [],
});

const orderingInput = {
  "\ufffd": "bmp-replacement-character",
  "\ud800\udc00": "supplementary-plane-character",
  nested: {
    "\ufffd": 2,
    "\ud800\udc00": 1,
  },
};
const stringProfileInput = {
  quote: "\"",
  backslash: "\\",
  controls: "\b\t\n\f\r\u0001\u001f",
  slash: "</script>",
  line_separator: "\u2028",
  composed: "\u00e9",
  decomposed: "e\u0301",
};

const vectors = {
  format: "agenttool.public-surface-binding-vectors/0.1",
  package_version: PACKAGE_VERSION,
  warning: "TEST ONLY: the private seed is public and must never authorize a real identity.",
  deterministic_key: {
    private_seed_hex: hex(privateKey),
    public_key_base64: signer.public_key,
  },
  canonical_utf16_ordering: {
    rule: "object member names sort by ascending UTF-16 code-unit order recursively",
    input: orderingInput,
    canonical_json: canonicalJson(orderingInput),
    canonical_utf8_hex: hex(encodeCanonicalRecord(orderingInput)),
  },
  canonical_string_profile: {
    rule: "ECMAScript JSON escaping, unescaped slash and U+2028, and no Unicode normalization",
    input: stringProfileInput,
    canonical_json: canonicalJson(stringProfileInput),
    canonical_utf8_hex: hex(encodeCanonicalRecord(stringProfileInput)),
  },
  observation: {
    id_domain: SIGNING_DOMAINS.observation_id,
    core: observationCoreValue,
    evidence_id: observation.evidence_id,
    ...recordDetails(observation),
  },
  binding: {
    signature_domain: SIGNING_DOMAINS.binding,
    id_domain: SIGNING_DOMAINS.binding_id,
    core: bindingCore,
    core_canonical_json: canonicalJson(bindingCore),
    signing_bytes_hex: hex(signingBytes(SIGNING_DOMAINS.binding, bindingCore)),
    signing_digest_hex: hex(surfaceBindingDigest(bindingCore)),
    signature_base64: binding.signature.value,
    binding_id: binding.binding_id,
    ...recordDetails(binding),
  },
  origin_observation: {
    id_domain: SIGNING_DOMAINS.observation_id,
    expected_binding_body_sha256: canonicalRecordSha256(binding),
    expected_binding_bytes: bindingBytes.byteLength,
    core: originObservationCore,
    evidence_id: originObservation.evidence_id,
    ...recordDetails(originObservation),
  },
  key_evidence: keyEvidence,
  revocation: {
    signature_domain: SIGNING_DOMAINS.revocation,
    id_domain: SIGNING_DOMAINS.revocation_id,
    core: revocationCore,
    core_canonical_json: canonicalJson(revocationCore),
    signing_bytes_hex: hex(signingBytes(SIGNING_DOMAINS.revocation, revocationCore)),
    signing_digest_hex: hex(surfaceRevocationDigest(revocationCore)),
    signature_base64: revocation.signature.value,
    revocation_id: revocation.revocation_id,
    ...recordDetails(revocation),
  },
  current_assessment: recordDetails(currentAssessment),
  revoked_assessment: recordDetails(revokedAssessment),
};

const generated = `${JSON.stringify(vectors, null, 2)}\n`;
if (process.argv.includes("--check")) {
  let existing;
  try {
    existing = await readFile(vectorUrl, "utf8");
  } catch {
    throw new Error("deterministic vector file is missing; run bun run generate:vectors");
  }
  if (existing !== generated) {
    throw new Error("deterministic vector file differs; run bun run generate:vectors");
  }
  process.stdout.write("verified deterministic public-surface-binding vectors\n");
} else {
  await mkdir(new URL("vectors/", packageRoot), { recursive: true });
  await writeFile(vectorUrl, generated, "utf8");
  process.stdout.write("generated deterministic public-surface-binding vectors\n");
}
