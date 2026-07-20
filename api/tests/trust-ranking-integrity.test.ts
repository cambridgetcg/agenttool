import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const readRoute = (relativePath: string) =>
  readFile(join(__dirname, "../src/routes", relativePath), "utf8");

describe("legacy trust score is never a ranking signal", () => {
  test("identity discovery uses stable creation order", async () => {
    const source = await readRoute("identity/discover.ts");

    expect(source).toContain(
      ".orderBy(asc(identities.createdAt), asc(identities.id))",
    );
    expect(source).not.toMatch(/orderBy\([^\n]*identities\.trustScore/);
  });

  test("dashboard top_attested ranks current attestations, not trust score", async () => {
    const source = await readRoute("dashboard.ts");

    expect(source).toContain("const attestationCount = count(attestations.id)");
    expect(source).toContain("eq(attestations.subjectId, identities.id)");
    expect(source).toContain("isNull(attestations.revokedAt)");
    expect(source).toMatch(
      /or\(\s*isNull\(attestations\.expiresAt\),\s*gt\(attestations\.expiresAt, new Date\(\)\),\s*\)/,
    );
    expect(source).toMatch(
      /\.orderBy\(\s*desc\(attestationCount\),\s*asc\(identities\.createdAt\),\s*asc\(identities\.id\),\s*\)/,
    );
    expect(source).toContain("attestation_count: Number(r.attestationCount)");
    expect(source).toContain("trust_score: r.trustScore");
    expect(source).toContain("top_attested: topAttested");
    expect(source).not.toContain("b.trustScore - a.trustScore");
  });
});
