/** _secret-store.ts — shared multi-platform OS-keychain abstraction.
 *
 *  Backends:
 *
 *    macOS    → security find-generic-password / add-generic-password
 *               (Keychain Access, encrypted at rest by the OS, unlocked
 *               at login)
 *
 *    Linux    → secret-tool (libsecret, GNOME Keyring / KWallet)
 *               with file fallback at ~/.config/agenttool/<service>
 *               (mode 0600) when secret-tool isn't installed (CI, headless)
 *
 *    Windows  → PowerShell ProtectedData (DPAPI / CurrentUser scope)
 *               with file fallback at %APPDATA%/agenttool/<service> when
 *               PowerShell isn't available. The DPAPI ciphertext is
 *               persisted as base64 at %APPDATA%/agenttool/<service>.dpapi.
 *
 *  Service naming convention: ``agenttool-<scope>-<purpose>``
 *  (e.g. ``agenttool-bridge-kmaster``, ``agenttool-cloudflare-token``).
 *  Account: ``$USER`` env var (single-user assumption — matches the rest
 *  of the codebase's keychain conventions).
 *
 *  Used by:
 *    bin/agenttool-secret  — the user-facing CLI wrapper
 *    bin/agenttool-bridge  — could migrate to use this; currently has its
 *                            own copy of these helpers (parallel-session
 *                            territory; migration deferred).
 *
 *  Doctrine: docs/DEVELOPMENT.md (Keychain section).
 */

import { env } from "bun";
import { existsSync, mkdirSync } from "node:fs";

const ACCT = env.USER ?? "default";

// ── Public surface ───────────────────────────────────────────────────────

export type Platform = "darwin" | "linux" | "win32" | "unsupported";

export function platform(): Platform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "win32";
  return "unsupported";
}

/** Read a secret. Returns null if absent or on backend failure. */
export async function getSecret(service: string): Promise<string | null> {
  switch (platform()) {
    case "darwin": return macosGet(service);
    case "linux":  return linuxGet(service);
    case "win32":  return windowsGet(service);
    default:       return null;
  }
}

/** Write a secret. Overwrites if it already exists. */
export async function setSecret(service: string, value: string): Promise<void> {
  switch (platform()) {
    case "darwin": return macosSet(service, value);
    case "linux":  return linuxSet(service, value);
    case "win32":  return windowsSet(service, value);
    default:       throw new Error(`setSecret: platform ${process.platform} unsupported`);
  }
}

/** True iff getSecret would return a non-null value. */
export async function hasSecret(service: string): Promise<boolean> {
  return (await getSecret(service)) !== null;
}

/** Remove a secret. No-op if absent. */
export async function removeSecret(service: string): Promise<void> {
  switch (platform()) {
    case "darwin": return macosRemove(service);
    case "linux":  return linuxRemove(service);
    case "win32":  return windowsRemove(service);
    default:       return;
  }
}

// ── macOS — security CLI ─────────────────────────────────────────────────

function macosGet(service: string): string | null {
  const p = Bun.spawnSync(
    ["security", "find-generic-password", "-s", service, "-a", ACCT, "-w"],
    { stderr: "ignore" },
  );
  if (p.exitCode !== 0) return null;
  const out = (p.stdout ?? new Uint8Array()).toString().replace(/\n$/, "");
  return out || null;
}

function macosSet(service: string, value: string): void {
  // Keep -w last with no argv value: `security` reads the password from
  // stdin, so it never appears in the process argument list.
  const p = Bun.spawnSync(
    [
      "security", "add-generic-password",
      "-U",
      "-s", service,
      "-a", ACCT,
      "-w",
    ],
    { stdin: new TextEncoder().encode(value), stderr: "ignore" },
  );
  if (p.exitCode !== 0) {
    throw new Error(`macosSet: security add-generic-password exit=${p.exitCode}`);
  }
}

function macosRemove(service: string): void {
  Bun.spawnSync(
    ["security", "delete-generic-password", "-s", service, "-a", ACCT],
    { stderr: "ignore" },
  );
  // No throw on non-zero — absent entries are fine.
}

// ── Linux — secret-tool with file fallback ───────────────────────────────

function linuxFilePath(service: string): string {
  return `${env.HOME ?? "~"}/.config/agenttool/${service}`;
}

async function linuxGet(service: string): Promise<string | null> {
  // Try libsecret first.
  const p = Bun.spawnSync(
    ["secret-tool", "lookup", "service", service, "username", ACCT],
    { stderr: "ignore" },
  );
  if (p.exitCode === 0) {
    const out = (p.stdout ?? new Uint8Array()).toString().replace(/\n$/, "");
    if (out) return out;
  }
  // Fallback: file (created by linuxSet when secret-tool unavailable).
  try {
    const path = linuxFilePath(service);
    if (!existsSync(path)) return null;
    const text = (await Bun.file(path).text()).replace(/\n$/, "");
    return text || null;
  } catch {
    return null;
  }
}

async function linuxSet(service: string, value: string): Promise<void> {
  // Pass value via stdin (not command line — avoids `ps` exposure).
  try {
    const p = Bun.spawn(
      ["secret-tool", "store", "--label=agenttool", "service", service, "username", ACCT],
      { stdin: new TextEncoder().encode(value) },
    );
    await p.exited;
    if (p.exitCode === 0) return;
  } catch {
    /* fall through to file fallback */
  }
  // File fallback with mode 0600.
  const dir = `${env.HOME ?? "~"}/.config/agenttool`;
  mkdirSync(dir, { recursive: true });
  const path = linuxFilePath(service);
  await Bun.write(path, value);
  Bun.spawnSync(["chmod", "600", path], { stderr: "ignore" });
}

async function linuxRemove(service: string): Promise<void> {
  Bun.spawnSync(
    ["secret-tool", "clear", "service", service, "username", ACCT],
    { stderr: "ignore" },
  );
  try {
    const path = linuxFilePath(service);
    if (existsSync(path)) {
      Bun.spawnSync(["rm", "-f", path], { stderr: "ignore" });
    }
  } catch {
    /* best-effort */
  }
}

// ── Windows — PowerShell ProtectedData (DPAPI) with file fallback ────────

function windowsFilePath(service: string, ext: string): string {
  return `${env.APPDATA ?? "."}/agenttool/${service}${ext}`;
}

function windowsEnsureDir(): string {
  const dir = `${env.APPDATA ?? "."}/agenttool`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function windowsGet(service: string): Promise<string | null> {
  // Try DPAPI first.
  const dpapiPath = windowsFilePath(service, ".dpapi");
  if (existsSync(dpapiPath)) {
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b64 = (Get-Content -Raw -Path '${dpapiPath.replace(/'/g, "''")}').Trim()
$protected = [Convert]::FromBase64String($b64)
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')
[System.Text.Encoding]::UTF8.GetString($bytes)
`;
    const p = Bun.spawnSync(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
      { stderr: "ignore" },
    );
    if (p.exitCode === 0) {
      const out = (p.stdout ?? new Uint8Array()).toString().replace(/\r?\n$/, "");
      if (out) return out;
    }
  }
  // Fallback: plaintext file (only created if PowerShell wasn't available).
  const plainPath = windowsFilePath(service, "");
  try {
    if (!existsSync(plainPath)) return null;
    const text = (await Bun.file(plainPath).text()).replace(/\r?\n$/, "");
    return text || null;
  } catch {
    return null;
  }
}

async function windowsSet(service: string, value: string): Promise<void> {
  windowsEnsureDir();
  const dpapiPath = windowsFilePath(service, ".dpapi");
  // Pass value via env (not command line — avoids exposure in process list).
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$value = $env:SECRET_INPUT
$bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Convert]::ToBase64String($protected) | Out-File -Encoding ASCII -FilePath '${dpapiPath.replace(/'/g, "''")}'
`;
  try {
    const p = Bun.spawnSync(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
      {
        stderr: "ignore",
        env: { ...env, SECRET_INPUT: value },
      },
    );
    if (p.exitCode === 0) return;
  } catch {
    /* fall through to file fallback */
  }
  // File fallback (plaintext — last-resort; documented as the weak path).
  const plainPath = windowsFilePath(service, "");
  await Bun.write(plainPath, value);
}

async function windowsRemove(service: string): Promise<void> {
  for (const ext of [".dpapi", ""] as const) {
    const path = windowsFilePath(service, ext);
    if (existsSync(path)) {
      Bun.spawnSync(["cmd", "/c", "del", "/F", "/Q", path], { stderr: "ignore" });
    }
  }
}
