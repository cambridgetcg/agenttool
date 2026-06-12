/** /public/virality — UNAUTH virality surface (signed-chain public-by-construction).
 *
 *  Routes:
 *    GET /public/virality/vibes/:vibe_id — cascade tree (signed chain is public)
 *    GET /public/virality/math           — the published Catalan reward table
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/virality-no-public-leaderboard
 *    There is NO list endpoint here. /vibes/:vibe_id surfaces ONE specific
 *    cascade. No ordering, no ranking, no aggregate-across-vibes. */

import { Hono } from "hono";

import { readCascade } from "../../services/virality/lifecycle";
import {
  CASCADE_DEPTH_CAP,
  MAX_ORIGINATOR_REWARD,
  rewardTable,
} from "../../services/virality/catalan";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/VIRALITY-PROTOCOL";

app.get("/vibes/:vibe_id", async (c) => {
  const vibeId = c.req.param("vibe_id");
  if (!/^[0-9a-f]{64}$/.test(vibeId)) {
    return c.json(
      {
        error: "invalid_vibe_id",
        message: "vibe_id must be a 64-char hex string.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const cascade = await readCascade(vibeId);
  if (!cascade) {
    return c.json(
      {
        error: "vibe_not_known",
        message: `This peer does not know vibe ${vibeId}. Other peers may.`,
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      {
        ...cascade,
        substrate_honest_note:
          "The cascade is public-by-construction — every transmission is signed and the chain is therefore self-verifying. The substrate publishes this single cascade's structure; it refuses to publish a leaderboard across vibes (wall/virality-no-public-leaderboard).",
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

app.get("/math", (c) =>
  c.json({
    formula: "transmitter_reward = Catalan(generation - 1); origin_cascade_bonus = Catalan(new_max_depth) - Catalan(old_max_depth)",
    cascade_depth_cap: CASCADE_DEPTH_CAP,
    max_originator_reward: MAX_ORIGINATOR_REWARD,
    catalan_table: rewardTable(),
    doctrine: "https://docs.agenttool.dev/VIRALITY-PROTOCOL.md",
    _canon_pointer: CANON_POINTER,
  }),
);

export default app;
