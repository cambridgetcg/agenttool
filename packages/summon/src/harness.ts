import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Access } from './request.ts'
import type { JobStatus } from './status.ts'

export function isExecutable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false }
}

/** Where Claude Code lives on a Mac. SUMMON_CLAUDE_BIN is a test override (only with SUMMON_HOME_OVERRIDE). */
export function findClaude(home: string): string | null {
  const override = process.env.SUMMON_HOME_OVERRIDE ? process.env.SUMMON_CLAUDE_BIN : undefined
  for (const p of [override, join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (p && isExecutable(p)) return p
  }
  return null
}

export const MAX_TURNS = 12

export interface Invocation { bin: string; args: string[]; env: Record<string, string>; stdin: string }
export interface Outcome {
  status: JobStatus
  reason?: string
  /** Always runner-authored (a fixed string or a number). The ledger holds it, so harness output never goes here. */
  detail?: string
  /** The harness's own text. Goes in the 0600 result file, never in a ledger. */
  result_text?: string
  num_turns?: number
  cost_usd?: number
  resets_at?: string
}

// A folder spelled with these would split or reinterpret the comma-separated `--disallowedTools` rule built from it.
const UNSAFE_IN_RULE = /[\u0000-\u001f\u007f,()*?[\]{}\\]/

/**
 * Spec §4.6: the quiet config proven on Alpha. The prompt goes on stdin, never in argv; env is built from scratch.
 * Throws for an edit job whose folder can't be written into a deny rule safely (fail closed: the `.githooks` rule must hold).
 */
export function claudeInvocation(job: { model: string; access: Access; cwdReal: string; prompt: string }, home: string, bin: string, user: string): Invocation {
  const args = ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-chrome',
    '--disable-slash-commands', '--no-session-persistence', `--max-turns=${MAX_TURNS}`, `--model=${job.model}`,
    '--permission-mode=acceptEdits', '--permission-prompts=none']
  if (job.access === 'review') {
    args.push('--tools=Read,Glob,Grep')
  } else {
    if (UNSAFE_IN_RULE.test(job.cwdReal)) throw new Error('edit folder has characters that cannot be written into a deny rule safely')
    const hooks = `${job.cwdReal.replace(/\/+$/, '')}/.githooks/**`
    args.push('--tools=Read,Write,Edit,Glob,Grep,Bash',
      '--allowedTools=Bash(git add:*),Bash(git commit:*)',
      `--disallowedTools=${['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)', `Edit(/${hooks})`, `Write(/${hooks})`].join(',')}`)
  }
  const env: Record<string, string> = {
    HOME: home, USER: user, LOGNAME: user, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp',
    PATH: `${home}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_MAX_RETRIES: '2', DISABLE_AUTOUPDATER: '1',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false',
  }
  return { bin, args, env, stdin: job.prompt }
}

const resetIso = (r: any) => (typeof r?.resetsAt === 'number' ? new Date(r.resetsAt * 1000).toISOString() : undefined)

type UsageWarning = { status: string; resets_at?: string }

function warningOf(e: any): UsageWarning | null {
  if (e?.type !== 'rate_limit_event') return null
  const info = e.rate_limit_info ?? e
  return info?.status === 'allowed_warning' || info?.status === 'rejected' ? { status: info.status, resets_at: resetIso(info) } : null
}

export function usageWarning(line: string): UsageWarning | null {
  try { return warningOf(JSON.parse(line)) } catch { return null }
}

// The only subtypes worth naming are Claude's own `error_*` words; anything else is not echoed into a detail.
const SAFE_SUBTYPE = /^error_[a-z_]{1,40}$/

export function interpretClaudeStream(lines: string[], exitCode: number | null): Outcome {
  let result: any = null
  let warning: UsageWarning | null = null
  let assistantText = ''
  for (const l of lines) {
    let e: any
    try { e = JSON.parse(l) } catch { continue }
    if (!e || typeof e !== 'object') continue
    if (e.type === 'result') result = e
    else if (e.type === 'rate_limit_event') {
      // Sticky: a later "allowed" event must not erase a warning, and a rejection outranks a warning.
      const w = warningOf(e)
      if (w && warning?.status !== 'rejected') warning = w
    } else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) if (c?.type === 'text' && typeof c.text === 'string') assistantText += c.text
    }
  }
  const text = typeof result?.result === 'string' ? result.result : assistantText
  const base = {
    result_text: text.slice(0, 1_048_576),
    num_turns: typeof result?.num_turns === 'number' ? result.num_turns : undefined,
    cost_usd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
  }
  if (warning) return { ...base, status: 'blocked', reason: 'usage', detail: `usage ${warning.status}`, resets_at: warning.resets_at }
  if (result?.subtype === 'success' && !result.is_error) return { ...base, status: 'completed' }
  if (result?.subtype === 'error_max_turns') return { ...base, status: 'completed', detail: `turn cap (${MAX_TURNS}) reached` }
  if (/Not logged in|Please run \/login|OAuth token|authentication_error/i.test(text)) {
    return { ...base, status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' }
  }
  const sub = typeof result?.subtype === 'string' && SAFE_SUBTYPE.test(result.subtype) ? result.subtype : 'error'
  return { ...base, status: 'failed', detail: result ? sub : `exit ${exitCode}` }
}
