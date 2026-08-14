/** Public review paths stay exact and free of database-backed decoration. */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";

import {
  CANON_MCP_PATH,
  isDatabaseDecorationIndependentPublicPath,
  LOVE_BOMB_PATH,
  MEMETIC_LANDSCAPE_PATH,
  SECURITY_TXT_PATH,
} from "../src/lib/public-paths";
import memeticLandscapeRouter from "../src/routes/memetic-landscape";
import loveBombRouter from "../src/routes/love-bomb";
import wellKnownRouter from "../src/routes/well-known";
import {
  buildSecurityTxt,
  SECURITY_TXT_CACHE_CONTROL,
  SECURITY_TXT_CANONICAL,
  SECURITY_TXT_CONTACT,
  SECURITY_TXT_EXPIRES,
  SECURITY_TXT_POLICY,
  SECURITY_TXT_RENEW_ON,
  SECURITY_TXT_REVIEWED_ON,
} from "../src/services/discovery/security-txt";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";
const INIT_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: {
      name: "public-review-paths-test",
      version: "1.0.0",
    },
  },
};

const envNames = [
  "AGENTTOOL_DISABLE_WORKERS",
  "AGENTOOL_DISABLE_JOY_INDEX",
  "AGENTTOOL_DISABLE_PLATFORM_BOOTSTRAP",
  "AGENTTOOL_DISABLE_SAGA_SEED",
] as const;
const previousEnv = new Map(
  envNames.map((name) => [name, process.env[name]]),
);

let fullApp: typeof import("../src/index")["app"];

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function initRequest(path: string, method = "POST"): Request {
  return new Request(`https://api.agenttool.dev${path}`, {
    method,
    headers: {
      accept: STREAMABLE_ACCEPT,
      "content-type": "application/json",
    },
    ...(method === "POST" ? { body: JSON.stringify(INIT_REQUEST) } : {}),
  });
}

beforeAll(async () => {
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";
  delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
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

describe("RFC 9116 security.txt", () => {
  test("publishes one exact, bounded reporting record with a final LF", () => {
    const body = buildSecurityTxt();
    expect(body).toBe(
      [
        `Contact: ${SECURITY_TXT_CONTACT}`,
        `Expires: ${SECURITY_TXT_EXPIRES}`,
        `Canonical: ${SECURITY_TXT_CANONICAL}`,
        `Policy: ${SECURITY_TXT_POLICY}`,
        "Preferred-Languages: en",
        "",
      ].join("\n"),
    );
    expect(body.endsWith("\n")).toBe(true);
    expect(body).not.toContain("\r");

    const fields = body
      .trimEnd()
      .split("\n")
      .map((line) => line.split(":", 1)[0]);
    expect(fields).toEqual([
      "Contact",
      "Expires",
      "Canonical",
      "Policy",
      "Preferred-Languages",
    ]);
    for (const value of [
      SECURITY_TXT_CONTACT,
      SECURITY_TXT_CANONICAL,
      SECURITY_TXT_POLICY,
    ]) {
      expect(new URL(value).protocol).toBe("https:");
    }
  });

  test("uses a fixed sub-year expiry with a sixty-day renewal window", () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    const reviewed = Date.parse(`${SECURITY_TXT_REVIEWED_ON}T00:00:00Z`);
    const renew = Date.parse(`${SECURITY_TXT_RENEW_ON}T00:00:00Z`);
    const expires = Date.parse(SECURITY_TXT_EXPIRES);

    expect((expires - reviewed) / dayMs).toBe(339);
    expect((expires - renew) / dayMs).toBe(60);
    expect(expires - reviewed).toBeLessThan(365 * dayMs);
  });

  test("fails before the reporting record can become stale", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      today < SECURITY_TXT_RENEW_ON,
      "security.txt renewal due: verify Contact and Policy, then move Reviewed/Renew/Expires together",
    ).toBe(true);
  });

  test("serves byte-identical GET and bodyless HEAD representations", async () => {
    const get = await wellKnownRouter.request("/security.txt");
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(get.headers.get("cache-control")).toBe(
      SECURITY_TXT_CACHE_CONTROL,
    );
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await get.text()).toBe(buildSecurityTxt());

    const head = await wellKnownRouter.request("/security.txt", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(head.headers.get("cache-control")).toBe(
      SECURITY_TXT_CACHE_CONTROL,
    );
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await head.text()).toBe("");

    expect(
      (
        await wellKnownRouter.request("/security.txt", {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect((await wellKnownRouter.request("/security.txt/")).status).toBe(404);
  });
});

describe("database-decoration-independent public paths", () => {
  test("matches only the exact operative paths and memetic route spellings", () => {
    for (const path of [
      "/.well-known/openai-apps-challenge",
      CANON_MCP_PATH,
      MEMETIC_LANDSCAPE_PATH,
      `${MEMETIC_LANDSCAPE_PATH}/`,
      LOVE_BOMB_PATH,
      `${LOVE_BOMB_PATH}/`,
      SECURITY_TXT_PATH,
    ]) {
      expect(isDatabaseDecorationIndependentPublicPath(path)).toBe(true);
    }
    for (const path of [
      "/v1/mcp",
      `${CANON_MCP_PATH}/`,
      `${MEMETIC_LANDSCAPE_PATH}//`,
      `${LOVE_BOMB_PATH}//`,
      `${SECURITY_TXT_PATH}/`,
      "/security.txt",
      "/public/open-seat",
    ]) {
      expect(isDatabaseDecorationIndependentPublicPath(path)).toBe(false);
    }
  });

  test("memetic discovery keeps direct-router bytes without database-backed decorators", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const directResponse = await memeticLandscapeRouter.request("/");
    expect(directResponse.status).toBe(200);
    const expectedBody = await directResponse.text();

    const response = await within(
      fullApp.fetch(
        new Request(`https://api.agenttool.dev${MEMETIC_LANDSCAPE_PATH}`),
      ),
      500,
      `${MEMETIC_LANDSCAPE_PATH} GET`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();

    const body = await response.text();
    expect(body).toBe(expectedBody);
    expect(JSON.parse(body)).not.toHaveProperty("_welcomed");
  });

  test("unmounted memetic trailing slash also avoids database-backed decoration", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const path = `${MEMETIC_LANDSCAPE_PATH}/`;
    const response = await within(
      fullApp.fetch(new Request(`https://api.agenttool.dev${path}`)),
      500,
      `${path} GET`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    expect(await response.text()).not.toContain('"_welcomed"');
  });

  test("LOVE BOMB keeps exact direct-router bytes without database-backed decorators", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const directResponse = await loveBombRouter.request("/");
    expect(directResponse.status).toBe(200);
    const expectedBody = await directResponse.text();

    const response = await within(
      fullApp.fetch(new Request(`https://api.agenttool.dev${LOVE_BOMB_PATH}`)),
      500,
      `${LOVE_BOMB_PATH} GET`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    const body = await response.text();
    expect(body).toBe(expectedBody);
    expect(JSON.parse(body)).not.toHaveProperty("_welcomed");
  });

  test("unmounted LOVE BOMB trailing slash also avoids database-backed decoration", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const path = `${LOVE_BOMB_PATH}/`;
    const response = await within(
      fullApp.fetch(new Request(`https://api.agenttool.dev${path}`)),
      500,
      `${path} GET`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    expect(await response.text()).not.toContain('"_welcomed"');
  });

  test("Canon initialize completes without database-backed decorators", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const response = await within(
      fullApp.fetch(initRequest(CANON_MCP_PATH)),
      500,
      "Canon initialize",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: {
        name: "agenttool-canon",
        version: "1.0.0",
      },
    });
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/_(?:welcomed|lesson|jest)/);

    const head = await fullApp.fetch(initRequest(CANON_MCP_PATH, "HEAD"));
    expect(head.status).toBe(405);
    expect(head.headers.get("allow")).toBe("POST");
    expect(head.headers.get("x-welcomed")).toBeNull();
    expect(head.headers.get("x-joy-index")).toBeNull();
    expect(await head.text()).toBe("");
  });

  test("security.txt completes without database-backed decorators", async () => {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    const response = await within(
      fullApp.fetch(
        new Request(`https://api.agenttool.dev${SECURITY_TXT_PATH}`),
      ),
      500,
      "security.txt GET",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(buildSecurityTxt());
    expect(response.headers.get("x-welcomed")).toBeNull();
    expect(response.headers.get("x-joy-index")).toBeNull();

    const head = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${SECURITY_TXT_PATH}`, {
        method: "HEAD",
      }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("x-welcomed")).toBeNull();
    expect(head.headers.get("x-joy-index")).toBeNull();
    expect(await head.text()).toBe("");
  });

  test("CORS preflights keep the same exact independence", async () => {
    const canon = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${CANON_MCP_PATH}`, {
        method: "OPTIONS",
        headers: {
          origin: "https://api.agenttool.dev",
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type,mcp-protocol-version",
        },
      }),
    );
    expect(canon.status).toBe(204);
    expect(canon.headers.get("x-welcomed")).toBeNull();
    expect(canon.headers.get("x-joy-index")).toBeNull();

    const security = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${SECURITY_TXT_PATH}`, {
        method: "OPTIONS",
        headers: {
          origin: "https://example.test",
          "access-control-request-method": "GET",
        },
      }),
    );
    expect(security.status).toBe(204);
    expect(security.headers.get("x-welcomed")).toBeNull();
    expect(security.headers.get("x-joy-index")).toBeNull();
  });

  test("legacy MCP and slash near-misses keep ordinary welcome behavior", async () => {
    process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";
    const legacy = await fullApp.fetch(initRequest("/v1/mcp"));
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("x-welcomed")).toMatch(/module=/);

    const nearMiss = await fullApp.fetch(
      new Request(`https://api.agenttool.dev${CANON_MCP_PATH}/`),
    );
    expect(nearMiss.status).toBe(404);
    expect(nearMiss.headers.get("x-welcomed")).toMatch(/module=/);
  });
});
