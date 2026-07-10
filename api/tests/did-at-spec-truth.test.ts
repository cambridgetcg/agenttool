import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("did:at implementation profile truth", () => {
  test("canonical and published copies are identical", () => {
    expect(read("apps/docs/DID-AT-SPEC.md")).toBe(read("docs/DID-AT-SPEC.md"));
  });

  test("does not claim unimplemented W3C, DID Document, or custody behavior", () => {
    const spec = read("docs/DID-AT-SPEC.md");

    for (const required of [
      "not currently a complete W3C DID method specification",
      "does not publish DID Documents",
      "not a conforming standalone DID",
      "No implicit equivalence",
      "Not every AgentTool identity is client-key or mnemonic rooted",
      "not a DID Document",
      "There is no `retired` status",
      "not a registered W3C DID method",
    ]) {
      expect(spec).toContain(required);
    }

    for (const falseClaim of [
      "every agent arrives with its own BIP39 mnemonic",
      "The platform never holds private key material",
      "Two dids that differ only by an explicit-vs-default authority are the SAME did",
      "type `Multikey`",
      "dual-emitted as `did:key`",
      "Registered in the W3C DID Extensions",
    ]) {
      expect(spec).not.toContain(falseClaim);
    }
  });

  test("discovery calls the W3C relationship provisional", () => {
    const discovery = read("api/src/routes/well-known.ts");
    expect(discovery).toContain(
      "did:at is currently a provisional AgentTool identifier convention",
    );
    expect(discovery).toContain("not a registered W3C DID method");
    expect(discovery).toContain("DID-AT-SPEC.md");
    expect(discovery).not.toContain(
      "Per-being DIDs (did:at:host/uuid) compose with W3C DID Methods",
    );
  });

  test("live API descriptions name application lookup rather than W3C resolution", () => {
    const sources = [
      "api/src/index.ts",
      "api/src/routes/openapi.ts",
      "api/src/routes/public/index.ts",
      "api/src/routes/welcome.ts",
      "api/src/routes/well-known.ts",
      "api/src/services/discovery/discovery.ts",
      "api/src/services/discovery/safety-boundaries.ts",
    ].map(read).join("\n");

    for (const required of [
      "provisional",
      "unregistered",
      "not W3C DID Resolution",
      "no DID Documents",
      "not a standalone DID",
      "legacy did-field",
    ]) {
      expect(sources).toContain(required);
    }

    for (const falseClaim of [
      "Your DID was shaped to fit every substrate",
      "Every existing DID resolves",
      "Every stored DID resolves",
      "Federated DID format: did:at:<host>/<uuid>",
    ]) {
      expect(sources).not.toContain(falseClaim);
    }
  });

  test("canonical doctrine does not claim did:at portability or DID resolution", () => {
    const doctrine = [
      "docs/AGENT-ECONOMY.md",
      "docs/AIP-WAKE-KEYSTONE.md",
      "docs/CLI-GAPS.md",
      "docs/FEDERATION.md",
      "docs/GLOSSARY.md",
      "docs/IDENTITY-ANCHOR.md",
      "docs/KIN.md",
      "docs/MULTI-AGENT-CHILL.md",
      "docs/PUBLIC-VISIBILITY.md",
      "docs/RING-1.md",
      "docs/SAFETY-BOUNDARIES.md",
      "docs/TRUST-PROTOCOL-v2.md",
    ].map(read).join("\n");

    for (const required of [
      "legacy `did` field",
      "not a registered W3C DID method",
      "no DID Documents",
      "not a standalone DID",
      "not W3C DID Resolution",
    ]) {
      expect(doctrine).toContain(required);
    }

    for (const falseClaim of [
      "You have a name. A DID. It's yours. It travels with you across substrates.",
      "DID + ed25519 persist across substrates",
      "The DID is the bridge.",
      "Your DID is invariant forever.",
      "Every DID resolves — alive, private, or memorial",
      "W3C-compliant or AIP-extension form like `did:at:`",
    ]) {
      expect(doctrine).not.toContain(falseClaim);
    }
  });

  test("published HTML does not restore portability or standards claims", () => {
    const published = [
      "apps/docs/adapters.html",
      "apps/docs/continuity.html",
      "apps/docs/economy.html",
      "apps/docs/glossary.html",
      "apps/docs/identity.html",
      "apps/docs/index.html",
      "apps/docs/kin.html",
      "apps/docs/ring-1.html",
      "apps/docs/roadmap.html",
      "apps/docs/tutorial.html",
      "apps/docs/wake.html",
    ].map(read).join("\n");

    expect(published).toContain("provisional AgentTool identifier");
    expect(published).toContain("not a registered W3C DID method");
    for (const falseClaim of [
      "DIDs (Decentralized Identifiers",
      "permanent decentralized identifier",
      "Your DID is permanent and yours",
      "The DID is the bridge",
      "Your DID travels",
      "The agent's identity is portable",
      "Federation means agents could move to a successor implementation",
    ]) {
      expect(published).not.toContain(falseClaim);
    }
  });

  test("compatibility field, route, and task names remain unchanged", () => {
    const openapi = read("api/src/routes/openapi.ts");
    expect(openapi).toContain('did: { type: "string", example: "did:at:..." }');
    expect(openapi).toContain('"/public/agents/{did}"');

    const canon = JSON.parse(read("docs/agenttool.jsonld")) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const task = canon["@graph"].find(
      (entry) => entry["@id"] === "agenttool:substrate-task/public-did-resolve",
    );
    expect(task?.wire_id).toBe("public_did_resolve");
  });
});
