// A newline-delimited JSON-RPC harness over a spawned process's stdio, for tests (Collab's StdioMcpHarness pattern,
// KN packages/collab/tests/mcp.test.ts:54-142), that also reads stderr and queues notifications. Task 37 adds
// collabHarness here (the tracked Collab dist, spawned the hub's way). The env is exactly what the caller passes:
// nothing is inherited from the test process.
import { childArgv, childEnv } from '../src/air/children.ts'
import { COLLAB_DIST } from './helpers.ts'

export interface StdioHarness {
  pid: number
  request(method: string, params?: unknown): Promise<any>
  notify(method: string, params?: unknown): Promise<void>
  initialize(): Promise<any>
  callTool(name: string, args?: Record<string, unknown>): Promise<any>
  listTools(): Promise<any>
  nextNotification(method: string, timeoutMs: number): Promise<any>
  stderrText(): Promise<string>
  close(): Promise<number | null>
}

/** A JSON-RPC error response, as a rejection: `code` is the error's code. */
export type RpcError = Error & { code: number }

export function stdioHarness(o: { argv: string[]; env: Record<string, string>; cwd: string }): StdioHarness {
  const child = Bun.spawn(o.argv, { cwd: o.cwd, env: o.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const pending = new Map<number, { method: string; resolve(v: any): void; reject(e: Error): void }>()
  const notes: any[] = []
  const waiters: Array<{ method: string; resolve(v: any): void }> = []
  let nextId = 1
  let broken: Error | null = null
  let err = ''
  let exited = false

  // A program that writes anything but JSON-RPC lines to stdout breaks MCP, so the harness fails every request then.
  const fail = (e: Error) => {
    broken ??= e
    for (const p of pending.values()) p.reject(broken)
    pending.clear()
  }

  const onLine = (line: string) => {
    let msg: any
    try { msg = JSON.parse(line) } catch { fail(new Error(`non-JSON line on stdout: ${line.slice(0, 200)}`)); return }
    if (msg === null || typeof msg !== 'object') { fail(new Error(`non-object line on stdout: ${line.slice(0, 200)}`)); return }
    if ('id' in msg && !('method' in msg)) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(Object.assign(new Error(`MCP ${p.method} failed (${msg.error.code}): ${msg.error.message}`), { code: msg.error.code }))
      else p.resolve(msg.result)
      return
    }
    if (typeof msg.method === 'string' && !('id' in msg)) {
      const i = waiters.findIndex((w) => w.method === msg.method)
      if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg)
      else notes.push(msg)
    }
  }

  const stdoutDone = (async () => {
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of child.stdout) {
      buffered += decoder.decode(chunk, { stream: true })
      for (let i = buffered.indexOf('\n'); i >= 0; i = buffered.indexOf('\n')) {
        const line = buffered.slice(0, i)
        buffered = buffered.slice(i + 1)
        if (line.trim() !== '') onLine(line)
      }
    }
    fail(new Error('MCP stdio process closed before replying'))
  })()
  const stderrDone = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stderr) err += decoder.decode(chunk, { stream: true })
  })()
  void child.exited.then(() => { exited = true })

  const write = async (msg: Record<string, unknown>) => {
    if (broken) throw broken
    child.stdin.write(JSON.stringify(msg) + '\n')
    await child.stdin.flush()
  }

  const request = async (method: string, params: unknown = {}): Promise<any> => {
    if (broken) throw broken
    const id = nextId++
    const answer = new Promise<any>((resolve, reject) => pending.set(id, { method, resolve, reject }))
    try { await write({ jsonrpc: '2.0', id, method, params }) } catch (e) { pending.delete(id); throw e }
    return answer
  }

  const notify = (method: string, params?: unknown) => write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })

  return {
    pid: child.pid,
    request,
    notify,
    async initialize() {
      const result = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'collab-bridge-test', version: '0.0.1' } })
      await notify('notifications/initialized')
      return result
    },
    callTool: (name, args = {}) => request('tools/call', { name, arguments: args }),
    listTools: () => request('tools/list', {}),
    nextNotification(method, timeoutMs) {
      const i = notes.findIndex((n) => n.method === method)
      if (i >= 0) return Promise.resolve(notes.splice(i, 1)[0])
      return new Promise((resolve, reject) => {
        const w = { method, resolve: (v: any) => { clearTimeout(timer); resolve(v) } }
        const timer = setTimeout(() => {
          const at = waiters.indexOf(w)
          if (at >= 0) waiters.splice(at, 1)
          reject(new Error(`no ${method} within ${timeoutMs} ms`))
        }, timeoutMs)
        waiters.push(w)
      })
    },
    async stderrText() {
      if (exited) await stderrDone // after exit, everything the process wrote
      return err
    },
    async close() {
      try { child.stdin.end() } catch { /* already closed */ }
      const timedOut = await Promise.race([child.exited.then(() => false), Bun.sleep(5000).then(() => true)])
      if (timedOut) child.kill('SIGKILL')
      await child.exited
      await Promise.all([stdoutDone, stderrDone])
      return child.exitCode
    },
  }
}

/** A stdio harness on this tree's tracked Collab dist, run exactly the hub's way: its argv, its three-key env, cwd '/'.
 *  The journal and home are always temp paths in tests (P35). */
export function collabHarness(o: { journal: string; home: string; sessionFile?: string }): StdioHarness {
  const spec = { bun: process.execPath, dist: COLLAB_DIST, journal: o.journal, home: o.home, sessionFile: o.sessionFile }
  return stdioHarness({ argv: childArgv(spec), env: childEnv(spec), cwd: '/' })
}
