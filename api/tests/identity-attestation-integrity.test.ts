import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { readFileSync } from "node:fs";

import {
  canonicalIdentityAttestationBytes,
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  verifyBytes,
} from "../src/services/identity/crypto";
import { isAttestationReplay } from "../src/routes/identity/attestations";
import { NEUTRAL_TRUST_SCORE } from "../src/services/identity/trust";

const trustSource = readFileSync(
  new URL("../src/services/identity/trust.ts", import.meta.url),
  "utf8",
);

const routeSource = readFileSync(
  new URL("../src/routes/identity/attestations.ts", import.meta.url),
  "utf8",
);

const schemaSource = readFileSync(
  new URL("../src/db/schema/identity.ts", import.meta.url),
  "utf8",
);

const receiptMigration = readFileSync(
  new URL(
    "../migrations/20260713T120000_attestation_receipt_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("identity attestation integrity", () => {
  test("direct attestations bind their context, key, and exact evidence representation", () => {
    const base = {
      subjectId: "550e8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "understood the work",
      evidence: null,
    };
    const canonical = canonicalIdentityAttestationBytes(base);
    expect(IDENTITY_ATTESTATION_SIGNATURE_CONTEXT).toBe("identity-attestation/v1");
    expect(canonical).toHaveLength(32);
    expect(canonical).not.toEqual(canonicalIdentityAttestationBytes({
      ...base,
      signingKeyId: "550e8400-e29b-41d4-a716-446655440011",
    }));
    expect(canonical).not.toEqual(canonicalIdentityAttestationBytes({
      ...base,
      evidence: "",
    }));
  });

  test("matches the shared TypeScript and Python Unicode digest vector", () => {
    const canonical = canonicalIdentityAttestationBytes({
      subjectId: "550e8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "理解 / understood",
      evidence: 'line 1\\n"yes"',
    });
    expect(Buffer.from(canonical).toString("hex")).toBe(
      "01d83937ce8640296d4706ca0ed4f1c1aaf773aac361f79b444329a6482abf5a",
    );
  });

  test("canonical bytes verify only for the signing key and reject ambiguous text", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
    const canonical = canonicalIdentityAttestationBytes({
      subjectId: "550e8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "understood",
      evidence: "trace:1",
    });
    const signature = Buffer.from(ed.sign(canonical, seed)).toString("base64");
    expect(verifyBytes(
      canonical,
      signature,
      Buffer.from(ed.getPublicKey(seed)).toString("base64"),
    )).toBe(true);
    expect(() => canonicalIdentityAttestationBytes({
      subjectId: "550E8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "understood",
      evidence: null,
    })).toThrow(/canonical lowercase UUIDs/);
    expect(() => canonicalIdentityAttestationBytes({
      subjectId: "550e8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "under\0stood",
      evidence: null,
    })).toThrow(/must not contain NUL/);
    expect(() => canonicalIdentityAttestationBytes({
      subjectId: "550e8400-e29b-41d4-a716-446655440002",
      attesterId: "550e8400-e29b-41d4-a716-446655440001",
      signingKeyId: "550e8400-e29b-41d4-a716-446655440010",
      claim: "broken\ud800text",
      evidence: null,
    })).toThrow(/well-formed Unicode/);
  });

  test("recognizes a replay constraint wrapped by the database driver", () => {
    expect(isAttestationReplay({
      message: "Failed query",
      cause: {
        code: "23505",
        constraint_name: "uniq_attestations_replay_key",
      },
    })).toBe(true);
    expect(isAttestationReplay({ code: "23505", constraint: "another_unique" })).toBe(false);
  });

  test("the legacy trust score stays neutral without qualified roots or Sybil resistance", () => {
    expect(NEUTRAL_TRUST_SCORE).toBe(0);
    expect(trustSource).not.toContain("same-project");
    expect(trustSource).not.toContain("Math.max(0.1");
    expect(trustSource).not.toContain("computeTrustScore");
    expect(receiptMigration).toContain("identity.force_neutral_trust_score()");
    expect(receiptMigration).toContain(
      "BEFORE INSERT OR UPDATE OF trust_score ON identity.identities",
    );
    expect(receiptMigration).toContain("NEW.trust_score := 0");
  });

  test("new writes persist kid and a unique replay key", () => {
    expect(routeSource).toContain("signingKeyId: body.kid");
    expect(routeSource).toContain("signatureContext: IDENTITY_ATTESTATION_SIGNATURE_CONTEXT");
    expect(routeSource).toContain("signedPayload: Buffer.from(signedPayload).toString(\"base64\")");
    expect(routeSource).toContain("replayKey");
    expect(routeSource).toContain("attestation_replay");
  });

  test("paid receipts have a unique durable grant provenance slot", () => {
    expect(schemaSource).toContain('sourceGrantId: uuid("source_grant_id")');
    expect(schemaSource).toContain('uniqueIndex("uniq_attestations_source_grant_id")');
    expect(routeSource).toContain("source_grant_id: attestation.sourceGrantId");
    expect(receiptMigration).toContain("fk_identity_attestations_source_grant");
    expect(receiptMigration).toContain("uniq_attestations_source_grant_id");
  });

  test("unsigned tier, claim type, and expiry inputs are rejected", () => {
    expect(routeSource).not.toContain("body.tier");
    expect(routeSource).not.toContain("body.claim_type");
    expect(routeSource).not.toContain("body.expires_in_seconds");
  });

  test("a derived trust refresh cannot turn a committed write into a failed response", () => {
    expect(routeSource).toContain("[identity attestation] updateTrustScore failed:");
    expect(routeSource).toContain("[identity attestation revoke] updateTrustScore failed:");
  });
});
