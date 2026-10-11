#!/usr/bin/env -S bun --no-env-file
// --no-env-file: a .env in the folder the caller runs `summon` from must not set SUMMON_* values.
// Exit codes: 0 answered; 1 a refusal, failure or unknown; 2 refused here (a usage error, an unreadable prompt);
// 3 the Air ledger could not be written, so nothing was sent.
import { defaultCliDeps, humanLines, NothingSentError, runCli, splitJsonFlag } from '../src/cli.ts'
import { sandboxOf } from '../src/ssh.ts'

const { argv, json } = splitJsonFlag(process.argv.slice(2))
let result: ReturnType<typeof runCli>
try { result = runCli(argv, defaultCliDeps()) } catch (e) {
  const said = String((e as Error)?.message ?? e).split('\n')[0]!
  // runCli throws NothingSentError when the Air ledger entry that must come before a send could not be written: a
  // failure on this Mac before anything left it, so unreachable(no_route). Anything else is a fault at a moment this
  // cannot know, so it claims nothing: unknown. Either way it is printed as every answer is.
  if (e instanceof NothingSentError) {
    const box = sandboxOf(process.env)
    result = { code: 3, out: { status: 'unreachable', reason: 'no_route', detail: said,
      ...(box ? { hint: `summon ran inside ${box}, which can keep it from writing the Air ledger (~/.local/state/summon): rerun it outside the sandbox` } : {}) } }
  } else result = { code: 1, out: { status: 'unknown', detail: `summon error: ${said}` } }
}
const { code, out } = result
if (json) console.log(JSON.stringify(out))
else for (const line of humanLines(out)) console.log(line)
process.exit(code)
