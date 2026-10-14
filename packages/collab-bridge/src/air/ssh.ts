// The hub's ssh failure classifier (spec §5.5). Copied, not imported (spec §4.2), from Summon's src/ssh.ts:1-188 at
// b3ef7c95: the patterns, linesOf, the host-key block reader and mapSshFailure's order. Changes from Summon:
// - it returns a DialFailure for the dialer instead of a GateResponse, and carries the presented host-key fingerprint
//   on its own, so the hub can ledger it and show it in the sticky warning (spec §5.5);
// - Summon's `local` patterns are split: `Can't open user config file <config>: …` and `<config>: line N: Bad
//   configuration option: …` are `config` (needs Yu, never retried), while `connect … Operation not permitted`
//   stays unreachable(no_route): that is this Mac's Local Network privacy refusing the caller (K45, §13 S1);
// - the paired entry is read from `Host <alias>` (the hub's `collab-<device>`), and the context names the -F config.
// sshCall is not copied: the dialer spawns ssh itself (Task 48).

export type DialFailure =
  | { status: 'unreachable'; reason: 'no_route' | 'timeout'; detail: string }
  | { status: 'config'; detail: string }
  | { status: 'auth_refused'; detail: string }
  | { status: 'host_key_mismatch'; detail: string; fingerprint: string | null }
  | { status: 'unknown'; detail: string }                   // a loss, or nothing ssh is known to print: back off, never stop

/** What a failure is read against: the paired entry's HostName, User and IdentityFile, and the config given with -F. */
export interface SshContext { host?: string; user?: string; identityFile?: string; config: string }

/**
 * The `Host <alias>` entry of the bridge's ssh config, or null when no line is exactly `Host <alias>`. Only what the
 * classifier needs is read, up to the next Host or Match line; as in ssh, the first value wins.
 */
export function targetOfConfig(configText: string, alias: string): { host?: string; user?: string; identityFile?: string } | null {
  const lines = configText.split('\n')
  const at = lines.indexOf(`Host ${alias}`)
  if (at < 0) return null
  const t: { host?: string; user?: string; identityFile?: string } = {}
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
 * ssh's stderr also carries the remote session's stderr (sshd runs the forced command through macair's login shell, so
 * Nuance's ~/.zshenv runs first), and a remote that exits 255 or is killed by a signal makes ssh exit 255 with no line of
 * its own. So a transport status is read only from ssh's own lines (Summon's rules, unchanged):
 * - Each ends \r\n, with no other \r in it. ssh writes every line it prints itself that way (log.c's do_log, the client
 *   loop's quit_message); the remote session's stderr passes through as the remote wrote it, which for a shell or script
 *   is a bare \n. A line without \r\n may be the remote's, so it never gives a transport status.
 * - Each is matched whole, start and end, in the exact form OpenSSH 9.9p2 prints it, and where ssh names the host, only
 *   when it names the paired one. Remote stderr left without a newline joins the head of ssh's next line, so a
 *   classifier that matched only a line's start could take remote text for ssh's.
 * - A line saying a connection existed and was lost wins over all of them, wherever in the line it is and whatever its
 *   line ending: that link may have carried frames, so the dialer only backs off (unknown), never stops.
 */
// Printed only once a session existed: the client loop's read error, EOF, keepalive timeout and write failures. And drops
// that can come before authentication or after the session started. Matched anywhere in a line (a remote head may precede).
const LOSS = [/Read from remote host /, /Connection to .* closed by remote host/, /Timeout, server\b.*not responding/, /client_loop: /,
  /Broken pipe/, /Connection reset/, /Connection closed by /, /packet_write_(wait|poll)/]
// The one kex failure 9.9p2 prints: a reset after the banners were exchanged, before authentication. Its two lines are
// the only loss-shaped lines that do not read as a loss, and only both, exactly, in this order.
const KEX = /^kex_exchange_identification: read: Connection reset by peer$/
const KEX_PEER = /^Connection reset by \S+ port \d+$/
// Every 9.9p2 host-key failure ends in this line (a changed key and an unknown host); it alone decides.
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

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** One line, printable ASCII only, clipped: the target controls banners, and a detail can reach a hash-chained ledger. */
const clean = (line: string): string => line.slice(0, 200).replace(/[^\x20-\x7e]/g, '?')

/** One line of stderr as it arrived: its text, and whether it was ssh's own (ended \r\n, no other \r) or maybe the remote's. */
interface Line { text: string; crlf: boolean }
/**
 * Split on raw bytes, before any normalisation: the line ending is what tells ssh's lines from the remote's. Only the
 * terminator is stripped (\r\n or \n): a classifier sees the line exactly, so a trailing space, tab or BOM is not ssh's line.
 */
function linesOf(stderr: string): Line[] {
  const parts = stderr.split('\n')
  const tail = parts.pop()! // after the last \n: '' when stderr ends with one, else a line with no terminator
  const out = parts.map((p) => {
    const body = p.endsWith('\r') ? p.slice(0, -1) : p
    return { text: body, crlf: p.endsWith('\r') && !body.includes('\r') } // `\r\r\n`, an inner \r: not ssh's
  })
  if (tail !== '') out.push({ text: tail, crlf: false })
  return out.filter((l) => l.text !== '')
}

/** The whole lines that carry a transport status for this paired entry. With no HostName to anchor to, the host ones are none. */
function patterns(ctx: SshContext) {
  const host = ctx.host ? esc(ctx.host.toLowerCase()) : null // ssh prints the HostName lowercased
  const connect = (errs: string) => (host ? [new RegExp(`^ssh: connect to host ${host} port \\d+: (${errs})$`)] : [])
  const config = esc(ctx.config)
  return {
    config: [new RegExp(`^Can't open user config file ${config}: ${OPEN_ERRNO}$`), new RegExp(`^${config}: line \\d+: Bad configuration option: \\S+$`)],
    localNetwork: connect('Operation not permitted'),
    missingKey: ctx.identityFile ? [new RegExp(`^no such identity: ${esc(ctx.identityFile)}: ${OPEN_ERRNO}$`)] : [],
    auth: host ? [new RegExp(`^${ctx.user ? esc(ctx.user) : '[^@\\s]+'}@${host}: Permission denied \\([a-z,-]+\\)\\.$`)] : [],
    noRoute: [...connect('No route to host|Network is unreachable|Network is down'),
      ...(host ? [new RegExp(`^ssh: Could not resolve hostname ${host}: nodename nor servname provided, or not known$`)] : [])],
    // Asleep, off, away (the ARP reject window answers Host is down), or Remote Login off (refused).
    timeout: [...connect('Operation timed out|Host is down|Connection refused'), ...(host ? [BANNER_TIMEOUT] : [])],
  }
}

/**
 * ssh's verification line, and the fingerprint of the key the host presented only when ssh's exact changed-key block is
 * there: the CRLF bar/warning/bar header, then after it the fingerprint message (a bare-\n line, then the CRLF SHA256 one).
 */
function hostKeyOf(lines: Line[], verify: Line): { detail: string; fingerprint: string | null } {
  const at = (i: number, re: RegExp, crlf: boolean) => lines[i] !== undefined && lines[i]!.crlf === crlf && re.test(lines[i]!.text)
  const h = lines.findIndex((_, i) => at(i, BAR, true) && at(i + 1, WARNING, true) && at(i + 2, BAR, true))
  const f = h < 0 ? -1 : lines.findIndex((_, i) => i > h + 2 && at(i, FP_INTRO, false) && at(i + 1, FP, true))
  if (f < 0) return { detail: clean(verify.text), fingerprint: null }
  const fingerprint = FP.exec(lines[f + 1]!.text)![1]!
  return { detail: clean(`${verify.text} Presented ${FP_INTRO.exec(lines[f]!.text)![1]} key: ${fingerprint}`), fingerprint }
}

/**
 * Tells ssh's failures apart (ssh exited 255). Only ssh's own whole (CRLF) line for a failure known to come before any
 * session keeps a transport status; a connection lost after one (found anywhere in a line), and anything this does not
 * recognise, is `unknown`. The detail is the line that decided, a closed whole ssh line, or fixed text: never a line that
 * may carry the remote session's text. Order matters: a loss wins over every pre-connect line.
 */
export function classifySshFailure(stderr: string, ctx: SshContext): DialFailure {
  const lines = linesOf(stderr)
  // A transport status comes only from ssh's own (CRLF) whole line.
  const at = (res: RegExp[]) => lines.find((l) => l.crlf && res.some((re) => re.test(l.text)))
  const known = (l: Line) => l.crlf && KNOWN.some((re) => re.test(l.text))
  const detailOf = (l: Line | undefined) => (l && known(l) ? clean(l.text) : FIXED_DETAIL)
  const k = lines.findIndex((l, i) => l.crlf && KEX.test(l.text) && lines[i + 1]?.crlf === true && KEX_PEER.test(lines[i + 1]!.text))
  // Only a real kex pair is exempt (k is -1 when there is none, so the first line is checked like any other).
  const losses = lines.filter((l, i) => !(k >= 0 && (i === k || i === k + 1)) && LOSS.some((re) => re.test(l.text)))
  if (losses.length > 0) return { status: 'unknown', detail: detailOf(losses.find(known)) }
  const p = patterns(ctx)
  const config = at(p.config)
  if (config) return { status: 'config', detail: clean(config.text) }
  const local = at(p.localNetwork)
  if (local) return { status: 'unreachable', reason: 'no_route', detail: clean(local.text) }
  const verify = at([VERIFY_FAILED])
  if (verify) return { status: 'host_key_mismatch', ...hostKeyOf(lines, verify) }
  // Printed during user authentication, after the connection: the key ssh was told to offer is not there to offer.
  const missingKey = at(p.missingKey)
  if (missingKey) return { status: 'auth_refused', detail: clean(missingKey.text) }
  const auth = at(p.auth)
  if (auth) return { status: 'auth_refused', detail: clean(auth.text) }
  if (k >= 0) return { status: 'unreachable', reason: 'timeout', detail: clean(lines[k]!.text) }
  const noRoute = at(p.noRoute)
  if (noRoute) return { status: 'unreachable', reason: 'no_route', detail: clean(noRoute.text) }
  const timeout = at(p.timeout)
  if (timeout) return { status: 'unreachable', reason: 'timeout', detail: clean(timeout.text) }
  return { status: 'unknown', detail: detailOf(lines.at(-1)) }
}
