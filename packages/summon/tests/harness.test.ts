import { describe, expect, test } from 'bun:test'
import { MAX_TURNS, claudeInvocation, interpretClaudeStream, usageWarning } from '../src/harness.ts'

const job = (access: 'review' | 'edit') => ({ model: 'sonnet', access, cwdReal: '/Users/yu/Projects/x', prompt: 'hi 愛' })

describe('claudeInvocation', () => {
  test('review: read-only tools, quiet flags, prompt on stdin only', () => {
    const inv = claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu')
    expect(inv.bin).toBe('/bin/claude')
    expect(inv.args).toContain('--tools=Read,Glob,Grep')
    for (const f of ['-p', '--verbose', '--output-format=stream-json', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence',
      '--no-chrome', '--disable-slash-commands', '--permission-mode=acceptEdits', '--permission-prompts=none', '--model=sonnet',
      `--max-turns=${MAX_TURNS}`]) expect(inv.args).toContain(f)
    expect(MAX_TURNS).toBe(12)
    expect(inv.args.some((a) => a.includes('hi 愛'))).toBe(false)
    expect(inv.stdin).toBe('hi 愛')
  })
  test('review: no Write, Edit or Bash, and no allow or deny rules', () => {
    const inv = claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu')
    expect(inv.args.some((a) => a.startsWith('--allowedTools') || a.startsWith('--disallowedTools'))).toBe(false)
    expect(inv.args.filter((a) => a.startsWith('--tools='))).toEqual(['--tools=Read,Glob,Grep'])
  })
  test('edit: Alpha posture — git add/commit only, push/rm/hooks denied', () => {
    const inv = claudeInvocation(job('edit'), '/Users/yu', '/bin/claude', 'yu')
    expect(inv.args).toContain('--tools=Read,Write,Edit,Glob,Grep,Bash')
    expect(inv.args).toContain('--permission-mode=acceptEdits')
    expect(inv.args).toContain('--permission-prompts=none')
    expect(inv.args).toContain('--allowedTools=Bash(git add:*),Bash(git commit:*)')
    const deny = inv.args.find((a) => a.startsWith('--disallowedTools='))!.slice('--disallowedTools='.length).split(',')
    for (const r of ['Bash(git push:*)', 'Bash(git ls-remote:*)', 'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(cp:*)', 'Bash(sed:*)',
      'Edit(//Users/yu/Projects/x/.githooks/**)', 'Write(//Users/yu/Projects/x/.githooks/**)']) expect(deny).toContain(r)
    expect(inv.stdin).toBe('hi 愛')
    expect(inv.args.some((a) => a.includes('hi 愛'))).toBe(false)
  })
  test('edit: a trailing slash on the folder does not change the hooks rule', () => {
    const inv = claudeInvocation({ ...job('edit'), cwdReal: '/Users/yu/Projects/x/' }, '/Users/yu', '/bin/claude', 'yu')
    expect(inv.args.find((a) => a.startsWith('--disallowedTools='))).toContain('Edit(//Users/yu/Projects/x/.githooks/**)')
  })
  test('edit: a folder whose spelling would break the comma-separated deny rule is refused, not mis-parsed', () => {
    for (const bad of ['/Users/yu/a,b', '/Users/yu/a(b)', '/Users/yu/a*b', '/Users/yu/a[b]', '/Users/yu/a\nb']) {
      expect(() => claudeInvocation({ ...job('edit'), cwdReal: bad }, '/Users/yu', '/bin/claude', 'yu')).toThrow()
    }
    // review has no folder-derived rule, so the same folder is fine there
    expect(() => claudeInvocation({ ...job('review'), cwdReal: '/Users/yu/a,b' }, '/Users/yu', '/bin/claude', 'yu')).not.toThrow()
  })
  test('env is built from scratch: no API key or base URL, hooks off', () => {
    process.env.ANTHROPIC_API_KEY = 'leak'
    process.env.ANTHROPIC_BASE_URL = 'https://leak.example'
    process.env.ANTHROPIC_AUTH_TOKEN = 'leak'
    let inv: ReturnType<typeof claudeInvocation>
    try { inv = claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu') } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_BASE_URL
      delete process.env.ANTHROPIC_AUTH_TOKEN
    }
    expect(inv.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(Object.keys(inv.env).filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([])
    expect(Object.values(inv.env).some((v) => v.includes('leak'))).toBe(false)
    expect(inv.env).toMatchObject({ HOME: '/Users/yu', USER: 'yu', LOGNAME: 'yu', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' })
    expect(inv.env.GIT_CONFIG_COUNT).toBe('2')
    expect(inv.env.PATH.startsWith('/Users/yu/.local/bin:')).toBe(true)
  })
})

const L = (o: object) => JSON.stringify(o)
describe('interpretClaudeStream', () => {
  test('success', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, total_cost_usd: 0.1 })], 0))
      .toMatchObject({ status: 'completed', result_text: 'done', num_turns: 2, cost_usd: 0.1 })
  })
  test('turn cap is a completed job with a note, keeping assistant text', () => {
    expect(interpretClaudeStream([L({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }),
      L({ type: 'result', subtype: 'error_max_turns', is_error: true })], 1)).toMatchObject({ status: 'completed', result_text: 'partial' })
  })
  test('usage warning or rejection is blocked(usage) with reset time', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_791_700_000 } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage allowed_warning', resets_at: new Date(1_791_700_000_000).toISOString() })
  })
  test('a later "allowed" event does not erase an earlier warning', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1_791_700_000 } }),
      L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', resets_at: new Date(1_791_700_000_000).toISOString() })
  })
  test('a rejection beats an earlier warning', () => {
    const o = interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }),
      L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_791_700_000 } })], 1)
    expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage rejected' })
  })
  test('plain "allowed" events are not a usage block', () => {
    expect(interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
      L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)).toMatchObject({ status: 'completed' })
  })
  test('not logged in is blocked(auth)', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })], 1))
      .toMatchObject({ status: 'blocked', reason: 'auth' })
  })
  test('auth failure: detail is runner-authored; the harness text stays out of it', () => {
    const odd = `Not logged in ${'ÿ愛 secret-ish "quote" \n'.repeat(60)}`
    const o = interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: odd })], 1)
    expect(o).toMatchObject({ status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' })
    expect(o.detail).not.toContain('secret-ish')
    expect(o.result_text).toBe(odd)
  })
  test('detail is never harness output, whatever the branch', () => {
    const hostile = 'SECRET-PROMPT-FRAGMENT'
    const outcomes = [
      interpretClaudeStream([L({ type: 'result', subtype: hostile, is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'result', subtype: 'error_max_turns', is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: hostile })], 1),
      interpretClaudeStream([L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', extra: hostile } })], 1),
      interpretClaudeStream([L({ type: 'assistant', message: { content: [{ type: 'text', text: hostile }] } })], 1),
    ]
    for (const o of outcomes) expect(o.detail ?? '').not.toContain(hostile)
    expect(outcomes[0]).toMatchObject({ status: 'failed', detail: 'error' })
  })
  test('a known error subtype is reported as the detail', () => {
    expect(interpretClaudeStream([L({ type: 'result', subtype: 'error_during_execution', is_error: true })], 1))
      .toMatchObject({ status: 'failed', detail: 'error_during_execution' })
  })
  test('no result is failed', () => {
    expect(interpretClaudeStream(['garbage'], 137)).toMatchObject({ status: 'failed', detail: 'exit 137' })
  })
  test('no result and no exit code is failed, not a crash', () => {
    expect(interpretClaudeStream([], null)).toMatchObject({ status: 'failed', detail: 'exit null' })
  })
  test('lines that are valid JSON but not objects are skipped, never a crash', () => {
    const lines = ['null', '123', '"str"', '[]', 'true', L({ type: 'assistant', message: { content: 'not-an-array' } }),
      L({ type: 'assistant', message: null }), L({ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 'x', total_cost_usd: null })]
    const o = interpretClaudeStream(lines, 0)
    expect(o).toMatchObject({ status: 'completed', result_text: 'ok' })
    expect(o.num_turns).toBeUndefined()
    expect(o.cost_usd).toBeUndefined()
  })
  test('result text is capped at 1 MiB', () => {
    const o = interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'a'.repeat(1_048_576 + 50) })], 0)
    expect(o.result_text!.length).toBe(1_048_576)
  })
  test('usageWarning picks only warning/rejected events', () => {
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toBeNull()
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1 } }))).toMatchObject({ status: 'rejected' })
    expect(usageWarning(L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }))).toMatchObject({ status: 'allowed_warning' })
  })
  test('usageWarning ignores other events, garbage and non-objects', () => {
    for (const l of [L({ type: 'result' }), 'garbage', 'null', '', '123']) expect(usageWarning(l)).toBeNull()
  })
})
