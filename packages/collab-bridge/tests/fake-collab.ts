// A scriptable stand-in for the Collab MCP bin (Task 37). It is written into a temp "dist" dir as
// agenttool-collab-mcp.js, so CollabChild runs it exactly the way the hub runs Collab: the same argv, env and cwd.
// The hub passes exactly three env keys, so the script comes from a file beside the program, never from the env.
// It records every message it receives, and at start its env keys, cwd and whether a planted bunfig or .env leaked in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef } from '../src/link/messages.ts'

export type FakeTool =
  | { kind: 'reply' } | { kind: 'error' } | { kind: 'delay'; ms: number } | { kind: 'stall' }
  | { kind: 'die' } | { kind: 'garbage' } | { kind: 'big'; bytes: number }
  | { kind: 'wait_file'; file: string } // answers `reply` once <dist>/<file> exists (Task 51)
export interface FakeScript {
  startup?: { kind: 'ok' } | { kind: 'fail'; line: string; code: number } | { kind: 'hang' }
  tools?: Record<string, FakeTool>
}
export interface FakeLogLine {
  start?: true; env?: string[]; cwd?: string; leak_env?: string | null; leak_define?: string | null; preload?: string | null
  method?: string; id?: number | string | null; name?: string
}

export const FAKE_TOOLS: ToolDef[] = [
  { name: 'fake_echo', description: 'Echo the arguments.', inputSchema: { type: 'object', properties: {} } },
  { name: 'fake_slow', description: 'Answer later.', inputSchema: { type: 'object', properties: {} } },
]

const PROGRAM = `// fake Collab MCP bin (tests/fake-collab.ts)
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const here = import.meta.dir
const script = JSON.parse(readFileSync(join(here, 'fake-collab.json'), 'utf8'))
const log = (o) => appendFileSync(join(here, 'fake-collab.log'), JSON.stringify(o) + '\\n')
log({ start: true, env: Object.keys(process.env).sort(), cwd: process.cwd(), leak_env: process.env.LEAK ?? null,
  leak_define: typeof LEAK_DEFINE !== 'undefined' ? LEAK_DEFINE : null, preload: globalThis.__FAKE_PRELOADED ?? null })
const startup = script.startup ?? { kind: 'ok' }
if (startup.kind === 'fail') { process.stderr.write('· starting\\n' + startup.line + '\\n'); process.exit(startup.code) }
const tools = ${JSON.stringify(FAKE_TOOLS)}
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
let n = 0
function onMessage(m) {
  log({ method: m.method ?? null, id: m.id ?? null, name: m.params?.name })
  if (m.method === 'initialize') {
    if (startup.kind === 'hang') return
    out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-collab', version: '0' } } })
  } else if (m.method === 'tools/list') {
    out({ jsonrpc: '2.0', id: m.id, result: { tools } })
  } else if (m.method === 'tools/call') {
    const t = (script.tools ?? {})[m.params.name] ?? { kind: 'reply' }
    n += 1
    const sc = { ok: true, name: m.params.name, args: m.params.arguments, n }
    const ok = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc }
    if (t.kind === 'reply') out({ jsonrpc: '2.0', id: m.id, result: ok })
    else if (t.kind === 'error') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: '{"error":"fake_error"}' }], structuredContent: { error: 'fake_error', message: 'refused' }, isError: true } })
    else if (t.kind === 'delay') setTimeout(() => out({ jsonrpc: '2.0', id: m.id, result: ok }), t.ms)
    else if (t.kind === 'die') process.exit(9)
    else if (t.kind === 'garbage') process.stdout.write('this is not json\\n')
    else if (t.kind === 'big') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'x'.repeat(t.bytes) }] } })
    else if (t.kind === 'wait_file') { const iv = setInterval(() => { if (existsSync(join(here, t.file))) { clearInterval(iv); out({ jsonrpc: '2.0', id: m.id, result: ok }) } }, 10); iv.unref() }
  }
}
let buf = ''
const dec = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  buf += dec.decode(chunk, { stream: true })
  let i
  while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onMessage(JSON.parse(line)) }
}
log({ method: 'eof' })
`

/** Writes the fake as `<dir>/agenttool-collab-mcp.js` with its script; returns `dir`, which then serves as a ChildSpec dist. */
export function writeFakeCollab(dir: string, script: FakeScript = {}): string {
  writeFileSync(join(dir, 'agenttool-collab-mcp.js'), PROGRAM, { mode: 0o755 })
  writeFileSync(join(dir, 'fake-collab.json'), JSON.stringify(script))
  return dir
}

export function fakeLog(dir: string): FakeLogLine[] {
  const p = join(dir, 'fake-collab.log')
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogLine) : []
}

/** A bunfig.toml with a preload and a define, and a .env, as a fetched mirror tree could carry them (K66, T29). */
export function plantBunConfig(dir: string): void {
  writeFileSync(join(dir, 'bunfig.toml'), 'preload = ["./preload.ts"]\n[define]\n"LEAK_DEFINE" = "\'defined\'"\n')
  writeFileSync(join(dir, 'preload.ts'), "(globalThis as any).__FAKE_PRELOADED = 'yes'\n")
  writeFileSync(join(dir, '.env'), 'LEAK=from-dotenv\n')
}
