// On the Air, after Yu's install at the device: copy Summon's pinned host key, write the bridge's own ssh config, dial
// `hello` from Terminal (exempt from Local Network privacy, K45), check it against the prepared device file, create,
// sync and lock each share's mirror, and only then record the device as paired (spec §10.2 step 2, §5.6, §7.1; R25).
//   cd / && bun --no-env-file --config=/dev/null <PKG>/scripts/pin-device.ts nuance
import { chmodSync, readFileSync } from 'node:fs'
import { preparedStamp, readDevice, updateDevice, type DeviceFile, type DeviceShare } from '../src/air/devices.ts'
import { airGit } from '../src/air/git.ts'
import { createMirror, liveMirrorDeps, mirrorIdOf, mirrorWorkspaceId, type MirrorDeps, type MirrorSpec } from '../src/air/mirror.ts'
import { parseSeatPublicHex } from '../src/air/seats.ts'
import { classifySshFailure, targetOfConfig, type DialFailure } from '../src/air/ssh.ts'
import { writeFileDurable } from '../src/native.ts'
import type { Hello } from '../src/nuance/gate.ts'
import { gitAcceptable } from '../src/nuance/git-resolve.ts'
import { airPaths, homeOf, type AirPaths } from '../src/paths.ts'
import { mkdirPrivate } from '../src/private-dir.ts'
import { systemBin } from '../src/sysbin.ts'

/** The hello dial: mDNS, ConnectTimeout 8, key exchange, auth, zsh and a cold binary all fit (as the preamble's 30 s does, §5.4). */
export const HELLO_TIMEOUT_MS = 30_000
/** hello is one small JSON line; anything past this is not hello. */
const HELLO_MAX_BYTES = 1024 * 1024

const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/ // Summon's DEVICE_RE
const USER_RE = /^[a-z_][a-z0-9._-]{0,31}$/ // the installer's (Task 57)
/** Summon's pin-nuance writes exactly `summon-nuance ssh-ed25519 <base64>` (SM scripts/pin-nuance.ts). */
const PIN_RE = /^summon-nuance ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const DROPIN_STAT_RE = /^[0-9]+ [0-9]+ [0-9]+ [0-9]+ [0-7]{1,4}$/ // `<ino> <size> <mtime> <uid> <mode>` (P22)
const VERSION_RE = /^[0-9]+\.[0-9]+(\.[0-9]+)*$/
/** What the gate's upload-pack form can carry (spec §5.2): absolute, at most 1024 bytes, no ', !, \ or control character. */
const gateSafe = (p: string) => /^\/[^'!\\\x00-\x1f\x7f]*$/.test(p) && Buffer.byteLength(p, 'utf8') <= 1024

/** The one `summon-nuance <type> <key>` line of Summon's known_hosts, or null when there is none, or more than one. */
export function summonPinLine(text: string): string | null {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.startsWith('summon-nuance '))
  return lines.length === 1 && PIN_RE.test(lines[0]!) ? lines[0]! : null
}

/** §5.6 exactly, with absolute paths built from `home` (ssh opens -F paths and IdentityFile as given, never via $HOME). */
export function collabSshConfig(o: { home: string; device: string; user: string }): string {
  if (!o.home.startsWith('/') || /[\s"'\\#]/.test(o.home)) throw new Error('pin: the Air home must be an absolute path with no spaces or quotes')
  if (!DEVICE_RE.test(o.device)) throw new Error(`pin: bad device name ${JSON.stringify(o.device)}`)
  if (!USER_RE.test(o.user)) throw new Error(`pin: bad user name ${JSON.stringify(o.user)}`)
  const paths = airPaths(o.home)
  return [
    `Host collab-${o.device}`, `  HostName ${o.device}.local`, '  AddressFamily inet', `  User ${o.user}`,
    `  IdentityFile ${paths.sshKey(o.device)}`, '  IdentitiesOnly yes', '  IdentityAgent none', `  HostKeyAlias summon-${o.device}`,
    `  UserKnownHostsFile ${paths.knownHosts}`, '  GlobalKnownHostsFile /dev/null', '  StrictHostKeyChecking yes', '  UpdateHostKeys no',
    '  BatchMode yes', '  ConnectTimeout 8', '  ServerAliveInterval 15', '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no',
    '  ForwardX11 no', '  ClearAllForwardings yes', '  ControlMaster no', '  ControlPath none', '',
  ].join('\n')
}

/**
 * Copies Summon's pinned line into ~/.ssh/collab-bridge/known_hosts and writes the config, both 0600 in a 0700 dir. A
 * copy, because pin-nuance rewrites Summon's file whole and not atomically (K36); `hub doctor` warns when they diverge.
 * Summon pairs only nuance in Phase 0 (K40), so that is the one pin there is to copy.
 */
export function writeCollabSsh(o: { paths: AirPaths; device: string; user: string; summonKnownHosts: string }): void {
  if (o.device !== 'nuance') throw new Error(`pin: Summon pins only nuance in Phase 0 (K40), so ${o.device} has no host key to copy`)
  let text: string
  try { text = readFileSync(o.summonKnownHosts, 'utf8') } catch { throw new Error(`pin: Summon's pin ${o.summonKnownHosts} is missing; pin Summon first`) }
  const line = summonPinLine(text)
  if (line === null) throw new Error(`pin: Summon's pin ${o.summonKnownHosts} does not hold exactly one summon-nuance ssh-ed25519 line`)
  const config = collabSshConfig({ home: o.paths.home, device: o.device, user: o.user })
  mkdirPrivate(o.paths.sshDir)
  chmodSync(o.paths.sshDir, 0o700)
  writeFileDurable(o.paths.knownHosts, `${line}\n`, 0o600)
  writeFileDurable(o.paths.sshConfig, config, 0o600)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const keysAre = (o: Obj, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))
const str = (v: unknown, re?: RegExp): v is string => typeof v === 'string' && (re === undefined || re.test(v))
const HELLO_KEYS = ['v', 'device', 'build', 'prepared', 'expiry', 'user', 'seat_public', 'shares', 'git', 'summon', 'summon_now',
  'claude_version', 'zshenv_clean', 'clock']

/** hello's one JSON line with exactly its fields in their forms (Task 22's Hello), or null. */
export function parseHello(line: string): Hello | null {
  let o: unknown
  try { o = JSON.parse(line) } catch { return null }
  if (!isObj(o) || !keysAre(o, HELLO_KEYS) || o.v !== 1) return null
  if (!str(o.device, DEVICE_RE) || !str(o.build, /^[0-9a-f]{8}$/) || !str(o.prepared, /^[0-9]{14}$/) || !str(o.expiry, /^[0-9]{8}$/)) return null
  if (!str(o.user, USER_RE) || !str(o.seat_public, /^[0-9a-fA-F]{0,128}$/)) return null
  if (!Array.isArray(o.shares) || o.shares.length === 0 || o.shares.length > 64) return null
  for (const s of o.shares) if (!isObj(s) || !keysAre(s, ['realpath', 'gitdir']) || !str(s.realpath) || !str(s.gitdir)) return null
  const g = o.git
  if (!isObj(g) || !keysAre(g, ['path', 'version', 'sha256', 'guard', 'apple']) || !str(g.path) || !g.path.startsWith('/')
    || !str(g.version, VERSION_RE) || !str(g.sha256, HEX64_RE) || typeof g.guard !== 'boolean' || typeof g.apple !== 'boolean') return null
  const s = o.summon
  if (!isObj(s) || !keysAre(s, ['key_sha256', 'dropin_stat']) || !str(s.key_sha256, HEX64_RE) || !str(s.dropin_stat, DROPIN_STAT_RE)) return null
  const n = o.summon_now
  if (!isObj(n) || !keysAre(n, ['key_sha256', 'dropin_stat']) || !str(n.key_sha256, HEX64_RE)
    || !(n.dropin_stat === null || str(n.dropin_stat, DROPIN_STAT_RE))) return null
  if (!(o.claude_version === null || str(o.claude_version)) || typeof o.zshenv_clean !== 'boolean') return null
  if (!str(o.clock) || Number.isNaN(Date.parse(o.clock))) return null
  return o as unknown as Hello
}

/** Every reason this hello cannot pin this prepared device; empty when it can. */
export function checkHello(h: Hello, d: DeviceFile): string[] {
  const problems: string[] = []
  if (h.device !== d.device) problems.push(`hello is from device ${h.device}, not ${d.device}`)
  if (h.user !== d.user) problems.push(`hello's user is ${h.user}; this pairing was prepared for ${d.user}`)
  if (h.build !== d.bundle_build) problems.push(`the device runs build ${h.build}, not the prepared bundle's ${d.bundle_build}: run that bundle's installer`)
  if (h.expiry !== d.key_expiry) problems.push(`the device's collab key expires ${h.expiry}, not the prepared ${d.key_expiry}: run that bundle's installer`)
  // Build and expiry are the same for a second prepare of the same commit on the same day, so only the prepare stamp tells a
  // device installed from the earlier bundle (older trailer, tool list, caps) from this file's: it is not pinned against it.
  if (h.prepared !== preparedStamp(d.prepared_at)) {
    problems.push(`the device runs the bundle prepared ${h.prepared}, not the prepared file's ${preparedStamp(d.prepared_at)}: run that bundle's installer`)
  }
  const reported = new Set(h.shares.map((s) => s.realpath))
  const prepared = new Set(d.shares.map((s) => s.remote_realpath))
  for (const p of prepared) if (!reported.has(p)) problems.push(`the prepared share ${p} is not among the shares the device reports`)
  for (const s of h.shares) {
    if (!prepared.has(s.realpath)) problems.push(`the device shares ${s.realpath}, which this pairing did not prepare`)
    else if (!gateSafe(s.gitdir)) problems.push(`the gitdir of ${s.realpath} cannot pass the gate's upload-pack form`)
  }
  if (parseSeatPublicHex(h.seat_public) === null) problems.push("hello's seat public key is not a valid ed25519 key")
  if (!gitAcceptable(h.git)) problems.push(`the device's recorded git ${h.git.path} (${h.git.version}) has no lazy-fetch guard: it needs git ≥ 2.45.1, or an Apple git ≥ 2.39.5 with the guard, then a reinstall`)
  if (!h.zshenv_clean) problems.push('~/.zshenv on the device prints when a shell starts (login_shell_noise): make it silent, then pin again')
  return problems
}

function describeFailure(f: DialFailure): string {
  return `${f.status}${f.status === 'unreachable' ? ` (${f.reason})` : ''}: ${f.detail}`
}

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; over: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size <= max) chunks.push(chunk)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), over: size > max }
}

/** `ssh -F <config> <alias> hello`, once, with a 30 s limit; an env from explicit keys only (P14). */
async function dialHello(ssh: string, home: string, config: string, alias: string): Promise<{ ok: true; line: string } | { ok: false; problem: string }> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([ssh, '-F', config, alias, 'hello'], { cwd: '/', env: { HOME: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  } catch (e) {
    return { ok: false, problem: `ssh could not start: ${e instanceof Error ? e.message : String(e)}` }
  }
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, HELLO_TIMEOUT_MS)
  try {
    const [out, err] = await Promise.all([readCapped(proc.stdout as ReadableStream<Uint8Array>, HELLO_MAX_BYTES),
      readCapped(proc.stderr as ReadableStream<Uint8Array>, 64 * 1024)])
    const code = await proc.exited
    if (timedOut) return { ok: false, problem: `ssh: no answer to hello within ${HELLO_TIMEOUT_MS / 1000} s` }
    if (code === 255) {
      let configText = ''
      try { configText = readFileSync(config, 'utf8') } catch { /* classified without a target */ }
      return { ok: false, problem: `ssh: ${describeFailure(classifySshFailure(err.text, { ...targetOfConfig(configText, alias), config }))}` }
    }
    const said = err.text.trim().split('\n')[0]?.replace(/[^\x20-\x7e]/g, '?').slice(0, 200) ?? ''
    if (code !== 0) return { ok: false, problem: `the device's gate refused hello (exit ${code}): ${said}` }
    const lines = out.text.split('\n').filter((l) => l !== '')
    if (out.over || lines.length !== 1) return { ok: false, problem: 'hello did not answer exactly one line (is ~/.zshenv on the device printing?)' }
    return { ok: true, line: lines[0]! }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pins one prepared device. Nothing about the device is recorded unless every check passes and every mirror exists: the
 * mirrors are created, synced and locked first, and only then does the device file become `paired` (the hub dials only
 * paired devices, so no session can bind before its mirror exists, §7.1, K17). The ssh config and the known_hosts copy
 * are written before the dial, which needs them.
 */
export async function pinDevice(o: { paths: AirPaths; device: string; ssh: string; mirrorDeps: MirrorDeps; now(): Date }):
  Promise<{ ok: true; device: DeviceFile } | { ok: false; problems: string[] }> {
  const fail = (problem: string) => ({ ok: false as const, problems: [problem] })
  if (!DEVICE_RE.test(o.device)) return fail(`bad device name ${JSON.stringify(o.device)}`)
  const file = o.paths.deviceFile(o.device)
  const d = readDevice(file)
  if (d === null) return fail(`no readable device file ${file}: run prepare-pairing first`)
  if (d.state === 'unpaired') return fail(`${o.device} was unpaired; run prepare-pairing again first`)
  try {
    writeCollabSsh({ paths: o.paths, device: d.device, user: d.user, summonKnownHosts: o.paths.summonKnownHosts })
  } catch (e) {
    return fail(e instanceof Error ? e.message.replace(/^pin: /, '') : String(e))
  }
  const dial = await dialHello(o.ssh, o.paths.home, o.paths.sshConfig, d.host_alias)
  if (!dial.ok) return fail(dial.problem)
  const h = parseHello(dial.line)
  if (h === null) return fail('hello did not answer a well-formed hello line')
  const problems = checkHello(h, d)
  if (problems.length > 0) return { ok: false, problems }

  const pinned = new Map<string, { gitdir: string; mirrorId: string; workspaceId: string }>()
  for (const s of d.shares) {
    const reported = h.shares.find((x) => x.realpath === s.remote_realpath)!
    const mirrorId = mirrorIdOf(reported.realpath) // recomputed from the realpath the device reports
    const spec: MirrorSpec = { device: d.device, user: d.user, mirrorId, mirrorPath: o.paths.mirrorDir(d.device, d.user, mirrorId),
      airClone: s.air_clone, remoteGitdir: reported.gitdir, caps: s.caps }
    const m = await createMirror(spec, o.mirrorDeps)
    if (!m.ok) return fail(`the mirror of ${reported.realpath}: ${m.code}: ${m.message}`)
    const ws = await mirrorWorkspaceId(spec, o.mirrorDeps)
    if (ws === null) return fail(`the mirror of ${reported.realpath}: git could not name its repository, so its workspace id is unknown`)
    pinned.set(s.remote_realpath, { gitdir: reported.gitdir, mirrorId, workspaceId: ws })
  }
  const at = o.now().toISOString()
  let written: DeviceFile | null
  try {
    written = updateDevice(file, (cur) => {
      // Re-read under the lock: an unpair, or a new prepare since the read above (another build, or the same build with a new
      // key, user or share settings: every prepare writes a new prepared_at) wins, and nothing is written. hello was checked
      // against the file as it was read above, so a file that is not that one is not recorded as paired from it.
      if (cur.state === 'unpaired' || cur.device !== d.device || cur.user !== d.user || cur.bundle_build !== d.bundle_build
        || cur.key_expiry !== d.key_expiry || cur.prepared_at !== d.prepared_at || cur.shares.length !== pinned.size) return null
      const shares: DeviceShare[] = []
      for (const s of cur.shares) {
        const p = pinned.get(s.remote_realpath)
        if (p === undefined) return null
        // A workspace id Collab already confirmed or corrected (Task 51) is kept; a first pin takes the derived one (P55).
        shares.push({ ...s, remote_gitdir: p.gitdir, mirror_id: p.mirrorId, workspace_id: s.workspace_id ?? p.workspaceId })
      }
      return { ...cur, state: 'paired', seat_public: h.seat_public, git: h.git,
        summon: { key_sha256: h.summon.key_sha256, dropin_stat: h.summon.dropin_stat }, shares, paired_at: at }
    })
  } catch (e) {
    return fail(`the device file could not be written: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (written === null) return fail('the device file changed while pinning (a new prepare or an unpair); nothing was recorded')
  return { ok: true, device: written }
}

/** What the script prints after a pin: the device, its git, and each locked mirror. */
export function pinnedText(d: DeviceFile, paths: AirPaths): string {
  const day = `${d.key_expiry.slice(0, 4)}-${d.key_expiry.slice(4, 6)}-${d.key_expiry.slice(6)}`
  return [
    `paired: ${d.device} (${d.user}), build ${d.bundle_build}, the collab key expires ${day}`,
    ...(d.git ? [`the device's git: ${d.git.path} ${d.git.version}, lazy-fetch guard ${d.git.guard ? 'yes' : 'no'}`] : []),
    ...d.shares.map((s) => `mirror ${paths.mirrorDir(d.device, d.user, s.mirror_id)} (locked) of ${s.remote_realpath}, workspace ${s.workspace_id ?? 'unknown'}`),
    '',
  ].join('\n')
}

async function pinMain(argv: string[]): Promise<number> {
  if (argv.length !== 1 || !DEVICE_RE.test(argv[0]!)) {
    process.stderr.write('usage: bun --no-env-file --config=/dev/null scripts/pin-device.ts <device>\n')
    return 2
  }
  const device = argv[0]!
  const home = homeOf()
  const paths = airPaths(home)
  const ssh = systemBin('ssh')
  const mirrorDeps = liveMirrorDeps({ paths, git: airGit({ git: systemBin('git'), home }), ssh, alias: `collab-${device}` })
  const r = await pinDevice({ paths, device, ssh, mirrorDeps, now: () => new Date() })
  if (!r.ok) {
    for (const p of r.problems) process.stderr.write(`✗ ${p}\n`)
    process.stderr.write('Nothing was recorded as paired.\n')
    return 1
  }
  process.stdout.write(pinnedText(r.device, paths))
  return 0
}

if (import.meta.main) void pinMain(process.argv.slice(2)).then((code) => process.exit(code))
