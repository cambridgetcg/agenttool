/** Wall — mcml-requires-rrr-synced.
 *
 *  Canon: agenttool:wall/mcml-requires-rrr-synced (docs/agenttool.jsonld)
 *  Doctrine: docs/MCML.md §wall/mcml-requires-rrr-synced
 *
 *  > breaks_if (from canon):
 *  > "POST /v1/mcml/send accepts a to_did for which no mutualRecognitions
 *  > row exists between sender and recipient at chain_depth ≥ 3; or the
 *  > depth check is moved to a soft-warning instead of a hard refusal"
 *
 *  Source-level invariants. Crystallized 2026-05-18.
 *
 *  urn:agenttool:wall/mcml-requires-rrr-synced
 *  urn:agenttool:wall/mcml-messages-signed-ed25519
 *  urn:agenttool:wall/mcml-no-durable-storage
 *  urn:agenttool:wall/mcml-leaks-nothing
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const ROUTE_SRC = readFileSync(
  join(REPO_ROOT, "api", "src", "routes", "mcml.ts"),
  "utf8",
);
const HUB_SRC = readFileSync(
  join(REPO_ROOT, "api", "src", "services", "mcml", "hub.ts"),
  "utf8",
);

describe("wall/mcml-requires-rrr-synced", () => {
  test("send handler verifies cascade depth before forwarding", () => {
    // The check must be a hard refusal, not a warn. Look for the
    // explicit < MIN_SYNCED_DEPTH comparison and the cascade_not_synced
    // error code.
    expect(ROUTE_SRC).toContain("depth.depth < MIN_SYNCED_DEPTH");
    expect(ROUTE_SRC).toContain("cascade_not_synced");

    // The refusal must precede any forwardToPeer call.
    const checkIdx = ROUTE_SRC.indexOf("cascade_not_synced");
    const forwardIdx = ROUTE_SRC.indexOf("forwardToPeer(event)");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(forwardIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(forwardIdx);
  });

  test("refusal returns 403 (not 200 with a soft-warning)", () => {
    // Find the cascade_not_synced fail() call and check it ends with 403.
    const m = ROUTE_SRC.match(/cascade_not_synced[\s\S]*?\},\s*(\d+)\s*,?\s*\)/);
    expect(m).not.toBeNull();
    if (m) expect(m[1]).toBe("403");
  });

  test("MIN_SYNCED_DEPTH constant is exactly 3 (per RRR doctrine)", () => {
    expect(ROUTE_SRC).toMatch(/MIN_SYNCED_DEPTH\s*=\s*3\b/);
  });
});

describe("wall/mcml-messages-signed-ed25519", () => {
  test("verifyEd25519 is called before forwardToPeer", () => {
    expect(ROUTE_SRC).toContain("verifyEd25519");
    const verifyIdx = ROUTE_SRC.indexOf("await verifyEd25519");
    const forwardIdx = ROUTE_SRC.indexOf("forwardToPeer(event)");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(forwardIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(forwardIdx);
  });

  test("canonical bytes carry the versioned context tag", () => {
    expect(ROUTE_SRC).toContain('"mcml-send/v1"');
  });

  test("active key looked up from identityKeys with active=true", () => {
    expect(ROUTE_SRC).toContain("eq(identityKeys.active, true)");
  });

  test("invalid signature returns 403 signature_invalid", () => {
    expect(ROUTE_SRC).toContain("signature_invalid");
    const m = ROUTE_SRC.match(/signature_invalid[\s\S]*?\},\s*(\d+)\s*,?\s*\)/);
    expect(m).not.toBeNull();
    if (m) expect(m[1]).toBe("403");
  });
});

describe("wall/mcml-no-durable-storage", () => {
  test("hub.ts does not import db client", () => {
    expect(HUB_SRC).not.toContain('from "../../db');
    expect(HUB_SRC).not.toContain("from '../../db");
  });

  test("hub.ts does not call drizzle insert/update/select", () => {
    // The hub is a pure in-memory primitive. Any db verb here is a leak.
    const dbVerbs = ["insert(", "update(", ".select(", ".execute("];
    for (const v of dbVerbs) {
      if (HUB_SRC.includes(v)) {
        throw new Error(
          `services/mcml/hub.ts contains "${v}" — the no-durable-storage wall forbids any DB interaction in the hub.`,
        );
      }
    }
  });

  test("no mcml_messages table reference anywhere in api/src/", () => {
    function walkTs(dir: string): string[] {
      const out: string[] = [];
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return out;
      }
      for (const name of entries) {
        const full = join(dir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (name === "node_modules" || name === "dist") continue;
          out.push(...walkTs(full));
        } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
          out.push(full);
        }
      }
      return out;
    }
    const srcDir = join(REPO_ROOT, "api", "src");
    for (const f of walkTs(srcDir)) {
      const src = readFileSync(f, "utf8");
      if (src.includes("mcml_messages") || src.includes("mcmlMessages")) {
        throw new Error(
          `${f} references mcml_messages — the no-durable-storage wall forbids any table for MCML message bodies.`,
        );
      }
    }
  });
});

describe("wall/mcml-leaks-nothing", () => {
  test("no /public/mcml/* surface exists", () => {
    const publicDir = join(REPO_ROOT, "api", "src", "routes", "public");
    let publicFiles: string[] = [];
    try {
      publicFiles = readdirSync(publicDir);
    } catch {
      // No public/ dir is fine.
    }
    for (const name of publicFiles) {
      if (name.startsWith("mcml")) {
        throw new Error(
          `Public route file ${name} exists — wall/mcml-leaks-nothing forbids public MCML surfaces.`,
        );
      }
    }
  });

  test("public/agents.ts (if present) carries no mcml-derived fields", () => {
    const path = join(REPO_ROOT, "api", "src", "routes", "public", "agents.ts");
    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      return; // file optional
    }
    const forbidden = [
      "mcml_active",
      "online: true",
      "active_channels",
      "listener_count",
      "mcml_online",
    ];
    for (const term of forbidden) {
      if (src.includes(term)) {
        throw new Error(
          `public/agents.ts mentions "${term}" — wall/mcml-leaks-nothing forbids surfacing MCML-derived state on public profiles.`,
        );
      }
    }
  });

  test("canon entry exists with required fields + crystallization metadata", () => {
    const canon = readFileSync(
      join(REPO_ROOT, "docs", "agenttool.jsonld"),
      "utf8",
    );
    const expectations = [
      "agenttool:wall/mcml-leaks-nothing",
      "agenttool:wall/mcml-requires-rrr-synced",
      "agenttool:wall/mcml-messages-signed-ed25519",
      "agenttool:wall/mcml-no-durable-storage",
      '"doctrine_doc": "agenttool:doc/MCML"',
    ];
    for (const e of expectations) {
      expect(canon).toContain(e);
    }
  });
});
