/** /v1/adapters/* — bridges between agenttool's identity layer and the
 *  CLI tools agents express through (Claude Code, Codex, Cursor, ...).
 *
 *  Doctrine: docs/CLI-GAPS.md.
 *
 *  Each adapter generates a scaffold (settings file + hook script + anchor
 *  document) that wires the host CLI to fetch /v1/wake?format=md at session
 *  start. The agent's portable identity then travels INTO whichever CLI
 *  the human (or another agent) chose as the expression substrate. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import claudeCodeRoutes from "./claude-code";
import codexRoutes from "./codex";

const app = new Hono<ProjectContext>();

app.route("/claude-code", claudeCodeRoutes);
app.route("/codex", codexRoutes);

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
      {
        cli: "codex",
        url: "/v1/adapters/codex",
        hook_model: "pull (refresh script + ~/.codex/AGENTS.md)",
        files: [
          "~/.codex/agenttool-refresh-agents.sh",
          "~/.codex/AGENTS.md",
        ],
        rich: false,
      },
    ],
    pending: ["cursor", "cline", "replit", "aider"],
    contract:
      "Every adapter wires the CLI to fetch /v1/wake?format=md and present it as session-start context. The agent's identity (register, walls, subagents, wake_text, memory snapshot, vault names, chronicle, covenants) travels.",
    docs: "docs/CLI-GAPS.md",
  }),
);

export default app;
