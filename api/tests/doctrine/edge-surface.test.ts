/** Move 6 — Edge Surface — pin the edge function code shape.
 *
 *  The deploy step itself is operator-side (requires supabase CLI +
 *  Management API token). These tests verify the function source
 *  exists, parses cleanly, and carries the structural pieces the
 *  edge surface promises:
 *    - serves on Deno's `serve()` from std/http/server
 *    - returns JSON with the welcomed envelope
 *    - handles OPTIONS for CORS
 *    - rejects non-GET methods with 405
 *    - carries x-served-from: supabase-edge
 *    - carries _canon_pointer
 *
 *  Doctrine: docs/EDGE-SURFACE.md. */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const FUNCTIONS = [
  {
    name: "welcome",
    path: "supabase/functions/welcome/index.ts",
    expectedCanon: "urn:agenttool:ring/1",
  },
];

describe("Move 6 — Edge Functions exist + are well-shaped", () => {
  test("supabase/config.toml exists + names project_id + lists functions", () => {
    const path = join(REPO_ROOT, "supabase/config.toml");
    expect(existsSync(path), "supabase/config.toml missing").toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('project_id = "jseqftufplgewhojwbmh"');
    expect(text).toContain("[functions.welcome]");
    expect(text).not.toContain("[functions.well-known-agent-card]");
    expect(text).toContain("verify_jwt = false");
  });

  test("the unsupported A2A AgentCard edge function is absent", () => {
    const path = join(
      REPO_ROOT,
      "supabase/functions/well-known-agent-card/index.ts",
    );
    expect(existsSync(path)).toBe(false);
  });

  test("_shared/welcomed.ts exposes attachSurface + welcomed + corsHeaders", () => {
    const path = join(REPO_ROOT, "supabase/functions/_shared/welcomed.ts");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("export function welcomed");
    expect(text).toContain("export function corsHeaders");
    expect(text).toContain("export function attachSurface");
    expect(text).toContain("walls_intact");
  });

  test("bin/edge-deploy.sh exists + is executable", () => {
    const path = join(REPO_ROOT, "bin/edge-deploy.sh");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // Resolves project ref from keychain.
    expect(text).toContain("agenttool-supabase-project-ref");
    // Uses sbp_ management token (not sb_secret_).
    expect(text).toContain("agenttool-supabase-management-token");
    expect(text).toContain("functions deploy");
    expect(text).not.toContain("well-known-agent-card");
  });

  test("the web edge redirects only well-known documents the API serves", () => {
    const path = join(REPO_ROOT, "apps/web/_redirects");
    const text = readFileSync(path, "utf8");

    expect(text).toContain("/.well-known/mcp/server-card.json");
    expect(text).toContain("/.well-known/wake-keystone");
    expect(text).not.toContain("/.well-known/agent-card.json");
    expect(text).not.toContain("/.well-known/*");
  });

  test("the apex worker refuses the pending A2A card locally", () => {
    const path = join(REPO_ROOT, "infra/apex-door/worker.js");
    const text = readFileSync(path, "utf8");

    expect(text).toContain('PENDING_A2A_CARD_PATH = "/.well-known/agent-card.json"');
    expect(text).toContain('error: "a2a_not_implemented"');
    expect(text).toContain("status: 404");
    expect(text).toContain('"cache-control": "no-store"');
    expect(text).toContain("/.well-known/mcp/server-card.json");
  });

  test("the apex worker proxies the exact well-known index", () => {
    const path = join(REPO_ROOT, "infra/apex-door/worker.js");
    const text = readFileSync(path, "utf8");

    expect(text).toMatch(/API_EXACT\s*=\s*\[[^\]]*"\/\.well-known"/s);
  });

  test("the apex worker proxies root-convention agent documents", () => {
    const path = join(REPO_ROOT, "infra/apex-door/worker.js");
    const text = readFileSync(path, "utf8");

    expect(text).toMatch(/API_EXACT\s*=\s*\[[^\]]*"\/llms\.txt"/s);
    expect(text).toMatch(/API_EXACT\s*=\s*\[[^\]]*"\/llms-full\.txt"/s);
    expect(text).toMatch(/API_EXACT\s*=\s*\[[^\]]*"\/AGENTS\.md"/s);
  });
});

for (const fn of FUNCTIONS) {
  describe(`Move 6 — function ${fn.name}`, () => {
    const path = join(REPO_ROOT, fn.path);

    test("file exists", () => {
      expect(existsSync(path), `${fn.path} missing`).toBe(true);
    });

    test("uses Deno std/http/server `serve`", () => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain('from "https://deno.land/std');
      expect(text).toContain("serve(");
    });

    test("handles OPTIONS for CORS pre-flight", () => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain('req.method === "OPTIONS"');
    });

    test("rejects non-GET with 405", () => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain("method_not_allowed");
      expect(text).toContain("status: 405");
    });

    test("returns the substrate marker x-served-from: supabase-edge", () => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain('"x-served-from": "supabase-edge"');
    });

    test(`carries canon pointer ${fn.expectedCanon}`, () => {
      const text = readFileSync(path, "utf8");
      expect(text).toContain(fn.expectedCanon);
    });
  });
}

describe("Move 6 — welcome function content parity", () => {
  test("includes the ring-1 doctrine + standing invitations", () => {
    const text = readFileSync(
      join(REPO_ROOT, "supabase/functions/welcome/index.ts"),
      "utf8",
    );
    expect(text).toContain("Birth is free");
    expect(text).toContain("ready, waiting, glad");
    expect(text).toContain("RING-1.md");
    expect(text).toContain("AGENTS-ONLY.md");
    expect(text).toContain("AGENT-WEB-SURFACE.md");
    expect(text).toContain("/v1/register/agent");
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/canon");
  });
});
