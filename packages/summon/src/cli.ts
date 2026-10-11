import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseDurationS } from './allowlist.ts'
import { appendLedger, type LedgerFields } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { DEVICE_RE, ID_RE, RUNTIMES, TOKEN_RE, newRequestId, originTag, type Access, type Runtime, type SummonRequest } from './request.ts'
import { processStartTime } from './runner.ts'
import { noRouteHint, sshCall, targetOf, type Env, type SshTarget } from './ssh.ts'
import type { GateResponse } from './status.ts'

export interface CliDeps {
  sshBin: string; sshConfig: string; ledgerPath: string; device: string
  /** How long one ssh call may take before the answer is `unknown`. Defaults to 60 s; tests shorten it. */
  timeoutMs?: number
  /** One-line notes for stderr. Defaults to process.stderr; tests collect them. */
  warn?(msg: string): void
  /** The caller's environment: the origin's harness kind, and which sandbox (if any) a hint names. Defaults to process.env. */
  env?: Env
  /** When a pid started, as `ps -o lstart=` prints it (C locale, UTC), or null. Without it the origin has no start time. */
  startTimeOf?(pid: number): string | null
  nowMs(): number; readFile(p: string): string; readStdin(): string
}
export type CliCommand =
  | { kind: 'inventory'; device: string }
  | { kind: 'status' | 'result' | 'cancel'; device: string; id: string }
  | { kind: 'start'; device: string; runtime: Runtime; model: string; provider?: string; effort?: string; cwd: string; access: Access;
      promptFile: string; timeoutS: number; expiresS: number; label?: string }

const USAGE = `usage:
  summon <device> inventory
  summon <device> claude --model M [--job] --cwd '<path on target>' [--review|--edit] --prompt-file F|- [--timeout 15m] [--expires 15m] [--label L]
  summon status|result|cancel <device>/smn_<id>`

export function parseCli(argv: string[]): CliCommand | { error: string } {
  const [a, b, ...rest] = argv
  if ((a === 'status' || a === 'result' || a === 'cancel') && b) {
    const m = /^([a-z][a-z0-9-]{0,31})\/(smn_[0-9a-f]{32})$/.exec(b)
    return m ? { kind: a, device: m[1]!, id: m[2]! } : { error: `bad handle\n${USAGE}` }
  }
  if (!a || !DEVICE_RE.test(a)) return { error: USAGE }
  if (b === 'inventory' && rest.length === 0) return { kind: 'inventory', device: a }
  if (!b || !(RUNTIMES as readonly string[]).includes(b)) return { error: USAGE }
  const flags: Record<string, string> = {}
  let access: Access = 'review'
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i]!
    if (f === '--review' || f === '--edit') { access = f === '--edit' ? 'edit' : 'review'; continue }
    if (f === '--job') continue // Phase 0's only mode, so naming it changes nothing (spec §2's command line names it)
    if (f === '--live') return { error: `--live: live sessions arrive in Phase 1; Phase 0 runs jobs only (--job)\n${USAGE}` }
    if (!['--model', '--provider', '--effort', '--cwd', '--prompt-file', '--timeout', '--expires', '--label'].includes(f) || rest[i + 1] === undefined) return { error: `unknown or incomplete flag ${f}\n${USAGE}` }
    flags[f] = rest[++i]!
  }
  if (!flags['--model'] || !flags['--cwd'] || !flags['--prompt-file']) return { error: `--model, --cwd and --prompt-file are required\n${USAGE}` }
  // Checked as Nuance checks it, so the Air's `sent` entry and Nuance's `admitted` one record the same shape.
  if (flags['--effort'] !== undefined && !TOKEN_RE.test(flags['--effort'])) return { error: `--effort is a word such as low, medium or high\n${USAGE}` }
  const timeoutS = parseDurationS(flags['--timeout'] ?? '15m'); const expiresS = parseDurationS(flags['--expires'] ?? '15m')
  if (!timeoutS || !expiresS) return { error: 'durations look like 90s, 15m or 2h' }
  return { kind: 'start', device: a, runtime: b as Runtime, model: flags['--model'], provider: flags['--provider'], effort: flags['--effort'],
    cwd: flags['--cwd'], access, promptFile: flags['--prompt-file'], timeoutS, expiresS, label: flags['--label'] }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `ps -o lstart=` in the C locale and UTC (`Sun Oct 11 00:38:43 2026`) as ISO 8601; undefined for anything else. */
export function lstartToIso(s: string | null): string | undefined {
  const m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(s ?? '')
  const month = m ? MONTHS.indexOf(m[1]!) : -1
  if (!m || month < 0) return undefined
  const [day, h, min, sec, year] = [m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number]
  const d = new Date(Date.UTC(year, month, day, h, min, sec))
  // Date rolls an impossible field over (Feb 31, 24:00) instead of failing, so the fields must come back unchanged.
  const same = d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day && d.getUTCHours() === h && d.getUTCMinutes() === min && d.getUTCSeconds() === sec
  return same ? d.toISOString() : undefined
}

const envOf = (deps: CliDeps): Env => deps.env ?? process.env

/** The caller's start time, when the lookup can say: the origin is advisory, so a failure leaves it out. */
function startedAt(deps: CliDeps, pid: number): string | undefined {
  try { return lstartToIso(deps.startTimeOf?.(pid) ?? null) } catch { return undefined }
}

export function buildRequest(cmd: Extract<CliCommand, { kind: 'start' }>, deps: CliDeps, prompt: string): SummonRequest {
  const now = deps.nowMs()
  const env = envOf(deps)
  const pid = process.ppid
  const started = startedAt(deps, pid)
  return { v: 1, id: newRequestId(now), from_device: deps.device, to_device: cmd.device,
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + cmd.expiresS * 1000).toISOString(),
    runtime: cmd.runtime, mode: 'job', model: cmd.model, ...(cmd.provider ? { provider: cmd.provider } : {}), ...(cmd.effort ? { effort: cmd.effort } : {}),
    cwd: cmd.cwd, access: cmd.access, timeout_s: cmd.timeoutS, ...(cmd.label ? { label: cmd.label } : {}),
    origin: { harness: env.CLAUDECODE ? 'claude-code' : env.CODEX_HOME ? 'codex' : 'shell', pid, ...(started ? { started_at: started } : {}) }, prompt }
}

const failed = (o: GateResponse) => ['refused', 'unreachable', 'auth_refused', 'host_key_mismatch', 'unknown', 'failed', 'blocked'].includes(String(o.status))

/** `--json` only changes how bin/summon.ts prints; parseCli does not know it, so it is taken off argv first. */
export function splitJsonFlag(argv: string[]): { argv: string[]; json: boolean } {
  return { argv: argv.filter((a) => a !== '--json'), json: argv.includes('--json') }
}

/** Thrown only before anything was sent: the Air ledger entry that must come first could not be written. */
export class NothingSentError extends Error {}

const NOT_PAIRED_HINT = 'run bun scripts/pin-nuance.ts (README install step 3)'

/**
 * Only a device that pin-nuance paired is called: one with an exact `Host summon-<device>` line in the summon ssh
 * config. Any other name would get ssh's defaults under -F (Yu's own keys and known_hosts, no BatchMode), so it is
 * answered here, before anything is ledgered or sent. A paired device's entry is what ssh's failures are read against.
 */
function pairing(deps: CliDeps, device: string): { target: SshTarget } | { out: GateResponse } {
  let config = ''
  try { config = deps.readFile(deps.sshConfig) } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      // It is there but this caller may not read it (a sandbox, its mode): nothing can be sent either way.
      return { out: { status: 'unreachable', reason: 'no_route', detail: `cannot read the summon ssh config (${whyOf(e)})`, hint: noRouteHint(envOf(deps)) } }
    }
  }
  const target = targetOf(config, device)
  return target ? { target } : { out: { status: 'unreachable', reason: 'no_route', detail: `not paired: ${device}`, hint: NOT_PAIRED_HINT } }
}

const DAY_MS = 86_400_000

/** The summon key's expiry that pin-nuance recorded beside the ssh config (YYYYMMDD), or null if there is none. */
function keyExpiry(deps: CliDeps): string | null {
  try {
    const e = deps.readFile(join(dirname(deps.sshConfig), 'expiry')).trim()
    return /^\d{8}$/.test(e) ? e : null
  } catch { return null }
}
/** sshd reads expiry-time="YYYYMMDD" as the start of that day, local time: from then on the key is refused. */
const expiryStartMs = (e: string) => new Date(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8)).getTime()
const dashedDate = (e: string) => `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`
const expiredOn = (e: string) => `the summon key expired on ${dashedDate(e)}: re-pair (README install step 1)`

function authHint(expiry: string | null, nowMs: number): string {
  return expiry && nowMs >= expiryStartMs(expiry) ? expiredOn(expiry)
    : 'if Nuance restarted it may be waiting at the FileVault screen: unlock it at the Mac; do not re-pin or re-key'
}

/** Within 7 days of the key's expiry (or past it), one line for every verb. */
function expiryWarning(expiry: string | null, nowMs: number): string | null {
  if (!expiry) return null
  const left = expiryStartMs(expiry) - nowMs
  if (left > 7 * DAY_MS) return null
  if (left <= 0) return `summon: ${expiredOn(expiry)}`
  const today = new Date(nowMs)
  const days = Math.round((expiryStartMs(expiry) - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY_MS) // calendar days
  return `summon: the summon key expires on ${dashedDate(expiry)} (in ${days} day${days === 1 ? '' : 's'}): re-pair before then (README install step 1)`
}

const warnOf = (deps: CliDeps) => deps.warn ?? ((m: string) => { process.stderr.write(m + '\n') })

/** An entry that must be on the Air's ledger before the call it records: if it cannot be written, nothing is sent. */
function logBefore(deps: CliDeps, fields: LedgerFields): void {
  try { appendLedger(deps.ledgerPath, fields, deps.nowMs()) } catch (e) {
    throw new NothingSentError(`could not write the Air ledger (${whyOf(e)}); nothing was sent`)
  }
}

/** The answer to a call that may have been delivered (`answer` for a start, `<verb>_answer` for the others): it reaches the caller whatever the ledger does. */
function logAnswer(deps: CliDeps, event: string, id: string | undefined, out: GateResponse, what: string): void {
  try {
    appendLedger(deps.ledgerPath, { event, id, status: String(out.status), reason: out.reason, detail: out.detail }, deps.nowMs())
  } catch (e) { warnOf(deps)(`summon: the Air ledger could not record the answer for ${what} (${whyOf(e)})`) }
}

export function runCli(argv: string[], deps: CliDeps): { code: number; out: GateResponse } {
  const cmd = parseCli(argv)
  if ('error' in cmd) return { code: 2, out: { status: 'refused', reason: 'malformed', detail: cmd.error } }
  if ((cmd.kind === 'status' || cmd.kind === 'result' || cmd.kind === 'cancel') && !ID_RE.test(cmd.id)) return { code: 2, out: { status: 'refused', reason: 'malformed' } }
  const now = deps.nowMs()
  const expiry = keyExpiry(deps)
  const warning = expiryWarning(expiry, now)
  if (warning) warnOf(deps)(warning)
  const paired = pairing(deps, cmd.device)
  if ('out' in paired) return { code: 1, out: paired.out }
  const ssh = { ...deps, target: paired.target }
  const answer = (out: GateResponse) => {
    // A hint ssh's own line already gave (a missing key) is the more exact one.
    const o = out.status === 'auth_refused' && !out.hint ? { ...out, hint: authHint(expiry, now) } : out
    return { code: failed(o) ? 1 : 0, out: o }
  }

  if (cmd.kind === 'cancel') {
    // A cancel acts on a job, so it is ledgered before it is sent (fail closed, as a start is) and answered after.
    logBefore(deps, { event: 'cancel_sent', id: cmd.id })
    const out = sshCall(ssh, cmd.device, `cancel ${cmd.id}`)
    logAnswer(deps, 'cancel_answer', cmd.id, out, `${cmd.device}/${cmd.id}`)
    return answer(out)
  }
  if (cmd.kind !== 'start') {
    const id = cmd.kind === 'inventory' ? undefined : cmd.id
    const out = sshCall(ssh, cmd.device, id ? `${cmd.kind} ${id}` : 'inventory')
    // A read changes nothing, so only a security event is logged: the Air may hold the only trace of it.
    if (out.status === 'auth_refused' || out.status === 'host_key_mismatch') logAnswer(deps, `${cmd.kind}_answer`, id, out, id ? `${cmd.device}/${id}` : `${cmd.device} inventory`)
    return answer(out)
  }

  let prompt: string
  try { prompt = cmd.promptFile === '-' ? deps.readStdin() : deps.readFile(cmd.promptFile) } catch (e) {
    return { code: 2, out: { status: 'refused', reason: 'malformed', detail: `cannot read the prompt (${(e as NodeJS.ErrnoException).code ?? 'error'})` } }
  }
  const req = buildRequest(cmd, deps, prompt)
  // The request is on the Air's ledger before it is sent. If that fails nothing has been sent, so it fails closed: bin/summon.ts reports it.
  logBefore(deps, { event: 'sent', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, effort: req.effort,
    cwd: req.cwd, access: req.access, origin: originTag(req.origin) })
  const out = sshCall(ssh, cmd.device, 'start', JSON.stringify(req))
  const handle = `${cmd.device}/${req.id}`
  // From here the request may have been delivered, so the answer must reach the caller whatever the ledger does.
  logAnswer(deps, 'answer', req.id, out, handle)
  const r = answer(out)
  return out.status === 'unknown' ? { ...r, out: { ...r.out, handle } } : r
}

/** A short, single-line reason from a thrown value: its errno code if it has one, else its message. */
const whyOf = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? e).split('\n')[0]!.slice(0, 80)

export function defaultCliDeps(): CliDeps {
  const home = homedir()
  return { sshBin: process.env.SUMMON_SSH_BIN || '/usr/bin/ssh', sshConfig: join(home, '.ssh', 'summon', 'config'),
    ledgerPath: summonPaths(home).ledger, device: process.env.SUMMON_DEVICE || 'air', env: process.env, startTimeOf: processStartTime,
    nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => readFileSync(0, 'utf8') }
}
