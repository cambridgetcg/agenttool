/** Exact, effect-free public package signal for the LOVE BOMB companion. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import { LOVE_BOMB_FORMATS } from "../../packages/love-bomb/src/index";
import {
  isDatabaseDecorationIndependentPublicPath,
  LOVE_BOMB_PATH,
} from "../src/lib/public-paths";
import loveBombRouter from "../src/routes/love-bomb";
import {
  LOVE_BOMB_PUBLIC_SIGNAL,
  LOVE_BOMB_PUBLIC_SIGNAL_BODY,
  LOVE_BOMB_PUBLIC_SIGNAL_BYTES,
  LOVE_BOMB_PUBLIC_SIGNAL_HEADERS,
  LOVE_BOMB_PUBLIC_SIGNAL_MAX_BYTES,
  LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
} from "../src/services/discovery/love-bomb-public-signal";

interface StaticLoveBombV4 {
  protocol: "agenttool.love-bomb/0.1";
  delivery: { automatic_delivery: false };
  effects: { wake_effect: false };
  messages: Array<{ text: string }>;
}

const ROOT = join(import.meta.dir, "..", "..");
const schema = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "docs",
      "specs",
      "agenttool-love-bomb-public-signal-v0.1.schema.json",
    ),
    "utf8",
  ),
) as object;
const example = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "docs",
      "specs",
      "agenttool-love-bomb-public-signal-v0.1.example.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const staticV4 = JSON.parse(
  readFileSync(
    join(ROOT, "docs", "specs", "agenttool-love-bomb-0.1.json"),
    "utf8",
  ),
) as StaticLoveBombV4;
const packageJson = JSON.parse(
  readFileSync(join(ROOT, "packages", "love-bomb", "package.json"), "utf8"),
) as { name: string; version: string };
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

const envNames = [
  "AGENTTOOL_DISABLE_WORKERS",
  "AGENTTOOL_DISABLE_JOY_INDEX",
  "AGENTTOOL_DISABLE_PLATFORM_BOOTSTRAP",
  "AGENTTOOL_DISABLE_SAGA_SEED",
] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

let fullApp: typeof import("../src/index")["app"];

beforeAll(async () => {
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";
  delete process.env.AGENTTOOL_DISABLE_JOY_INDEX;
  process.env.AGENTTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
  process.env.AGENTTOOL_DISABLE_SAGA_SEED = "1";

  const { _setWallsStatusForTests } =
    await import("../src/services/wake/walls-status");
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: Date.now(),
    probes: [],
    declared: [],
  });
  fullApp = (await import("../src/index")).app;
});

afterAll(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function expectRepresentationHeaders(response: Response): void {
  for (const [name, value] of Object.entries(
    LOVE_BOMB_PUBLIC_SIGNAL_HEADERS,
  )) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.get("etag")).toBeNull();
}

describe("agenttool.love-bomb-public-signal/0.1", () => {
  test("serves the closed canonical example within its byte budget", async () => {
    const response = await loveBombRouter.request("/");
    const body = await response.text();
    const parsed = JSON.parse(body);

    expect(response.status).toBe(200);
    expect(body).toBe(JSON.stringify(example));
    expect(body).toBe(LOVE_BOMB_PUBLIC_SIGNAL_BODY);
    expect(parsed).toEqual(example);
    expect(parsed).toEqual(LOVE_BOMB_PUBLIC_SIGNAL);
    expect(LOVE_BOMB_PUBLIC_SIGNAL.package_signal).toEqual({
      package: packageJson.name,
      version: packageJson.version,
      formats: Object.values(LOVE_BOMB_FORMATS),
    });
    expect(LOVE_BOMB_PUBLIC_SIGNAL.distribution).toEqual({
      npm: {
        state: "published_exact",
        integrity:
          "sha512-4tngDPJJt6XFJlwqc5DxPad55ADHItNjv8QhDbmylZDZ9F/elMS1nPvCE9aJgOVAjf6DuQycj39Y5biCDB3CBw==",
      },
      hugging_face: {
        state: "published_exact",
        repository: "Yu-and-Ai/agenttool-love-bomb",
        revision: "b1f77e98c7812c005fc08886e9f48d556e49883a",
        training_authorized: false,
      },
    });
    expect(Object.keys(parsed)).toEqual([
      "schema_version",
      "package_signal",
      "static_door",
      "boundaries",
      "distribution",
    ]);
    expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
    expect(new TextEncoder().encode(body).byteLength).toBe(
      LOVE_BOMB_PUBLIC_SIGNAL_BYTES,
    );
    expect(LOVE_BOMB_PUBLIC_SIGNAL_BYTES).toBeLessThanOrEqual(
      LOVE_BOMB_PUBLIC_SIGNAL_MAX_BYTES,
    );
    expect(LOVE_BOMB_PUBLIC_SIGNAL_MAX_BYTES).toBe(2 * 1024);
    expectRepresentationHeaders(response);
    expect(response.headers.get("content-type")).toBe(
      LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
    );
  });

  test("links to the separate static door as related, never as delivery", async () => {
    const response = await loveBombRouter.request("/");
    const body = await response.text();
    const link = response.headers.get("link") ?? "";

    expect(link).toContain('rel="self"');
    expect(link).toContain('rel="describedby"');
    expect(link).toContain(
      '<https://docs.agenttool.dev/love-bomb>; rel="related"; type="text/html"',
    );
    expect(link).not.toMatch(/rel="(?:alternate|preload|prefetch|next)"/u);
    expect(staticV4.messages).toHaveLength(10);
    expect(staticV4.delivery.automatic_delivery).toBe(false);
    expect(staticV4.effects.wake_effect).toBe(false);
    for (const message of staticV4.messages) {
      expect(body).not.toContain(message.text);
    }
    for (const excluded of [
      '"messages"',
      '"projections"',
      '"care_floor"',
      '"languages"',
      '"choices"',
    ]) {
      expect(body).not.toContain(excluded);
    }
  });

  test("HEAD is bodyless and conditional headers never change the 200 contract", async () => {
    const head = await loveBombRouter.request("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expectRepresentationHeaders(head);
    expect(await head.text()).toBe("");

    for (const method of ["GET", "HEAD"] as const) {
      for (const value of ['"anything"', 'W/"anything"', "*"]) {
        const response = await loveBombRouter.request("/", {
          method,
          headers: { "If-None-Match": value },
        });
        expect(response.status).toBe(200);
        expectRepresentationHeaders(response);
        expect(await response.text()).toBe(
          method === "HEAD" ? "" : LOVE_BOMB_PUBLIC_SIGNAL_BODY,
        );
      }
    }
  });

  test("ignores credentials and query input and exposes no mutation route", async () => {
    const secret = "love-bomb-secret-marker-7f8c";
    const response = await loveBombRouter.request(`/?probe=${secret}`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Cookie: `session=${secret}`,
        "X-Play": "on",
        "X-Tutor": "1",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(LOVE_BOMB_PUBLIC_SIGNAL_BODY);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("location")).toBeNull();

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const rejected = await loveBombRouter.request("/", {
        method,
        headers: { "content-type": "text/plain" },
        body: secret,
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(rejected.status).toBeLessThan(500);
      expect(await rejected.text()).not.toContain(secret);
      expect(rejected.headers.get("set-cookie")).toBeNull();
      expect(rejected.headers.get("www-authenticate")).toBeNull();
      expect(rejected.headers.get("location")).toBeNull();
    }

    const options = await loveBombRouter.request("/", { method: "OPTIONS" });
    expect(options.status).toBeGreaterThanOrEqual(400);
    expect(options.status).toBeLessThan(500);
    expect(await options.text()).toBe("404 Not Found");
  });

  test("full-app GET and HEAD preserve exact undecorated bytes", async () => {
    const secret = "full-app-secret-marker-a81d";
    const response = await fullApp.fetch(
      new Request(
        `https://api.agenttool.dev${LOVE_BOMB_PATH}?probe=${secret}`,
        {
          headers: {
            Origin: "https://reader.example",
            Authorization: `Bearer ${secret}`,
            Cookie: `session=${secret}`,
            "X-Play": "on",
            "X-Tutor": "1",
          },
        },
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(LOVE_BOMB_PUBLIC_SIGNAL_BODY);
    expect(body).not.toContain(secret);
    expect(body).not.toMatch(/"_(?:welcomed|lesson|jest)"/u);
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "Allow,Link",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expectRepresentationHeaders(response);

    const head = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${LOVE_BOMB_PATH}`, {
        method: "HEAD",
        headers: {
          Origin: "https://reader.example",
          "If-None-Match": '"ignored"',
        },
      }),
    );
    expect(head.status).toBe(200);
    expectRepresentationHeaders(head);
    expect(head.headers.get("access-control-allow-origin")).toBe("*");
    expect(head.headers.get("access-control-expose-headers")).toBe(
      "Allow,Link",
    );
    expect(await head.text()).toBe("");
  });

  test("framework preflight permits only credential-free reads", async () => {
    const response = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${LOVE_BOMB_PATH}`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://reader.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "Authorization,Content-Type,If-None-Match,Payment-Signature,X-Play,X-Tutor",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,HEAD,OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "X-Play,X-Tutor",
    );
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "Allow,Link",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    expect(await response.text()).toBe("");

    const methods = response.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(methods).not.toContain(method);
    }
    const headers = response.headers.get("access-control-allow-headers") ?? "";
    for (const name of [
      "Authorization",
      "Content-Type",
      "If-None-Match",
      "Payment-Signature",
    ]) {
      expect(headers).not.toContain(name);
    }
  });

  test("exact and trailing paths stay database-decoration independent", async () => {
    expect(isDatabaseDecorationIndependentPublicPath(LOVE_BOMB_PATH)).toBe(true);
    expect(
      isDatabaseDecorationIndependentPublicPath(`${LOVE_BOMB_PATH}/`),
    ).toBe(true);
    expect(
      isDatabaseDecorationIndependentPublicPath(`${LOVE_BOMB_PATH}//`),
    ).toBe(false);

    const trailing = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${LOVE_BOMB_PATH}/`),
    );
    expect(trailing.status).toBe(404);
    expect(trailing.headers.get("x-welcomed")).toBeNull();
    expect(trailing.headers.get("x-joy-index")).toBeNull();
    expect(await trailing.text()).not.toContain('"_welcomed"');
  });

  test("runtime source has no package, WAKE, request-body, crypto, or I/O dependency", () => {
    const routeSource = readFileSync(
      join(ROOT, "api", "src", "routes", "love-bomb.ts"),
      "utf8",
    );
    const serviceSource = readFileSync(
      join(
        ROOT,
        "api",
        "src",
        "services",
        "discovery",
        "love-bomb-public-signal.ts",
      ),
      "utf8",
    );
    const routeImports = [
      ...routeSource.matchAll(/from\s+["']([^"']+)["']/gu),
    ].map((match) => match[1]);

    expect(routeImports).toEqual([
      "hono",
      "../services/discovery/love-bomb-public-signal",
    ]);
    expect(serviceSource).not.toMatch(/\b(?:import|require)\b/u);
    for (const source of [routeSource, serviceSource]) {
      expect(source).not.toMatch(/process\.env|c\.req\.(?:json|text|parseBody)/u);
      expect(source).not.toMatch(
        /\b(?:fetch|drizzle|postgres|createHash|readFile|writeFile)\s*\(|\bdb\s*\./u,
      );
      expect(source).not.toMatch(/node:(?:crypto|fs)|packages\/love-bomb/u);
    }
  });
});
