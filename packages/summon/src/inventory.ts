import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findClaude, isExecutable } from './harness.ts'
import { codexEnvironment } from './codex.ts'

export type Run = (cmd: string, args: string[], timeoutMs?: number, env?: Record<string, string>) => { code: number | null; stdout: string; stderr: string }
export const runCmd: Run = (cmd, args, timeoutMs = 5000, env) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, ...(env ? { env } : {}) })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function which(name: string, home: string, executable: (p: string) => boolean = isExecutable): string | null {
  for (const d of [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = join(d, name)
    if (executable(p)) return p
  }
  return null
}

/**
 * Where each harness keeps its own files from a summoned job (spec §4.5): they follow that harness's retention, not
 * Summon's 30-day sweep. Phase 0 runs only Claude Code, with --no-session-persistence.
 */
const RETENTION = {
  claude: "no session persistence; large tool outputs may remain under ~/.claude/projects per Claude Code's own cleanup",
  other: 'not run by Summon in Phase 0',
} as const

/** Short facts (versions, paths, names) are trimmed and clipped, so no harness output travels in full. */
const MAX_REPORTED = 200
/** The pmset dump is local settings, not harness output, so it keeps its own, larger bound. */
const MAX_POWER = 2000
function bounded<T>(v: T): T {
  if (typeof v === 'string') return v.trim().slice(0, MAX_REPORTED) as T
  if (Array.isArray(v)) return v.map(bounded) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bounded(x)])) as T
  return v
}

/** Login name of the /dev/console owner, or null when stat cannot say. */
function consoleOwner(run: Run): string | null {
  const r = run('/usr/bin/stat', ['-f', '%Su', '/dev/console'])
  return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null
}

/** A version is the first line of a command that exited 0; null when it exits non-zero, cannot start, or prints nothing. */
function firstLine(r: { code: number | null; stdout: string }): string | null {
  if (r.code !== 0) return null
  return (r.stdout.split('\n')[0] ?? '').trim() || null
}

/** `codex login status` is read for its exit code only: its output can name the account, so it never leaves this function. */
function codexFacts(home: string, user: string, run: Run, executable: (p: string) => boolean): Record<string, unknown> | null {
  const path = which('codex', home, executable)
  if (!path) return null
  // A Node-backed launcher needs the same explicit PATH as a job. A failed launcher is not evidence of logout.
  const env = codexEnvironment(home, user)
  const version = firstLine(run(path, ['--version'], 5000, env))
  const login = version === null ? null : run(path, ['login', 'status'], 15_000, env).code
  return { path, version, logged_in: login === 0 ? true : login === 1 ? false : null,
    retention: 'review jobs use --ephemeral; native authentication and auxiliary state retain their own lifecycle' }
}

/** Hermes keeps its login in auth.json; only that file's existence is read, never its contents. */
function hermesFacts(home: string, run: Run, exists: (p: string) => boolean): Record<string, unknown> | null {
  const path = join(home, '.hermes/hermes-agent/venv/bin/hermes')
  if (!exists(path)) return null
  return { path, version: firstLine(run(path, ['--version'])), logged_in: exists(join(home, '.hermes/auth.json')), retention: RETENTION.other }
}

/** sol counts as verified when `sol version` runs and prints a version. */
function solFacts(home: string, run: Run, exists: (p: string) => boolean): Record<string, unknown> | null {
  const path = join(home, '.config/sol/bin/sol')
  if (!exists(path)) return null
  return { path, version: firstLine(run(path, ['version'])) }
}

/** Read-only facts about this Mac (spec §5.3). Runs in the runner, i.e. Yu's GUI session. */
export function collectInventory(home: string, user: string, run: Run = runCmd, exists: (p: string) => boolean = existsSync,
  consoleUid: number | null = (() => { try { return statSync('/dev/console').uid } catch { return null } })(),
  executable: (p: string) => boolean = isExecutable): Record<string, unknown> {
  const claude = findClaude(home)
  let claudeLoggedIn: boolean | null = null
  if (claude) { try { claudeLoggedIn = JSON.parse(run(claude, ['auth', 'status', '--json'], 15_000).stdout).loggedIn === true } catch { claudeLoggedIn = null } }
  const kc = run('/usr/bin/security', ['show-keychain-info', join(home, 'Library/Keychains/login.keychain-db')])
  const ps = run('/bin/ps', ['-axo', 'user=,command='])
  const fleetUsers = [...new Set(ps.stdout.split('\n').filter((l) => /citizen-fleet|love-unlimited/.test(l)).map((l) => l.trim().split(/\s+/)[0]!))]
  const power = run('/usr/bin/pmset', ['-g', 'custom']).stdout.trim().slice(0, MAX_POWER)
  return {
    ...bounded({
      collected_at: new Date().toISOString(),
      macos: run('/usr/bin/sw_vers', ['-productVersion']).stdout,
      user,
      console_user: consoleOwner(run),
      gui_session_is_mine: consoleUid !== null && consoleUid === process.getuid!(),
      filevault: run('/usr/bin/fdesetup', ['isactive']).stdout,
      keychain: kc.stdout + kc.stderr,
      harnesses: {
        claude: claude ? { path: claude, version: run(claude, ['--version']).stdout, logged_in: claudeLoggedIn, retention: RETENTION.claude } : null,
        codex: codexFacts(home, user, run, executable),
        hermes: hermesFacts(home, run, exists),
      },
      iterm2: exists('/Applications/iTerm.app'),
      tmux: which('tmux', home, executable),
      sol: solFacts(home, run, exists),
      fleet_users: fleetUsers,
    }),
    power,
  }
}
