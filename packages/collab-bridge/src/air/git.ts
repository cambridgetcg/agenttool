// The Air side's one way to run git (spec §7.1, §7.3): the Air's own git by absolute path, cwd '/', and an environment
// built from four keys, never inherited (P14). A hub started by launchd has only HOME and PATH; LC_ALL=C keeps git's
// messages fixed, and GIT_TERMINAL_PROMPT=0 means a fetch never waits on a prompt. Nothing here sets GIT_CONFIG_*: the
// mirror's filter check (Task 42) must see every config scope, exactly as the Air sessions' own git does.
import { TIMING } from '../timing.ts'

export interface GitResult { code: number | null; stdout: Uint8Array; stderr: string; timedOut: boolean }
export interface GitRunner {
  path: string
  run(args: string[], o?: { timeoutMs?: number; prefix?: string[]; env?: Record<string, string> }): Promise<GitResult>
  records(args: string[], o?: { timeoutMs?: number }): AsyncIterable<string>
}

/** Every git command that touches a mirror or the clone it lives in: no hook and no fsmonitor daemon ever runs (§7.3). */
export const MIRROR_GIT_FLAGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'] as const

/** A full object id, SHA-1 or SHA-256; anything else never reaches a git command line as a revision. */
export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** run() keeps at most this much stdout; past it git is stopped and the call fails (code null). */
export const GIT_STDOUT_MAX = 64 * 1024 * 1024

/** run() and records() keep at most this much stderr: the first bytes, which hold the first line every caller reads. */
export const GIT_STDERR_MAX = 64 * 1024

/** A SIGTERMed git gets this long to clean up its temporary files before SIGKILL. */
const KILL_GRACE_MS = 5_000

export function airGitEnv(home: string): Record<string, string> {
  return { HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
}

type Proc = ReturnType<typeof Bun.spawn>

/** SIGTERM now (git removes its lock and temp files on it), SIGKILL if it is still there after the grace. */
function stop(proc: Proc): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  proc.kill('SIGTERM')
  const hard = setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL') }, KILL_GRACE_MS)
  void proc.exited.then(() => clearTimeout(hard))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

async function readCapped(stream: ReadableStream<Uint8Array>, max: number, over: () => void): Promise<{ bytes: Uint8Array; over: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  let tooMuch = false
  for await (const chunk of stream) {
    if (tooMuch) continue // keep draining so git is never blocked on a full pipe while it dies
    size += chunk.byteLength
    if (size > max) {
      tooMuch = true
      over()
      continue
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(tooMuch ? 0 : size)
  if (!tooMuch) {
    let off = 0
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength }
  }
  return { bytes, over: tooMuch }
}

/**
 * Reads a stream to its end but keeps only its first `max` bytes, as text. The rest is still read so git is never blocked
 * on a full pipe, and a note says bytes were dropped. It never rejects: a stream error ends what it has.
 */
async function drainText(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const kept: Uint8Array[] = []
  let size = 0
  let dropped = false
  try {
    for await (const chunk of stream) {
      if (chunk.byteLength === 0) continue
      const room = max - size
      if (chunk.byteLength > room) {
        dropped = true
        if (room > 0) { kept.push(chunk.subarray(0, room)); size = max }
        continue
      }
      kept.push(chunk)
      size += chunk.byteLength
    }
  } catch { /* the stream broke: what was read so far is all there is */ }
  const bytes = new Uint8Array(size)
  let off = 0
  for (const c of kept) { bytes.set(c, off); off += c.byteLength }
  const text = new TextDecoder().decode(bytes)
  return dropped ? `${text}${text.endsWith('\n') ? '' : '\n'}airGit: stderr truncated after ${max} bytes\n` : text
}

export function airGit(o: { git: string; home: string; defaultTimeoutMs?: number }): GitRunner {
  const base = airGitEnv(o.home)
  const defaultTimeout = o.defaultTimeoutMs ?? TIMING.gitCallMs
  const spawn = (argv: string[], env: Record<string, string>) =>
    Bun.spawn(argv, { cwd: '/', env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })

  return {
    path: o.git,

    async run(args, opts = {}) {
      let proc: Proc
      try {
        proc = spawn([...(opts.prefix ?? []), o.git, ...args], { ...base, ...(opts.env ?? {}) })
      } catch (e) {
        // A missing or unrunnable binary is a failed call, never a throw: callers turn code null into a definite refusal.
        return { code: null, stdout: new Uint8Array(0), stderr: `airGit: could not start ${o.git}: ${String(e)}\n`, timedOut: false }
      }
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; stop(proc) }, opts.timeoutMs ?? defaultTimeout)
      try {
        const [out, stderr] = await Promise.all([
          readCapped(proc.stdout as ReadableStream<Uint8Array>, GIT_STDOUT_MAX, () => stop(proc)),
          drainText(proc.stderr as ReadableStream<Uint8Array>, GIT_STDERR_MAX),
        ])
        await proc.exited
        const failed = timedOut || out.over
        return {
          code: failed ? null : proc.exitCode,
          stdout: out.bytes,
          stderr: out.over ? `${stderr}airGit: stdout over ${GIT_STDOUT_MAX} bytes\n` : stderr,
          timedOut,
        }
      } finally {
        clearTimeout(timer)
      }
    },

    records(args, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? defaultTimeout
      return {
        async *[Symbol.asyncIterator]() {
          const proc = spawn([o.git, ...args], base)
          let timedOut = false
          const timer = setTimeout(() => { timedOut = true; stop(proc) }, timeoutMs)
          const stderr = drainText(proc.stderr as ReadableStream<Uint8Array>, GIT_STDERR_MAX)
          const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
          const decoder = new TextDecoder()
          let finished = false
          let buf: Uint8Array = new Uint8Array(0)
          try {
            for (;;) {
              const { value, done } = await reader.read()
              if (done) break
              buf = concat(buf, value)
              let start = 0
              for (let i = buf.indexOf(0, start); i >= 0; i = buf.indexOf(0, start)) {
                const rec = decoder.decode(buf.subarray(start, i))
                start = i + 1
                yield rec
              }
              buf = buf.slice(start)
            }
            const code = await proc.exited
            const err = (await stderr).trim().split('\n')[0] ?? ''
            if (timedOut) throw new Error(`git ${args.join(' ')}: timed out after ${timeoutMs} ms`)
            if (code !== 0) throw new Error(`git ${args.join(' ')}: exit ${code}: ${err}`)
            if (buf.byteLength > 0) throw new Error(`git ${args.join(' ')}: output ended with an unterminated record`)
            finished = true
          } finally {
            clearTimeout(timer)
            if (!finished) {
              // The caller stopped early, or git failed: git gets SIGTERM, then the pipe is let go and git reaped.
              stop(proc)
              try { await reader.cancel() } catch { /* already closed */ }
              await proc.exited
            }
          }
        },
      }
    },
  }
}
