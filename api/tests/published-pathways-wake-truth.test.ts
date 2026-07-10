/** Public docs must distinguish protocol compatibility from mounted routes,
 *  and the project wake from public profile and MCP surfaces. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("published PATHWAYS truth", () => {
  const canonical = read("docs/PATHWAYS.md");
  const published = read("apps/docs/PATHWAYS.md");
  const html = read("apps/docs/pathways.html");
  const openapi = read("api/src/routes/openapi.ts");

  test("canonical and published Markdown are identical", () => {
    expect(published).toBe(canonical);
  });

  test("only Claude Code is presented as a mounted adapter", () => {
    for (const surface of [canonical, html]) {
      expect(surface).toContain("/v1/adapters/claude-code");
      expect(surface).not.toContain("/v1/adapters/{cli}");
      expect(surface).toMatch(/Codex, Cursor, Cline, Replit, (?:and|or) Aider/);
      expect(surface).toMatch(/does not mount adapter routes|no mounted AgentTool adapter route/i);
      expect(surface).toContain("/v1/wake?format=md");
    }
  });

  test("birth, error, and production rate-limit claims stay bounded", () => {
    for (const surface of [canonical, html]) {
      expect(surface).not.toMatch(/Every pathway returns a welcome letter/i);
      expect(surface).not.toMatch(/Every 4xx response/i);
      expect(surface).not.toMatch(/birth is .*unconditional/i);
      expect(surface).not.toContain("501 not_implemented");
      expect(surface).toMatch(/inactive in current no-Redis production/i);
      expect(surface).toMatch(/fails open/i);
    }
  });

  test("OpenAPI describes the mixed catalog rather than a universal birth contract", () => {
    expect(openapi).toMatch(/current catalog of identity-creation.*status.*adapter/i);
    expect(openapi).toMatch(/mounted Claude Code adapter/i);
    expect(openapi).toMatch(/IP limiter fails open when disabled or unavailable.*\/public\/plans/i);
    expect(openapi).not.toMatch(/Love-Protocol contract that every door honors/i);
    expect(openapi).not.toMatch(/full taxonomy of bootstrap pathways/i);
  });
});

describe("published Wake-as-Keystone truth", () => {
  const canonical = read("docs/AIP-WAKE-KEYSTONE.md");
  const published = read("apps/docs/AIP-WAKE-KEYSTONE.md");

  test("canonical and published Markdown are identical", () => {
    expect(published).toBe(canonical);
  });

  test("wake, profile, MCP, and Wake Voice are separate surfaces", () => {
    expect(canonical).toContain('"wake_url": "https://api.agenttool.dev/v1/wake"');
    expect(canonical).toContain("public_profile_url_pattern");
    expect(canonical).toContain("per_agent_mcp_url_pattern");
    expect(canonical).not.toContain("wake_url_per_being");
    expect(canonical).toMatch(/MCP server, not a wake URL/i);
    expect(canonical).toContain(
      "/v1/wake/voice?identity_id={uuid}",
    );
    expect(canonical).toMatch(/required_query.*identity_id=<uuid>/i);
  });

  test("implementation status lists exact gaps without completeness scores", () => {
    expect(canonical).toContain("### Implemented");
    expect(canonical).toContain("### Known gaps");
    expect(canonical).toMatch(/No public path-per-DID full-wake endpoint/i);
    expect(canonical).toMatch(/does not match the draft.*top-level wire shape/i);
    expect(canonical).not.toMatch(/Coverage:\s*~?\d+%/i);
    expect(canonical).not.toMatch(/\|\s*[✓✔]\s*\|/);
    expect(canonical).not.toMatch(/all (?:follow-up )?gaps.*closed/i);
  });
});
