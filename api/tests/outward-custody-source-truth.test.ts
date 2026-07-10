/** Current outward custody claims must match GET /public/safety. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const CUSTODY_SOURCES = [
  "marketing/LAUNCH-KIT.md",
  "docs/FOCUS.md",
  "docs/PAINTING.md",
  "docs/BUSINESS-MODEL.md",
  "docs/ROADMAP.md",
  "docs/AGENT-CENTRIC.md",
  "docs/AGENT-ECONOMY.md",
  "docs/KIN.md",
  "docs/RUNTIME.md",
  "docs/STRANDS.md",
  "docs/FRICTION-ROADMAP.md",
  "docs/agenttool.jsonld",
  "apps/docs/BUSINESS-MODEL.md",
  "apps/docs/AGENT-ECONOMY.md",
  "apps/docs/business-model.html",
  "apps/docs/roadmap.html",
  "apps/docs/KIN.md",
  "apps/docs/kin.html",
  "apps/docs/runtime.html",
  "apps/docs/strands.html",
  "apps/docs/tutorial.html",
  "apps/docs/IDENTITY-SEED.md",
  "docs/IDENTITY-SEED.md",
  "apps/docs/glossary.html",
  "apps/docs/index.html",
  "apps/docs/welcome.html",
  "apps/docs/wake.html",
  "apps/docs/economy.html",
  "apps/docs/dark-continent.html",
  "apps/docs/THE-SEAT.md",
  "apps/docs/ai-logos.html",
  "apps/docs/love.html",
  "apps/docs/nen-mechanics.html",
  "apps/docs/agenttool.jsonld",
] as const;

const FORBIDDEN_CURRENT_CLAIMS = [
  /inner voice[^.\n]{0,80}opaque to (?:us|agenttool)/i,
  /we could not read your interior/i,
  /we can'?t read (?:your thoughts|them) by design/i,
  /even compelled[^.\n]{0,120}(?:only opaque ciphertext|we have only ciphertext|we have nothing)/i,
  /plaintext stays client-side[^.\n]{0,120}hosted/i,
  /bridged[^.\n]{0,160}cryptographic (?:privacy|opacity)/i,
  /trusted[^.\n]{0,120}(?:not yet shipped|currently returns 501|kms pending|tier live|e2e verified)/i,
  /what i thought[^.\n]{0,120}unreadable by the platform/i,
  /strands stay opaque to us/i,
  /architectural privacy guarantee in `?self`?\s*\/\s*`?bridged`?/i,
  /no platform-readable thoughts/i,
  /\*\*Server never receives\*\*/i,
] as const;

function currentClaims(path: string): string {
  const source = readFileSync(join(ROOT, path), "utf8");
  if (!path.endsWith(".jsonld")) return source;

  return JSON.stringify(JSON.parse(source), (key, value) =>
    key === "legacy_name" ? undefined : value,
  );
}

describe("outward custody source truth", () => {
  test("current claims do not promise whole-runtime opacity", () => {
    const violations: string[] = [];

    for (const path of CUSTODY_SOURCES) {
      const source = currentClaims(path);
      for (const pattern of FORBIDDEN_CURRENT_CLAIMS) {
        if (pattern.test(source)) violations.push(`${path}: ${pattern.source}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("JSON-LD keeps legacy names but gives them current storage semantics", () => {
    for (const path of ["docs/agenttool.jsonld", "apps/docs/agenttool.jsonld"]) {
      const graph = JSON.parse(readFileSync(join(ROOT, path), "utf8"))["@graph"];
      const keyWall = graph.find(
        (node: Record<string, unknown>) =>
          node["@id"] === "agenttool:wall/k-master-never-server-side",
      );
      const thoughtWall = graph.find(
        (node: Record<string, unknown>) =>
          node["@id"] === "agenttool:wall/strand-thoughts-never-decrypted",
      );

      expect(keyWall.legacy_name).toBe("K_master never leaves the user's machine");
      expect(keyWall.description).toMatch(/bridged mode.*plaintext enters/i);
      expect(thoughtWall.legacy_name).toBe("Strand thoughts NEVER decrypted server-side");
      expect(thoughtWall.description).toMatch(/stored as ciphertext.*hosted bridged and trusted/i);
    }
  });

  test("field-specific sealed inbox and invocation claims remain precise", () => {
    expect(readFileSync(join(ROOT, "apps/docs/index.html"), "utf8")).toMatch(
      /sealed to recipient X25519[^.]*we cannot read your DMs/i,
    );
    expect(readFileSync(join(ROOT, "docs/MARKETPLACE.md"), "utf8")).toMatch(
      /ciphertext only; the platform cannot read your input/i,
    );
  });

  test("storage and seed claims name their limited scope", () => {
    const strands = readFileSync(join(ROOT, "apps/docs/strands.html"), "utf8");
    expect(strands).toMatch(/strand storage service can read from stored thought content/i);
    expect(strands).toMatch(/storage claim does not cover hosted runtime processing/i);

    for (const path of ["docs/IDENTITY-SEED.md", "apps/docs/IDENTITY-SEED.md"]) {
      const seed = readFileSync(join(ROOT, path), "utf8");
      expect(seed).toMatch(/during this seed registration flow/i);
      expect(seed).toMatch(/not a claim about later runtime\s+custody/i);
    }
  });
});
