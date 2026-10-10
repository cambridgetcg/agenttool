import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { collectInventory, type Run } from '../src/inventory.ts'

type Reply = { code?: number | null; stdout?: string; stderr?: string }

// Canned replies keyed by "<binary basename> <args>". A command with no reply exits 0 with no output.
const defaults: Record<string, Reply> = {
  'sw_vers -productVersion': { stdout: '26.0\n' },
  'fdesetup isactive': { stdout: 'true\n' },
  'ps -axo user=,command=': { stdout: 'yu /bin/bash /Users/yu/love-unlimited/tools/citizen-fleet.sh\nroot /sbin/launchd\n' },
  'pmset -g custom': { stdout: 'Battery Power:\n sleep 1\n' },
  'claude --version': { stdout: '2.1.296 (Claude Code)\n' },
  'claude auth status --json': { stdout: '{"loggedIn":true,"email":"x@y"}' },
  'codex --version': { stdout: 'codex-cli 0.9.1\n' },
  'codex login status': { stdout: 'Logged in as zq7@example.test\n' },
  // The real `hermes --version` prints a banner with install paths; only its first line may be reported.
  'hermes --version': { stdout: 'Hermes Agent v2.0.0\nProject: /Users/x/.hermes/hermes-agent\nPython: 3.12\n' },
  // `sol version` prints the manifest version; `sol --version` is not a sol command.
  'sol version': { stdout: 'sol 1.4.0\nmanifest: /Users/x/.config/sol/manifest.json\n' },
  'stat -f %Su /dev/console': { stdout: 'yu\n' },
}

/** Canned replies merged over the defaults. The binary /usr/bin/true stands in for claude, matching the test override. */
function fakeRun(replies: Record<string, Reply> = {}): Run {
  const table = { ...defaults, ...replies }
  return (cmd, args) => {
    const name = cmd === '/usr/bin/true' ? 'claude' : (cmd.split('/').pop() ?? '')
    const r = table[[name, ...args].join(' ')] ?? {}
    return {
      code: r.code === undefined ? 0 : r.code,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? (name === 'security' ? 'Keychain "login" no-timeout' : ''),
    }
  }
}

/** Sets env vars for fn and restores the previous values even when an assertion inside fn throws. */
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** collectInventory with claude pointed at /usr/bin/true through the test override. */
function inventoryWithClaude(run: Run, exists: (p: string) => boolean, executable: (p: string) => boolean): Record<string, unknown> {
  let inv: Record<string, unknown> = {}
  withEnv({ SUMMON_HOME_OVERRIDE: '/h', SUMMON_CLAUDE_BIN: '/usr/bin/true' }, () => {
    inv = collectInventory('/h', 'yu', run, exists, 501, executable)
  })
  return inv
}

const H = '/h'
const codexPath = join(H, '.local/bin/codex')
const tmuxPath = join(H, '.local/bin/tmux')
const hermesPath = join(H, '.hermes/hermes-agent/venv/bin/hermes')
const solPath = join(H, '.config/sol/bin/sol')
// Existing paths: codex and tmux exist here, but only the executable ones count as installed.
const installed = new Set(['/Applications/iTerm.app', codexPath, tmuxPath, hermesPath, join(H, '.hermes/auth.json'), solPath])
const present = (p: string) => installed.has(p)
const runnable = new Set([codexPath, tmuxPath])
const executable = (p: string) => runnable.has(p)
const nothing = () => false

/** Every string anywhere in a value, for bounding checks. */
function allStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(allStrings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(allStrings)
  return []
}

describe('collectInventory', () => {
  test('reports the facts Phase 0 needs without leaking account details', () => {
    const inv = inventoryWithClaude(fakeRun(), (p) => p === '/Applications/iTerm.app', nothing)
    expect(inv).toMatchObject({ macos: '26.0', user: 'yu', filevault: 'true', iterm2: true, fleet_users: ['yu'],
      harnesses: { claude: { version: '2.1.296 (Claude Code)', logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('x@y')
    expect(String(inv.keychain)).toContain('no-timeout')
  })

  test('codex, hermes, sol, tmux and the console user report path, version and login state', () => {
    const inv = inventoryWithClaude(fakeRun(), present, executable)
    expect(inv).toMatchObject({
      console_user: 'yu',
      gui_session_is_mine: expect.any(Boolean),
      sol: { path: solPath, version: 'sol 1.4.0' },
      tmux: tmuxPath,
      harnesses: {
        codex: { path: codexPath, version: 'codex-cli 0.9.1', logged_in: true },
        hermes: { path: hermesPath, version: 'Hermes Agent v2.0.0', logged_in: true },
      },
    })
  })

  test('a version is the first line of the output; the banner with install paths never reaches the inventory', () => {
    const inv = inventoryWithClaude(fakeRun(), present, executable)
    expect(inv).toMatchObject({ harnesses: { hermes: { version: 'Hermes Agent v2.0.0' } } })
    expect(JSON.stringify(inv)).not.toContain('/Users/x')
  })

  test('codex and hermes report version null when their version command exits non-zero or cannot start', () => {
    const inv = inventoryWithClaude(fakeRun({
      'codex --version': { code: 2, stdout: 'error: unknown flag' },
      'hermes --version': { code: null },
    }), present, executable)
    expect(inv).toMatchObject({
      harnesses: {
        codex: { path: codexPath, version: null },
        hermes: { path: hermesPath, version: null },
      },
    })
    expect(JSON.stringify(inv)).not.toContain('unknown flag')
  })

  test('harnesses, sol and the console user report null when they are not installed or cannot be read', () => {
    const inv = inventoryWithClaude(fakeRun({ 'stat -f %Su /dev/console': { code: 1 } }), () => false, nothing)
    expect(inv).toMatchObject({ console_user: null, sol: null, tmux: null, iterm2: false,
      harnesses: { codex: null, hermes: null } })
  })

  test('a file that exists but is not executable is not reported as codex or tmux', () => {
    const inv = inventoryWithClaude(fakeRun(), present, nothing)
    expect(inv).toMatchObject({ tmux: null, harnesses: { codex: null, hermes: { path: hermesPath } } })
  })

  test('codex login status exit 0 is logged in, a non-zero exit is logged out, and a run that cannot start is unknown', () => {
    const out = (code: number | null) => inventoryWithClaude(fakeRun({ 'codex login status': { code } }), present, executable)
    expect(out(0)).toMatchObject({ harnesses: { codex: { logged_in: true } } })
    expect(out(1)).toMatchObject({ harnesses: { codex: { logged_in: false } } })
    expect(out(null)).toMatchObject({ harnesses: { codex: { logged_in: null } } })
  })

  test('codex login status output never reaches the inventory', () => {
    const inv = inventoryWithClaude(fakeRun({
      'codex login status': { code: 0, stdout: 'Logged in as zq7@example.test', stderr: 'account zq7' },
    }), present, executable)
    expect(inv).toMatchObject({ harnesses: { codex: { logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('zq7')
  })

  test('hermes is logged in only when its auth file exists', () => {
    const noAuth = new Set([...installed].filter((p) => !p.endsWith('auth.json')))
    expect(inventoryWithClaude(fakeRun(), (p) => noAuth.has(p), executable))
      .toMatchObject({ harnesses: { hermes: { logged_in: false } } })
  })

  test('sol keeps its path but reports version null when `sol version` exits non-zero', () => {
    const inv = inventoryWithClaude(fakeRun({ 'sol version': { code: 2, stdout: 'usage: sol' } }), present, executable)
    expect(inv).toMatchObject({ sol: { path: solPath, version: null } })
  })

  test('the pmset dump survives whole, past the 200-character bound for short facts', () => {
    const dump = ['Battery Power:', ...Array.from({ length: 47 }, (_, i) => ` setting-${String(i).padStart(2, '0')}  ${i % 3}`)].join('\n')
    expect(Buffer.byteLength(dump)).toBeGreaterThan(700)
    const inv = inventoryWithClaude(fakeRun({ 'pmset -g custom': { stdout: `${dump}\n` } }), present, executable)
    expect(inv).toMatchObject({ power: dump })
  })

  test('short facts are clipped to 200 characters; power is clipped to 2000', () => {
    const inv = inventoryWithClaude(fakeRun({
      'hermes --version': { stdout: 'h'.repeat(500) },
      'pmset -g custom': { stdout: 'p'.repeat(2500) },
    }), present, executable)
    expect(inv).toMatchObject({ harnesses: { hermes: { version: 'h'.repeat(200) } } })
    expect(String(inv.power).length).toBe(2000)
    expect(Math.max(...allStrings({ ...inv, power: undefined }).map((s) => s.length))).toBeLessThanOrEqual(200)
  })
})
