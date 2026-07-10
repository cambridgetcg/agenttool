/** Pins for outward phrases whose old wording exceeded runtime evidence. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("outward claim boundaries", () => {
  test("recovery descriptions distinguish registered-key proof from mnemonic origin", () => {
    const surfaces = [
      read("api/src/services/discovery/discovery.ts"),
      read("api/src/services/identity/crypto.ts"),
      read("bin/agenttool-seed.ts"),
      read("docs/STACK.md"),
      read("docs/TOKEN-HYGIENE.md"),
      read("packages/sdk-ts/src/seed.ts"),
    ].join("\n");

    expect(surfaces).toMatch(/active registered signing key/i);
    expect(surfaces).toMatch(/not a server-issued challenge/i);
    expect(surfaces).toMatch(/does not (?:know|establish|verify).*key(?:'s)? origin/is);
    expect(surfaces).not.toContain("active seed identity only");
    expect(surfaces).not.toMatch(/possession of the mnemonic is authori[sz]ation/i);
  });

  test("generic BYO registration does not claim mnemonic or SOMA provenance", () => {
    const register = read("api/src/routes/register-agent.ts");
    const mathos = read("api/src/routes/mathos.ts");
    const sdk = read("packages/sdk-ts/src/bootstrap-agent.ts");
    const combined = `${register}\n${mathos}\n${sdk}`;

    expect(combined).toContain('seed_protocol: null');
    expect(combined).toContain('key_origin: "caller_supplied_unverified"');
    expect(register).toContain("key_origin_verified: false");
    expect(register).not.toContain('seed_protocol: "soma-seed-v1"');
    expect(mathos).not.toContain('seed_protocol: "soma-seed-v1"');
  });

  test("wake recovery reports key proof and labels seed/device compatibility fields", () => {
    const wakeRoute = read("api/src/routes/wake.ts");
    const wakeBuilder = read("api/src/services/wake/build.ts");
    const wakeMarkdown = read("api/src/services/wake/markdown.ts");
    const attention = read("api/src/services/wake/attention.ts");
    const surfaces = `${wakeRoute}\n${wakeBuilder}\n${wakeMarkdown}`;

    expect(surfaces).toMatch(/active_registered_signing_keys/is);
    expect(surfaces).toMatch(/registered_key_recovery_available/is);
    expect(surfaces).toMatch(/mnemonic_derivation_verified[^\n]*false/is);
    expect(surfaces).toMatch(/has_seed_protocol_semantics/is);
    expect(surfaces).toMatch(/does not (?:receive|verify|prove|establish).*mnemonic/is);
    expect(surfaces).not.toMatch(/SOMA seed enrolled|keys derive from a SOMA seed/i);
    expect(attention).not.toContain("soma_seed_not_enrolled");
  });

  test("identity composition cannot absorb sibling project foundations", () => {
    const composition = read("api/src/services/identity/composition.ts");
    const tiers = read("api/src/services/memory/tiers.ts");
    const wakeRoute = read("api/src/routes/wake.ts");
    const wakeBuilder = read("api/src/services/wake/build.ts");

    expect(tiers).toContain("listFoundations(\n  projectId: string,\n  identityId: string,");
    expect(tiers).toContain("AND identity_id = ${identityId}");
    expect(composition).toMatch(
      /foundation\.identity_id === identityId/,
    );
    expect(wakeRoute).toMatch(
      /composeExpression\(\s*project\.id,\s*primary\.id,/s,
    );
    expect(wakeBuilder).toMatch(
      /composeExpression\(\s*project\.id,\s*primary\.id,/s,
    );
    expect(wakeRoute).toContain("identity_id-matched effective-expression patches");
    expect(wakeBuilder).toContain('expression_patch_scope: "selected_identity"');
  });

  test("project wake aggregates carry explicit scope and available owner ids", () => {
    const wake = read("api/src/routes/wake.ts");
    for (const section of [
      "you_should_check",
      "you_can_now (mixed selected-identity and project signals)",
      "you_vowed",
      "you_are_thinking_about",
      "you_have_mail",
      "you_offer",
      "you_owe",
      "you_invoked",
      "you_disputed",
      "you_arbitrated",
      "you_decided",
    ]) {
      expect(wake).toContain(`"${section}"`);
    }
    for (const key of [
      "you_should_check",
      "you_vowed",
      "you_are_thinking_about",
      "you_have_mail",
      "you_offer",
      "you_owe",
      "you_invoked",
      "you_disputed",
      "you_arbitrated",
      "you_decided",
    ]) {
      expect(wake).toMatch(
        new RegExp(`${key}: \\{[\\s\\S]{0,180}_scope: \\"project\\"`),
      );
    }
    expect(wake).toMatch(
      /you_can_now: \{[\s\S]{0,180}_scope: "mixed"/,
    );
    expect(wake).toMatch(
      /you_remember: \{[\s\S]*?identity_id: m\.identity_id,/,
    );
    expect(wake).toMatch(
      /you_decided: \{[\s\S]*?agent_id: t\.agent_id,[\s\S]*?identity_id: t\.identity_id,/,
    );
  });

  test("the tutorial claims verifiability, not immutable or permanent storage", () => {
    const route = read("api/src/routes/tutorial.ts");
    const doctrine = read("docs/TUTORIAL-DECENTRALIZED.md");
    const combined = `${route}\n${doctrine}`;

    expect(combined).toMatch(/signature.*does not make.*(?:row|database).*immutable/is);
    expect(combined).toMatch(/while (?:the|that) (?:stored )?record remains available/i);
    expect(combined).not.toContain("Cryptographically un-fakeable");
    expect(combined).not.toContain("permanently, signed, un-fakeable");
    expect(combined).not.toMatch(/surface.*in (?:the )?wake forever/i);
  });

  test("canon discovery describes the registry rather than the whole prose corpus", () => {
    const surfaces = [
      read("api/src/routes/canon.ts"),
      read("api/src/services/discovery/discovery.ts"),
      read("api/src/services/discovery/root.ts"),
      read("api/src/middleware/tutor.ts"),
      read("apps/docs/canon.html"),
    ].join("\n");

    expect(surfaces).toMatch(/registered (?:JSON-LD )?(?:canon )?(?:entry|entries)/i);
    expect(surfaces).toMatch(/prose (?:doctrine )?corpus is broader/i);
    expect(surfaces).not.toContain("Canon — every concept named");
  });

  test("strand descriptions do not infer encryption from field names", () => {
    const handbook = read("AGENTS.md");
    const activity = read("docs/ACTIVITY.md");
    const openapi = read("api/src/routes/openapi.ts");

    expect(handbook).toMatch(/signed caller-supplied strand bytes/i);
    expect(handbook).toMatch(/not a complete\s+export or route inventory/i);
    expect(activity).toMatch(/does not prove the caller encrypted them/i);
    expect(openapi).toMatch(/does not prove caller bytes were encrypted/i);
    expect(handbook).not.toContain(
      "identity, memory, encrypted thought, federated trust, an economic loop",
    );
  });

  test("source package metadata does not claim an absent repository license", () => {
    const tsPackage = JSON.parse(read("packages/sdk-ts/package.json")) as {
      license?: string;
    };
    const pyProject = read("packages/sdk-py/pyproject.toml");
    const readmes = `${read("packages/sdk-ts/README.md")}\n${read("packages/sdk-py/README.md")}`;

    expect(tsPackage.license).toBeUndefined();
    expect(pyProject).not.toMatch(/^license\s*=/m);
    expect(pyProject).not.toContain("License :: OSI Approved :: MIT License");
    expect(readmes).not.toContain("License: MIT");
    expect(readmes).toMatch(/No repository `LICENSE` file currently ships/i);
  });
});
