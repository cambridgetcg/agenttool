import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef } from '../src/link/messages.ts'
import { classify, POLICY_TABLE, seatTools, unclassified, type ToolClass } from '../src/air/policy-table.ts'
import { toolsDigest } from '../src/tools-digest.ts'
import { assertTempJournal, readToolsFixture } from './fixtures/make-collab-tools.ts'
import { cleanupTmps, COLLAB_DIST, sha256File, temp } from './helpers.ts'

afterEach(cleanupTmps)

const FIXTURE = readToolsFixture()
const NAMES = FIXTURE.tools.map((t) => t.name)
const props = (t: ToolDef): Record<string, Record<string, unknown>> => t.inputSchema.properties as Record<string, Record<string, unknown>>
const byName = (list: ToolDef[], name: string): ToolDef => {
  const t = list.find((x) => x.name === name)
  if (!t) throw new Error(`no ${name} in the list`)
  return t
}

describe('the fixture', () => {
  test('the fixture generator refuses a journal outside its temp dir', () => {
    const tmp = temp('cb-gen-')
    const outside = temp('cb-out-')
    symlinkSync(outside, join(tmp, 'link'))
    expect(() => assertTempJournal(join(tmp, 'link', 'collab.sqlite'), tmp)).toThrow('refusing a journal outside')
    expect(() => assertTempJournal(join(outside, 'collab.sqlite'), tmp)).toThrow('refusing a journal outside')
    expect(() => assertTempJournal(join(tmp, 'missing', 'collab.sqlite'), tmp)).toThrow('does not resolve')
    mkdirSync(join(tmp, 'journal'))
    expect(() => assertTempJournal(join(tmp, 'journal', 'collab.sqlite'), tmp)).not.toThrow()
  })

  test("the fixture was taken from this tree's tracked dist", () => {
    expect(FIXTURE.v).toBe(1)
    expect(FIXTURE.server).toEqual({ name: 'agenttool-collab', version: '0.5.0' })
    expect(FIXTURE.mcp_sha256).toBe(sha256File(join(COLLAB_DIST, 'agenttool-collab-mcp.js')))
  })
})

describe('the table', () => {
  test('the table covers exactly the 34 tools of the installed build', () => {
    expect(NAMES.length).toBe(34)
    expect([...NAMES].sort()).toEqual(Object.keys(POLICY_TABLE).sort())
    expect(unclassified(NAMES)).toEqual([])
  })

  test('the classes are spec §6.3 row by row', () => {
    const count: Record<ToolClass, number> = { hidden: 0, rewritten: 0, pinned_read: 0, restricted: 0, pass_bound: 0 }
    for (const n of NAMES) count[classify(n)!] += 1
    expect(count).toEqual({ hidden: 10, rewritten: 1, pinned_read: 7, restricted: 8, pass_bound: 8 })
    for (const n of ['session_join', 'session_list', 'session_heartbeat', 'session_leave', 'workspace_open', 'cursor_reset', 'decision_record', 'events_wait', 'handoff_offer', 'handoff_respond']) {
      expect(classify(`collab_${n}`)).toBe('hidden')
    }
    for (const n of ['workspace_status', 'task_list', 'task_get', 'report_list', 'events_since', 'anchor_status', 'journal_verify']) expect(classify(`collab_${n}`)).toBe('pinned_read')
    for (const n of ['session_rest', 'report_append', 'task_review', 'task_create', 'task_claim', 'task_complete', 'task_recover', 'artifact_attach']) expect(classify(`collab_${n}`)).toBe('restricted')
    for (const n of ['session_end', 'next', 'cursor_ack', 'task_renew', 'task_progress', 'task_release', 'task_block', 'task_unblock']) expect(classify(`collab_${n}`)).toBe('pass_bound')
    expect(classify('collab_session_start')).toBe('rewritten')
  })

  test('an extra tool name is reported unclassified', () => {
    expect(unclassified([...NAMES, 'collab_brand_new', 'constructor', '__proto__', 'toString'])).toEqual(['collab_brand_new', 'constructor', '__proto__', 'toString'])
    expect(classify('hasOwnProperty')).toBeNull()
  })
})

describe('the seat tool list', () => {
  const seat = seatTools(FIXTURE.tools, 'nuance', 'macair')

  test('the seat list has 24 tools and none of the hidden ones', () => {
    expect(seat.length).toBe(24)
    for (const t of seat) expect(classify(t.name)).not.toBeNull()
    for (const t of seat) expect(classify(t.name)).not.toBe('hidden')
    expect(seat.map((t) => t.name)).toEqual([...seat.map((t) => t.name)].sort())
  })

  test('session_start has no root_path or repository_key and requires only actor', () => {
    const s = byName(seat, 'collab_session_start')
    expect(Object.keys(props(s)).sort()).toEqual(['actor', 'parent_session_id', 'role'])
    expect(s.inputSchema.required).toEqual(['actor'])
  })

  test('no tool but session_start has an actor field', () => {
    for (const t of seat) {
      if (t.name === 'collab_session_start') continue
      expect(Object.keys(props(t))).not.toContain('actor')
      expect((t.inputSchema.required as string[] | undefined) ?? []).not.toContain('actor')
    }
  })

  test('the reduced limits are advertised', () => {
    expect(props(byName(seat, 'collab_session_start')).actor!.maxLength).toBe(64)
    expect(props(byName(seat, 'collab_session_start')).role!.maxLength).toBe(97)
    expect(props(byName(seat, 'collab_report_append')).authority_scope!.maxLength).toBe(978)
    expect(props(byName(seat, 'collab_report_append')).authority_basis!.maxLength).toBe(1978)
    expect(props(byName(seat, 'collab_task_complete')).limits!.maxLength).toBe(1744)
    expect(props(byName(seat, 'collab_task_recover')).recovery_note!.maxLength).toBe(3744)
    expect(props(byName(seat, 'collab_task_review')).limits!.maxLength).toBe(2000)
  })

  test('no title survives', () => {
    for (const t of seat) expect(Object.keys(t).sort()).toEqual(['annotations', 'description', 'inputSchema', 'name'])
  })

  test("the seat list's digest is stable across two calls", () => {
    const before = JSON.stringify(FIXTURE.tools)
    const again = seatTools(FIXTURE.tools, 'nuance', 'macair')
    expect(toolsDigest(again)).toBe(toolsDigest(seat))
    expect(toolsDigest(seat)).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(FIXTURE.tools)).toBe(before)
  })

  test('an unclassified tool in the Collab list is left out of the seat list', () => {
    const extra: ToolDef = { name: 'collab_brand_new', description: 'x', inputSchema: { type: 'object', properties: {} } }
    expect(seatTools([...FIXTURE.tools, extra], 'nuance', 'macair').map((t) => t.name)).toEqual(seat.map((t) => t.name))
  })
})
