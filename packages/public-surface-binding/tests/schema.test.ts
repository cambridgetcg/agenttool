import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, test } from "bun:test";

import {
  ASSESSMENT,
  BINDING,
  GET_OBSERVATION,
  REVOCATION,
  SHA_A,
} from "./fixtures.js";

const schemaDirectory = join(import.meta.dir, "../schema");
const schemaFiles = {
  observation: "agenttool-public-surface-observation-v0.1.schema.json",
  binding: "agenttool-public-surface-binding-v0.1.schema.json",
  revocation: "agenttool-public-surface-revocation-v0.1.schema.json",
  assessment: "agenttool-public-surface-assessment-v0.1.schema.json",
} as const;

async function schemas(): Promise<Record<keyof typeof schemaFiles, Record<string, unknown>>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(schemaFiles).map(async ([key, file]) => [
        key,
        JSON.parse(await readFile(join(schemaDirectory, file), "utf8")) as Record<string, unknown>,
      ]),
    ),
  ) as Record<keyof typeof schemaFiles, Record<string, unknown>>;
}

function objectSchemasAreClosed(value: unknown, path = "$schema"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectSchemasAreClosed(item, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  const failures = record.type === "object" && record.additionalProperties !== false
    ? [path]
    : [];
  return failures.concat(
    Object.entries(record).flatMap(([key, nested]) => objectSchemasAreClosed(nested, `${path}.${key}`)),
  );
}

function compiler(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv;
}

async function validators(): Promise<Record<keyof typeof schemaFiles, ValidateFunction>> {
  const loaded = await schemas();
  const ajv = compiler();
  return Object.fromEntries(
    Object.entries(loaded).map(([kind, schema]) => [kind, ajv.compile(schema)]),
  ) as Record<keyof typeof schemaFiles, ValidateFunction>;
}

describe("closed Draft 2020-12 schemas", () => {
  test("all four schemas declare Draft 2020-12, compile strictly, and close every object", async () => {
    const loaded = await schemas();
    const ajv = compiler();
    for (const [kind, schema] of Object.entries(loaded)) {
      expect(schema.$schema, kind).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id, kind).toBe(
        `https://agenttool.dev/schema/${schemaFiles[kind as keyof typeof schemaFiles]}`,
      );
      expect(objectSchemasAreClosed(schema), kind).toEqual([]);
      expect(() => ajv.compile(schema), kind).not.toThrow();
    }
  });

  test("schema validators are independent and reject an empty record", async () => {
    for (const [kind, validate] of Object.entries(await validators())) {
      expect(validate({}), kind).toBe(false);
      expect(validate.errors?.some((error) => error.keyword === "required"), kind).toBe(true);
    }
  });

  test("accepts one exact fixture for every record and rejects unknown fields", async () => {
    const validate = await validators();
    const fixtures = {
      observation: GET_OBSERVATION,
      binding: BINDING,
      revocation: REVOCATION,
      assessment: ASSESSMENT,
    } as const;
    for (const [kind, fixture] of Object.entries(fixtures)) {
      expect(validate[kind as keyof typeof validate](fixture), kind).toBe(true);
      const widened = { ...structuredClone(fixture), inferred_identity: true };
      expect(validate[kind as keyof typeof validate](widened), kind).toBe(false);
    }
  });

  test("pins no-response, GET-body, and HEAD-without-body observation branches", async () => {
    const { observation } = await validators();
    expect(observation(GET_OBSERVATION)).toBe(true);

    const head = structuredClone(GET_OBSERVATION);
    head.request.method = "HEAD";
    head.bytes = 0;
    head.body_sha256 = null;
    expect(observation(head), JSON.stringify(observation.errors)).toBe(true);

    const noResponse = structuredClone(GET_OBSERVATION);
    noResponse.status_code = null;
    noResponse.final_url = null;
    noResponse.media_type = null;
    noResponse.bytes = null;
    noResponse.body_sha256 = null;
    expect(observation(noResponse), JSON.stringify(observation.errors)).toBe(true);

    const getWithoutBody = structuredClone(GET_OBSERVATION);
    getWithoutBody.body_sha256 = null;
    expect(observation(getWithoutBody)).toBe(false);

    const headWithBody = structuredClone(head);
    headWithBody.body_sha256 = SHA_A;
    expect(observation(headWithBody)).toBe(false);

    const noResponseWithRedirect = structuredClone(noResponse);
    noResponseWithRedirect.redirect_chain.push({
      status_code: 302,
      location: "https://surface.agenttool.dev/next",
    });
    expect(observation(noResponseWithRedirect)).toBe(false);
  });

  test("structurally pins uppercase RFC 3986-style path percent triplets", async () => {
    const { observation } = await validators();
    const canonical = structuredClone(GET_OBSERVATION);
    canonical.request_url = "https://surface.agenttool.dev/a-._~!$&'()*+,;=:@/b%2Fc/%C3%A9";
    canonical.final_url = canonical.request_url;
    expect(observation(canonical), JSON.stringify(observation.errors)).toBe(true);

    const structurallyValidAlias = structuredClone(GET_OBSERVATION);
    structurallyValidAlias.request_url = "https://surface.agenttool.dev/%41";
    structurallyValidAlias.final_url = structurallyValidAlias.request_url;
    expect(observation(structurallyValidAlias), JSON.stringify(observation.errors)).toBe(true);

    for (const requestUrl of [
      "https://surface.agenttool.dev/%",
      "https://surface.agenttool.dev/%2",
      "https://surface.agenttool.dev/%zz",
      "https://surface.agenttool.dev/%2f",
      "https://surface.agenttool.dev/a|b",
      "https://surface.agenttool.dev/a[b",
      "https://surface.agenttool.dev/path?",
      "https://surface.agenttool.dev/path#",
    ]) {
      const invalidPath = structuredClone(GET_OBSERVATION);
      invalidPath.request_url = requestUrl;
      invalidPath.final_url = requestUrl;
      expect(observation(invalidPath), requestUrl).toBe(false);
    }
  });

  test("keeps crawler authentication, robots, usage preference, identity, and permission separate", async () => {
    const { observation } = await validators();
    const authenticatedCrawler = structuredClone(GET_OBSERVATION);
    authenticatedCrawler.request_authentication = {
      kind: "web_bot_auth",
      status: "verified",
      verifier: "fixture-verifier",
      protocol_variant: "message-signatures/fixture",
      claimed_identity_url: "https://crawler.agenttool.dev/identity",
      key_thumbprint: SHA_A,
      covered_components: ["@method", "@target-uri"],
      nonce_checked: true,
    };
    authenticatedCrawler.usage_preferences = [{
      namespace: "fixture",
      category: "model-training",
      value: "allowed",
      is_permission: false,
    }];
    expect(observation(authenticatedCrawler), JSON.stringify(observation.errors)).toBe(true);
    expect(authenticatedCrawler.boundaries.identity).toBe("not_inferred");
    expect(authenticatedCrawler.boundaries.training_permission).toBe("not_established");

    const webBotWithoutIdentityUrl = structuredClone(authenticatedCrawler);
    webBotWithoutIdentityUrl.request_authentication.claimed_identity_url = null;
    expect(observation(webBotWithoutIdentityUrl)).toBe(false);

    const providerWithoutIdentityUrl = structuredClone(webBotWithoutIdentityUrl);
    providerWithoutIdentityUrl.request_authentication.kind = "provider_attestation";
    expect(observation(providerWithoutIdentityUrl), JSON.stringify(observation.errors)).toBe(true);

    const nonNoneKindWithNoneVerifier = structuredClone(providerWithoutIdentityUrl);
    nonNoneKindWithNoneVerifier.request_authentication.verifier = "none";
    expect(observation(nonNoneKindWithNoneVerifier)).toBe(false);

    const robotsAsAuthorization = structuredClone(authenticatedCrawler) as unknown as {
      robots: { is_access_authorization: boolean };
    };
    robotsAsAuthorization.robots.is_access_authorization = true;
    expect(observation(robotsAsAuthorization)).toBe(false);

    const preferenceAsPermission = structuredClone(authenticatedCrawler) as unknown as {
      usage_preferences: Array<{ is_permission: boolean }>;
    };
    preferenceAsPermission.usage_preferences[0]!.is_permission = true;
    expect(observation(preferenceAsPermission)).toBe(false);

    const noAuthAsVerified = structuredClone(GET_OBSERVATION);
    noAuthAsVerified.request_authentication.status = "verified";
    expect(observation(noAuthAsVerified)).toBe(false);

    const uncollectedWithSnapshot = structuredClone(GET_OBSERVATION);
    uncollectedWithSnapshot.robots.robots_url = "https://surface.agenttool.dev/robots.txt";
    uncollectedWithSnapshot.robots.snapshot_sha256 = SHA_A;
    expect(observation(uncollectedWithSnapshot)).toBe(false);

    const unavailableRobots = structuredClone(GET_OBSERVATION);
    unavailableRobots.robots = {
      source: "rfc9309_snapshot",
      robots_url: "https://surface.agenttool.dev/robots.txt",
      snapshot_sha256: null,
      matched_group: null,
      directive: "unavailable",
      is_access_authorization: false,
    };
    expect(observation(unavailableRobots), JSON.stringify(observation.errors)).toBe(true);
  });

  test("rejects noncanonical UUIDs, weakened boundaries, and scoring/training upgrades", async () => {
    const validate = await validators();
    const uppercaseIdentity = structuredClone(BINDING);
    uppercaseIdentity.subject.identity_id = "11111111-1111-4111-8111-AAAAAAAAAAAA";
    expect(validate.binding(uppercaseIdentity)).toBe(false);

    const shaKeyId = structuredClone(BINDING);
    shaKeyId.subject.signing_key.key_id = SHA_A;
    expect(validate.binding(shaKeyId)).toBe(false);

    const training = structuredClone(BINDING);
    training.boundaries.training_authorized = true;
    expect(validate.binding(training)).toBe(false);

    const scored = structuredClone(ASSESSMENT) as unknown as Record<string, unknown>;
    scored.score = 1;
    expect(validate.assessment(scored)).toBe(false);

    const incompleteNonClaims = structuredClone(ASSESSMENT);
    incompleteNonClaims.does_not_establish.pop();
    expect(validate.assessment(incompleteNonClaims)).toBe(false);

    const unknownInput = structuredClone(ASSESSMENT) as unknown as {
      inputs: Record<string, unknown>;
    };
    unknownInput.inputs.reverse_origin_index = true;
    expect(validate.assessment(unknownInput)).toBe(false);
  });

  test("preserves null versus empty-set assessment provenance and rejects duplicate refs", async () => {
    const { assessment } = await validators();
    const completeEmptyRevocationSet = structuredClone(ASSESSMENT);
    completeEmptyRevocationSet.inputs.revocation_ids = [];
    completeEmptyRevocationSet.inputs.revocation_document_sha256s = [];
    completeEmptyRevocationSet.inputs.revocation_key_evidence_refs = [];
    completeEmptyRevocationSet.inputs.revocation_key_evidence_sha256s = [];
    expect(assessment(completeEmptyRevocationSet), JSON.stringify(assessment.errors)).toBe(true);

    const revocationCorpusNotSupplied = structuredClone(ASSESSMENT);
    revocationCorpusNotSupplied.inputs.revocation_ids = null;
    revocationCorpusNotSupplied.inputs.revocation_document_sha256s = null;
    revocationCorpusNotSupplied.inputs.revocation_key_evidence_refs = null;
    revocationCorpusNotSupplied.inputs.revocation_key_evidence_sha256s = null;
    revocationCorpusNotSupplied.revocation = "indeterminate";
    expect(assessment(revocationCorpusNotSupplied), JSON.stringify(assessment.errors)).toBe(true);
    expect(revocationCorpusNotSupplied.inputs).not.toEqual(completeEmptyRevocationSet.inputs);

    const duplicateRefs = structuredClone(ASSESSMENT);
    duplicateRefs.inputs.revocation_ids = [SHA_A, SHA_A];
    expect(assessment(duplicateRefs)).toBe(false);

    const tooManyRefs = structuredClone(ASSESSMENT);
    tooManyRefs.inputs.revocation_ids = Array.from(
      { length: 65 },
      (_, index) => `sha256:${index.toString(16).padStart(64, "0")}` as typeof SHA_A,
    );
    expect(assessment(tooManyRefs)).toBe(false);

    const missingKeyRef = structuredClone(ASSESSMENT);
    missingKeyRef.inputs.key_evidence_ref = null;
    expect(assessment(missingKeyRef)).toBe(false);

    const missingKeyDocument = structuredClone(ASSESSMENT);
    missingKeyDocument.inputs.key_evidence_sha256 = null;
    expect(assessment(missingKeyDocument)).toBe(false);

    const unexaminedButNotObserved = structuredClone(ASSESSMENT);
    unexaminedButNotObserved.inputs.revocation_ids = null;
    unexaminedButNotObserved.inputs.revocation_document_sha256s = null;
    unexaminedButNotObserved.inputs.revocation_key_evidence_refs = null;
    unexaminedButNotObserved.inputs.revocation_key_evidence_sha256s = null;
    expect(assessment(unexaminedButNotObserved)).toBe(false);

    const unpairedRevocationDocuments = structuredClone(ASSESSMENT);
    unpairedRevocationDocuments.inputs.revocation_document_sha256s = null;
    expect(assessment(unpairedRevocationDocuments)).toBe(false);

    const emptyButIndeterminate = structuredClone(ASSESSMENT);
    emptyButIndeterminate.revocation = "indeterminate";
    expect(assessment(emptyButIndeterminate)).toBe(false);

    const unusableNonemptyCorpus = structuredClone(ASSESSMENT);
    unusableNonemptyCorpus.revocation = "indeterminate";
    unusableNonemptyCorpus.inputs.revocation_ids = [SHA_A];
    unusableNonemptyCorpus.inputs.revocation_document_sha256s = [
      `sha256:${"b".repeat(64)}`,
    ];
    expect(assessment(unusableNonemptyCorpus), JSON.stringify(assessment.errors)).toBe(true);

    const wrongEstablishesOrder = structuredClone(ASSESSMENT);
    wrongEstablishesOrder.establishes.reverse();
    expect(assessment(wrongEstablishesOrder)).toBe(false);

    const invalidSignatureStillClaimed = structuredClone(ASSESSMENT);
    invalidSignatureStillClaimed.signature = "invalid";
    expect(assessment(invalidSignatureStillClaimed)).toBe(false);
  });

  test("requires supersession targets exactly for superseding revocations", async () => {
    const { revocation } = await validators();
    expect(revocation(REVOCATION)).toBe(true);

    const validSupersession = structuredClone(REVOCATION);
    validSupersession.reason = "superseded";
    validSupersession.superseded_by = SHA_A;
    expect(revocation(validSupersession), JSON.stringify(revocation.errors)).toBe(true);

    const missingTarget = structuredClone(validSupersession);
    missingTarget.superseded_by = null;
    expect(revocation(missingTarget)).toBe(false);

    const strayTarget = structuredClone(REVOCATION);
    strayTarget.superseded_by = SHA_A;
    expect(revocation(strayTarget)).toBe(false);
  });
});
