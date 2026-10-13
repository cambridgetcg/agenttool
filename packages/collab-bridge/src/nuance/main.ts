// The one compiled Nuance program (P20). sshd's forced command runs `collab-bridge gate`; Claude runs `collab-bridge pipe`
// and its hook `collab-bridge tap --host claude` (Tasks 31, 32); Yu runs `collab-bridge status`; the installer runs the
// hidden `install …` verbs (Tasks 55, 56). Nothing Air-side is in here.
import { monoNowMs } from '../native.ts'
import { homeOf, nuancePaths } from '../paths.ts'
import type { Env } from '../sysbin.ts'
import { scaled, TIMING } from '../timing.ts'
import { runGate, type GateIo } from './gate-main.ts'
import { nuanceStatus, renderNuanceStatus } from './status.ts'

export const NUANCE_USAGE = 'usage: collab-bridge gate | status'

/** argv is the verb and its arguments (process.argv.slice(2)); the result is the exit code. */
export async function runNuanceCli(argv: string[], env: Env, io: GateIo): Promise<number> {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'gate':
      if (rest.length === 0) return runGate(env, io)
      break
    case 'status': {
      if (rest.length > 0) break
      const paths = nuancePaths(homeOf(env), env)
      const s = nuanceStatus(paths, monoNowMs, { staleMs: scaled(TIMING.staleMs, env) })
      for (const line of renderNuanceStatus(s, monoNowMs())) io.stdout.write(line + '\n')
      return 0
    }
  }
  io.stderr.write(NUANCE_USAGE + '\n')
  return 2
}

if (import.meta.main) {
  // First, before anything reads them: the gate's children and every path lookup see one locale and the system PATH (§5.2).
  process.env.LC_ALL = 'C'
  process.env.PATH = '/usr/bin:/bin'
  let flushed: Promise<void> = Promise.resolve()
  const io: GateIo = {
    stdin: Bun.stdin.stream(),
    // A write's callback means its bytes reached the kernel. process.exit right after a plain write loses what is still
    // buffered (8 MiB written, 64 KiB arrived, on this Air), so the exit below waits for the last write's callback.
    stdout: { write: (b) => { flushed = new Promise<void>((done) => { process.stdout.write(b, () => done()) }) } },
    stderr: { write: (s) => { process.stderr.write(s) } },
  }
  let code: number
  try {
    code = await runNuanceCli(process.argv.slice(2), process.env, io)
  } catch (e) {
    process.stderr.write(`collab-bridge: ${String(e instanceof Error ? e.message : e).replace(/[^\x20-\x7e]/g, '?').slice(0, 200)}\n`)
    code = 70
  }
  await Promise.race([flushed, Bun.sleep(2000)])
  process.exit(code)
}
