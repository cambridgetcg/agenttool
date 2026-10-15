import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { temp } from './helpers.ts'

export const CODEX_ALLOWLIST = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: codex
    reads_anywhere: true
    models: [{ model: gpt-6-astra }, { model: gpt-6-astra, effort: [high] }]
folders:
  - path: ~/Projects
    access: edit
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`

/** A native CLI double: no ssh, model, credentials, system configuration or real journals. */
export function fakeCodex() {
  const dir = temp('summon-codex-')
  const bin = join(dir, 'codex')
  const mode = join(dir, 'mode')
  const record = join(dir, 'record.json')
  const descendant = join(dir, 'descendant.pid')
  writeFileSync(mode, 'ok')
  const script = join(dir, 'fake.ts')
  writeFileSync(script, `
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const mode = readFileSync(${JSON.stringify(mode)}, 'utf8')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log(mode === 'old' ? 'codex-cli 0.1.0' : 'codex-cli 0.162.1'); process.exit(0) }
if (args.join(' ') === 'exec --help') { console.log('--ignore-user-config --ignore-rules --ephemeral --json --sandbox --skip-git-repo-check'); process.exit(0) }
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: args, env: process.env, pid: process.pid }))
const prompt = await new Response(Bun.stdin.stream()).text()
const emit = (o) => console.log(JSON.stringify(o))
emit({type:'thread.started', thread_id:'fixture'})
emit({type:'turn.started'})
if (mode === 'slow' || mode === 'descendant' || mode === 'finished-descendant') {
  if (mode === 'descendant' || mode === 'finished-descendant') {
    const p = spawn('/bin/sh', ['-c', 'trap "" TERM; while :; do sleep 1; done'], {stdio:'ignore'})
    writeFileSync(${JSON.stringify(descendant)}, String(p.pid))
    p.unref()
  }
  await Bun.sleep(mode === 'finished-descendant' ? 500 : 30000)
}
if (mode === 'error') { emit({type:'turn.failed', error:{message:'fixture error'}}); process.exit(1) }
emit({type:'item.completed', item:{id:'reply',type:'agent_message',text:'echo: '+prompt}})
emit({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})
process.exit(0)
`)
  writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o700 })
  return { bin, record, descendant, setMode: (value: string) => writeFileSync(mode, value) }
}
