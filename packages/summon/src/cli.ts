import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDurationS } from './allowlist.ts'
import { appendLedger } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { DEVICE_RE, ID_RE, RUNTIMES, newRequestId, type Access, type Runtime, type SummonRequest } from './request.ts'
import { sshCall } from './ssh.ts'
import type { GateResponse } from './status.ts'

export interface CliDeps {
  sshBin: string; sshConfig: string; ledgerPath: string; device: string
  /** How long one ssh call may take before the answer is `unknown`. Defaults to 60 s; tests shorten it. */
  timeoutMs?: number
  /** One-line notes for stderr. Defaults to process.stderr; tests collect them. */
  warn?(msg: string): void
  nowMs(): number; readFile(p: string): string; readStdin(): string
}
export type CliCommand =
  | { kind: 'inventory'; device: string }
  | { kind: 'status' | 'result' | 'cancel'; device: string; id: string }
  | { kind: 'start'; device: string; runtime: Runtime; model: string; provider?: string; effort?: string; cwd: string; access: Access;
      promptFile: string; timeoutS: number; expiresS: number; label?: string }

const USAGE = `usage:
  summon <device> inventory
  summon <device> claude --model M --cwd '<path on target>' [--review|--edit] --prompt-file F|- [--timeout 15m] [--expires 15m] [--label L]
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
    if (!['--model', '--provider', '--effort', '--cwd', '--prompt-file', '--timeout', '--expires', '--label'].includes(f) || rest[i + 1] === undefined) return { error: `unknown or incomplete flag ${f}\n${USAGE}` }
    flags[f] = rest[++i]!
  }
  if (!flags['--model'] || !flags['--cwd'] || !flags['--prompt-file']) return { error: `--model, --cwd and --prompt-file are required\n${USAGE}` }
  const timeoutS = parseDurationS(flags['--timeout'] ?? '15m'); const expiresS = parseDurationS(flags['--expires'] ?? '15m')
  if (!timeoutS || !expiresS) return { error: 'durations look like 90s, 15m or 2h' }
  return { kind: 'start', device: a, runtime: b as Runtime, model: flags['--model'], provider: flags['--provider'], effort: flags['--effort'],
    cwd: flags['--cwd'], access, promptFile: flags['--prompt-file'], timeoutS, expiresS, label: flags['--label'] }
}

export function buildRequest(cmd: Extract<CliCommand, { kind: 'start' }>, deps: CliDeps, prompt: string): SummonRequest {
  const now = deps.nowMs()
  return { v: 1, id: newRequestId(now), from_device: deps.device, to_device: cmd.device,
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + cmd.expiresS * 1000).toISOString(),
    runtime: cmd.runtime, mode: 'job', model: cmd.model, ...(cmd.provider ? { provider: cmd.provider } : {}), ...(cmd.effort ? { effort: cmd.effort } : {}),
    cwd: cmd.cwd, access: cmd.access, timeout_s: cmd.timeoutS, ...(cmd.label ? { label: cmd.label } : {}),
    origin: { harness: process.env.CLAUDECODE ? 'claude-code' : process.env.CODEX_HOME ? 'codex' : 'shell', pid: process.ppid }, prompt }
}

const failed = (o: GateResponse) => ['refused', 'unreachable', 'auth_refused', 'host_key_mismatch', 'unknown', 'failed', 'blocked'].includes(String(o.status))

/** `--json` only changes how bin/summon.ts prints; parseCli does not know it, so it is taken off argv first. */
export function splitJsonFlag(argv: string[]): { argv: string[]; json: boolean } {
  return { argv: argv.filter((a) => a !== '--json'), json: argv.includes('--json') }
}

export function runCli(argv: string[], deps: CliDeps): { code: number; out: GateResponse } {
  const cmd = parseCli(argv)
  if ('error' in cmd) return { code: 2, out: { status: 'refused', reason: 'malformed', detail: cmd.error } }
  if (cmd.kind === 'inventory') { const out = sshCall(deps, cmd.device, 'inventory'); return { code: failed(out) ? 1 : 0, out } }
  if (cmd.kind !== 'start') {
    if (!ID_RE.test(cmd.id)) return { code: 2, out: { status: 'refused', reason: 'malformed' } }
    const out = sshCall(deps, cmd.device, `${cmd.kind} ${cmd.id}`)
    return { code: failed(out) ? 1 : 0, out }
  }
  let prompt: string
  try { prompt = cmd.promptFile === '-' ? deps.readStdin() : deps.readFile(cmd.promptFile) } catch (e) {
    return { code: 2, out: { status: 'refused', reason: 'malformed', detail: `cannot read the prompt (${(e as NodeJS.ErrnoException).code ?? 'error'})` } }
  }
  const req = buildRequest(cmd, deps, prompt)
  // The request is on the Air's ledger before it is sent. If that fails nothing has been sent, so it fails closed: bin/summon.ts reports it.
  try {
    appendLedger(deps.ledgerPath, { event: 'sent', id: req.id, from: req.from_device, runtime: req.runtime, model: req.model, cwd: req.cwd, access: req.access }, deps.nowMs())
  } catch (e) { throw new Error(`could not write the Air ledger (${whyOf(e)}); nothing was sent`) }
  const out = sshCall(deps, cmd.device, 'start', JSON.stringify(req))
  const handle = `${cmd.device}/${req.id}`
  // From here the request may have been delivered, so the answer must reach the caller whatever the ledger does.
  try {
    appendLedger(deps.ledgerPath, { event: 'answer', id: req.id, status: String(out.status), reason: out.reason, detail: out.detail }, deps.nowMs())
  } catch (e) { (deps.warn ?? ((m) => process.stderr.write(m + '\n')))(`summon: the Air ledger could not record the answer for ${handle} (${whyOf(e)})`) }
  return { code: failed(out) ? 1 : 0, out: out.status === 'unknown' ? { ...out, handle } : out }
}

/** A short, single-line reason from a thrown value: its errno code if it has one, else its message. */
const whyOf = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? e).split('\n')[0]!.slice(0, 80)

export function defaultCliDeps(): CliDeps {
  const home = homedir()
  return { sshBin: process.env.SUMMON_SSH_BIN || '/usr/bin/ssh', sshConfig: join(home, '.ssh', 'summon', 'config'),
    ledgerPath: summonPaths(home).ledger, device: process.env.SUMMON_DEVICE || 'air', nowMs: () => Date.now(),
    readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => readFileSync(0, 'utf8') }
}
