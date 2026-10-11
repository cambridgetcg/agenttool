#!/usr/bin/env -S bun --no-env-file
// --no-env-file: a .env in the folder the caller runs `summon` from must not set SUMMON_* values.
// Exit codes: 0 answered; 1 a refusal, failure or unknown; 2 refused here (a usage error, an unreadable prompt);
// 3 the Air ledger could not be written, so nothing was sent.
import { defaultCliDeps, NothingSentError, runCli, splitJsonFlag } from '../src/cli.ts'
import { sandboxOf } from '../src/ssh.ts'
import type { GateResponse } from '../src/status.ts'

const { argv, json } = splitJsonFlag(process.argv.slice(2))
let result: ReturnType<typeof runCli>
try { result = runCli(argv, defaultCliDeps()) } catch (e) {
  const said = String((e as Error)?.message ?? e).split('\n')[0]!
  // runCli throws NothingSentError when the Air ledger entry that must come before a send could not be written. Anything
  // else is a fault at a moment this cannot know, so it claims nothing: unknown.
  const box = e instanceof NothingSentError ? sandboxOf(process.env) : null
  const out: GateResponse = e instanceof NothingSentError
    ? { status: 'unreachable', detail: said, ...(box ? { hint: `summon ran inside ${box}, which can keep it from writing the Air ledger (~/.local/state/summon): rerun it outside the sandbox` } : {}) }
    : { status: 'unknown', detail: `summon error: ${said}` }
  if (json) console.log(JSON.stringify(out))
  else {
    console.error(`summon: ${out.detail}`)
    if (out.hint) console.error(`hint: ${out.hint}`)
  }
  process.exit(e instanceof NothingSentError ? 3 : 1)
}
const { code, out } = result
if (json) console.log(JSON.stringify(out))
else {
  const head = [out.status, out.reason ? `(${out.reason})` : '', out.handle ?? ''].filter(Boolean).join(' ')
  console.log(head)
  if (typeof out.heartbeat_age_s === 'number') console.log(`heartbeat: ${out.heartbeat_age_s}s ago`)
  if (typeof out.resets_at === 'string') console.log(`resets: ${out.resets_at}`)
  for (const k of ['detail', 'hint', 'result_text'] as const) if (out[k]) console.log(`${k === 'result_text' ? '' : k + ': '}${out[k]}`)
  if (out.inventory) console.log(JSON.stringify(out.inventory, null, 2))
}
process.exit(code)
