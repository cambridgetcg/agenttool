// On the Air, after the installer ran on Nuance: record Nuance's user and host key.
//   bun scripts/pin-nuance.ts --user <name> --host-key "ssh-ed25519 AAAA… root@Nuance"
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Writes (or rewrites) the pinned known_hosts line and the `summon-nuance` ssh config in `dir`, all private. */
export function writeSshConfig(dir: string, user: string, hostKeyLine: string): void {
  if (!/^[a-z_][a-z0-9._-]{0,31}$/i.test(user)) throw new Error('bad user name')
  const m = /^(ssh-ed25519) ([A-Za-z0-9+/=]+)(?: .*)?$/.exec(hostKeyLine.trim())
  if (!m) throw new Error('expected the ssh-ed25519 host key line the installer printed')
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
  // The mode of writeFileSync only applies when the file is new, so a re-pin sets it again.
  const put = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text, { mode: 0o600 }); chmodSync(p, 0o600) }
  put('known_hosts', `summon-nuance ${m[1]} ${m[2]}\n`)
  put('config', [
    'Host summon-nuance', '  HostName nuance.local', '  AddressFamily inet', `  User ${user}`,
    `  IdentityFile ${join(dir, 'summon_nuance_ed25519')}`, '  IdentitiesOnly yes', '  HostKeyAlias summon-nuance',
    `  UserKnownHostsFile ${join(dir, 'known_hosts')}`, '  StrictHostKeyChecking yes', '  BatchMode yes', '  ConnectTimeout 8',
    '  ServerAliveInterval 15', '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no', '  ClearAllForwardings yes', '',
  ].join('\n'))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
  const user = get('--user'); const hostKey = get('--host-key')
  if (!user || !hostKey) { console.error('usage: bun scripts/pin-nuance.ts --user <name> --host-key "<line>"'); process.exit(2) }
  writeSshConfig(join(homedir(), '.ssh', 'summon'), user, hostKey)
  console.log('pinned. try: summon nuance inventory')
}
