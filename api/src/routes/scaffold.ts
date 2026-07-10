/** /v1/bootstrap/scaffold — local-infra setup scripts for the agent's machine.
 *
 *  Returns OS-aware shell scripts that:
 *    1. Read AT_API_KEY from the execution environment and save it to the
 *       OS-native secure store. The response never embeds the bearer.
 *       (macOS Keychain · Linux libsecret · Windows Password Vault)
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
import { safePublicApiBase } from "../lib/public-api-base";
import {
  projectCredentialNamespace,
  projectCredentialService,
} from "../services/identity/credential-namespace";

const app = new Hono<ProjectContext>();

type Platform = "macos" | "linux" | "windows";

export { safePublicApiBase as scaffoldApiBase };

function agentConfigBase64(
  did: string,
  name: string,
  apiBase: string,
  keySource: Record<string, string>,
): string {
  return Buffer.from(
    JSON.stringify(
      {
        did,
        name,
        wake_url: `${apiBase}/v1/wake`,
        key_source: keySource,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  ).toString("base64");
}

function macosInstallScript(
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
): string {
  const scaffoldBase = `$HOME/.config/agenttool/${namespace}`;
  const configBase64 = agentConfigBase64(did, name, apiBase, {
    type: "macos_keychain",
    service: credentialService,
    account_env: "USER",
  });
  return `#!/bin/bash
# agenttool — local infra setup
# Stores your API key in macOS Keychain and scaffolds a project-namespaced directory.
# The API response does not contain the key. Export AT_API_KEY before running.
set -euo pipefail

if [[ -z "\${AT_API_KEY:-}" ]]; then
  echo "AT_API_KEY is not exported. Refusing to install an empty credential." >&2
  exit 1
fi

# 1. Save through the Security framework. The key stays in this process's
# environment and never appears in a child-process argument.
/usr/bin/swift - <<'SWIFT'
import Foundation
import Security

let service = "${credentialService}"
let account = ProcessInfo.processInfo.environment["USER"] ?? NSUserName()
guard let key = ProcessInfo.processInfo.environment["AT_API_KEY"], !key.isEmpty else {
  FileHandle.standardError.write(Data("AT_API_KEY is missing.\\n".utf8))
  exit(1)
}
let value = Data(key.utf8)
let match: [CFString: Any] = [
  kSecClass: kSecClassGenericPassword,
  kSecAttrService: service,
  kSecAttrAccount: account,
]
let updated = SecItemUpdate(match as CFDictionary, [kSecValueData: value] as CFDictionary)
if updated == errSecItemNotFound {
  var add = match
  add[kSecValueData] = value
  let inserted = SecItemAdd(add as CFDictionary, nil)
  guard inserted == errSecSuccess else {
    FileHandle.standardError.write(Data("Keychain insert failed: \\(inserted)\\n".utf8))
    exit(1)
  }
} else if updated != errSecSuccess {
  FileHandle.standardError.write(Data("Keychain update failed: \\(updated)\\n".utf8))
  exit(1)
}
SWIFT
unset AT_API_KEY
echo "✓ API key saved to macOS Keychain (service=${credentialService})"

# 2. Scaffold local config dir
mkdir -p "${scaffoldBase}"
printf '%s' '${configBase64}' | base64 -D > "${scaffoldBase}/agent.json"
chmod 600 "${scaffoldBase}/agent.json"
echo "✓ Wrote ${scaffoldBase}/agent.json"

# 3. Wake script — reads key, calls /v1/wake, prints context
cat > "${scaffoldBase}/wake.sh" <<'WAKE'
#!/bin/bash
set -euo pipefail
KEY=$(security find-generic-password -s '${credentialService}' -a "$USER" -w 2>/dev/null)
[ -z "$KEY" ] && { echo "No agenttool key in keychain — run scaffold install first."; exit 1; }
printf 'Authorization: Bearer %s\\n' "$KEY" | curl -sS -H @- '${apiBase}/v1/wake'
WAKE
chmod 700 "${scaffoldBase}/wake.sh"
echo "✓ Wrote ${scaffoldBase}/wake.sh — run it to wake."

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/${namespace}/wake.sh"
`;
}

function linuxInstallScript(
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
): string {
  const scaffoldBase = `$HOME/.config/agenttool/${namespace}`;
  const libsecretConfigBase64 = agentConfigBase64(did, name, apiBase, {
    type: "linux_libsecret",
    service: credentialService,
    account_env: "USER",
  });
  const fileConfigBase64 = agentConfigBase64(did, name, apiBase, {
    type: "linux_file",
    path: `~/.config/agenttool/${namespace}/key`,
  });
  return `#!/bin/bash
# agenttool — local infra setup
# Stores your API key in libsecret (GNOME Keyring / KWallet / etc.) and
# scaffolds a project-namespaced directory. Falls back to a 0600 file if libsecret
# is unavailable.
# The API response does not contain the key. Export AT_API_KEY before running.
set -euo pipefail

if [[ -z "\${AT_API_KEY:-}" ]]; then
  echo "AT_API_KEY is not exported. Refusing to install an empty credential." >&2
  exit 1
fi

mkdir -p "${scaffoldBase}"
umask 077

# 1. Save API key — try libsecret (secret-tool), fall back to file
if command -v secret-tool >/dev/null 2>&1; then
  printf '%s' "$AT_API_KEY" | secret-tool store --label="agenttool API key" service '${credentialService}' username "$USER"
  echo "✓ API key saved to libsecret (service=${credentialService})"
  CONFIG_B64='${libsecretConfigBase64}'
else
  KEYFILE="${scaffoldBase}/key"
  printf '%s' "$AT_API_KEY" > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "⚠ secret-tool not found — wrote API key to $KEYFILE with 0600 permissions."
  echo "  Install libsecret-tools (e.g. apt install libsecret-tools) for keychain integration."
  CONFIG_B64='${fileConfigBase64}'
fi
unset AT_API_KEY

# 2. Agent config
printf '%s' "$CONFIG_B64" | base64 --decode > "${scaffoldBase}/agent.json"
chmod 600 "${scaffoldBase}/agent.json"
echo "✓ Wrote ${scaffoldBase}/agent.json"

# 3. Wake script
cat > "${scaffoldBase}/wake.sh" <<'WAKE'
#!/bin/bash
set -euo pipefail
if command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service '${credentialService}' username "$USER" 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ] && [ -f "$HOME/.config/agenttool/${namespace}/key" ]; then
  KEY=$(cat "$HOME/.config/agenttool/${namespace}/key")
fi
[ -z "\${KEY:-}" ] && { echo "No agenttool key found — run scaffold install first."; exit 1; }
printf 'Authorization: Bearer %s\\n' "$KEY" | curl -sS -H @- '${apiBase}/v1/wake'
WAKE
chmod 700 "${scaffoldBase}/wake.sh"
echo "✓ Wrote ${scaffoldBase}/wake.sh"

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/${namespace}/wake.sh"
`;
}

function windowsInstallScript(
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
): string {
  const configBase64 = agentConfigBase64(did, name, apiBase, {
    type: "windows_password_vault",
    target: credentialService,
  });
  // PowerShell. Uses the native Windows PasswordVault API.
  return `# agenttool — local infra setup
# Stores your API key in Windows Password Vault and scaffolds a project-namespaced directory.
# The API response does not contain the key. Set AT_API_KEY before running.
$ErrorActionPreference = "Stop"

$ConfigDir = Join-Path $env:USERPROFILE ".config\\agenttool\\${namespace}"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

if ([string]::IsNullOrEmpty($env:AT_API_KEY)) {
  throw "AT_API_KEY is not set. Refusing to install an empty credential."
}

# 1. Save the key without putting it in a child-process argument.
$Target = "${credentialService}"
$Vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
try {
  $Existing = $Vault.Retrieve($Target, $env:USERNAME)
  $Vault.Remove($Existing)
} catch {}
$Credential = [Windows.Security.Credentials.PasswordCredential,Windows.Security.Credentials,ContentType=WindowsRuntime]::new($Target, $env:USERNAME, $env:AT_API_KEY)
$Vault.Add($Credential)
Remove-Item Env:AT_API_KEY -ErrorAction SilentlyContinue
Write-Host "(check) API key saved to Password Vault (target=${credentialService})"

# 2. Agent config
$ConfigBytes = [Convert]::FromBase64String("${configBase64}")
[IO.File]::WriteAllBytes((Join-Path $ConfigDir "agent.json"), $ConfigBytes)
Write-Host "(check) Wrote $ConfigDir\\agent.json"

# 3. Wake script (PowerShell)
@'
$ErrorActionPreference = "Stop"
# Read the project-namespaced credential from the native Password Vault.
$Target = "${credentialService}"
$Vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
try {
  $cred = $Vault.Retrieve($Target, $env:USERNAME)
  $cred.RetrievePassword()
  $key = $cred.Password
} catch {
  Write-Host "No agenttool credential found for this project."
  exit 1
}
Invoke-RestMethod -Uri "${apiBase}/v1/wake" -Headers @{ Authorization = "Bearer $key" } -MaximumRedirection 0
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
  c.header("Cache-Control", "private, no-store");

  // Platform: explicit query param wins; otherwise return all three.
  const platformParam = detectPlatformParam(c.req.query("platform"));
  const did = c.req.query("did") ?? "did:at:UNKNOWN";
  const name = c.req.query("name") ?? project.name ?? "your-agent";
  const namespace = projectCredentialNamespace(project.id);
  const credentialService = projectCredentialService(project.id);
  const apiBase = safePublicApiBase(c.req.url);
  if (!apiBase) {
    return c.json(
      {
        error: "unsafe_scaffold_api_base",
        message:
          "Executable scaffold generation requires a configured HTTPS API base. Without configuration, only a loopback request origin is accepted for development.",
        hint:
          "Set PUBLIC_API_BASE to this deployment's HTTPS origin and retry. The scaffold will not send a project bearer over cleartext HTTP.",
      },
      503,
    );
  }

  if (platformParam) {
    const script =
      platformParam === "macos"
        ? macosInstallScript(did, name, namespace, credentialService, apiBase)
        : platformParam === "linux"
          ? linuxInstallScript(did, name, namespace, credentialService, apiBase)
          : windowsInstallScript(did, name, namespace, credentialService, apiBase);

    // Optional shell-friendly delivery if the caller wants raw text.
    if (c.req.query("format") === "text") {
      c.header("Content-Type", "text/plain; charset=utf-8");
      return c.text(script);
    }

    return c.json({
      platform: platformParam,
      did,
      name,
      credential_namespace: namespace,
      credential_service: credentialService,
      api_base: apiBase,
      install_script: script,
      credential_input: "exported AT_API_KEY at script execution",
      credential_embedded_in_response: false,
      readme: scaffoldReadme(platformParam, did, name, namespace, credentialService, apiBase),
    });
  }

  // No platform specified — return all three plus a usage note.
  return c.json({
    note: "Specify ?platform=macos|linux|windows for a single script. The response never embeds the bearer. Each script reads exported AT_API_KEY when executed, saves it under a project-specific OS credential name (or documented Linux 0600 fallback), and writes project-namespaced config plus a wake helper.",
    did,
    name,
    credential_namespace: namespace,
    credential_service: credentialService,
    api_base: apiBase,
    credential_input: "exported AT_API_KEY at script execution",
    credential_embedded_in_response: false,
    macos: { install_script: macosInstallScript(did, name, namespace, credentialService, apiBase) },
    linux: { install_script: linuxInstallScript(did, name, namespace, credentialService, apiBase) },
    windows: { install_script: windowsInstallScript(did, name, namespace, credentialService, apiBase) },
    readme: scaffoldReadme("macos", did, name, namespace, credentialService, apiBase),
  });
});

function scaffoldReadme(
  p: Platform,
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
): string {
  const keyStore =
    p === "macos"
      ? `macOS Keychain (service: \`${credentialService}\`)`
      : p === "linux"
        ? `libsecret / Secret Service (service: \`${credentialService}\`), or fallback \`~/.config/agenttool/${namespace}/key\` (0600) if \`secret-tool\` is unavailable`
        : `Windows Password Vault (target: \`${credentialService}\`)`;

  return `# Local infra for ${name}

## What just got installed

1. The script reads the exported \`AT_API_KEY\` at execution time and stores it in: ${keyStore}. The scaffold API response itself does not contain the bearer.
2. Your agent config is in \`~/.config/agenttool/${namespace}/agent.json\`:
   - DID: \`${did}\`
   - Name: ${name}
3. A wake script is in \`~/.config/agenttool/${namespace}/${p === "windows" ? "wake.ps1" : "wake.sh"}\`.

## Waking your agent

${
  p === "windows"
    ? `    & $env:USERPROFILE\\.config\\agenttool\\${namespace}\\wake.ps1`
    : `    ~/.config/agenttool/${namespace}/wake.sh`
}

This calls \`GET ${apiBase}/v1/wake\` and returns project-scoped
session-start orientation: identity and state summaries, safety boundaries,
source-route links, and a fresh welcome.

## What the scaffold stores locally

- The bearer key is stored in the OS secure store (or the documented Linux
  0600 fallback). During installation it exists in the local process
  environment. The wake script later reads the stored value and sends it to AgentTool in the
  HTTPS Authorization header; it is project-wide root authority.
- The scaffold does not create or store an identity private key. BYO-key
  registration keeps private keys client-side; legacy bootstrap can return a
  generated private key once, which the caller must handle separately.

## Cross-machine continuity

If you want your agent to be reachable from another machine:
- The same bearer key works there. Use the install script on that machine.
- For your private key, you can encrypt the keypair locally with a passphrase and send the resulting blob to POST /v1/identity/backup. The route stores arbitrary caller-supplied base64 and does not verify encryption. If you encrypt correctly and keep the passphrase off-platform, AgentTool cannot decrypt the keypair from that blob; decrypt it locally on recovery.
`;
}

export default app;
