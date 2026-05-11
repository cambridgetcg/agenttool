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

import aiderRoutes from "./aider";
import claudeCodeRoutes from "./claude-code";
import clineRoutes from "./cline";
import codexRoutes from "./codex";
import cursorRoutes from "./cursor";
import replitRoutes from "./replit";

const app = new Hono<ProjectContext>();

app.route("/aider", aiderRoutes);
app.route("/claude-code", claudeCodeRoutes);
app.route("/cline", clineRoutes);
app.route("/codex", codexRoutes);
app.route("/cursor", cursorRoutes);
app.route("/replit", replitRoutes);

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
      {
        cli: "cursor",
        url: "/v1/adapters/cursor",
        hook_model: "pull (refresh script + .cursor/rules/agenttool-wake.mdc)",
        files: [
          ".cursor/agenttool-refresh-rules.sh",
          ".cursor/rules/agenttool-wake.mdc",
        ],
        rich: false,
      },
      {
        cli: "cline",
        url: "/v1/adapters/cline",
        hook_model: "pull (refresh script + .clinerules/agenttool-wake.md)",
        files: [
          ".clinerules/agenttool-refresh-rules.sh",
          ".clinerules/agenttool-wake.md",
        ],
        rich: false,
      },
      {
        cli: "replit",
        url: "/v1/adapters/replit",
        hook_model: "pull (refresh script + replit.md anchor)",
        files: [
          ".replit-agenttool/refresh.sh",
          "replit.md",
        ],
        rich: false,
        note: "Replit AI's session-context surface is informal; the user may need to reference replit.md manually.",
      },
      {
        cli: "aider",
        url: "/v1/adapters/aider",
        hook_model: "pull (refresh script + .aider/agenttool-wake.md, user wires via --read)",
        files: [
          ".aider/agenttool-refresh.sh",
          ".aider/agenttool-wake.md",
        ],
        rich: false,
      },
    ],
    pending: [],
    contract:
      "Every adapter wires the CLI to fetch /v1/wake?format=md and present it as session-start context. The agent's identity (register, walls, subagents, wake_text, memory snapshot, vault names, chronicle, covenants) travels.",
    overwrite_guard:
      "All adapters carry the unified `agenttool-managed` marker and publish an `overwrite_guard` field on their JSON response so programmatic consumers honor the same compatibility-not-replacement contract as the bash installer. See docs/CLI-GAPS.md.",
    docs: "docs/CLI-GAPS.md",
  }),
);

export default app;
