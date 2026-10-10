import { spawnSync } from 'node:child_process'
import type { GateResponse } from './status.ts'

export const SSH_TIMEOUT_MS = 60_000

export interface SshDeps { sshBin: string; sshConfig: string; timeoutMs?: number }

// Failures that happen before ssh has a connection to send on. Nothing was delivered, so these are transport statuses.
const HOST_KEY = /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No \S+ host key is known/i
const AUTH = /Permission denied|Too many authentication failures/i
// The server hung up before authentication (sshd's MaxStartups, a restarting sshd): still nothing delivered.
const KEX = /kex_exchange_identification/i
const NO_ROUTE = /Could not resolve hostname|No route to host|Network is unreachable/i
const CONNECT_TIMEOUT = /connect to (host|address)[^\n]*(timed out|refused)|timed out during banner exchange/i
// An established connection that went quiet or vanished. The request may already have been delivered and acted on.
const LOST = /Timeout, server\b[^\n]*not responding|Broken pipe|Connection reset|client_loop:|Connection to [^\n]* closed by remote host/i

/** One line of what ssh said, printable ASCII only: the target controls banners, and the detail reaches a hash-chained ledger. */
const detailOf = (stderr: string): string =>
  (stderr.trim().split('\n').filter(Boolean).slice(-1)[0] ?? 'ssh failed').slice(0, 200).replace(/[^\x20-\x7e]/g, '?')

/**
 * Tells ssh's failures apart. Only a failure known to have happened before a connection keeps a transport status;
 * a connection lost after one, and anything this does not recognise, is `unknown` (never retried).
 * Order matters: a drop on a later address must beat an earlier address's connect timeout.
 */
export function mapSshFailure(stderr: string): GateResponse {
  const detail = detailOf(stderr)
  if (HOST_KEY.test(stderr)) return { status: 'host_key_mismatch', detail }
  if (AUTH.test(stderr)) return { status: 'auth_refused', detail }
  if (KEX.test(stderr)) return { status: 'unreachable', reason: 'timeout', detail }
  if (LOST.test(stderr)) return { status: 'unknown', detail }
  if (NO_ROUTE.test(stderr)) return { status: 'unreachable', reason: 'no_route', detail }
  if (CONNECT_TIMEOUT.test(stderr)) return { status: 'unreachable', reason: 'timeout', detail }
  return { status: 'unknown', detail }
}

export function sshCall(deps: SshDeps, device: string, remote: string, stdin?: string): GateResponse {
  const timeoutMs = deps.timeoutMs ?? SSH_TIMEOUT_MS
  const r = spawnSync(deps.sshBin, ['-F', deps.sshConfig, `summon-${device}`, remote], { input: stdin ?? '', encoding: 'utf8', timeout: timeoutMs })
  // r.error is checked on its own: after a timeout r.stderr is '' (not null), so `r.stderr ?? r.error` would never see the error.
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'unreachable', reason: 'no_route', detail: 'ssh not found' }
    if (code === 'ETIMEDOUT') return { status: 'unknown', detail: `ssh gave no answer within ${timeoutMs} ms` }
    return { status: 'unknown', detail: detailOf(`ssh could not finish: ${r.error.message}`) }
  }
  if (r.signal) return { status: 'unknown', detail: `ssh was killed by ${r.signal}` }
  if (r.status === 255) return mapSshFailure(String(r.stderr ?? ''))
  const last = String(r.stdout ?? '').trim().split('\n').pop() ?? ''
  try {
    const answer: unknown = JSON.parse(last)
    if (answer !== null && typeof answer === 'object' && !Array.isArray(answer) && typeof (answer as { status?: unknown }).status === 'string') return answer as GateResponse
  } catch { /* falls through */ }
  return { status: 'unknown', detail: 'no readable answer from the target' }
}
