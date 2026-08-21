import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { handleRequest as handleApexRequest } from "../apex-door/worker.js";
import {
  handlePagesRequest,
  sensitivePathNotFound,
  surfaceResponseForRequest,
} from "./sensitive-path-worker.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()";

const SURFACES = [
  {
    name: "dashboard",
    directory: "apps/dashboard",
    origin: "https://app.agenttool.dev",
    hashesStyles: true,
  },
  {
    name: "docs",
    directory: "apps/docs",
    origin: "https://docs.agenttool.dev",
    hashesStyles: false,
  },
  {
    name: "web",
    directory: "apps/web",
    origin: "https://agenttool.dev",
    hashesStyles: true,
  },
] as const;

function filesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

function hashSources(
  directory: string,
  expression: RegExp,
  capture = 1,
): Set<string> {
  const sources = new Set<string>();
  for (const path of filesUnder(directory).filter((file) => file.endsWith(".html"))) {
    const html = readFileSync(path, "utf8");
    for (const match of html.matchAll(expression)) {
      sources.add(
        `'sha256-${createHash("sha256").update(match[capture] ?? "").digest("base64")}'`,
      );
    }
  }
  return sources;
}

function headersForRule(source: string, rule: string): Map<string, string> {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === rule);
  if (start < 0) throw new Error(`Missing ${rule} header rule`);

  const headers = new Map<string, string>();
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "" || !/^\s/.test(line)) break;
    const declaration = line.trim();
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    headers.set(
      declaration.slice(0, separator).toLowerCase(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return headers;
}

function expectGeneratedSecurity(response: Response): void {
  expect(response.headers.get("strict-transport-security")).toBe("max-age=300");
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  expect(response.headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-permitted-cross-domain-policies")).toBe("none");
}

describe("Cloudflare Pages security policy", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} has compatible static security headers`, async () => {
      const directory = join(REPOSITORY_ROOT, surface.directory);
      const headerPath = join(directory, "_headers");
      const source = readFileSync(headerPath, "utf8");
      const pervasiveHeaders = headersForRule(source, "/*");
      const response = await handlePagesRequest(
        new Request(`${surface.origin}/edge-security-fixture.html`),
        {
          ASSETS: {
            fetch: async () => new Response("fixture"),
          },
        },
      );
      const csp = response.headers.get("content-security-policy") ?? "";

      expect(pervasiveHeaders.get("strict-transport-security")).toBe("max-age=300");
      expect(pervasiveHeaders.get("x-permitted-cross-domain-policies")).toBe("none");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=300");
      expect(response.headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-permitted-cross-domain-policies")).toBe("none");

      for (const directive of [
        "base-uri 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "child-src 'none'",
        "worker-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ]) {
        expect(csp).toContain(directive);
      }
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      const configuredCsp = pervasiveHeaders.get("content-security-policy");
      if (configuredCsp !== undefined) expect(configuredCsp).toBe(csp);

      const scriptHashes = hashSources(
        directory,
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi,
      );
      expect(scriptHashes.size).toBeGreaterThan(0);
      for (const hash of scriptHashes) expect(csp).toContain(hash);

      const handlerHashes = hashSources(
        directory,
        /\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi,
        2,
      );
      if (handlerHashes.size === 0) {
        expect(csp).toContain("script-src-attr 'none'");
      } else {
        expect(csp).toContain("script-src-attr 'unsafe-hashes'");
        for (const hash of handlerHashes) expect(csp).toContain(hash);
      }

      const styleHashes = hashSources(
        directory,
        /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
      );
      if (surface.hashesStyles) {
        expect(styleHashes.size).toBeGreaterThan(0);
        for (const hash of styleHashes) expect(csp).toContain(hash);
      } else {
        // Docs has 79 distinct inline style attributes. Omitting a style
        // directive preserves them without weakening the script boundary.
        expect(csp).not.toContain("style-src");
      }

      const rules = source.split(/\r?\n/).filter((line) =>
        line !== "" && !line.startsWith("#") && !/^\s/.test(line)
      );
      expect(rules.length).toBeLessThanOrEqual(100);
      for (const line of source.split(/\r?\n/)) {
        expect(line.length).toBeLessThanOrEqual(2_000);
      }
    });
  }
});

describe("Worker-generated response boundaries", () => {
  test("secures exact Surface responses without changing their cache or body", async () => {
    const request = new Request("https://agenttool.dev/.well-known/agent.json");
    const response = surfaceResponseForRequest(request);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("public, max-age=300");
    expectGeneratedSecurity(response!);

    const body = await response!.text();
    const head = surfaceResponseForRequest(new Request(request, { method: "HEAD" }));
    expect(head?.status).toBe(200);
    expect(head?.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await head!.text()).toBe("");
    expect(JSON.parse(body)).toMatchObject({
      schema_version: "xenia.surface.manifest/0.1",
      service: { canonical_url: "https://agenttool.dev/" },
    });
    expectGeneratedSecurity(head!);
  });

  test("secures sensitive-path refusals and never invokes the asset binding", async () => {
    let assetCalls = 0;
    const request = new Request("https://docs.agenttool.dev/public/%252e%252e/%252egitignore");
    const response = await handlePagesRequest(request, {
      ASSETS: {
        fetch: async () => {
          assetCalls += 1;
          return new Response("unexpected");
        },
      },
    });

    expect(assetCalls).toBe(0);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-agenttool-sensitive-path-fence")).toBe("1");
    expectGeneratedSecurity(response);

    const head = sensitivePathNotFound(new Request(request, { method: "HEAD" }));
    expect(await head.text()).toBe("");
    expectGeneratedSecurity(head);
  });

  test("preserves Pages asset metadata while filling absent security headers", async () => {
    const assetResponse = new Response("asset", {
      headers: { "x-pages-fixture": "untouched" },
    });
    const response = await handlePagesRequest(
      new Request("https://docs.agenttool.dev/style.css"),
      { ASSETS: { fetch: async () => assetResponse } },
    );

    expect(response.headers.get("x-pages-fixture")).toBe("untouched");
    expect(await response.text()).toBe("asset");
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src-elem 'self' https://docs.agenttool.dev",
    );
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  test("does not weaken stricter route-specific Pages policies", async () => {
    const response = await handlePagesRequest(
      new Request("https://docs.agenttool.dev/xenia-helly"),
      {
        ASSETS: {
          fetch: async () => new Response("lab", {
            headers: {
              "Content-Security-Policy": "default-src 'none'; script-src 'none'",
              "Permissions-Policy": "camera=(), microphone=()",
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Frame-Options": "DENY",
            },
          }),
        },
      },
    );

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'none'",
    );
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=()",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=300",
    );
  });

  test("secures apex-local machine refusals and redirects", async () => {
    const unknown = await handleApexRequest(
      new Request("https://agenttool.dev/not-published", {
        headers: { accept: "application/json" },
      }),
      async () => new Response("unexpected"),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    expect(await unknown.json()).toMatchObject({ error: "machine_path_not_found" });
    expectGeneratedSecurity(unknown);

    const a2a = await handleApexRequest(
      new Request("https://agenttool.dev/.well-known/agent-card.json"),
      async () => new Response("unexpected"),
    );
    expect(a2a.status).toBe(404);
    expect(a2a.headers.get("cache-control")).toBe("no-store");
    expectGeneratedSecurity(a2a);

    const redirect = await handleApexRequest(
      new Request("https://www.agenttool.dev/village?view=quiet"),
      async () => new Response("unexpected"),
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(redirect.headers.get("location")).toBe(
      "https://agenttool.dev/village?view=quiet",
    );
    expectGeneratedSecurity(redirect);
  });

  test("rejects unsafe early data only at the local method-preserving redirect", async () => {
    let redirectUpstreamCalls = 0;
    const tooEarly = await handleApexRequest(
      new Request("https://www.agenttool.dev/v1/wake", {
        method: "POST",
        headers: { "Early-Data": "1", "content-type": "application/json" },
        body: "{}",
      }),
      async () => {
        redirectUpstreamCalls += 1;
        return new Response("unexpected");
      },
    );
    expect(redirectUpstreamCalls).toBe(0);
    expect(tooEarly.status).toBe(425);
    expect(tooEarly.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(tooEarly.headers.get("vary")).toBe("Early-Data");
    expectGeneratedSecurity(tooEarly);

    const safeRedirect = await handleApexRequest(
      new Request("https://www.agenttool.dev/v1/wake", {
        headers: { "Early-Data": "1" },
      }),
      async () => new Response("unexpected"),
    );
    expect(safeRedirect.status).toBe(308);

    let forwardedEarlyData: string | null = null;
    const direct = await handleApexRequest(
      new Request("https://agenttool.dev/v1/wake", {
        method: "POST",
        headers: { "Early-Data": "1", "content-type": "application/json" },
        body: "{}",
      }),
      async (_url, init) => {
        forwardedEarlyData = new Headers(init?.headers).get("Early-Data");
        return new Response("api", { status: 202 });
      },
    );
    expect(direct.status).toBe(202);
    expect(forwardedEarlyData).toBe("1");
  });
});
