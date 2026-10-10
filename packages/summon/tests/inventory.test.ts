import { describe, expect, test } from 'bun:test'
import { collectInventory, type Run } from '../src/inventory.ts'

const stub: Run = (cmd, args) => {
  const key = [cmd.split('/').pop(), ...args].join(' ')
  const table: Record<string, string> = {
    'sw_vers -productVersion': '26.0\n',
    'fdesetup isactive': 'true\n',
    'ps -axo user=,command=': 'yu /bin/bash /Users/yu/love-unlimited/tools/citizen-fleet.sh\nroot /sbin/launchd\n',
    'pmset -g custom': 'Battery Power:\n sleep 1\n',
    'claude --version': '2.1.296 (Claude Code)\n',
    'claude auth status --json': '{"loggedIn":true,"email":"x@y"}',
  }
  return { code: 0, stdout: table[key] ?? '', stderr: key.startsWith('security') ? 'Keychain "login" no-timeout' : '' }
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

describe('collectInventory', () => {
  test('reports the facts Phase 0 needs without leaking account details', () => {
    let inv: Record<string, unknown> = {}
    withEnv({ SUMMON_HOME_OVERRIDE: '/h', SUMMON_CLAUDE_BIN: '/usr/bin/true' }, () => {
      inv = collectInventory('/h', 'yu', (c, a) => stub(c.endsWith('true') ? 'claude' : c, a), (p) => p === '/Applications/iTerm.app', 501)
    })
    expect(inv).toMatchObject({ macos: '26.0', user: 'yu', filevault: 'true', iterm2: true, fleet_users: ['yu'],
      harnesses: { claude: { version: '2.1.296 (Claude Code)', logged_in: true } } })
    expect(JSON.stringify(inv)).not.toContain('x@y')
    expect(String(inv.keychain)).toContain('no-timeout')
  })
})
