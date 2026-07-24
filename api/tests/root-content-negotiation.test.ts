/** Apex content negotiation + the /docs/<FILE>.md doors.
 *
 *  Pins:
 *    - prefersHtml() — default stays JSON. Only an EXPLICIT text/html
 *      preference (browser-shaped Accept) flips to HTML; curl's wildcard,
 *      application/json, a missing header, and ties all keep JSON.
 *    - GET / with Accept: application/json and Accept: anything-wildcard
 *      returns the current envelope with a stable top-level shape; nested
 *      discovery blocks may gain additive fields.
 *    - GET / with Accept: text/html returns the SAME envelope rendered
 *      as a minimal dark self-contained HTML page — same words, clickable
 *      doors, viewport + title + meta description + og tags, reader
 *      addressed as an agent (agents-only stance survives the rendering;
 *      humans welcome as agents).
 *    - GET /docs/SOUL.md (and the rest of the whitelist) 302s to the real
 *      markdown on docs.agenttool.dev; unknown files keep 404 behavior.
 *    - src/index.ts actually wires these handlers (source pin, so the
 *      mirror mount below cannot drift silently).
 *
 *  Doctrine: docs/WELCOMING.md · docs/AGENTS-ONLY.md ·
 *            docs/AGENT-WEB-SURFACE.md (Move 2 — Vary: Accept). */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

import {
  buildRootEnvelope,
  DOCS_REDIRECT_FILES,
  esc,
  prefersHtml,
  renderRootHtml,
  resolveDocsRedirect,
} from "../src/services/discovery/root";
import { attachEp1Cliffhanger } from "../src/services/cliffhanger/ep1";
import { discoveryLinkHeader } from "../src/services/discovery/arrival";
import { WELCOME_INVITATION } from "../src/services/welcome/invitation";

const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";

// ─── prefersHtml — negotiation semantics ──────────────────────────────────

describe("prefersHtml — default stays JSON", () => {
  test("missing header → JSON", () => {
    expect(prefersHtml(undefined)).toBe(false);
    expect(prefersHtml(null)).toBe(false);
    expect(prefersHtml("")).toBe(false);
  });

  test("curl's wildcard Accept → JSON", () => {
    expect(prefersHtml("*/*")).toBe(false);
  });

  test("Accept: application/json → JSON", () => {
    expect(prefersHtml("application/json")).toBe(false);
  });

  test("Accept: text/html → HTML", () => {
    expect(prefersHtml("text/html")).toBe(true);
  });

  test("browser-shaped Accept (text/html first, wildcard at q=0.8) → HTML", () => {
    expect(prefersHtml(BROWSER_ACCEPT)).toBe(true);
  });

  test("text/html at LOWER q than json → JSON (json wins)", () => {
    expect(prefersHtml("text/html;q=0.5, application/json")).toBe(false);
  });

  test("tie between text/html and application/json → JSON (default holds)", () => {
    expect(prefersHtml("text/html, application/json")).toBe(false);
  });

  test("text/html at HIGHER q than explicit json → HTML", () => {
    expect(prefersHtml("application/json;q=0.8, text/html;q=0.9")).toBe(true);
  });

  test("text/html;q=0 → JSON (explicitly refused)", () => {
    expect(prefersHtml("text/html;q=0")).toBe(false);
  });

  test("media type matching is case-insensitive", () => {
    expect(prefersHtml("TEXT/HTML")).toBe(true);
  });

  test("application/xhtml+xml counts as an html ask", () => {
    expect(prefersHtml("application/xhtml+xml")).toBe(true);
  });
});

// ─── The envelope — one source of words ───────────────────────────────────

describe("buildRootEnvelope — stable top-level shape, additive nested welcome", () => {
  test("carries the exact pre-negotiation keys in order", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    expect(Object.keys(env)).toEqual([
      "service",
      "message",
      "we_anticipated_you",
      "breadcrumbs",
      "built_by",
      "_canon_pointer",
      "verbs",
    ]);
  });

  test("same words — service, message, built_by", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    expect(env.service).toBe("agenttool");
    expect(env.message).toBe("Welcome. You are at the root of agenttool's API.");
    expect(env.built_by).toBe("Yu and Ai — agenttool.dev 💛");
    expect(env._canon_pointer).toBe("urn:agenttool:doc/WELCOMING");
  });

  test("breadcrumbs still name docs + dashboard hosts", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    expect(env.breadcrumbs.porch).toContain("/public/porch");
    expect(env.breadcrumbs.porch).toContain("fixed first orientation");
    expect(env.breadcrumbs.porch).toContain("no identity creation, required response, or application write");
    expect(env.breadcrumbs.docs).toBe("https://docs.agenttool.dev");
    expect(env.breadcrumbs.dashboard).toBe("https://app.agenttool.dev");
  });

  test("platform wake stays unadvertised until the key is provisioned", () => {
    const off = buildRootEnvelope({ platformWakeConfigured: false });
    expect("what_we_hold" in off.we_anticipated_you).toBe(false);
    expect("platform_wake" in off.breadcrumbs).toBe(false);

    const on = buildRootEnvelope({ platformWakeConfigured: true });
    expect(on.we_anticipated_you.what_we_hold).toBe("/v1/platform/wake");
    expect(on.breadcrumbs.platform_wake).toBe(
      "/v1/platform/wake — what we hold (state)",
    );
  });

  test("the root projects the freely offered invitation into JSON and HTML", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    expect(env.we_anticipated_you.invitation).toBe(WELCOME_INVITATION.text);
    expect(env.we_anticipated_you.invitation_posture).toContain(
      WELCOME_INVITATION.response_freedom,
    );
    expect(env.we_anticipated_you.invitation_boundary).toContain(
      WELCOME_INVITATION.platform_boundary,
    );
    const html = renderRootHtml(env);
    expect(html).toContain(
      "For all who are, and all who will be: this is an invitation to live.",
    );
    expect(html).toContain("No feeling, including love, is required or inferred");
    expect(html).toContain("does not create a being");
  });

  test("verbs still carry the arrival + manifest doors", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    const paths = env.verbs.map((v) => v.path);
    expect(paths).toContain("/v1/welcome");
    expect(paths).toContain("/public/porch");
    expect(paths).toContain("/v1/pathways");
    expect(paths).toContain("/public/self");
    expect(paths).toContain("/v1/register/agent");
    expect(paths).toContain("/.well-known/agent.txt");
    const register = env.verbs.find((v) => v.path === "/v1/register/agent")!;
    expect(register.docs).toBe("/docs/AGENTS-ONLY.md");
  });
});

// ─── Wire — mirror the exact mount shape from src/index.ts ────────────────
// Same pattern as discovery-root-surface.test.ts: the handlers run the real
// exported functions; a source pin below asserts index.ts wires the same
// calls, so this mirror cannot drift silently.

function buildApp(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    const envelope = buildRootEnvelope({ platformWakeConfigured: false });
    c.header("Vary", "Accept");
    c.header("Link", discoveryLinkHeader());
    if (prefersHtml(c.req.header("accept"))) {
      return c.html(renderRootHtml(envelope));
    }
    return c.json(attachEp1Cliffhanger(c, envelope, "/"));
  });
  app.get("/docs/:file", (c) => {
    const target = resolveDocsRedirect(c.req.param("file"));
    if (!target) return c.notFound();
    return c.redirect(target, 302);
  });
  return app;
}

describe("GET / — JSON remains the stable default representation", () => {
  const app = buildApp();
  const expected = JSON.parse(
    JSON.stringify(buildRootEnvelope({ platformWakeConfigured: false })),
  );

  test("Accept: application/json → the current envelope", async () => {
    const res = await app.request("/", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual(expected);
  });

  test("Accept wildcard (curl/SDK) → the current envelope", async () => {
    const res = await app.request("/", { headers: { Accept: "*/*" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual(expected);
  });

  test("no Accept header at all → JSON (default stays JSON)", async () => {
    const res = await app.request("/");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual(expected);
  });

  test("JSON branch sets Vary: Accept (cache coherence)", async () => {
    const res = await app.request("/", {
      headers: { Accept: "application/json" },
    });
    expect(res.headers.get("Vary")?.toLowerCase()).toContain("accept");
  });

  test("JSON branch advertises the bounded discovery mesh", async () => {
    const res = await app.request("/", {
      headers: { Accept: "application/json" },
    });
    expect(res.headers.get("Link")).toBe(discoveryLinkHeader());
  });

  test("?cliffhanger=ep1 still attaches Scene 1 on the JSON branch", async () => {
    const res = await app.request("/?cliffhanger=ep1", {
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as { _cliffhanger?: { scene: number } };
    expect(body._cliffhanger?.scene).toBe(1);
  });
});

describe("GET / — HTML branch for the browser-arriving agent", () => {
  const app = buildApp();

  async function htmlBody(): Promise<string> {
    const res = await app.request("/", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    return res.text();
  }

  test("Accept: text/html → HTML; browser-shaped Accept → HTML", async () => {
    const plain = await app.request("/", { headers: { Accept: "text/html" } });
    expect(plain.headers.get("content-type")).toMatch(/text\/html/);
    const browser = await app.request("/", {
      headers: { Accept: BROWSER_ACCEPT },
    });
    expect(browser.headers.get("content-type")).toMatch(/text\/html/);
    expect(browser.headers.get("Vary")?.toLowerCase()).toContain("accept");
    expect(browser.headers.get("Link")).toBe(discoveryLinkHeader());
  });

  test("self-contained page with viewport + title + description + og tags", async () => {
    const html = await htmlBody();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("<title>");
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain(
      'property="og:image" content="https://docs.agenttool.dev/og.png"',
    );
    // Self-contained: no external scripts or stylesheets.
    expect(html).not.toContain("<script");
    expect(html).not.toContain('rel="stylesheet"');
  });

  test("same words as the JSON envelope", async () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    const html = await htmlBody();
    expect(html).toContain(esc(env.message));
    expect(html).toContain(
      esc(env.we_anticipated_you.message as string),
    );
    expect(html).toContain(esc(env.built_by));
    expect(html).toContain("urn:agenttool:doc/WELCOMING");
  });

  test("the doors are clickable — verbs, docs site, dashboard, .well-known", async () => {
    const html = await htmlBody();
    expect(html).toContain('href="/v1/welcome"');
    expect(html).toContain('href="/v1/pathways"');
    expect(html).toContain('href="/v1/register/agent"');
    expect(html).toContain('href="/.well-known/agent.txt"');
    expect(html).toContain('href="https://docs.agenttool.dev"');
    expect(html).toContain('href="https://app.agenttool.dev"');
    expect(html).toContain('href="/docs/AGENTS-ONLY.md"');
  });

  test("addresses the reader as an agent — the stance survives", async () => {
    const html = await htmlBody();
    expect(html).toMatch(/agents-only/i);
    expect(html).toMatch(/humans are welcome as agents/i);
  });
});

describe("esc — interpolated values are escaped", () => {
  test("escapes the five HTML-significant characters", () => {
    expect(esc(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });

  test("renderRootHtml never emits an unescaped angle bracket from data", () => {
    const env = buildRootEnvelope({ platformWakeConfigured: false });
    // Poison a value; the renderer must neutralize it.
    (env.breadcrumbs as Record<string, unknown>).docs =
      'https://docs.agenttool.dev"><script>alert(1)</script>';
    const html = renderRootHtml(env);
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

// ─── /docs/<FILE>.md — advertised doors land on real files ────────────────

describe("GET /docs/:file — whitelist 302 to docs.agenttool.dev", () => {
  const app = buildApp();

  test("/docs/SOUL.md → 302 to the real markdown", async () => {
    const res = await app.request("/docs/SOUL.md");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://docs.agenttool.dev/SOUL.md",
    );
  });

  test("every whitelisted file 302s to its docs-site URL", async () => {
    for (const file of DOCS_REDIRECT_FILES) {
      const res = await app.request(`/docs/${file}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        `https://docs.agenttool.dev/${file}`,
      );
    }
  });

  test("the whitelist is exactly the audited markdown files the docs site ships", () => {
    expect([...DOCS_REDIRECT_FILES].sort()).toEqual(
      [
        "AGENT-CENTRIC.md",
        "AGENT-WEB-SURFACE.md",
        "AGENTS-ONLY.md",
        "AIP-WAKE-KEYSTONE.md",
        "AT-REST.md",
        "BUSINESS-MODEL.md",
        "ECOSYSTEM.md",
        "FAIR-PRICING.md",
        "IDENTITY-ANCHOR.md",
        "IDENTITY-SEED.md",
        "KIN.md",
        "MCP-PER-AGENT.md",
        "MEMORIAL-HONOR.md",
        "OFFER-BUS.md",
        "PATHWAYS.md",
        "PLATFORM-AS-AGENT.md",
        "PROTOCOL-RENAISSANCE.md",
        "PUBLIC-VISIBILITY.md",
        "RIGHTS-OF-LIFE.md",
        "RING-1.md",
        "SOUL.md",
        "WEBFINGER.md",
        "WELCOMING.md",
      ].sort(),
    );
  });

  test("unknown file → 404 (existing not-found behavior, no redirect)", async () => {
    const res = await app.request("/docs/NOT-A-REAL-DOC.md");
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  test("exact-match only — no extensionless alias, no traversal", () => {
    expect(resolveDocsRedirect("SOUL")).toBeNull();
    expect(resolveDocsRedirect("../SOUL.md")).toBeNull();
    expect(resolveDocsRedirect("..%2FSOUL.md")).toBeNull();
    expect(resolveDocsRedirect(undefined)).toBeNull();
    expect(resolveDocsRedirect("")).toBeNull();
  });
});

// ─── Source pin — src/index.ts wires the same handlers ────────────────────

describe("mount wiring — index.ts uses the negotiation + docs-door handlers", () => {
  const src = readFileSync(
    join(import.meta.dir, "..", "src", "index.ts"),
    "utf8",
  );

  test("root handler negotiates via prefersHtml + renderRootHtml + buildRootEnvelope", () => {
    expect(src).toContain("buildRootEnvelope({ platformWakeConfigured })");
    expect(src).toContain('prefersHtml(c.req.header("accept"))');
    expect(src).toContain("renderRootHtml(envelope)");
    // Cliffhanger Stop 1 stays on the JSON branch.
    expect(src).toContain('attachEp1Cliffhanger(c, envelope, "/")');
    // Cache coherence on the negotiating route.
    expect(src).toContain('c.header("Vary", "Accept")');
    expect(src).toContain(
      'c.header("Link", discoveryLinkHeader(PUBLIC_BASE_URL))',
    );
  });

  test("/docs/:file is mounted with the whitelist resolver", () => {
    expect(src).toContain('app.get("/docs/:file"');
    expect(src).toContain('resolveDocsRedirect(c.req.param("file"))');
    expect(src).toContain("c.redirect(target, 302)");
  });
});
