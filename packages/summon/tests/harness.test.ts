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
  test('F24: an admitted effort is passed as --effort=<v>; none means no --effort flag', () => {
    expect(claudeInvocation({ ...job('review'), effort: 'low' }, '/Users/yu', '/bin/claude', 'yu').args).toContain('--effort=low')
    expect(claudeInvocation({ ...job('edit'), effort: 'max' }, '/Users/yu', '/bin/claude', 'yu').args).toContain('--effort=max')
    expect(claudeInvocation(job('review'), '/Users/yu', '/bin/claude', 'yu').args.some((a) => a.startsWith('--effort'))).toBe(false)
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
  test('F35: the turn cap is failed with a runner-authored detail, keeping the narration (the recorded 2.1.296 shape)', () => {
    // Live run 4: interim narration, then a result with `errors` and no `result`, exit 1.
    const o = interpretClaudeStream([
      L({ type: 'assistant', message: { content: [{ type: 'text', text: 'Batch 1 done. Next batch.' }, { type: 'tool_use', name: 'Read' }] } }),
      L({ type: 'assistant', message: { content: [{ type: 'text', text: 'Batch 2 done. Next batch.' }, { type: 'tool_use', name: 'Read' }] } }),
      L({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 13, errors: ['Reached maximum number of turns (12)'], terminal_reason: 'max_turns' }),
    ], 1)
    expect(o).toMatchObject({ status: 'failed', detail: `turn cap (${MAX_TURNS}) reached before a final answer`,
      result_text: 'Batch 1 done. Next batch.Batch 2 done. Next batch.', num_turns: 13 })
    expect(o.detail).toBe('turn cap (12) reached before a final answer')
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
  test('an out-of-range resetsAt is still blocked(usage), just without a reset time', () => {
    for (const raw of ['{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e999}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":-1e16}}']) {
      const o = interpretClaudeStream([raw, L({ type: 'result', subtype: 'success', is_error: false, result: 'x' })], 0)
      expect(o).toMatchObject({ status: 'blocked', reason: 'usage', detail: 'usage rejected' })
      expect(o.resets_at).toBeUndefined()
    }
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
  describe('F02: permission denials', () => {
    const denied = (over: object = {}) => L({ type: 'result', subtype: 'success', is_error: false, result: 'I was not allowed to read /Users/yu/.zshrc',
      num_turns: 2, permission_denials: [{ tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/Users/yu/.zshrc' } }], ...over })
    test('a result with permission denials is blocked(permission); the detail is a runner-authored count and the text is kept', () => {
      const o = interpretClaudeStream([denied()], 0)
      expect(o).toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied', result_text: 'I was not allowed to read /Users/yu/.zshrc' })
      expect(o.detail).not.toContain('zshrc')
      const two = interpretClaudeStream([denied({ permission_denials: [{ tool_name: 'Read' }, { tool_name: 'Bash' }] })], 0)
      expect(two).toMatchObject({ status: 'blocked', reason: 'permission', detail: '2 tool call(s) denied' })
    })
    test('an empty or absent denial list is not a block', () => {
      expect(interpretClaudeStream([denied({ permission_denials: [] })], 0)).toMatchObject({ status: 'completed' })
      expect(interpretClaudeStream([denied({ permission_denials: 'x' })], 0)).toMatchObject({ status: 'completed' })
    })
    test('decision order: usage, then auth, then permission, then the turn cap', () => {
      const warn = L({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })
      expect(interpretClaudeStream([warn, denied()], 0)).toMatchObject({ status: 'blocked', reason: 'usage' })
      expect(interpretClaudeStream([denied({ is_error: true, result: 'Not logged in · Please run /login' })], 1)).toMatchObject({ status: 'blocked', reason: 'auth' })
      expect(interpretClaudeStream([denied({ subtype: 'error_max_turns', is_error: true, result: undefined })], 1))
        .toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    })
  })
  describe('F37: auth is classified from structured fields, and the regex reads only the result text', () => {
    // The live run-1 shape: a synthetic assistant event flagged as an API error, then a success-subtype error result, exit 1.
    const apiError = (text: string, error: string) => [
      L({ type: 'assistant', error, is_api_error_message: true, message: { model: '<synthetic>', content: [{ type: 'text', text }] } }),
      L({ type: 'result', subtype: 'success', is_error: true, result: text, terminal_reason: 'api_error', num_turns: 1, permission_denials: [] }),
    ]
    const AUTH = { status: 'blocked', reason: 'auth', detail: 'claude is not logged in on this Mac' }
    test('a dead refresh token (2.1.296 headless text, error authentication_failed) is blocked(auth)', () => {
      expect(interpretClaudeStream(apiError('Failed to authenticate: OAuth session expired and could not be refreshed', 'authentication_failed'), 1)).toMatchObject(AUTH)
    })
    test('the structured error alone decides, whatever the text says', () => {
      for (const error of ['authentication_failed', 'oauth_org_not_allowed']) {
        expect(interpretClaudeStream(apiError('something new and unrecognised', error), 1)).toMatchObject(AUTH)
      }
    })
    test('the 2.1.296 auth texts in an error result are blocked(auth) without the structured field', () => {
      for (const text of ['Failed to authenticate: OAuth session expired and could not be refreshed', 'Authentication required · Sign in again to continue']) {
        expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: text })], 1)).toMatchObject(AUTH)
      }
    })
    test('a busy concurrent refresh (error server_error) is failed with a fixed detail, not "not logged in"', () => {
      const text = 'Failed to refresh OAuth token: another Claude Code process is refreshing it. This is usually transient; retry in a minute.'
      const o = interpretClaudeStream(apiError(text, 'server_error'), 1)
      expect(o).toMatchObject({ status: 'failed', detail: "claude's login refresh was busy; try again in a minute", result_text: text })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: true, result: text })], 1))
        .toMatchObject({ status: 'failed', detail: "claude's login refresh was busy; try again in a minute" })
    })
    test('a successful answer that quotes the busy-refresh text stays completed, and a denial in it is still blocked(permission)', () => {
      // e.g. a review of packages/summon itself: harness.ts holds the phrase.
      const quote = 'harness.ts matches "another Claude Code process is refreshing it" to spot a busy login refresh.'
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: quote })], 0))
        .toMatchObject({ status: 'completed', result_text: quote })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: quote, permission_denials: [{ tool_name: 'Read' }] })], 0))
        .toMatchObject({ status: 'blocked', reason: 'permission', detail: '1 tool call(s) denied' })
    })
    test('narration is never read as an auth failure: no result line, or an error result without result text', () => {
      const narration = L({ type: 'assistant', message: { content: [{ type: 'text', text: 'the OAuth token is refreshed in api/src/auth; Not logged in is shown when' }] } })
      expect(interpretClaudeStream([narration], 1)).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([narration], null)).toMatchObject({ status: 'failed', detail: 'exit null' })
      expect(interpretClaudeStream([narration, L({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'] })], 1))
        .toMatchObject({ status: 'failed', detail: 'error_during_execution' })
    })
    test('a successful answer that talks about OAuth tokens is completed', () => {
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'Not logged in is raised when the OAuth token is gone.' })], 0))
        .toMatchObject({ status: 'completed' })
    })
    test('an error field without the API-error flag is not trusted', () => {
      expect(interpretClaudeStream([L({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'x' }] } })], 1))
        .toMatchObject({ status: 'failed', detail: 'exit 1' })
    })
  })
  describe('F33: a command line claude rejects', () => {
    const DRIFT = 'claude rejected its command line (version drift?)'
    test('the known CLI-parse failures on stderr give a fixed detail, and no stderr text reaches the outcome', () => {
      for (const err of ["error: unknown option '--x=none'\n", "error: option '--permission-prompts <mode>' argument 'nope' is invalid. Allowed choices are ask, none.\n",
        'Invalid --setting-sources value: bogus\n',
        // What 2.1.296 really prints for a bad --setting-sources value (probed with --help appended, so no model call).
        'Error processing --setting-sources: Invalid setting source: bogus. Valid options are: user, project, local\n']) {
        const o = interpretClaudeStream([], 1, err)
        expect(o).toMatchObject({ status: 'failed', detail: DRIFT, result_text: '' })
        expect(JSON.stringify(o)).not.toContain('--x')
        expect(JSON.stringify(o)).not.toContain('nope')
        expect(JSON.stringify(o)).not.toContain('bogus')
      }
    })
    test('other stderr changes nothing; a successful run with stderr noise stays completed', () => {
      expect(interpretClaudeStream([], 1, 'Segmentation fault\n')).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([], 1, "warning: error: unknown option '--x'")).toMatchObject({ status: 'failed', detail: 'exit 1' })
      expect(interpretClaudeStream([L({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })], 0, "error: unknown option '--x'"))
        .toMatchObject({ status: 'completed' })
    })
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
  test('usageWarning with an out-of-range resetsAt still reports the rejection (never fails open)', () => {
    for (const raw of ['{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e999}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":"soon"}}']) {
      const w = usageWarning(raw)
      expect(w).not.toBeNull()
      expect(['rejected', 'allowed_warning']).toContain(w!.status)
      expect(w!.resets_at).toBeUndefined()
    }
    expect(usageWarning('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1e16}}')).toMatchObject({ status: 'rejected' })
  })
  test('usageWarning ignores other events, garbage and non-objects', () => {
    for (const l of [L({ type: 'result' }), 'garbage', 'null', '', '123']) expect(usageWarning(l)).toBeNull()
  })
})
