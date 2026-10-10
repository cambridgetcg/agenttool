import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAdmission, loadAllowlist } from './allowlist.ts'
import { admittedSince, countActive, jobDir, writeJsonAtomic, writeState } from './jobs.ts'
import { appendLedger, withLock } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { claimId } from './replay.ts'
import { checkTiming, validateRequest, type SummonRequest } from './request.ts'
import type { GateResponse, RefusalReason } from './status.ts'

export interface GateDeps {
  nowMs(): number
  home: string
  paths: SummonPaths
  guiSessionIsMine(): boolean
  runnerLoaded(): boolean
  claudeAvailable(): boolean
  realpath?: (p: string) => string | null
}

function refuse(deps: GateDeps, req: SummonRequest | null, reason: RefusalReason, detail: string, hint?: string): GateResponse {
  appendLedger(deps.paths.ledger, { event: 'refused', id: req?.id, reason, detail, from: req?.from_device, runtime: req?.runtime, cwd: req?.cwd, access: req?.access }, deps.nowMs())
  return { status: 'refused', reason, detail, ...(hint ? { hint } : {}) }
}

/**
 * Spec §2 order: schema, device, timing, replay, GUI session + runner, allowlist, runtime, rate, concurrency.
 * The rate and concurrency checks and the spooling that follows run under one lock, so two gatekeeper
 * processes cannot both pass the same limit.
 */
export function gateStart(raw: string, deps: GateDeps): GateResponse {
  const now = deps.nowMs()
  const v = validateRequest(raw)
  if (!v.ok) return refuse(deps, null, v.reason, v.detail)
  const req = v.request
  const al = loadAllowlist(deps.paths.allowlist)
  if (!al.ok) return refuse(deps, req, 'outside_allowlist', `allowlist: ${al.detail}`)
  if (req.to_device !== al.allowlist.device) return refuse(deps, req, 'malformed', `to_device ${req.to_device} is not ${al.allowlist.device}`)
  const t = checkTiming(req, now, al.allowlist.limits.job_timeout_max_s)
  if (!t.ok) return refuse(deps, req, t.reason, t.detail)
  if (!claimId(deps.paths.seen, req.id)) return refuse(deps, req, 'replayed', 'this id was already received')
  if (!deps.guiSessionIsMine()) return refuse(deps, req, 'target_logged_out', 'Yu is not logged in at this Mac')
  if (!deps.runnerLoaded()) return refuse(deps, req, 'runner_missing', 'dev.summon.runner is not loaded')
  const adm = checkAdmission(req, al.allowlist, deps.home, deps.realpath)
  if (!adm.ok) return refuse(deps, req, adm.reason, adm.detail, adm.hint)
  if (req.runtime !== 'claude') return refuse(deps, req, 'runtime_unavailable', `${req.runtime} is not wired in Phase 0`)
  if (!deps.claudeAvailable()) return refuse(deps, req, 'runtime_unavailable', 'claude is not installed on this Mac')

  const { limits, device } = al.allowlist
  mkdirSync(deps.paths.state, { recursive: true, mode: 0o700 })
  return withLock(join(deps.paths.state, 'admission'), () => {
    if (admittedSince(deps.paths, now - 3_600_000) >= limits.starts_per_hour) return refuse(deps, req, 'rate_limited', `more than ${limits.starts_per_hour} starts in the last hour`)
    if (countActive(deps.paths) >= limits.max_concurrent) return refuse(deps, req, 'busy', `${limits.max_concurrent} summon(s) already queued or running`)

    const dir = jobDir(deps.paths, req.id)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeJsonAtomic(join(dir, 'request.json'), req)
    writeState(deps.paths, {
      id: req.id, status: 'queued', runtime: req.runtime, model: req.model!, access: req.access, cwd_real: adm.cwdReal,
      admitted_at: new Date(now).toISOString(), expires_at: new Date(t.expiresAtMs).toISOString(), timeout_s: t.timeoutS,
    })
    mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
    const marker = join(deps.paths.spool, req.id)
    writeFileSync(`${marker}.tmp`, '', { mode: 0o600 })
    renameSync(`${marker}.tmp`, marker)
    appendLedger(deps.paths.ledger, { event: 'admitted', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, cwd: req.cwd, access: req.access }, now)
    return { status: 'admitted', handle: `${device}/${req.id}` }
  })
}
