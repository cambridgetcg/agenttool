import { spawnSync } from 'node:child_process'
import type { GateResponse } from './status.ts'

export const SSH_TIMEOUT_MS = 60_000

/** The caller's environment, as far as a hint reads it: which sandbox, if any, summon runs in. */
export type Env = Record<string, string | undefined>
/** What the summon ssh config says about the paired device. ssh names these in the pre-connect lines it prints. */
export interface SshTarget { host?: string; user?: string; identityFile?: string }
export interface SshDeps { sshBin: string; sshConfig: string; timeoutMs?: number; env?: Env; target?: SshTarget }
/** What a failure is read against: the paired entry, the config path ssh was given with -F, and the caller's environment. */
export interface MapContext { target?: SshTarget; config?: string; env?: Env }

/**
 * The `Host summon-<device>` entry of the summon ssh config, or null when no line is exactly `Host summon-<device>`.
 * Only what the classifier needs is read, up to the next Host or Match line; as in ssh, the first value wins.
 */
export function targetOf(config: string, device: string): SshTarget | null {
  const lines = config.split('\n')
  const at = lines.indexOf(`Host summon-${device}`)
  if (at < 0) return null
  const t: SshTarget = {}
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(Host|Match)\s/i.test(line)) break
    const m = /^\s*(HostName|User|IdentityFile)(?:\s*=\s*|\s+)(\S+)\s*$/i.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    if (key === 'hostname') t.host ??= m[2]
    else if (key === 'user') t.user ??= m[2]
    else t.identityFile ??= m[2]
  }
  return t
}

/*
 * ssh's stderr also carries the remote session's stderr (sshd runs the forced command through Yu's login shell, so
 * Nuance's ~/.zshenv runs first), and a remote that exits 255 or is killed by a signal makes ssh exit 255 with no line of
 * its own. So a transport status is read only from ssh's own lines:
 * - Each ends \r\n. ssh writes every line it prints itself that way (log.c's do_log, the client loop's quit_message);
 *   the remote session's stderr passes through as the remote wrote it, which for a shell or script is a bare \n. A line
 *   without \r\n may be the remote's, so it never gives a transport status. (A remote that wrote \r\n on purpose could
 *   still imitate one: Nuance is Yu's own Mac, so this keeps out its noise, not an attacker.)
 * - Each is matched whole and, where ssh names the host, only when it names the paired one.
 * - Any line saying a connection existed and was lost wins over all of them, whatever its line ending: that request may
 *   have been delivered.
 */
// Printed only once a session existed: the client loop's read error, EOF, keepalive timeout and write failures.
const SESSION_LOST = [/^Read from remote host /, /^Connection to .* closed by remote host/, /^Timeout, server\b.*not responding/, /client_loop: /]
// A drop that can come before authentication or after the session started: unknown, unless a kex line places it before.
const DROP = [/Broken pipe/, /Connection reset/, /^Connection closed by /, /packet_write_(wait|poll)/]
// On OpenSSH 9.9p2 a hang-up before the server's banner (sshd's MaxStartups included) prints only
// `Connection closed by <ip> port N`, a DROP, so it reads unknown (the safe side). Only a reset after the banners were
// exchanged prints this line, and that is still before authentication: unreachable(timeout).
const KEX = /^kex_exchange_identification: /
const VERIFY_FAILED = /^Host key verification failed\.$/
const HOST_KEY = [VERIFY_FAILED, /^@+ *WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! *@+$/, /^No \S+ host key is known for /]
const BANNER_TIMEOUT = /^Connection timed out during banner exchange$/
// Lines ssh itself prints that are not classified further: a detail may show them (ssh exits right after its own line).
// Anything else on stderr may be the remote session's, so the detail is then fixed text.
const SSH_OWN = /^(ssh: |ssh_\w+: |client_loop: |packet_write_\w+: |banner exchange: |kex_exchange_identification: |Unable to negotiate |Connection (to|closed by|reset by) |Disconnected from |Received disconnect from |Timeout, server |Read from remote host |Bad packet length |Corrupted MAC |Host key |No \S+ host key is known |Can't open user config file |no such identity: )/
const FIXED_DETAIL = 'ssh exited 255 without a line it is known to print'
// Not a pattern: `Bad owner or permissions on <file>` is checked only for ~/.ssh/config, never for a -F file (a 0666
// -F config connects as usual, as the C review saw), so ssh never prints it for summon. `Too many authentication
// failures` is not one either: its line names an address, not the pinned host, and with IdentitiesOnly and one key it
// cannot happen. Both read unknown.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** One line of stderr as it arrived: its text, and whether it ended \r\n (ssh's own) or not (maybe the remote's). */
interface Line { text: string; crlf: boolean }
/** Split on raw bytes, before any normalisation: the line ending is what tells ssh's lines from the remote's. */
function linesOf(stderr: string): Line[] {
  const parts = stderr.split('\n')
  const tail = parts.pop()! // after the last \n: '' when stderr ends with one, else a line with no terminator
  const out = parts.map((p) => (p.endsWith('\r') ? { text: p.slice(0, -1).trimEnd(), crlf: true } : { text: p.trimEnd(), crlf: false }))
  if (tail !== '') out.push({ text: tail.trimEnd(), crlf: false })
  return out.filter((l) => l.text !== '')
}

/** The lines that carry a transport status for this paired entry. With no HostName to anchor to, there are none. */
function patterns(ctx: MapContext) {
  const t = ctx.target ?? {}
  const host = t.host ? esc(t.host.toLowerCase()) : null // ssh prints the HostName lowercased
  const connect = (errs: string) => (host ? [new RegExp(`^ssh: connect to host ${host} port \\d+: (${errs})$`)] : [])
  const config = ctx.config ? esc(ctx.config) : null
  return {
    local: [...connect('Operation not permitted'),
      ...(config ? [new RegExp(`^Can't open user config file ${config}: `), new RegExp(`^${config}: line \\d+: Bad configuration option: `)] : [])],
    missingKey: t.identityFile ? [new RegExp(`^no such identity: ${esc(t.identityFile)}: `)] : [],
    auth: host ? [new RegExp(`^${t.user ? esc(t.user) : '[^@\\s]+'}@${host}: Permission denied \\([a-z,-]+\\)\\.$`)] : [],
    noRoute: [...connect('No route to host|Network is unreachable|Network is down'), ...(host ? [new RegExp(`^ssh: Could not resolve hostname ${host}(: .*)?$`)] : [])],
    // Asleep, off, away (the ARP reject window answers Host is down), or Remote Login off (refused).
    timeout: [...connect('Operation timed out|Host is down|Connection refused'), ...(host ? [BANNER_TIMEOUT] : [])],
  }
}

export const HOST_KEY_HINT = 'security event — Nuance presented a different host key. Do not re-pin from the network. On Nuance run ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; only if it shows this fingerprint and you know why it changed, re-pin with bun scripts/pin-nuance.ts --user <your Nuance user> --host-key "<line read on Nuance>" --expires <YYYYMMDD from the hand-back>'

/** One line, printable ASCII only, clipped: the target controls banners, and a detail can reach a hash-chained ledger. */
const clean = (line: string): string => line.slice(0, 200).replace(/[^\x20-\x7e]/g, '?')

/** The harness sandbox summon runs in, named by the variable that says so, or null. */
export function sandboxOf(env: Env): string | null {
  const said = (k: string) => `${k}=${clean(env[k]!).slice(0, 40)}`
  if (env.CODEX_SANDBOX) return `the Codex sandbox (${said('CODEX_SANDBOX')})`
  if (env.CODEX_SANDBOX_NETWORK_DISABLED) return `the Codex sandbox (${said('CODEX_SANDBOX_NETWORK_DISABLED')})`
  if (env.SANDBOX_RUNTIME) return `a harness sandbox (${said('SANDBOX_RUNTIME')}, as Claude Code's sandbox sets)`
  return null
}

/** What unreachable(no_route) may mean when Nuance is in fact on the LAN: this Mac is blocking the caller. */
export function noRouteHint(env: Env): string {
  const box = sandboxOf(env)
  return box ? `summon ran inside ${box}, which can keep ssh off the LAN: rerun it outside the sandbox`
    : 'if Nuance is awake on the LAN, the Air may be blocking this caller (macOS Local Network privacy for the app that started it — System Settings › Privacy & Security › Local Network — or a harness sandbox)'
}

/** ssh's verification line, with the fingerprint of the key the host presented when ssh printed one. */
function hostKeyDetail(lines: Line[], first: Line): string {
  const failed = lines.find((l) => l.crlf && VERIFY_FAILED.test(l.text)) ?? first
  // One ssh message over two lines: only its last line ends \r\n, so the inner one is found by its text.
  const i = lines.findIndex((l) => /^The fingerprint for the \S+ key sent by the remote host is$/.test(l.text))
  const type = i >= 0 ? /^The fingerprint for the (\S+) key/.exec(lines[i]!.text)![1] : undefined
  const fp = i >= 0 ? /^(SHA256:[A-Za-z0-9+/]+=*)\.?$/.exec(lines[i + 1]?.text ?? '')?.[1] : undefined
  return clean(fp ? `${failed.text} Presented ${type} key: ${fp}` : failed.text)
}

/**
 * Tells ssh's failures apart. Only ssh's own (CRLF) line for a failure known to come before any session keeps a
 * transport status; a connection lost after one, and anything this does not recognise, is `unknown` (never retried).
 * The line that decided is the detail, and never a line that may be the remote session's. Order matters: a loss wins
 * over every pre-connect line, which remote stderr could imitate.
 */
export function mapSshFailure(stderr: string, ctx: MapContext = {}): GateResponse {
  const lines = linesOf(stderr)
  const matches = (l: Line, res: RegExp[]) => res.some((re) => re.test(l.text))
  // A transport status comes only from ssh's own (CRLF) line; a detail shows only such a line, or fixed text.
  const at = (res: RegExp[]) => lines.find((l) => l.crlf && matches(l, res))
  const isOwn = (l: Line) => l.crlf && SSH_OWN.test(l.text)
  const own = (l: Line | undefined) => (l && isOwn(l) ? clean(l.text) : FIXED_DETAIL)
  const kex = lines.find((l) => l.crlf && KEX.test(l.text))
  const losses = [...lines.filter((l) => matches(l, SESSION_LOST)), ...(kex ? [] : lines.filter((l) => matches(l, DROP)))]
  if (losses.length > 0) return { status: 'unknown', detail: own(losses.find(isOwn)) }
  const p = patterns(ctx)
  const local = at(p.local)
  if (local) return { status: 'unreachable', reason: 'no_route', detail: clean(local.text), hint: noRouteHint(ctx.env ?? {}) }
  const hostKey = at(HOST_KEY)
  if (hostKey) return { status: 'host_key_mismatch', detail: hostKeyDetail(lines, hostKey), hint: HOST_KEY_HINT }
  // Printed during user authentication, after the connection: the key ssh was told to offer is not there to offer.
  const missingKey = at(p.missingKey)
  if (missingKey) return { status: 'auth_refused', detail: clean(missingKey.text), hint: `the summon key on this Air is missing or unreadable (${clean(ctx.target!.identityFile!)})` }
  const auth = at(p.auth)
  if (auth) return { status: 'auth_refused', detail: clean(auth.text) }
  if (kex) return { status: 'unreachable', reason: 'timeout', detail: clean(kex.text) }
  const noRoute = at(p.noRoute)
  if (noRoute) return { status: 'unreachable', reason: 'no_route', detail: clean(noRoute.text), hint: noRouteHint(ctx.env ?? {}) }
  const timeout = at(p.timeout)
  if (timeout) return { status: 'unreachable', reason: 'timeout', detail: clean(timeout.text) }
  return { status: 'unknown', detail: own(lines.at(-1)) }
}

export function sshCall(deps: SshDeps, device: string, remote: string, stdin?: string): GateResponse {
  const timeoutMs = deps.timeoutMs ?? SSH_TIMEOUT_MS
  const r = spawnSync(deps.sshBin, ['-F', deps.sshConfig, `summon-${device}`, remote], { input: stdin ?? '', encoding: 'utf8', timeout: timeoutMs })
  // r.error is checked on its own: after a timeout r.stderr is '' (not null), so `r.stderr ?? r.error` would never see the error.
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'unreachable', reason: 'no_route', detail: 'ssh not found' }
    if (code === 'ETIMEDOUT') return { status: 'unknown', detail: `ssh gave no answer within ${timeoutMs} ms` }
    return { status: 'unknown', detail: clean(`ssh could not finish: ${r.error.message}`.trim().split('\n').filter(Boolean).at(-1)!) }
  }
  if (r.signal) return { status: 'unknown', detail: `ssh was killed by ${r.signal}` }
  if (r.status === 255) return mapSshFailure(String(r.stderr ?? ''), { target: deps.target, config: deps.sshConfig, env: deps.env ?? process.env })
  const last = String(r.stdout ?? '').trim().split('\n').pop() ?? ''
  try {
    const answer: unknown = JSON.parse(last)
    if (answer !== null && typeof answer === 'object' && !Array.isArray(answer) && typeof (answer as { status?: unknown }).status === 'string') return answer as GateResponse
  } catch { /* falls through */ }
  return { status: 'unknown', detail: 'no readable answer from the target' }
}
