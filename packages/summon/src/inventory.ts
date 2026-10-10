import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findClaude, isExecutable } from './harness.ts'

export type Run = (cmd: string, args: string[], timeoutMs?: number) => { code: number | null; stdout: string; stderr: string }
export const runCmd: Run = (cmd, args, timeoutMs = 5000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function which(name: string, home: string, exists: (p: string) => boolean = isExecutable): string | null {
  for (const d of [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = join(d, name)
    if (exists(p)) return p
  }
  return null
}

/** Read-only facts about this Mac (spec §5.3). Runs in the runner, i.e. Yu's GUI session. */
export function collectInventory(home: string, user: string, run: Run = runCmd, exists: (p: string) => boolean = existsSync,
  consoleUid: number | null = (() => { try { return statSync('/dev/console').uid } catch { return null } })()): Record<string, unknown> {
  const claude = findClaude(home)
  let claudeLoggedIn: boolean | null = null
  if (claude) { try { claudeLoggedIn = JSON.parse(run(claude, ['auth', 'status', '--json'], 15_000).stdout).loggedIn === true } catch { claudeLoggedIn = null } }
  const kc = run('/usr/bin/security', ['show-keychain-info', join(home, 'Library/Keychains/login.keychain-db')])
  const ps = run('/bin/ps', ['-axo', 'user=,command='])
  const fleetUsers = [...new Set(ps.stdout.split('\n').filter((l) => /citizen-fleet|love-unlimited/.test(l)).map((l) => l.trim().split(/\s+/)[0]!))]
  return {
    collected_at: new Date().toISOString(),
    macos: run('/usr/bin/sw_vers', ['-productVersion']).stdout.trim(),
    user,
    gui_session_is_mine: consoleUid !== null && consoleUid === process.getuid!(),
    filevault: run('/usr/bin/fdesetup', ['isactive']).stdout.trim(),
    keychain: (kc.stdout + kc.stderr).trim().slice(0, 200),
    harnesses: {
      claude: claude ? { path: claude, version: run(claude, ['--version']).stdout.trim(), logged_in: claudeLoggedIn } : null,
      codex: which('codex', home),
      hermes: exists(join(home, '.hermes/hermes-agent/venv/bin/hermes')) ? join(home, '.hermes/hermes-agent/venv/bin/hermes') : null,
    },
    iterm2: exists('/Applications/iTerm.app'),
    tmux: which('tmux', home),
    sol: exists(join(home, '.config/sol/bin/sol')),
    fleet_users: fleetUsers,
    power: run('/usr/bin/pmset', ['-g', 'custom']).stdout.slice(0, 2000),
  }
}
