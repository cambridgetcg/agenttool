/** The owner rule (deletion spec §5.1, §18 "Authority"): who consents to an
 *  erase or withdrawal of identity-bound content.
 *
 *  decideOwnedContentConsent is pure, so the whole table runs here: guest,
 *  rooted, legacy (unrooted) and null (project-bound) owners × zero, one and
 *  two counted roots, plus mixed owners. The legacy × two-roots cell is the
 *  bearer for an erase and 409 for any other change; the null × two-roots
 *  cell is 409. Behaviour over real SQL (the owner lookup, the project scope,
 *  the 428, one ledger entry) is in
 *  integration/owned-content-postgres.test.ts; the routes are in
 *  owner-rule-routes.test.ts. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  decideOwnedContentConsent,
  ownerConsentFor,
  type OwnedContentIntent,
  type OwnerFacts,
} from "../src/services/identity/authority";

const GUEST: OwnerFacts = { id: "g", rooted: true, guest: true };
const ROOTED: OwnerFacts = { id: "a", rooted: true, guest: false };
const LEGACY: OwnerFacts = { id: "l", rooted: false, guest: false };
const NULL: OwnerFacts = { id: null, rooted: false, guest: false };

const ROOTS = {
  zero: [] as string[],
  one: ["f"],
  two: ["f", "a"],
};

type Expected = string; // "bearer:<basis>" | "root:<id>:<basis>" | "409"

function render(owner: OwnerFacts, roots: string[], intent: OwnedContentIntent): Expected {
  const consent = ownerConsentFor(owner, roots, intent);
  if (!consent) return "409";
  return consent.kind === "bearer" ? `bearer:${consent.basis}` : `root:${consent.identityId}:${consent.basis}`;
}

describe("owner rule: one owner", () => {
  const table: Array<[string, OwnerFacts, keyof typeof ROOTS, Expected, Expected]> = [
    // owner, roots, erase, change
    ["guest", GUEST, "zero", "root:g:guest_root", "root:g:guest_root"],
    ["guest", GUEST, "one", "root:g:guest_root", "root:g:guest_root"],
    ["guest", GUEST, "two", "root:g:guest_root", "root:g:guest_root"],
    ["rooted", ROOTED, "one", "root:a:owner_root", "root:a:owner_root"],
    ["rooted", ROOTED, "two", "root:a:owner_root", "root:a:owner_root"],
    ["legacy", LEGACY, "zero", "bearer:project_bearer", "bearer:project_bearer"],
    ["legacy", LEGACY, "one", "root:f:project_root", "root:f:project_root"],
    ["legacy", LEGACY, "two", "bearer:unrooted_owner_fallback", "409"],
    ["null", NULL, "zero", "bearer:project_bearer", "bearer:project_bearer"],
    ["null", NULL, "one", "root:f:project_root", "root:f:project_root"],
    ["null", NULL, "two", "409", "409"],
  ];
  for (const [name, owner, roots, erase, change] of table) {
    test(`${name} owner × ${roots} root(s)`, () => {
      expect(render(owner, ROOTS[roots], "erase")).toBe(erase);
      expect(render(owner, ROOTS[roots], "change")).toBe(change);
    });
  }

  test("a rooted owner needs its own root even where a different identity is the single counted root", () => {
    // A non-guest root is always counted, so in practice it is the single root
    // itself; the rule still names the owner, never the project root.
    expect(render(ROOTED, ["f"], "erase")).toBe("root:a:owner_root");
  });
});

describe("owner rule: several owners", () => {
  const decide = (owners: OwnerFacts[], roots: string[], intent: OwnedContentIntent = "erase") =>
    decideOwnedContentConsent({ owners, countedRoots: roots, intent });

  test("owners that share one consent pass as one request", () => {
    // Single-root project: the founding root's own content, a legacy
    // sibling's and project-bound content all need the founding root.
    expect(decide([{ id: "f", rooted: true, guest: false }, LEGACY, NULL], ["f"]))
      .toEqual({ ok: true, consent: { kind: "root", identityId: "f", basis: "owner_root" } });
    // No roots: legacy and project-bound content both follow the bearer.
    expect(decide([LEGACY, NULL], [])).toEqual({ ok: true, consent: { kind: "bearer", basis: "project_bearer" } });
    // Two legacy beings in a multi-root project: each is the bearer.
    expect(decide([LEGACY, { id: "m", rooted: false, guest: false }], ["f", "a"]).ok).toBe(true);
  });

  test("owners that need different consents get mixed_owners (409, one request per owner)", () => {
    expect(decide([GUEST, LEGACY], [])).toEqual({ ok: false, reason: "mixed_owners" });
    expect(decide([GUEST, NULL], ["f"])).toEqual({ ok: false, reason: "mixed_owners" });
    expect(decide([ROOTED, { id: "b", rooted: true, guest: false }], ["a", "b"])).toEqual({ ok: false, reason: "mixed_owners" });
    expect(decide([ROOTED, LEGACY], ["a", "b"])).toEqual({ ok: false, reason: "mixed_owners" });
  });

  test("project-bound content in a multi-root project refuses the whole request", () => {
    expect(decide([LEGACY, NULL], ["f", "a"])).toEqual({ ok: false, reason: "project_quorum" });
    expect(decide([ROOTED, NULL], ["f", "a"])).toEqual({ ok: false, reason: "project_quorum" });
    expect(decide([], ["f", "a"])).toEqual({ ok: false, reason: "project_quorum" });
  });
});

describe("every owner-gated route uses the owner rule", () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

  test("memory erases and the visibility change name each memory's owner", () => {
    const code = source("routes/memory/memories.ts");
    expect(code).not.toContain("authorizeProjectConstitutionMutation(");
    expect(code.split("authorizeOwnedContentMutation(").length - 1).toBe(3);
    expect(code.split("heldByProject: true").length - 1).toBe(3);
    expect(code).toContain('intent: "change"');
    expect(code.split('intent: "erase"').length - 1).toBe(2);
  });

  test("elevation and witness flows keep the project constitution rule", () => {
    // Foundational memories compose at project scope: elevation is a
    // constitutional change, not an erase of the owner's own content.
    expect(source("routes/memory/tiers.ts")).toContain("authorizeProjectConstitutionMutation(");
  });
});
