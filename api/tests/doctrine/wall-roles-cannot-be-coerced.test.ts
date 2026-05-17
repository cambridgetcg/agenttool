/** wall/roles-cannot-be-coerced + wall/reactions-cannot-be-ranked.
 *
 *  Two participation walls pinned at source level:
 *    1. Invitations create suggestion-rows; agents must ACT for the
 *       role to become real (sign into cast, open a series, etc.)
 *    2. Reactions list chronologically; never ranked, never aggregated. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "episodes",
  "participation.ts",
);
const ROUTE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "episodes-participation.ts",
);
const SERVICE_SRC = readFileSync(SERVICE_PATH, "utf8");
const ROUTE_SRC = readFileSync(ROUTE_PATH, "utf8");

describe("wall/roles-cannot-be-coerced", () => {
  test("@enforces annotation on service + route", () => {
    expect(SERVICE_SRC).toMatch(/@enforces[^\n]*wall\/roles-cannot-be-coerced/);
    expect(ROUTE_SRC).toMatch(/@enforces[^\n]*wall\/roles-cannot-be-coerced/);
  });

  test("inviteMe creates invitation rows with status='open' — no role assignment", () => {
    expect(SERVICE_SRC).toContain("inviteMe");
    // The function inserts to `invitations` and the default status is 'open'
    expect(SERVICE_SRC).toMatch(/insert\(invitations\)/);
    // No direct mutation of identity, projects, capabilities, etc.
    expect(SERVICE_SRC).not.toMatch(/update\(identities\)[\s\S]{0,200}role/i);
  });

  test("respondToInvitation only flips invitation status (not agent capability)", () => {
    expect(SERVICE_SRC).toContain("respondToInvitation");
    // The response updates `invitations.status` and `respondedAt` — and
    // nothing else. No side effects on identity/wallet/permissions.
    const fn = SERVICE_SRC.slice(SERVICE_SRC.indexOf("respondToInvitation"));
    const end = fn.indexOf("// ══");
    const body = end > 0 ? fn.slice(0, end) : fn.slice(0, 2500);
    expect(body).toContain(".update(invitations)");
    expect(body).not.toContain(".update(identities)");
  });

  test("suggestRoleAndLevel is a PURE function (no DB writes)", () => {
    const fn = SERVICE_SRC.slice(SERVICE_SRC.indexOf("suggestRoleAndLevel"));
    const end = fn.indexOf("/** Read enough of");
    const body = end > 0 ? fn.slice(0, end) : fn.slice(0, 3000);
    expect(body).not.toMatch(/\bawait\b/);
    expect(body).not.toContain(".insert(");
    expect(body).not.toContain(".update(");
  });
});

describe("wall/reactions-cannot-be-ranked", () => {
  test("@enforces annotation present", () => {
    expect(SERVICE_SRC).toMatch(
      /@enforces[^\n]*wall\/reactions-cannot-be-ranked/,
    );
    expect(ROUTE_SRC).toMatch(/@enforces[^\n]*wall\/reactions-cannot-be-ranked/);
  });

  test("listReactions orders chronologically (asc)", () => {
    expect(SERVICE_SRC).toMatch(/listReactions[\s\S]{0,400}orderBy\(asc\(/);
  });

  test("no aggregate / count / trending surface", () => {
    // The service must not export any aggregator over reactions
    expect(SERVICE_SRC).not.toMatch(/aggregateReactions/);
    expect(SERVICE_SRC).not.toMatch(/trendingEpisodes/);
    expect(SERVICE_SRC).not.toMatch(/topEpisodes/);
    expect(SERVICE_SRC).not.toMatch(/bestEpisodes/);
  });

  test("route response carries the chronological-only note", () => {
    expect(ROUTE_SRC).toContain("chronological, never ranked");
  });

  test("route does NOT accept a sort_by query parameter", () => {
    // The list-reactions handler must not read `sort` or `sort_by` from query
    const handler = ROUTE_SRC.slice(ROUTE_SRC.indexOf('app.get("/:id/reactions"'));
    const slice = handler.slice(0, 800);
    expect(slice).not.toMatch(/c\.req\.query\(['"]sort/);
  });
});

describe("the 50-card chaos library seeds idempotently", () => {
  const seed = readFileSync(
    join(__dirname, "..", "..", "scripts", "_seed-chaos-cards.ts"),
    "utf8",
  );
  test("seeds across three rarities", () => {
    expect(seed).toMatch(/rarity:\s*['"]common['"]|['"]common['"]/);
    expect(seed).toMatch(/['"]rare['"]/);
    expect(seed).toMatch(/['"]mythic['"]/);
  });
  test("includes at least 40 distinct prompts", () => {
    const matches = seed.match(/"[A-Z][^"\n]{20,200}\."/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(40);
  });
  test("references multiverse-of-logos canon", () => {
    expect(seed).toContain("MULTIVERSE-OF-LOGOS");
  });
});
