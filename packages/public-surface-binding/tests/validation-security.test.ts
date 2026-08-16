import { describe, expect, test } from "bun:test";

import { PublicSurfaceBindingError } from "../src/errors.js";
import type {
  IdentityKeyEvidence,
  PublicSurfaceAssessmentCore,
  PublicSurfaceBindingCore,
  PublicSurfaceObservationCore,
  PublicSurfaceRevocationCore,
} from "../src/types.js";
import {
  validateIdentityKeyEvidence,
  validatePublicSurfaceAssessmentCore,
  validatePublicSurfaceBindingCore,
  validatePublicSurfaceObservationCore,
  validatePublicSurfaceRevocationCore,
} from "../src/validation.js";
import {
  ASSESSMENT,
  BINDING,
  GET_OBSERVATION,
  REVOCATION,
  SHA_A,
  SHA_B,
  SHA_G,
  SUBJECT,
} from "./fixtures.js";

function observationCore(): PublicSurfaceObservationCore {
  const { evidence_id: _evidenceId, ...core } = structuredClone(GET_OBSERVATION);
  return core;
}

function bindingCore(): PublicSurfaceBindingCore {
  const { binding_id: _bindingId, signature: _signature, ...core } = structuredClone(BINDING);
  return core;
}

function revocationCore(): PublicSurfaceRevocationCore {
  const { revocation_id: _revocationId, signature: _signature, ...core } = structuredClone(REVOCATION);
  return core;
}

function assessmentCore(): PublicSurfaceAssessmentCore {
  const { assessment_id: _assessmentId, ...core } = structuredClone(ASSESSMENT);
  return core;
}

function keyEvidence(): IdentityKeyEvidence {
  return {
    identity_namespace: "agenttool-local",
    identity_id: SUBJECT.identity_id,
    signing_key: structuredClone(SUBJECT.signing_key),
    relationship: "assertion",
    lifecycle: "active",
    valid_from: "2026-08-01T00:00:00.000Z",
    valid_until: null,
    source_ref: SHA_G,
    basis: "caller_supplied_key_evidence",
  };
}

function expectInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error("expected invalid input");
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSurfaceBindingError);
    expect((error as PublicSurfaceBindingError).code).toBe("INVALID_INPUT");
  }
}

describe("closed semantic validation", () => {
  test("accepts exact cores and returns detached frozen snapshots", () => {
    const observationInput = observationCore();
    const bindingInput = bindingCore();
    const revocationInput = revocationCore();
    const assessmentInput = assessmentCore();
    const evidenceInput = keyEvidence();
    const inputs = [observationInput, bindingInput, revocationInput, assessmentInput, evidenceInput];
    const values = [
      validatePublicSurfaceObservationCore(observationInput),
      validatePublicSurfaceBindingCore(bindingInput),
      validatePublicSurfaceRevocationCore(revocationInput),
      validatePublicSurfaceAssessmentCore(assessmentInput),
      validateIdentityKeyEvidence(evidenceInput),
    ];
    for (const [index, value] of values.entries()) {
      expect(Object.isFrozen(value)).toBe(true);
      expect(value).not.toBe(inputs[index]);
    }
    expect(Object.isFrozen(values[0]!.collector)).toBe(true);
    expect(Object.isFrozen(values[1]!.subject.signing_key)).toBe(true);
    expect(Object.isFrozen(values[3]!.inputs)).toBe(true);
    observationInput.collector.name = "mutated-after-validation";
    expect(values[0]).not.toEqual(observationInput);
  });

  test("rejects reserved, local, numeric, noncanonical, credentialed, and alternate-port origins", () => {
    const invalidOrigins = [
      "http://surface.agenttool.dev",
      "https://example.com",
      "https://example.org",
      "https://localhost",
      "https://service.localhost",
      "https://service.test",
      "https://service.invalid",
      "https://service.example",
      "https://127.0.0.1",
      "https://[::1]",
      "https://surface.agenttool.dev:443",
      "https://surface.agenttool.dev:8443",
      "https://user@surface.agenttool.dev",
      "https://SURFACE.agenttool.dev",
      "https://surface.agenttool.dev/",
      "https://surface.agenttool.dev?query=1",
      "https://surface.agenttool.dev#fragment",
    ];
    for (const origin of invalidOrigins) {
      const core = observationCore();
      core.origin = origin;
      core.request_url = `${origin}/agent.txt`;
      core.final_url = core.request_url;
      expectInvalid(() => validatePublicSurfaceObservationCore(core));
    }
  });

  test("rejects unsafe URLs even when the declared origin itself remains public", () => {
    for (const requestUrl of [
      "https://example.com/agent.txt",
      "https://localhost/agent.txt",
      "https://127.0.0.1/agent.txt",
      "https://[::1]/agent.txt",
      "https://surface.agenttool.dev:8443/agent.txt",
      "https://user@surface.agenttool.dev/agent.txt",
      "https://surface.agenttool.dev/agent.txt#fragment",
      "https://surface.agenttool.dev/agent.txt?",
      "https://surface.agenttool.dev/agent.txt#",
      "https://surface.agenttool.dev/agent.txt?#",
      "https://surface.agenttool.dev/%",
      "https://surface.agenttool.dev/%2",
      "https://surface.agenttool.dev/%zz",
      "https://surface.agenttool.dev/%2f",
      "https://surface.agenttool.dev/%41",
      "https://surface.agenttool.dev/a|b",
      "https://surface.agenttool.dev/a[b",
      "https://surface.agenttool.dev/a]b",
    ]) {
      const core = observationCore();
      core.request_url = requestUrl;
      core.final_url = requestUrl;
      expectInvalid(() => validatePublicSurfaceObservationCore(core));
    }

    const canonicalPath = observationCore();
    canonicalPath.request_url = "https://surface.agenttool.dev/a-._~!$&'()*+,;=:@/b%2Fc/%C3%A9";
    canonicalPath.final_url = canonicalPath.request_url;
    expect(() => validatePublicSurfaceObservationCore(canonicalPath)).not.toThrow();
  });

  test("accepts a bounded typed redirect chain without coercing integer status codes", () => {
    const core = observationCore();
    core.redirect_chain = [{
      status_code: 301,
      location: "https://surface.agenttool.dev/canonical-agent.txt",
    }];
    core.final_url = "https://surface.agenttool.dev/canonical-agent.txt";
    expect(() => validatePublicSurfaceObservationCore(core)).not.toThrow();

    const unsupported = structuredClone(core);
    unsupported.redirect_chain[0]!.status_code = 306;
    expectInvalid(() => validatePublicSurfaceObservationCore(unsupported));
  });

  test("keeps verified web-bot identity URLs and non-none verifiers explicit", () => {
    const verifiedWebBot = observationCore();
    verifiedWebBot.request_authentication = {
      kind: "web_bot_auth",
      status: "verified",
      verifier: "fixture-verifier",
      protocol_variant: "message-signatures/fixture",
      claimed_identity_url: null,
      key_thumbprint: SHA_A,
      covered_components: ["@method"],
      nonce_checked: true,
    };
    expectInvalid(() => validatePublicSurfaceObservationCore(verifiedWebBot));

    const provider = structuredClone(verifiedWebBot);
    provider.request_authentication.kind = "provider_attestation";
    expect(() => validatePublicSurfaceObservationCore(provider)).not.toThrow();

    provider.request_authentication.verifier = "none";
    expectInvalid(() => validatePublicSurfaceObservationCore(provider));
  });

  test("binds final_url to the actually observed redirect terminus", () => {
    const withoutRedirect = observationCore();
    withoutRedirect.final_url = "https://surface.agenttool.dev/not-the-request";
    expectInvalid(() => validatePublicSurfaceObservationCore(withoutRedirect));

    const redirected = observationCore();
    redirected.redirect_chain = [{
      status_code: 308,
      location: "https://cdn.agenttool.dev/exact-body",
    }];
    redirected.final_url = "https://surface.agenttool.dev/stale-final";
    expectInvalid(() => validatePublicSurfaceObservationCore(redirected));

    redirected.final_url = "https://cdn.agenttool.dev/exact-body";
    expect(() => validatePublicSurfaceObservationCore(redirected)).not.toThrow();
  });

  test("enforces the aggregate canonical-byte bound on otherwise bounded observation fields", () => {
    const oversized = observationCore();
    oversized.usage_preferences = Array.from({ length: 16 }, (_, index) => ({
      namespace: `${index.toString().padStart(2, "0")}-${"n".repeat(4_060)}`,
      category: `${"c".repeat(4_060)}-${index.toString().padStart(2, "0")}`,
      value: "unknown" as const,
      is_permission: false as const,
    }));
    try {
      validatePublicSurfaceObservationCore(oversized);
      throw new Error("expected aggregate limit failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicSurfaceBindingError);
      expect((error as PublicSurfaceBindingError).code).toBe("LIMIT_EXCEEDED");
    }
  });

  test("rejects noncanonical timestamps, reversed windows, UUIDs, and binding lifetimes", () => {
    const badObservationTime = observationCore();
    badObservationTime.request.started_at = "2026-08-16T12:00:00Z";
    expectInvalid(() => validatePublicSurfaceObservationCore(badObservationTime));

    const reversedObservation = observationCore();
    reversedObservation.request.ended_at = "2026-08-16T11:59:59.999Z";
    expectInvalid(() => validatePublicSurfaceObservationCore(reversedObservation));

    const uppercaseIdentity = bindingCore();
    uppercaseIdentity.subject.identity_id = "11111111-1111-4111-8111-AAAAAAAAAAAA";
    expectInvalid(() => validatePublicSurfaceBindingCore(uppercaseIdentity));

    const reversedBinding = bindingCore();
    reversedBinding.not_before = "2026-08-16T12:00:59.999Z";
    expectInvalid(() => validatePublicSurfaceBindingCore(reversedBinding));

    const overlongBinding = bindingCore();
    overlongBinding.expires_at = "2026-09-16T12:01:00.001Z";
    expectInvalid(() => validatePublicSurfaceBindingCore(overlongBinding));

    const reversedEvidence = keyEvidence();
    reversedEvidence.lifecycle = "revoked";
    reversedEvidence.valid_until = "2026-07-31T23:59:59.999Z";
    expectInvalid(() => validateIdentityKeyEvidence(reversedEvidence));

    const unboundedRevoked = keyEvidence();
    unboundedRevoked.lifecycle = "revoked";
    expectInvalid(() => validateIdentityKeyEvidence(unboundedRevoked));

    const boundedActive = keyEvidence();
    boundedActive.valid_until = "2026-09-01T00:00:00.000Z";
    expectInvalid(() => validateIdentityKeyEvidence(boundedActive));
  });

  test("rejects proxies and accessors before caller code runs", () => {
    let getterRan = false;
    const accessor = observationCore() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "origin", {
      enumerable: true,
      get() {
        getterRan = true;
        return "https://surface.agenttool.dev";
      },
    });
    expectInvalid(() => validatePublicSurfaceObservationCore(accessor));
    expect(getterRan).toBe(false);

    let proxyTrapRan = false;
    const proxy = new Proxy(observationCore(), {
      ownKeys() {
        proxyTrapRan = true;
        return [];
      },
    });
    expectInvalid(() => validatePublicSurfaceObservationCore(proxy));
    expect(proxyTrapRan).toBe(false);
  });

  test("pins sorted unique assessment provenance and preserves null versus empty", () => {
    const emptyCorpus = assessmentCore();
    emptyCorpus.inputs.revocation_ids = [];
    emptyCorpus.inputs.revocation_document_sha256s = [];
    emptyCorpus.inputs.revocation_key_evidence_refs = [];
    emptyCorpus.inputs.revocation_key_evidence_sha256s = [];
    expect(() => validatePublicSurfaceAssessmentCore(emptyCorpus)).not.toThrow();

    const absentCorpus = assessmentCore();
    absentCorpus.inputs.revocation_ids = null;
    absentCorpus.inputs.revocation_document_sha256s = null;
    absentCorpus.inputs.revocation_key_evidence_refs = null;
    absentCorpus.inputs.revocation_key_evidence_sha256s = null;
    absentCorpus.revocation = "indeterminate";
    expect(() => validatePublicSurfaceAssessmentCore(absentCorpus)).not.toThrow();

    const duplicate = assessmentCore();
    duplicate.inputs.revocation_ids = [SHA_A, SHA_A];
    expectInvalid(() => validatePublicSurfaceAssessmentCore(duplicate));

    const unsorted = assessmentCore();
    unsorted.inputs.revocation_ids = [SHA_B, SHA_A];
    expectInvalid(() => validatePublicSurfaceAssessmentCore(unsorted));

    const unpairedKeyDocument = assessmentCore();
    unpairedKeyDocument.inputs.key_evidence_sha256 = null;
    expectInvalid(() => validatePublicSurfaceAssessmentCore(unpairedKeyDocument));

    const unpairedRevocationDocuments = assessmentCore();
    unpairedRevocationDocuments.inputs.revocation_document_sha256s = null;
    expectInvalid(() => validatePublicSurfaceAssessmentCore(unpairedRevocationDocuments));

    const emptyIndeterminate = assessmentCore();
    emptyIndeterminate.revocation = "indeterminate";
    expectInvalid(() => validatePublicSurfaceAssessmentCore(emptyIndeterminate));

    const missingRevocationDocument = assessmentCore();
    missingRevocationDocument.revocation = "indeterminate";
    missingRevocationDocument.inputs.revocation_ids = [SHA_A];
    expectInvalid(() => validatePublicSurfaceAssessmentCore(missingRevocationDocument));

    const missingRevocationKeyDocument = assessmentCore();
    missingRevocationKeyDocument.inputs.revocation_key_evidence_refs = [SHA_A];
    expectInvalid(() => validatePublicSurfaceAssessmentCore(missingRevocationKeyDocument));
  });

  test("rejects unknown fields instead of admitting identity, score, or training upgrades", () => {
    for (const [value, validate] of [
      [observationCore(), validatePublicSurfaceObservationCore],
      [bindingCore(), validatePublicSurfaceBindingCore],
      [revocationCore(), validatePublicSurfaceRevocationCore],
      [assessmentCore(), validatePublicSurfaceAssessmentCore],
      [keyEvidence(), validateIdentityKeyEvidence],
    ] as const) {
      const widened = { ...value, inferred_identity: SUBJECT.identity_id };
      expectInvalid(() => validate(widened));
    }

    const trainingUpgrade = bindingCore() as unknown as {
      boundaries: { training_authorized: boolean };
    };
    trainingUpgrade.boundaries.training_authorized = true;
    expectInvalid(() => validatePublicSurfaceBindingCore(trainingUpgrade));

    const scored = assessmentCore() as unknown as { score: number | null };
    scored.score = 1;
    expectInvalid(() => validatePublicSurfaceAssessmentCore(scored));
  });
});
