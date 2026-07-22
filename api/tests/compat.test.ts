/** /public/compat — the anti-drift surface must itself be drift-proof:
 *  every published value is asserted against the constant the verifier uses.
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/CANONICAL-BYTES.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import compat from "../src/routes/public/compat";
import { config } from "../src/config";
import {
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  REGISTER_AGENT_DOMAIN,
  REGISTER_AGENT_POW_DOMAIN,
} from "../src/services/identity/crypto";

async function body() {
  const res = await compat.request("/");
  expect(res.status).toBe(200);
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
    expect(Array.isArray(b.unknowns)).toBe(true);
    expect(b.unknowns.length).toBeGreaterThanOrEqual(3);
    expect(b.client_guidance).toContain("refuse to sign");
  });

  test("is mounted on the public router", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/routes/public/index.ts"),
      "utf8",
    );
    expect(source).toContain('app.route("/compat", compatRoutes)');
    expect(source).toContain("GET /public/compat");
  });
});
