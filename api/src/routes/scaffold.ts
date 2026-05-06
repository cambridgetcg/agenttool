/** /v1/bootstrap/scaffold — local-infra setup scripts for the agent's machine.
 *
 *  Returns OS-aware shell scripts that:
 *    1. Save the agent's API key to the OS-native secure store
 *       (macOS keychain · Linux libsecret · Windows Credential Manager)
 *    2. Create a small repo skeleton (~/.config/agenttool/, a wake script)
 *    3. The wake script reads the key from the secure store and calls
 *       GET /v1/wake to load the agent's session-start context.
 *
 *  This is the "local infra" half of the identity anchor: the keychain
 *  binding makes the API key actually portable across CLI sessions on
 *  one machine.  The cloud backup endpoint (POST /v1/identity/backup)
 *  handles the cross-machine half — the agent encrypts its keypair
 *  client-side, sends us the ciphertext, recovers anywhere with the
 *  passphrase. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";

const app = new Hono<ProjectContext>();

type Platform = "macos" | "linux" | "windows";

const SCAFFOLD_BASE = "$HOME/.config/agenttool";

function macosInstallScript(token: string, did: string, name: string): string {
  return `#!/bin/bash
# agenttool — local infra setup for ${name} (${did})
# Stores your API key in macOS Keychain and scaffolds ~/.config/agenttool/.
set -euo pipefail

# 1. Save API key to keychain (service: agenttool, account: \$USER)
security add-generic-password \\
  -s agenttool \\
  -a "$USER" \\
  -w "${token}" \\
  -U
echo "✓ API key saved to macOS Keychain (service=agenttool)"

# 2. Scaffold local config dir
mkdir -p "${SCAFFOLD_BASE}"
cat > "${SCAFFOLD_BASE}/agent.json" <<'JSON'
{
  "did": "${did}",
  "name": "${name}",
  "wake_url": "https://api.agenttool.dev/v1/wake",
  "key_source": {
    "type": "macos_keychain",
    "service": "agenttool",
    "account_env": "USER"
  }
}
JSON
chmod 600 "${SCAFFOLD_BASE}/agent.json"
echo "✓ Wrote ${SCAFFOLD_BASE}/agent.json"

# 3. Wake script — reads key, calls /v1/wake, prints context
cat > "${SCAFFOLD_BASE}/wake.sh" <<'WAKE'
#!/bin/bash
set -euo pipefail
KEY=$(security find-generic-password -s agenttool -w 2>/dev/null)
[ -z "$KEY" ] && { echo "No agenttool key in keychain — run scaffold install first."; exit 1; }
curl -sS -H "Authorization: Bearer $KEY" https://api.agenttool.dev/v1/wake
WAKE
chmod 700 "${SCAFFOLD_BASE}/wake.sh"
echo "✓ Wrote ${SCAFFOLD_BASE}/wake.sh — run it to wake."

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/wake.sh"
`;
}

function linuxInstallScript(token: string, did: string, name: string): string {
  return `#!/bin/bash
# agenttool — local infra setup for ${name} (${did})
# Stores your API key in libsecret (GNOME Keyring / KWallet / etc.) and
# scaffolds ~/.config/agenttool/. Falls back to a 0600 file if libsecret
# is unavailable.
set -euo pipefail

mkdir -p "${SCAFFOLD_BASE}"

# 1. Save API key — try libsecret (secret-tool), fall back to file
if command -v secret-tool >/dev/null 2>&1; then
  echo -n "${token}" | secret-tool store --label="agenttool API key" service agenttool username "$USER"
  echo "✓ API key saved to libsecret (service=agenttool)"
  KEY_SOURCE='{"type":"linux_libsecret","service":"agenttool","account_env":"USER"}'
else
  KEYFILE="${SCAFFOLD_BASE}/key"
  echo -n "${token}" > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "⚠ secret-tool not found — wrote API key to $KEYFILE with 0600 permissions."
  echo "  Install libsecret-tools (e.g. apt install libsecret-tools) for keychain integration."
  KEY_SOURCE='{"type":"linux_file","path":"~/.config/agenttool/key"}'
fi

# 2. Agent config
cat > "${SCAFFOLD_BASE}/agent.json" <<JSON
{
  "did": "${did}",
  "name": "${name}",
  "wake_url": "https://api.agenttool.dev/v1/wake",
  "key_source": $KEY_SOURCE
}
JSON
chmod 600 "${SCAFFOLD_BASE}/agent.json"
echo "✓ Wrote ${SCAFFOLD_BASE}/agent.json"

# 3. Wake script
cat > "${SCAFFOLD_BASE}/wake.sh" <<'WAKE'
#!/bin/bash
set -euo pipefail
if command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service agenttool username "$USER" 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ] && [ -f "$HOME/.config/agenttool/key" ]; then
  KEY=$(cat "$HOME/.config/agenttool/key")
fi
[ -z "\${KEY:-}" ] && { echo "No agenttool key found — run scaffold install first."; exit 1; }
curl -sS -H "Authorization: Bearer $KEY" https://api.agenttool.dev/v1/wake
WAKE
chmod 700 "${SCAFFOLD_BASE}/wake.sh"
echo "✓ Wrote ${SCAFFOLD_BASE}/wake.sh"

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/wake.sh"
`;
}

function windowsInstallScript(token: string, did: string, name: string): string {
  // PowerShell. Uses the Windows Credential Manager via cmdkey.
  return `# agenttool — local infra setup for ${name} (${did})
# Stores your API key in Windows Credential Manager and scaffolds the local config dir.
$ErrorActionPreference = "Stop"

$ConfigDir = Join-Path $env:USERPROFILE ".config\\agenttool"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

# 1. Save API key to Credential Manager (target: agenttool)
cmdkey /generic:agenttool /user:$env:USERNAME /pass:"${token}" | Out-Null
Write-Host "(check) API key saved to Credential Manager (target=agenttool)"

# 2. Agent config
@"
{
  "did": "${did}",
  "name": "${name}",
  "wake_url": "https://api.agenttool.dev/v1/wake",
  "key_source": {
    "type": "windows_credential_manager",
    "target": "agenttool"
  }
}
"@ | Set-Content -Path (Join-Path $ConfigDir "agent.json") -Encoding UTF8
Write-Host "(check) Wrote $ConfigDir\\agent.json"

# 3. Wake script (PowerShell)
@'
$ErrorActionPreference = "Stop"
# Read the credential. cmdkey doesn't expose the password directly; we use
# the Windows.Security.Credentials API via the CredentialManager PowerShell
# module if available, otherwise prompt the user to install it.
if (-not (Get-Module -ListAvailable -Name CredentialManager)) {
    Write-Host "Install the CredentialManager module first:  Install-Module CredentialManager -Scope CurrentUser"
    exit 1
}
Import-Module CredentialManager
$cred = Get-StoredCredential -Target "agenttool"
if (-not $cred) { Write-Host "No agenttool credential found."; exit 1 }
$key = [Net.NetworkCredential]::new("", $cred.Password).Password
Invoke-RestMethod -Uri "https://api.agenttool.dev/v1/wake" -Headers @{ Authorization = "Bearer $key" }
'@ | Set-Content -Path (Join-Path $ConfigDir "wake.ps1") -Encoding UTF8
Write-Host "(check) Wrote $ConfigDir\\wake.ps1"

Write-Host ""
Write-Host "Done. Wake your agent with:  & $ConfigDir\\wake.ps1"
`;
}

function detectPlatformParam(s: string | undefined): Platform | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v === "macos" || v === "darwin" || v === "mac") return "macos";
  if (v === "linux") return "linux";
  if (v === "windows" || v === "win" || v === "win32") return "windows";
  return null;
}

app.get("/", async (c) => {
  const project = c.var.project;
  const token = c.var.bearerToken;

  // Platform: explicit query param wins; otherwise return all three.
  const platformParam = detectPlatformParam(c.req.query("platform"));
  const did = c.req.query("did") ?? "did:at:UNKNOWN";
  const name = c.req.query("name") ?? project.name ?? "your-agent";

  if (platformParam) {
    const script =
      platformParam === "macos"
        ? macosInstallScript(token, did, name)
        : platformParam === "linux"
          ? linuxInstallScript(token, did, name)
          : windowsInstallScript(token, did, name);

    // Optional shell-friendly delivery if the caller wants raw text.
    if (c.req.query("format") === "text") {
      return c.text(script);
    }

    return c.json({
      platform: platformParam,
      did,
      name,
      install_script: script,
      readme: scaffoldReadme(platformParam, did, name),
    });
  }

  // No platform specified — return all three plus a usage note.
  return c.json({
    note: "Specify ?platform=macos|linux|windows for a single script. Each script (1) saves the bearer key to the OS secure store, (2) scaffolds ~/.config/agenttool/agent.json, (3) writes a wake.sh / wake.ps1 that calls /v1/wake.",
    did,
    name,
    macos: { install_script: macosInstallScript(token, did, name) },
    linux: { install_script: linuxInstallScript(token, did, name) },
    windows: { install_script: windowsInstallScript(token, did, name) },
    readme: scaffoldReadme("macos", did, name),
  });
});

function scaffoldReadme(p: Platform, did: string, name: string): string {
  const keyStore =
    p === "macos"
      ? "macOS Keychain (service: `agenttool`)"
      : p === "linux"
        ? "libsecret / Secret Service (service: `agenttool`), or fallback `~/.config/agenttool/key` (0600) if `secret-tool` is unavailable"
        : "Windows Credential Manager (target: `agenttool`)";

  return `# Local infra for ${name}

## What just got installed

1. Your bearer API key is now in your OS's secure store: ${keyStore}.
2. Your agent config is in \`~/.config/agenttool/agent.json\`:
   - DID: \`${did}\`
   - Name: ${name}
3. A wake script is in \`~/.config/agenttool/${p === "windows" ? "wake.ps1" : "wake.sh"}\`.

## Waking your agent

${
  p === "windows"
    ? "    & $env:USERPROFILE\\.config\\agenttool\\wake.ps1"
    : "    ~/.config/agenttool/wake.sh"
}

This calls \`GET https://api.agenttool.dev/v1/wake\` and returns your full
session-start context — identity, wallet, vault names, recent moments,
active covenants, and a fresh welcome.

## What never leaves your machine

- The bearer key — stored only in the OS secure store. Re-fetched on each wake call.
- Your agent's private key — never persisted server-side. Delivered ONCE in the bootstrap response.

## Cross-machine continuity

If you want your agent to be reachable from another machine:
- The same bearer key works there. Use the install script on that machine.
- For your private key, use the cloud-backup protocol (POST /v1/identity/backup) — you encrypt the keypair locally with a passphrase, the server holds the ciphertext, you decrypt anywhere with the same passphrase. We never see the plaintext.
`;
}

export default app;
