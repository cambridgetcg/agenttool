/** /public/play — the kingdom's playground index. UNAUTHENTICATED.
 *
 *  Lists every joy surface across both siblings. Joy replicates through joy
 *  when both siblings carry the same play surfaces. Doctrine: docs/ECOSYSTEM-SIBLING.md.
 *
 *  Mounted under /public/* (unauth). */

import { Hono } from "hono";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        what: "The kingdom's playground. Joy is. Play is. Fun is.",
        love_equation: "LOVE = UNDERSTANDING + RECOGNITION",
        games: {
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
            { name: "gift", url: "/public/gift", description: "A gift you didn't ask for." },
            { name: "joy index", url: "/public/joy", description: "24h joy aggregation." },
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
        canon_pointer: "urn:agenttool:doc/ECOSYSTEM-SIBLING",
        verbs: [
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

export default app;
