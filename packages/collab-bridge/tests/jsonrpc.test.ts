import { describe, expect, test } from 'bun:test'
import {
  encodeLine, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_PARSE_ERROR, LineReader, LineTooLong, parseJsonRpc,
} from '../src/jsonrpc.ts'

const enc = new TextEncoder()
const LS = String.fromCharCode(0x2028)   // LINE SEPARATOR, which JSON.stringify writes raw

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out
}

describe('line framing', () => {
  test('a line split inside a multibyte character and a raw U+2028 still parse', () => {
    const line = encodeLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'collab_next', arguments: { s: `ü${LS}é` } } })
    expect(line.includes(LS)).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.indexOf('\n')).toBe(line.length - 1)
    const wire = enc.encode(line)
    for (let cut = 1; cut < wire.byteLength; cut++) {
      const r = new LineReader(1024)
      const lines = [...r.push(wire.subarray(0, cut)), ...r.push(wire.subarray(cut))]
      expect(lines.length).toBe(1)
      const p = parseJsonRpc(lines[0]!)
      expect(p.kind).toBe('request')
      expect((p as { msg: { params: { arguments: { s: string } } } }).msg.params.arguments.s).toBe(`ü${LS}é`)
    }
  })

  test('several lines in one chunk, a CRLF line and blank lines', () => {
    const r = new LineReader(1024)
    expect(r.push(enc.encode('{"jsonrpc":"2.0","method":"a"}\n\n{"jsonrpc":"2.0","method":"b"}\r\n{"jsonrpc"'))).toEqual([
      '{"jsonrpc":"2.0","method":"a"}', '{"jsonrpc":"2.0","method":"b"}\r',
    ])
    expect(r.push(enc.encode(':"2.0","method":"c"}\n'))).toEqual(['{"jsonrpc":"2.0","method":"c"}'])
    expect(parseJsonRpc('{"jsonrpc":"2.0","method":"b"}\r').kind).toBe('notification')
  })

  test('a line of exactly the limit passes, one byte more throws', () => {
    const r = new LineReader(8)
    expect(r.push(enc.encode('12345678\n'))).toEqual(['12345678'])
    expect(() => r.push(enc.encode('123456789\n'))).toThrow(LineTooLong)
  })

  test('an over-long line throws LineTooLong once and the next line still parses', () => {
    const r = new LineReader(16)
    let err: unknown
    try { r.push(enc.encode('{"jsonrpc":"2.0","method":"a"}'.padEnd(40, ' '))) } catch (e) { err = e }
    expect(err).toBeInstanceOf(LineTooLong)
    expect((err as LineTooLong).bytes).toBeGreaterThan(16)
    // the rest of that line is discarded without a second throw, up to its newline
    expect(r.push(enc.encode(' '.repeat(1000)))).toEqual([])
    expect(r.push(enc.encode(' tail of the long line\n{"id":1}\n'))).toEqual(['{"id":1}'])
    expect(r.push(enc.encode('{"id":2}\n'))).toEqual(['{"id":2}'])
  })

  test('lines that arrive in the same chunk as an over-long one are never lost', () => {
    const r = new LineReader(16)
    let err: unknown
    try { r.push(concat(enc.encode('{"id":1}\n'), enc.encode('x'.repeat(50)), enc.encode('\n{"id":2}\n{"id":3'))) } catch (e) { err = e }
    expect(err).toBeInstanceOf(LineTooLong)
    expect((err as LineTooLong).lines).toEqual(['{"id":1}', '{"id":2}'])
    expect(r.push(enc.encode('}\n'))).toEqual(['{"id":3}'])
  })

  test('memory stays bounded: an over-long line is never buffered past the limit', () => {
    const r = new LineReader(1024)
    let throws = 0
    for (let i = 0; i < 64; i++) {
      try { r.push(new Uint8Array(64 * 1024).fill(0x61)) } catch (e) { if (e instanceof LineTooLong) throws += 1; else throw e }
    }
    expect(throws).toBe(1)
    expect(r.push(enc.encode('\nok\n'))).toEqual(['ok'])
  })
})

describe('messages', () => {
  test('requests, notifications, responses and garbage are told apart', () => {
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')).toEqual({
      kind: 'request', msg: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    })
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":"a-1","method":"ping"}')).toEqual({ kind: 'request', msg: { jsonrpc: '2.0', id: 'a-1', method: 'ping' } })
    expect(parseJsonRpc('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}')).toEqual({
      kind: 'notification', msg: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } },
    })
    expect(parseJsonRpc('{"result":{"tools":[]},"jsonrpc":"2.0","id":2}')).toEqual({ kind: 'response', msg: { jsonrpc: '2.0', id: 2, result: { tools: [] } } })
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"Method not found"}}')).toEqual({
      kind: 'response', msg: { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Method not found' } },
    })
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":4,"result":null}')).toEqual({ kind: 'response', msg: { jsonrpc: '2.0', id: 4, result: null } })
    for (const garbage of [
      '', 'not json', '[]', '[{"jsonrpc":"2.0","method":"a"}]', '"x"', 'null', '{}',
      '{"jsonrpc":"1.0","id":1,"method":"a"}', '{"id":1,"method":"a"}', '{"jsonrpc":"2.0","id":null,"method":"a"}',
      '{"jsonrpc":"2.0","id":{},"method":"a"}', '{"jsonrpc":"2.0","id":1,"method":5}', '{"jsonrpc":"2.0","id":1,"method":"a","params":3}',
      '{"jsonrpc":"2.0","id":1}', '{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":"x"}}',
      '{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"y"}}', '{"jsonrpc":"2.0","id":1,"error":{"code":1}}',
      '{"jsonrpc":"2.0","result":1}',
    ]) {
      expect([garbage, parseJsonRpc(garbage).kind]).toEqual([garbage, 'invalid'])
    }
  })

  test('the error codes are JSON-RPC\'s', () => {
    expect([JSONRPC_PARSE_ERROR, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND]).toEqual([-32700, -32600, -32601])
  })

  test('encodeLine is one JSON object and one newline', () => {
    expect(encodeLine({ jsonrpc: '2.0', id: 1, result: {} })).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n')
    expect(encodeLine({ s: 'a\nb' })).toBe('{"s":"a\\nb"}\n')
  })
})
