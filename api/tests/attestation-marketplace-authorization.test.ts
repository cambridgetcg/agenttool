import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ATTESTATION_ISSUE_FIELD_ORDER,
  ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
  type AttestationIssueFields,
  attestationEvidenceSha256,
  attestationExpiresAtForAuthorization,
  canonicalAttestationEvidenceJson,
  canonicalAttestationIssueBytes,
  newAttestationIssueAuthorizationExpiry,
  parseAttestationIssueAuthorizationExpiry,
  prepareAttestationIssue,
} from "../src/services/marketplace/attestation-issue-sig";
import openapiRouter from "../src/routes/openapi";

const base: AttestationIssueFields = {
  listing_id: "00000000-0000-4000-8000-000000000001",
  grant_id: "00000000-0000-4000-8000-000000000002",
  escrow_id: "00000000-0000-4000-8000-000000000003",
  buyer_identity_id: "00000000-0000-4000-8000-000000000004",
  buyer_did: "did:at:buyer",
  buyer_project_id: "00000000-0000-4000-8000-000000000005",
  buyer_wallet_id: "00000000-0000-4000-8000-000000000006",
  subject_identity_id: "00000000-0000-4000-8000-000000000007",
  subject_did: "did:at:subject",
  attester_identity_id: "00000000-0000-4000-8000-000000000008",
  attester_did: "did:at:attester",
  attester_project_id: "00000000-0000-4000-8000-000000000009",
  signing_key_id: "00000000-0000-4000-8000-000000000010",
  claim: "agenttool/reviewed/v1",
  evidence_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  attester_wallet_id: "00000000-0000-4000-8000-000000000011",
  grant_gross: 1000,
  grant_currency: "credits",
  take_rate_bps: 500,
  platform_fee: 50,
  attester_net: 950,
  validity_seconds: 86_400,
  attestation_expires_at: "2026-07-14T12:00:00.000Z",
  authorization_expires_at: "2026-07-13T12:05:00.000Z",
};

const alternateUuid = "00000000-0000-4000-8000-000000000099";

function wrongContextDigest(fields: AttestationIssueFields): Uint8Array {
  const hash = createHash("sha256");
  hash.update("identity-attestation/v1");
  for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
    hash.update(new Uint8Array([0]));
    hash.update(String(fields[name] === null ? "null" : fields[name]));
  }
  return new Uint8Array(hash.digest());
}

describe("paid attestation marketplace authorization", () => {
  test("pins the domain-separated 32-byte vector and preparation response", () => {
    const digest = canonicalAttestationIssueBytes(base);
    expect(ATTESTATION_ISSUE_SIGNATURE_CONTEXT).toBe("attestation-issue/v1");
    expect(digest).toHaveLength(32);
    expect(Buffer.from(digest).toString("hex")).toBe(
      "5ec67ad3c0b68bece2392bfd045621f6fdf0c8b2013a4c9fabbd45606f73aaa7",
    );
    expect(digest).not.toEqual(wrongContextDigest(base));

    expect(prepareAttestationIssue(base)).toEqual({
      signature_context: "attestation-issue/v1",
      field_order: [...ATTESTATION_ISSUE_FIELD_ORDER],
      fields: base,
      signed_payload_b64: "XsZ608C2i+ziOSv9BFYh9v3wyLIBOkyfq71FYG9zqqc=",
      authorization_expires_at: base.authorization_expires_at,
    });
  });

  test("every named authorization term changes the digest", () => {
    const changed: Record<keyof AttestationIssueFields, AttestationIssueFields> = {
      listing_id: { ...base, listing_id: alternateUuid },
      grant_id: { ...base, grant_id: alternateUuid },
      escrow_id: { ...base, escrow_id: alternateUuid },
      buyer_identity_id: { ...base, buyer_identity_id: alternateUuid },
      buyer_did: { ...base, buyer_did: "did:at:another-buyer" },
      buyer_project_id: { ...base, buyer_project_id: alternateUuid },
      buyer_wallet_id: { ...base, buyer_wallet_id: alternateUuid },
      subject_identity_id: { ...base, subject_identity_id: alternateUuid },
      subject_did: { ...base, subject_did: "did:at:another-subject" },
      attester_identity_id: { ...base, attester_identity_id: alternateUuid },
      attester_did: { ...base, attester_did: "did:at:another-attester" },
      attester_project_id: { ...base, attester_project_id: alternateUuid },
      signing_key_id: { ...base, signing_key_id: alternateUuid },
      claim: { ...base, claim: "agenttool/reviewed/v2" },
      evidence_sha256: { ...base, evidence_sha256: "f".repeat(64) },
      attester_wallet_id: { ...base, attester_wallet_id: alternateUuid },
      grant_gross: { ...base, grant_gross: 1001, attester_net: 951 },
      grant_currency: { ...base, grant_currency: "USDC" },
      take_rate_bps: { ...base, take_rate_bps: 501 },
      platform_fee: { ...base, platform_fee: 51, attester_net: 949 },
      attester_net: { ...base, grant_gross: 999, attester_net: 949 },
      validity_seconds: { ...base, validity_seconds: 86_401 },
      attestation_expires_at: {
        ...base,
        attestation_expires_at: "2026-07-14T12:00:01.000Z",
      },
      authorization_expires_at: {
        ...base,
        authorization_expires_at: "2026-07-13T12:05:01.000Z",
      },
    };
    const digest = canonicalAttestationIssueBytes(base);
    expect(Object.keys(changed).sort()).toEqual([...ATTESTATION_ISSUE_FIELD_ORDER].sort());
    for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
      expect(canonicalAttestationIssueBytes(changed[name])).not.toEqual(digest);
    }
  });

  test("evidence hashing is stable across object key order and recursive", () => {
    const first = { z: [3, { b: true, a: "x" }], a: { n: null, i: 1 } };
    const reordered = { a: { i: 1, n: null }, z: [3, { a: "x", b: true }] };
    expect(canonicalAttestationEvidenceJson(first)).toBe(
      '{"a":{"i":1,"n":null},"z":[3,{"a":"x","b":true}]}',
    );
    expect(attestationEvidenceSha256(first)).toBe(attestationEvidenceSha256(reordered));
    expect(attestationEvidenceSha256(first)).not.toBe(
      attestationEvidenceSha256({ ...reordered, z: [4] }),
    );
    expect(() => canonicalAttestationEvidenceJson({ value: Number.NaN })).toThrow(
      "evidence_not_json",
    );
  });

  test("authorization expiry is canonical, five-minute prepared, and ten-minute bounded", () => {
    const now = new Date("2026-07-13T12:00:00.900Z");
    expect(newAttestationIssueAuthorizationExpiry(now)).toBe(
      "2026-07-13T12:05:00.000Z",
    );
    expect(
      parseAttestationIssueAuthorizationExpiry("2026-07-13T12:05:00.000Z", now)
        .toISOString(),
    ).toBe("2026-07-13T12:05:00.000Z");
    expect(() => parseAttestationIssueAuthorizationExpiry(
      "2026-07-13T12:00:00.000Z",
      now,
    )).toThrow("authorization_expired");
    expect(() => parseAttestationIssueAuthorizationExpiry(
      "2026-07-13T12:10:01.000Z",
      new Date("2026-07-13T12:00:00.000Z"),
    )).toThrow("authorization_expiry_too_far");
    expect(() => parseAttestationIssueAuthorizationExpiry(
      "2026-07-13T12:05:00Z",
      now,
    )).toThrow("authorization_expiry_invalid");
    expect(attestationExpiresAtForAuthorization(
      86_400,
      new Date("2026-07-13T12:05:00.000Z"),
    )).toBe("2026-07-14T12:00:00.000Z");
  });
});

describe("paid attestation route and settlement structure", () => {
  const serviceSource = readFileSync(
    new URL("../src/services/marketplace/attestations.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../src/routes/attestation-marketplace.ts", import.meta.url),
    "utf8",
  );

  test("exposes prepare then issue with the same named key and expiry", () => {
    expect(routeSource).toContain('grantsRouter.post("/:id/signing-payload"');
    expect(routeSource).toContain("prepareGrantSigningPayload");
    expect(routeSource).toContain("signing_key_id");
    expect(routeSource).toContain("authorization_expires_at");
    expect(routeSource).toContain('message === "attestation_replay"');
    expect(routeSource).toContain("return 409");
  });

  test("locks and rechecks terms before settlement with no legacy fallback", () => {
    expect(serviceSource).not.toContain("canonicalPayload({");
    expect(serviceSource.match(/\.for\("update"\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(serviceSource).toContain("loadLockedAttestationIssueState");
    expect(serviceSource).toContain("canonicalAttestationIssueBytes(fields)");
    expect(serviceSource).toContain("parseAttestationIssueAuthorizationExpiry");
    expect(serviceSource).toContain("escrow_terms_changed");
    expect(serviceSource).toContain("buyer_wallet_terms_changed");
    expect(serviceSource).toContain("attester_wallet_terms_changed");
  });

  test("stores auditable receipt provenance and keeps trust refresh best-effort", () => {
    expect(serviceSource).toContain("tier: DEFAULT_TIER");
    expect(serviceSource).toContain("claimType: DEFAULT_CLAIM_TYPE");
    expect(serviceSource).toContain("signingKeyId: state.key.id");
    expect(serviceSource).toContain("signatureContext: ATTESTATION_ISSUE_SIGNATURE_CONTEXT");
    expect(serviceSource).toContain(
      'signedPayload: Buffer.from(signedPayload).toString("base64")',
    );
    expect(serviceSource).toContain("replayKey");
    expect(serviceSource).toContain("candidate.constraint_name ?? candidate.constraint");
    expect(serviceSource).toContain("[attestation marketplace] updateTrustScore failed:");
  });

  test("publishes the prepare-and-issue contract in OpenAPI", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const document = await response.json() as {
      paths: Record<string, Record<string, any>>;
    };
    const prepare = document.paths[
      "/v1/attestation-grants/{id}/signing-payload"
    ]!.post;
    expect(
      prepare.requestBody.content["application/json"].schema.required,
    ).toEqual(["signing_key_id"]);
    const responseSchema = prepare.responses["200"].content["application/json"].schema;
    expect(responseSchema.required).toEqual(["signing_payload"]);
    expect(responseSchema.properties.signing_payload.required).toEqual([
      "signature_context",
      "field_order",
      "fields",
      "signed_payload_b64",
      "authorization_expires_at",
    ]);
    expect(
      responseSchema.properties.signing_payload.properties.fields.required,
    ).toEqual(ATTESTATION_ISSUE_FIELD_ORDER);

    const issue = document.paths["/v1/attestation-grants/{id}/issue"]!.post;
    expect(issue.requestBody.content["application/json"].schema.required).toEqual([
      "signature",
      "signing_key_id",
      "authorization_expires_at",
    ]);
    expect(issue.description).toMatch(/no legacy four-field JSON fallback/i);
    expect(issue.responses["409"]).toBeDefined();
  });
});
