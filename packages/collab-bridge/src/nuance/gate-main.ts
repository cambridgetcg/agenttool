// The forced command on Nuance (C2, spec §5.2). sshd runs `collab-bridge gate` for the Air's collab key with the
// client's request in SSH_ORIGINAL_COMMAND. Exactly three forms are served; anything else gets one stderr line and exit 64
// (an upload-pack-shaped refusal also a pkt-line ERR, so git shows the reason). Every invocation appends one content-free
// ledger line (form, outcome, bytes, ms). The gate runs no harness and no shell, and never echoes a refused command.
import { loadAllowlist } from '../allowlist.ts'
import { appendLedger, NUANCE_LEDGER_KEYS, type LedgerFields } from '../ledger.ts'
import { monoNowMs, passwdOfSelf } from '../native.ts'
import { homeOf, nuancePaths, type NuancePaths } from '../paths.ts'
import { systemBin, type Env } from '../sysbin.ts'
import { scaled, TIMING } from '../timing.ts'
import { pktLineErr, runFetchGate, type FetchGateCtx } from './fetch-gate.ts'
import { buildHello, describeCommand, parseGateCommand, uploadPackShaped } from './gate.ts'
import { readInstalled, readShares } from './installed.ts'
import { runRelay } from './relay.ts'

export const GATE_REFUSED_EXIT = 64
export interface GateIo { stdin: ReadableStream<Uint8Array>; stdout: { write(b: Uint8Array | string): void }; stderr: { write(s: string): void } }

const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)

export async function runGate(env: Env, io: GateIo, o: { mono?: () => number; now?: () => Date } = {}): Promise<number> {
  const mono = o.mono ?? monoNowMs
  const now = o.now ?? (() => new Date())
  const t0 = mono()
  const raw = env.SSH_ORIGINAL_COMMAND
  const say = (line: string) => io.stderr.write(`collab-bridge gate: ${printable(line)}\n`)
  let paths: NuancePaths
  try {
    paths = nuancePaths(homeOf(env), env)
  } catch (e) {
    say(`refused: ${e instanceof Error ? e.message : String(e)}`)
    return GATE_REFUSED_EXIT
  }
  let bytes = 0
  const out = {
    write(b: Uint8Array | string) {
      bytes += typeof b === 'string' ? Buffer.byteLength(b, 'utf8') : b.byteLength
      io.stdout.write(b)
    },
  }
  const ledger = (f: LedgerFields) => { try { appendLedger(paths.ledger, NUANCE_LEDGER_KEYS, f) } catch { /* the answer goes out anyway */ } }
  const record = (form: string, outcome: string, code?: string) =>
    ledger({ event: 'gate', form, outcome, code, bytes, ms: Math.max(0, Math.round(mono() - t0)) })

  const cmd = parseGateCommand(raw)
  if (!cmd) {
    if (uploadPackShaped(raw)) out.write(pktLineErr('bad_command'))
    say("refused: the only forms are hello, relay 1 <nonce> and git-upload-pack '<path>'")
    record('bad', 'refused', describeCommand(raw))   // its length and a program-like first token, never the command
    return GATE_REFUSED_EXIT
  }
  switch (cmd.form) {
    case 'hello': {
      // The user from getpwuid, not $USER: sshd sets USER, but nothing here trusts the environment for it (F3).
      const h = buildHello({ paths, user: passwdOfSelf().name, now, zsh: systemBin('zsh', env) })
      if ('error' in h) {
        say(`hello: ${h.error}`)
        record('hello', 'refused', 'hello_unavailable')
        return GATE_REFUSED_EXIT
      }
      out.write(JSON.stringify(h) + '\n')
      record('hello', 'ok')
      return 0
    }
    case 'relay': {
      const code = await runRelay({ paths, nonce: cmd.nonce, stdin: io.stdin, write: (b) => out.write(b), mono, ledger,
        staleMs: scaled(TIMING.staleMs, env), exitMs: scaled(TIMING.relayExitMs, env), inodeCheckMs: scaled(TIMING.inodeCheckMs, env),
        stderr: io.stderr })
      record('relay', code === 0 ? 'ok' : code === GATE_REFUSED_EXIT ? 'refused' : 'error')
      return code
    }
    case 'upload-pack': {
      const installed = readInstalled(paths)
      if (!installed) {
        out.write(pktLineErr('not_installed'))
        say('upload-pack: collab-bridge is not installed on this Mac')
        record('upload-pack', 'refused', 'not_installed')
        return GATE_REFUSED_EXIT
      }
      const al = loadAllowlist(paths.summonAllowlist)
      const ctx: FetchGateCtx = { home: paths.home, installed, shares: readShares(paths) ?? [], allowlist: al.ok ? al.allowlist : null, uid: process.getuid!() }
      const r = await runFetchGate(cmd.path, ctx, { stdin: io.stdin, stdout: out, stderr: io.stderr })
      record('upload-pack', r.outcome)
      return r.exit
    }
  }
}
