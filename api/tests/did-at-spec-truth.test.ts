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
});
