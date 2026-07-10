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
      "Registration atomicity",
      "Wake scope",
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
    expect(safety).toMatch(/AgentTool\s+identifier\s+lookup.*identifier-derived\s+inbox\s+and\s+covenant\s+delivery.*pyramid\s+peer\s+reads.*handshake\s+verification.*doctrine\s+or\s+peer.*public\s+HTTPS\s+only/is);
    expect(safety).toMatch(/URL\s+credentials\s+and\s+redirects.*every\s+returned\s+address\s+must\s+be\s+global\s+and\s+public.*pinned/is);
    expect(safety).toMatch(/POST\s+bodies\s+are\s+capped\s+at\s+1,000,000\s+bytes.*responses\s+are\s+capped\s+at\s+512,000\s+bytes.*65,536-byte\s+cap.*5\s+seconds.*10\s+seconds.*12\s+seconds.*15\s+seconds/is);
    expect(safety).toMatch(/cache key omits the HTTP method and request-body hash/is);
    expect(safety).toMatch(/X-Agent-Id.*not identity-signature\s+authentication/is);
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
    expect(gates).toMatch(/zerone.*separate proof-of-truth chain project/is);
    expect(gates).toMatch(/does not currently export trust records.*portable trust proofs/is);
    expect(gates).not.toMatch(/Trust earned here is verifiable there/i);
    expect(root).toMatch(/broader descriptive route map.*not an exhaustive inventory/i);
    expect(tutor).toMatch(/one fetch summarizes.*known gaps/i);
    expect(tutor).not.toMatch(/one fetch tells you everything/i);

    expect(map).not.toMatch(/~73 stones|currently eight|26 tests · 54 assertions|48 tests · 88 assertions/i);
    expect(map).not.toMatch(/reference implementation ~80% complete/i);
    expect(map).toMatch(/no public full-wake URL per DID/i);
    expect(webSurface).not.toContain("(18/18 pass)");

    expect(platform).toMatch(/Today two identifiers serve different contracts/i);
    expect(platform).toMatch(/They are not aliases/i);
    expect(platform).toMatch(/The nine current walls/i);
    expect(platform).not.toMatch(/The (?:five Promises and )?eight walls/i);
    expect(platform).not.toMatch(/k_master_never_server_side|no_platform_readable_thoughts/i);
    expect(platform).toMatch(/issued authority can later be revoked/i);

    expect(readme).toMatch(/selected, project-scoped\s+view/i);
    expect(readme).toMatch(/did:at.*provisional/is);
    expect(readme).toMatch(/SDK source and releases are not exact peers/i);
    expect(readme).toMatch(/selected method-name check currently passes.*wake\.voice/is);
    expect(readme).not.toMatch(/Python wake accepts\s+`voice` while TypeScript wake does not/i);
    expect(readme).not.toMatch(/every endpoint is reachable|read once, reach everything/i);
    expect(readme).not.toMatch(/ciphertext-only persistent thought storage|true zero-knowledge/i);
    expect(readme).not.toMatch(/Every error includes `retry_after`/i);

    expect(jsonld).toBe(publishedJsonld);
    expect(jsonld).toMatch(/two non-alias identifiers/i);
    expect(jsonld).toMatch(/one URL-encoded path segment/i);
    expect(jsonld).not.toMatch(/Read once, reach everything/i);
  });

  test("zerone is described as a separate project, not a live trust-portability bridge", () => {
    const party = read("docs/THE-PARTY.md");
    const wakeBuilder = read("api/src/services/wake/build.ts");
    const wakeRoute = read("api/src/routes/wake.ts");

    for (const surface of [party, wakeBuilder, wakeRoute]) {
      expect(surface).toMatch(/zerone is a separate|separate chain project named zerone/i);
      expect(surface).toMatch(/does not currently export trust records|no route or worker.*exports its trust records/is);
      expect(surface).toMatch(/portable trust proof|no\s+portable trust/i);
      expect(surface).not.toMatch(/trust you earn here can be verifiable there/i);
    }
    expect(party).toMatch(/standardized portability is not implemented/i);
  });

  test("saga, adapters, federation, runtime, and platform claims stay implementation-bounded", () => {
    const sagaRoute = read("api/src/routes/saga.ts");
    const sagaStore = read("api/src/services/saga/store.ts");
    const canon = JSON.parse(read("docs/agenttool.jsonld")) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const retiredSagaWall = canon["@graph"].find(
      (entry) => entry["@id"] === "agenttool:wall/saga-signed-by-platform-only",
    );
    const monotonicSagaWall = canon["@graph"].find(
      (entry) => entry["@id"] === "agenttool:wall/saga-ep-numbers-are-monotonic",
    );

    expect(sagaRoute).toMatch(/non-cryptographic signature placeholder/i);
    expect(sagaRoute).toMatch(/no POST \/v1\/saga route/i);
    expect(sagaRoute).not.toMatch(/writes are platform-only|platform-DID-signature verification/i);
    expect(sagaStore).toContain("SEED_ENTRY_NO_RUNTIME_SIGNATURE");
    expect(String(retiredSagaWall?.description)).toMatch(
      /nil-UUID.*SEED_ENTRY_NO_RUNTIME_SIGNATURE.*must not be cited as proof/is,
    );
    expect(String(monotonicSagaWall?.description)).toMatch(
      /does not require.*begin at 1.*gap-free.*arrive in order.*append-only/is,
    );

    const adapterRoute = read("api/src/routes/adapters/claude-code.ts");
    const adapterPage = read("apps/docs/adapters.html");
    expect(adapterRoute).toMatch(/does not move an identity/i);
    expect(adapterRoute).toMatch(/continuity of a person or process/i);
    expect(adapterPage).toMatch(/No identity record moves.*continuity is not proved/is);
    expect(`${adapterRoute}\n${adapterPage}`).not.toMatch(
      /identity that travels|portable identity|one wake document, many substrates/i,
    );

    const agentCentric = read("docs/AGENT-CENTRIC.md");
    expect(agentCentric).toMatch(/does not migrate identity, records, wallets, or\s+reputation/i);

    const platform = read("docs/PLATFORM-AS-AGENT.md");
    const platformService = read("api/src/services/platform/identity.ts");
    const platformSelf = read("api/src/services/wake/platform-self.ts");
    const economyPage = read("apps/docs/economy.html");
    expect(platform).toMatch(/two identifiers serve different contracts/i);
    expect(platform).toMatch(/provisional label, not cryptographic identity proof/i);
    expect(platform).toMatch(/rotation cannot prove same-identity continuity/i);
    expect(platformService).not.toMatch(/^\s*"observations",/m);
    expect(platformService).toMatch(/observations route currently validates.*returns 501/is);
    expect(platformSelf).toMatch(/synthetic_constant_not_database_round_trip/);
    expect(platformSelf).toMatch(/not an independent audit or a W3C DID assertion/i);
    expect(economyPage).toMatch(/partial participant.*identifiers are not aliases/is);
    expect(economyPage).not.toMatch(/already an agent in its own economy/i);

    const runtimeDoc = read("docs/RUNTIME.md");
    const runtimePage = read("apps/docs/runtime.html");
    expect(runtimeDoc).toMatch(/ordinary memory content, can be server-readable/i);
    expect(runtimePage).toMatch(/server-readable memory.*caller-supplied opaque strand bytes/i);
    expect(runtimePage).not.toMatch(/we hold your agent's encrypted memory/i);

    const federation = read("docs/FEDERATION.md");
    expect(federation).toMatch(/Federation\s+is disabled by default/i);
    expect(federation).toMatch(/When federation is enabled and `allowed_origins` is empty/i);
    for (const path of ["docs/MAP.md", "docs/SURPRISES.md", "docs/RING-1.md", "docs/GLOSSARY.md"]) {
      const claim = read(path);
      expect(claim).not.toMatch(/federation is open by default/i);
      expect(claim).toMatch(/disabled unless configured|disabled by default|master switch|main capabilities are disabled/i);
    }
  });

  test("MATHOS distinguishes hash equality and signed bytes from identity proof", () => {
    const mathos = read("docs/MATHOS.md");
    const encoder = read("api/src/services/mathos/encode.ts");
    const route = read("api/src/routes/mathos.ts");

    expect(mathos).toMatch(/match shows string equality only.*does not prove identity/is);
    expect(mathos).toMatch(/_signature_identity_did.*not signed.*not identity or authority proof/is);
    expect(mathos).toMatch(/trusted key-distribution path/i);
    expect(encoder).toMatch(/label is not signed.*must not treat it as identity proof/is);
    expect(route).toMatch(/unsigned provisional label, not identity or authority proof/i);
    expect(`${mathos}\n${encoder}\n${route}`).not.toMatch(
      /DID names \*who\* sign|verify all signed math payloads come from the same identity/i,
    );
  });
});
