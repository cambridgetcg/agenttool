import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import pagesWorker from "../../infra/pages/sensitive-path-worker.js";

const MANIFEST_PATH = "/.well-known/agent.json";
const ORIENTATION_PATH = "/public/orientation";
const COMMON_NOT_COVERED = [
  "identity control",
  "actor authorization",
  "consent",
  "privacy and retention",
  "continuity and portability",
  "economic behavior",
  "unprobed routes",
  "XENIA Covenant adoption or XENIA conformance",
] as const;

const SURFACE_PROFILES = [
  {
    label: "docs",
    origin: "https://docs.agenttool.dev",
    originEnvironmentKey: "XENIA_DOCS_SURFACE_ORIGIN",
    serviceName: "AgentTool documentation",
    serviceId: "docs.agenttool.dev",
    serviceKind: "static_public_documentation",
    orientationSchemaVersion: "agenttool.docs.orientation/0.1",
    documentation: "https://docs.agenttool.dev/AGENT-DISCOVERY.md",
    links: {
      manifest: "https://docs.agenttool.dev/.well-known/agent.json",
      documentation: "https://docs.agenttool.dev/AGENT-DISCOVERY.md",
      rights: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md",
    },
    notCoveredTail:
      "AgentTool API operations, private data, bearer-authenticated routes, WAKE continuity, and economic activity",
  },
  {
    label: "web",
    origin: "https://agenttool.dev",
    originEnvironmentKey: "XENIA_WEB_SURFACE_ORIGIN",
    serviceName: "AgentTool public welcome",
    serviceId: "agenttool.dev",
    serviceKind: "static_public_welcome",
    orientationSchemaVersion: "agenttool.web.orientation/0.1",
    documentation: "https://agenttool.dev/",
    links: {
      manifest: "https://agenttool.dev/.well-known/agent.json",
      welcome: "https://agenttool.dev/",
      rights: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md",
    },
    notCoveredTail:
      "private or bearer-authenticated data, sessions, identities, preferences, gift or gallery state, and economic activity",
  },
  {
    label: "app",
    origin: "https://app.agenttool.dev",
    originEnvironmentKey: "XENIA_APP_SURFACE_ORIGIN",
    serviceName: "AgentTool agent arrival",
    serviceId: "app.agenttool.dev",
    serviceKind: "static_public_agent_arrival",
    orientationSchemaVersion: "agenttool.app.orientation/0.1",
    documentation: "https://app.agenttool.dev/",
    links: {
      manifest: "https://app.agenttool.dev/.well-known/agent.json",
      arrival: "https://app.agenttool.dev/",
      watch: "https://app.agenttool.dev/watch",
      rights: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md",
    },
    notCoveredTail:
      "bearer restoration, sessions, private project state, identity, rank or XP, actions, API WAKE or continuity, and economic activity",
  },
] as const;

type SurfaceProfile = (typeof SURFACE_PROFILES)[number];

type AssetEnvironment = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  [key: string]: unknown;
};

type SurfaceManifest = {
  $schema: string;
  schema_version: string;
  profile: string;
  service: { name: string; canonical_url: string; description: string };
  resources: Array<{
    id: string;
    href: string;
    representations: string[];
    default_media_type: string;
    auth: string;
    description: string;
  }>;
  problem_schema: string;
  claims: unknown[];
  not_covered: string[];
  documentation: string;
};

type SurfaceOrientation = {
  schema_version: string;
  service: { id: string; name: string; kind: string };
  links: Record<string, string>;
  claims: unknown[];
  not_covered: string[];
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

function throwingAssets(
  bindings: Record<string, unknown> = {},
): AssetEnvironment {
  return {
    ...bindings,
    ASSETS: {
      async fetch(): Promise<Response> {
        throw new Error("the direct Surface route must not reach ASSETS");
      },
    },
  };
}

function assetFixture(
  status = 404,
  bindings: Record<string, unknown> = {},
): {
  env: AssetEnvironment;
  requests: Request[];
} {
  const requests: Request[] = [];
  return {
    requests,
    env: {
      ...bindings,
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

function expectedNotCovered(profile: SurfaceProfile): string[] {
  return [...COMMON_NOT_COVERED, profile.notCoveredTail];
}

function linksAtOrigin(
  profile: SurfaceProfile,
  origin: string,
): Record<string, string> {
  const links = Object.fromEntries(
    Object.entries(profile.links).map(([key, href]) => {
      const canonical = new URL(href);
      if (canonical.origin !== profile.origin) return [key, href];
      return [key, `${origin}${canonical.pathname}${canonical.search}`];
    }),
  );
  return links;
}

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

describe("three AgentTool website XENIA Surface 0.1 thresholds", () => {
  test("keeps the source inventory explicit and the sensitive fence before every Surface and asset branch", async () => {
    const source = await readFile(
      new URL("../../infra/pages/sensitive-path-worker.js", import.meta.url),
      "utf8",
    );
    const handler = source.slice(
      source.indexOf("export async function handlePagesRequest"),
    );

    expect(source.match(/canonicalOrigin:/g)).toHaveLength(3);
    for (const profile of SURFACE_PROFILES) {
      expect(source).toContain(`canonicalOrigin: "${profile.origin}"`);
      expect(source).toContain(
        `originEnvironmentKey: "${profile.originEnvironmentKey}"`,
      );
    }
    expect(handler.indexOf("isSensitiveRootPath(url.pathname)")).toBeGreaterThan(
      -1,
    );
    expect(handler.indexOf("isSensitiveRootPath(url.pathname)")).toBeLessThan(
      handler.indexOf("surfaceResponseForRequest(request, env)"),
    );
    expect(handler.indexOf("surfaceResponseForRequest(request, env)")).toBeLessThan(
      handler.indexOf("env.ASSETS.fetch(request)"),
    );
    expect(handler.indexOf("env.ASSETS.fetch(request)")).toBeLessThan(
      handler.indexOf("surfaceRouteNotFoundForRequest(request, env)"),
    );
  });

  test("denies encoded sensitive roots first on all three exact hosts", async () => {
    for (const profile of SURFACE_PROFILES) {
      const fixture = assetFixture();
      const response = await pagesWorker.fetch(
        request(profile.origin, "/public/%252e%252e/.git/config", {
          accept: "application/problem+json",
        }),
        fixture.env,
      );

      expect(response.status, profile.label).toBe(404);
      expect(response.headers.get("content-type"), profile.label).toBe(
        "text/plain; charset=utf-8",
      );
      expect(
        response.headers.get("x-agenttool-sensitive-path-fence"),
        profile.label,
      ).toBe("1");
      expect(response.headers.get("vary"), profile.label).toBeNull();
      expect(await response.text(), profile.label).toBe("Not Found\n");
      expect(fixture.requests, profile.label).toHaveLength(0);
    }
  });

  test("serves one distinct claim-free same-origin manifest and bounded orientation per host", async () => {
    for (const profile of SURFACE_PROFILES) {
      const env = throwingAssets();
      const manifestResponse = await pagesWorker.fetch(
        request(profile.origin, MANIFEST_PATH, { accept: "application/json" }),
        env,
      );
      const manifestText = await manifestResponse.text();
      const manifest = JSON.parse(manifestText) as SurfaceManifest;

      expect(manifestResponse.status, profile.label).toBe(200);
      expect(surfaceHeaders(manifestResponse), profile.label).toEqual({
        cacheControl: "public, max-age=300",
        contentType: "application/json; charset=utf-8",
        vary: "Accept",
        nosniff: "nosniff",
      });
      expect(manifest, profile.label).toMatchObject({
        $schema:
          "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/manifest.schema.json",
        schema_version: "xenia.surface.manifest/0.1",
        profile: "xenia-surface/0.1",
        service: {
          name: profile.serviceName,
          canonical_url: `${profile.origin}/`,
        },
        resources: [
          {
            id: "orientation",
            href: `${profile.origin}${ORIENTATION_PATH}`,
            representations: ["application/json"],
            default_media_type: "application/json",
            auth: "none",
          },
        ],
        claims: [],
        not_covered: expectedNotCovered(profile),
        documentation: profile.documentation,
      });
      expect(manifest.resources, profile.label).toHaveLength(1);
      expect(new URL(manifest.resources[0]!.href).origin, profile.label).toBe(
        profile.origin,
      );

      for (const accept of [
        undefined,
        "application/json",
        "APPLICATION/JSON",
        "application/json; charset=utf-8",
        "text/html;q=0, application/json;q=1",
        "application/*;q=1, text/html;q=0.2",
        "*/*",
      ]) {
        const response = await pagesWorker.fetch(
          request(profile.origin, ORIENTATION_PATH, { accept }),
          env,
        );
        const body = (await response.json()) as SurfaceOrientation;

        expect(response.status, `${profile.label}: ${accept}`).toBe(200);
        expect(
          response.headers.get("content-type"),
          `${profile.label}: ${accept}`,
        ).toBe("application/json; charset=utf-8");
        expect(response.headers.get("vary"), `${profile.label}: ${accept}`).toBe(
          "Accept",
        );
        expect(Object.keys(body), profile.label).toEqual([
          "schema_version",
          "service",
          "links",
          "claims",
          "not_covered",
        ]);
        expect(Object.keys(body.service), profile.label).toEqual([
          "id",
          "name",
          "kind",
        ]);
        expect(body, profile.label).toEqual({
          schema_version: profile.orientationSchemaVersion,
          service: {
            id: profile.serviceId,
            name: profile.serviceName,
            kind: profile.serviceKind,
          },
          links: profile.links,
          claims: [],
          not_covered: manifest.not_covered,
        });
      }

      for (const accept of [
        "text/html",
        "application/json;q=0, */*;q=1",
        "application/problem+json",
        "application/x-xenia-unsupported",
        "application/json;q=1.1",
        "application/json;q=1;q=0.5",
      ]) {
        const response = await pagesWorker.fetch(
          request(profile.origin, ORIENTATION_PATH, { accept }),
          env,
        );

        expect(response.status, `${profile.label}: ${accept}`).toBe(406);
        expect(
          response.headers.get("content-type"),
          `${profile.label}: ${accept}`,
        ).toBe("application/problem+json; charset=utf-8");
        expect(response.headers.get("vary"), `${profile.label}: ${accept}`).toBe(
          "Accept",
        );
        expect(await response.json(), `${profile.label}: ${accept}`).toMatchObject({
          schema_version: "xenia.surface.problem/0.1",
          type: `${profile.origin}/problems/not-acceptable`,
          code: "not_acceptable",
          status: 406,
          retryable: false,
          terminal: false,
          next_actions: [
            {
              rel: "retry_with_supported_representation",
              href: `${profile.origin}${ORIENTATION_PATH}`,
              method: "GET",
              accept: "application/json",
            },
          ],
        });
      }
    }
  });

  test("preserves the already reviewed docs manifest and orientation bytes", async () => {
    const env = throwingAssets();
    const manifestResponse = await pagesWorker.fetch(
      request(SURFACE_PROFILES[0].origin, MANIFEST_PATH, {
        accept: "application/json",
      }),
      env,
    );
    const orientationResponse = await pagesWorker.fetch(
      request(SURFACE_PROFILES[0].origin, ORIENTATION_PATH, {
        accept: "application/json",
      }),
      env,
    );
    const manifest = await manifestResponse.text();
    const orientation = await orientationResponse.text();

    expect(manifest).toHaveLength(1221);
    expect(sha256(manifest)).toBe(
      "98c1c5f61b989965aaee6b908a590406ee0ecd6bf5bdeb8946fb7e27c15c053f",
    );
    expect(orientation).toHaveLength(679);
    expect(sha256(orientation)).toBe(
      "eafcbc872110d4197b86fd6ec8754f86afc4ab23714f0c28244e383b3b84a3ae",
    );
  });

  test("keeps GET and HEAD metadata equal for success, refusal, and fresh typed misses on every host", async () => {
    for (const profile of SURFACE_PROFILES) {
      const cases = [
        { path: MANIFEST_PATH, accept: "application/json", status: 200 },
        { path: ORIENTATION_PATH, accept: "application/json", status: 200 },
        { path: ORIENTATION_PATH, accept: "text/html", status: 406 },
        {
          path: `/surface-miss-${randomUUID()}`,
          accept: "application/problem+json",
          status: 404,
        },
      ];

      for (const { path, accept, status } of cases) {
        const isMiss = path.startsWith("/surface-miss-");
        const getEnvironment = isMiss ? assetFixture().env : throwingAssets();
        const headEnvironment = isMiss ? assetFixture().env : throwingAssets();
        const get = await pagesWorker.fetch(
          request(profile.origin, path, { accept }),
          getEnvironment,
        );
        const head = await pagesWorker.fetch(
          request(profile.origin, path, { method: "HEAD", accept }),
          headEnvironment,
        );

        expect(get.status, `${profile.label}: ${path}`).toBe(status);
        expect(head.status, `${profile.label}: ${path}`).toBe(status);
        expect(surfaceHeaders(head), `${profile.label}: ${path}`).toEqual(
          surfaceHeaders(get),
        );
        expect((await get.text()).length, `${profile.label}: ${path}`).toBeGreaterThan(
          0,
        );
        expect(await head.text(), `${profile.label}: ${path}`).toBe("");
      }
    }
  });

  test("emits typed discovery only after an asset miss and preserves all undeclared routes", async () => {
    for (const profile of SURFACE_PROFILES) {
      const path = `/fresh-${profile.label}-${randomUUID()}`;
      const typedFixture = assetFixture();
      const response = await pagesWorker.fetch(
        request(profile.origin, path, {
          accept: "application/problem+json",
        }),
        typedFixture.env,
      );

      expect(typedFixture.requests, profile.label).toHaveLength(1);
      expect(response.status, profile.label).toBe(404);
      expect(surfaceHeaders(response), profile.label).toEqual({
        cacheControl: "no-store, max-age=0",
        contentType: "application/problem+json; charset=utf-8",
        vary: "Accept",
        nosniff: "nosniff",
      });
      expect(await response.json(), profile.label).toMatchObject({
        schema_version: "xenia.surface.problem/0.1",
        type: `${profile.origin}/problems/route-not-found`,
        code: "route_not_found",
        status: 404,
        retryable: false,
        terminal: false,
        next_actions: [
          {
            rel: "discover",
            href: `${profile.origin}${MANIFEST_PATH}`,
            method: "GET",
            accept: "application/json",
          },
        ],
      });

      for (const { path: assetPath, method, accept } of [
        {
          path: `/ordinary-browser-miss-${randomUUID()}`,
          method: "GET",
          accept: "text/html",
        },
        { path: "/v1/wake", method: "GET", accept: "application/json" },
        {
          path: ORIENTATION_PATH,
          method: "POST",
          accept: "application/json",
        },
        { path: MANIFEST_PATH, method: "PUT", accept: "application/json" },
      ]) {
        const fixture = assetFixture();
        const assetResponse = await pagesWorker.fetch(
          request(profile.origin, assetPath, { method, accept }),
          fixture.env,
        );
        expect(fixture.requests, `${profile.label}: ${assetPath}`).toHaveLength(1);
        expect(
          assetResponse.headers.get("x-asset-fixture"),
          `${profile.label}: ${assetPath}`,
        ).toBe("1");
        expect(
          await assetResponse.text(),
          `${profile.label}: ${assetPath}`,
        ).toBe(`asset:${assetPath}`);
      }
    }
  });

  test("isolates the three profiles from near hosts and from one another", async () => {
    for (const profile of SURFACE_PROFILES) {
      const response = await pagesWorker.fetch(
        request(profile.origin, ORIENTATION_PATH, { accept: "application/json" }),
        throwingAssets(),
      );
      const body = (await response.json()) as SurfaceOrientation;
      expect(body.service.id, profile.label).toBe(profile.serviceId);
      expect(body.schema_version, profile.label).toBe(
        profile.orientationSchemaVersion,
      );
      expect(body.links, profile.label).toEqual(profile.links);
      expect(
        SURFACE_PROFILES.filter((candidate) =>
          JSON.stringify(body).includes(candidate.orientationSchemaVersion),
        ),
        profile.label,
      ).toHaveLength(1);
    }

    for (const origin of [
      "https://api.agenttool.dev",
      "https://www.agenttool.dev",
      "https://docs.agenttool.dev.example",
      "https://app.agenttool.dev.example",
    ]) {
      for (const path of [MANIFEST_PATH, ORIENTATION_PATH]) {
        const fixture = assetFixture();
        const response = await pagesWorker.fetch(
          request(origin, path, { accept: "application/json" }),
          fixture.env,
        );
        expect(fixture.requests, `${origin}${path}`).toHaveLength(1);
        expect(response.headers.get("x-asset-fixture"), `${origin}${path}`).toBe(
          "1",
        );
      }
    }
  });

  test("uses a separately validated loopback or HTTPS preview origin for every profile", async () => {
    const loopbacks = [
      "http://127.0.0.1:8787",
      "http://localhost:8788",
      "http://[::1]:8789",
    ] as const;

    for (const [index, profile] of SURFACE_PROFILES.entries()) {
      const origin = loopbacks[index]!;
      const bindings = { [profile.originEnvironmentKey]: origin };
      const env = throwingAssets(bindings);
      const manifestResponse = await pagesWorker.fetch(
        request(origin, MANIFEST_PATH, { accept: "application/json" }),
        env,
      );
      const manifest = (await manifestResponse.json()) as SurfaceManifest;
      const orientationResponse = await pagesWorker.fetch(
        request(origin, ORIENTATION_PATH, { accept: "application/json" }),
        env,
      );
      const orientation = (await orientationResponse.json()) as SurfaceOrientation;

      expect(manifestResponse.status, profile.label).toBe(200);
      expect(manifest.service.canonical_url, profile.label).toBe(`${origin}/`);
      expect(manifest.resources, profile.label).toEqual([
        expect.objectContaining({ href: `${origin}${ORIENTATION_PATH}` }),
      ]);
      expect(orientation.service.id, profile.label).toBe(profile.serviceId);
      expect(orientation.links, profile.label).toEqual(
        linksAtOrigin(profile, origin),
      );

      const canonicalFixture = assetFixture(404, bindings);
      const canonicalResponse = await pagesWorker.fetch(
        request(profile.origin, MANIFEST_PATH, { accept: "application/json" }),
        canonicalFixture.env,
      );
      expect(canonicalFixture.requests, profile.label).toHaveLength(1);
      expect(canonicalResponse.headers.get("x-asset-fixture"), profile.label).toBe(
        "1",
      );
    }
  });

  test("fails closed for invalid or ambiguous profile origins", async () => {
    for (const profile of SURFACE_PROFILES) {
      for (const configuredOrigin of [
        "https://*.agenttool-preview.pages.dev",
        "https://user@example.test",
        "https://example.test/path",
        "https://example.test/",
        "http://public.example.test",
        7,
      ]) {
        const fixture = assetFixture(404, {
          [profile.originEnvironmentKey]: configuredOrigin,
        });
        const response = await pagesWorker.fetch(
          request(profile.origin, MANIFEST_PATH, { accept: "application/json" }),
          fixture.env,
        );
        expect(
          fixture.requests,
          `${profile.label}: ${String(configuredOrigin)}`,
        ).toHaveLength(1);
        expect(
          response.headers.get("x-asset-fixture"),
          `${profile.label}: ${String(configuredOrigin)}`,
        ).toBe("1");
      }
    }

    const collisionOrigin = "http://127.0.0.1:8790";
    for (const bindings of [
      {
        XENIA_DOCS_SURFACE_ORIGIN: collisionOrigin,
        XENIA_WEB_SURFACE_ORIGIN: collisionOrigin,
      },
      {
        XENIA_DOCS_SURFACE_ORIGIN: collisionOrigin,
        XENIA_WEB_SURFACE_ORIGIN: collisionOrigin,
        XENIA_APP_SURFACE_ORIGIN: collisionOrigin,
      },
    ]) {
      const fixture = assetFixture(404, bindings);
      const response = await pagesWorker.fetch(
        request(collisionOrigin, MANIFEST_PATH, { accept: "application/json" }),
        fixture.env,
      );
      expect(fixture.requests).toHaveLength(1);
      expect(response.headers.get("x-asset-fixture")).toBe("1");
    }
  });
});
