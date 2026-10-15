import { describe, expect, test } from 'bun:test'
import { createCodexProgress } from '../src/codex-progress.ts'

describe('content-free Codex progress', () => {
  test('records observed stages, byte totals and timing without interpreting success', () => {
    let ms = 0
    const collector = createCodexProgress(() => ms)
    expect(collector.snapshot()).toEqual({
      stdout_bytes: 0, stderr_bytes: 0, first_stdout_ms: null, first_stderr_ms: null,
      events: {}, items: {}, stop_requested_ms: null, exit: null,
    })
    ms = 3
    collector.stderr(5)
    ms = 8
    collector.stdout(20)
    collector.line('{"type":"thread.started","thread_id":"private-id"}')
    ms = 10
    collector.line('{"type":"turn.started"}')
    ms = 15
    collector.stdout(30)
    collector.line('{"type":"item.started","item":{"type":"command_execution"}}')
    ms = 18
    collector.line('{"type":"item.updated","item":{"type":"command_execution"}}')
    ms = 22
    collector.line('{"type":"item.completed","item":{"type":"command_execution"}}')
    ms = 25
    collector.line('{"type":"item.completed","item":{"type":"agent_message","text":"private reply"}}')
    ms = 26
    collector.line('{"type":"turn.completed"}')
    ms = 28
    collector.stderr(7)
    collector.stop()
    ms = 29
    collector.stop()
    ms = 30
    collector.exit(0, null)
    expect(collector.snapshot()).toEqual({
      stdout_bytes: 50, stderr_bytes: 12, first_stdout_ms: 8, first_stderr_ms: 3,
      events: {
        'thread.started': { count: 1, first_ms: 8, last_ms: 8 },
        'turn.started': { count: 1, first_ms: 10, last_ms: 10 },
        'item.started': { count: 1, first_ms: 15, last_ms: 15 },
        'item.updated': { count: 1, first_ms: 18, last_ms: 18 },
        'item.completed': { count: 2, first_ms: 22, last_ms: 25 },
        'turn.completed': { count: 1, first_ms: 26, last_ms: 26 },
      },
      items: {
        command_execution: { count: 3, first_ms: 15, last_ms: 22 },
        agent_message: { count: 1, first_ms: 25, last_ms: 25 },
      },
      stop_requested_ms: 28,
      exit: { at_ms: 30, code: 0, signal: null, after_stop: true },
    })
  })

  test('retains no private payloads, IDs, unknown type names or signal strings', () => {
    const collector = createCodexProgress(() => 1)
    const privateMarker = 'PRIVATE-MARKER-DO-NOT-RETAIN'
    for (const event of [
      { type: 'thread.started', thread_id: privateMarker },
      { type: 'error', message: privateMarker, error: { details: privateMarker } },
      { type: 'turn.failed', error: { message: privateMarker } },
      { type: 'item.completed', item: { id: privateMarker, type: 'agent_message', text: privateMarker } },
      { type: 'item.completed', item: { id: privateMarker, type: 'command_execution', command: privateMarker, aggregated_output: privateMarker } },
      { type: privateMarker, item: { type: privateMarker }, [privateMarker]: privateMarker },
      { type: 'item.started', item: { type: privateMarker, error: privateMarker } },
      { type: '__proto__' }, { type: 'constructor' },
      { type: 'item.updated', item: { type: '__proto__' } },
      { type: 'item.updated', item: { type: 'constructor' } },
    ]) collector.line(JSON.stringify(event))
    collector.line(privateMarker)
    collector.exit(1, privateMarker)
    const snapshot = collector.snapshot()
    const encoded = JSON.stringify(snapshot)
    expect(encoded).not.toContain(privateMarker)
    expect(encoded).not.toContain('__proto__')
    expect(encoded).not.toContain('constructor')
    expect(snapshot.events.other?.count).toBe(4)
    expect(snapshot.items.other?.count).toBe(3)
    expect(snapshot.exit?.signal).toBe('other')
  })

  test('malformed and unsupported events remain observations independent of parser ordering', () => {
    const collector = createCodexProgress(() => 2)
    for (const raw of ['', '{', 'null', '[]', '42', '"private"', '{}', '{"type":42}']) collector.line(raw)
    collector.line('{"type":"item.completed","item":null}')
    collector.line('{"type":"turn.completed"}')
    collector.line('{"type":"turn.started"}')
    collector.line('{"type":"turn.failed"}')
    const snapshot = collector.snapshot()
    expect(snapshot.events.other?.count).toBe(8)
    expect(snapshot.items.other?.count).toBe(1)
    expect(snapshot.events['turn.completed']?.count).toBe(1)
    expect(snapshot.events['turn.started']?.count).toBe(1)
    expect(snapshot.events['turn.failed']?.count).toBe(1)
    expect(snapshot.exit).toBeNull()
  })

  test('many unique events and items keep fixed-sized aggregates rather than a timeline', () => {
    let ms = 0
    const collector = createCodexProgress(() => ms)
    for (; ms < 20_000; ms++) {
      collector.line(JSON.stringify({ type: `private-event-${ms}` }))
      collector.line(JSON.stringify({ type: 'item.updated', item: { type: `private-item-${ms}`, text: 'private' } }))
    }
    const snapshot = collector.snapshot()
    expect(Object.keys(snapshot.events)).toEqual(['other', 'item.updated'])
    expect(Object.keys(snapshot.items)).toEqual(['other'])
    expect(snapshot.events.other).toEqual({ count: 20_000, first_ms: 0, last_ms: 19_999 })
    expect(snapshot.items.other).toEqual({ count: 20_000, first_ms: 0, last_ms: 19_999 })
    expect(JSON.stringify(snapshot).length).toBeLessThan(600)
  })

  test('snapshots cannot mutate collector state', () => {
    const collector = createCodexProgress(() => 4)
    collector.line('{"type":"turn.started"}')
    collector.exit(0, null)
    const snapshot = collector.snapshot()
    snapshot.stdout_bytes = 100
    snapshot.events['turn.started']!.count = 50
    snapshot.items.other = { count: 3, first_ms: 0, last_ms: 0 }
    snapshot.exit!.code = 8
    expect(collector.snapshot().stdout_bytes).toBe(0)
    expect(collector.snapshot().events['turn.started']!.count).toBe(1)
    expect(collector.snapshot().items).toEqual({})
    expect(collector.snapshot().exit!.code).toBe(0)
  })

  test('stop and exit retain first observation and causal order even at equal offsets', () => {
    const collector = createCodexProgress(() => 0)
    collector.exit(null, 'SIGTERM')
    collector.stop()
    collector.exit(0, 'SIGKILL')
    expect(collector.snapshot().exit).toEqual({ at_ms: 0, code: null, signal: 'SIGTERM', after_stop: false })
    expect(collector.snapshot().stop_requested_ms).toBe(0)
    const stopped = createCodexProgress(() => 0)
    stopped.stop()
    stopped.exit(0, null)
    expect(stopped.snapshot().exit?.after_stop).toBe(true)
  })

  test('sanitizes numeric inputs and broken clocks without nonfinite or decreasing counters', () => {
    let ms = -10
    const collector = createCodexProgress(() => {
      if (ms === -1) throw new Error('private clock error')
      return ms
    })
    for (const bytes of [NaN, Infinity, -Infinity, -20, 0, 0.1]) collector.stdout(bytes)
    expect(collector.snapshot().first_stdout_ms).toBeNull()
    collector.stderr(2.9)
    expect(collector.snapshot().first_stderr_ms).toBe(0)
    ms = 4.5
    collector.line('{"type":"turn.started"}')
    for (ms of [1, NaN, Infinity, -Infinity, -1]) collector.line('{"type":"turn.started"}')
    expect(collector.snapshot().events['turn.started']).toEqual({ count: 6, first_ms: 4.5, last_ms: 4.5 })
    collector.stdout(Number.MAX_VALUE)
    collector.stdout(50)
    expect(collector.snapshot().stdout_bytes).toBe(Number.MAX_SAFE_INTEGER)
    expect(collector.snapshot().stderr_bytes).toBe(2)
    ms = Number.MAX_VALUE
    collector.stop()
    expect(collector.snapshot().stop_requested_ms).toBe(Number.MAX_SAFE_INTEGER)
    for (const code of [NaN, Infinity, -1, 0.5, Number.MAX_VALUE]) {
      const invalidExit = createCodexProgress(() => 1)
      invalidExit.exit(code, null)
      expect(invalidExit.snapshot().exit?.code).toBeNull()
    }
  })
})
