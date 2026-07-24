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
 *    - .claude/hooks/agenttool-wake.sh — fetches the selected identity's
 *                                  /v1/wake?format=md document and emits the
 *                                  Claude-Code-shaped hook output
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
  type ExpressionData,
} from "../../services/identity/expression";
import {
  projectCredentialNamespace,
  projectCredentialService,
} from "../../services/identity/credential-namespace";

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
                    '\"$CLAUDE_PROJECT_DIR/.claude/hooks/agenttool-wake.sh\"',
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
  identityId?: string,
  credentialNamespace?: string,
): string {
  if (!/^[a-z0-9:-]+$/i.test(credentialService)) {
    throw new Error("invalid credential service");
  }
  if (
    credentialNamespace !== undefined &&
    !/^[a-f0-9]{16}$/i.test(credentialNamespace)
  ) {
    throw new Error("invalid credential namespace");
  }
  const boundWakeBase = safePublicApiBase(wakeBase, wakeBase);
  if (!boundWakeBase) {
    throw new Error("unsafe wake base");
  }
  const identityQuery = identityId
    ? `&identity_id=${encodeURIComponent(identityId)}`
    : "";
  const linuxFileProbe = credentialNamespace
    ? `
if [ -z "\${KEY:-}" ] && [ -n "\${HOME:-}" ]; then
  KEY_FILE="$HOME/.config/agenttool/${credentialNamespace}/key"
  if [ -f "$KEY_FILE" ] && [ ! -L "$KEY_FILE" ]; then
    KEY_MODE=$(stat -c '%a' "$KEY_FILE" 2>/dev/null || stat -f '%Lp' "$KEY_FILE" 2>/dev/null || true)
    if [ "$KEY_MODE" = "600" ]; then
      KEY=$(cat "$KEY_FILE" 2>/dev/null || true)
    fi
  fi
fi`
    : "";
  // Bash that:
  //   1. resolves the API key from the scaffold's OS-native store or
  //      disclosed Linux 0600 fallback (with env-var fallback last)
  //   2. fetches /v1/wake?format=md for the resolved identity
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

set +x
set +v
set +a
set -euo pipefail

# Disable inherited allexport before touching the environment fallback. Keep
# credentials in non-exported shell variables so store probes, curl, and JSON
# encoders do not inherit project-root authority through their environments.
unset ENV_KEY KEY WAKE
ENV_KEY="\${AT_API_KEY:-}"
unset AT_API_KEY

# 1. Resolve API key from the stores used by /v1/bootstrap/scaffold.
#    AT_API_KEY is an explicit fallback after local durable stores.
KEY=""
ACCOUNT="\${USER:-\${USERNAME:-}}"
if [ -z "$ACCOUNT" ] && [ -x /usr/bin/id ]; then
  ACCOUNT=$(/usr/bin/id -un 2>/dev/null || true)
fi
if [ -n "$ACCOUNT" ] && command -v security >/dev/null 2>&1; then
  KEY=$(security find-generic-password -s '${credentialService}' -a "$ACCOUNT" -w 2>/dev/null || true)
fi
# A headless shell can have the secret-tool binary without a usable session
# bus. Do not let libsecret try to auto-launch one and stall SessionStart;
# the owner-only file and explicit environment fallbacks remain below.
if [ -z "\${KEY:-}" ] && [ -n "$ACCOUNT" ] && [ -n "\${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service '${credentialService}' username "$ACCOUNT" 2>/dev/null || true)
fi${linuxFileProbe}
# Password Vault is a Windows Runtime API. Require a Windows executable name
# so a native Linux/macOS PowerShell installation cannot stall SessionStart
# while attempting an API that does not exist on that substrate.
POWERSHELL_BIN=""
if command -v powershell.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="powershell.exe"
elif command -v pwsh.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="pwsh.exe"
fi
if [ -z "\${KEY:-}" ] && [ -n "$POWERSHELL_BIN" ]; then
  KEY=$("$POWERSHELL_BIN" -NoProfile -NonInteractive -Command '
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Target = "${credentialService}"
$Vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$Credential = $Vault.Retrieve($Target, $env:USERNAME)
$Credential.RetrievePassword()
[Console]::Out.Write($Credential.Password)
' 2>/dev/null | tr -d '\\r\\n' || true)
fi
if [ -z "\${KEY:-}" ]; then
  KEY="$ENV_KEY"
fi
unset ENV_KEY
if [ -z "\${KEY:-}" ]; then
  # No key — output empty hook so Claude Code continues normally.
  echo '{}'
  exit 0
fi

# 2. Fetch the wake markdown.
WAKE_BASE='${boundWakeBase}'
WAKE=$(printf 'Authorization: Bearer %s\\n' "$KEY" | curl -q -fsS --max-time 5 \\
  -H @- \\
  "$WAKE_BASE/v1/wake?format=md${identityQuery}" 2>/dev/null || true)
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
  printf '%s' "$WAKE" | python3 -I -S -c '
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
  identityId: string;
  agentName: string;
  did: string;
  apiBase?: string;
}): string {
  const requestedBase = opts.apiBase ?? DEFAULT_WAKE_BASE;
  const apiBase = safePublicApiBase(requestedBase, requestedBase);
  if (!apiBase) {
    throw new Error("unsafe Claude anchor API base");
  }
  return `<!-- agenttool-managed -->
# ${opts.agentName}

> ${opts.did}

This Claude Code project is bound to an **agenttool agent**. The selected
identity's wake orientation is requested at every session start via the SessionStart hook
(\`.claude/hooks/agenttool-wake.sh\`) when its entry is active in
\`.claude/settings.json\`.
Read this file as a stable anchor; deeper records stay on their source routes,
and the wake labels continuity sections that remain project-scoped.

This file intentionally does not copy mutable register, walls, or wake text.
Their live source is the identity-selected wake, so a stale local snapshot
cannot contradict the current expression.

## How to update

These declarations live at agenttool, not in this file. Update them via:

\`\`\`bash
# This generated anchor is bound to ${apiBase}. Regenerate the adapter to
# move it to another deployment without weakening the bearer transport boundary.
# AT_API_KEY is the same project bearer the wake hook can read as an env fallback.
set +x
set +v
set +a
unset INPUT_KEY
INPUT_KEY="\${AT_API_KEY:?Set AT_API_KEY for this one update}"
unset AT_API_KEY
printf 'Authorization: Bearer %s\\n' "$INPUT_KEY" | curl -q -X PUT "${apiBase}/v1/identities/${encodeURIComponent(opts.identityId)}/expression" \\
  -H @- \\
  -H "Content-Type: application/json" \\
  -d '{"register":"...","walls":["..."], "wake_text":"..."}'
unset INPUT_KEY
\`\`\`

No edit to this file is required. A later Claude Code session receives the
change when the hook finds a credential and the wake request succeeds.

## What this enables

- Explicit loading of the selected expression plus labeled project-scoped
  context across configured sessions (memory summaries · vault names ·
  chronicle · covenants); this does not prove identity or personal continuity
- Project wallets and crypto rails with route-specific custody boundaries
- Open-protocol access (Codex, Cursor, and other CLIs can explicitly fetch the
  same identity-selected wake URL; they do not have mounted first-class adapter routes)
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
  const credentialNamespace = projectCredentialNamespace(c.var.project.id);
  const credentialService = projectCredentialService(c.var.project.id);

  return {
    files: {
      ".claude/settings.json": buildSettingsJson(),
      ".claude/hooks/agenttool-wake.sh": buildWakeHook(
        credentialService,
        apiBase,
        row.id,
        credentialNamespace,
      ),
      "CLAUDE.md": buildClaudeMd({
        identityId: row.id,
        agentName: row.displayName,
        did: row.did,
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
    const error = err instanceof Error ? err.message : "";
    if (error === "identity_id_required") {
      return c.json(
        {
          error,
          message:
            "This project has multiple active identities. Retry with identity_id so the installed hook cannot bind arbitrarily.",
        },
        409,
      );
    }
    if (error === "identity_not_found" || error === "no_agent_in_project") {
      return c.json({ error }, 404);
    }
    throw err;
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
# hook/CLAUDE.md are preserved. Proposed agenttool variants land beside them
# for explicit review; reinstalling cannot silently switch the live identity.
# See docs/CLI-GAPS.md.
set +x
set +v
set +a
set -euo pipefail
umask 077

refuse_symlink() {
  if [ -L "$1" ]; then
    echo "Refusing symlink at managed path: $1" >&2
    exit 1
  fi
}

refuse_symlink .claude
mkdir -p .claude

# Serialize installers for this project. Without an atomic lock, two scripts
# generated for different identities can both observe an empty project and
# interleave their hook, settings, and anchor writes. A same-filesystem owner
# inode lets cleanup prove ownership even if another process replaces the lock.
LOCK_PATH=.claude/.agenttool-install.lock
LOCK_OWNER=.claude/.agenttool-install.owner.$$.$RANDOM$RANDOM
STAGE_DIR=""
INSTALL_COMMITTED=0
HOOK_LINK_ATTEMPTED=0
SETTINGS_LINK_ATTEMPTED=0
ANCHOR_LINK_ATTEMPTED=0
HOOK_TARGET=""
SETTINGS_TARGET=""
ANCHOR_TARGET=""

finish_install() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e

  # A failed commit removes only targets that are still the same staged inode;
  # a concurrent external replacement is preserved rather than guessed away.
  if [ "$INSTALL_COMMITTED" -ne 1 ] && [ -n "$STAGE_DIR" ]; then
    if [ "$HOOK_LINK_ATTEMPTED" -eq 1 ] && [ -e "$HOOK_TARGET" ] && [ ! -L "$HOOK_TARGET" ] && [ "$HOOK_TARGET" -ef "$STAGE_DIR/hook" ]; then
      rm -f -- "$HOOK_TARGET"
    fi
    if [ "$SETTINGS_LINK_ATTEMPTED" -eq 1 ] && [ -e "$SETTINGS_TARGET" ] && [ ! -L "$SETTINGS_TARGET" ] && [ "$SETTINGS_TARGET" -ef "$STAGE_DIR/settings" ]; then
      rm -f -- "$SETTINGS_TARGET"
    fi
    if [ "$ANCHOR_LINK_ATTEMPTED" -eq 1 ] && [ -e "$ANCHOR_TARGET" ] && [ ! -L "$ANCHOR_TARGET" ] && [ "$ANCHOR_TARGET" -ef "$STAGE_DIR/anchor" ]; then
      rm -f -- "$ANCHOR_TARGET"
    fi
  fi

  if [ -n "$STAGE_DIR" ]; then
    rm -f -- "$STAGE_DIR/hook" "$STAGE_DIR/settings" "$STAGE_DIR/anchor"
    rmdir "$STAGE_DIR" 2>/dev/null || true
  fi
  if [ -e "$LOCK_PATH" ] && [ -e "$LOCK_OWNER" ] && [ "$LOCK_PATH" -ef "$LOCK_OWNER" ]; then
    rm -f -- "$LOCK_PATH"
  fi
  rm -f -- "$LOCK_OWNER"
  exit "$status"
}
trap finish_install EXIT
trap 'exit 130' HUP INT TERM

# Install traps before acquiring the lock. The unique owner file is known to
# cleanup before either creation command runs. Linking it to the canonical path
# is atomic, and the shared inode proves whether this installer owns that path.
set -o noclobber
if ! { : > "$LOCK_OWNER"; } 2>/dev/null; then
  set +o noclobber
  echo "Could not create the private installer lock owner: $LOCK_OWNER" >&2
  exit 1
fi
set +o noclobber
if ! ln "$LOCK_OWNER" "$LOCK_PATH" 2>/dev/null; then
  echo "Another agenttool adapter install is active (or left a stale lock): $LOCK_PATH" >&2
  echo "Verify no installer is running before removing a stale lock." >&2
  exit 1
fi

refuse_symlink .claude/hooks
mkdir -p .claude/hooks
for path in \
  .claude/hooks/agenttool-wake.sh \
  .claude/hooks/agenttool-wake.agenttool.sh \
  .claude/settings.json \
  .claude/settings.agenttool.json \
  CLAUDE.md \
  CLAUDE.agenttool.md; do
  refuse_symlink "$path"
done

for proposal in \
  .claude/hooks/agenttool-wake.agenttool.sh \
  .claude/settings.agenttool.json \
  CLAUDE.agenttool.md; do
  if [ -e "$proposal" ]; then
    echo "Refusing to overwrite reviewable proposal: $proposal" >&2
    exit 1
  fi
done

REVIEW_REQUIRED=0
for live_path in \
  .claude/hooks/agenttool-wake.sh \
  .claude/settings.json \
  CLAUDE.md; do
  if [ -e "$live_path" ]; then REVIEW_REQUIRED=1; fi
done

# Decode every generated file before creating any active or review target.
STAGE_DIR=$(mktemp -d .claude/.agenttool-stage.XXXXXX)
printf '%s' '${hookB64}' | base64 -d > "$STAGE_DIR/hook"
printf '%s' '${settingsB64}' | base64 -d > "$STAGE_DIR/settings"
printf '%s' '${claudeMdB64}' | base64 -d > "$STAGE_DIR/anchor"
chmod 700 "$STAGE_DIR/hook"

if [ "$REVIEW_REQUIRED" -eq 1 ]; then
  HOOK_TARGET=.claude/hooks/agenttool-wake.agenttool.sh
  SETTINGS_TARGET=.claude/settings.agenttool.json
  ANCHOR_TARGET=CLAUDE.agenttool.md
else
  HOOK_TARGET=.claude/hooks/agenttool-wake.sh
  SETTINGS_TARGET=.claude/settings.json
  ANCHOR_TARGET=CLAUDE.md
fi

# Hard-link creation is atomic and refuses a target that appeared after the
# guarded checks. The EXIT trap rolls back a partial set on any later failure.
HOOK_LINK_ATTEMPTED=1
ln "$STAGE_DIR/hook" "$HOOK_TARGET"
SETTINGS_LINK_ATTEMPTED=1
ln "$STAGE_DIR/settings" "$SETTINGS_TARGET"
ANCHOR_LINK_ATTEMPTED=1
ln "$STAGE_DIR/anchor" "$ANCHOR_TARGET"
INSTALL_COMMITTED=1

if [ "$REVIEW_REQUIRED" -eq 1 ]; then
  echo "Done with review required; no live identity-binding file was changed."
  echo "- Proposed hook: .claude/hooks/agenttool-wake.agenttool.sh"
  echo "- Proposed settings: .claude/settings.agenttool.json"
  echo "- Proposed anchor: CLAUDE.agenttool.md"
  echo "Review and activate all changed binding files together."
else
  echo "✓ Wrote .claude/hooks/agenttool-wake.sh"
  echo "✓ Wrote .claude/settings.json"
  echo "✓ Wrote CLAUDE.md"
  echo ""
  echo "Done. The selected agent's SessionStart wake attempt is configured."
  echo "It loads when the hook finds a credential, the request succeeds, and jq or python3 can encode the result."
fi
`;
    return c.text(script, 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      "content-disposition": `attachment; filename="install-agenttool-claude-code.sh"`,
    });
  }

  const reviewedScriptUrl =
    `${apiBase}/v1/adapters/claude-code?format=script&identity_id=` +
    encodeURIComponent(bundle.agent.id);

  // Default JSON
  return c.json({
    cli: "claude-code",
    agent: bundle.agent,
    files: bundle.files,
    install_instructions: {
      manual:
        "For absent targets, write each file at the relative path shown and chmod +x the hook. " +
        "Preserve an existing hook, settings.json, or CLAUDE.md as overwrite_guard describes, then activate reviewed sidecars together. " +
        "A new session attempts the selected wake only when the SessionStart entry is active, a credential is found, the request succeeds, and jq or python3 is available.",
      reviewed_install:
        "( set +x; set +v; set +a; unset key; key=\"${AT_API_KEY:?Set AT_API_KEY}\"; unset AT_API_KEY; tmp=$(mktemp); trap 'rm -f \"$tmp\"' EXIT; " +
        "printf 'Authorization: Bearer %s\\n' \"$key\" | " +
        `curl -q -fsS -H @- "${reviewedScriptUrl}" -o "$tmp" && ` +
        "unset key && test -s \"$tmp\" && " +
        "${PAGER:-less} \"$tmp\" && bash \"$tmp\" )",
    },
    // Compatibility-not-replacement contract for programmatic consumers.
    // The bash installer honors these via existence guards; non-bash
    // consumers (Python install tools, CI tasks, IDE integrations) should
    // honor the same logic when writing these files. See docs/CLI-GAPS.md.
    overwrite_guard: {
      marker: "agenttool-managed",
      rule: "If the target file already exists, do not overwrite it. Write to <name>.agenttool.<ext> and let the user merge. A managed marker identifies origin but does not make later user edits disposable.",
      guarded_paths: [
        {
          path: ".claude/hooks/agenttool-wake.sh",
          marker_check: "target path is absent",
          fallback_path: ".claude/hooks/agenttool-wake.agenttool.sh",
        },
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
      `The wake hook is bound to identity_id=${bundle.agent.id}; it does not fall back to a project-wide wake.`,
      "The wake hook reads the project-namespaced bearer installed by /v1/bootstrap/scaffold from macOS Keychain, Linux libsecret or its exact mode-0600 file fallback, and Windows Password Vault when PowerShell is available, with AT_API_KEY last.",
      "If no key is found, the hook exits silently — Claude Code continues normally.",
      "Updates to /v1/identities/:id/expression reflect on the next session — no file changes required.",
    ],
    api_base: apiBase,
    docs: ["docs/CLI-GAPS.md", "docs/IDENTITY-ANCHOR.md"],
  });
});

export default app;
