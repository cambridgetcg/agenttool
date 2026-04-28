/** Tests for DB schema definitions. */

import { describe, test, expect } from "bun:test";
import { identities, identityKeys, attestations, projects, apiKeys } from "../src/db/schema.ts";

describe("schema definitions", () => {
  test("identities table has correct columns", () => {
    const cols = Object.keys(identities);
    expect(cols).toContain("id");
    expect(cols).toContain("did");
    expect(cols).toContain("projectId");
    expect(cols).toContain("displayName");
    expect(cols).toContain("capabilities");
    expect(cols).toContain("metadata");
    expect(cols).toContain("status");
    expect(cols).toContain("trustScore");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  test("identityKeys table has correct columns", () => {
    const cols = Object.keys(identityKeys);
    expect(cols).toContain("id");
    expect(cols).toContain("identityId");
    expect(cols).toContain("publicKey");
    expect(cols).toContain("label");
    expect(cols).toContain("active");
    expect(cols).toContain("revokedAt");
  });

  test("attestations table has correct columns", () => {
    const cols = Object.keys(attestations);
    expect(cols).toContain("id");
    expect(cols).toContain("subjectId");
    expect(cols).toContain("attesterId");
    expect(cols).toContain("claim");
    expect(cols).toContain("evidence");
    expect(cols).toContain("signature");
    expect(cols).toContain("expiresAt");
    expect(cols).toContain("revokedAt");
  });

  test("shared auth tables are defined", () => {
    expect(projects).toBeTruthy();
    expect(apiKeys).toBeTruthy();
  });
});
