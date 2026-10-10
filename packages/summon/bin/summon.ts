#!/usr/bin/env bun
import { defaultCliDeps, runCli, splitJsonFlag } from '../src/cli.ts'

const { argv, json } = splitJsonFlag(process.argv.slice(2))
let result: ReturnType<typeof runCli>
try { result = runCli(argv, defaultCliDeps()) } catch (e) {
  // runCli only throws before anything is sent (the sent-ledger write), so say it in one line, not a stack trace.
  console.error(`summon: ${String((e as Error)?.message ?? e).split('\n')[0]}`)
  process.exit(2)
}
const { code, out } = result
if (json) console.log(JSON.stringify(out))
else {
  const head = [out.status, out.reason ? `(${out.reason})` : '', out.handle ?? ''].filter(Boolean).join(' ')
  console.log(head)
  if (typeof out.heartbeat_age_s === 'number') console.log(`heartbeat: ${out.heartbeat_age_s}s ago`)
  for (const k of ['detail', 'hint', 'result_text'] as const) if (out[k]) console.log(`${k === 'result_text' ? '' : k + ': '}${out[k]}`)
  if (out.inventory) console.log(JSON.stringify(out.inventory, null, 2))
}
process.exit(code)
