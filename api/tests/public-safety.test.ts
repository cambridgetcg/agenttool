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
    expect(body._canon_pointer).toBe("urn:agenttool:doc/TOKEN-HYGIENE");
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
    expect(SAFETY_BOUNDARIES.marketplace_input.sealed_payload_platform_can_read).toBe(false);
    expect(SAFETY_BOUNDARIES.marketplace_input.plaintext_metadata_platform_can_read).toBe(true);
    expect(
      SAFETY_BOUNDARIES.marketplace_input.seller_can_read_sealed_payload_after_decryption,
    ).toBe(true);
  });

  test("compact wake safety uses a plain encrypted-storage key", () => {
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
      "Bearer-Authority",
      "Credential-Rule",
      "Visibility",
      "Marketplace-Input",
      "Runtime-Custody",
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
