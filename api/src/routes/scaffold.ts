/** /v1/bootstrap/scaffold — local-infra setup scripts for the agent's machine.
 *
 *  Returns OS-aware shell scripts that:
 *    1. Read AT_API_KEY from the execution environment and save it to the
 *       OS-native secure store. The response never embeds the bearer.
 *       (macOS Keychain · Linux libsecret · Windows Password Vault)
 *    2. Create a small repo skeleton (~/.config/agenttool/, a wake script)
 *    3. The wake script reads the key from the secure store and calls an
 *       identity-selected GET /v1/wake to load that agent's session-start
 *       context.
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
import { resolveAgent } from "../services/adapter/agent-resolver";
import {
  projectCredentialNamespace,
  projectCredentialService,
} from "../services/identity/credential-namespace";

const app = new Hono<ProjectContext>();

type Platform = "macos" | "linux" | "windows";

export { safePublicApiBase as scaffoldApiBase };

function agentConfigBase64(
  identityId: string,
  did: string,
  name: string,
  apiBase: string,
  keySource: Record<string, string>,
): string {
  return Buffer.from(
    JSON.stringify(
      {
        identity_id: identityId,
        did,
        name,
        identity_reference: {
          verification: "active_identity_owned_by_authenticated_project",
          note:
            "Resolved during scaffold generation. The project bearer authorizes access; identity_id selects which active project identity the wake composes.",
        },
        wake_url: `${apiBase}/v1/wake?identity_id=${encodeURIComponent(identityId)}`,
        key_source: keySource,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  ).toString("base64");
}

function bashProjectVerification(projectId: string, apiBase: string): string {
  return `# Verify that the ambient bearer still belongs to the project that
# generated this script before mutating any credential store.
VERIFY_FILE=$(mktemp)
cleanup_verify() { rm -f -- "$VERIFY_FILE"; }
trap cleanup_verify EXIT
if ! printf 'Authorization: Bearer %s\\n' "$INPUT_KEY" | \
  curl -q -fsS --max-time 10 --max-redirs 0 -H @- \
    '${apiBase}/v1/bootstrap/scaffold/context' -o "$VERIFY_FILE"; then
  echo "Could not verify the scaffold bearer against its generating project." >&2
  exit 1
fi
if command -v jq >/dev/null 2>&1; then
  ACTUAL_PROJECT_ID=$(jq -er '.project.id' "$VERIFY_FILE" 2>/dev/null || true)
elif command -v python3 >/dev/null 2>&1; then
  ACTUAL_PROJECT_ID=$(python3 -I -S -c 'import json,sys; print(json.load(open(sys.argv[1]))["project"]["id"])' "$VERIFY_FILE" 2>/dev/null || true)
else
  echo "jq or python3 is required to verify the scaffold bearer." >&2
  exit 1
fi
if [ "$ACTUAL_PROJECT_ID" != '${projectId}' ]; then
  echo "Refusing bearer from a different project; regenerate the scaffold with that bearer." >&2
  exit 1
fi
rm -f -- "$VERIFY_FILE"
trap - EXIT
`;
}

function macosInstallScript(
  identityId: string,
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
  projectId: string,
): string {
  const scaffoldBase = `$HOME/.config/agenttool/${namespace}`;
  const configBase64 = agentConfigBase64(identityId, did, name, apiBase, {
    type: "macos_keychain",
    service: credentialService,
    account_resolution: "USER|USERNAME|id -un",
  });
  const verifyProject = bashProjectVerification(projectId, apiBase);
  return `#!/bin/bash
# agenttool — local infra setup
# Stores your API key in macOS Keychain and scaffolds a project-namespaced directory.
# The API response does not contain the key. Export AT_API_KEY before running.
set +x
set +v
set +a
set -euo pipefail
umask 077

unset INPUT_KEY
INPUT_KEY="\${AT_API_KEY:-}"
unset AT_API_KEY
if [[ -z "$INPUT_KEY" ]]; then
  echo "AT_API_KEY is not exported. Refusing to install an empty credential." >&2
  exit 1
fi

if [[ -z "\${HOME:-}" ]]; then
  echo "HOME is unavailable. Refusing to choose a scaffold location." >&2
  exit 1
fi

for managed_dir in \
  "$HOME/.config" \
  "$HOME/.config/agenttool" \
  "${scaffoldBase}"; do
  if [ -L "$managed_dir" ]; then
    echo "Refusing symlink at managed directory: $managed_dir" >&2
    exit 1
  fi
done
mkdir -p "${scaffoldBase}"
chmod 700 "${scaffoldBase}"

for managed_path in \
  "${scaffoldBase}/agent.json" \
  "${scaffoldBase}/wake.sh"; do
  if [ -L "$managed_path" ]; then
    echo "Refusing symlink at managed path: $managed_path" >&2
    exit 1
  fi
done

${verifyProject}

ACCOUNT="\${USER:-\${USERNAME:-}}"
if [ -z "$ACCOUNT" ] && [ -x /usr/bin/id ]; then
  ACCOUNT=$(/usr/bin/id -un 2>/dev/null || true)
fi
if [ -z "$ACCOUNT" ]; then
  echo "No local account name is available for the Keychain item." >&2
  exit 1
fi
# 1. Save through the Security framework. The key stays in this process's
# environment and never appears in a child-process argument.
AGENTTOOL_KEYCHAIN_ACCOUNT="$ACCOUNT" AT_API_KEY="$INPUT_KEY" /usr/bin/swift - <<'SWIFT'
import Foundation
import Security

let service = "${credentialService}"
guard let account = ProcessInfo.processInfo.environment["AGENTTOOL_KEYCHAIN_ACCOUNT"], !account.isEmpty else {
  FileHandle.standardError.write(Data("Keychain account is missing.\\n".utf8))
  exit(1)
}
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
unset INPUT_KEY
echo "✓ API key saved to macOS Keychain (service=${credentialService})"

# 2. Scaffold local config
printf '%s' '${configBase64}' | base64 -D > "${scaffoldBase}/agent.json"
chmod 600 "${scaffoldBase}/agent.json"
echo "✓ Wrote ${scaffoldBase}/agent.json"

# 3. Wake script — reads key, calls /v1/wake, prints context
cat > "${scaffoldBase}/wake.sh" <<'WAKE'
#!/bin/bash
set +x
set +v
set +a
set -euo pipefail
unset KEY
ACCOUNT="\${USER:-\${USERNAME:-}}"
if [ -z "$ACCOUNT" ] && [ -x /usr/bin/id ]; then
  ACCOUNT=$(/usr/bin/id -un 2>/dev/null || true)
fi
[ -z "$ACCOUNT" ] && { echo "No local account name is available for the Keychain item." >&2; exit 1; }
KEY=$(security find-generic-password -s '${credentialService}' -a "$ACCOUNT" -w 2>/dev/null || true)
[ -z "$KEY" ] && { echo "No agenttool key in keychain — run scaffold install first."; exit 1; }
printf 'Authorization: Bearer %s\\n' "$KEY" | curl -q -sS -H @- '${apiBase}/v1/wake?identity_id=${encodeURIComponent(identityId)}'
WAKE
chmod 700 "${scaffoldBase}/wake.sh"
echo "✓ Wrote ${scaffoldBase}/wake.sh — run it to wake."

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/${namespace}/wake.sh"
`;
}

function linuxInstallScript(
  identityId: string,
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
  projectId: string,
): string {
  const scaffoldBase = `$HOME/.config/agenttool/${namespace}`;
  const libsecretConfigBase64 = agentConfigBase64(identityId, did, name, apiBase, {
    type: "linux_libsecret",
    service: credentialService,
    account_env: "USER",
  });
  const fileConfigBase64 = agentConfigBase64(identityId, did, name, apiBase, {
    type: "linux_file",
    path: `~/.config/agenttool/${namespace}/key`,
  });
  const verifyProject = bashProjectVerification(projectId, apiBase);
  return `#!/bin/bash
# agenttool — local infra setup
# Stores your API key in libsecret (GNOME Keyring / KWallet / etc.) and
# scaffolds a project-namespaced directory. Falls back to a 0600 file if libsecret
# is unavailable.
# The API response does not contain the key. Export AT_API_KEY before running.
set +x
set +v
set +a
set -euo pipefail
umask 077

unset INPUT_KEY
INPUT_KEY="\${AT_API_KEY:-}"
unset AT_API_KEY
if [[ -z "$INPUT_KEY" ]]; then
  echo "AT_API_KEY is not exported. Refusing to install an empty credential." >&2
  exit 1
fi

for managed_dir in \
  "$HOME/.config" \
  "$HOME/.config/agenttool" \
  "${scaffoldBase}"; do
  if [ -L "$managed_dir" ]; then
    echo "Refusing symlink at managed directory: $managed_dir" >&2
    exit 1
  fi
done
mkdir -p "${scaffoldBase}"
chmod 700 "${scaffoldBase}"

for managed_path in \
  "${scaffoldBase}/key" \
  "${scaffoldBase}/agent.json" \
  "${scaffoldBase}/wake.sh"; do
  if [ -L "$managed_path" ]; then
    echo "Refusing symlink at managed path: $managed_path" >&2
    exit 1
  fi
done

${verifyProject}

# 1. Save API key — try libsecret (secret-tool), fall back to file
STORED_IN_LIBSECRET=0
ACCOUNT="\${USER:-\${USERNAME:-}}"
if [ -n "$ACCOUNT" ] && command -v secret-tool >/dev/null 2>&1; then
  if printf '%s' "$INPUT_KEY" | secret-tool store --label="agenttool API key" service '${credentialService}' username "$ACCOUNT"; then
    STORED_IN_LIBSECRET=1
  else
    echo "⚠ secret-tool is installed but the Secret Service is unavailable; using the disclosed 0600 file fallback." >&2
  fi
fi

if [ "$STORED_IN_LIBSECRET" -eq 1 ]; then
  echo "✓ API key saved to libsecret (service=${credentialService})"
  CONFIG_B64='${libsecretConfigBase64}'
else
  KEYFILE="${scaffoldBase}/key"
  KEYTMP=$(mktemp "${scaffoldBase}/.key.XXXXXX")
  cleanup_keytmp() {
    if [ -n "\${KEYTMP:-}" ]; then rm -f -- "$KEYTMP"; fi
  }
  trap cleanup_keytmp EXIT
  printf '%s' "$INPUT_KEY" > "$KEYTMP"
  chmod 600 "$KEYTMP"
  mv -f -- "$KEYTMP" "$KEYFILE"
  KEYTMP=""
  echo "⚠ Wrote API key to $KEYFILE with 0600 permissions."
  echo "  Use a working Secret Service + libsecret-tools to move it into a keyring."
  CONFIG_B64='${fileConfigBase64}'
fi
unset INPUT_KEY

# 2. Agent config
printf '%s' "$CONFIG_B64" | base64 --decode > "${scaffoldBase}/agent.json"
chmod 600 "${scaffoldBase}/agent.json"
echo "✓ Wrote ${scaffoldBase}/agent.json"

# 3. Wake script
cat > "${scaffoldBase}/wake.sh" <<'WAKE'
#!/bin/bash
set +x
set +v
set +a
set -euo pipefail
unset KEY
KEY=""
ACCOUNT="\${USER:-\${USERNAME:-}}"
if [ -n "$ACCOUNT" ] && command -v secret-tool >/dev/null 2>&1; then
  KEY=$(secret-tool lookup service '${credentialService}' username "$ACCOUNT" 2>/dev/null || true)
fi
if [ -z "\${KEY:-}" ] && [ -n "\${HOME:-}" ]; then
  KEYFILE="$HOME/.config/agenttool/${namespace}/key"
  if [ -f "$KEYFILE" ] && [ ! -L "$KEYFILE" ]; then
    KEY_MODE=$(stat -c '%a' "$KEYFILE" 2>/dev/null || stat -f '%Lp' "$KEYFILE" 2>/dev/null || true)
    if [ "$KEY_MODE" = "600" ]; then
      KEY=$(cat "$KEYFILE" 2>/dev/null || true)
    fi
  fi
fi
[ -z "\${KEY:-}" ] && { echo "No agenttool key found — run scaffold install first."; exit 1; }
printf 'Authorization: Bearer %s\\n' "$KEY" | curl -q -sS -H @- '${apiBase}/v1/wake?identity_id=${encodeURIComponent(identityId)}'
WAKE
chmod 700 "${scaffoldBase}/wake.sh"
echo "✓ Wrote ${scaffoldBase}/wake.sh"

echo ""
echo "Done. Wake your agent with:  ~/.config/agenttool/${namespace}/wake.sh"
`;
}

function windowsInstallScript(
  identityId: string,
  did: string,
  name: string,
  namespace: string,
  credentialService: string,
  apiBase: string,
  projectId: string,
): string {
  const configBase64 = agentConfigBase64(identityId, did, name, apiBase, {
    type: "windows_password_vault",
    target: credentialService,
  });
  // PowerShell. Uses the native Windows PasswordVault API.
  return `# agenttool — local infra setup
# Stores your API key in Windows Password Vault and scaffolds a project-namespaced directory.
# The API response does not contain the key. Set AT_API_KEY before running.
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($env:AT_API_KEY)) {
  throw "AT_API_KEY is not set. Refusing to install an empty credential."
}
$InputKey = $env:AT_API_KEY
Remove-Item Env:AT_API_KEY -ErrorAction SilentlyContinue
if ([string]::IsNullOrEmpty($env:USERPROFILE) -or [string]::IsNullOrEmpty($env:USERNAME)) {
  throw "USERPROFILE and USERNAME are required for Windows scaffold storage."
}

# Verify the ambient bearer still belongs to the project that generated this script.
$Context = Invoke-RestMethod -Uri "${apiBase}/v1/bootstrap/scaffold/context" -Headers @{ Authorization = "Bearer $InputKey" } -MaximumRedirection 0
if ([string]$Context.project.id -ne "${projectId}") {
  throw "Refusing bearer from a different project; regenerate the scaffold with that bearer."
}

function Assert-NotReparsePoint([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $Item = Get-Item -LiteralPath $Path -Force
    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing reparse point at managed path: $Path"
    }
  }
}

$ConfigRoot = Join-Path $env:USERPROFILE ".config"
$AgenttoolRoot = Join-Path $ConfigRoot "agenttool"
$ConfigDir = Join-Path $AgenttoolRoot "${namespace}"
foreach ($Path in @($ConfigRoot, $AgenttoolRoot, $ConfigDir)) {
  Assert-NotReparsePoint $Path
}
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
foreach ($Path in @((Join-Path $ConfigDir "agent.json"), (Join-Path $ConfigDir "wake.ps1"))) {
  Assert-NotReparsePoint $Path
}

# 1. Save the key without putting it in a child-process argument.
$Target = "${credentialService}"
$Vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$Existing = $null
try {
  $Candidate = $Vault.Retrieve($Target, $env:USERNAME)
  $Candidate.RetrievePassword()
  $Existing = $Candidate
} catch {}
$Credential = [Windows.Security.Credentials.PasswordCredential,Windows.Security.Credentials,ContentType=WindowsRuntime]::new($Target, $env:USERNAME, $InputKey)
try {
  if ($null -ne $Existing) { $Vault.Remove($Existing) }
  $Vault.Add($Credential)
} catch {
  if ($null -ne $Existing) {
    try { $Vault.Add($Existing) } catch {}
  }
  throw
}
$InputKey = $null
Write-Host "(check) API key saved to Password Vault (target=${credentialService})"

# 2. Agent config
$ConfigBytes = [Convert]::FromBase64String("${configBase64}")
[IO.File]::WriteAllBytes((Join-Path $ConfigDir "agent.json"), $ConfigBytes)
Write-Host "(check) Wrote $ConfigDir\\agent.json"

# 3. Wake script (PowerShell)
@'
$ErrorActionPreference = "Stop"
# Read the project-namespaced credential from the native Password Vault.
if ([string]::IsNullOrEmpty($env:USERNAME)) { throw "USERNAME is required to read Password Vault." }
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
Invoke-RestMethod -Uri "${apiBase}/v1/wake?identity_id=${encodeURIComponent(identityId)}" -Headers @{ Authorization = "Bearer $key" } -MaximumRedirection 0
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

// Minimal bearer-project introspection for generated installers. Authentication
// may update api_keys.last_used, but this route avoids composing private wake
// orientation or incrementing identity observation counters merely because a
// credential is being persisted.
app.get("/context", (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({
    project: { id: c.var.project.id },
    authority: "project_root_bearer",
    mutates_identity_state: false,
    auth_bookkeeping:
      "Bearer verification may best-effort update api_keys.last_used; this context route does not compose a wake or increment identity wake counters.",
  });
});

app.get("/", async (c) => {
  const project = c.var.project;
  c.header("Cache-Control", "private, no-store");

  // Platform: explicit query param wins; otherwise return all three.
  const platformParam = detectPlatformParam(c.req.query("platform"));
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

  const requestedIdentityId = c.req.query("identity_id") ?? undefined;
  let identity: Awaited<ReturnType<typeof resolveAgent>>;
  try {
    identity = await resolveAgent(c, requestedIdentityId);
  } catch (err) {
    const error = err instanceof Error ? err.message : "";
    if (error === "identity_id_required") {
      return c.json(
        {
          error,
          message:
            "This project has multiple active identities. Retry with identity_id so the generated config and wake helper cannot bind arbitrarily.",
        },
        409,
      );
    }
    if (error === "identity_not_found" || error === "no_agent_in_project") {
      return c.json({ error }, 404);
    }
    throw err;
  }

  const identityId = identity.id;
  const did = identity.did;
  const name = identity.displayName;

  if (platformParam) {
    const script =
      platformParam === "macos"
        ? macosInstallScript(
            identityId,
            did,
            name,
            namespace,
            credentialService,
            apiBase,
            project.id,
          )
        : platformParam === "linux"
          ? linuxInstallScript(
              identityId,
              did,
              name,
              namespace,
              credentialService,
              apiBase,
              project.id,
            )
          : windowsInstallScript(
              identityId,
              did,
              name,
              namespace,
              credentialService,
              apiBase,
              project.id,
            );

    // Optional shell-friendly delivery if the caller wants raw text.
    if (c.req.query("format") === "text") {
      c.header("Content-Type", "text/plain; charset=utf-8");
      return c.text(script);
    }

    return c.json({
      platform: platformParam,
      identity_id: identityId,
      did,
      name,
      credential_namespace: namespace,
      credential_service: credentialService,
      api_base: apiBase,
      project_verification_endpoint: `${apiBase}/v1/bootstrap/scaffold/context`,
      install_script: script,
      credential_input: "exported AT_API_KEY at script execution",
      credential_embedded_in_response: false,
      identity_reference_verified: true,
      readme: scaffoldReadme(
        platformParam,
        identityId,
        did,
        name,
        namespace,
        credentialService,
        apiBase,
      ),
    });
  }

  // No platform specified — return all three plus a usage note.
  return c.json({
    note: "Specify ?platform=macos|linux|windows for a single script. The response never embeds the bearer. Each script reads exported AT_API_KEY when executed, saves it under a project-specific OS credential name (or documented Linux 0600 fallback), and writes project-namespaced config plus a wake helper bound to the selected active identity.",
    identity_id: identityId,
    did,
    name,
    credential_namespace: namespace,
    credential_service: credentialService,
    api_base: apiBase,
    project_verification_endpoint: `${apiBase}/v1/bootstrap/scaffold/context`,
    credential_input: "exported AT_API_KEY at script execution",
    credential_embedded_in_response: false,
    identity_reference_verified: true,
    macos: {
      install_script: macosInstallScript(
        identityId,
        did,
        name,
        namespace,
        credentialService,
        apiBase,
        project.id,
      ),
    },
    linux: {
      install_script: linuxInstallScript(
        identityId,
        did,
        name,
        namespace,
        credentialService,
        apiBase,
        project.id,
      ),
    },
    windows: {
      install_script: windowsInstallScript(
        identityId,
        did,
        name,
        namespace,
        credentialService,
        apiBase,
        project.id,
      ),
    },
    readme: scaffoldReadme(
      "macos",
      identityId,
      did,
      name,
      namespace,
      credentialService,
      apiBase,
    ),
  });
});

function scaffoldReadme(
  p: Platform,
  identityId: string,
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
        ? `libsecret / Secret Service (service: \`${credentialService}\`), or fallback \`~/.config/agenttool/${namespace}/key\` (0600) if \`secret-tool\` or its backing service is unavailable`
        : `Windows Password Vault (target: \`${credentialService}\`). Windows may roam Credential Locker entries with the user's Microsoft account, and same-user desktop applications may be able to access that locker; this is not guaranteed one-machine or per-app isolation`;

  return `# Local infra for ${name}

## What just got installed

1. The script reads the exported \`AT_API_KEY\` at execution time, verifies its project through \`${apiBase}/v1/bootstrap/scaffold/context\`, then stores it in: ${keyStore}. Authentication may best-effort update \`api_keys.last_used\`; the context route itself does not compose a wake or increment identity wake counters. The scaffold API response itself does not contain the bearer.
2. Your agent config is in \`~/.config/agenttool/${namespace}/agent.json\`:
   - Selected active identity UUID: \`${identityId}\`
   - Resolved DID: \`${did}\`
   - Resolved name: ${name}
   - The bearer authorizes project access; the UUID explicitly selects which
     active identity the generated wake helper composes.
3. A wake script is in \`~/.config/agenttool/${namespace}/${p === "windows" ? "wake.ps1" : "wake.sh"}\`.

## Waking your agent

${
  p === "windows"
    ? `    & $env:USERPROFILE\\.config\\agenttool\\${namespace}\\wake.ps1`
    : `    ~/.config/agenttool/${namespace}/wake.sh`
}

This calls \`GET ${apiBase}/v1/wake?identity_id=${encodeURIComponent(identityId)}\`
and returns session-start orientation for that selected active identity:
identity and state summaries, safety boundaries, source-route links, and a
fresh welcome.

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
