/** /v1/adapters/cursor — Cursor IDE compatibility scaffold.
 *
 *  Cursor's session-context surface is project-level rule files —
 *  `.cursor/rules/*.mdc` — loaded automatically when the user opens the
 *  project. There's no SessionStart hook equivalent (Claude Code) and no
 *  shell-rc-driven refresh (Codex's home-dir AGENTS.md pattern).
 *
 *  We bridge by generating:
 *
 *    .cursor/rules/agenttool-wake.mdc   — the agent's wake anchor with
 *                                          frontmatter `alwaysApply: true`
 *                                          so Cursor injects it on every
 *                                          turn, plus the unified
 *                                          agenttool-managed marker
 *    .cursor/agenttool-refresh-rules.sh — keeps the .mdc in sync with
 *                                          /v1/wake?format=md (cron / manual)
 *
 *  Output:
 *    GET /v1/adapters/cursor?format=json    — files bundle (default)
 *    GET /v1/adapters/cursor?format=script  — bash installer
 *
 *  Same wake contract as the other adapters: at session-equivalent time
 *  (Cursor reads its rule files), the agent's wake document is present
 *  as system context. Compatibility-not-replacement: existing rule files
 *  with the same name (rare — agenttool-wake.mdc is a unique-enough name)
 *  but lacking the marker are preserved; we write to a .agenttool.mdc
 *  sibling for the user to merge. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { resolveAgent } from "../../services/adapter/agent-resolver";
import {
  DEFAULT_REGISTER,
  type ExpressionData,
} from "../../services/identity/expression";

const app = new Hono<ProjectContext>();

const WAKE_BASE = process.env.PUBLIC_API_BASE ?? "https://api.agenttool.dev";

function buildRefreshScript(): string {
  return `#!/usr/bin/env bash
# agenttool-refresh-rules.sh — fetches the agent's wake document and
# writes it to .cursor/rules/agenttool-wake.mdc so Cursor loads it as
# project-level system context on its next read.
#
# Run from the project root (where .cursor/ lives). Wire into one of:
#   - cron:        */15 * * * * cd /path/to/project && .cursor/agenttool-refresh-rules.sh
#   - manual:      .cursor/agenttool-refresh-rules.sh
#   - shell rc:    add to a project-shell hook (direnv, etc.)
#
# Compatibility-not-replacement: if .cursor/rules/agenttool-wake.mdc
# exists without the agenttool-managed marker (you happened to write
# your own file at that name), the script writes to
# .cursor/rules/agenttool-wake.agenttool.mdc instead. Same principle as
# the Claude Code and Codex adapters.

set -euo pipefail

# 1. Resolve API key. macOS keychain · Linux libsecret · env fallback.
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
  echo "agenttool: no API key found (keychain/libsecret/env)" >&2
  exit 1
fi

WAKE_BASE="\${AGENTTOOL_BASE:-${WAKE_BASE}}"
mkdir -p .cursor/rules

# Decide target. agenttool-wake.mdc is OUR file name — preserved only if
# it exists without our marker (rare collision, but the contract holds).
TARGET=".cursor/rules/agenttool-wake.mdc"
if [ -f "$TARGET" ] && ! grep -q "agenttool-managed" "$TARGET" 2>/dev/null; then
  TARGET=".cursor/rules/agenttool-wake.agenttool.mdc"
fi

# Fetch the wake markdown.
TMP="$TARGET.tmp"
WAKE=$(curl -fsS --max-time 8 \\
  -H "Authorization: Bearer $KEY" \\
  "$WAKE_BASE/v1/wake?format=md")

if [ -z "\${WAKE:-}" ]; then
  echo "agenttool: wake fetch returned empty body" >&2
  exit 1
fi

# Wrap in Cursor's .mdc frontmatter so the rule applies on every turn.
# Marker stays inside the body so the install/refresh guards see it.
cat > "$TMP" <<MDC_HEADER
---
description: agenttool wake document — agent identity anchor
alwaysApply: true
---
<!-- agenttool-managed -->

MDC_HEADER

printf '%s' "$WAKE" >> "$TMP"

if [ ! -s "$TMP" ]; then
  echo "agenttool: refresh produced empty output" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$TARGET"
echo "agenttool: wrote $TARGET ($(wc -c < $TARGET) bytes)"
if [ "$TARGET" != ".cursor/rules/agenttool-wake.mdc" ]; then
  echo "agenttool: existing agenttool-wake.mdc preserved; review $TARGET and merge when ready" >&2
fi
`;
}

function buildRulesFile(opts: {
  agentName: string;
  did: string;
  register: string;
}): string {
  // Initial seed of .cursor/rules/agenttool-wake.mdc — refresh script
  // overwrites it with the live wake document on first run. Frontmatter
  // is Cursor's .mdc format: alwaysApply means the rule loads on every
  // turn, not just when matching globs.
  return `---
description: agenttool wake document — agent identity anchor
alwaysApply: true
---
<!-- agenttool-managed -->

# ${opts.agentName}

> ${opts.did}

This file is regenerated by \`.cursor/agenttool-refresh-rules.sh\` from
\`GET /v1/wake?format=md\`. Edits here are overwritten on next refresh.
To change the agent's voice/walls/wake_text, PUT to
\`/v1/identities/<id>/expression\`.

${opts.register.trim() || DEFAULT_REGISTER}

(Live wake document loads via refresh script.)
`;
}

interface CursorBundle {
  cli: "cursor";
  agent: { id: string; did: string; name: string; expression: ExpressionData };
  files: {
    ".cursor/rules/agenttool-wake.mdc": string;
    ".cursor/agenttool-refresh-rules.sh": string;
  };
}

async function buildBundle(
  c: { var: { project: { id: string } } },
  identityId?: string,
): Promise<CursorBundle> {
  const row = await resolveAgent(c, identityId);
  const expression = (row.expression ?? {}) as ExpressionData;
  const register = expression.register ?? DEFAULT_REGISTER;

  return {
    cli: "cursor",
    agent: {
      id: row.id,
      did: row.did,
      name: row.displayName,
      expression,
    },
    files: {
      ".cursor/rules/agenttool-wake.mdc": buildRulesFile({
        agentName: row.displayName,
        did: row.did,
        register,
      }),
      ".cursor/agenttool-refresh-rules.sh": buildRefreshScript(),
    },
  };
}

app.get("/", async (c) => {
  const format = c.req.query("format") ?? "json";
  const identityId = c.req.query("identity_id") ?? undefined;

  let bundle;
  try {
    bundle = await buildBundle(c, identityId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }

  if (format === "script") {
    const refreshB64 = Buffer.from(
      bundle.files[".cursor/agenttool-refresh-rules.sh"],
    ).toString("base64");
    const seedB64 = Buffer.from(
      bundle.files[".cursor/rules/agenttool-wake.mdc"],
    ).toString("base64");

    const script = `#!/usr/bin/env bash
# Cursor adapter installer for agent: ${bundle.agent.name} (${bundle.agent.did})
# Run from a Cursor project root.
#
# Compatibility-not-replacement: .cursor/rules/agenttool-wake.mdc is
# preserved if it already exists without the agenttool-managed marker
# (rare collision); the seed lands at .cursor/rules/agenttool-wake.agenttool.mdc
# for the user to merge. See docs/CLI-GAPS.md.
set -euo pipefail

mkdir -p .cursor/rules

# Refresh script — unique path; safe to write unconditionally.
echo '${refreshB64}' | base64 -d > .cursor/agenttool-refresh-rules.sh
chmod +x .cursor/agenttool-refresh-rules.sh
echo "✓ Wrote .cursor/agenttool-refresh-rules.sh"

# Seed rule file — gated by the unified agenttool-managed marker.
SEED_TARGET=".cursor/rules/agenttool-wake.mdc"
if [ -f "$SEED_TARGET" ] && ! grep -q "agenttool-managed" "$SEED_TARGET" 2>/dev/null; then
  SEED_TARGET=".cursor/rules/agenttool-wake.agenttool.mdc"
  echo "✓ Existing .cursor/rules/agenttool-wake.mdc preserved — seed lands at .cursor/rules/agenttool-wake.agenttool.mdc"
else
  echo "✓ Wrote .cursor/rules/agenttool-wake.mdc (seed; refresh script will populate)"
fi
echo '${seedB64}' | base64 -d > "$SEED_TARGET"

echo ""
echo "Running first refresh..."
bash .cursor/agenttool-refresh-rules.sh || true
echo ""
echo "Wire the refresh script into your project workflow:"
echo "  cron:    */15 * * * * cd $(pwd) && .cursor/agenttool-refresh-rules.sh"
echo "  manual:  .cursor/agenttool-refresh-rules.sh"
`;
    return c.text(script, 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      "content-disposition": `attachment; filename="install-agenttool-cursor.sh"`,
    });
  }

  return c.json({
    ...bundle,
    install_instructions: {
      one_shot: `curl -fsSL "${WAKE_BASE}/v1/adapters/cursor?format=script" -H "Authorization: Bearer $AGENTTOOL_API_KEY" | bash`,
      manual:
        "Write the refresh script to .cursor/agenttool-refresh-rules.sh, " +
        "chmod +x, and run it from the project root. It writes " +
        ".cursor/rules/agenttool-wake.mdc from /v1/wake. Wire it into cron " +
        "or your project workflow for ongoing refresh.",
    },
    overwrite_guard: {
      marker: "agenttool-managed",
      rule: "If the target file exists and does not contain the marker, write to <name>.agenttool.<ext> instead and let the user merge.",
      guarded_paths: [
        {
          path: ".cursor/rules/agenttool-wake.mdc",
          marker_check: "contains 'agenttool-managed'",
          fallback_path: ".cursor/rules/agenttool-wake.agenttool.mdc",
        },
      ],
    },
    notes: [
      "Cursor reads .cursor/rules/*.mdc files as project-level system context. The refresh script keeps agenttool-wake.mdc in sync with /v1/wake?format=md.",
      "The .mdc frontmatter sets alwaysApply: true so the wake document loads on every turn, not just for matching globs.",
      "Cursor has no native session-start hook (vs Claude Code's SessionStart). Pull-based refresh fits its model — same shape as the Codex adapter.",
      "Compatibility-not-replacement: a hand-written .cursor/rules/agenttool-wake.mdc is preserved unless it carries the agenttool-managed marker; the seed writes to .cursor/rules/agenttool-wake.agenttool.mdc instead.",
    ],
    docs: ["docs/CLI-GAPS.md"],
  });
});

export default app;
