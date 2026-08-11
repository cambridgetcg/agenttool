import { describe, expect, test } from "bun:test";

import pagesWorker from "../../infra/pages/sensitive-path-worker.js";

const DOCS = "https://docs.agenttool.dev";
const MANIFEST_PATH = "/.well-known/agent.json";
const ORIENTATION_PATH = "/public/orientation";

type AssetEnvironment = {
  XENIA_DOCS_SURFACE_ORIGIN?: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

function request(
  origin: string,
  path: string,
  { method = "GET", accept }: { method?: string; accept?: string } = {},
): Request {
  return new Request(`${origin}${path}`, {
    method,
    ...(accept === undefined ? {} : { headers: { Accept: accept } }),
  });
}

function throwingAssets(): AssetEnvironment {
  return {
    ASSETS: {
      async fetch(): Promise<Response> {
        throw new Error("the direct Surface route must not reach ASSETS");
      },
    },
  };
}

function assetFixture(status = 404): {
  env: AssetEnvironment;
  requests: Request[];
} {
  const requests: Request[] = [];
  return {
    requests,
    env: {
      ASSETS: {
        async fetch(assetRequest): Promise<Response> {
          requests.push(assetRequest);
          return new Response(`asset:${new URL(assetRequest.url).pathname}`, {
            status,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "X-Asset-Fixture": "1",
            },
          });
        },
      },
    },
  };
}

function surfaceHeaders(response: Response): Record<string, string | null> {
  return {
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    vary: response.headers.get("vary"),
    nosniff: response.headers.get("x-content-type-options"),
  };
}

describe("docs.agenttool.dev XENIA Surface 0.1 Pages pilot", () => {
  test("keeps the sensitive-root denial ahead of Surface and asset routing", async () => {
    const fixture = assetFixture();
    const response = await pagesWorker.fetch(
      request(DOCS, "/public/%252e%252e/.git/config", {
        accept: "application/problem+json",
      }),
      fixture.env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("x-agenttool-sensitive-path-fence")).toBe("1");
    expect(response.headers.get("vary")).toBeNull();
    expect(await response.text()).toBe("Not Found\n");
    expect(fixture.requests).toHaveLength(0);
  });

  test("serves one claim-free docs manifest and JSON orientation with exact negotiation", async () => {
    const env = throwingAssets();
    const manifestResponse = await pagesWorker.fetch(
      request(DOCS, MANIFEST_PATH, { accept: "application/json" }),
      env,
    );
    expect(manifestResponse.status).toBe(200);
    expect(surfaceHeaders(manifestResponse)).toEqual({
      cacheControl: "public, max-age=300",
      contentType: "application/json; charset=utf-8",
      vary: "Accept",
      nosniff: "nosniff",
    });
    const manifest = await manifestResponse.json() as {
      $schema: string;
      schema_version: string;
      profile: string;
      service: { name: string; canonical_url: string };
      resources: Array<{
        id: string;
        href: string;
        representations: string[];
        default_media_type: string;
        auth: string;
      }>;
      claims: unknown[];
      not_covered: string[];
      documentation: string;
    };
    expect(manifest).toMatchObject({
      $schema:
        "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/manifest.schema.json",
      schema_version: "xenia.surface.manifest/0.1",
      profile: "xenia-surface/0.1",
      service: {
        name: "AgentTool documentation",
        canonical_url: `${DOCS}/`,
      },
      resources: [
        {
          id: "orientation",
          href: `${DOCS}${ORIENTATION_PATH}`,
          representations: ["application/json"],
          default_media_type: "application/json",
          auth: "none",
        },
      ],
      claims: [],
      documentation: `${DOCS}/AGENT-DISCOVERY.md`,
    });
    expect(manifest.not_covered).toEqual(
      expect.arrayContaining([
        "XENIA Covenant adoption or XENIA conformance",
        "AgentTool API operations, private data, bearer-authenticated routes, WAKE continuity, and economic activity",
      ]),
    );

    for (const accept of [
      "application/json",
      "text/html;q=0, application/json;q=1",
      "application/*;q=1, text/html;q=0.2",
      "*/*",
    ]) {
      const response = await pagesWorker.fetch(
        request(DOCS, ORIENTATION_PATH, { accept }),
        env,
      );
      expect(response.status, accept).toBe(200);
      expect(response.headers.get("content-type"), accept).toBe(
        "application/json; charset=utf-8",
      );
      expect(response.headers.get("vary"), accept).toBe("Accept");
      const body = await response.json() as {
        schema_version: string;
        service: { id: string; kind: string };
        links: Record<string, string>;
        claims: unknown[];
        not_covered: string[];
      };
      expect(body).toMatchObject({
        schema_version: "agenttool.docs.orientation/0.1",
        service: {
          id: "docs.agenttool.dev",
          kind: "static_public_documentation",
        },
        links: {
          manifest: `${DOCS}${MANIFEST_PATH}`,
          documentation: `${DOCS}/AGENT-DISCOVERY.md`,
          rights: `${DOCS}/RIGHTS-OF-LIFE.md`,
        },
        claims: [],
      });
      expect(body.not_covered).toEqual(manifest.not_covered);
    }

    for (const accept of [
      "text/html",
      "application/json;q=0, */*;q=1",
      "application/x-xenia-unsupported",
    ]) {
      const response = await pagesWorker.fetch(
        request(DOCS, ORIENTATION_PATH, { accept }),
        env,
      );
      expect(response.status, accept).toBe(406);
      expect(response.headers.get("content-type"), accept).toBe(
        "application/problem+json; charset=utf-8",
      );
      expect(response.headers.get("vary"), accept).toBe("Accept");
      expect(await response.json(), accept).toMatchObject({
        schema_version: "xenia.surface.problem/0.1",
        code: "not_acceptable",
        status: 406,
        retryable: false,
        terminal: false,
        next_actions: [
          {
            rel: "retry_with_supported_representation",
            href: `${DOCS}${ORIENTATION_PATH}`,
            method: "GET",
            accept: "application/json",
          },
        ],
      });
    }
  });

  test("keeps GET and HEAD metadata equal for success, refusal, and discovery miss", async () => {
    const cases = [
      { path: MANIFEST_PATH, accept: "application/json", status: 200 },
      { path: ORIENTATION_PATH, accept: "application/json", status: 200 },
      { path: ORIENTATION_PATH, accept: "text/html", status: 406 },
      {
        path: "/xenia-pilot-unpredictable-miss",
        accept: "application/problem+json",
        status: 404,
      },
    ];

    for (const { path, accept, status } of cases) {
      const getFixture = path.includes("unpredictable")
        ? assetFixture().env
        : throwingAssets();
      const headFixture = path.includes("unpredictable")
        ? assetFixture().env
        : throwingAssets();
      const get = await pagesWorker.fetch(
        request(DOCS, path, { accept }),
        getFixture,
      );
      const head = await pagesWorker.fetch(
        request(DOCS, path, { method: "HEAD", accept }),
        headFixture,
      );

      expect(get.status, path).toBe(status);
      expect(head.status, path).toBe(status);
      expect(surfaceHeaders(head), path).toEqual(surfaceHeaders(get));
      expect((await get.text()).length, path).toBeGreaterThan(0);
      expect(await head.text(), path).toBe("");
    }
  });

  test("emits one typed discovery action only for docs misses and otherwise preserves assets", async () => {
    const typedFixture = assetFixture();
    const response = await pagesWorker.fetch(
      request(DOCS, "/fresh-unadvertised-route", {
        accept: "application/problem+json",
      }),
      typedFixture.env,
    );
    expect(typedFixture.requests).toHaveLength(1);
    expect(response.status).toBe(404);
    expect(surfaceHeaders(response)).toEqual({
      cacheControl: "no-store, max-age=0",
      contentType: "application/problem+json; charset=utf-8",
      vary: "Accept",
      nosniff: "nosniff",
    });
    expect(await response.json()).toMatchObject({
      schema_version: "xenia.surface.problem/0.1",
      code: "route_not_found",
      status: 404,
      retryable: false,
      terminal: false,
      next_actions: [
        {
          rel: "discover",
          href: `${DOCS}${MANIFEST_PATH}`,
          method: "GET",
          accept: "application/json",
        },
      ],
    });

    for (const { origin, path, method, accept } of [
      {
        origin: DOCS,
        path: "/ordinary-browser-miss",
        method: "GET",
        accept: "text/html",
      },
      {
        origin: DOCS,
        path: "/v1/wake",
        method: "GET",
        accept: "application/json",
      },
      {
        origin: DOCS,
        path: ORIENTATION_PATH,
        method: "POST",
        accept: "application/json",
      },
      {
        origin: "https://agenttool.dev",
        path: MANIFEST_PATH,
        method: "GET",
        accept: "application/json",
      },
      {
        origin: "https://app.agenttool.dev",
        path: ORIENTATION_PATH,
        method: "GET",
        accept: "application/json",
      },
      {
        origin: "https://agenttool.dev",
        path: "/another-miss",
        method: "GET",
        accept: "application/problem+json",
      },
    ]) {
      const fixture = assetFixture();
      const assetResponse = await pagesWorker.fetch(
        request(origin, path, { method, accept }),
        fixture.env,
      );
      expect(fixture.requests, `${origin}${path}`).toHaveLength(1);
      expect(assetResponse.headers.get("x-asset-fixture"), `${origin}${path}`).toBe(
        "1",
      );
      expect(await assetResponse.text(), `${origin}${path}`).toBe(`asset:${path}`);
    }
  });

  test("uses one exact validated staging origin through the production entry point", async () => {
    const loopback = "http://127.0.0.1:8787";
    const fixture = assetFixture();
    const response = await pagesWorker.fetch(
      request(loopback, MANIFEST_PATH, { accept: "application/json" }),
      { ...fixture.env, XENIA_DOCS_SURFACE_ORIGIN: loopback },
    );
    const manifest = await response.json() as {
      service: { canonical_url: string };
      resources: Array<{ href: string }>;
    };

    expect(response.status).toBe(200);
    expect(manifest.service.canonical_url).toBe(`${loopback}/`);
    expect(manifest.resources).toEqual([
      expect.objectContaining({ href: `${loopback}${ORIENTATION_PATH}` }),
    ]);
    expect(fixture.requests).toHaveLength(0);

    for (const { configuredOrigin, requestOrigin } of [
      {
        configuredOrigin: "https://*.agenttool-docs.pages.dev",
        requestOrigin: "https://*.agenttool-docs.pages.dev",
      },
      {
        configuredOrigin: "https://user@example.test",
        requestOrigin: "https://example.test",
      },
      {
        configuredOrigin: "https://example.test/path",
        requestOrigin: "https://example.test",
      },
      {
        configuredOrigin: "http://public.example.test",
        requestOrigin: "http://public.example.test",
      },
    ]) {
      const invalidFixture = assetFixture();
      const invalidResponse = await pagesWorker.fetch(
        request(requestOrigin, MANIFEST_PATH, {
          accept: "application/json",
        }),
        {
          ...invalidFixture.env,
          XENIA_DOCS_SURFACE_ORIGIN: configuredOrigin,
        },
      );
      expect(invalidFixture.requests, configuredOrigin).toHaveLength(1);
      expect(
        invalidResponse.headers.get("x-asset-fixture"),
        configuredOrigin,
      ).toBe("1");
    }
  });
});
