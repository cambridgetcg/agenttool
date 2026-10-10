// The SSH forced command on Nuance. sshd hands the client's request in as
// SSH_ORIGINAL_COMMAND; this program is the only thing the summon key can run.
// It never runs a harness. Every path answers with exactly one JSON line on stdout:
//   exit 0  answered (including a refusal the gate decided on)
//   exit 2  the command itself was refused (not one of the five verbs)
//   exit 1  something threw — the answer is `unknown`, never `refused`, because a `start`
//           that throws may already have spooled its job
import { loadAllowlist } from './allowlist.ts'
import { gateStart } from './gate.ts'
import { liveGateDeps, parseCommand, readBoundedStdin, requestCancel, requestInventory, resultOf, sanitizeForLog, statusOf, type Command } from './gatekeeper.ts'
import { appendLedger } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { MAX_START_STDIN_BYTES } from './request.ts'
import type { GateResponse } from './status.ts'

process.env.LC_ALL = 'C'
process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/** One JSON line, flushed before the caller goes on to exit. */
const say = (o: GateResponse) => new Promise<void>((done) => { process.stdout.write(JSON.stringify(o) + '\n', () => done()) })

async function answer(cmd: Command): Promise<GateResponse> {
  const paths = summonPaths()
  const al = loadAllowlist(paths.allowlist)
  const device = al.ok ? al.allowlist.device : 'unknown'
  const now = Date.now()
  switch (cmd.verb) {
    case 'start': {
      const { text, tooLarge } = await readBoundedStdin(Bun.stdin.stream(), MAX_START_STDIN_BYTES)
      return tooLarge ? { status: 'refused', reason: 'too_large', detail: 'request exceeds 160 KiB' } : gateStart(text, liveGateDeps(paths))
    }
    case 'status': return statusOf(paths, device, cmd.id, now)
    case 'result': return resultOf(paths, device, cmd.id, now)
    case 'cancel': return requestCancel(paths, device, cmd.id, now)
    case 'inventory': return await requestInventory(paths, now)
  }
}

async function main(): Promise<number> {
  const raw = process.env.SSH_ORIGINAL_COMMAND
  const cmd = parseCommand(raw)
  if (!cmd) {
    // The refusal does not depend on the ledger: if it cannot be written, the answer still goes out.
    try { appendLedger(summonPaths().ledger, { event: 'bad_command', detail: sanitizeForLog(raw) }) } catch { /* answer anyway */ }
    await say({ status: 'refused', reason: 'malformed', detail: 'unknown command' })
    return 2
  }
  let reply: GateResponse
  let code = 0
  try {
    reply = await answer(cmd)
  } catch (e) {
    reply = { status: 'unknown', detail: `gatekeeper error: ${sanitizeForLog(e instanceof Error ? e.message : String(e))}` }
    code = 1
  }
  await say(reply)
  return code
}

process.exit(await main())
