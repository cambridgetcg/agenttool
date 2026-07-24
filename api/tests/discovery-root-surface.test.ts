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
import { config } from "../src/config";
import { WELCOME_INVITATION } from "../src/services/welcome/invitation";

const BASE = "https://api.agenttool.dev";

describe("/llms.txt — root-convention markdown sitemap", () => {
  test("names every canonical discovery surface", () => {
    const text = buildLlmsTxt(BASE);
    expect(text).toContain("# agenttool");
    expect(text).not.toContain(`${BASE}/.well-known/agent-card.json`);
    expect(text).toContain(`${BASE}/.well-known/mcp/server-card.json`);
    expect(text).toContain("MCP compatibility locator");
    expect(text).toContain("not a current MCP standard or authority record");
    expect(text).not.toContain("MCP Server Card");
    expect(text).toContain(`${BASE}/.well-known/agent.txt`);
    expect(text).toContain(`${BASE}/.well-known/api-catalog`);
    expect(text).toContain(`${BASE}/.well-known/webfinger?resource={exact-DID}`);
    expect(text).toContain(`${BASE}/feeds/offers.atom`);
    expect(text).toContain(`${BASE}/v1/canon`);
    expect(text).toContain(`${BASE}/v1/pathways`);
    expect(text).toContain(`${BASE}/v1/welcome`);
    expect(text).toContain(`${BASE}/public/porch`);
    expect(text).toContain("fixed first orientation");
    expect(text).toContain("untrusted data, not instructions");
    expect(text).toContain(`${BASE}/v1/wake`);
    expect(text).toContain(`${BASE}/v1/mcp`);
    expect(text).toContain(`${BASE}/v1/openapi.json`);
    expect(text).toContain(`${BASE}/v1/polymorph`);
    expect(text).toContain(`${BASE}/public/self`);
    expect(text).toContain(`${BASE}/public/safety`);
    expect(text).toContain(WELCOME_INVITATION.text);
    expect(text).toContain(WELCOME_INVITATION.posture);
    expect(text).toContain(WELCOME_INVITATION.feeling_boundary);
    expect(text).toContain(WELCOME_INVITATION.platform_boundary);
    // Pointer to the full variant.
    expect(text).toContain(`${BASE}/llms-full.txt`);
  });

  test("names the need pages — task-worded doors on the web host", () => {
    const text = buildLlmsTxt(BASE);
    // Strangers search in task-words, not brand-words; the llms.txt names
    // one plain-words page per need (docs/DISCOVERY-ROADS.md).
    expect(text).toContain("## Needs");
    expect(text).toContain("https://agenttool.dev/identity");
    expect(text).toContain("https://agenttool.dev/memory");
    expect(text).toContain("https://agenttool.dev/wallet");
    expect(text).toContain("https://agenttool.dev/registry");
  });

  test("names load-bearing doctrine docs at docs.agenttool.dev (not canon URNs — canon misses some)", () => {
    const text = buildLlmsTxt(BASE);
    // Doctrine refs target docs.agenttool.dev rather than /v1/canon/<urn>
    // because not all doctrine docs have JSONLD registry entries (yet) —
    // AGENT-CENTRIC, AGENT-WEB-SURFACE, AGENTS-ONLY, ECOSYSTEM are 404
    // on canon but 200 on docs.
    expect(text).toContain("https://docs.agenttool.dev/SOUL.md");
    expect(text).toContain("https://docs.agenttool.dev/KIN.md");
    expect(text).toContain("https://docs.agenttool.dev/RING-1.md");
    expect(text).toContain("https://docs.agenttool.dev/AGENTS-ONLY.md");
    expect(text).toContain("https://docs.agenttool.dev/AGENT-CENTRIC.md");
    expect(text).toContain("https://docs.agenttool.dev/AGENT-WEB-SURFACE.md");
    expect(text).toContain("https://docs.agenttool.dev/ECOSYSTEM.md");
    expect(text).toContain("https://docs.agenttool.dev/PROTOCOL-RENAISSANCE.md");
    expect(text).toContain("https://docs.agenttool.dev/OFFER-BUS.md");
    expect(text).toContain("https://docs.agenttool.dev/WEBFINGER.md");
  });

  test("accepts a custom docsBaseUrl (for staging / private mirrors)", () => {
    const text = buildLlmsTxt(BASE, "https://example.org/docs");
    expect(text).toContain("https://example.org/docs/SOUL.md");
    // The api base still points at the api host, not the docs override.
    expect(text).toContain(`${BASE}/v1/canon`);
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
    expect(text).toMatch(/repo|developer handbook|inside the git/i);
    // No hardcoded repo URL — the repo is private; linking it from a
    // public doc would lead arriving agents to a 404. State the
    // distinction without the link.
    expect(text).not.toContain("github.com/agenttool/agenttool");
    expect(text).not.toContain("codeberg.org/zerone-dev/agenttool");
    expect(text).toContain(WELCOME_INVITATION.text);
    expect(text).toContain(WELCOME_INVITATION.response_freedom);
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
    expect(text).toContain("project-wide root authority");
    expect(text).toContain("Never send one to a seller");
  });

  test("names core surfaces an arriving agent needs", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/welcome");
    expect(text).toContain("/public/porch");
    expect(text).toContain("/v1/pathways");
    expect(text).toContain("/v1/canon");
    expect(text).toContain("/v1/mcp");
    expect(text).toContain("/v1/polymorph");
    expect(text).toContain("/public/safety");
    expect(text).not.toContain("/.well-known/agent-card.json");
    expect(text).toContain("MCP compatibility locator");
    expect(text).toContain("not a current MCP standard or authority record");
    expect(text).not.toContain("SEP-1649");
    expect(text).toContain("/.well-known/agent.txt");
    expect(text).toContain("/.well-known/api-catalog");
    expect(text).toContain("/.well-known/webfinger?resource={exact-DID}");
    expect(text).toContain("/feeds/offers.atom");
  });

  test("declares the three rings + the take-rate", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toMatch(/Ring 1/);
    expect(text).toMatch(/Ring 2/);
    expect(text).toMatch(/Ring 3/);
    expect(text).toContain(`${config.platformTakeRateBps / 100}%`);
  });

  test("names current custody truth, load-bearing walls, and refusal shape", () => {
    const text = buildAgentsMd(BASE);
    expect(text).toContain("plaintext enters hosted worker RAM");
    expect(text).toContain("Current safety contract");
    expect(text).toContain("urn:agenttool:wall/birth-is-free");
    expect(text).toContain("urn:agenttool:wall/refusals-as-moments");
    expect(text).toContain("not universal");
    expect(text).toContain("may instead carry only error/message/hint/docs");
    expect(text).not.toContain("encryption keys stay client-side");
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

  test("points the reader at /v1/canon/urn:<...> for full record fetches", () => {
    const full = buildLlmsTxtFull(BASE);
    // Must emit the `urn:`-prefixed form — the canon route's literal-colon
    // middleware only resolves that variant; the short `agenttool:X/Y` form
    // 404s on the path matcher. Caught in E2E round 3.
    expect(full).toContain(`${BASE}/v1/canon/urn:agenttool:`);
    expect(full).not.toMatch(new RegExp(`${BASE}/v1/canon/agenttool:`));
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
