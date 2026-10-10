import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { GateDeps } from './gate.ts'
import { findClaude } from './harness.ts'
import { heartbeatAgeS, jobDir, readJson, readState, type JobResult } from './jobs.ts'
import { appendLedger } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { TERMINAL, type GateResponse } from './status.ts'

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

export function statusOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return { status: 'unknown', detail: 'no such summon on this Mac' }
  return { status: s.status, handle: `${device}/${id}`, ...(s.reason ? { reason: s.reason } : {}), ...(s.detail ? { detail: s.detail } : {}),
    heartbeat_age_s: heartbeatAgeS(paths, id, nowMs) }
}

export function resultOf(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const r = readJson<JobResult>(join(jobDir(paths, id), 'result.json'))
  return r ? { ...r, handle: `${device}/${id}` } : statusOf(paths, device, id, nowMs)
}

export function requestCancel(paths: SummonPaths, device: string, id: string, nowMs: number): GateResponse {
  const s = readState(paths, id)
  if (!s) return { status: 'unknown', detail: 'no such summon on this Mac' }
  if (TERMINAL.has(s.status)) return statusOf(paths, device, id, nowMs)
  writeFileSync(join(jobDir(paths, id), 'cancel'), '', { mode: 0o600 })
  appendLedger(paths.ledger, { event: 'cancel_requested', id }, nowMs)
  return { status: s.status, handle: `${device}/${id}`, detail: 'cancel requested' }
}

/** Ask the runner (Yu's GUI session) for a fresh inventory and wait for it. */
export async function requestInventory(paths: SummonPaths, nowMs: number, waitMs = 15_000): Promise<GateResponse> {
  mkdirSync(paths.spool, { recursive: true, mode: 0o700 })
  writeFileSync(join(paths.spool, `inventory-${nowMs}.req`), '', { mode: 0o600 })
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    try {
      if (statSync(paths.inventory).mtimeMs >= nowMs) {
        const inv = readJson<Record<string, unknown>>(paths.inventory)
        if (inv) return { status: 'completed', inventory: inv }
      }
    } catch { /* not yet */ }
    await Bun.sleep(250)
  }
  return { status: 'unknown', detail: 'the runner did not answer (is Yu logged in at this Mac?)' }
}

/** Real dependencies on Nuance. Test overrides only when SUMMON_HOME_OVERRIDE is set. */
export function liveGateDeps(paths: SummonPaths): GateDeps {
  const testing = !!process.env.SUMMON_HOME_OVERRIDE
  const uid = process.getuid!()
  return {
    nowMs: () => Date.now(),
    home: paths.home,
    paths,
    guiSessionIsMine: () => (testing && process.env.SUMMON_TEST_GUI === '1') || (() => { try { return statSync('/dev/console').uid === uid } catch { return false } })(),
    runnerLoaded: () => (testing && process.env.SUMMON_TEST_RUNNER === '1')
      || spawnSync('/bin/launchctl', ['print', `gui/${uid}/dev.summon.runner`], { stdio: 'ignore', timeout: 3000 }).status === 0,
    claudeAvailable: () => findClaude(paths.home) !== null,
  }
}
