/** /public/compat — the anti-drift surface must itself be drift-proof:
 *  every published value is asserted against the constant the verifier uses.
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/CANONICAL-BYTES.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import compat from "../src/routes/public/compat";
import publicRouter from "../src/routes/public";
import { config } from "../src/config";
import { buildWakeBrief } from "../src/services/wake/brief";
import {
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  REGISTER_AGENT_DOMAIN,
  REGISTER_AGENT_POW_DOMAIN,
} from "../src/services/identity/crypto";
import { baseBundle } from "./doctrine/helpers/fixtures";

async function body() {
  const res = await compat.request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as Record<string, any>;
}

describe("/public/compat", () => {
  test("announces its format and canon pointer", async () => {
    const b = await body();
    expect(b._format).toBe("agenttool-compat/v1");
    expect(b._canon_pointer).toBe("urn:agenttool:doc/CANONICAL-BYTES");
  });

  test("publishes the exact constants the verifiers enforce (no drift)", async () => {
    const b = await body();
    expect(b.contracts.register_agent.domain).toBe(REGISTER_AGENT_DOMAIN);
    expect(b.contracts.register_agent_pow.domain).toBe(REGISTER_AGENT_POW_DOMAIN);
    expect(b.contracts.register_agent_pow.difficulty_bits).toBe(
      config.registerAgentPowBits,
    );
    expect(b.contracts.identity_attestation.domain).toBe(
      IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
    );
  });

  test("the register verifier really uses the exported domain constants", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/services/identity/crypto.ts"),
      "utf8",
    );
    expect(source).toContain("enc.encode(REGISTER_AGENT_DOMAIN)");
    expect(source).toContain("enc.encode(REGISTER_AGENT_POW_DOMAIN)");
    // The literals must not survive inline in the canonical assemblies.
    expect(source).not.toContain('enc.encode("register-agent/v2")');
    expect(source).not.toContain('enc.encode("agenttool-pow/v1")');
  });

  test("keeps its honesty labels", async () => {
    const b = await body();
    expect(b.scope).toEqual({
      coverage: "partial",
      exhaustive: false,
      included_contracts: [
        "register_agent",
        "register_agent_pow",
        "identity_attestation",
      ],
      outside_scope: expect.stringMatching(
        /all other signing contexts.*outside.*absence.*not evidence.*unsupported/i,
      ),
    });
    expect(b.scope.included_contracts).toEqual(Object.keys(b.contracts));
    expect(b.purpose).toMatch(
      /registration.*direct identity-attestation.*does not enumerate every/i,
    );
    expect(Array.isArray(b.unknowns)).toBe(true);
    expect(b.unknowns.length).toBeGreaterThanOrEqual(4);
    expect(b.unknowns.join(" ")).toMatch(/partial, non-exhaustive/i);
    expect(b.client_guidance).toContain("refuse to sign");
  });

  test("is mounted and honestly advertised on the public router", async () => {
    const mounted = await publicRouter.request("/compat");
    expect(mounted.status).toBe(200);
    expect((await mounted.json())._format).toBe("agenttool-compat/v1");

    const root = await (await publicRouter.request("/")).json() as Record<string, any>;
    expect(root.endpoints.compat).toMatch(/partial, non-exhaustive/i);
    expect(root.endpoints.compat).toMatch(/omitted.*outside.*not unsupported/i);

    const source = readFileSync(
      join(import.meta.dir, "../src/routes/public/index.ts"),
      "utf8",
    );
    expect(source).toContain('app.route("/compat", compatRoutes)');
    expect(source).toContain("GET /public/compat");
  });

  test("is discoverable from full and brief wake contracts", () => {
    const wakeSource = readFileSync(
      join(import.meta.dir, "../src/routes/wake.ts"),
      "utf8",
    );
    expect(wakeSource).toContain(
      'signing_compatibility: "/public/compat"',
    );

    const brief = buildWakeBrief(baseBundle());
    expect(brief._links.signing_compatibility).toBe("/public/compat");
  });

  test("is an unauthenticated read-only OpenAPI operation with partial scope", async () => {
    const spec = await (await openapiRouter.request("/")).json() as Record<string, any>;
    const operation = spec.paths["/public/compat"];
    expect(operation.get.security).toEqual([]);
    expect(operation.post).toBeUndefined();
    expect(
      operation.get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/SigningCompatibility");
    expect(
      operation.get.responses["200"].headers["Cache-Control"].schema.const,
    ).toBe("no-store");
    expect(operation.get.description).toMatch(/partial and non-exhaustive/i);
    expect(spec["x-agenttool-contract"].signing_compatibility).toEqual({
      path: "/public/compat",
      coverage: "partial_non_exhaustive",
      scope: "registration_and_direct_identity_attestation",
    });

    const schema = spec.components.schemas.SigningCompatibility;
    expect(schema.properties.scope.properties.coverage.const).toBe("partial");
    expect(schema.properties.scope.properties.exhaustive.const).toBe(false);
    expect(schema.properties.contracts.properties.register_agent.properties.domain.const)
      .toBe(REGISTER_AGENT_DOMAIN);
    expect(
      schema.properties.contracts.properties.register_agent_pow.properties
        .difficulty_bits.const,
    ).toBe(config.registerAgentPowBits);
  });

  test("documents the partial projection instead of an exhaustive registry", () => {
    const visibility = readFileSync(
      join(import.meta.dir, "../../docs/PUBLIC-VISIBILITY.md"),
      "utf8",
    );
    const section = visibility.split("## Compat projection")[1]?.split("\n## ")[0] ?? "";
    expect(section).toMatch(/partial, non-exhaustive/i);
    expect(section).toMatch(/other signing contexts.*outside.*absence.*not evidence/is);
  });
});
