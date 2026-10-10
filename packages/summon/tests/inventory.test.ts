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
  'hermes --version': { stdout: 'Hermes 2.0.0\n' },
  'sol --version': { stdout: 'sol 1.4.0\n' },
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
function inventoryWithClaude(run: Run, exists: (p: string) => boolean): Record<string, unknown> {
  let inv: Record<string, unknown> = {}
  withEnv({ SUMMON_HOME_OVERRIDE: '/h', SUMMON_CLAUDE_BIN: '/usr/bin/true' }, () => {
    inv = collectInventory('/h', 'yu', run, exists, 501)
  })
  return inv
}

const H = '/h'
const installed = new Set([
  '/Applications/iTerm.app',
  join(H, '.local/bin/codex'),
  join(H, '.hermes/hermes-agent/venv/bin/hermes'),
  join(H, '.hermes/auth.json'),
  join(H, '.config/sol/bin/sol'),
])
const present = (p: string) => installed.has(p)

/** Every string anywhere in a value, for bounding checks. */
function allStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(allStrings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(allStrings)
  return []
}

describe('collectInventory', () => {
  test('reports the facts Phase 0 needs without leaking account details', () => {
    const inv = inventoryWithClaude(fakeRun(), (p) => p === '/Applications/iTerm.app')
    expect(inv).toMatchObject({ macos: '26.0', user: 'yu', filevault: 'true', iterm2: true, fleet_users: ['yu'],
      harnesses: { claude: { version: '2.1.296 (Claude Code)', logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('x@y')
    expect(String(inv.keychain)).toContain('no-timeout')
  })

  test('codex, hermes, sol and the console user report path, version and login state', () => {
    const inv = inventoryWithClaude(fakeRun(), present)
    expect(inv).toMatchObject({
      console_user: 'yu',
      gui_session_is_mine: expect.any(Boolean),
      sol: { path: join(H, '.config/sol/bin/sol'), version: 'sol 1.4.0' },
      tmux: null,
      harnesses: {
        codex: { path: join(H, '.local/bin/codex'), version: 'codex-cli 0.9.1', logged_in: true },
        hermes: { path: join(H, '.hermes/hermes-agent/venv/bin/hermes'), version: 'Hermes 2.0.0', logged_in: true },
      },
    })
  })

  test('harnesses, sol and the console user report null when they are not installed or cannot be read', () => {
    const inv = inventoryWithClaude(fakeRun({ 'stat -f %Su /dev/console': { code: 1 } }), () => false)
    expect(inv).toMatchObject({ console_user: null, sol: null, tmux: null, iterm2: false,
      harnesses: { codex: null, hermes: null } })
  })

  test('codex login status exit 0 is logged in, a non-zero exit is logged out, and a run that cannot start is unknown', () => {
    const out = (code: number | null) => inventoryWithClaude(fakeRun({ 'codex login status': { code } }), present)
    expect(out(0)).toMatchObject({ harnesses: { codex: { logged_in: true } } })
    expect(out(1)).toMatchObject({ harnesses: { codex: { logged_in: false } } })
    expect(out(null)).toMatchObject({ harnesses: { codex: { logged_in: null } } })
  })

  test('codex login status output never reaches the inventory', () => {
    const inv = inventoryWithClaude(fakeRun({
      'codex login status': { code: 0, stdout: 'Logged in as zq7@example.test', stderr: 'account zq7' },
    }), present)
    expect(inv).toMatchObject({ harnesses: { codex: { logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('zq7')
  })

  test('hermes is logged in only when its auth file exists', () => {
    const noAuth = new Set([...installed].filter((p) => !p.endsWith('auth.json')))
    expect(inventoryWithClaude(fakeRun(), (p) => noAuth.has(p))).toMatchObject({ harnesses: { hermes: { logged_in: false } } })
  })

  test('sol keeps its path but reports version null when it exits non-zero', () => {
    const inv = inventoryWithClaude(fakeRun({ 'sol --version': { code: 2, stdout: 'usage: sol' } }), present)
    expect(inv).toMatchObject({ sol: { path: join(H, '.config/sol/bin/sol'), version: null } })
  })

  test('every reported string is trimmed and clipped to 200 characters', () => {
    const inv = inventoryWithClaude(fakeRun({
      'hermes --version': { stdout: 'h'.repeat(500) },
      'pmset -g custom': { stdout: 'p'.repeat(500) },
    }), present)
    expect(inv).toMatchObject({ harnesses: { hermes: { version: 'h'.repeat(200) } } })
    expect(Math.max(...allStrings(inv).map((s) => s.length))).toBeLessThanOrEqual(200)
  })
})
