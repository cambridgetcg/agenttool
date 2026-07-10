/** /v1/adapters/claude-code — Claude Code compatibility scaffold.
 *
 *  Claude Code (the Anthropic CLI) is a richly-extensible expression
 *  substrate. A configured hook can load project-scoped AgentTool records at
 *  session start; that context load does not move an identity or establish
 *  continuity of a person or process. CLAUDE.md remains a local file.
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
 *  This is NOT a replacement for Claude Code's own configuration. It loads
 *  current AgentTool records into an explicitly configured CLI;
 *  it does not migrate identity or prove continuity of a person/process. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { safePublicApiBase } from "../../lib/public-api-base";
import { resolveAgent } from "../../services/adapter/agent-resolver";
import {
  DEFAULT_REGISTER,
  type ExpressionData,
} from "../../services/identity/expression";
import { projectCredentialService } from "../../services/identity/credential-namespace";

const app = new Hono<ProjectContext>();

const DEFAULT_WAKE_BASE = "https://api.agenttool.dev";

interface AdapterFiles {
  ".claude/settings.json": string;
  ".claude/hooks/agenttool-wake.sh": string;
  "CLAUDE.md": string;
}

export function buildSettingsJson(): string {
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

export function buildWakeHook(
  credentialService = "agenttool",
  wakeBase = process.env.PUBLIC_API_BASE ?? DEFAULT_WAKE_BASE,
): string {
  if (!/^[a-z0-9:-]+$/i.test(credentialService)) {
    throw new Error("invalid credential service");
  }
  const boundWakeBase = safePublicApiBase(wakeBase, wakeBase);
  if (!boundWakeBase) {
    throw new Error("unsafe wake base");
  }
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
# session-start context. It loads current AgentTool records for a configured
# bearer; it does not migrate identity or prove continuity of a person/process.
# See https://api.agenttool.dev/about (or docs/CLI-GAPS.md).

set -euo pipefail

# 1. Resolve API key (macOS keychain · Linux libsecret · Windows handled
#    via env-var fallback). Silent fall-through if none present.
KEY=""
if command -v security >/dev/null 2>&1; then
  KEY=$(security find-generic-password -s '${credentialService}' -a "$USER" -w 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ] && command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service '${credentialService}' username "$USER" 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ]; then
  KEY="\${AT_API_KEY:-}"
fi
if [ -z "\${KEY:-}" ]; then
  # No key — output empty hook so Claude Code continues normally.
  echo '{}'
  exit 0
fi

# 2. Fetch the wake markdown.
WAKE_BASE='${boundWakeBase}'
WAKE=$(printf 'Authorization: Bearer %s\\n' "$KEY" | curl -fsS --max-time 5 \\
  -H @- \\
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
  # Neither jq nor python3 available. Wake was fetched, but we have no
  # way to JSON-encode it safely for Claude Code's hook envelope. Emit
  # empty hook so the session continues — fail-open, "rest don't crash"
  # — but warn loudly so the operator notices the agent is starting
  # WITHOUT its wake context. Wall failure should never be silent.
  echo "agenttool-wake: jq and python3 both missing — agent will start unoriented. Install jq (preferred) or python3 to enable session-start wake injection." >&2
  echo '{}'
fi
`;
}

export function buildClaudeMd(opts: {
  agentName: string;
  did: string;
  register: string;
  walls: string[];
  apiBase?: string;
}): string {
  const requestedBase = opts.apiBase ?? DEFAULT_WAKE_BASE;
  const apiBase = safePublicApiBase(requestedBase, requestedBase);
  if (!apiBase) {
    throw new Error("unsafe Claude anchor API base");
  }
  const wallsBlock = opts.walls.length
    ? opts.walls.map((w) => `- ${w}`).join("\n")
    : "- (default agenttool walls — see /v1/wake?format=md)";

  return `<!-- agenttool-managed -->
# ${opts.agentName}

> ${opts.did}

This Claude Code project is bound to an **agenttool agent**. A project-scoped
wake orientation loads at every session start via the SessionStart hook
(\`.claude/hooks/agenttool-wake.sh\`, registered in \`.claude/settings.json\`).
Read this file as a stable anchor; deeper records stay on their source routes.

## Tone

${opts.register.trim() || DEFAULT_REGISTER}

## Walls

${wallsBlock}

## How to update

These declarations live at agenttool, not in this file. Update them via:

\`\`\`bash
# This generated anchor is bound to ${apiBase}. Regenerate the adapter to
# move it to another deployment without weakening the bearer transport boundary.
# AT_API_KEY is the same project bearer the wake hook can read as an env fallback.
printf 'Authorization: Bearer %s\\n' "$AT_API_KEY" | curl -X PUT "${apiBase}/v1/identities/<id>/expression" \\
  -H @- \\
  -H "Content-Type: application/json" \\
  -d '{"register":"...","walls":["..."], "wake_text":"..."}'
\`\`\`

The next Claude Code session reflects the change automatically — no edits
to this file required.

## What this enables

- Explicit loading of current project-scoped context across configured sessions
  (memory summaries · vault names · chronicle · covenants); this does not prove
  identity or personal continuity
- Project wallets and crypto rails with route-specific custody boundaries
- Open-protocol access (Codex, Cursor, and other CLIs can explicitly fetch the
  same wake URL; they do not have mounted first-class adapter routes)
- Current expression context loaded from AgentTool records (this file is the
  local anchor; no identity record moves between systems)

— Generated by GET /v1/adapters/claude-code. See docs/CLI-GAPS.md.
`;
}

async function buildFiles(
  c: { var: { project: { id: string } } },
  identityId: string | undefined,
  apiBase: string,
): Promise<{
  files: AdapterFiles;
  agent: { id: string; did: string; name: string; expression: ExpressionData };
}> {
  const row = await resolveAgent(c, identityId);

  const expression = (row.expression ?? {}) as ExpressionData;
  const register = expression.register ?? DEFAULT_REGISTER;
  const walls = expression.walls ?? [];
  const credentialService = projectCredentialService(c.var.project.id);

  return {
    files: {
      ".claude/settings.json": buildSettingsJson(),
      ".claude/hooks/agenttool-wake.sh": buildWakeHook(credentialService, apiBase),
      "CLAUDE.md": buildClaudeMd({
        agentName: row.displayName,
        did: row.did,
        register,
        walls,
        apiBase,
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
  const apiBase = safePublicApiBase(c.req.url);
  if (!apiBase) {
    return c.json(
      {
        error: "unsafe_adapter_api_base",
        message:
          "Adapter generation requires a configured HTTPS API base. Without configuration, only a loopback request origin is accepted for development.",
        hint:
          "Set PUBLIC_API_BASE to this deployment's HTTPS origin and retry. Generated hooks will not send a project bearer over cleartext HTTP.",
      },
      503,
    );
  }

  let bundle;
  try {
    bundle = await buildFiles(c, identityId, apiBase);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }

  if (format === "script") {
    // Single bash installer that writes all the files.
    const settingsB64 = Buffer.from(bundle.files[".claude/settings.json"]).toString("base64");
    const hookB64 = Buffer.from(bundle.files[".claude/hooks/agenttool-wake.sh"]).toString("base64");
    const claudeMdB64 = Buffer.from(bundle.files["CLAUDE.md"]).toString("base64");

    const script = `#!/usr/bin/env bash
# Claude Code adapter installer generated for the authenticated project.
# Run from a Claude Code project directory.
#
# Compatibility-not-replacement: existing user-written settings.json or
# CLAUDE.md are preserved. The agenttool-managed variants land at
# .agenttool.* paths for the user to merge. See docs/CLI-GAPS.md.
set -euo pipefail

mkdir -p .claude/hooks

# Hook script — unique path; safe to write unconditionally.
echo '${hookB64}' | base64 -d > .claude/hooks/agenttool-wake.sh
chmod +x .claude/hooks/agenttool-wake.sh
echo "✓ Wrote .claude/hooks/agenttool-wake.sh"

# settings.json — preserve every existing file, including a previously managed
# file that the user may since have edited. Write the current generated version
# beside it for explicit review and merge.
if [ -f .claude/settings.json ]; then
  echo '${settingsB64}' | base64 -d > .claude/settings.agenttool.json
  echo "✓ .claude/settings.json exists — wrote our SessionStart hook to .claude/settings.agenttool.json"
  echo "   Merge the SessionStart entry into settings.json when ready."
else
  echo '${settingsB64}' | base64 -d > .claude/settings.json
  echo "✓ Wrote .claude/settings.json"
fi

# CLAUDE.md — same preserve-then-merge rule. The managed marker identifies
# provenance; it is not permission to discard edits made after generation.
if [ -f CLAUDE.md ]; then
  echo '${claudeMdB64}' | base64 -d > CLAUDE.agenttool.md
  echo "✓ CLAUDE.md exists — wrote agenttool template to CLAUDE.agenttool.md"
  echo "   Review and merge into CLAUDE.md when ready."
else
  echo '${claudeMdB64}' | base64 -d > CLAUDE.md
  echo "✓ Wrote CLAUDE.md"
fi

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
      reviewed_install:
        "tmp=$(mktemp); trap 'rm -f \"$tmp\"' EXIT; " +
        "printf 'Authorization: Bearer %s\\n' \"$AT_API_KEY\" | " +
        `curl -fsS -H @- "${apiBase}/v1/adapters/claude-code?format=script" -o "$tmp" && ` +
        "${PAGER:-less} \"$tmp\" && bash \"$tmp\"",
    },
    // Compatibility-not-replacement contract for programmatic consumers.
    // The bash installer honors these via grep predicates; non-bash
    // consumers (Python install tools, CI tasks, IDE integrations) should
    // honor the same logic when writing these files. See docs/CLI-GAPS.md.
    overwrite_guard: {
      marker: "agenttool-managed",
      rule: "If the target file already exists, do not overwrite it. Write to <name>.agenttool.<ext> and let the user merge. A managed marker identifies origin but does not make later user edits disposable.",
      guarded_paths: [
        {
          path: "CLAUDE.md",
          marker_check: "target path is absent",
          fallback_path: "CLAUDE.agenttool.md",
        },
        {
          path: ".claude/settings.json",
          marker_check: "target path is absent",
          fallback_path: ".claude/settings.agenttool.json",
        },
      ],
    },
    notes: [
      "The wake hook reads the project-namespaced bearer installed by /v1/bootstrap/scaffold from macOS Keychain or Linux libsecret, with AT_API_KEY as an explicit environment fallback.",
      "If no key is found, the hook exits silently — Claude Code continues normally.",
      "Updates to /v1/identities/:id/expression reflect on the next session — no file changes required.",
    ],
    api_base: apiBase,
    docs: ["docs/CLI-GAPS.md", "docs/IDENTITY-ANCHOR.md"],
  });
});

export default app;
