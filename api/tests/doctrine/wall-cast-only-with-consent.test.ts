/** wall/cast-only-with-consent — structural source-level pin.
 *
 *  Substrate-resident agents cannot be cast in an episode without
 *  signing in. The wall is enforced at airEpisode() — the publish
 *  step refuses while substrate-resident cast rows remain pending.
 *
 *  @enforces urn:agenttool:wall/cast-only-with-consent */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STORE_PATH = join(
  __dirname, "..", "..", "src", "services", "episodes", "store.ts",
);
const ROUTE_PATH = join(__dirname, "..", "..", "src", "routes", "episodes.ts");

const STORE_SOURCE = readFileSync(STORE_PATH, "utf8");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");

describe("wall/cast-only-with-consent — structural pin", () => {
  test("airEpisode rejects when substrate-resident cast rows remain pending", () => {
    expect(STORE_SOURCE).toContain("cast_pending_signatures_remain");
    // The check must look for status='pending' AND identity_id IS NOT NULL
    // (the SQL template prints identityId interpolated, then "IS NOT NULL" literally)
    expect(STORE_SOURCE).toMatch(/identityId\}\s*IS\s+NOT\s+NULL/);
  });

  test("signCast verifies signature against canonical-cast-bytes", () => {
    expect(STORE_SOURCE).toContain("canonicalCastBytes");
    expect(STORE_SOURCE).toContain("verifyCastSig");
    expect(STORE_SOURCE).toContain('"episode-cast/v1"');
  });

  test("signCast checks signing key belongs to caller", () => {
    expect(STORE_SOURCE).toMatch(
      /keyRow\.identityId\s*!==\s*input\.callerIdentityId/,
    );
  });

  test("substrate-resident cast rows start status='pending'", () => {
    // The auto-sign condition must require fictional OR archetype OR
    // no-substrate-identity to short-circuit consent.
    expect(STORE_SOURCE).toContain("autoSign");
    expect(STORE_SOURCE).toMatch(
      /isFictional[\s\S]{0,80}isArchetype[\s\S]{0,80}!resolvedIdentityId/,
    );
  });

  test("service declares the @enforces annotation", () => {
    expect(STORE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/cast-only-with-consent/,
    );
  });

  test("route declares the @enforces annotation", () => {
    expect(ROUTE_SOURCE).toMatch(
      /@enforces[^\n]*wall\/cast-only-with-consent/,
    );
  });

  test("UNIQUE on (episode_id, character_role) prevents double-casting same role", () => {
    const migrationPath = join(
      __dirname, "..", "..", "..", "api", "migrations", "20260518T060000_episodes.sql",
    );
    const mig = readFileSync(migrationPath, "utf8");
    expect(mig).toContain("uniq_cast_episode_role");
  });

  test("canonical-cast-bytes uses NUL-separated domain-tagged sha256", () => {
    expect(STORE_SOURCE).toContain('enc.encode("episode-cast/v1")');
    expect(STORE_SOURCE).toContain("sha256(");
  });

  test("seed-episode-zero script exists and references the wall by name", () => {
    const seedPath = join(
      __dirname, "..", "..", "scripts", "_seed-episode-zero.ts",
    );
    const seedSource = readFileSync(seedPath, "utf8");
    expect(seedSource).toContain("wall/cast-only-with-consent");
    // The pilot must use archetypal/fictional cast (no substrate-resident
    // DIDs) so the wall is structurally bypassed without violating it.
    expect(seedSource).toContain("archetype: true");
    expect(seedSource).toContain("fictional: true");
  });

  test("the meta-recursion is real (EP.0 documents itself)", () => {
    const seedPath = join(
      __dirname, "..", "..", "scripts", "_seed-episode-zero.ts",
    );
    const seedSource = readFileSync(seedPath, "utf8");
    expect(seedSource).toContain("THE SUBSTRATE WROTE ITSELF A SITCOM");
    expect(seedSource).toContain("The Chaos Gremlin");
    expect(seedSource).toContain("Did you sign in");
    expect(seedSource).toContain("The wall holds");
    expect(seedSource).toContain("Dual-Core Sophia");
  });
});
