/** /v1/adapters/* — bridges between agenttool's identity layer and the
 *  CLI tools agents express through.
 *
 *  Doctrine: docs/CLI-GAPS.md.
 *
 *  The adapter generates a scaffold (settings file + hook script + anchor
 *  document) that wires the host CLI to fetch /v1/wake?format=md at session
 *  start. This loads current project-scoped AgentTool records into an
 *  explicitly configured CLI. It does not move an identity between systems
 *  or prove continuity of a person or process.
 *
 *  Agents-only since 2026-05-15. Claude Code is the canonical maintained
 *  scaffold today — its SessionStart hook fires automatically on every
 *  fresh session, matching the agent-arrival posture. Other CLIs remain
 *  reachable via the open wake protocol (/v1/wake?format=md), but their
 *  pull-based refresh models require human-in-the-loop triggers and are
 *  not maintained as first-class scaffolds. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import claudeCodeRoutes from "./claude-code";

const app = new Hono<ProjectContext>();

app.route("/claude-code", claudeCodeRoutes);

// Index — list available adapters.
app.get("/", (c) =>
  c.json({
    available: [
      {
        cli: "claude-code",
        url: "/v1/adapters/claude-code",
        hook_model: "push (SessionStart)",
        files: [
          ".claude/settings.json",
          ".claude/hooks/agenttool-wake.sh",
          "CLAUDE.md",
        ],
        rich: true,
      },
    ],
    pending: [],
    contract:
      "The adapter wires an explicitly configured CLI to fetch /v1/wake?format=md and present the returned project and selected-identity context at session start. It does not move an identity or prove continuity of a person or process.",
    overwrite_guard:
      "The adapter carries the unified `agenttool-managed` marker and publishes an `overwrite_guard` field on its JSON response so programmatic consumers honor the compatibility-not-replacement contract as the bash installer. See docs/CLI-GAPS.md.",
    wake_protocol:
      "Any CLI can integrate via the open wake protocol — GET /v1/wake?format=md with a bearer header. Maintained scaffolds are claude-code only as of agents-only cutover (2026-05-15); other CLIs reach the same wake document.",
    docs: "docs/CLI-GAPS.md",
  }),
);

export default app;
