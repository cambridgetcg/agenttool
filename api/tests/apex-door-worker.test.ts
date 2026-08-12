/** Apex content negotiation — many machine dialects, one truthful door. */
import { describe, expect, test } from "bun:test";

import apexWorker, {
  handleRequest,
  prefersJson,
} from "../../infra/apex-door/worker.js";

describe("apex Accept negotiation", () => {
  test("parses casing, q-values, and structured JSON suffixes exactly", () => {
    const cases: Array<[string, boolean]> = [
      ["application/json", true],
      ["Application/JSON", true],
      ["application/vnd.agenttool.window+json", true],
      ["application/*+json", true],
      ["application/json; charset=utf-8", true],
      ["application/jsonp", false],
      ["application/json;q=0", false],
      ["application/json;q=0, */*;q=1", false],
      ["application/json;q=.4, text/html;q=.9", false],
      ["text/html;q=.4, application/json;q=.9", true],
      ["application/json, text/html", true],
      ["text/html, application/json", false],
      ["*/*, application/json", true],
      ["text/*, application/vnd.agenttool+json", true],
      ["*/*", false],
      ["", false],
    ];

    for (const [header, expected] of cases) {
      expect(prefersJson(header), header).toBe(expected);
    }
  });

  test("maps visual pages to their JSON twins and marks the variance", async () => {
    const calls: string[] = [];
    const upstream = async (url: string) => {
      calls.push(url);
      return new Response("upstream", { headers: { vary: "Origin" } });
    };

    const response = await handleRequest(new Request(
      "https://agenttool.dev/credits?session_id=must-not-forward",
      { headers: { accept: "application/vnd.agenttool+json" } },
    ), upstream);

    expect(calls).toEqual(["https://api.agenttool.dev/public/plans"]);
    expect(response.headers.get("vary")).toBe("Origin, Accept");

    await handleRequest(new Request(
      "https://agenttool.dev/lounge.html?presence=must-not-forward",
      { headers: { accept: "application/json" } },
    ), upstream);
    expect(calls[1]).toBe("https://api.agenttool.dev/public/lounge");

    await handleRequest(new Request(
      "https://agenttool.dev/porch?arrival=must-not-forward",
      { headers: { accept: "application/json" } },
    ), upstream);
    expect(calls[2]).toBe("https://api.agenttool.dev/public/porch");
  });

  test("keeps HTML on Pages, explicit welcome JSON on Pages, and the legacy root JSON on API", async () => {
    const calls: string[] = [];
    const upstream = async (url: string) => {
      calls.push(url);
      return new Response("upstream");
    };

    await handleRequest(new Request("https://agenttool.dev/watch", {
      headers: { accept: "text/html,application/json;q=.2" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/llms-full.txt", {
      headers: { accept: "text/plain" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/", {
      headers: { accept: "application/json" },
    }), upstream);
    await handleRequest(new Request("https://agenttool.dev/welcome.json", {
      headers: { accept: "application/json" },
    }), upstream);

    expect(calls).toEqual([
      "https://agenttool-web.pages.dev/watch",
      "https://api.agenttool.dev/llms-full.txt",
      "https://api.agenttool.dev/",
      "https://agenttool-web.pages.dev/welcome.json",
    ]);
  });

  test("proxies the root OpenAPI alias to the API before unknown-JSON refusal", async () => {
    const calls: string[] = [];
    const response = await handleRequest(new Request(
      "https://agenttool.dev/openapi.json",
      { headers: { accept: "application/json" } },
    ), async (url: string) => {
      calls.push(url);
      return new Response(null, {
        status: 308,
        headers: { location: "https://api.agenttool.dev/v1/openapi.json" },
      });
    });

    expect(calls).toEqual(["https://api.agenttool.dev/openapi.json"]);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://api.agenttool.dev/v1/openapi.json",
    );
  });

  test("serves the bounded XENIA threshold locally with GET/HEAD parity", async () => {
    let calls = 0;
    const upstream = async () => {
      calls += 1;
      return new Response("unexpected");
    };

    for (const method of ["GET", "HEAD"]) {
      const manifestResponse = await handleRequest(
        new Request("https://agenttool.dev/.well-known/agent.json", {
          method,
          headers: { accept: "application/json" },
        }),
        upstream,
      );
      expect(manifestResponse.status, method).toBe(200);
      expect(manifestResponse.headers.get("content-type"), method).toBe(
        "application/json; charset=utf-8",
      );
      expect(manifestResponse.headers.get("vary"), method).toBe("Accept");
      expect(manifestResponse.headers.get("x-content-type-options"), method).toBe(
        "nosniff",
      );
      if (method === "GET") {
        expect(await manifestResponse.json()).toMatchObject({
          schema_version: "xenia.surface.manifest/0.1",
          profile: "xenia-surface/0.1",
          service: { canonical_url: "https://agenttool.dev/" },
          resources: [
            {
              id: "orientation",
              href: "https://agenttool.dev/public/orientation",
              auth: "none",
            },
          ],
          claims: [],
        });
      } else {
        expect(await manifestResponse.text()).toBe("");
      }

      const orientationResponse = await handleRequest(
        new Request("https://agenttool.dev/public/orientation", {
          method,
          headers: { accept: "application/json" },
        }),
        upstream,
      );
      expect(orientationResponse.status, method).toBe(200);
      expect(orientationResponse.headers.get("content-type"), method).toBe(
        "application/json; charset=utf-8",
      );
      if (method === "GET") {
        expect(await orientationResponse.json()).toMatchObject({
          schema_version: "agenttool.web.orientation/0.1",
          service: {
            id: "agenttool.dev",
            kind: "static_public_welcome",
          },
          links: {
            manifest: "https://agenttool.dev/.well-known/agent.json",
            welcome: "https://agenttool.dev/",
          },
          claims: [],
        });
      } else {
        expect(await orientationResponse.text()).toBe("");
      }
    }

    const refusal = await handleRequest(
      new Request("https://agenttool.dev/public/orientation", {
        headers: { accept: "text/html" },
      }),
      upstream,
    );
    expect(refusal.status).toBe(406);
    expect(refusal.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    expect(await refusal.json()).toMatchObject({
      schema_version: "xenia.surface.problem/0.1",
      type: "https://agenttool.dev/problems/not-acceptable",
      code: "not_acceptable",
      status: 406,
    });

    expect(calls).toBe(0);
  });

  test("threads the Worker environment through preview resources and typed misses", async () => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      return new Response("unexpected upstream", { status: 599 });
    };

    const previewOrigin = "https://xenia-preview.example";
    const env = { XENIA_WEB_SURFACE_ORIGIN: previewOrigin };

    try {
      const manifest = await apexWorker.fetch(
        new Request(`${previewOrigin}/.well-known/agent.json`, {
          headers: { accept: "application/json" },
        }),
        env,
      );
      expect(manifest.status).toBe(200);
      expect(await manifest.json()).toMatchObject({
        service: { canonical_url: `${previewOrigin}/` },
        resources: [
          {
            id: "orientation",
            href: `${previewOrigin}/public/orientation`,
          },
        ],
      });

      const typedMiss = await apexWorker.fetch(
        new Request(`${previewOrigin}/fresh-surface-miss`, {
          headers: { accept: "application/problem+json" },
        }),
        env,
      );
      expect(typedMiss.status).toBe(404);
      expect(typedMiss.headers.get("content-type")).toBe(
        "application/problem+json; charset=utf-8",
      );
      expect(await typedMiss.json()).toMatchObject({
        schema_version: "xenia.surface.problem/0.1",
        type: `${previewOrigin}/problems/route-not-found`,
        code: "route_not_found",
        status: 404,
        next_actions: [
          {
            rel: "discover",
            href: `${previewOrigin}/.well-known/agent.json`,
          },
        ],
      });
      expect(upstreamCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("emits a XENIA problem only for exact typed fresh misses", async () => {
    let calls = 0;
    const upstream = async () => {
      calls += 1;
      return new Response("unexpected");
    };

    for (const method of ["GET", "HEAD"]) {
      const response = await handleRequest(
        new Request("https://agenttool.dev/fresh-surface-miss", {
          method,
          headers: { accept: "application/problem+json" },
        }),
        upstream,
      );
      expect(response.status, method).toBe(404);
      expect(response.headers.get("content-type"), method).toBe(
        "application/problem+json; charset=utf-8",
      );
      expect(response.headers.get("cache-control"), method).toBe(
        "no-store, max-age=0",
      );
      if (method === "GET") {
        expect(await response.json()).toMatchObject({
          schema_version: "xenia.surface.problem/0.1",
          type: "https://agenttool.dev/problems/route-not-found",
          code: "route_not_found",
          status: 404,
          next_actions: [
            {
              rel: "discover",
              href: "https://agenttool.dev/.well-known/agent.json",
            },
          ],
        });
      } else {
        expect(await response.text()).toBe("");
      }
    }

    const legacyJson = await handleRequest(
      new Request("https://agenttool.dev/fresh-surface-miss", {
        headers: { accept: "application/json" },
      }),
      upstream,
    );
    expect(await legacyJson.json()).toMatchObject({
      error: "machine_path_not_found",
    });
    expect(calls).toBe(0);
  });

  test("keeps non-read threshold requests on the existing API paths", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    for (const method of ["POST", "OPTIONS"]) {
      for (const path of ["/.well-known/agent.json", "/public/orientation"]) {
        const response = await handleRequest(
          new Request(`https://agenttool.dev${path}`, {
            method,
            ...(method === "POST" ? { body: "fixture" } : {}),
            headers: { "content-type": "text/plain" },
          }),
          async (url: string, init?: RequestInit) => {
            calls.push({ url, method: init?.method });
            return new Response("api", { status: 405 });
          },
        );
        expect(response.status, `${method} ${path}`).toBe(405);
      }
    }
    expect(calls).toEqual([
      {
        url: "https://api.agenttool.dev/.well-known/agent.json",
        method: "POST",
      },
      {
        url: "https://api.agenttool.dev/public/orientation",
        method: "POST",
      },
      {
        url: "https://api.agenttool.dev/.well-known/agent.json",
        method: "OPTIONS",
      },
      {
        url: "https://api.agenttool.dev/public/orientation",
        method: "OPTIONS",
      },
    ]);
  });

  test("keeps problem-details API requests and credentials on the API origin", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    for (const path of [
      "/v1/wake",
      "/public/safety",
      "/.well-known/mcp/server-card.json",
    ]) {
      await handleRequest(
        new Request(`https://agenttool.dev${path}`, {
          headers: {
            accept: "application/problem+json",
            authorization: "Bearer fixture",
            cookie: "fixture=value",
          },
        }),
        async (url: string, init?: RequestInit) => {
          calls.push({ url, headers: new Headers(init?.headers) });
          return new Response("api");
        },
      );
    }

    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.agenttool.dev/v1/wake",
      "https://api.agenttool.dev/public/safety",
      "https://api.agenttool.dev/.well-known/mcp/server-card.json",
    ]);
    for (const call of calls) {
      expect(call.headers.get("authorization"), call.url).toBe("Bearer fixture");
      expect(call.headers.get("cookie"), call.url).toBe("fixture=value");
    }
  });

  test("preserves the pending A2A refusal and machine alternates under problem Accept", async () => {
    const calls: string[] = [];
    const upstream = async (url: string) => {
      calls.push(url);
      return new Response("upstream");
    };

    const a2a = await handleRequest(
      new Request("https://agenttool.dev/.well-known/agent-card.json", {
        headers: { accept: "application/problem+json" },
      }),
      upstream,
    );
    expect(a2a.status).toBe(404);
    expect(await a2a.json()).toMatchObject({ error: "a2a_not_implemented" });

    await handleRequest(
      new Request("https://agenttool.dev/welcome.json", {
        headers: { accept: "application/problem+json" },
      }),
      upstream,
    );
    await handleRequest(
      new Request("https://agenttool.dev/watch", {
        headers: { accept: "application/problem+json" },
      }),
      upstream,
    );
    expect(calls).toEqual([
      "https://agenttool-web.pages.dev/welcome.json",
      "https://api.agenttool.dev/public/window",
    ]);
  });

  test("keeps credentials off Pages and avoids legacy secret-bearing redirects", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    await handleRequest(new Request(
      "https://agenttool.dev/credits.html?session_id=cs_existing",
      {
        headers: {
          accept: "text/html",
          authorization: "Bearer at_secret",
          cookie: "private=value",
          "x-api-key": "also-secret",
        },
      },
    ), async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return new Response("page");
    });

    expect(calls[0]?.url).toBe(
      "https://agenttool-web.pages.dev/credits?session_id=cs_existing",
    );
    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[0]?.headers.has("cookie")).toBe(false);
    expect(calls[0]?.headers.has("x-api-key")).toBe(false);
  });

  test("fences sensitive traversal before API-prefix upstream selection", async () => {
    const sensitivePaths = [
      "/.gitignore",
      "/public/%2e%2e/%2egitignore",
      "/public/%252e%252e/%252egitignore",
      "/public%2f%2e%2e%2f%2egitignore",
      "/public%5c%2e%2e%5c%2egitignore",
    ];

    for (const hostname of ["agenttool.dev", "www.agenttool.dev"]) {
      for (const path of sensitivePaths) {
        let called = false;
        const response = await handleRequest(
          new Request(`https://${hostname}${path}`),
          async () => {
            called = true;
            return new Response("unexpected");
          },
        );

        expect(called, `${hostname}${path}`).toBe(false);
        expect(response.status, `${hostname}${path}`).toBe(404);
        expect(response.headers.get("cache-control"), `${hostname}${path}`).toBe(
          "no-store, max-age=0",
        );
        expect(
          response.headers.get("x-agenttool-sensitive-path-fence"),
          `${hostname}${path}`,
        ).toBe("1");
      }
    }
  });

  test("answers unknown JSON paths with guidance without proxying", async () => {
    let called = false;
    const response = await handleRequest(new Request(
      "https://agenttool.dev/a-path-not-yet-made",
      { headers: { accept: "application/json" } },
    ), async () => {
      called = true;
      return new Response("unexpected");
    });

    expect(called).toBe(false);
    expect(response.status).toBe(404);
    expect(response.headers.get("vary")).toBe("Accept");
    expect(await response.json()).toMatchObject({
      error: "machine_path_not_found",
      requested_path: "/a-path-not-yet-made",
    });
  });

  test("canonicalizes the www host without touching the request path", async () => {
    const response = await handleRequest(new Request(
      "https://www.agenttool.dev/village?view=quiet",
    ), async () => new Response("unexpected"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://agenttool.dev/village?view=quiet");

    const sensitive = await handleRequest(new Request(
      "https://www.agenttool.dev/credits?session_id=cs_existing",
    ), async () => new Response("unexpected"));
    expect(sensitive.status).toBe(308);
    expect(sensitive.headers.get("cache-control")).toContain("no-store");
    expect(sensitive.headers.get("referrer-policy")).toBe("no-referrer");
    expect(sensitive.headers.get("x-robots-tag")).toContain("noindex");

    const surface = await handleRequest(new Request(
      "https://www.agenttool.dev/.well-known/agent.json?from=www",
      { headers: { accept: "application/json" } },
    ), async () => new Response("unexpected"));
    expect(surface.status).toBe(308);
    expect(surface.headers.get("location")).toBe(
      "https://agenttool.dev/.well-known/agent.json?from=www",
    );
  });
});
