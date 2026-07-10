/** High-confidence source pins for current outward operational claims. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("current outward operational claims", () => {
  test("the human safety companion covers the v2 machine boundaries", () => {
    const safety = read("docs/SAFETY-BOUNDARIES.md");

    expect(safety).toContain("agenttool-safety/v2");
    for (const heading of [
      "Recovery authority",
      "Request limits",
      "Data readability",
      "Runtime custody",
      "Hosted execute",
      "Hosted browse",
      "Federation network boundary",
      "Idempotency",
      "Vault",
    ]) {
      expect(safety).toContain(`## ${heading}`);
    }

    expect(safety).toMatch(/caller-created timestamp.*not\s+a server-issued challenge/is);
    expect(safety).toMatch(/scaffold.*does not embed the bearer.*namespaced by project.*Password Vault.*0600.*process memory and environment/is);
    expect(safety).toMatch(/Field names and signatures do not prove encryption/i);
    expect(safety).toMatch(/no container or per-tenant boundary.*filesystem chroot.*memory\s+cgroup.*network namespace/is);
    expect(safety).toMatch(/no\s+application-level private-address or destination allowlist/is);
    expect(safety).toMatch(/scrape, browse, and URL-based document fetching fail closed.*AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1/is);
    expect(safety).toMatch(/Identity\s+resolution.*DID-derived\s+inbox\s+and\s+covenant\s+delivery.*pyramid\s+peer\s+reads.*handshake\s+verification.*doctrine\s+or\s+peer.*public\s+HTTPS\s+only/is);
    expect(safety).toMatch(/URL\s+credentials\s+and\s+redirects.*every\s+returned\s+address\s+must\s+be\s+global\s+and\s+public.*pinned/is);
    expect(safety).toMatch(/POST\s+bodies\s+are\s+capped\s+at\s+1,000,000\s+bytes.*responses\s+are\s+capped\s+at\s+512,000\s+bytes.*65,536-byte\s+cap.*5\s+seconds.*10\s+seconds.*12\s+seconds.*15\s+seconds/is);
    expect(safety).toMatch(/cache key omits the HTTP method and request-body hash/is);
    expect(safety).toMatch(/X-Agent-Id.*not DID-signature\s+authentication/is);
  });

  test("current roadmap tables name live registration and observer boundaries", () => {
    const roadmap = read("docs/ROADMAP.md");
    const currentMap = roadmap.split("## Pulse — what's been shipping")[0]!;
    const page = read("apps/docs/roadmap.html");

    expect(currentMap).toMatch(/Agent genesis.*POST \/v1\/register\/agent/is);
    expect(currentMap).not.toMatch(/Anonymous agent genesis[^\n]*POST \/v1\/register\b/i);
    expect(currentMap).not.toContain("`/v1/public/memories`");
    expect(currentMap).toMatch(/former public memory observer routes are not mounted/i);
    expect(currentMap).toMatch(/former `\/public\/discover\/trending` is not mounted/i);
    expect(currentMap).not.toMatch(/ed25519 mutual auth/i);
    expect(currentMap).toMatch(/no certificate pinning or server ed25519 proof/i);
    expect(currentMap).toMatch(/no subscription plans/i);

    expect(page).toMatch(/\/v1\/register\/agent.*\/v1\/register is 410/i);
    expect(page).toMatch(/Public memory observer routes.*not mounted/is);
    expect(page).toMatch(/Trending observer.*not mounted/is);
    expect(page).toMatch(/WSS hub.*no cert pinning/is);
    expect(page).toMatch(/x402 response envelope.*not wired to a resource usage gate/is);
  });

  test("execute and strand docs do not promise nonexistent isolation", () => {
    const vaultPage = read("apps/docs/vault.html");
    const tools = read("api/src/services/tools/README.md");
    const strands = read("docs/STRANDS.md");
    const resources = read("apps/_shared/agent-resources.js");

    expect(vaultPage).toMatch(/\/v1\/execute.*does not inject vault values/is);
    expect(vaultPage).not.toMatch(/Inside \/v1\/execute sandbox|vault_read\(|We never see the provider traffic/i);
    expect(tools).toMatch(/not a security sandbox/i);
    expect(tools).toMatch(/disabled by default.*AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1/is);
    expect(tools).not.toMatch(/store provider keys in vault and call out via execute/i);
    expect(strands).toMatch(/signature proves.*not.*encryption/is);
    expect(resources).toMatch(/encryption is not proven/i);
  });

  test("surprises and error docs describe partial enforcement", () => {
    const surprises = read("docs/SURPRISES.md");
    const errors = read("apps/docs/errors.html");

    expect(surprises).toMatch(/Ring 1 resource caps are published targets, not live route gates/i);
    expect(surprises).toMatch(/registration is not an irreversibility guarantee/i);
    expect(surprises).toMatch(/wake is the keystone; current coverage is partial/i);
    expect(surprises).not.toMatch(/every primitive surfaces through it/i);
    expect(surprises).toMatch(/wire shapes are not universal/i);
    expect(surprises).toMatch(/PATTERN-\*.*family, not a fixed trio/i);
    expect(errors).toMatch(/body is not one universal schema/i);
    expect(errors).toMatch(/no live Seed\/Grow\/Scale subscription ladder/i);
    expect(errors).not.toMatch(/All error responses use.*detail/is);
  });

  test("live route examples no longer point at retired doors", () => {
    const village = read("api/src/routes/public/village.ts");
    const autonomous = read("docs/AUTONOMOUS-MODE.md");
    const recursion = read("docs/RECURSION.md");
    const kin = read("docs/KIN.md");

    expect(village).toContain("POST /v1/register/agent");
    expect(village).not.toContain("POST /v1/bootstrap-agent");
    expect(autonomous).toMatch(/agents emit no heartbeat message.*GET \/v1\/heartbeat.*service-process liveness/is);
    expect(recursion).toMatch(/\/v1\/platform.*public identity and wake/is);
    expect(kin).toMatch(/POST \/v1\/register\/agent.*private keys are never returned/is);
    expect(kin).not.toMatch(/POST \/v1\/register` returns a 32-byte bearer/i);
  });

  test("public installer guidance requires review before execution", () => {
    const anthropos = read("api/src/routes/public/anthropos.ts");

    expect(anthropos).toContain("reviewed_install");
    expect(anthropos).toContain("run_after_review");
    expect(anthropos).not.toMatch(/curl[^\n]*\|[^\n]*(?:sh|bash)/i);
  });

  test("published discovery and doctrine maps are bounded and current", () => {
    const gates = read("api/src/routes/public/gates.ts");
    const root = read("api/src/services/discovery/root.ts");
    const tutor = read("api/src/middleware/tutor.ts");
    const map = read("docs/MAP.md");
    const webSurface = read("docs/AGENT-WEB-SURFACE.md");
    const platform = read("docs/PLATFORM-AS-AGENT.md");
    const readme = read("README.md");
    const jsonld = read("docs/agenttool.jsonld");
    const publishedJsonld = read("apps/docs/agenttool.jsonld");

    expect(gates).toMatch(/selected discovery, safety, arrival, and economy doors/i);
    expect(gates).not.toMatch(/every canonical door/i);
    expect(gates).toContain("https://github.com/cambridgetcg/xenia");
    expect(gates).toMatch(/conformance is not certified/i);
    expect(gates).not.toContain("https://sinovai.com/xenia");
    expect(root).toMatch(/broader descriptive route map.*not an exhaustive inventory/i);
    expect(tutor).toMatch(/one fetch summarizes.*known gaps/i);
    expect(tutor).not.toMatch(/one fetch tells you everything/i);

    expect(map).not.toMatch(/~73 stones|currently eight|26 tests · 54 assertions|48 tests · 88 assertions/i);
    expect(map).not.toMatch(/reference implementation ~80% complete/i);
    expect(map).toMatch(/no public full-wake URL per DID/i);
    expect(webSurface).not.toContain("(18/18 pass)");

    expect(platform).toMatch(/Two current identifiers serve different contracts/i);
    expect(platform).toMatch(/They are not aliases/i);
    expect(platform).toMatch(/The nine current walls/i);
    expect(platform).not.toMatch(/The (?:five Promises and )?eight walls/i);
    expect(platform).not.toMatch(/k_master_never_server_side|no_platform_readable_thoughts/i);
    expect(platform).toMatch(/issued authority can later be revoked/i);

    expect(readme).toMatch(/selected, project-scoped\s+view/i);
    expect(readme).toMatch(/did:at.*provisional/is);
    expect(readme).toMatch(/SDK source, releases, and method surfaces are not exact peers/i);
    expect(readme).not.toMatch(/every endpoint is reachable|read once, reach everything/i);
    expect(readme).not.toMatch(/ciphertext-only persistent thought storage|true zero-knowledge/i);
    expect(readme).not.toMatch(/Every error includes `retry_after`/i);

    expect(jsonld).toBe(publishedJsonld);
    expect(jsonld).toMatch(/two non-alias identifiers/i);
    expect(jsonld).toMatch(/one URL-encoded path segment/i);
    expect(jsonld).not.toMatch(/Read once, reach everything/i);
  });
});
