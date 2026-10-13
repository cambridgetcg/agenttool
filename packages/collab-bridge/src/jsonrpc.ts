// Newline-delimited JSON-RPC 2.0, hand-rolled for both MCP sides (P3): the pipe's stdio server and the hub's Collab
// child client. Lines split on '\n' only: JSON.stringify writes U+2028 and U+2029 raw (measured under Bun), and a 0x0a byte
// never occurs inside a multibyte UTF-8 sequence, so splitting the bytes first is UTF-8 safe.
export type JsonRpcId = string | number
export interface JsonRpcRequest { jsonrpc: '2.0'; id: JsonRpcId; method: string; params?: unknown }
export interface JsonRpcNotification { jsonrpc: '2.0'; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } }
export const JSONRPC_PARSE_ERROR = -32700, JSONRPC_INVALID_REQUEST = -32600, JSONRPC_METHOD_NOT_FOUND = -32601

/** One line was longer than the reader allows. `bytes` is how much of it had arrived when that was found (more than the
 *  limit; the rest is never buffered or counted). `lines` holds every complete line of the push that threw, in order,
 *  so a request that shared a chunk with the over-long line is not lost:
 *    try { lines = reader.push(chunk) } catch (e) { if (!(e instanceof LineTooLong)) throw e; note(e.bytes); lines = e.lines } */
export class LineTooLong extends Error {
  override name = 'LineTooLong'
  constructor(readonly bytes: number, readonly lines: string[] = []) {
    super(`a line of at least ${bytes} bytes was dropped`)
  }
}

const NEWLINE = 0x0a

export class LineReader {
  private parts: Uint8Array[] = []
  private size = 0
  private discarding = false
  // Not fatal: a line with bad UTF-8 decodes with U+FFFD and is then judged by the JSON parse, like any other line.
  private readonly decoder = new TextDecoder('utf-8')

  constructor(private readonly maxLineBytes: number) {}

  /** Complete, non-blank lines, without their '\n'. A line past maxLineBytes throws LineTooLong once (in the push that
   *  crosses the limit); its remaining bytes are discarded up to the next '\n', and reading goes on after it. */
  push(chunk: Uint8Array): string[] {
    const lines: string[] = []
    let tooLong: number | null = null
    let start = 0
    while (start <= chunk.byteLength) {
      const nl = chunk.indexOf(NEWLINE, start)
      const end = nl === -1 ? chunk.byteLength : nl
      if (!this.discarding && end > start) {
        if (this.size + (end - start) > this.maxLineBytes) {
          if (tooLong === null) tooLong = this.size + (end - start)
          this.discarding = true
          this.parts = []
          this.size = 0
        } else {
          this.parts.push(chunk.slice(start, end))
          this.size += end - start
        }
      }
      if (nl === -1) break
      if (this.discarding) {
        this.discarding = false
      } else {
        const line = this.take()
        if (line.trim() !== '') lines.push(line)
      }
      start = nl + 1
    }
    if (tooLong !== null) throw new LineTooLong(tooLong, lines)
    return lines
  }

  private take(): string {
    const all = new Uint8Array(this.size)
    let at = 0
    for (const p of this.parts) { all.set(p, at); at += p.byteLength }
    this.parts = []
    this.size = 0
    return this.decoder.decode(all)
  }
}

export type Parsed =
  | { kind: 'request'; msg: JsonRpcRequest }
  | { kind: 'notification'; msg: JsonRpcNotification }
  | { kind: 'response'; msg: JsonRpcResponse }
  | { kind: 'invalid' }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is JsonRpcId => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
const INVALID: Parsed = { kind: 'invalid' }

/** One message per line; batches (arrays) are not part of MCP since 2025-06-18 and read as invalid. */
export function parseJsonRpc(line: string): Parsed {
  let v: unknown
  try { v = JSON.parse(line) } catch { return INVALID }
  if (!isObj(v) || v.jsonrpc !== '2.0') return INVALID
  const hasId = Object.hasOwn(v, 'id')
  if (Object.hasOwn(v, 'method')) {
    if (typeof v.method !== 'string') return INVALID
    if (v.params !== undefined && typeof v.params !== 'object') return INVALID
    if (v.params === null) return INVALID
    const params = v.params === undefined ? {} : { params: v.params }
    if (!hasId) return { kind: 'notification', msg: { jsonrpc: '2.0', method: v.method, ...params } }
    if (!isId(v.id)) return INVALID
    return { kind: 'request', msg: { jsonrpc: '2.0', id: v.id, method: v.method, ...params } }
  }
  if (!hasId || !isId(v.id)) return INVALID
  const hasResult = Object.hasOwn(v, 'result')
  const hasError = Object.hasOwn(v, 'error')
  if (hasResult === hasError) return INVALID
  if (hasResult) return { kind: 'response', msg: { jsonrpc: '2.0', id: v.id, result: v.result } }
  const e = v.error
  if (!isObj(e) || !Number.isInteger(e.code) || typeof e.message !== 'string') return INVALID
  return { kind: 'response', msg: { jsonrpc: '2.0', id: v.id, error: { code: e.code as number, message: e.message } } }
}

export function encodeLine(msg: object): string {
  return JSON.stringify(msg) + '\n'
}
