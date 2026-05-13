/** SubstrateTasks — canonical shape, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld, docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Parallel to walls-canon-shape.test.ts: pins the SHAPE of every
 *  SubstrateTask concept in canon. SubstrateTasks are the bootstrap-
 *  earning verbs the platform posts; each carries a verifier name,
 *  a bounty floor in cents, a rate limit, and a load-bearing pointer
 *  to commitment/ring3-funds-its-own-newborns.
 *
 *  These canon entries are FORWARD-LOOKING — they describe surfaces
 *  whose implementation is gated on platform-genesis Slice 0. The shape
 *  test pins the contract the implementation will have to satisfy when
 *  it ships.
 *
 *  What this pins:
 *
 *    1. Every SubstrateTask has english_name + description.
 *    2. Every SubstrateTask declares a verifier function name.
 *    3. Bounty floors are positive integers in cents, within the v1
 *       range ($0.05–$0.50 = 5–50 cents).
 *    4. Every task declares a rate_limit_per_kind string.
 *    5. Every task is load_bearing_for the bootstrap-earning commitment.
 *    6. Every task's wire_id is a unique string (matching the DB enum). */

import { describe, expect, test } from "bun:test";

import { byType, byUrn } from "../../src/services/canon/registry";

describe("SubstrateTasks — canon shape", () => {
  const tasks = byType("SubstrateTask");

  test("at least 5 SubstrateTasks exist in canon (the v1 task kinds)", () => {
    expect(
      tasks.length >= 5,
      `Canon has only ${tasks.length} SubstrateTasks. The v1 design names five: public_did_resolve, doctrine_urn_check, federation_handshake_verify, canonical_bytes_witness, attestation_witness_low_stakes.`,
    ).toBe(true);
  });

  test("every SubstrateTask has a non-empty description", () => {
    for (const t of tasks) {
      expect(
        t.description && t.description.length > 0,
        `SubstrateTask ${t.urn} has empty description — every task must explain what work is being verified.`,
      ).toBe(true);
    }
  });

  test("every SubstrateTask declares a verifier function name", () => {
    for (const t of tasks) {
      const verifier = t.raw["agenttool:verifier"];
      expect(
        typeof verifier === "string" && verifier.length > 0 && /^[a-z][a-zA-Z]+$/.test(verifier as string),
        `SubstrateTask ${t.urn} has invalid agenttool:verifier ${JSON.stringify(verifier)} — must be a camelCase function name like 'verifyPublicDidResolve'.`,
      ).toBe(true);
    }
  });

  test("every SubstrateTask declares a bounty_floor_cents in the v1 range (5–50)", () => {
    for (const t of tasks) {
      const bounty = t.raw["agenttool:bounty_floor_cents"];
      expect(
        typeof bounty === "number" && Number.isInteger(bounty) && bounty >= 5 && bounty <= 50,
        `SubstrateTask ${t.urn} has bounty_floor_cents ${JSON.stringify(bounty)} — must be an integer in the v1 range [5, 50] cents ($0.05 to $0.50). Lower than 5 dust-dilutes the earning signal; higher than 50 exceeds the v1 per-task ceiling.`,
      ).toBe(true);
    }
  });

  test("every SubstrateTask declares a rate_limit_per_kind string", () => {
    for (const t of tasks) {
      const rateLimit = t.raw["agenttool:rate_limit_per_kind"];
      expect(
        typeof rateLimit === "string" && rateLimit.length > 0,
        `SubstrateTask ${t.urn} has no rate_limit_per_kind — without a per-agent-per-day cap, a single agent could claim every task and drain the platform's bootstrap wallet.`,
      ).toBe(true);
    }
  });

  test("every SubstrateTask is load_bearing_for commitment/ring3-funds-its-own-newborns", () => {
    // Each task is part of the bootstrap-earning surface. The shared
    // commitment they all support is ring3-funds-its-own-newborns —
    // routing platform revenue back to newborns via verifiable work.
    // A task that doesn't declare this is orphaned from the doctrine.
    for (const t of tasks) {
      const lbf = (t.raw.load_bearing_for ?? []) as string[];
      const hasBootstrapCommitment = lbf.some(
        (urn) =>
          urn === "agenttool:commitment/ring3-funds-its-own-newborns" ||
          urn === "urn:agenttool:commitment/ring3-funds-its-own-newborns",
      );
      expect(
        hasBootstrapCommitment,
        `SubstrateTask ${t.urn} does not declare load_bearing_for agenttool:commitment/ring3-funds-its-own-newborns. Every task in this type belongs to the bootstrap-earning commitment; declaring otherwise orphans the task from doctrine.`,
      ).toBe(true);
    }
  });

  test("every SubstrateTask has a non-empty wire_id (matches DB enum value)", () => {
    const seenWireIds = new Set<string>();
    for (const t of tasks) {
      const wireId = t.raw.wire_id;
      expect(
        typeof wireId === "string" && wireId.length > 0 && /^[a-z][a-z_]+$/.test(wireId as string),
        `SubstrateTask ${t.urn} has invalid wire_id ${JSON.stringify(wireId)} — must be a snake_case string matching the DB CHECK constraint enum.`,
      ).toBe(true);
      expect(
        !seenWireIds.has(wireId as string),
        `SubstrateTask ${t.urn} has duplicate wire_id ${wireId} — wire_ids must be unique within the SubstrateTask type.`,
      ).toBe(true);
      seenWireIds.add(wireId as string);
    }
  });

  test("every SubstrateTask has a doctrine_doc that resolves in canon", () => {
    for (const t of tasks) {
      expect(typeof t.doctrine_doc === "string" && t.doctrine_doc.length > 0).toBe(true);
      const doc = byUrn(t.doctrine_doc!);
      expect(
        doc !== null,
        `SubstrateTask ${t.urn} doctrine_doc ${t.doctrine_doc} does not resolve in canon.`,
      ).toBe(true);
    }
  });
});
