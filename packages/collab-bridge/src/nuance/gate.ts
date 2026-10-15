// The forced command's closed grammar and its `hello` answer (spec §5.2; R2; T20; P22, P23). The grammar is three
// regexes and nothing else: any other SSH_ORIGINAL_COMMAND (scp, sftp, a shell line, extra spaces) is refused by the
// gate entry (Task 24) with exit 64, and an upload-pack-shaped one also gets a pkt-line ERR git can show.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { NuancePaths } from '../paths.ts'
import type { ResolvedGit } from './git-resolve.ts'
import { dropinStat, readInstalled, readShares, summonKeySha256, type Share } from './installed.ts'
import { readSeatPublicHex } from './seatkey.ts'

export type GateCommand = { form: 'hello' } | { form: 'relay'; nonce: string } | { form: 'upload-pack'; path: string }

/** The whole grammar (§5.2). No flags: `$` is the end of the command, and a regex keeps no state between calls. */
export const GATE_FORMS: { hello: RegExp; relay: RegExp; uploadPack: RegExp } = {
  hello: /^hello$/,
  relay: /^relay 1 ([0-9a-f]{32})$/,
  uploadPack: /^git-upload-pack '(\/[^'!\\\x00-\x1f\x7f]{1,1024})'$/,
}

/** The quoted path is the gitdir, which must fit the 1024-byte form (§5.2's cost line); the regex counts characters. */
export const MAX_UPLOAD_PACK_PATH_BYTES = 1024

export function parseGateCommand(raw: string | undefined): GateCommand | null {
  if (raw === undefined) return null
  if (GATE_FORMS.hello.test(raw)) return { form: 'hello' }
  const relay = GATE_FORMS.relay.exec(raw)
  if (relay) return { form: 'relay', nonce: relay[1]! }
  const pack = GATE_FORMS.uploadPack.exec(raw)
  if (pack && Buffer.byteLength(pack[1]!, 'utf8') <= MAX_UPLOAD_PACK_PATH_BYTES) return { form: 'upload-pack', path: pack[1]! }
  return null
}

/** A refusal git will read: git sends `git-upload-pack '<path>'`, so a refused one of these gets a pkt-line ERR (§5.2). */
export function uploadPackShaped(raw: string | undefined): boolean {
  return raw !== undefined && raw.startsWith('git-upload-pack ')
}

/**
 * The program names a first token may be reported as: the gate's own words and what a misdirected client really runs
 * (file transfer, a shell, git's other two services). Fixed in this file, so no client text is ever matched by shape.
 */
const KNOWN_PROGRAMS: ReadonlySet<string> = new Set([
  'hello', 'relay', 'git-upload-pack', 'git-receive-pack', 'git-upload-archive',
  'scp', 'sftp', 'sftp-server', 'internal-sftp', 'rsync',
  'ssh', 'sh', 'bash', 'zsh', 'ls', 'cat', 'id', 'env', 'uname', 'whoami', 'echo', 'sudo', 'curl', 'claude',
])

/**
 * What the ledger may say about a refused command. The ledger is hash-chained and cannot be redacted later, and a client
 * can put anything in SSH_ORIGINAL_COMMAND, including a prompt, so this is content-free (spec §5.2, C13): the byte length,
 * and the first token only when it is exactly one of KNOWN_PROGRAMS. Summon's describeCommand named any lower-case word
 * of up to 16 characters, so the first word of any prompt got through; this one never reports a word the client chose
 * (Task 63 gate-2-1).
 */
export function describeCommand(raw: string | undefined): string {
  if (raw === undefined) return 'unset'
  const first = raw.split(/\s/, 1)[0]!
  return `len ${Buffer.byteLength(raw, 'utf8')}, first token ${KNOWN_PROGRAMS.has(first) ? `"${first}"` : 'not shown'}`
}

export interface Hello { v: 1; device: string; build: string; prepared: string; expiry: string; user: string; seat_public: string;
  shares: Share[]; git: ResolvedGit; summon: { key_sha256: string; dropin_stat: string };
  summon_now: { key_sha256: string; dropin_stat: string | null }; claude_version: string | null; zshenv_clean: boolean; clock: string }

/**
 * Whether sshd's `$SHELL -c` start prints nothing (K37, R26): `zsh -c 'exit 0' </dev/null` in the home, as sshd starts it,
 * with only HOME and PATH. Anything on stdout would come before the relay's preamble; anything on stderr would muddy the
 * one line the hub reads from a refused gate; a non-zero exit would stop the forced command itself. All three are unclean.
 */
export function zshenvClean(zsh: string, home: string): boolean {
  const r = spawnSync(zsh, ['-c', 'exit 0'], {
    cwd: home, env: { HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
  })
  return r.status === 0 && (r.stdout?.length ?? 0) === 0 && (r.stderr?.length ?? 0) === 0
}

/**
 * `hello`'s one JSON object, or an error and nothing else: a partial hello could pin a device on missing facts (§10.2
 * step 2). The Summon baselines come twice, as INSTALLED recorded them and as they are now (P22), so the live test
 * compares them without a Yu step; Claude's version is the one the installer recorded (P23), since the gate runs no harness.
 */
export function buildHello(o: { paths: NuancePaths; user: string; now: () => Date; zsh: string }): Hello | { error: string } {
  const installed = readInstalled(o.paths)
  if (!installed) return { error: 'INSTALLED is missing or unreadable' }
  const shares = readShares(o.paths)
  if (!shares) return { error: 'shares.json is missing or unreadable' }
  const seat = readSeatPublicHex(o.paths)
  if (!seat) return { error: 'the seat public key is missing or unreadable' }
  let keys: string
  try { keys = readFileSync(o.paths.authorizedKeys, 'utf8') } catch { return { error: 'authorized_keys is unreadable' } }
  return {
    v: 1,
    device: installed.device,
    build: installed.build,
    prepared: installed.prepared,
    expiry: installed.expiry,
    user: o.user,
    seat_public: seat,
    shares,
    git: installed.git,
    summon: { key_sha256: installed.summon_key_sha256, dropin_stat: installed.summon_dropin_stat },
    summon_now: { key_sha256: summonKeySha256(keys), dropin_stat: dropinStat(o.paths.summonDropin) },
    claude_version: installed.claude_version,
    zshenv_clean: zshenvClean(o.zsh, o.paths.home),
    clock: o.now().toISOString(),
  }
}
