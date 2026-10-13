import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AllowlistCommand } from './allowlist.ts'
import { ACCESSES, ID_RE, type Access } from './request.ts'
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

/** Phase 0.5 §1: one table feeds `--max-turns` and the `error_max_turns` detail. The job timeout stays the time bound. */
export const MAX_TURNS: Readonly<Record<Access, number>> = { review: 40, edit: 60, build: 60 }

/**
 * The executable a program name stands for: an absolute path is judged as it is, a bare name is looked up on `searchPath` (first
 * match wins, as a shell would). The answer is the executable's realpath, or null when there is none. Injectable, so tests need no disk.
 */
export type ProgramResolver = (program: string, searchPath: string) => string | null
export const resolveProgram: ProgramResolver = (program, searchPath) => {
  const candidates = program.startsWith('/') ? [program] : searchPath.split(':').filter((d) => d.startsWith('/')).map((d) => join(d, program))
  for (const c of candidates) {
    if (!isExecutable(c)) continue
    try { return realpathSync.native(c) } catch { /* gone since the check: try the next */ }
  }
  return null
}

export interface Invocation { bin: string; args: string[]; env: Record<string, string>; stdin: string }
export interface Outcome {
  status: JobStatus
  reason?: string
  /**
   * Runner-authored: a fixed string, a number, or one of Claude's own `error_*` subtype words (SAFE_SUBTYPE, the only
   * harness words let through). The ledger holds it, so no other harness output goes here.
   */
  detail?: string
  /** The harness's own text. Goes in the 0600 result file, never in a ledger. */
  result_text?: string
  num_turns?: number
  cost_usd?: number
  resets_at?: string
}

// A folder or command spelled with these would split or reinterpret the comma-separated `--allowedTools` and `--disallowedTools` rules built from it.
const UNSAFE_IN_RULE = /[\u0000-\u001f\u007f,()*?[\]{}\\]/

/** Phase 0.5 §3. Written out in full, with `~` as Claude Code reads it: nothing writable outside the folder, no network, no sockets, no unconfined fallback. */
const SANDBOX_SETTINGS = JSON.stringify({
  sandbox: {
    enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false,
    filesystem: { allowWrite: [], denyRead: ['~/.ssh', '~/.claude', '~/.config/summon', '~/.local/share/summon', '~/.local/state/summon'] },
    network: { allowedDomains: [], allowLocalBinding: false, allowAllUnixSockets: false },
  },
})

/** Phase 0's two: no repository hook and no filesystem monitor can run a program. Review jobs keep exactly these. */
const HOOK_OFF_PAIRS: ReadonlyArray<readonly [string, string]> = [['core.hooksPath', '/dev/null'], ['core.fsmonitor', 'false']]
/** Phase 0.5 §2: edit and build jobs add the pager, the editor, signing and the ssh command. GIT_CONFIG_COUNT is derived from this list. */
const SANDBOXED_GIT_PAIRS: ReadonlyArray<readonly [string, string]> = [...HOOK_OFF_PAIRS, ['core.pager', 'cat'], ['core.editor', 'true'],
  ['commit.gpgsign', 'false'], ['core.sshCommand', '/usr/bin/false']]

const gitConfigEnv = (pairs: ReadonlyArray<readonly [string, string]>): Record<string, string> =>
  Object.fromEntries([['GIT_CONFIG_COUNT', String(pairs.length)], ...pairs.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])])

const BUILD_GIT_READ_RULES = ['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git rev-parse:*)']

/** The rule(s) for one run string: the exact command, and with `args` anything after it. */
const commandRules = (run: string, args: boolean): string[] => [`Bash(${run})`, ...(args ? [`Bash(${run}:*)`] : [])]

/**
 * Phase 0.5 §2, build jobs. Returns the allow rules for the commands and the directories to append to PATH.
 * An absolute program's directory goes after the system directories; its basename form is allowed only if that name, looked up on the
 * final PATH, is the very same executable (same realpath). Otherwise a different program of that name could be started under the rule.
 */
function buildRules(commands: AllowlistCommand[], systemPath: string, resolve: ProgramResolver): { allow: string[]; path: string } {
  const dirs: string[] = []
  const have = new Set(systemPath.split(':'))
  for (const c of commands) {
    const program = c.run.split(' ')[0]!
    if (!program.startsWith('/')) continue
    if (program.includes(':')) throw new Error('build command program path would split PATH')
    const dir = dirname(program)
    if (!have.has(dir)) { have.add(dir); dirs.push(dir) }
  }
  const path = [systemPath, ...dirs].join(':')
  const allow: string[] = []
  for (const c of commands) {
    allow.push(...commandRules(c.run, c.args))
    const program = c.run.split(' ')[0]!
    if (!program.startsWith('/')) continue
    const base = program.slice(program.lastIndexOf('/') + 1)
    const wanted = resolve(program, path)
    if (wanted !== null && resolve(base, path) === wanted) allow.push(...commandRules(`${base}${c.run.slice(program.length)}`, c.args))
  }
  return { allow, path }
}

/**
 * Spec §4.6: the quiet config proven on Alpha. The prompt goes on stdin, never in argv; env is built from scratch.
 * Phase 0.5: an edit or build job gets the sandbox (--settings), its own TMPDIR inside the folder, the stricter git env and the `.git`
 * denies; a build job also gets its folder entry's commands. `commands` is the admission's list and is used by a build job only.
 * Throws (fail closed, the job does not start) for an access it does not know; for an edit or build job whose folder, id or command
 * strings cannot be written into a rule, a path or the git ceiling list safely; and for a build job with no commands.
 */
export function claudeInvocation(job: { id: string; model: string; effort?: string; access: Access; cwdReal: string; commands: AllowlistCommand[]; prompt: string },
  home: string, bin: string, user: string, resolve: ProgramResolver = resolveProgram): Invocation {
  if (!(ACCESSES as readonly string[]).includes(job.access)) throw new Error('unknown access')
  const args = ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-chrome',
    '--disable-slash-commands', '--no-session-persistence', `--max-turns=${MAX_TURNS[job.access]}`, `--model=${job.model}`,
    ...(job.effort ? [`--effort=${job.effort}`] : []), '--permission-mode=acceptEdits', '--permission-prompts=none']
  let path = `${home}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`
  let env: Record<string, string> = {
    HOME: home, USER: user, LOGNAME: user, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp', PATH: path,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_MAX_RETRIES: '2', DISABLE_AUTOUPDATER: '1', ...gitConfigEnv(HOOK_OFF_PAIRS),
  }
  if (job.access === 'review') {
    args.push('--tools=Read,Glob,Grep')
  } else {
    if (UNSAFE_IN_RULE.test(job.cwdReal)) throw new Error('edit folder has characters that cannot be written into a deny rule safely')
    if (!ID_RE.test(job.id)) throw new Error('job id cannot name a temp directory')
    const folder = job.cwdReal.replace(/\/+$/, '')
    // The leading // of every folder rule says "absolute"; a relative or root folder would write a rule that means something else.
    if (!folder.startsWith('/')) throw new Error('edit folder is not an absolute path below the root')
    const parent = dirname(folder)
    // GIT_CEILING_DIRECTORIES is colon-separated: a colon in the parent would split it into entries that stop nothing.
    if (parent.includes(':')) throw new Error('edit folder has a parent that cannot be written into GIT_CEILING_DIRECTORIES')
    const allow = ['Bash(git add:*)', 'Bash(git commit:*)']
    if (job.access === 'build') {
      if (job.commands.length === 0) throw new Error('a build job has no commands')
      for (const c of job.commands) {
        if (UNSAFE_IN_RULE.test(c.run)) throw new Error('build command has characters that cannot be written into an allow rule safely')
      }
      const built = buildRules(job.commands, path, resolve)
      path = built.path
      allow.push(...built.allow, ...BUILD_GIT_READ_RULES)
    }
    const hooks = `${folder}/.githooks/**`
    const deny = ['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)',
      `Edit(/${hooks})`, `Write(/${hooks})`,
      // The leading // marks an absolute path. **/ also matches no directory at all, so these cover <folder>/.git/** itself.
      `Edit(/${folder}/**/.git/**)`, `Write(/${folder}/**/.git/**)`, `Edit(/${folder}/**/.GIT/**)`, `Write(/${folder}/**/.GIT/**)`]
    args.push('--tools=Read,Write,Edit,Glob,Grep,Bash', `--allowedTools=${[...new Set(allow)].join(',')}`, `--disallowedTools=${deny.join(',')}`,
      `--settings=${SANDBOX_SETTINGS}`)
    env = {
      ...env, PATH: path, TMPDIR: `${folder}/.summon-tmp/${job.id}`, ...gitConfigEnv(SANDBOXED_GIT_PAIRS),
      GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_PAGER: 'cat', GIT_CEILING_DIRECTORIES: parent,
    }
  }
  return { bin, args, env, stdin: job.prompt }
}

/** Total: a missing, non-finite or out-of-range `resetsAt` gives undefined, never a throw (a throw here would hide a usage block). */
function resetIso(r: any): string | undefined {
  if (typeof r?.resetsAt !== 'number' || !Number.isFinite(r.resetsAt)) return undefined
  const d = new Date(r.resetsAt * 1000)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

type UsageWarning = { status: string; resets_at?: string }

function warningOf(e: any): UsageWarning | null {
  if (e?.type !== 'rate_limit_event') return null
  const info = e.rate_limit_info ?? e
  return info?.status === 'allowed_warning' || info?.status === 'rejected' ? { status: info.status, resets_at: resetIso(info) } : null
}

export function usageWarning(line: string): UsageWarning | null {
  let e: unknown
  try { e = JSON.parse(line) } catch { return null }
  return warningOf(e)
}

// The only subtypes worth naming are Claude's own `error_*` words; anything else is not echoed into a detail.
const SAFE_SUBTYPE = /^error_[a-z_]{1,40}$/
// Claude Code's own API-error words (top-level `error` on an assistant event flagged `is_api_error_message`) that mean "log in again".
const AUTH_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed'])
// Read only over an error result's own `result` text, never over the model's narration. The last two are 2.1.296's headless texts.
const AUTH_TEXT = /Not logged in|Please run \/login|OAuth token|authentication_error|OAuth session expired|Authentication required/i
// 2.1.296 while another Claude Code process holds the login refresh (`error: 'server_error'`): transient, not a logged-out Mac.
const REFRESH_BUSY = /another Claude Code process is refreshing it/i
// What claude prints on stderr, before any stdout, when it does not accept Summon's argv (a flag renamed or removed by an
// update). 2.1.296 words a bad --setting-sources as "Error processing --setting-sources: Invalid setting source: …".
const CLI_PARSE_FAILURE = /^error: unknown option|argument '[^'\n]*' is invalid\. Allowed choices|Invalid --setting-sources|^Error processing --setting-sources/m

/**
 * Decision order: usage, auth (then a busy login refresh), permission, turn cap, then success or failure.
 * Every detail is runner-authored.
 * `stderr` is the head of claude's stderr; only whether it matches a known parse failure is used, never its text.
 * `access` is the job's own (the turn cap it names comes from MAX_TURNS); the default, review, is the smallest cap.
 */
export function interpretClaudeStream(lines: string[], exitCode: number | null, stderr = '', access: Access = 'review'): Outcome {
  let result: any = null
  let warning: UsageWarning | null = null
  let assistantText = ''
  const apiErrors: { error: string; text: string }[] = []
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
      let text = ''
      for (const c of e.message.content) if (c?.type === 'text' && typeof c.text === 'string') text += c.text
      assistantText += text
      if (e.is_api_error_message === true && typeof e.error === 'string') apiErrors.push({ error: e.error, text })
    }
  }
  const resultText = typeof result?.result === 'string' ? result.result : null
  const text = resultText ?? assistantText
  const base = {
    result_text: text.slice(0, 1_048_576),
    num_turns: typeof result?.num_turns === 'number' ? result.num_turns : undefined,
    cost_usd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
  }
  // Only an error result's text counts: a successful answer may quote the phrase (a review of this very file does).
  const refreshBusy = (result?.is_error === true && resultText !== null && REFRESH_BUSY.test(resultText))
    || apiErrors.some((a) => a.error === 'server_error' && REFRESH_BUSY.test(a.text))
  const auth = apiErrors.some((a) => AUTH_ERRORS.has(a.error))
    || (!refreshBusy && result?.is_error === true && resultText !== null && AUTH_TEXT.test(resultText))
  const denials = Array.isArray(result?.permission_denials) ? result.permission_denials.length : 0
  if (warning) return { ...base, status: 'blocked', reason: 'usage', detail: `usage ${warning.status}`, resets_at: warning.resets_at }
  if (auth) return { ...base, status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' }
  if (refreshBusy) return { ...base, status: 'failed', detail: "claude's login refresh was busy; try again in a minute" }
  if (denials > 0) return { ...base, status: 'blocked', reason: 'permission', detail: `${denials} tool call(s) denied` }
  if (result?.subtype === 'error_max_turns') return { ...base, status: 'failed', detail: `turn cap (${MAX_TURNS[access]}) reached before a final answer` }
  if (result?.subtype === 'success' && !result.is_error) return { ...base, status: 'completed' }
  if (CLI_PARSE_FAILURE.test(stderr)) return { ...base, status: 'failed', detail: 'claude rejected its command line (version drift?)' }
  const sub = typeof result?.subtype === 'string' && SAFE_SUBTYPE.test(result.subtype) ? result.subtype : 'error'
  return { ...base, status: 'failed', detail: result ? sub : `exit ${exitCode}` }
}
