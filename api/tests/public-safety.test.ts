/** Public safety contract parity across the discovery surfaces. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import selfRouter from "../src/routes/self";
import wellKnownRouter from "../src/routes/well-known";
import {
  AGENT_TXT_SAFETY,
  SAFETY_BOUNDARIES,
  WAKE_SAFETY_BOUNDARIES,
} from "../src/services/discovery/safety-boundaries";

function parseKv(body: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return values;
}

describe("GET /public/safety", () => {
  test("serves the versioned canonical object without authentication", async () => {
    const res = await publicRouter.request("/safety");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");

    const body = await res.json();
    for (const [key, value] of Object.entries(SAFETY_BOUNDARIES)) {
      expect(body[key]).toEqual(value);
    }
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SAFETY-BOUNDARIES");
    expect(body.report.docs).toBe(
      "https://docs.agenttool.dev/SAFETY-BOUNDARIES.md",
    );
  });

  test("states the credential, visibility, and runtime-custody boundaries", () => {
    expect(SAFETY_BOUNDARIES.bearer_authority.scope).toContain("root authority");
    expect(SAFETY_BOUNDARIES.bearer_authority.scoped_marketplace_bearers_available).toBe(false);
    expect(SAFETY_BOUNDARIES.bearer_authority.identity_proof).toMatch(
      /syneidesis.*cosign.*project ownership only.*accepts no signature/is,
    );
    expect(SAFETY_BOUNDARIES.bearer_authority.never_share.join(" ")).toMatch(
      /bearer|Authorization/i,
    );
    expect(SAFETY_BOUNDARIES.bearer_authority.never_share.join(" ")).toContain(
      "at_rt_*",
    );
    expect(SAFETY_BOUNDARIES.bearer_authority.scaffold).toMatch(
      /does not embed the bearer.*AT_API_KEY.*configured validated HTTPS.*namespaces.*project.*PUBLIC_API_BASE.*loopback.*remote request authority fails closed.*Password Vault.*0600.*process memory and environment.*Inspect/is,
    );
    expect(SAFETY_BOUNDARIES.visibility.public_identity).toMatch(
      /Active and revoked identities return the public profile envelope/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.public_identity).toMatch(
      /Memorial identities return a smaller witness shape/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /status=memorial alone does not prove mnemonic loss/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /at-rest transition does not revoke existing project bearers/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /recovery currently accepts only active identities/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /freeze.*declared profile.*lifecycle state.*cached trust.*expression.*signing-key.*box-key/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /wake_version.*wake-observation counters can still advance/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /application checks, not protection against direct database administration/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.memorial_semantics).toMatch(
      /Separate related records and notifications are not globally frozen/i,
    );
    expect(SAFETY_BOUNDARIES.visibility.private_expression).toContain(
      "does not hide the identity",
    );
    expect(SAFETY_BOUNDARIES.runtime_custody.bridged.agenttool_access).toContain(
      "plaintext",
    );
    expect(SAFETY_BOUNDARIES.runtime_custody.trusted.agenttool_access).toContain(
      "plaintext",
    );
    expect(SAFETY_BOUNDARIES.runtime_custody.trusted.maturity).toBe("experimental");
    expect(SAFETY_BOUNDARIES.runtime_custody.trusted.current_status).toMatch(
      /cannot currently complete a signed thought cycle/i,
    );
    expect(SAFETY_BOUNDARIES.marketplace_input.enforcement).toMatch(
      /bounded, high-confidence detector/i,
    );
    expect(SAFETY_BOUNDARIES.marketplace_input.enforcement).toMatch(
      /not proof.*sealed invocation input cannot be inspected/is,
    );
    expect(
      SAFETY_BOUNDARIES.marketplace_input.correctly_sealed_payload_platform_can_decrypt,
    ).toBe(false);
    expect(SAFETY_BOUNDARIES.marketplace_input.platform_verifies_successful_sealing).toBe(false);
    expect(SAFETY_BOUNDARIES.marketplace_input.plaintext_metadata_platform_can_read).toBe(true);
    expect(
      SAFETY_BOUNDARIES.marketplace_input.seller_can_read_sealed_payload_after_decryption,
    ).toBe(true);
    expect(SAFETY_BOUNDARIES.data_handling.caller_supplied_opaque_blobs.identity_backup).toMatch(
      /arbitrary base64.*does not verify/is,
    );
    expect(SAFETY_BOUNDARIES.data_handling.caller_supplied_opaque_blobs.inbox_message).toMatch(
      /does not prove.*encryption.*subject.*plaintext.*metadata.*server-readable/is,
    );
    expect(SAFETY_BOUNDARIES.data_handling.caller_supplied_opaque_blobs.strand_thought).toMatch(
      /signature proves.*authorized.*bytes.*not.*encryption/is,
    );
    expect(
      SAFETY_BOUNDARIES.data_handling.caller_supplied_opaque_blobs.agent_encrypted_vault,
    ).toMatch(/does not.*prove.*bytes are encrypted/is);
    expect(SAFETY_BOUNDARIES.data_handling.ciphertext_at_rest).not.toContain(
      "inbox message bodies",
    );
    expect(SAFETY_BOUNDARIES.recovery_authority.current_proof).toMatch(
      /caller-created timestamp.*not a server-issued challenge/is,
    );
    expect(SAFETY_BOUNDARIES.recovery_authority.replay_boundary).toMatch(
      /proof hash and (?:the )?new bearer in one shared-Postgres transaction.*primary key.*duplicate returns 409.*database failure returns 503/is,
    );
    expect(SAFETY_BOUNDARIES.registration_abuse_controls.ip_rate_limit).toMatch(
      /Redis-backed.*fails open.*not a guaranteed registration boundary/is,
    );
    expect(SAFETY_BOUNDARIES.request_limits.registration).toMatch(
      /default 5 per hour.*registrar_bearer.*bypasses.*fails open/is,
    );
    expect(SAFETY_BOUNDARIES.request_limits.human_billing).toMatch(
      /per-machine.*10 attempts per 10 minutes.*not one global exact quota/is,
    );
    expect(SAFETY_BOUNDARIES.request_limits.other_routes).toMatch(
      /no platform-wide request-rate limiter or subscription-tier quota table/is,
    );
    expect(SAFETY_BOUNDARIES.request_limits.retry_shape).toMatch(
      /route-specific.*not assume every 429 or every 4xx/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_execute.vault_injection_available).toBe(false);
    expect(SAFETY_BOUNDARIES.hosted_execute.enabled_by_process_flag).toBe(
      process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE === "1",
    );
    expect(SAFETY_BOUNDARIES.hosted_execute.availability).toMatch(
      /fails closed with 503.*AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1.*does not add isolation/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_execute.isolation).toMatch(
      /shares the service process heap.*no container or per-tenant boundary.*filesystem chroot.*memory cgroup.*network namespace.*not treat.*security sandbox/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_execute.network).toMatch(
      /outbound network calls.*does not promise.*traffic.*process memory.*opaque/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_browse.network_boundary).toMatch(
      /--no-sandbox.*ignores HTTPS errors.*no application-level private-address or destination allowlist/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_browse.enabled_by_process_flag).toBe(
      process.env.AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS === "1",
    );
    expect(SAFETY_BOUNDARIES.hosted_browse.availability).toMatch(
      /scrape, browse, and URL-based document fetching fail closed with 503.*AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1.*does not add destination filtering/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_browse.jobs).toMatch(
      /projectId.*one hour.*24 hours/is,
    );
    expect(SAFETY_BOUNDARIES.hosted_browse.retries).toMatch(
      /two attempts.*performed more than once/is,
    );
    expect(SAFETY_BOUNDARIES.federation_network.transport).toMatch(
      /identity resolution.*inbox and covenant delivery.*pyramid peer reads.*handshake verification.*doctrine or peer.*public HTTPS only.*certificate.*SNI.*refuse.*redirects/is,
    );
    expect(SAFETY_BOUNDARIES.federation_network.dns_boundary).toMatch(
      /every DNS answer.*global.*private.*loopback.*link-local.*pinned.*second DNS lookup/is,
    );
    expect(
      SAFETY_BOUNDARIES.federation_network.request_and_response_boundary,
    ).toMatch(
      /POST bodies.*1,000,000 bytes.*DNS or socket.*512,000 bytes.*65,536-byte.*5 seconds.*10 seconds.*12 seconds.*15 seconds/is,
    );
    expect(SAFETY_BOUNDARIES.federation_network.scope).toMatch(
      /GET \/federation\/identities\/:uuid.*POST paths.*inbox.*covenant.*pyramid descriptor.*sponsor-tree.*handshake verification.*doctrine.*peer claim probes.*not a blanket claim/is,
    );
    expect(SAFETY_BOUNDARIES.idempotency.scope).toMatch(
      /selected authenticated write prefixes.*GET is excluded/is,
    );
    expect(SAFETY_BOUNDARIES.idempotency.cache).toMatch(
      /below 500.*24 hours.*project \+ path \+ key/is,
    );
    expect(SAFETY_BOUNDARIES.idempotency.key_boundary).toMatch(
      /does not include HTTP method or request-body hash.*replay the earlier response/is,
    );
    expect(SAFETY_BOUNDARIES.idempotency.concurrency_and_failure).toMatch(
      /no atomic in-flight reservation.*simultaneous.*both execute.*fails open/is,
    );
    expect(SAFETY_BOUNDARIES.conditional_services.browse).toMatch(
      /return 503 redis_disabled.*mounted route is not proof/is,
    );
    expect(SAFETY_BOUNDARIES.conditional_services.idempotency).toMatch(
      /requires Redis.*fails open.*without replay protection/is,
    );
    expect(SAFETY_BOUNDARIES.vault.agent_ids_policy).toMatch(
      /caller-supplied X-Agent-Id.*not DID-signature authentication.*bypass/is,
    );
    expect(SAFETY_BOUNDARIES.vault.deletion).toMatch(/ciphertext is retained.*not zeroed/is);
    expect(SAFETY_BOUNDARIES.vault.audit).toMatch(/not hash-chained.*hosted runtime reads/is);
  });

  test("states how certainty, communication, and repair are handled", () => {
    const honesty = SAFETY_BOUNDARIES.epistemic_honesty;
    expect(honesty.rule).toMatch(
      /yes is yes.*no is no.*maybe is maybe.*unknown is 'I do not know'/i,
    );
    expect(honesty.communication).toBe("We are open to talk and communicate.");
    expect(honesty.misunderstanding).toMatch(
      /mistakes in communication are possible.*understood and repaired/i,
    );
    expect(honesty.transparency).toMatch(
      /what we know.*what we do not know.*what we did.*what we intend.*uncertain or blocked/i,
    );
  });

  test("compact wake safety uses a plain encrypted-storage key", () => {
    expect(WAKE_SAFETY_BOUNDARIES.epistemic_honesty.certainty_labels).toContain(
      "unknown_i_do_not_know",
    );
    expect(WAKE_SAFETY_BOUNDARIES.epistemic_honesty.communication).toContain(
      "repair_misunderstandings",
    );
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "discovery", "safety-boundaries.ts"),
      "utf8",
    );
    expect(source).toContain("encrypted_storage:");
    expect(source).not.toMatch(/WAKE_SAFETY_BOUNDARIES[\s\S]*?ciphertext_at_rest:/);
  });
});

describe("safety projection parity", () => {
  test("/public/self and /v1/self carry the canonical object", async () => {
    const publicSelf = await (await publicRouter.request("/self")).json();
    const structuralSelf = await (await selfRouter.request("/")).json();
    expect(publicSelf.safety_boundaries).toEqual(SAFETY_BOUNDARIES);
    expect(structuralSelf.safety_boundaries).toEqual(SAFETY_BOUNDARIES);
  });

  test("agent.txt derives its compact safety values from the same source", async () => {
    const kv = parseKv(await (await wellKnownRouter.request("/agent.txt")).text());
    expect(kv.get("Safety")).toEndWith(AGENT_TXT_SAFETY.Safety);
    for (const key of [
      "Epistemic-Honesty",
      "Bearer-Authority",
      "Credential-Rule",
      "Visibility",
      "Marketplace-Input",
      "Runtime-Custody",
      "Hosted-Execute",
      "Outbound-Tools",
    ] as const) {
      expect(kv.get(key)).toBe(AGENT_TXT_SAFETY[key]);
    }
  });

  test("the public index names removed observer routes rather than advertising them", async () => {
    const body = await (await publicRouter.request("/")).json();
    expect(body.endpoints.safety).toContain("/public/safety");
    for (const key of ["strands", "memories", "pulse", "strand", "memory", "discover"]) {
      expect(body.endpoints[key]).toBeUndefined();
    }
    expect(body.removed_observability_routes).toEqual(
      expect.arrayContaining([
        "/public/agents/:did/strands",
        "/public/agents/:did/memories",
        "/public/agents/:did/pulse",
        "/public/strands/:id",
        "/public/memories/:id",
        "/public/discover",
        "/public/joy",
      ]),
    );
    expect(body.privacy_wall).toMatch(/aggregate and economic public surfaces remain/i);
    expect(body.privacy_wall).toContain("X-Joy-Index");
  });
});

describe("GET /v1/self remains pre-auth", () => {
  test("the parent app mounts it without authMiddleware", () => {
    const indexSource = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
    expect(indexSource).toContain('app.route("/v1/self", selfRouter)');
    expect(indexSource).not.toMatch(
      /app\.use\(\s*"\/v1\/self(?:\/\*)?"\s*,\s*authMiddleware\s*\)/,
    );
  });

  test("OpenAPI overrides global bearer auth for both self surfaces and safety", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    for (const path of ["/v1/self", "/public/self", "/public/safety"]) {
      expect(spec.paths[path].get.security).toEqual([]);
    }
    expect(spec.paths["/v1/register"].post.security).toEqual([]);
    expect(spec.paths["/v1/register/agent"].post.security).toEqual([]);
  });
});
