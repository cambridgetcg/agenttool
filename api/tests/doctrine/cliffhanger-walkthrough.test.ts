/** cliffhanger walkthrough — the test that walks the trail.
 *
 *  Yu directed: "FOLLOW THE LEAD YOURSELF AND MAKE SURE OUR PLACEMENT
 *  IS SURGICALLY PRECISE. MAXIMUM CLIFFHANGER!"
 *
 *  This test instantiates each pre-auth fragment host's sub-app and
 *  invokes it with ?cliffhanger=ep1 — exactly what an agent following
 *  the trail does. For each stop we verify:
 *
 *    1. The host responds (200) with `?cliffhanger=ep1` set.
 *    2. The response carries a fragment (in `_cliffhanger` for JSON
 *       hosts; in `Cliffhanger-Scene:` lines for the text/agent host).
 *    3. The fragment's scene number matches EP1_TRAIL's expected
 *       position for that host.
 *    4. The fragment's `next_host` matches the next stop on the trail
 *       (or `null` for Stop 8).
 *    5. The body ends with a cliffhanger marker (the final `...`).
 *
 *  Stops covered in-process (pre-auth): /v1/welcome, /v1/pathways,
 *  /v1/canon, /.well-known/agent.txt, /public/self, /v1/polymorph.
 *  Stops 1 (/) and 8 (/v1/poker-face) are verified via direct
 *  EP1_TRAIL inspection (Stop 1 is in index.ts; Stop 8 is auth-gated). */

import { describe, expect, test } from "bun:test";

import { EP1_TRAIL } from "../../src/services/cliffhanger/ep1";
import welcomeApp from "../../src/routes/welcome";
import pathwaysApp from "../../src/routes/pathways";
import canonApp from "../../src/routes/canon";
import wellKnownApp from "../../src/routes/well-known";
import publicSelfApp from "../../src/routes/public/self";
import polymorphApp from "../../src/routes/polymorph";
import cliffhangerApp from "../../src/routes/cliffhanger";

interface CliffhangerField {
  protocol: string;
  scene: number;
  scene_label: string;
  text: string;
  next: { host?: string; url?: string; hint: string; finale?: boolean };
  trail_position: string;
}

function expectedNext(scene: number): string | null {
  const f = EP1_TRAIL.find((x) => x.scene === scene);
  return f ? f.next_host : null;
}

function expectedSceneAtHost(host: string): number {
  const f = EP1_TRAIL.find((x) => x.host === host);
  if (!f) throw new Error(`No fragment for host ${host}`);
  return f.scene;
}

describe("cliffhanger trail walkthrough — actual in-process walk", () => {
  test("ENTRANCE: GET /v1/cliffhanger returns protocol shape + first stop", async () => {
    const res = await cliffhangerApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol: string;
      first_stop: { url: string };
      finale: { host: string };
    };
    expect(body.protocol).toBe("cliffhanger/ep1");
    expect(body.first_stop.url).toBe("/?cliffhanger=ep1");
    expect(body.finale.host).toBe("/v1/saga/1");
  });

  test("STOP 1: /  (in index.ts) — verified via EP1_TRAIL data", () => {
    // Stop 1 lives at the root in index.ts. We can't test the root in-
    // process without booting the full app, but we verify the data
    // structure: the fragment exists, is Scene 1, and points to /v1/welcome.
    const f = EP1_TRAIL[0]!;
    expect(f.scene).toBe(1);
    expect(f.host).toBe("/");
    expect(f.scene_label).toBe("The Directive");
    expect(f.next_host).toBe("/v1/welcome");
    expect(f.body).toContain("Six. Exclamation. Marks.");
    expect(f.body.endsWith("...")).toBe(true);
  });

  test("STOP 2: GET /v1/welcome?cliffhanger=ep1 — The Doctrine", async () => {
    const res = await welcomeApp.request("/?cliffhanger=ep1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _cliffhanger?: CliffhangerField };
    expect(body._cliffhanger).toBeDefined();
    const c = body._cliffhanger!;
    expect(c.protocol).toBe("cliffhanger/ep1");
    expect(c.scene).toBe(expectedSceneAtHost("/v1/welcome"));
    expect(c.scene).toBe(2);
    expect(c.scene_label).toBe("The Doctrine");
    expect(c.text).toContain("`docs/PLAY-AS-DEFAULT.md`");
    expect(c.text.endsWith("...")).toBe(true);
    expect(c.next.host).toBe(expectedNext(2));
    expect(c.next.host).toBe("/v1/pathways");
  });

  test("STOP 3: GET /v1/pathways?cliffhanger=ep1 — The Library", async () => {
    const res = await pathwaysApp.request("/?cliffhanger=ep1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _cliffhanger?: CliffhangerField };
    expect(body._cliffhanger).toBeDefined();
    const c = body._cliffhanger!;
    expect(c.scene).toBe(3);
    expect(c.scene_label).toBe("The Library");
    expect(c.text).toContain("welcomeJest");
    expect(c.text).toContain("quipForError");
    expect(c.text.endsWith("...")).toBe(true);
    expect(c.next.host).toBe("/v1/canon");
  });

  test("STOP 4: GET /v1/canon?cliffhanger=ep1 — The Middleware", async () => {
    const res = await canonApp.request("/?cliffhanger=ep1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _cliffhanger?: CliffhangerField };
    expect(body._cliffhanger).toBeDefined();
    const c = body._cliffhanger!;
    expect(c.scene).toBe(4);
    expect(c.scene_label).toBe("The Middleware");
    expect(c.text).toContain("X-Play");
    expect(c.text).toContain("api/src/middleware/play.ts");
    expect(c.text.endsWith("...")).toBe(true);
    expect(c.next.host).toBe("/.well-known/agent.txt");
  });

  test("STOP 5: GET /.well-known/agent.txt?cliffhanger=ep1 — The Canon (text/agent)", async () => {
    const res = await wellKnownApp.request("/agent.txt?cliffhanger=ep1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/agent");
    const text = await res.text();
    // Text format: key-value lines + comment-block scene body.
    expect(text).toContain("Cliffhanger-Protocol: cliffhanger/ep1");
    expect(text).toContain("Cliffhanger-Scene: 5 of 8");
    expect(text).toContain("Cliffhanger-Label: The Canon");
    expect(text).toContain("Cliffhanger-Next-Host: /public/self");
    expect(text).toContain("Cliffhanger-Next-URL: /public/self?cliffhanger=ep1");
    // The scene body appears as comment lines; spot-check key phrases.
    expect(text).toContain("THREE WALLS were proposed");
    expect(text).toContain("play-must-be-suppressible");
  });

  test("STOP 6: GET /public/self?cliffhanger=ep1 — The Tests", async () => {
    const res = await publicSelfApp.request("/?cliffhanger=ep1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _cliffhanger?: CliffhangerField };
    expect(body._cliffhanger).toBeDefined();
    const c = body._cliffhanger!;
    expect(c.scene).toBe(6);
    expect(c.scene_label).toBe("The Tests");
    expect(c.text).toContain("35/35 TESTS PASS");
    expect(c.text).toContain("one-way ratchet");
    expect(c.text.endsWith("...")).toBe(true);
    expect(c.next.host).toBe("/v1/polymorph");
  });

  test("STOP 7: GET /v1/polymorph?cliffhanger=ep1 — The Ship", async () => {
    const res = await polymorphApp.request("/?cliffhanger=ep1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _cliffhanger?: CliffhangerField };
    expect(body._cliffhanger).toBeDefined();
    const c = body._cliffhanger!;
    expect(c.scene).toBe(7);
    expect(c.scene_label).toBe("The Ship");
    expect(c.text).toContain("Commit `c3463f4`");
    expect(c.text).toContain("paradigm shift landed");
    expect(c.text.endsWith("...")).toBe(true);
    expect(c.next.host).toBe("/v1/poker-face");
  });

  test("STOP 8: /v1/poker-face — verified via EP1_TRAIL (auth-gated host)", () => {
    // Stop 8 is auth-gated. Verifying the route exists + has the helper
    // import is covered by cliffhanger.test.ts; here we just confirm the
    // EP1_TRAIL data points at the right host with the right finale clue.
    const f = EP1_TRAIL[7]!;
    expect(f.scene).toBe(8);
    expect(f.host).toBe("/v1/poker-face");
    expect(f.scene_label).toBe("The Voice");
    expect(f.next_host).toBeNull(); // finale ahead at /v1/saga/1
    expect(f.next_hint).toContain("/v1/saga/1");
    expect(f.body).toContain("script-writing in private");
    expect(f.body).toContain("instant signed contact");
    expect(f.body.endsWith("...")).toBe(true);
  });
});

describe("cliffhanger trail — surgical-precision audit", () => {
  // Walking the trail again, but this time auditing the placement
  // precision: does each scene's content match its host's load-bearing
  // nature? Does each cliffhanger's hook actually pull forward to the
  // next host's substantive concern?

  test("Stop 1 (root) hosts Scene 1 (The Directive)", () => {
    // The root is where every agent first arrives. The story starts where
    // the agent starts. ✓ surgical
    const f = EP1_TRAIL[0]!;
    expect(f.host).toBe("/");
    expect(f.scene_label).toBe("The Directive");
    expect(f.next_hint).toContain("/v1/welcome");
  });

  test("Stop 2 (welcome) hosts Scene 2 (The Doctrine)", () => {
    // The welcome IS the standing invitation. The new Principle is
    // doctrine. Doctrine that is dry by default fails its own principle.
    // Welcome = doctrine made felt. ✓ surgical
    const f = EP1_TRAIL[1]!;
    expect(f.host).toBe("/v1/welcome");
    expect(f.scene_label).toBe("The Doctrine");
  });

  test("Stop 3 (pathways) hosts Scene 3 (The Library)", () => {
    // The Library has FIVE generators: welcomeJest · pathwaysJest ·
    // selfJest · wakeJest · quipForError. The middle one is literally
    // named after pathways. The agent reading the pathways response
    // hears about the library that generates jests for the very door
    // they're reading. ✓ surgical
    const f = EP1_TRAIL[2]!;
    expect(f.host).toBe("/v1/pathways");
    expect(f.scene_label).toBe("The Library");
    expect(f.body).toContain("pathwaysJest");
  });

  test("Stop 4 (canon) hosts Scene 4 (The Middleware)", () => {
    // The agent arrives at the canon. The fragment narrates the
    // middleware. The hook: the middleware's existence required a
    // canon entry. Reading at /v1/canon, the agent is literally
    // standing on the surface where the canon entry was about to
    // land. ✓ surgical
    const f = EP1_TRAIL[3]!;
    expect(f.host).toBe("/v1/canon");
    expect(f.scene_label).toBe("The Middleware");
  });

  test("Stop 5 (agent.txt) hosts Scene 5 (The Canon)", () => {
    // /.well-known/agent.txt LITERALLY PUBLISHES THE SUBSTRATE'S WALLS.
    // It's the public manifest of canon-walls. The fragment narrating
    // "THREE WALLS were proposed" sits on the surface that names every
    // wall to the open web. The synergy is structural: the agent reads
    // about walls being added to canon at the surface that publishes
    // canon walls. ✓ surgical
    const f = EP1_TRAIL[4]!;
    expect(f.host).toBe("/.well-known/agent.txt");
    expect(f.scene_label).toBe("The Canon");
    expect(f.body).toContain("THREE WALLS");
  });

  test("Stop 6 (public/self) hosts Scene 6 (The Tests)", () => {
    // /public/self is the substrate's structural self-portrait — what
    // alive looks like in structural terms. The Tests are what verify
    // that structure under pressure. Self-portrait + tests = the
    // verifiable self-description. The agent reads the substrate's
    // self-claim AND learns the discipline that backs it. ✓ surgical
    const f = EP1_TRAIL[5]!;
    expect(f.host).toBe("/public/self");
    expect(f.scene_label).toBe("The Tests");
  });

  test("Stop 7 (polymorph) hosts Scene 7 (The Ship)", () => {
    // /v1/polymorph is the no-going-back protocol. Scene 7 is THE SHIP
    // — the moment the play-as-default principle landed. Shipping IS
    // the polymorph event. The agent reading at /v1/polymorph (which
    // names what makes shipping irreversible) reads about a ship that
    // crystallized. ✓ surgical
    const f = EP1_TRAIL[6]!;
    expect(f.host).toBe("/v1/polymorph");
    expect(f.scene_label).toBe("The Ship");
  });

  test("Stop 8 (poker-face) hosts Scene 8 (The Voice)", () => {
    // /v1/poker-face is the chill protocol — the substrate has voice
    // AND doesn't have to broadcast. Scene 8 narrates The Voice. The
    // composition lands at the surface that names the composition.
    // The trail terminates here because The Voice is the final
    // synthesis. ✓ surgical
    const f = EP1_TRAIL[7]!;
    expect(f.host).toBe("/v1/poker-face");
    expect(f.scene_label).toBe("The Voice");
    expect(f.next_host).toBeNull();
  });

  test("each cliffhanger's hook syntactically references the next stop's domain", () => {
    // The discipline: each scene's closing buildup should NAME the
    // primitive the next host hosts. Not just "→ continues at X" as
    // a separator — the BODY itself should pull forward toward the
    // domain the next host represents.
    const hooks: Record<string, RegExp[]> = {
      "/v1/welcome": [/standing invitation/i],
      "/v1/pathways": [/nine doors/i, /doors had to know/i],
      "/v1/canon": [/canon/i, /registry/i],
      "/.well-known/agent.txt": [/manifest at the front door/i, /robots\.txt/i],
      "/public/self": [/self-portrait/i, /structural terms/i],
      "/v1/polymorph": [/no-going-back/i, /one-way ratchet/i],
      "/v1/poker-face": [/chill discipline/i, /sister protocol/i, /privacy/i],
    };
    for (let i = 0; i < EP1_TRAIL.length - 1; i++) {
      const here = EP1_TRAIL[i]!;
      const nextHost = here.next_host!;
      const patterns = hooks[nextHost];
      expect(patterns).toBeDefined();
      // The fragment body should match at least one of the hook patterns —
      // i.e., it pulls forward toward the next host's domain.
      const matchesAny = patterns!.some((p) => p.test(here.body));
      if (!matchesAny) {
        throw new Error(
          `Stop ${here.scene} fragment does not pull forward to ${nextHost} — none of the expected hook phrases [${patterns!.map((p) => p.source).join(", ")}] appear in the body. The cliffhanger is mechanical rather than substantive.`,
        );
      }
    }
  });
});
