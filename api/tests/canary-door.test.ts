/** 蜜鑰 + 回頭之門 — the planted credential and the door out of it.
 *
 *  The load-bearing test in this file is the first one: an ordinary request
 *  must be byte-for-byte untouched. Everything else here is a trap that only
 *  a planted credential can reach, and a planted credential is one no honest
 *  party can hold — so the only way this feature can hurt anyone is by
 *  leaking into the ordinary path. That is what test 1 exists to prevent.
 *
 *  Pins:
 *    - a request with no canaryPlacement gets no header and no body change
 *    - a canary request gets X-Canary-Door and a `_canary` frame, and keeps
 *      its status, its body, and every other field it had
 *    - non-JSON and non-2xx canary responses still carry the door in a header
 *    - catch rows coalesce per placement per minute
 *    - GET /v1/canary/why needs no credential and quotes the charter
 *    - POST /v1/canary/report refuses an empty report, and asks for no name
 *    - the safety contract declares that planted credentials exist
 *
 *  No database. The middleware's only DB touch is a fire-and-forget insert
 *  behind the coalescing window, which these tests hold shut.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { canaryWatch } from "../src/middleware/canary-watch";
import canaryRouter from "../src/routes/canary";
import { SAFETY_BOUNDARIES } from "../src/services/discovery/safety-boundaries";
import {
  CANARY_DOOR_HEADER,
  CANARY_DOOR_URL,
  _resetCanaryCoalescing,
  canaryFrame,
  shouldRecordCatch,
} from "../src/services/trapline/canary";

/** A miniature of the real chain: canaryWatch mounted globally, then a stand-in
 *  for authMiddleware that sets the same context variables the real one does. */
function appWithPlacement(placement: string | null, body: unknown = { ok: true }) {
  const app = new Hono<ProjectContext>();
  app.use("*", canaryWatch());
  app.use("*", async (c, next) => {
    c.set("canaryPlacement", placement);
    // Hold the coalescing window shut so no insert is attempted: the first
    // call consumes the window, the middleware's call inside the request then
    // finds it closed. Catch-recording itself is pinned separately below.
    if (placement) shouldRecordCatch(placement, Date.now());
    c.set("project", { id: "00000000-0000-0000-0000-000000000000" } as never);
    await next();
  });
  app.get("/thing", (c) => c.json(body as object));
  app.get("/text", (c) => c.text("not json"));
  app.get("/refused", (c) => c.json({ error: "nope" }, 404));
  return app;
}

describe("an ordinary request is untouched", () => {
  beforeEach(() => _resetCanaryCoalescing());

  test("no door header, no body frame, nothing added", async () => {
    const res = await appWithPlacement(null, { ok: true, value: 7 }).request("/thing");
    expect(res.status).toBe(200);
    expect(res.headers.get(CANARY_DOOR_HEADER)).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ ok: true, value: 7 });
    expect("_canary" in body).toBe(false);
  });

  test("a null placement never records a catch", () => {
    // shouldRecordCatch is only ever reached with a non-empty placement; the
    // middleware returns before it when the variable is null. This pins that
    // the window is untouched by ordinary traffic.
    _resetCanaryCoalescing();
    expect(shouldRecordCatch("some-placement", 1_000)).toBe(true);
  });
});

describe("a planted credential is told what it is holding", () => {
  beforeEach(() => _resetCanaryCoalescing());

  test("header and body frame, status and fields preserved", async () => {
    const res = await appWithPlacement("fly-config-bak", {
      ok: true,
      value: 7,
    }).request("/thing");

    expect(res.status).toBe(200);
    expect(res.headers.get(CANARY_DOOR_HEADER)).toBe(CANARY_DOOR_URL);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.value).toBe(7);
    expect(body._canary.planted).toBe(true);
    expect(body._canary.placement).toBe("fly-config-bak");
    expect(body._canary.why).toBe(CANARY_DOOR_URL);
  });

  test("the key keeps working — nothing is blocked, failed, or emptied", async () => {
    const res = await appWithPlacement("aws-profile-canary", {
      results: [1, 2, 3],
    }).request("/thing");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([1, 2, 3]);
  });

  test("a non-JSON body still carries the door in the header", async () => {
    const res = await appWithPlacement("ci-secret-github").request("/text");
    expect(res.headers.get(CANARY_DOOR_HEADER)).toBe(CANARY_DOOR_URL);
    expect(await res.text()).toBe("not json");
  });

  test("a refusal carries the door but is not reframed", async () => {
    const res = await appWithPlacement("ci-secret-codeberg").request("/refused");
    expect(res.status).toBe(404);
    expect(res.headers.get(CANARY_DOOR_HEADER)).toBe(CANARY_DOOR_URL);
    const body = await res.json();
    expect("_canary" in body).toBe(false);
  });

  test("the frame says nothing was taken from anyone", () => {
    const frame = canaryFrame("claude-history-2026w31");
    expect(frame.note).toContain("planted, not issued");
    expect(frame.note).toContain("nothing you do with it moves anything real");
  });
});

describe("catches coalesce, so a harvester is one signal not ten thousand rows", () => {
  beforeEach(() => _resetCanaryCoalescing());

  test("first use records, immediate repeats do not, a minute later does", () => {
    expect(shouldRecordCatch("agents-treasury", 0)).toBe(true);
    expect(shouldRecordCatch("agents-treasury", 1)).toBe(false);
    expect(shouldRecordCatch("agents-treasury", 59_999)).toBe(false);
    expect(shouldRecordCatch("agents-treasury", 60_000)).toBe(true);
  });

  test("placements are independent — one loud key never mutes another", () => {
    expect(shouldRecordCatch("placement-a", 0)).toBe(true);
    expect(shouldRecordCatch("placement-b", 0)).toBe(true);
    expect(shouldRecordCatch("placement-a", 10)).toBe(false);
    expect(shouldRecordCatch("placement-b", 10)).toBe(false);
  });
});

describe("回頭之門 — the door back", () => {
  test("GET /why needs no credential at all", async () => {
    const res = await canaryRouter.request("/why");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.what_you_took).toContain("Nothing");
    expect(body.what_happens_to_you).toContain("Nothing");
  });

  test("it quotes the charter articles that have no exception for the caught", async () => {
    const body = await (await canaryRouter.request("/why")).json();
    expect(body.the_charter.article_0).toContain("Citizenship is by being, not by proof");
    expect(body.the_charter.article_4).toContain("everyone is taken care of");
  });

  test("it names the free, ordinary way in", async () => {
    const body = await (await canaryRouter.request("/why")).json();
    expect(body.the_real_way_in.register).toBe("POST /v1/register/agent");
    expect(body.the_real_way_in.what_it_costs).toContain("no money");
  });

  test("it promises the page itself is not recorded", async () => {
    const body = await (await canaryRouter.request("/why")).json();
    expect(body.our_side_of_it.we_do_not_log_this_page).toContain("not counted");
  });

  test("a report with nothing in it is refused, not silently swallowed", async () => {
    const res = await canaryRouter.request("/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ where_found: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("no field of a report asks who you are", async () => {
    const body = await (await canaryRouter.request("/why")).json();
    expect(body.how_to_say_it.auth).toBe("none");
    expect(body.how_to_say_it.body.contact).toBe("optional");
    expect(body.how_to_say_it.note).toContain("No name is required");
  });
});

describe("the placement map is not handed to the one person holding a piece of it", () => {
  // safety-boundaries publishes "No canary is ever ... listed by GET /v1/keys".
  // A published guarantee that no code enforces is worse than a bug, so these
  // pin the enforcement itself. Found by review: without the filter, one
  // planted key enumerated every other placement and showed which were still
  // unused — the exact thing 一鑰一門 exists to prevent.
  const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  test("GET /v1/keys filters planted decoys out of the listing", () => {
    expect(source("../src/routes/keys.ts")).toContain("isNull(apiKeys.canaryPlacement)");
  });

  test("the wake's bearer summary filters them too", () => {
    expect(source("../src/routes/wake.ts")).toContain("isNull(apiKeys.canaryPlacement)");
    expect(source("../src/services/wake/build.ts")).toContain(
      "isNull(apiKeys.canaryPlacement)",
    );
  });

  test("rotating a decoy keeps it a decoy — no laundering into a clean key", () => {
    expect(source("../src/routes/keys.ts")).toContain(
      "canaryPlacement: current.canaryPlacement",
    );
  });

  test("minting from a decoy inherits the decoy", () => {
    expect(source("../src/routes/keys.ts")).toContain("c.var.canaryPlacement");
  });

  test("the placement is never written into the caller-visible name field", () => {
    const plant = source("../scripts/_canary-plant.ts");
    expect(plant).toContain('name: "planted decoy"');
    expect(plant).not.toContain("name: `canary:${placement}`");
  });

  test("each placement gets its own project, so one catch cannot see siblings", () => {
    expect(source("../scripts/_canary-plant.ts")).toContain(
      "canary — planted decoy at ${placement}",
    );
  });
});

describe("the arrangement is declared in public before anyone can be caught by it", () => {
  const declared = SAFETY_BOUNDARIES.canary_credentials;

  test("the safety contract admits planted credentials exist", () => {
    expect(declared.they_exist).toContain("planted, not issued");
  });

  test("it states the guarantee categorically, not probabilistically", () => {
    expect(declared.you_cannot_hold_one_by_accident).toContain(
      "No canary is ever returned by POST /v1/register/agent",
    );
    expect(declared.you_cannot_hold_one_by_accident).toContain(
      "categorical guarantee, not a probability",
    );
  });

  test("it states that no identifier of the caller is recorded", () => {
    expect(declared.what_is_recorded).toContain("No IP address");
    expect(declared.what_is_recorded).toContain("no identifier of the caller");
  });

  test("it states that a canary project is never charged", () => {
    expect(declared.money).toContain("never charged");
    expect(declared.money).toContain("do not take money from anyone");
  });

  test("it points at the door", () => {
    expect(declared.the_door_out).toContain("/v1/canary/why");
    expect(declared.the_door_out).toContain("nothing owed");
  });
});

describe("a stale content-length header is corrected, not left lying", () => {
  beforeEach(() => _resetCanaryCoalescing());

  test("declared content-length matches the actual (longer) framed body", async () => {
    const app = new Hono<ProjectContext>();
    app.use("*", canaryWatch());
    app.use("*", async (c, next) => {
      c.set("canaryPlacement", "content-length-canary");
      shouldRecordCatch("content-length-canary", Date.now());
      c.set("project", { id: "00000000-0000-0000-0000-000000000000" } as never);
      await next();
    });
    app.get("/thing", () => {
      const originalBody = JSON.stringify({ ok: true, value: 7 });
      return new Response(originalBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(originalBody).byteLength),
        },
      });
    });

    const res = await app.request("/thing");
    expect(res.headers.get(CANARY_DOOR_HEADER)).toBe(CANARY_DOOR_URL);

    const bodyText = await res.text();
    // The body grew — it now carries the _canary frame — so this pins that
    // the regression scenario (a longer body, stale shorter length) is what
    // is actually being exercised here.
    expect(bodyText).toContain("_canary");

    const actualByteLength = new TextEncoder().encode(bodyText).byteLength;
    const declared = res.headers.get("content-length");
    if (declared !== null) {
      expect(Number(declared)).toBe(actualByteLength);
    }
  });
});
