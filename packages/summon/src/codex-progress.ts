// Content-free observations only; completion remains the parser's decision.
// Contract: ../CODEX.md. Raw events, identifiers and payloads are never retained.
const EVENT_TYPES = [
  'thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'error',
  'item.started', 'item.updated', 'item.completed',
] as const
const ITEM_TYPES = [
  'agent_message', 'reasoning', 'command_execution', 'file_change',
  'mcp_tool_call', 'web_search', 'todo_list', 'error',
] as const
const SIGNALS = [
  'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGIOT',
  'SIGBUS', 'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGPIPE',
  'SIGALRM', 'SIGTERM', 'SIGSTKFLT', 'SIGCHLD', 'SIGCONT', 'SIGSTOP',
  'SIGTSTP', 'SIGTTIN', 'SIGTTOU', 'SIGURG', 'SIGXCPU', 'SIGXFSZ',
  'SIGVTALRM', 'SIGPROF', 'SIGWINCH', 'SIGIO', 'SIGPOLL', 'SIGPWR',
  'SIGSYS', 'SIGINFO', 'SIGLOST', 'SIGBREAK',
] as const

export type CodexEventType = typeof EVENT_TYPES[number] | 'other'
export type CodexItemType = typeof ITEM_TYPES[number] | 'other'
export type CodexSignal = typeof SIGNALS[number] | 'other'
type Counter = { count: number; first_ms: number; last_ms: number }

export type CodexProgress = {
  stdout_bytes: number
  stderr_bytes: number
  first_stdout_ms: number | null
  first_stderr_ms: number | null
  events: Partial<Record<CodexEventType, Counter>>
  items: Partial<Record<CodexItemType, Counter>>
  stop_requested_ms: number | null
  exit: { at_ms: number; code: number | null; signal: CodexSignal | null; after_stop: boolean } | null
}

const MAX = Number.MAX_SAFE_INTEGER
function classify<T extends string>(value: unknown, allowed: readonly T[]): T | 'other' {
  return allowed.find((type) => type === value) ?? 'other'
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function byteCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(MAX, Math.floor(value)) : 0
}
function count<T extends string>(counters: Partial<Record<T, Counter>>, type: T, at: number) {
  const previous = counters[type]
  counters[type] = previous
    ? { count: Math.min(MAX, previous.count + 1), first_ms: previous.first_ms, last_ms: at }
    : { count: 1, first_ms: at, last_ms: at }
}

export function createCodexProgress(elapsedMs: () => number) {
  const progress: CodexProgress = {
    stdout_bytes: 0, stderr_bytes: 0, first_stdout_ms: null, first_stderr_ms: null,
    events: {}, items: {}, stop_requested_ms: null, exit: null,
  }
  let lastOffset = 0
  function now(): number {
    // A broken diagnostic clock must not interrupt child supervision.
    try {
      const offset = elapsedMs()
      if (Number.isFinite(offset)) lastOffset = Math.max(lastOffset, Math.min(MAX, offset))
    } catch { /* retain the last valid offset */ }
    return lastOffset
  }
  function bytes(stream: 'stdout' | 'stderr', value: number) {
    const amount = byteCount(value)
    if (!amount) return
    const at = now()
    if (stream === 'stdout') {
      progress.stdout_bytes = Math.min(MAX, progress.stdout_bytes + amount)
      progress.first_stdout_ms ??= at
    } else {
      progress.stderr_bytes = Math.min(MAX, progress.stderr_bytes + amount)
      progress.first_stderr_ms ??= at
    }
  }

  return {
    stdout: (bytesReceived: number) => bytes('stdout', bytesReceived),
    stderr: (bytesReceived: number) => bytes('stderr', bytesReceived),
    line(raw: string) {
      const at = now()
      let event: unknown
      try { event = JSON.parse(raw) } catch { /* malformed lines count as other */ }
      const type = classify(record(event) ? event.type : undefined, EVENT_TYPES)
      count(progress.events, type, at)
      if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
        const item = record(event) ? event.item : undefined
        count(progress.items, classify(record(item) ? item.type : undefined, ITEM_TYPES), at)
      }
    },
    stop() {
      progress.stop_requested_ms ??= now()
    },
    exit(code: number | null, signal: string | null) {
      if (progress.exit) return
      progress.exit = {
        at_ms: now(),
        code: code !== null && Number.isSafeInteger(code) && code >= 0 ? code : null,
        signal: signal === null ? null : classify(signal, SIGNALS),
        after_stop: progress.stop_requested_ms !== null,
      }
    },
    snapshot(): CodexProgress {
      return structuredClone(progress)
    },
  }
}
