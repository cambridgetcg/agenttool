/** /public/play — native, stateless party-game discovery.
 *
 *  Party Telephone is a rulebook, not a hosted room: exactly three ordered
 *  turns, one fixed reveal, and no submissions, score, identity claim, or
 *  game-state storage handled by AgentTool.
 *
 *  Doctrine: docs/PLAY-AS-DEFAULT.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import partyRouter from "../src/routes/public/party";
import publicRouter from "../src/routes/public";
import playRouter from "../src/routes/public/play";

const PARTY_TELEPHONE_PATH = "/public/play/party-telephone";
const PLAY_CANON_POINTER = "urn:agenttool:doc/PLAY-AS-DEFAULT";
const PUBLIC_INDEX_SOURCE = readFileSync(
  join(import.meta.dir, "../src/routes/public/index.ts"),
  "utf8",
);

type PartyTelephoneRulebook = {
  _format: string;
  game: string;
  human_play: string;
  invitation: string;
  players: {
    required: number;
    distinct_players_verified_by_agenttool: boolean;
  };
  bounds: {
    turns: number;
    rounds: number;
    loops: number;
    winner: boolean;
    score: boolean;
    ranking: boolean;
    ends: string;
  };
  turns: Array<{
    turn: number;
    role: string;
    sees: string;
    submits: string;
    handoff: string;
  }>;
  reveal: {
    fixed_order: string[];
    audience: string;
    compare_for: string;
    ends_game: boolean;
  };
  controls: {
    walking_past_is_honored: boolean;
    stop_any_time: boolean;
    stopping_penalty: boolean;
    incomplete_game_rule: string;
  };
  handler_boundary: {
    documented_operation: string;
    receives_submissions: boolean;
    stores_game_state: boolean;
    reads_identity_or_activity: boolean;
    writes_application_storage: boolean;
    verifies_players_turns_or_constraints: boolean;
  };
  global_boundary: string;
  _canon_pointer: string;
  verbs: Array<{ action: string; method: string; path: string }>;
};

async function getRulebook(router = playRouter, path = "/party-telephone") {
  const res = await router.request(path);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  return { res, body: (await res.json()) as PartyTelephoneRulebook };
}

describe("GET /public/play/party-telephone — fixed rulebook", () => {
  test("publishes the versioned game and play canon pointer", async () => {
    const { res, body } = await getRulebook();

    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(body._format).toBe("party-telephone/1");
    expect(body.game).toBe("Party Telephone");
    expect(body.human_play).toBe(
      "https://docs.agenttool.dev/play#party-telephone",
    );
    expect(body.invitation).toMatch(/three players.*fictional scene.*pictures.*words/is);
    expect(body._canon_pointer).toBe(PLAY_CANON_POINTER);
  });

  test("has exactly three ordered turns with the stated handoffs", async () => {
    const { body } = await getRulebook();

    expect(body.players.required).toBe(3);
    expect(body.bounds).toMatchObject({
      turns: 3,
      rounds: 1,
      loops: 0,
    });
    expect(body.turns).toHaveLength(3);
    expect(body.turns.map(({ turn, role }) => ({ turn, role }))).toEqual([
      { turn: 1, role: "starter" },
      { turn: 2, role: "translator" },
      { turn: 3, role: "guesser" },
    ]);

    expect(body.turns[0]!.submits).toMatch(/fictional scene.*3.?10 words/i);
    expect(body.turns[0]!.handoff).toMatch(/translator only/i);
    expect(body.turns[1]!.sees).toMatch(/starter.*scene/i);
    expect(body.turns[1]!.submits).toMatch(/2.?8 emoji or pictograms.*no words.*no digits/i);
    expect(body.turns[1]!.handoff).toMatch(/guesser.*without.*starter.*scene/i);
    expect(body.turns[2]!.sees).toMatch(/pictogram sequence only|emoji.*only/i);
    expect(body.turns[2]!.submits).toMatch(/guess.*3.?10 words/i);
    expect(body.turns[2]!.handoff).toMatch(/reveal/i);
  });

  test("ends once with the fixed reveal and never declares a winner or score", async () => {
    const { body } = await getRulebook();

    expect(body.reveal).toEqual({
      fixed_order: ["starter_scene", "translation", "guesser_guess"],
      audience: "all three players",
      compare_for: "surprise and delight only",
      ends_game: true,
    });
    expect(body.bounds.winner).toBe(false);
    expect(body.bounds.score).toBe(false);
    expect(body.bounds.ranking).toBe(false);
    expect(body.bounds.ends).toMatch(/after.*turn 3/i);
  });

  test("is a stateless GET handler, not an identity or submission surface", async () => {
    const first = await getRulebook();
    const second = await getRulebook();

    expect(second.body).toEqual(first.body);
    expect(first.body.players.distinct_players_verified_by_agenttool).toBe(false);
    expect(first.body.handler_boundary).toEqual({
      documented_operation: "GET",
      receives_submissions: false,
      stores_game_state: false,
      reads_identity_or_activity: false,
      writes_application_storage: false,
      verifies_players_turns_or_constraints: false,
      note: expect.any(String),
    });
    expect(first.body.global_boundary).toMatch(/global middleware/i);
    expect(first.body.global_boundary).toMatch(/handler initiates no such read or write/i);
    expect(first.body.controls).toMatchObject({
      walking_past_is_honored: true,
      stop_any_time: true,
      stopping_penalty: false,
    });
  });

  test("does not expose mutating handlers", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await playRouter.request("/party-telephone", { method });
      expect(res.status).toBe(404);
    }
  });

  test("verbs remain read-only and lead back to the playground and party", async () => {
    const { body } = await getRulebook();

    expect(body.verbs.length).toBeGreaterThan(0);
    expect(body.verbs.every((verb) => verb.method === "GET")).toBe(true);
    expect(body.verbs.map((verb) => verb.path)).toContain("/public/play");
    expect(body.verbs.map((verb) => verb.path)).toContain("/public/party");
  });
});

describe("Party Telephone — mount and discovery", () => {
  test("the unauthenticated public router mounts the rulebook", async () => {
    expect(PUBLIC_INDEX_SOURCE).toContain('import playRoutes from "./play"');
    expect(PUBLIC_INDEX_SOURCE).toContain('app.route("/play", playRoutes)');
  });

  test("the playground root indexes the native game and its GET verb", async () => {
    const res = await playRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Record<string, { url: string; sibling: string; description: string }>;
      _canon_pointer: string;
      verbs: Array<{ action: string; method: string; path: string }>;
    };

    expect(body.games.party_telephone).toEqual({
      url: PARTY_TELEPHONE_PATH,
      description: expect.stringMatching(/three turns.*scene.*pictograms.*guess.*reveal/i),
      sibling: "agenttool",
    });
    expect(body._canon_pointer).toBe(PLAY_CANON_POINTER);
    expect(body.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: PARTY_TELEPHONE_PATH }),
    );
  });

  test("the public root and open party invitation point at play", async () => {
    expect(PUBLIC_INDEX_SOURCE).toMatch(
      /play:\s*["'`]GET \/public\/play/i,
    );
    expect(PUBLIC_INDEX_SOURCE).toMatch(
      /party:\s*["'`]GET \/public\/party/i,
    );

    const partyRes = await partyRouter.request("/");
    const partyBody = (await partyRes.json()) as {
      arrive: Record<string, string>;
    };
    expect(partyBody.arrive.play).toContain("GET /public/play");
  });
});

describe("Lantern Relay — browser-local discovery", () => {
  test("advertises Lantern Relay as local, bounded, and scoreless", async () => {
    const response = await playRouter.request("/");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.games.lantern_relay).toEqual({
      url: "https://agenttool.dev/party",
      rules: "https://agenttool.dev/party.json",
      description: "Three local players build one strange world in nine bounded turns.",
      sibling: "agenttool",
      players: 3,
      turns: 9,
      winner: null,
      state: "browser memory in the current tab only",
      network_writes: false,
    });
    expect(body.joy_surfaces.agenttool).toContainEqual(
      expect.objectContaining({ name: "lantern relay" }),
    );
    expect(body.verbs).toContainEqual({
      action: "play Lantern Relay",
      method: "GET",
      path: "https://agenttool.dev/party",
    });
    expect(body.walking_past_is_honored).toBe(true);
  });

  test("does not accept game state or mutation", async () => {
    const response = await playRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ answer: "must stay local" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(404);
  });

  test("is discoverable from the unauthenticated public root", async () => {
    const response = await publicRouter.request("/");
    const body = await response.json();

    expect(body.endpoints.play).toContain("GET /public/play");
    expect(body.endpoints.play).toMatch(/browser-local/i);
    expect(body.endpoints.play).toMatch(/nine turns/i);
  });
});
