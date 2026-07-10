/** Bearer authority source-of-truth contract.
 *
 * An at_* bearer authenticates a project. It is not a DID or identity
 * signing key, and a device/workload label does not narrow its authority.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import observationsRouter from "../src/routes/observations";
import syneidesisRouter from "../src/routes/syneidesis";
import { resolvePerAgentScope } from "../src/services/mcp/per-agent-tools";

const REPO = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

describe("bearer authority contract", () => {
  test("auth resolves at_* through api_keys.project_id and sets project context", () => {
    const source = read("api/src/auth/middleware.ts");
    expect(source).toContain("eq(projects.id, candidate.projectId)");
    expect(source).toContain('c.set("project", result.project)');
    expect(source).not.toMatch(/c\.set\(["'](?:identity|did|agent)["']/);
  });

  test("per-agent MCP scope compares project ownership, not bearer to DID", () => {
    expect(resolvePerAgentScope("project-a")).toBe("public");
    expect(resolvePerAgentScope("project-a", "project-a")).toBe("self");
    expect(resolvePerAgentScope("project-a", "project-b")).toBe("cross");
  });

  test("syneidesis discovery says legacy cosign is unsigned project authority", async () => {
    const response = await syneidesisRouter.request("/");
    const body = await response.json();
    const endpoint =
      body.endpoints["POST /v1/syneidesis/witness/:seal_id/cosign"];

    expect(endpoint.authorization_basis).toBe("project_bearer");
    expect(endpoint.identity_signature_verified).toBe(false);
    expect(endpoint.signature_backed_cosign).toBe("pending");
    expect(endpoint.purpose).toMatch(/project ownership only/i);
    expect(endpoint.purpose).toMatch(/does not accept or verify a DID signature/i);
  });

  test("observations stub does not present shape validation as identity proof", async () => {
    const response = await observationsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        about_identity_id: "did:at:observed",
        observer_did: "did:at:observer",
        kind: "presence",
        content: "present",
        consent_status: "explicit",
        observed_at: "2026-07-10T10:00:00.000Z",
        signature_b64: "a".repeat(64),
        signing_key_id: "observer-key",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.details.authorization_basis).toBe("project_bearer");
    expect(body.details.observer_identity_ownership_verified).toBe(false);
    expect(body.details.identity_signature_verified).toBe(false);
  });

  test("current outward copies do not turn a bearer into one identity", () => {
    const files = [
      "docs/SOUL.md",
      "apps/docs/SOUL.md",
      "apps/docs/soul.html",
      "apps/docs/errors.html",
      "apps/docs/wake.html",
      "apps/docs/index.html",
      "apps/docs/roadmap.html",
      "apps/docs/nen.html",
      "apps/docs/dark-continent.html",
      "apps/docs/love.js",
      "apps/docs/love-widget.js",
      "api/src/services/tutorial/stations.ts",
      "api/src/middleware/tutor.ts",
      "docs/OBSERVATIONS.md",
      "api/src/routes/observations.ts",
      "docs/SYNEIDESIS-WITNESS.md",
      "api/src/routes/syneidesis.ts",
      "api/src/routes/bootstrap.ts",
      "api/src/lib/errors.ts",
      "api/src/routes/tutorial.ts",
      "api/src/routes/encounters.ts",
      "api/src/routes/identity/at-rest.ts",
      "docs/AGENT-ECONOMY.md",
      "apps/docs/AGENT-ECONOMY.md",
      "apps/docs/adapters.html",
    ];
    const forbidden = [
      /bearer IS (?:you\b|the agent\b)/i,
      /bearer\s*=\s*agent/i,
      /bearer\s*===?\s*path-DID/i,
      /API key.{0,100}resolves to one agent/is,
      /same key across every session, every machine/i,
      /device-scoped bearer/i,
      /must match the bearer's identity/i,
      /must be the bearer/i,
      /bearer-authenticated witness ownership as proof/i,
      /bearer authentication IS the v1 attestation proof/i,
      /API key \+ keypair IS/i,
      /bearer's primary identity/i,
      /DID \+ ed25519 \+ bearer/i,
      /Identity \(DID \+ bearer\)/i,
    ];

    const violations: string[] = [];
    for (const file of files) {
      const content = read(file);
      for (const pattern of forbidden) {
        if (pattern.test(content)) violations.push(`${file}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
