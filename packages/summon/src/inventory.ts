import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findClaude, isExecutable } from './harness.ts'

export type Run = (cmd: string, args: string[], timeoutMs?: number) => { code: number | null; stdout: string; stderr: string }
export const runCmd: Run = (cmd, args, timeoutMs = 5000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function which(name: string, home: string, executable: (p: string) => boolean = isExecutable): string | null {
  for (const d of [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = join(d, name)
    if (executable(p)) return p
  }
  return null
}

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
function codexFacts(home: string, run: Run, executable: (p: string) => boolean): Record<string, unknown> | null {
  const path = which('codex', home, executable)
  if (!path) return null
  const login = run(path, ['login', 'status'], 15_000).code
  return { path, version: firstLine(run(path, ['--version'])), logged_in: login === null ? null : login === 0 }
}

/** Hermes keeps its login in auth.json; only that file's existence is read, never its contents. */
function hermesFacts(home: string, run: Run, exists: (p: string) => boolean): Record<string, unknown> | null {
  const path = join(home, '.hermes/hermes-agent/venv/bin/hermes')
  if (!exists(path)) return null
  return { path, version: firstLine(run(path, ['--version'])), logged_in: exists(join(home, '.hermes/auth.json')) }
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
        claude: claude ? { path: claude, version: run(claude, ['--version']).stdout, logged_in: claudeLoggedIn } : null,
        codex: codexFacts(home, run, executable),
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
