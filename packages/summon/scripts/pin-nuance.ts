// On the Air, after the installer ran on Nuance: record Nuance's user, its host key and the summon key's expiry.
//   bun scripts/pin-nuance.ts --user <name> --host-key "ssh-ed25519 AAAA… root@Nuance" --expires <YYYYMMDD>
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * What to do after pinning: compare the pinned key's fingerprint with the one the installer printed on Nuance, then put
 * `summon` on PATH (the Phase 0 front door) and try it. `pkg` is packages/summon.
 */
export function pinnedText(pkg: string, fingerprint: string): string {
  return [`pinned. The pinned host key of Nuance: ${fingerprint}`,
    'It must be the fingerprint the installer printed on Nuance (the ssh-keygen line under "host key:").',
    'If it is not the same, stop here and tell Ai: do not use summon.',
    'Next, once: put `summon` on PATH. If ~/.local/bin/summon is already this link, skip this; if it is some other file,',
    'do not run it: tell Ai.', `  mkdir -p ~/.local/bin && ln -sf "${join(pkg, 'bin', 'summon.ts')}" ~/.local/bin/summon`,
    'then try: summon nuance inventory', ''].join('\n')
}

/** The one host key line pin-nuance takes: ssh-ed25519, its base64 key, and any comment. */
const HOST_KEY_LINE = /^(ssh-ed25519) ([A-Za-z0-9+/=]+)(?: .*)?$/
function parseHostKey(line: string): { type: string; b64: string } {
  const m = HOST_KEY_LINE.exec(line.trim())
  if (!m) throw new Error('expected the ssh-ed25519 host key line the installer printed')
  return { type: m[1]!, b64: m[2]! }
}

/** The key's SHA256 fingerprint as `ssh-keygen -lf` prints it: sha256 of the raw key bytes, base64 without padding. */
export function hostKeyFingerprint(line: string): string {
  const raw = Buffer.from(parseHostKey(line).b64, 'base64')
  return `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`
}

/** A real calendar date written YYYYMMDD. */
function isYyyymmdd(s: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
}

/**
 * Writes (or rewrites) the pinned known_hosts line, the `summon-nuance` ssh config and the summon key's expiry (the
 * "key expires:" line the installer printed, so it is what Nuance really has) in `dir`, all private.
 */
export function writeSshConfig(dir: string, user: string, hostKeyLine: string, expires: string): void {
  if (!/^[a-z_][a-z0-9._-]{0,31}$/i.test(user)) throw new Error('bad user name')
  const key = parseHostKey(hostKeyLine)
  if (!isYyyymmdd(expires)) throw new Error('expected the YYYYMMDD key expiry the installer printed')
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
  // The mode of writeFileSync only applies when the file is new, so a re-pin sets it again.
  const put = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text, { mode: 0o600 }); chmodSync(p, 0o600) }
  put('known_hosts', `summon-nuance ${key.type} ${key.b64}\n`)
  put('config', [
    'Host summon-nuance', '  HostName nuance.local', '  AddressFamily inet', `  User ${user}`,
    `  IdentityFile ${join(dir, 'summon_nuance_ed25519')}`, '  IdentitiesOnly yes', '  HostKeyAlias summon-nuance',
    `  UserKnownHostsFile ${join(dir, 'known_hosts')}`, '  StrictHostKeyChecking yes', '  BatchMode yes', '  ConnectTimeout 8',
    '  ServerAliveInterval 15', '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no', '  ClearAllForwardings yes', '',
  ].join('\n'))
  put('expiry', `${expires}\n`)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
  const user = get('--user'); const hostKey = get('--host-key'); const expires = get('--expires')
  if (!user || !hostKey || !expires) {
    console.error('usage: bun scripts/pin-nuance.ts --user <name> --host-key "<line>" --expires <YYYYMMDD>  (the pin line the installer printed)')
    process.exit(2)
  }
  writeSshConfig(join(homedir(), '.ssh', 'summon'), user, hostKey, expires)
  process.stdout.write(pinnedText(join(import.meta.dir, '..'), hostKeyFingerprint(hostKey)))
}
