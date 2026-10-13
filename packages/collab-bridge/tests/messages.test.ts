import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import {
  BUILD_RE, CALL_REF_RE, callRefLineage, CHALLENGE_NONCE_RE, decodeJson, DIGEST_RE, encodeMessage, LINEAGE_RE, MAX_ATTACH_BYTES,
  MAX_FOLDER_BYTES, MAX_HANDSHAKE_BYTES, MAX_HUB_TO_PIPE, MAX_KNOCK_COUNT, MAX_KNOCKS_MS, MAX_PIPE_TO_HUB, newChallengeNonce, newLineage,
  newPipeInstance, newRelayNonce, newStartNonce, ORIGIN_RE, parseAttach, parseCall, parseCancel, parseChallenge, parseHubKnockReport,
  parseKnocks, parseNotice, parseProve, parseReady, parseRefused, parseResult, parseTapKnockReport, parseTools, parseToolsGet,
  parseToolsRefused, RELAY_NONCE_RE, seatMessage, SIG_RE, START_NONCE_RE,
} from '../src/link/messages.ts'

type Obj = Record<string, unknown>
const LIN = `lin_${'a'.repeat(32)}`
const REF = `${LIN}:0123abcd:7`
const DIGEST = 'b'.repeat(64)
const CLOCK = '2026-10-13T12:00:00.000Z'
const drop = (o: Obj, k: string): Obj => { const c = { ...o }; delete c[k]; return c }
const set = (o: Obj, k: string, v: unknown): Obj => ({ ...o, [k]: v })
// bun's toEqual wants the expected value typed like the received one; parsers are compared as plain data here.
const same = (got: unknown, want: unknown) => expect(got).toEqual(want)

const V = {
  attach: { t: 'attach', v: 1, lineage: LIN, harness: 'claude', entrypoint: 'cli', folder: '/Users/macair/Projects/collab-trial',
    pipe_build: '0123abcd', tools_digest: DIGEST, clock: CLOCK },
  challenge: { t: 'challenge', nonce: 'c'.repeat(64) },
  prove: { t: 'prove', sig: 'd'.repeat(128) },
  ready: { t: 'ready', tools_digest: DIGEST, hub_build: '89abcdef', skew_s: -3,
    session_hint: { session_id: 'sess_01', workspace_id: `ws_${'e'.repeat(24)}` } },
  refused: { t: 'refused', code: 'lineage_cap' },
  call: { t: 'call', call_ref: REF, name: 'collab_task_claim', arguments: { task_id: 't1', idempotency_key: 'k1' }, timeout_ms: 150_000,
    declared: { head: 'f'.repeat(40), branch: 'main', dirty: false } },
  cancel: { t: 'cancel', call_ref: REF },
  result: { t: 'result', call_ref: REF, outcome: 'ok',
    result: { content: [{ type: 'text', text: '{\n  "ok": true\n}' }], structuredContent: { ok: true } } },
  tools_get: { t: 'tools_get', digest: DIGEST },
  tools: { t: 'tools', digest: DIGEST,
    list: [{ name: 'collab_next', description: 'Read what is new', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }] },
  notice: { t: 'notice', code: 'hub_lost' },
} satisfies Record<string, Obj>

const TABLE: Array<[string, (o: unknown) => unknown, Obj, Obj[]]> = [
  ['attach', parseAttach, V.attach, [
    ...['v', 'lineage', 'harness', 'entrypoint', 'folder', 'pipe_build', 'tools_digest', 'clock'].map((k) => drop(V.attach, k)),
    set(V.attach, 'v', 2), set(V.attach, 'v', '1'), set(V.attach, 'lineage', `lin_${'A'.repeat(32)}`), set(V.attach, 'lineage', 'lin_abc'),
    set(V.attach, 'harness', 'cl aude'), set(V.attach, 'harness', 'h'.repeat(33)), set(V.attach, 'harness', 42),
    set(V.attach, 'entrypoint', ''), set(V.attach, 'entrypoint', 'sdk cli'), set(V.attach, 'folder', 'Projects/collab-trial'),
    set(V.attach, 'folder', '/a\nb'), set(V.attach, 'folder', 42), set(V.attach, 'pipe_build', 'ABCDEF01'),
    set(V.attach, 'pipe_build', '0123abc'), set(V.attach, 'tools_digest', DIGEST.toUpperCase()), set(V.attach, 'clock', 'yesterday'),
    set(V.attach, 'clock', '2026-13-45T99:99:99Z'), set(V.attach, 'clock', 1791887780738),
  ]],
  ['challenge', parseChallenge, V.challenge, [
    drop(V.challenge, 'nonce'), set(V.challenge, 'nonce', 'c'.repeat(63)), set(V.challenge, 'nonce', 'C'.repeat(64)), set(V.challenge, 'nonce', 7),
  ]],
  ['prove', parseProve, V.prove, [
    drop(V.prove, 'sig'), set(V.prove, 'sig', 'd'.repeat(127)), set(V.prove, 'sig', 'd'.repeat(130)), set(V.prove, 'sig', 'D'.repeat(128)),
  ]],
  ['ready', parseReady, V.ready, [
    ...['tools_digest', 'hub_build', 'skew_s', 'session_hint'].map((k) => drop(V.ready, k)),
    set(V.ready, 'tools_digest', 'b'.repeat(63)), set(V.ready, 'hub_build', '89abcdef0'), set(V.ready, 'skew_s', 1.5),
    set(V.ready, 'skew_s', '3'), set(V.ready, 'session_hint', 'sess_01'), set(V.ready, 'session_hint', { session_id: 'sess_01' }),
    set(V.ready, 'session_hint', { session_id: '', workspace_id: 'ws_1' }), set(V.ready, 'session_hint', { session_id: 's\n', workspace_id: 'ws_1' }),
  ]],
  ['refused', parseRefused, V.refused, [drop(V.refused, 'code'), set(V.refused, 'code', 'nope'), set(V.refused, 'code', 'hub_outcome_unknown')]],
  ['call', parseCall, V.call, [
    ...['call_ref', 'name', 'arguments', 'timeout_ms'].map((k) => drop(V.call, k)),
    set(V.call, 'call_ref', `${LIN}:0123abcd:01`), set(V.call, 'name', 'has space'), set(V.call, 'name', ''), set(V.call, 'name', 'n'.repeat(129)),
    set(V.call, 'arguments', []), set(V.call, 'arguments', null), set(V.call, 'arguments', 'x'),
    set(V.call, 'timeout_ms', 0), set(V.call, 'timeout_ms', 600_001), set(V.call, 'timeout_ms', 1.5), set(V.call, 'timeout_ms', '60000'),
    set(V.call, 'declared', null), set(V.call, 'declared', { head: 'f'.repeat(39), branch: 'main', dirty: false }),
    set(V.call, 'declared', { head: 'F'.repeat(40), branch: 'main', dirty: false }), set(V.call, 'declared', { head: 'f'.repeat(40), branch: 5, dirty: false }),
    set(V.call, 'declared', { head: 'f'.repeat(40), branch: '', dirty: false }), set(V.call, 'declared', { head: 'f'.repeat(40), branch: 'main', dirty: 'no' }),
    set(V.call, 'declared', { head: 'f'.repeat(40), dirty: false }),
  ]],
  ['cancel', parseCancel, V.cancel, [drop(V.cancel, 'call_ref'), set(V.cancel, 'call_ref', `${LIN}:0123abcd`), set(V.cancel, 'call_ref', 9)]],
  ['result', parseResult, V.result, [
    drop(V.result, 'call_ref'), drop(V.result, 'outcome'), drop(V.result, 'result'), set(V.result, 'outcome', 'maybe'),
    set(V.result, 'result', { content: 'x' }), set(V.result, 'result', { content: [{ type: 'image', data: '' }] }),
    set(V.result, 'result', { content: [{ type: 'text', text: 5 }] }), set(V.result, 'result', { content: [], structuredContent: [] }),
    set(V.result, 'result', { content: [], isError: 'yes' }), set(V.result, 'result', { content: [], isError: true }),
    { ...V.result, outcome: 'error' },
  ]],
  ['tools_get', parseToolsGet, V.tools_get, [drop(V.tools_get, 'digest'), set(V.tools_get, 'digest', 'b'.repeat(65)), set(V.tools_get, 'digest', 'B'.repeat(64))]],
  ['tools', parseTools, V.tools, [
    drop(V.tools, 'digest'), drop(V.tools, 'list'), set(V.tools, 'digest', ''), set(V.tools, 'digest', 'b'.repeat(65)), set(V.tools, 'digest', 'ab cd'),
    set(V.tools, 'list', 'x'), set(V.tools, 'list', [{ name: '', inputSchema: {} }]), set(V.tools, 'list', [{ name: 'a', inputSchema: 'x' }]),
    set(V.tools, 'list', [{ name: 'a', inputSchema: {}, description: 5 }]), set(V.tools, 'list', [{ name: 'a', inputSchema: {}, annotations: [] }]),
    set(V.tools, 'list', Array.from({ length: 257 }, (_, i) => ({ name: `t${i}`, inputSchema: {} }))),
  ]],
  ['notice', parseNotice, V.notice, [drop(V.notice, 'code'), set(V.notice, 'code', 'other')]],
]

describe('parsers', () => {
  test('every parser refuses a missing, extra-typed or out-of-pattern field', () => {
    for (const [name, parse, valid, bad] of TABLE) {
      expect([name, parse(valid)]).toEqual([name, valid])
      for (const b of bad) expect([name, b, parse(b)]).toEqual([name, b, null])
    }
  })

  test('every parser refuses a wrong t or a non-object, and drops unknown keys', () => {
    for (const [name, parse, valid] of TABLE) {
      expect([name, parse({ ...valid, extra: 'smuggled' })]).toEqual([name, valid])
      for (const b of [set(valid, 't', 'other'), drop(valid, 't'), null, [], 'attach', 7]) expect([name, parse(b)]).toEqual([name, null])
    }
  })

  test('the optional and null forms parse', () => {
    same(parseReady(set(V.ready, 'session_hint', null)), set(V.ready, 'session_hint', null))
    same(parseCall(drop(V.call, 'declared')), drop(V.call, 'declared'))
    expect(parseCall(set(V.call, 'declared', { head: 'f'.repeat(64), branch: null, dirty: true }))).not.toBeNull()
    same(parseResult({ t: 'result', call_ref: REF, outcome: 'unknown' }), { t: 'result', call_ref: REF, outcome: 'unknown' })
    const refusal = { content: [{ type: 'text', text: '{}' }], structuredContent: { error: 'hub_away', delivered: false }, isError: true }
    same(parseResult({ t: 'result', call_ref: REF, outcome: 'error', result: refusal }), { t: 'result', call_ref: REF, outcome: 'error', result: refusal })
    expect(parseResult({ t: 'result', call_ref: REF, outcome: 'unknown', result: refusal })).not.toBeNull()
    same(parseTools(set(V.tools, 'list', [{ name: 'collab_next', inputSchema: {}, title: 'dropped' }])),
      set(V.tools, 'list', [{ name: 'collab_next', inputSchema: {} }]))
    for (const code of ['frame_too_large', 'hub_away', 'lineage_cap', 'seat_session_ended', 'folder_not_shared', 'seat_proof_failed']) {
      same(parseRefused({ t: 'refused', code }), { t: 'refused', code })
    }
    for (const code of ['hub_lost', 'collab_build_changed', 'link_closing']) same(parseNotice({ t: 'notice', code }), { t: 'notice', code })
  })

  test('attach with a 1019-byte folder, 32-char harness and entrypoint, both 8-hex builds and an ISO clock fits 2 KiB', () => {
    // "both builds": pipe_build (8 hex) and the 64-hex tools_digest the pipe sends beside it (§5.4)
    for (const folder of [`/${'a'.repeat(1018)}`, `/${'é'.repeat(509)}`]) {
      expect(Buffer.byteLength(folder)).toBe(MAX_FOLDER_BYTES)
      const attach = { t: 'attach', v: 1, lineage: newLineage(), harness: 'h'.repeat(32), entrypoint: 'e'.repeat(32), folder,
        pipe_build: 'abcdef01', tools_digest: 'f'.repeat(64), clock: new Date().toISOString() }
      same(parseAttach(attach), attach)
      expect(encodeMessage(attach).byteLength).toBeLessThanOrEqual(MAX_ATTACH_BYTES)
    }
  })

  test('attach with a 1020-byte folder is refused', () => {
    expect(parseAttach(set(V.attach, 'folder', `/${'a'.repeat(1019)}`))).toBeNull()
    // 511 characters, 1020 bytes: the limit counts bytes, not characters
    expect(parseAttach(set(V.attach, 'folder', `/${'é'.repeat(509)}a`))).toBeNull()
  })

  test('call_ref parses its lineage and refuses other shapes', () => {
    expect(callRefLineage(REF)).toBe(LIN)
    expect(callRefLineage(`${LIN}:0123abcd:0`)).toBe(LIN)
    expect(callRefLineage(`${LIN}:0123abcd:${'9'.repeat(16)}`)).toBe(LIN)
    for (const bad of [`${LIN}:0123abcd:01`, `${LIN}:0123ABCD:1`, `${LIN}:0123abcd:`, `${LIN}:0123abcd:-1`, `lin_x:0123abcd:1`,
      `${LIN}:0123abcd:1\n`, `${LIN}:0123abcd:1:2`, `${LIN}:0123abcd:${'9'.repeat(17)}`, `${LIN}:0123abc:1`, ` ${REF}`]) {
      expect([bad, callRefLineage(bad)]).toEqual([bad, null])
      expect(CALL_REF_RE.test(bad)).toBe(false)
    }
    expect(callRefLineage(5 as unknown as string)).toBeNull()
  })

  test('knocks timeout must be 1..2000', () => {
    same(parseKnocks({ t: 'knocks', timeout_ms: 1 }), { t: 'knocks', timeout_ms: 1 })
    same(parseKnocks({ t: 'knocks', timeout_ms: MAX_KNOCKS_MS }), { t: 'knocks', timeout_ms: 2000 })
    for (const v of [0, 2001, 1.5, '100', -1, null]) expect(parseKnocks({ t: 'knocks', timeout_ms: v })).toBeNull()
    expect(parseKnocks({ t: 'knocks' })).toBeNull()
  })

  test('knock reports refuse counts outside 0..999, more than 3 origins, or an origin outside ORIGIN_RE', () => {
    const hub = { t: 'knock_report', count: 2, origins: ['air', 'nuance/macair'], seqs: [11, 12] }
    const tap = { t: 'knock_report', count: 2, origins: ['air', 'nuance/macair'] }
    same(parseHubKnockReport(hub), hub)
    same(parseTapKnockReport(tap), tap)
    same(parseHubKnockReport({ t: 'knock_report', expired: true }), { t: 'knock_report', expired: true })
    expect(parseHubKnockReport({ t: 'knock_report', count: 0, origins: [], seqs: [] })).not.toBeNull()
    expect(parseHubKnockReport({ ...hub, count: MAX_KNOCK_COUNT })).not.toBeNull()
    for (const count of [-1, 1000, 1.5, '3']) {
      expect(parseHubKnockReport({ ...hub, count })).toBeNull()
      expect(parseTapKnockReport({ ...tap, count })).toBeNull()
    }
    const badOrigins = [['air', 'nuance/macair', 'zerone/yu', 'mini/yu'], ['Nuance/macair'], ['air '], ['nuance/mac air'], ['nuance'],
      ['nuance/\u202emacair'], 'air', [7]]
    for (const origins of badOrigins) {
      expect(parseHubKnockReport({ ...hub, origins })).toBeNull()
      expect(parseTapKnockReport({ ...tap, origins })).toBeNull()
    }
    for (const seqs of [[-1], [1.5], 'x', Array.from({ length: 1000 }, (_, i) => i)]) expect(parseHubKnockReport({ ...hub, seqs })).toBeNull()
    expect(parseHubKnockReport(drop(hub, 'seqs'))).toBeNull()
    expect(parseHubKnockReport({ t: 'knock_report', expired: false })).toBeNull()
    expect(ORIGIN_RE.test('zerone/yu.ai-2')).toBe(true)
  })

  test('tools_refused needs one of the four reasons and a digest of at most 64 chars', () => {
    for (const reason of ['digest_format', 'digest_mismatch', 'unknown_tool', 'no_seed']) {
      same(parseToolsRefused({ t: 'tools_refused', digest: 'ABC', reason }), { t: 'tools_refused', digest: 'ABC', reason })
    }
    expect(parseToolsRefused({ t: 'tools_refused', digest: 'b'.repeat(64), reason: 'no_seed' })).not.toBeNull()
    for (const bad of [{ digest: 'b'.repeat(65), reason: 'no_seed' }, { digest: '', reason: 'no_seed' }, { digest: 'a b', reason: 'no_seed' },
      { digest: DIGEST, reason: 'other' }, { digest: DIGEST }, { reason: 'no_seed' }]) {
      expect(parseToolsRefused({ t: 'tools_refused', ...bad })).toBeNull()
    }
  })
})

describe('encoding', () => {
  test('encodeMessage and decodeJson round-trip, and U+2028 is written raw', () => {
    expect(decodeJson(encodeMessage(V.call))).toEqual(V.call)
    const withSeparator = { t: 'x', s: 'a\u2028b' }
    const raw = encodeMessage(withSeparator)
    expect(Buffer.from(raw).includes(Buffer.from([0xe2, 0x80, 0xa8]))).toBe(true)
  })

  test('decodeJson refuses anything but one JSON object with a string t', () => {
    const enc = new TextEncoder()
    for (const s of ['[1]', '{"a":1}', '{"t":5}', '{"t":"x"} {"t":"y"}', 'null', '"t"', '', '{']) expect([s, decodeJson(enc.encode(s))]).toEqual([s, null])
    expect(decodeJson(new Uint8Array([0x7b, 0x22, 0x74, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))).toBeNull()   // {"t":"<0xff>"}
  })

  test('the limits are the spec\'s', () => {
    expect([MAX_ATTACH_BYTES, MAX_HANDSHAKE_BYTES, MAX_PIPE_TO_HUB, MAX_HUB_TO_PIPE, MAX_FOLDER_BYTES, MAX_KNOCKS_MS, MAX_KNOCK_COUNT])
      .toEqual([2048, 1024, 2_097_152, 4_194_304, 1019, 2000, 999])
  })
})

describe('ids', () => {
  test('the seat string is the exact pipe-separated form', () => {
    const nonce = 'c'.repeat(64)
    expect(seatMessage('nuance', 'macair', LIN, nonce)).toBe(`collab-bridge-seat/1|nuance|macair|${LIN}|${nonce}`)
  })

  test('new ids match their patterns', () => {
    const lineages = new Set(Array.from({ length: 100 }, () => newLineage()))
    expect(lineages.size).toBe(100)
    for (const l of lineages) expect(LINEAGE_RE.test(l)).toBe(true)
    expect(newPipeInstance()).toMatch(/^[0-9a-f]{8}$/)
    expect(RELAY_NONCE_RE.test(newRelayNonce())).toBe(true)
    expect(START_NONCE_RE.test(newStartNonce())).toBe(true)
    expect(CHALLENGE_NONCE_RE.test(newChallengeNonce())).toBe(true)
    expect(CALL_REF_RE.test(`${newLineage()}:${newPipeInstance()}:0`)).toBe(true)
    expect([DIGEST_RE.test(DIGEST), BUILD_RE.test('0123abcd'), SIG_RE.test('d'.repeat(128))]).toEqual([true, true, true])
  })
})
