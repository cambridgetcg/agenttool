import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { codexReady, findCodex } from './codex.ts'
import type { GateDeps } from './gate.ts'
import { findClaude } from './harness.ts'
import { errTag, heartbeatAgeS, jobDir, neverReached, notStartedOutcome, readJson, readState, type JobResult } from './jobs.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { seenRefusal } from './replay.ts'
import { HEARTBEAT_STATUSES, TERMINAL, type GateResponse } from './status.ts'

export type Command = { verb: 'inventory' | 'start' } | { verb: 'status' | 'result' | 'cancel'; id: string }

/** The whole grammar. Anything else — spaces, tabs, separators, other verbs — is null. */
export function parseCommand(raw: string | undefined): Command | null {
  if (raw === 'inventory' || raw === 'start') return { verb: raw }
  if (raw === undefined) return null
  const m = /^(status|result|cancel) (smn_[0-9a-f]{32})$/.exec(raw)
  return m ? { verb: m[1] as 'status' | 'result' | 'cancel', id: m[2]! } : null
}

/** Attacker-controlled text on its way into a ledger or a reply: 60 printable ASCII characters at most. */
export function sanitizeForLog(s: string | undefined): string {
  return (s ?? '<none>').slice(0, 60).replace(/[^\x20-\x7e]/g, '?')
}

/**
 * What the ledger may say about a command that is not one of the five verbs. The ledger is hash-chained and
 * cannot be redacted later, and a client can put anything in SSH_ORIGINAL_COMMAND, including a prompt, so this
 * is content-free: the byte length, and the first token only when it looks like a program name.
 */
export function describeCommand(raw: string | undefined): string {
  if (raw === undefined) return 'unset'
  const first = raw.split(/\s/, 1)[0]!
  return `len ${Buffer.byteLength(raw, 'utf8')}, first token ${/^[a-z][a-z-]{0,15}$/.test(first) ? `"${first}"` : 'not shown'}`
}

export async function readBoundedStdin(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; tooLarge: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel(); return { text: '', tooLarge: true } }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false }
}

/**
 * An id with no job: refused with the reason the gate kept, if it kept one. A seen id with no reason was received, but this
 * Mac holds no job state for it (the gate is still deciding, timed out on its lock, or ledgered admission_failed), so that
 * answer claims no refusal and points at the ledger.
 */
function noJob(paths: SummonPaths, device: string, id: string): GateResponse {
  const seen = seenRefusal(paths.seen, id)
  if (!seen.seen) return { status: 'unknown', detail: 'no such summon on this Mac' }
  if (!seen.reason) return { status: 'unknown', detail: 'received; no job state on this Mac — see the Nuance ledger' }
  return { status: 'refused', reason: seen.reason, handle: `${device}/${id}`, detail: 'received and refused; see the Nuance ledger' }
}

export function statusOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return noJob(paths, device, id)
  const beat = (status: string) => (HEARTBEAT_STATUSES.has(status) ? { heartbeat_age_s: heartbeatAgeS(paths, id, nowMs) } : {})
  // The runner would only end it this way; the next start (gate or runner) settles it on disk under the admission lock.
  if (neverReached(paths, s, nowMs)) {
    const o = notStartedOutcome(paths, id)
    return { status: o.status, handle: `${device}/${id}`, detail: o.detail, ...beat(o.status) }
  }
  return { status: s.status, handle: `${device}/${id}`, ...(s.reason ? { reason: s.reason } : {}), ...(s.detail ? { detail: s.detail } : {}),
    ...(s.resets_at ? { resets_at: s.resets_at } : {}), ...beat(s.status) }
}

export function resultOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const r = readJson<JobResult>(join(jobDir(paths, id), 'result.json'))
  return r ? { ...r, handle: `${device}/${id}` } : statusOf(paths, device, id, nowMs)
}

export function requestCancel(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return noJob(paths, device, id)
  if (TERMINAL.has(s.status) || neverReached(paths, s, nowMs)) return statusOf(paths, device, id, nowMs)
  appendLedger(paths.ledger, { event: 'cancel_requested', id }, nowMs) // logged before the marker that acts on it
  try { writeFileSync(join(jobDir(paths, id), 'cancel'), '', { mode: 0o600 }) } catch (e) {
    try { appendLedger(paths.ledger, { event: 'cancel_failed', id }, nowMs) } catch { /* best effort: cancel_requested is there */ }
    return { status: 'unknown', handle: `${device}/${id}`, detail: `cancel did not complete (${errTag(e)}); no cancel marker was written` }
  }
  return { status: s.status, handle: `${device}/${id}`, detail: 'cancel requested' }
}

/**
 * How long an inventory request waits for the runner. launchd can hold the runner back up to 10 s (ThrottleInterval)
 * and a collection takes up to ~30 s (inventory.ts allows 15 s per command); the Air CLI's ssh gives up at
 * SSH_TIMEOUT_MS (60 s) after at most 8 s to connect, so this stays at or under 40 s.
 */
export const INVENTORY_WAIT_MS = 40_000

/**
 * Ask the runner (Yu's GUI session) for a fresh inventory and wait for it. The answer is inventory.json only once the
 * runner has consumed this request's .req (it writes the report first) and the report was collected after the request:
 * a file mtime can be ahead of the clock, so it never counts as fresh.
 */
export async function requestInventory(paths: SummonPaths, nowMs: number, waitMs = INVENTORY_WAIT_MS): Promise<GateResponse> {
  appendLedger(paths.ledger, { event: 'inventory_requested' }, nowMs) // logged before the request that acts on it
  mkdirSync(paths.spool, { recursive: true, mode: 0o700 })
  const req = join(paths.spool, `inventory-${nowMs}.req`)
  writeFileSync(req, '', { mode: 0o600 })
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (!existsSync(req)) {
      const inv = readJson<Record<string, unknown>>(paths.inventory)
      if (inv && typeof inv.collected_at === 'string' && Date.parse(inv.collected_at) >= nowMs) return { status: 'completed', inventory: inv }
    }
    await Bun.sleep(250)
  }
  // Fixed text. The runner may not be gone: launchd throttles its relaunch (ThrottleInterval 10), and it is serial.
  return { status: 'unknown', detail: 'the runner did not answer in time: launchd may be holding it back (it starts the runner at most once every 10 s), it may be busy with a job, or Yu may not be logged in at this Mac; ask again in a minute' }
}

/** Whether launchd has this service (`gui/<uid>/<label>`) loaded. */
export type ServiceLoaded = (service: string) => boolean
/** Asks launchd itself: `launchctl print` exits 0 only for a loaded service. */
export const launchdHas: ServiceLoaded = (service) =>
  spawnSync('/bin/launchctl', ['print', service], { stdio: 'ignore', timeout: 3000 }).status === 0

/** Real dependencies on Nuance. Test overrides only when SUMMON_HOME_OVERRIDE is set; tests pass their own launchd check. */
export function liveGateDeps(paths: SummonPaths, serviceLoaded: ServiceLoaded = launchdHas): GateDeps {
  const testing = !!process.env.SUMMON_HOME_OVERRIDE
  const uid = process.getuid!()
  return {
    nowMs: () => Date.now(),
    home: paths.home,
    paths,
    guiSessionIsMine: () => (testing && process.env.SUMMON_TEST_GUI === '1') || (() => { try { return statSync('/dev/console').uid === uid } catch { return false } })(),
    runnerLoaded: () => (testing && process.env.SUMMON_TEST_RUNNER === '1') || serviceLoaded(`gui/${uid}/dev.summon.runner`),
    claudeAvailable: () => findClaude(paths.home) !== null,
    codexAvailable: () => codexReady(findCodex(paths.home), paths.home, userInfo().username),
  }
}
