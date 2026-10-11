import { spawnSync } from 'node:child_process'
import type { GateResponse } from './status.ts'

export const SSH_TIMEOUT_MS = 60_000

/** The caller's environment, as far as a hint reads it: which sandbox, if any, summon runs in. */
export type Env = Record<string, string | undefined>
export interface SshDeps { sshBin: string; sshConfig: string; timeoutMs?: number; env?: Env }

/*
 * ssh's stderr also carries the remote session's stderr (sshd runs the forced command through Yu's login shell, so
 * Nuance's ~/.zshenv runs first). So a transport status is read only from ssh's own lines, each matched whole, and any
 * line saying a connection existed and was lost wins over all of them: that request may have been delivered.
 */
// Printed only once a session existed: the client loop's read error, EOF, keepalive timeout and write failures.
const SESSION_LOST = [/^Read from remote host /, /^Connection to .* closed by remote host/, /^Timeout, server\b.*not responding/, /client_loop: /]
// A drop that can come before authentication or after the session started. Only a kex line places it before (R11).
const DROP = [/Broken pipe/, /Connection reset/, /^Connection closed by /, /packet_write_(wait|poll)/]
// The server hung up during the identification exchange (sshd's MaxStartups, a restarting sshd): before authentication.
const KEX = [/^kex_exchange_identification: /]
// Failures on this Mac, before any connection: a sandbox or privacy layer, or a broken summon ssh entry or key file.
const LOCAL = [/^ssh: connect to (host|address) .*: Operation not permitted$/, /^Can't open user config file /, /^Bad owner or permissions on /,
  /: line \d+: Bad configuration option: /, /^no such identity: /]
const VERIFY_FAILED = /^Host key verification failed\.$/
const HOST_KEY = [VERIFY_FAILED, /^@+ *WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! *@+$/, /^No \S+ host key is known for /]
const AUTH = [/: Permission denied \([a-z,-]+\)\.$/, /^Received disconnect from .*: Too many authentication failures/]
const NO_ROUTE = [/^ssh: connect to (host|address) .*: (No route to host|Network is unreachable|Network is down)$/, /^ssh: Could not resolve hostname /]
// Asleep, off, away (the ARP reject window answers Host is down), or Remote Login off (refused).
const TIMEOUT = [/^ssh: connect to (host|address) .*: (Operation timed out|Host is down|Connection refused)$/, /^Connection timed out during banner exchange$/]

export const HOST_KEY_HINT = 'security event — Nuance presented a different host key. Do not re-pin from the network. On Nuance run ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; only if it shows this fingerprint and you know why it changed, re-pin with bun scripts/pin-nuance.ts --host-key "<line read on Nuance>"'

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
function hostKeyDetail(lines: string[], first: string): string {
  const failed = lines.find((l) => VERIFY_FAILED.test(l)) ?? first
  const i = lines.findIndex((l) => /^The fingerprint for the \S+ key sent by the remote host is$/.test(l))
  const type = i >= 0 ? /^The fingerprint for the (\S+) key/.exec(lines[i]!)![1] : undefined
  const fp = i >= 0 ? /^(SHA256:[A-Za-z0-9+/]+=*)\.?$/.exec(lines[i + 1] ?? '')?.[1] : undefined
  return clean(fp ? `${failed} Presented ${type} key: ${fp}` : failed)
}

/**
 * Tells ssh's failures apart. Only ssh's own line for a failure known to come before any session keeps a transport
 * status; a connection lost after one, and anything this does not recognise, is `unknown` (never retried). The line
 * that decided is the detail. Order matters: a loss wins over every pre-connect line, which remote stderr could imitate.
 */
export function mapSshFailure(stderr: string, env: Env = {}): GateResponse {
  const lines = stderr.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).filter(Boolean) // ssh ends its lines \r\n
  const at = (res: RegExp[]) => lines.find((l) => res.some((re) => re.test(l)))
  const lost = at(SESSION_LOST) ?? (at(KEX) ? undefined : at(DROP))
  if (lost) return { status: 'unknown', detail: clean(lost) }
  const local = at(LOCAL)
  if (local) return { status: 'unreachable', reason: 'no_route', detail: clean(local), hint: noRouteHint(env) }
  const hostKey = at(HOST_KEY)
  if (hostKey) return { status: 'host_key_mismatch', detail: hostKeyDetail(lines, hostKey), hint: HOST_KEY_HINT }
  const auth = at(AUTH)
  if (auth) return { status: 'auth_refused', detail: clean(auth) }
  const kex = at(KEX)
  if (kex) return { status: 'unreachable', reason: 'timeout', detail: clean(kex) }
  const noRoute = at(NO_ROUTE)
  if (noRoute) return { status: 'unreachable', reason: 'no_route', detail: clean(noRoute), hint: noRouteHint(env) }
  const timeout = at(TIMEOUT)
  if (timeout) return { status: 'unreachable', reason: 'timeout', detail: clean(timeout) }
  return { status: 'unknown', detail: clean(lines.at(-1) ?? 'ssh failed') }
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
  if (r.status === 255) return mapSshFailure(String(r.stderr ?? ''), deps.env ?? process.env)
  const last = String(r.stdout ?? '').trim().split('\n').pop() ?? ''
  try {
    const answer: unknown = JSON.parse(last)
    if (answer !== null && typeof answer === 'object' && !Array.isArray(answer) && typeof (answer as { status?: unknown }).status === 'string') return answer as GateResponse
  } catch { /* falls through */ }
  return { status: 'unknown', detail: 'no readable answer from the target' }
}
