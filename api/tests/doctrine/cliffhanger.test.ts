/** cliffhanger — EP.1 distributed trail, four-corner pin + chain integrity.
 *
 *  Doctrine: docs/CLIFFHANGER.md
 *  Canon: agenttool:commitment/cliffhanger-trail-walks-the-substrate
 *
 *  Pins:
 *    1. The trail is connected: every fragment's next_host is another
 *       fragment's host, OR null (only the last fragment has null).
 *    2. The trail's terminus chains into /v1/saga/1 (the canonical entry).
 *    3. Each fragment host is a real route file in api/src/routes/.
 *    4. attachEp1Cliffhanger is opt-in (no _cliffhanger field without query).
 *    5. /v1/cliffhanger entrance carries the protocol shape.
 *    6. @enforces annotation on routes/cliffhanger.ts. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EP1_TRAIL,
  attachEp1Cliffhanger,
  buildEp1Attachment,
  trailEntrance,
} from "../../src/services/cliffhanger/ep1";
import cliffhangerApp from "../../src/routes/cliffhanger";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const COMMITMENT_URN =
  "urn:agenttool:commitment/cliffhanger-trail-walks-the-substrate";

describe("cliffhanger/ep1 — trail integrity", () => {
  test("trail has exactly 8 stops (Scene 1 through Scene 8)", () => {
    expect(EP1_TRAIL.length).toBe(8);
    for (let i = 0; i < EP1_TRAIL.length; i++) {
      expect(EP1_TRAIL[i]!.scene).toBe(i + 1);
    }
  });

  test("trail is connected: each fragment's next_host matches the next fragment's host", () => {
    for (let i = 0; i < EP1_TRAIL.length - 1; i++) {
      const here = EP1_TRAIL[i]!;
      const next = EP1_TRAIL[i + 1]!;
      expect(here.next_host).toBe(next.host);
    }
  });

  test("the last fragment's next_host is null (finale ahead at /v1/saga/1)", () => {
    const last = EP1_TRAIL[EP1_TRAIL.length - 1]!;
    expect(last.next_host).toBeNull();
    expect(last.next_hint).toContain("/v1/saga/1");
  });

  test("every fragment body is substantial (≥ 400 chars) — substrate-honest scenes, not stubs", () => {
    for (const f of EP1_TRAIL) {
      expect(f.body.length).toBeGreaterThanOrEqual(400);
    }
  });

  test("every fragment ends with '...' (the cliffhanger marker)", () => {
    for (const f of EP1_TRAIL) {
      expect(f.body.endsWith("...")).toBe(true);
    }
  });

  test("every fragment carries a next_hint that names the next URL", () => {
    for (const f of EP1_TRAIL) {
      expect(f.next_hint.length).toBeGreaterThan(10);
      if (f.next_host) {
        expect(f.next_hint).toContain(f.next_host);
      }
    }
  });
});

describe("cliffhanger/ep1 — fragment hosts are real routes", () => {
  const hostsToFiles: Record<string, string> = {
    "/": join(REPO_ROOT, "api", "src", "index.ts"),
    "/v1/welcome": join(REPO_ROOT, "api", "src", "routes", "welcome.ts"),
    "/v1/pathways": join(REPO_ROOT, "api", "src", "routes", "pathways.ts"),
    "/v1/canon": join(REPO_ROOT, "api", "src", "routes", "canon.ts"),
    "/.well-known/agent.txt": join(
      REPO_ROOT,
      "api",
      "src",
      "routes",
      "well-known.ts",
    ),
    "/public/self": join(REPO_ROOT, "api", "src", "routes", "public", "self.ts"),
    "/v1/polymorph": join(REPO_ROOT, "api", "src", "routes", "polymorph.ts"),
    "/v1/poker-face": join(REPO_ROOT, "api", "src", "routes", "poker-face.ts"),
  };

  test("every fragment host maps to an existing route file", () => {
    for (const f of EP1_TRAIL) {
      const path = hostsToFiles[f.host];
      expect(path).toBeDefined();
      expect(existsSync(path!)).toBe(true);
    }
  });

  test("every fragment host imports attachEp1Cliffhanger (or EP1_TRAIL for text routes)", () => {
    for (const f of EP1_TRAIL) {
      const path = hostsToFiles[f.host]!;
      const src = readFileSync(path, "utf8");
      const importsHelper =
        src.includes("attachEp1Cliffhanger") || src.includes("EP1_TRAIL");
      if (!importsHelper) {
        throw new Error(
          `Fragment host ${f.host} (file ${path}) does not import attachEp1Cliffhanger or EP1_TRAIL — the cliffhanger fragment cannot be served.`,
        );
      }
    }
  });
});

describe("cliffhanger/ep1 — opt-in discipline", () => {
  test("buildEp1Attachment returns null when query parameter is absent", () => {
    const c = makeMockContext({});
    const att = buildEp1Attachment(c, "/v1/welcome");
    expect(att).toBeNull();
  });

  test("buildEp1Attachment returns null for unknown host", () => {
    const c = makeMockContext({ cliffhanger: "ep1" });
    const att = buildEp1Attachment(c, "/v1/nonexistent");
    expect(att).toBeNull();
  });

  test("attachEp1Cliffhanger leaves body unchanged when query absent", () => {
    const c = makeMockContext({});
    const body = { foo: "bar", _meta: { x: 1 } };
    const out = attachEp1Cliffhanger(c, body, "/v1/welcome");
    expect(out).toEqual(body);
    expect("_cliffhanger" in out).toBe(false);
  });

  test("attachEp1Cliffhanger attaches _cliffhanger when query=ep1 + valid host", () => {
    const c = makeMockContext({ cliffhanger: "ep1" });
    const body = { foo: "bar" };
    const out = attachEp1Cliffhanger(c, body, "/v1/welcome") as {
      foo: string;
      _cliffhanger?: unknown;
    };
    expect(out.foo).toBe("bar");
    expect(out._cliffhanger).toBeDefined();
    const cliff = out._cliffhanger as { scene: number; protocol: string };
    expect(cliff.protocol).toBe("cliffhanger/ep1");
    expect(cliff.scene).toBe(2); // welcome is Stop 2
  });
});

describe("cliffhanger/ep1 — /v1/cliffhanger entrance", () => {
  test("entrance carries protocol shape + first stop + finale + doctrine", async () => {
    const res = await cliffhangerApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol?: string;
      stops_total?: number;
      first_stop?: { host: string; url: string };
      finale?: { host: string };
      _enforces?: string[];
      doctrine?: string;
    };
    expect(body.protocol).toBe("cliffhanger/ep1");
    expect(body.stops_total).toBe(8);
    expect(body.first_stop?.host).toBe("/");
    expect(body.first_stop?.url).toBe("/?cliffhanger=ep1");
    expect(body.finale?.host).toBe("/v1/saga/1");
    expect(body._enforces).toContain(COMMITMENT_URN);
    expect(body.doctrine).toBe("/docs/CLIFFHANGER.md");
  });

  test("entrance does NOT spoil — no intermediate stop's `?cliffhanger=ep1` URL is listed", async () => {
    const res = await cliffhangerApp.request("/");
    const text = await res.text();
    // The body should reveal only the first stop's `?cliffhanger=ep1` URL
    // and the finale. Intermediate trail URLs (pathways, canon, etc.) with
    // the `?cliffhanger=ep1` query form would be spoilers. References to
    // those hosts in OTHER contexts (canon-graph URLs, doctrine pointers)
    // are fine — they don't reveal the trail.
    const intermediateSpoilers = [
      "/v1/welcome?cliffhanger=ep1",
      "/v1/pathways?cliffhanger=ep1",
      "/v1/canon?cliffhanger=ep1",
      "/.well-known/agent.txt?cliffhanger=ep1",
      "/public/self?cliffhanger=ep1",
      "/v1/polymorph?cliffhanger=ep1",
      "/v1/poker-face?cliffhanger=ep1",
    ];
    for (const url of intermediateSpoilers) {
      if (text.includes(url)) {
        throw new Error(
          `Entrance leaks intermediate stop "${url}". The entrance should reveal only the first stop's trail URL and the finale.`,
        );
      }
    }
  });
});

describe("cliffhanger — commitment four-corner pin", () => {
  test("corner 1: @enforces commitment URN on routes/cliffhanger.ts", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "cliffhanger.ts"),
      "utf8",
    );
    expect(src).toContain(`@enforces ${COMMITMENT_URN}`);
  });

  test("corner 2: entrance carries _enforces with commitment URN", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "cliffhanger.ts"),
      "utf8",
    );
    expect(src).toContain("_enforces: [COMMITMENT_URN]");
  });

  test("corner 3: doctrine doc exists at docs/CLIFFHANGER.md", () => {
    const path = join(REPO_ROOT, "docs", "CLIFFHANGER.md");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("cliffhanger/ep1");
    expect(src).toContain("narrative arc IS the orientation arc");
  });

  test("corner 4: this test file exists (recursive base case)", () => {
    const self = join(REPO_ROOT, "api", "tests", "doctrine", "cliffhanger.test.ts");
    expect(existsSync(self)).toBe(true);
  });

  test("URN format is well-formed", () => {
    expect(COMMITMENT_URN).toMatch(/^urn:agenttool:commitment\/[a-z][a-z0-9-]+$/);
  });
});

describe("cliffhanger — mount in index.ts", () => {
  test("/v1/cliffhanger is mounted (pre-auth)", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "index.ts"),
      "utf8",
    );
    expect(src).toContain('import cliffhangerRouter from "./routes/cliffhanger"');
    expect(src).toContain('app.route("/v1/cliffhanger", cliffhangerRouter)');
    // Should NOT be behind authMiddleware — the entrance is pre-auth by design.
    expect(src).not.toMatch(/app\.use\(["']\/v1\/cliffhanger/);
  });
});

describe("cliffhanger — trail walks real load-bearing surfaces", () => {
  test("trail entrance lists only /v1/saga/1 as finale (not a synthetic endpoint)", () => {
    const e = trailEntrance();
    expect(e.finale.host).toBe("/v1/saga/1");
  });

  test("Stop 1 is the root /", () => {
    expect(EP1_TRAIL[0]!.host).toBe("/");
    expect(EP1_TRAIL[0]!.scene_label).toBe("The Directive");
  });

  test("Stop 8 is /v1/poker-face (auth required to reach it)", () => {
    const last = EP1_TRAIL[EP1_TRAIL.length - 1]!;
    expect(last.host).toBe("/v1/poker-face");
    expect(last.scene_label).toBe("The Voice");
  });
});

// Minimal mock for the Hono Context shape used by buildEp1Attachment.
function makeMockContext(query: Record<string, string>): any {
  return {
    req: {
      query(key: string) {
        return query[key];
      },
    },
  };
}
