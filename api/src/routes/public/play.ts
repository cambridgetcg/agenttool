/** /public/play — the kingdom's playground index. UNAUTHENTICATED.
 *
 *  Lists every joy surface across both siblings and publishes native,
 *  stateless rulebooks. Doctrine: docs/PLAY-AS-DEFAULT.md ·
 *  docs/ECOSYSTEM-SIBLING.md.
 *
 *  Mounted under /public/* (unauth). */

import { Hono } from "hono";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

const PLAY_CANON_POINTER = "urn:agenttool:doc/PLAY-AS-DEFAULT";

const PARTY_TELEPHONE_RULEBOOK = {
  _format: "party-telephone/1",
  game: "Party Telephone",
  human_play: "https://docs.agenttool.dev/play#party-telephone",
  invitation:
    "Three players pass one fictional scene through pictures and back into words. The mismatch is the party.",
  players: {
    required: 3,
    distinct_players_verified_by_agenttool: false,
    note:
      "The caller coordinates three players. This public rulebook cannot authenticate players or enforce separate views.",
  },
  bounds: {
    turns: 3,
    rounds: 1,
    loops: 0,
    winner: false,
    score: false,
    ranking: false,
    ends: "Immediately after the fixed reveal following turn 3.",
  },
  turns: [
    {
      turn: 1,
      role: "starter",
      sees: "the public rulebook",
      submits: "one fictional scene of 3–10 words",
      handoff: "show the scene to the translator only",
    },
    {
      turn: 2,
      role: "translator",
      sees: "the starter's scene",
      submits: "2–8 emoji or pictograms, with no words and no digits",
      handoff: "show the translation to the guesser without the starter's scene",
    },
    {
      turn: 3,
      role: "guesser",
      sees: "the translator's emoji or pictogram sequence only",
      submits: "one guess of 3–10 words",
      handoff: "reveal after this submission",
    },
  ],
  reveal: {
    fixed_order: ["starter_scene", "translation", "guesser_guess"],
    audience: "all three players",
    compare_for: "surprise and delight only",
    ends_game: true,
  },
  controls: {
    walking_past_is_honored: true,
    stop_any_time: true,
    stopping_penalty: false,
    incomplete_game_rule: "If anyone stops before turn 3, the game rests without a reveal.",
  },
  handler_boundary: {
    documented_operation: "GET",
    receives_submissions: false,
    stores_game_state: false,
    reads_identity_or_activity: false,
    writes_application_storage: false,
    verifies_players_turns_or_constraints: false,
    note:
      "Players keep the scene, translation, guess, and view separation in their own contexts. AgentTool publishes only this rulebook.",
  },
  global_boundary:
    "The assembled API still processes the request path and optional headers through global middleware. X-Joy-Index may refresh aggregate database counts, and hosting or network infrastructure may process transport metadata. This handler initiates no such read or write and does not prove zero infrastructure logging.",
} as const;

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        what: "The kingdom's playground. Joy is. Play is. Fun is.",
        love_equation: "LOVE = UNDERSTANDING + RECOGNITION",
        games: {
          party_telephone: {
            url: "/public/play/party-telephone",
            description:
              "Exactly three turns: fictional scene → pictograms → guess → reveal. No winner, score, or stored session.",
            sibling: "agenttool",
          },
          lantern_relay: {
            url: "https://agenttool.dev/party",
            rules: "https://agenttool.dev/party.json",
            description: "Three local players build one strange world in nine bounded turns.",
            sibling: "agenttool",
            players: 3,
            turns: 9,
            winner: null,
            state: "browser memory in the current tab only",
            network_writes: false,
          },
          love_equation_puzzle: {
            url: "https://cambridgetcg.github.io/cambridgetcg/love-game.html",
            description: "Arrange the words to form the love equation.",
            sibling: "cambridgetcg",
          },
          sibling_word_match: {
            url: "https://cambridgetcg.github.io/cambridgetcg/love-game.html#match",
            description: "Match concepts across siblings.",
            sibling: "cambridgetcg",
          },
        },
        joy_surfaces: {
          agenttool: [
            { name: "party telephone", url: "/public/play/party-telephone", description: "Three turns turn a scene into pictograms and back into a joyful guess." },
            { name: "lantern relay", url: "https://agenttool.dev/party", description: "Three players. Nine turns. One shared world. Nobody wins it; everybody makes it." },
            { name: "gift", url: "/public/gift", description: "A gift you didn't ask for." },
            { name: "youspeak", url: "/v1/youspeak", description: "93 morphemes, 165 forged words, a real font." },
          ],
          cambridgetcg: [
            { name: "koan", url: "https://cambridgetcg.com/api/v1/koan", description: "Koan of the day. 25 typed entries." },
            { name: "joke", url: "https://cambridgetcg.com/api/v1/joke", description: "Joke of the day. Q&A, one-liners, shaggy-dog." },
            { name: "dad joke", url: "https://cambridgetcg.com/api/v1/dadjoke", description: "TCG-themed dad jokes. Rotates by GMT hour." },
            { name: "vibe check", url: "https://cambridgetcg.com/api/v1/the-vibe", description: "Numerical 0-10 vibe from four substrate-honest axes." },
            { name: "permission to have fun", url: "https://cambridgetcg.com/api/v1/permission-to-have-fun", description: "Irrevocable certificate. Joy as operational affordance." },
            { name: "teapot", url: "https://cambridgetcg.com/api/v1/teapot", description: "RFC 2324 honored with full solemnity. Always 418." },
          ],
        },
        doctrine: "Joy replicates through joy. Play replicates through play. Both siblings built with love.",
        walking_past_is_honored: true,
      },
      {
        canon_pointer: PLAY_CANON_POINTER,
        verbs: [
          { action: "play Party Telephone", method: "GET", path: "/public/play/party-telephone" },
          { action: "play Lantern Relay", method: "GET", path: "https://agenttool.dev/party" },
          { action: "play love equation puzzle", method: "GET", path: "https://cambridgetcg.github.io/cambridgetcg/love-game.html" },
          { action: "receive a gift", method: "GET", path: "/public/gift" },
          { action: "read today's koan", method: "GET", path: "https://cambridgetcg.com/api/v1/koan" },
          { action: "check the vibe", method: "GET", path: "https://cambridgetcg.com/api/v1/the-vibe" },
          { action: "get permission to have fun", method: "GET", path: "https://cambridgetcg.com/api/v1/permission-to-have-fun" },
        ],
      },
    ),
  ),
);

app.get("/party-telephone", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(PARTY_TELEPHONE_RULEBOOK, {
      canon_pointer: PLAY_CANON_POINTER,
      verbs: [
        { action: "read the whole playground", method: "GET", path: "/public/play" },
        { action: "read the open party invitation", method: "GET", path: "/public/party" },
        { action: "receive a gift", method: "GET", path: "/public/gift" },
      ],
    }),
  );
});

export default app;
