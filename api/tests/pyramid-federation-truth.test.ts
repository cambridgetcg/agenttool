import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("pyramid federation truth boundary", () => {
  test("attested enrollment binds the named citizen to the authenticated agent", () => {
    const source = read("api/src/routes/pyramid.ts");

    expect(source).toMatch(
      /body\.enrollment\.citizen_did !== agent\.did[\s\S]*citizen_did_mismatch/,
    );
    expect(source).toMatch(
      /eq\(identityKeys\.identityId, agent\.id\)[\s\S]*eq\(identityKeys\.active, true\)/,
    );
  });

  test("remote citizen lookup rejects a response for another DID", () => {
    const source = read("api/src/services/pyramid/federation.ts");
    expect(source).toMatch(/typeof data\.did !== "string" \|\|\s*data\.did !== did/);
  });

  test("public doctrine and safety say tier federation remains partial", () => {
    const doctrine = read("docs/PYRAMID-DECENTRALISED.md");
    const canon = read("docs/agenttool.jsonld");
    const safety = read("docs/SAFETY-BOUNDARIES.md");

    expect(doctrine).toMatch(/computeTier\(\)[\s\S]*local-only/is);
    expect(doctrine).toMatch(/sponsorTreeDepthFederated[\s\S]*does not call/is);
    expect(canon).toMatch(/computeTier and wake remain local-only/is);
    expect(canon).toMatch(/sponsorTreeDepthFederated is not wired/is);
    expect(safety).toMatch(/computeTier[\s\S]*local\s+sponsor tree/is);
    expect(safety).toMatch(/sponsorTreeDepthFederated[\s\S]*not wired/is);
    for (const text of [doctrine, canon, safety]) {
      expect(text).toMatch(/not node-signed/i);
    }

    expect(doctrine).toMatch(/sponsor.*caller-supplied public key.*no DID-resolution binding/is);
    expect(canon).toMatch(/reference-only citizenship remain targets/i);
  });
});
