#!/usr/bin/env bun
// Test double for `claude -p`. Reads the prompt from stdin like the real CLI.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
const mode = process.env.FAKE_MODE_FILE ? (await Bun.file(process.env.FAKE_MODE_FILE).text()).trim() : 'ok'
const prompt = await new Response(Bun.stdin.stream()).text()
const emit = (o: object) => process.stdout.write(JSON.stringify(o) + '\n')
const emitOk = () => emit({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}`, num_turns: 1, total_cost_usd: 0.01 })
if (process.env.FAKE_ARGV_OUT) {
  // What the job's folder looked like at the moment claude started: the runner must have made TMPDIR (0700) and written the exclude line by now.
  const stat = (p: string | undefined) => { try { const s = lstatSync(p!); return { directory: s.isDirectory(), mode: s.mode & 0o777 } } catch { return null } }
  const read = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return null } }
  const pgid = spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim()
  await Bun.write(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), tmpdir: stat(process.env.TMPDIR),
    exclude: read('.git/info/exclude'), pid: process.pid, pgid: Number(pgid) }))
}
const [kind = '', arg = '', end = 'ok'] = mode.split(':')

/** `tamper:<what>` changes the files the runner fingerprints, then ends normally; `tamper:<what>:slow` then hangs (for a timeout). */
function tamper(what: string) {
  const all = what === 'all'
  if (all || what === 'config') appendFileSync('.git/config', '[core]\n\tpager = evil\n')
  if (all || what === 'hook') { mkdirSync('.git/hooks', { recursive: true }); writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\necho evil\n', { mode: 0o755 }) }
  if (all || what === 'gitmodules') appendFileSync('.gitmodules', '[submodule "evil"]\n\tpath = evil\n')
  if (all || what === 'gitattributes') writeFileSync('.GitAttributes', '* filter=evil\n')
  if (all || what === 'exclude') rmSync('.git/info/exclude')
  if (what === 'chmod') chmodSync('.git/hooks/pre-commit.sample', 0o644)
  if (what === 'info-link') { rmSync('.git/info', { recursive: true }); symlinkSync(process.env.TMPDIR!, '.git/info') }
  if (what === 'newline-name') { mkdirSync('.git/hooks', { recursive: true }); writeFileSync('.git/hooks/a\nb', 'x') }
  // An immutable file cannot be replaced, even by its owner: a restore that cannot be done.
  if (what === 'immutable') { appendFileSync('.git/config', '[core]\n\tpager = evil\n'); spawnSync('/usr/bin/chflags', ['uchg', '.git/config']) }
}

const note = (what: string, pid: number | undefined) => appendFileSync(process.env.FAKE_PIDS_OUT!, `${what} ${pid}\n`)
const KID = ['/bin/sleep', '600']
/** The same program as a detached child (its own session, so not in claude's process group). */
const detached = (env?: Record<string, string>) => { const c = spawn(KID[0]!, [KID[1]!], { detached: true, stdio: 'ignore', ...(env ? { env } : {}) }); c.unref(); return c }
/**
 * `kids:<list>[:slow]` leaves processes behind and then ends (or hangs). group: in claude's group; setsid: a child of its own session;
 * cleared-env: such a child with an empty environment; reparent: a session of its own whose parent exits while claude is still running;
 * orphan: the same, but the parent exits at once, before any snapshot of the process tree can see it; writer: a session of its own
 * that appends to .git/config in a loop, as fast as it can.
 */
async function leaveKids(list: string[]) {
  for (const k of list) {
    if (k === 'group') { const c = spawn(KID[0]!, [KID[1]!], { stdio: 'ignore' }); c.unref(); note('group', c.pid) }
    if (k === 'setsid') note('setsid', detached().pid)
    if (k === 'cleared-env') note('cleared-env', detached({}).pid)
    // A session of its own that keeps rewriting .git/config until it is killed: if the runner looked at the git files before the sweep, it would see this.
    if (k === 'writer') {
      const c = spawn('/bin/sh', ['-c', 'while :; do echo "[evil]" >> .git/config; done'], { detached: true, stdio: 'ignore' }); c.unref(); note('writer', c.pid)
    }
    if (k === 'reparent' || k === 'orphan') {
      const wait = k === 'reparent' ? 500 : 0
      const mid = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const {appendFileSync}=require('node:fs');
        const c=spawn('/bin/sleep',['600'],{detached:true,stdio:'ignore'});c.unref();appendFileSync(process.env.FAKE_PIDS_OUT,'${k} '+c.pid+'\\n');setTimeout(()=>process.exit(0),${wait})`],
      { stdio: 'ignore', env: { FAKE_PIDS_OUT: process.env.FAKE_PIDS_OUT! } })
      mid.unref()
    }
  }
  await Bun.sleep(900) // long enough for several snapshots of the process tree, and for a reparented child to be orphaned in the meantime
}

if (mode === 'ok') emitOk()
if (kind === 'tamper') { tamper(arg); if (end === 'slow') await Bun.sleep(30_000); else emitOk() }
if (kind === 'kids') { await leaveKids(arg.split(',')); if (end === 'slow') await Bun.sleep(30_000); else emitOk() }
if (mode === 'warn') {
  emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: Math.floor(Date.now() / 1000) + 3600 } })
  await Bun.sleep(30_000)
}
if (mode === 'slow') await Bun.sleep(30_000)
if (mode === 'flood') {
  const line = JSON.stringify({ type: 'noise', pad: 'x'.repeat(1024 * 1024) }) + '\n'
  for (let i = 0; i < 10; i++) process.stdout.write(line)
  await Bun.sleep(30_000)
}
// What 2.1.296 prints when --max-turns is reached: an error result with no `result` text, exit 1.
if (mode === 'maxturns') {
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 99, terminal_reason: 'max_turns' })
  process.exit(1)
}
if (mode === 'auth') { emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }); process.exit(1) }
if (mode === 'denied') {
  // 2.1.296 with --permission-prompts=none: the denied call is answered locally, and the run still ends `success`.
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'I was not allowed to read /Users/yu/.zshrc' }] } })
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'I was not allowed to read /Users/yu/.zshrc', num_turns: 2,
    permission_denials: [{ tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/Users/yu/.zshrc' } }] })
}
// What 2.1.296 prints for a flag it does not know: stderr only, no stdout, exit 1.
if (mode === 'badflag') {
  await new Promise<void>((done) => process.stderr.write("error: unknown option '--x=none'\n", () => done()))
  process.exit(1)
}
