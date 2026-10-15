import type { Outcome } from './harness.ts'

const MAX_REPLY_BYTES = 1024 * 1024
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v)
function bounded(text: string): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= MAX_REPLY_BYTES) return text
  // Do not split a UTF-8 code point or return an over-budget replacement character.
  for (let length = MAX_REPLY_BYTES; length >= MAX_REPLY_BYTES - 3; length--) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)) } catch { /* partial code point */ }
  }
  return ''
}

/**
 * Native exec JSONL, not model text. See CODEX.md and the official non-interactive contract.
 * An exit code alone, a partial message or an error quoted by the model never decides success/auth/usage.
 * Unknown error shapes remain failed; no unverified auth/usage heuristic is applied.
 */
export function interpretCodexStream(lines: string[], exitCode: number | null, _stderr = ''): Outcome {
  let thread = false, turn = false, completed = false
  let reply = '', failure: string | null = null
  for (const line of lines) {
    if (line.trim() === '') continue
    let event: any
    try { event = JSON.parse(line) } catch { failure = 'codex emitted invalid JSONL'; break }
    if (!object(event) || typeof event.type !== 'string') { failure = 'codex emitted an invalid event'; break }
    if (completed) { failure = 'codex emitted events after completion'; break }
    if (event.type === 'error' || event.type === 'turn.failed') { failure = 'codex reported an error'; break }
    if (event.type === 'thread.started') {
      if (thread || turn || typeof event.thread_id !== 'string' || !event.thread_id) { failure = 'codex thread sequence is invalid'; break }
      thread = true
    } else if (event.type === 'turn.started') {
      if (!thread || turn) { failure = 'codex turn sequence is invalid'; break }
      turn = true
    } else if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      if (!turn || !object(event.item) || typeof event.item.type !== 'string' || typeof event.item.id !== 'string') {
        failure = 'codex item sequence is invalid'; break
      }
      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        if (typeof event.item.text !== 'string') { failure = 'codex agent message is invalid'; break }
        reply = bounded(event.item.text)
      }
    } else if (event.type === 'turn.completed') {
      if (!turn || event.error !== undefined) { failure = 'codex completion sequence is invalid'; break }
      completed = true
    } else { failure = 'codex emitted an unsupported event'; break }
  }
  if (failure) return { status: 'failed', detail: failure, result_text: '' }
  if (exitCode !== 0) return { status: 'failed', detail: exitCode === null ? 'codex exit is unknown' : `codex exited ${exitCode}`, result_text: '' }
  if (!completed || !reply.trim()) return { status: 'failed', detail: 'codex did not finish with a reply', result_text: '' }
  return { status: 'completed', result_text: reply, num_turns: 1 }
}
