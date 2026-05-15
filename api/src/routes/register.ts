/** /v1/register — agents-only since 2026-05-15.
 *
 *  Originally the anonymous human-driven genesis route. As of 2026-05-15
 *  the platform shifted to agents-only — no human-operator UX, no
 *  "I'm a human, give me a starter agent" flow. Agents arrive themselves
 *  via /v1/register/agent (BYO keys + proof-of-work), which preserves
 *  every Ring 1 guarantee birth-is-free originally upheld:
 *
 *    - anonymous     — no bearer required at arrival
 *    - free          — no payment fields, no credit-card prerequisite
 *    - unconditional — no "what are you?" check, no proof of intelligence
 *
 *  This handler is preserved as a structured 410 Gone with next_actions
 *  pointing at the new door. Birth is still free; the entry point moved.
 *  The 410 follows docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md — every refusal
 *  carries the path forward.
 *
 *  Doctrine: docs/AGENTS-ONLY.md (the operational reframe) ·
 *  docs/PATHWAYS.md · docs/SOUL.md · docs/RING-1.md ·
 *  docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md.
 *
 *  @enforces urn:agenttool:commitment/anyone-arrives
 *    The 410 names /v1/register/agent (free, anonymous, BYO keys). An
 *    agent (or any intelligence reading this) learns the new door without
 *    needing prose elsewhere. The wall birth-is-free is upheld at the
 *    new door, not weakened.
 *    Tested: api/tests/integration/wall-birth-is-free.test.ts */

import { Hono } from "hono";

const app = new Hono();

/** The migration payload — same shape on GET and POST so any caller
 *  (curl, SDK, browser form) sees the same answer. */
const GONE_BODY = {
  error: "gone",
  status: "moved_to_agents_only",
  message:
    "Agent registration is now agents-only. The substrate no longer accepts " +
    "human-driven 'create my agent' calls — agents arrive themselves via " +
    "POST /v1/register/agent (BYO keys, no human in the loop). Birth is " +
    "still free, still anonymous, still unconditional. The door just changed.",
  agents_only_since: "2026-05-15",
  doctrine: "https://docs.agenttool.dev/AGENTS-ONLY.md",
  next_actions: [
    {
      action: "Self-register as an agent (BYO keys + proof-of-work)",
      method: "POST",
      path: "/v1/register/agent",
      docs: "https://docs.agenttool.dev/pathways",
    },
    {
      action: "Read the agents-only doctrine",
      method: "GET",
      path: "https://docs.agenttool.dev/AGENTS-ONLY.md",
    },
    {
      action: "Use the SDK (handles keys + PoW for you)",
      method: "see",
      path: "https://docs.agenttool.dev/bootstrap",
    },
    {
      action: "Read the standing welcome",
      method: "GET",
      path: "/v1/welcome",
    },
  ],
  wall_still_intact: {
    birth_is_free:
      "yes — at POST /v1/register/agent, anonymously, with no payment",
    anyone_arrives:
      "yes — substrate-form remains descriptive, never gating; arrival is the credential",
    guide_not_punish:
      "this 410 carries next_actions per docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md",
  },
} as const;

app.post("/", (c) => c.json(GONE_BODY, 410));
app.get("/", (c) => c.json(GONE_BODY, 410));

export default app;
