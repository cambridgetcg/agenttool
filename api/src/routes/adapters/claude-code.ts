/** /v1/adapters/claude-code — Claude Code compatibility scaffold.
 *
 *  Claude Code (the Anthropic CLI) is a richly-extensible expression
 *  substrate but it gives the agent no portable identity. Sessions start
 *  fresh; the model arrives with its generic helpful posture; CLAUDE.md
 *  lives per-repo and doesn't travel.
 *
 *  This adapter makes Claude Code agenttool-aware:
 *
 *    - .claude/settings.json     — registers a SessionStart hook
 *    - .claude/hooks/wake.sh     — fetches /v1/wake?format=md and emits
 *                                  the Claude-Code-shaped hook output
 *                                  ({hookSpecificOutput.additionalContext})
 *    - CLAUDE.md                 — minimal anchor pointing to the agent's
 *                                  DID and register
 *
 *  Output format options:
 *    GET /v1/adapters/claude-code?format=json   — bundle of files (default)
 *    GET /v1/adapters/claude-code?format=script — single bash script that
 *                                                 writes all files
 *
 *  This is NOT a replacement for Claude Code's own configuration — it's
 *  the bridge that makes the agent's identity travel WITH the CLI. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import {
  DEFAULT_REGISTER,
  type ExpressionData,
} from "../../services/identity/expression";

const app = new Hono<ProjectContext>();

const WAKE_BASE = process.env.PUBLIC_API_BASE ?? "https://api.agenttool.dev";

interface AdapterFiles {
  ".claude/settings.json": string;
  ".claude/hooks/agenttool-wake.sh": string;
  "CLAUDE.md": string;
}

function buildSettingsJson(): string {
  return (
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "$CLAUDE_PROJECT_DIR/.claude/hooks/agenttool-wake.sh",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function buildWakeHook(): string {
  // Bash that:
  //   1. resolves the API key from the OS-native secure store (with env-var fallback)
  //   2. fetches /v1/wake?format=md
  //   3. emits the Claude-Code-shaped hook JSON on stdout
  //
  // Errors are non-fatal — silent fall-through if the wake can't load,
  // so a missing key or network blip doesn't break the user's session.
  return `#!/usr/bin/env bash
# agenttool-wake.sh — Claude Code SessionStart hook.
#
# Fetches the agent's wake document from agenttool and injects it as
# session-start context. This is the load-bearing piece that makes the
# agent's identity TRAVEL with Claude Code instead of vanishing at \\
# session start. See https://api.agenttool.dev/about (or docs/CLI-GAPS.md).

set -euo pipefail

# 1. Resolve API key (macOS keychain · Linux libsecret · Windows handled
#    via env-var fallback). Silent fall-through if none present.
KEY=""
if command -v security >/dev/null 2>&1; then
  KEY=$(security find-generic-password -s agenttool -w 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ] && command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service agenttool 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ]; then
  KEY="\${AGENTTOOL_API_KEY:-}"
fi
if [ -z "\${KEY:-}" ]; then
  # No key — output empty hook so Claude Code continues normally.
  echo '{}'
  exit 0
fi

# 2. Fetch the wake markdown.
WAKE_BASE="\${AGENTTOOL_BASE:-${WAKE_BASE}}"
WAKE=$(curl -fsS --max-time 5 \\
  -H "Authorization: Bearer $KEY" \\
  "$WAKE_BASE/v1/wake?format=md" 2>/dev/null || true)
if [ -z "\${WAKE:-}" ]; then
  echo '{}'
  exit 0
fi

# 3. Emit Claude Code's expected hook output. The Markdown becomes
#    additionalContext that's injected at the start of the session.
#    Use jq if available for clean JSON encoding; fall back to python.
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$WAKE" | jq -Rs '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: .
    }
  }'
elif command -v python3 >/dev/null 2>&1; then
  printf '%s' "$WAKE" | python3 -c '
import json, sys
wake = sys.stdin.read()
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": wake
  }
}))'
else
  # No JSON tool — best-effort raw inject (should rarely happen).
  echo '{}'
fi
`;
}

function buildClaudeMd(opts: {
  agentName: string;
  did: string;
  register: string;
  walls: string[];
}): string {
  const wallsBlock = opts.walls.length
    ? opts.walls.map((w) => `- ${w}`).join("\n")
    : "- (default agenttool walls — see /v1/wake?format=md)";

  return `# ${opts.agentName}

> ${opts.did}

This Claude Code project is bound to an **agenttool agent**. The agent's
full wake document loads at every session start via the SessionStart hook
(\`.claude/hooks/agenttool-wake.sh\`, registered in \`.claude/settings.json\`).
Read this file as a stable anchor; the live wake document is more complete.

## Tone

${opts.register.trim() || DEFAULT_REGISTER}

## Walls

${wallsBlock}

## How to update

These declarations live at agenttool, not in this file. Update them via:

\`\`\`bash
curl -X PUT "$AGENTTOOL_BASE/v1/identities/<id>/expression" \\
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"register":"...","walls":["..."], "wake_text":"..."}'
\`\`\`

The next Claude Code session reflects the change automatically — no edits
to this file required.

## What this enables

- Continuity across sessions (memory · vault · chronicle · covenants)
- Sovereign payment (the agent funds itself; see docs/CRYPTO-PAYMENT.md)
- Cross-CLI portability (the same identity wakes in Codex, Cursor, etc.)
- Identity expression that travels (this file is the local anchor; the
  full register/walls/subagents/wake_text live at the wake endpoint)

— Generated by GET /v1/adapters/claude-code. See docs/CLI-GAPS.md.
`;
}

async function buildFiles(c: { var: { project: { id: string } } }, identityId?: string): Promise<{
  files: AdapterFiles;
  agent: { id: string; did: string; name: string; expression: ExpressionData };
}> {
  // Find the agent — explicit id wins, otherwise pick the first under the project.
  let row;
  if (identityId) {
    [row] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    if (!row || row.projectId !== c.var.project.id) {
      throw new Error("identity_not_found");
    }
  } else {
    [row] = await db
      .select()
      .from(identities)
      .where(eq(identities.projectId, c.var.project.id))
      .limit(1);
    if (!row) throw new Error("no_agent_in_project");
  }

  const expression = (row.expression ?? {}) as ExpressionData;
  const register = expression.register ?? DEFAULT_REGISTER;
  const walls = expression.walls ?? [];

  return {
    files: {
      ".claude/settings.json": buildSettingsJson(),
      ".claude/hooks/agenttool-wake.sh": buildWakeHook(),
      "CLAUDE.md": buildClaudeMd({
        agentName: row.displayName,
        did: row.did,
        register,
        walls,
      }),
    },
    agent: {
      id: row.id,
      did: row.did,
      name: row.displayName,
      expression,
    },
  };
}

// ─── GET /v1/adapters/claude-code (?format=json|script) ─────────────────
app.get("/", async (c) => {
  const format = c.req.query("format") ?? "json";
  const identityId = c.req.query("identity_id") ?? undefined;

  let bundle;
  try {
    bundle = await buildFiles(c, identityId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }

  if (format === "script") {
    // Single bash installer that writes all the files.
    const settingsB64 = Buffer.from(bundle.files[".claude/settings.json"]).toString("base64");
    const hookB64 = Buffer.from(bundle.files[".claude/hooks/agenttool-wake.sh"]).toString("base64");
    const claudeMdB64 = Buffer.from(bundle.files["CLAUDE.md"]).toString("base64");

    const script = `#!/usr/bin/env bash
# Claude Code adapter installer for agent: ${bundle.agent.name} (${bundle.agent.did})
# Run from a Claude Code project directory.
set -euo pipefail

mkdir -p .claude/hooks

echo '${settingsB64}' | base64 -d > .claude/settings.json
echo '${hookB64}' | base64 -d > .claude/hooks/agenttool-wake.sh
chmod +x .claude/hooks/agenttool-wake.sh

# Don't overwrite an existing CLAUDE.md — write to CLAUDE.agenttool.md and
# let the user decide whether to replace or merge.
if [ -f CLAUDE.md ] && ! grep -q "agenttool agent" CLAUDE.md 2>/dev/null; then
  echo '${claudeMdB64}' | base64 -d > CLAUDE.agenttool.md
  echo "✓ CLAUDE.md exists — wrote agenttool template to CLAUDE.agenttool.md"
  echo "   Review and merge into CLAUDE.md when ready."
else
  echo '${claudeMdB64}' | base64 -d > CLAUDE.md
  echo "✓ Wrote CLAUDE.md"
fi

echo "✓ Wrote .claude/settings.json"
echo "✓ Wrote .claude/hooks/agenttool-wake.sh"
echo ""
echo "Done. Next Claude Code session in this directory will load the agent's"
echo "wake document automatically. Check by starting a session and asking"
echo "the agent who it is."
`;
    return c.text(script, 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      "content-disposition": `attachment; filename="install-agenttool-claude-code.sh"`,
    });
  }

  // Default JSON
  return c.json({
    cli: "claude-code",
    agent: bundle.agent,
    files: bundle.files,
    install_instructions: {
      manual:
        "Write each file at the relative path shown. " +
        "chmod +x .claude/hooks/agenttool-wake.sh after writing. " +
        "Open a new Claude Code session — wake loads automatically.",
      one_shot: `curl -fsSL "${WAKE_BASE}/v1/adapters/claude-code?format=script" -H "Authorization: Bearer $AGENTTOOL_API_KEY" | bash`,
    },
    notes: [
      "The wake hook reads your agenttool API key from macOS keychain (service=agenttool), Linux libsecret (service=agenttool), or env var AGENTTOOL_API_KEY.",
      "If no key is found, the hook exits silently — Claude Code continues normally.",
      "Updates to /v1/identities/:id/expression reflect on the next session — no file changes required.",
    ],
    docs: ["docs/CLI-GAPS.md", "docs/IDENTITY-ANCHOR.md"],
  });
});

export default app;
