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
 * - Each ends \r\n, with no other \r in it. ssh writes every line it prints itself that way (log.c's do_log, the client
 *   loop's quit_message); the remote session's stderr passes through as the remote wrote it, which for a shell or script
 *   is a bare \n. A line without \r\n may be the remote's, so it never gives a transport status. (A remote that wrote
 *   \r\n on purpose could still imitate one: Nuance is Yu's own Mac, so this keeps out its noise, not an attacker.)
 * - Each is matched whole, start and end, in the exact form OpenSSH 9.9p2 prints it (the C review's captures), and where
 *   ssh names the host, only when it names the paired one. ssh's line has no separator of its own in front: remote stderr
 *   left without a newline joins the head of ssh's next line, so a classifier that matched only a line's start could take
 *   remote text for ssh's.
 * - A line saying a connection existed and was lost wins over all of them, wherever in the line it is and whatever its
 *   line ending: that request may have been delivered.
 */
// Printed only once a session existed: the client loop's read error, EOF, keepalive timeout and write failures. And drops
// that can come before authentication or after the session started. Matched anywhere in a line (a remote head may precede).
const LOSS = [/Read from remote host /, /Connection to .* closed by remote host/, /Timeout, server\b.*not responding/, /client_loop: /,
  /Broken pipe/, /Connection reset/, /Connection closed by /, /packet_write_(wait|poll)/]
// The one kex failure 9.9p2 prints (capture kex2-rst): a reset after the banners were exchanged, before authentication.
// Its two lines are the only loss-shaped lines that do not read as a loss, and only both, exactly, in this order. A
// hang-up before the server's banner (sshd's MaxStartups included) prints only `Connection closed by <ip> port N`: a loss,
// so unknown (the safe side).
const KEX = /^kex_exchange_identification: read: Connection reset by peer$/
const KEX_PEER = /^Connection reset by \S+ port \d+$/
// Every 9.9p2 host-key failure ends in this line (captures changedkey and unknownhost); it alone decides.
const VERIFY_FAILED = /^Host key verification failed\.$/
const BANNER_TIMEOUT = /^Connection timed out during banner exchange$/
// The changed-key block, for its fingerprint: the bar/warning/bar header, then the fingerprint as one ssh message over
// two lines (the first ends a bare \n, the second \r\n).
const BAR = /^@{59}$/
const WARNING = /^@ {4}WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! {5}@$/
const FP_INTRO = /^The fingerprint for the (ED25519|ECDSA|RSA|DSA) key sent by the remote host is$/
const FP = /^(SHA256:[A-Za-z0-9+/]{43})\.$/
const ERRNO = '(Broken pipe|Connection reset by peer|Connection refused|Host is down|Network is down|Network is unreachable|No route to host|Operation not permitted|Operation timed out)'
const OPEN_ERRNO = '(No such file or directory|Operation not permitted|Permission denied)' // a file ssh could not open
// Whole lines ssh prints that the detail of an `unknown` may show. All closed (no open-ended tail), so remote text at a
// line's head never comes along. Anything else is shown as fixed text.
const KNOWN = [
  /^Connection to \S+ closed by remote host\.$/, /^Timeout, server \S+ not responding\.$/, /^Connection (closed|reset) by \S+ port \d+$/,
  new RegExp(`^Read from remote host \\S+: ${ERRNO}$`), new RegExp(`^client_loop: send disconnect: ${ERRNO}$`),
  new RegExp(`^client_loop: ssh_packet_write_poll: Connection to \\S+ port \\d+: ${ERRNO}$`),
  new RegExp(`^(packet_write_wait|banner exchange): Connection to \\S+ port \\d+: ${ERRNO}$`),
  /^Connection to \S+ port \d+ timed out$/, /^Disconnected from \S+ port \d+$/,
  /^Unable to negotiate with \S+ port \d+: no matching [a-z ]+ found\. Their offer: [A-Za-z0-9@.,+-]+$/,
]
const FIXED_DETAIL = 'ssh exited 255 without a line it is known to print'
// Not a pattern: `Bad owner or permissions on <file>` is checked only for ~/.ssh/config, never for a -F file (a 0666
// -F config connects as usual, as the C review saw), so ssh never prints it for summon. `Too many authentication
// failures` is not one either: its line names an address, not the pinned host, and with IdentitiesOnly and one key it
// cannot happen. Both read unknown.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** One line of stderr as it arrived: its text, and whether it was ssh's own (ended \r\n, no other \r) or maybe the remote's. */
interface Line { text: string; crlf: boolean }
/** Split on raw bytes, before any normalisation: the line ending is what tells ssh's lines from the remote's. */
function linesOf(stderr: string): Line[] {
  const parts = stderr.split('\n')
  const tail = parts.pop()! // after the last \n: '' when stderr ends with one, else a line with no terminator
  const out = parts.map((p) => {
    const body = p.endsWith('\r') ? p.slice(0, -1) : p
    return { text: body.trimEnd(), crlf: p.endsWith('\r') && !body.includes('\r') } // `\r\r\n`, an inner \r: not ssh's
  })
  if (tail !== '') out.push({ text: tail.trimEnd(), crlf: false })
  return out.filter((l) => l.text !== '')
}

/** The whole lines that carry a transport status for this paired entry. With no HostName to anchor to, the host ones are none. */
function patterns(ctx: MapContext) {
  const t = ctx.target ?? {}
  const host = t.host ? esc(t.host.toLowerCase()) : null // ssh prints the HostName lowercased
  const connect = (errs: string) => (host ? [new RegExp(`^ssh: connect to host ${host} port \\d+: (${errs})$`)] : [])
  const config = ctx.config ? esc(ctx.config) : null
  return {
    local: [...connect('Operation not permitted'),
      ...(config ? [new RegExp(`^Can't open user config file ${config}: ${OPEN_ERRNO}$`), new RegExp(`^${config}: line \\d+: Bad configuration option: \\S+$`)] : [])],
    missingKey: t.identityFile ? [new RegExp(`^no such identity: ${esc(t.identityFile)}: ${OPEN_ERRNO}$`)] : [],
    auth: host ? [new RegExp(`^${t.user ? esc(t.user) : '[^@\\s]+'}@${host}: Permission denied \\([a-z,-]+\\)\\.$`)] : [],
    noRoute: [...connect('No route to host|Network is unreachable|Network is down'),
      ...(host ? [new RegExp(`^ssh: Could not resolve hostname ${host}: nodename nor servname provided, or not known$`)] : [])],
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

/**
 * ssh's verification line, with the fingerprint of the key the host presented only when ssh's exact changed-key block is
 * there: the CRLF bar/warning/bar header, then after it the fingerprint message (a bare-\n line, then the CRLF SHA256 one).
 */
function hostKeyDetail(lines: Line[], verify: Line): string {
  const at = (i: number, re: RegExp, crlf: boolean) => lines[i] !== undefined && lines[i]!.crlf === crlf && re.test(lines[i]!.text)
  const h = lines.findIndex((_, i) => at(i, BAR, true) && at(i + 1, WARNING, true) && at(i + 2, BAR, true))
  const f = h < 0 ? -1 : lines.findIndex((_, i) => i > h + 2 && at(i, FP_INTRO, false) && at(i + 1, FP, true))
  if (f < 0) return clean(verify.text)
  return clean(`${verify.text} Presented ${FP_INTRO.exec(lines[f]!.text)![1]} key: ${FP.exec(lines[f + 1]!.text)![1]}`)
}

/**
 * Tells ssh's failures apart. Only ssh's own whole (CRLF) line for a failure known to come before any session keeps a
 * transport status; a connection lost after one (found anywhere in a line), and anything this does not recognise, is
 * `unknown` (never retried). The detail is the line that decided, a closed whole ssh line, or fixed text: never a line
 * that may carry the remote session's text. Order matters: a loss wins over every pre-connect line.
 */
export function mapSshFailure(stderr: string, ctx: MapContext = {}): GateResponse {
  const lines = linesOf(stderr)
  // A transport status comes only from ssh's own (CRLF) whole line.
  const at = (res: RegExp[]) => lines.find((l) => l.crlf && res.some((re) => re.test(l.text)))
  const known = (l: Line) => l.crlf && KNOWN.some((re) => re.test(l.text))
  const detailOf = (l: Line | undefined) => (l && known(l) ? clean(l.text) : FIXED_DETAIL)
  const k = lines.findIndex((l, i) => l.crlf && KEX.test(l.text) && lines[i + 1]?.crlf === true && KEX_PEER.test(lines[i + 1]!.text))
  const losses = lines.filter((l, i) => i !== k && i !== k + 1 && LOSS.some((re) => re.test(l.text)))
  if (losses.length > 0) return { status: 'unknown', detail: detailOf(losses.find(known)) }
  const p = patterns(ctx)
  const local = at(p.local)
  if (local) return { status: 'unreachable', reason: 'no_route', detail: clean(local.text), hint: noRouteHint(ctx.env ?? {}) }
  const verify = at([VERIFY_FAILED])
  if (verify) return { status: 'host_key_mismatch', detail: hostKeyDetail(lines, verify), hint: HOST_KEY_HINT }
  // Printed during user authentication, after the connection: the key ssh was told to offer is not there to offer.
  const missingKey = at(p.missingKey)
  if (missingKey) return { status: 'auth_refused', detail: clean(missingKey.text), hint: `the summon key on this Air is missing or unreadable (${clean(ctx.target!.identityFile!)})` }
  const auth = at(p.auth)
  if (auth) return { status: 'auth_refused', detail: clean(auth.text) }
  if (k >= 0) return { status: 'unreachable', reason: 'timeout', detail: clean(lines[k]!.text) }
  const noRoute = at(p.noRoute)
  if (noRoute) return { status: 'unreachable', reason: 'no_route', detail: clean(noRoute.text), hint: noRouteHint(ctx.env ?? {}) }
  const timeout = at(p.timeout)
  if (timeout) return { status: 'unreachable', reason: 'timeout', detail: clean(timeout.text) }
  return { status: 'unknown', detail: detailOf(lines.at(-1)) }
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
