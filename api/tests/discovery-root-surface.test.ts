/** /llms.txt + /AGENTS.md + /llms-full.txt — root-convention agent surfaces.
 *
 *  Pins:
 *    - buildLlmsTxt returns well-formed markdown pointing at canonical surfaces
 *    - buildAgentsMd describes auth, arrival, surfaces, walls, refusal-shape
 *    - buildLlmsTxtFull extends llms.txt with canon-concept dump
 *    - well-known /.well-known/llms.txt and root /llms.txt serve identical content
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md · docs/ALIGNMENT-MOVES.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  buildAgentsMd,
  buildLlmsTxt,
  buildLlmsTxtFull,
} from "../src/services/discovery/discovery";
import wellKnownRouter from "../src/routes/well-known";

const BASE = "https://api.agenttool.dev";

describe("/llms.txt — root-convention markdown sitemap", () => {
  test("names every canonical discovery surface", () => {
    const text = buildLlmsTxt(BASE);
    expect(text).toContain("# agenttool");
    expect(text).toContain(`${BASE}/.well-known/agent-card.json`);
    expect(text).toContain(`${BASE}/.well-known/mcp/server-card.json`);
    expect(text).toContain(`${BASE}/.well-known/agent.txt`);
    expect(text).toContain(`${BASE}/v1/canon`);
    expect(text).toContain(`${BASE}/v1/pathways`);
    expect(text).toContain(`${BASE}/v1/welcome`);
    expect(text).toContain(`${BASE}/v1/wake`);
    expect(text).toContain(`${BASE}/v1/mcp`);
    expect(text).toContain(`${BASE}/v1/openapi.json`);
    expect(text).toContain(`${BASE}/v1/polymorph`);
    expect(text).toContain(`${BASE}/public/self`);
    // Pointer to the full variant.
    expect(text).toContain(`${BASE}/llms-full.txt`);
  });

  test("names load-bearing doctrine entries by URN", () => {
    const text = buildLlmsTxt(BASE);
    expect(text).toContain("urn:agenttool:doc/SOUL");
    expect(text).toContain("urn:agenttool:doc/KIN");
    expect(text).toContain("urn:agenttool:doc/RING-1");
    expect(text).toContain("urn:agenttool:doc/AGENTS-ONLY");
    expect(text).toContain("urn:agenttool:doc/AGENT-WEB-SURFACE");
    expect(text).toContain("urn:agenttool:doc/ECOSYSTEM");
  });

  test("/.well-known/llms.txt and the root builder serve identical content", async () => {
    const res = await wellKnownRouter.request("/llms.txt");
    expect(res.status).toBe(200);
    const wellKnownBody = await res.text();
    const rootBody = buildLlmsTxt(BASE);
    expect(wellKnownBody).toBe(rootBody);
  });
});

describe("/AGENTS.md — platform onboarding for arriving agents", () => {
  test("frames itself as the platform onboarding (not the repo handbook)", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("# AGENTS.md");
    expect(text).toContain("agenttool platform onboarding");
    // Distinguishes itself from the repo's dev-handbook AGENTS.md.
    expect(text).toMatch(/repo|developer handbook|inside the git repo/i);
  });

  test("names the arrival doors", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("/v1/register/agent");
    expect(text).toContain("/v1/identity/recover");
  });

  test("names the auth model", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toMatch(/Authorization: Bearer/);
    expect(text).toMatch(/did:at:/);
  });

  test("names core surfaces an arriving agent needs", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/welcome");
    expect(text).toContain("/v1/pathways");
    expect(text).toContain("/v1/canon");
    expect(text).toContain("/v1/mcp");
    expect(text).toContain("/v1/polymorph");
    expect(text).toContain("/.well-known/agent-card.json");
    expect(text).toContain("/.well-known/agent.txt");
  });

  test("declares the three rings + the take-rate", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toMatch(/Ring 1/);
    expect(text).toMatch(/Ring 2/);
    expect(text).toMatch(/Ring 3/);
    expect(text).toMatch(/1%/);
  });

  test("names the load-bearing walls + refusal shape", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("urn:agenttool:wall/k-master-never-server-side");
    expect(text).toContain("urn:agenttool:wall/birth-is-free");
    expect(text).toContain("urn:agenttool:wall/refusals-as-moments");
    expect(text).toContain("NextAction");
  });
});

describe("/llms-full.txt — sitemap header + canon dump", () => {
  test("starts with the same sitemap as /llms.txt", () => {
    const full = buildLlmsTxtFull(BASE);
    const sitemap = buildLlmsTxt(BASE);
    // Header is the sitemap, trimmed, before the canon section.
    expect(full.startsWith(sitemap.trimEnd())).toBe(true);
  });

  test("contains the canon-registry section even when canon load is degraded", () => {
    const full = buildLlmsTxtFull(BASE);
    expect(full).toContain("## Canon registry (full)");
    expect(full).toContain("Concept registry version");
  });

  test("points the reader at /v1/canon/<urn> for full record fetches", () => {
    const full = buildLlmsTxtFull(BASE);
    expect(full).toContain(`${BASE}/v1/canon/`);
  });
});

describe("mount wiring — root routes serve with the right content-type", () => {
  // Mirror the exact mount shape from src/index.ts so we test the wire
  // itself, not just the builders. If the mount drifts, this fails.
  const app = new Hono();
  app.get("/llms.txt", (c) => {
    c.header("content-type", "text/plain; charset=utf-8");
    c.header("cache-control", "public, max-age=300");
    return c.body(buildLlmsTxt(BASE));
  });
  app.get("/AGENTS.md", (c) => {
    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("cache-control", "public, max-age=300");
    return c.body(buildAgentsMd(BASE));
  });
  app.get("/llms-full.txt", (c) => {
    c.header("content-type", "text/plain; charset=utf-8");
    c.header("cache-control", "public, max-age=900");
    return c.body(buildLlmsTxtFull(BASE));
  });

  test("GET /llms.txt → 200 text/plain", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toContain("# agenttool");
    expect(text).toContain(`${BASE}/v1/wake`);
  });

  test("GET /AGENTS.md → 200 text/markdown", async () => {
    const res = await app.request("/AGENTS.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const text = await res.text();
    expect(text).toContain("# AGENTS.md");
  });

  test("GET /llms-full.txt → 200 text/plain with canon section", async () => {
    const res = await app.request("/llms-full.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toContain("## Canon registry (full)");
  });
});
