import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAdmission, loadAllowlist } from './allowlist.ts'
import { admittedSince, countActive, errTag, jobDir, settleNeverReached, writeJsonAtomic, writeState } from './jobs.ts'
import { appendLedger, withLock } from './ledger.ts'
import type { SummonPaths } from './paths.ts'
import { claimId, recordRefusal } from './replay.ts'
import { checkTiming, ID_RE, originTag, validateRequest, type SummonRequest } from './request.ts'
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

function refuse(deps: GateDeps, req: SummonRequest | null, reason: RefusalReason, detail: string, hint?: string, id: string | undefined = req?.id): GateResponse {
  appendLedger(deps.paths.ledger, { event: 'refused', id, reason, detail, from: req?.from_device, runtime: req?.runtime, cwd: req?.cwd, access: req?.access }, deps.nowMs())
  return { status: 'refused', reason, detail, ...(hint ? { hint } : {}) }
}

/** The id of a request that failed validation, when it is well-formed, so its refusal can be traced. Nothing else is read. */
function wellFormedId(raw: string): string | undefined {
  try {
    const id = JSON.parse(raw)?.id
    return typeof id === 'string' && ID_RE.test(id) ? id : undefined
  } catch { return undefined }
}

/** Phase 0 runs Claude Code only, with no provider choice. Decided before the allowlist, so no hint asks for a widening that buys nothing. */
function runtimeUnavailable(req: SummonRequest, deps: GateDeps): string | null {
  if (req.runtime !== 'claude') return `${req.runtime} is not wired in Phase 0`
  if (req.provider !== undefined) return 'provider selection is not wired for claude in Phase 0'
  if (!deps.claudeAvailable()) return 'claude is not installed on this Mac'
  return null
}

/**
 * Spec §2 order: schema, device, timing, replay, GUI session + runner, runtime, allowlist, rate, concurrency.
 * The rate and concurrency checks and the spooling that follows run under one lock, so two gatekeeper
 * processes cannot both pass the same limit.
 */
export function gateStart(raw: string, deps: GateDeps): GateResponse {
  const now = deps.nowMs()
  const v = validateRequest(raw)
  if (!v.ok) return refuse(deps, null, v.reason, v.detail, undefined, v.reason === 'too_large' ? undefined : wellFormedId(raw))
  const req = v.request
  const al = loadAllowlist(deps.paths.allowlist)
  if (!al.ok) {
    return refuse(deps, req, 'outside_allowlist', `allowlist: ${al.detail}`,
      `fix ~/.config/summon/allowlist.yaml on Nuance (${al.detail}); the installer's starter file is the reference`)
  }
  if (req.to_device !== al.allowlist.device) return refuse(deps, req, 'malformed', `to_device ${req.to_device} is not ${al.allowlist.device}`)
  const t = checkTiming(req, now, al.allowlist.limits.job_timeout_max_s)
  if (!t.ok) return refuse(deps, req, t.reason, t.detail)
  if (!claimId(deps.paths.seen, req.id)) return refuse(deps, req, 'replayed', 'this id was already received')
  // From here the id is claimed: a refusal is also kept with its seen marker, so `status <id>` can name it.
  const refuseClaimed = (reason: RefusalReason, detail: string, hint?: string): GateResponse => {
    try { recordRefusal(deps.paths.seen, req.id, reason) } catch { /* status then answers unknown: received; no job state on this Mac — see the Nuance ledger */ }
    return refuse(deps, req, reason, detail, hint)
  }
  if (!deps.guiSessionIsMine()) return refuseClaimed('target_logged_out', 'Yu is not logged in at this Mac')
  if (!deps.runnerLoaded()) return refuseClaimed('runner_missing', 'dev.summon.runner is not loaded')
  const unavailable = runtimeUnavailable(req, deps)
  if (unavailable) return refuseClaimed('runtime_unavailable', unavailable)
  const adm = checkAdmission(req, al.allowlist, deps.home, deps.realpath)
  if (!adm.ok) return refuseClaimed(adm.reason, adm.detail, adm.hint)

  const { limits, device } = al.allowlist
  mkdirSync(deps.paths.state, { recursive: true, mode: 0o700 })
  return withLock(join(deps.paths.state, 'admission'), () => {
    settleNeverReached(deps.paths, now)
    if (admittedSince(deps.paths, now - 3_600_000) >= limits.starts_per_hour) return refuseClaimed('rate_limited', `more than ${limits.starts_per_hour} starts in the last hour`)
    if (countActive(deps.paths, now) >= limits.max_concurrent) return refuseClaimed('busy', `${limits.max_concurrent} summon(s) already queued or running`)

    // Logged before it is acted on, and fsync'd before the append returns: if it throws, nothing has been written, and
    // once it returns the entry reached the disk ahead of any job file.
    // The admitted triple (model, effort, access) is on record, with the advisory origin, which nothing above has read.
    appendLedger(deps.paths.ledger, { event: 'admitted', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, effort: req.effort,
      cwd: req.cwd, access: req.access, origin: originTag(req.origin) }, now)
    const dir = jobDir(deps.paths, req.id)
    const marker = join(deps.paths.spool, req.id)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      // State first: a crash before request.json leaves a queued job with no prompt on disk, which settles `expired` and is
      // swept; the other order could leave a prompt with no state, which nothing would ever sweep.
      writeState(deps.paths, {
        id: req.id, status: 'queued', runtime: req.runtime, model: req.model!, ...(req.effort ? { effort: req.effort } : {}),
        access: req.access, cwd_real: adm.cwdReal,
        admitted_at: new Date(now).toISOString(), expires_at: new Date(t.expiresAtMs).toISOString(), timeout_s: t.timeoutS,
      })
      writeJsonAtomic(join(dir, 'request.json'), req)
      mkdirSync(deps.paths.spool, { recursive: true, mode: 0o700 })
      writeFileSync(`${marker}.tmp`, '', { mode: 0o600 })
      renameSync(`${marker}.tmp`, marker) // the last step: only a job whose marker landed is admitted
    } catch (e) {
      try { appendLedger(deps.paths.ledger, { event: 'admission_failed', id: req.id }, now) } catch { /* best effort: `admitted` is already there */ }
      for (const p of [dir, `${marker}.tmp`]) { try { rmSync(p, { recursive: true, force: true }) } catch { /* best effort */ } }
      return { status: 'unknown', detail: `admission did not complete (${errTag(e)}); nothing was spooled` }
    }
    return { status: 'admitted', handle: `${device}/${req.id}` }
  })
}
