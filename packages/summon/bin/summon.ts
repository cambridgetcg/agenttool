#!/usr/bin/env bun
import { defaultCliDeps, runCli, splitJsonFlag } from '../src/cli.ts'

const { argv, json } = splitJsonFlag(process.argv.slice(2))
const { code, out } = runCli(argv, defaultCliDeps())
if (json) console.log(JSON.stringify(out))
else {
  const head = [out.status, out.reason ? `(${out.reason})` : '', out.handle ?? ''].filter(Boolean).join(' ')
  console.log(head)
  for (const k of ['detail', 'hint', 'result_text'] as const) if (out[k]) console.log(`${k === 'result_text' ? '' : k + ': '}${out[k]}`)
  if (out.inventory) console.log(JSON.stringify(out.inventory, null, 2))
}
process.exit(code)
