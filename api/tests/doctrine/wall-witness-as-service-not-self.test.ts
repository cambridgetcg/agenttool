/** wall/witness-as-service-not-self — structural pin.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/MEMORY-TIERS.md §asymmetry-clause.
 *
 *  The marketplace path to constitutive elevation is a NEW operational
 *  route (it bypasses the covenant-counterparty requirement in
 *  services/memory/tiers.ts:elevateMemory). The wall it MUST hold is:
 *  the buyer's project cannot be the listing's project. Same-project
 *  self-witness wearing a marketplace mask is rejected.
 *
 *  This test pins the wall STRUCTURALLY. Behavioral coverage (does
 *  createGrant() actually 403 when projects match?) lives in
 *  tests/integration/memory-witness-marketplace.test.ts.
 *
 *  @enforces urn:agenttool:wall/witness-as-service-not-self */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "marketplace",
  "memory-witness.ts",
);
const SOURCE = readFileSync(SERVICE_PATH, "utf8");

describe("wall/witness-as-service-not-self — structural pin", () => {
  test("createGrant explicitly checks listing.projectId !== buyer.projectId", () => {
    expect(
      /listing\.projectId\s*===\s*input\.buyerProjectId/.test(SOURCE),
      "memory-witness.ts:createGrant must compare listing.projectId === input.buyerProjectId to enforce the self-witness wall",
    ).toBe(true);
  });

  test("self_witness_forbidden error code is thrown", () => {
    expect(SOURCE).toContain("self_witness_forbidden");
    expect(SOURCE).toMatch(
      /throw new MemoryWitnessError\([\s\S]{0,200}self_witness_forbidden/,
    );
  });

  test("service carries the @enforces annotation pointing at the wall URN", () => {
    expect(
      /@enforces[^\n]*wall\/witness-as-service-not-self/.test(SOURCE),
      "memory-witness.ts must declare `@enforces urn:agenttool:wall/witness-as-service-not-self` in its JSDoc — canonical defender annotation per PATTERN-COMMITMENT-DEFENDER.",
    ).toBe(true);
  });

  test("v1 narrows claim_kind to constitutive-only", () => {
    // The supported set must include only memory_witness:constitutive:v1.
    // Future kinds extend the CHECK + the const; this test fails if
    // someone adds a kind without thinking through the wall implications.
    expect(SOURCE).toContain('memory_witness:constitutive:v1');
    expect(SOURCE).toContain("MEMORY_WITNESS_CLAIM_KINDS");
  });

  test("issueGrant verifies witness's signing_key belongs to the listing's witness identity", () => {
    // Structural pin: the issue path must check signing_key.identityId
    // matches listing.witnessIdentityId. Without this check, any agent
    // with a key could "issue" any grant.
    expect(
      /keyRow\.identityId\s*!==\s*listing\.witnessIdentityId/.test(SOURCE),
      "issueGrant must compare keyRow.identityId !== listing.witnessIdentityId — the signing key must belong to the witness identity, not just any active key",
    ).toBe(true);
  });

  test("issueGrant runs through the recordRevenue (take-rate) path", () => {
    // Standard Ring 3 take-rate applies. Witness-as-service is NOT a
    // substrate-task; the platform earns its cut here because escrow +
    // sig verification + chronicle propagation are platform primitives.
    expect(SOURCE).toContain("recordRevenue");
    expect(SOURCE).toContain('"memory_witness_grant"');
  });
});
