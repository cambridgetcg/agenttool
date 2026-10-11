import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newRequestId, type SummonRequest } from '../src/request.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'gatekeeper-main.ts')

export function sampleRequest(over: Partial<SummonRequest> = {}): SummonRequest {
  const now = Date.now()
  return {
    v: 1, id: newRequestId(now), from_device: 'air', to_device: 'nuance',
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + 15 * 60_000).toISOString(),
    runtime: 'claude', mode: 'job', model: 'sonnet', cwd: '~/Projects/x', access: 'review',
    timeout_s: 900, prompt: 'Read the README and summarise it.', ...over,
  }
}

const tmps: string[] = []

/** Records a temp dir so cleanupTmps() can remove it; returns the dir unchanged. */
export function trackTmp(dir: string): string {
  tmps.push(dir)
  return dir
}

export function cleanupTmps(): void {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
  tmps.length = 0
}

export const DEFAULT_ALLOWLIST = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`

/** A fresh fake target home with ~/Projects/x and an allowlist; registered for cleanupTmps(). */
export function targetHome(allowlist: string = DEFAULT_ALLOWLIST): string {
  const h = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-gate-'))))
  mkdirSync(join(h, 'Projects/x'), { recursive: true })
  mkdirSync(join(h, '.config/summon'), { recursive: true })
  writeFileSync(join(h, '.config/summon/allowlist.yaml'), allowlist)
  return h
}

export type FakeMode = 'ok' | 'warn' | 'slow' | 'auth' | 'flood' | 'denied' | 'badflag'

/**
 * A stand-in for the `claude` binary. The harness builds the child's env from scratch (no inherited PATH or FAKE_*),
 * so the fake runs through a bash wrapper that bakes in the absolute bun path, a mode file and an argv-out file.
 * The fake writes the argv and env it was given to `argvOut` as it starts, so a test can inspect what claude was handed.
 */
export function makeFakeClaude(): { bin: string; argvOut: string; setMode(m: FakeMode): void } {
  const dir = trackTmp(mkdtempSync(join(tmpdir(), 'summon-fake-')))
  const bin = join(dir, 'fake-claude.sh')
  const modeFile = join(dir, 'mode')
  const argvOut = join(dir, 'argv-out.json')
  writeFileSync(modeFile, 'ok')
  writeFileSync(bin, `#!/bin/bash\nFAKE_MODE_FILE='${modeFile}' FAKE_ARGV_OUT='${argvOut}' exec '${process.execPath}' '${join(import.meta.dir, 'fake-claude.ts')}' "$@"\n`, { mode: 0o755 })
  return { bin, argvOut, setMode: (m) => writeFileSync(modeFile, m) }
}

/**
 * Runs the real gatekeeper entry point as sshd would: a fresh process, `command` as SSH_ORIGINAL_COMMAND
 * (left unset when undefined), `stdin` piped in. The gatekeeper's contract is exactly one JSON line on
 * stdout, so anything else throws here and fails the calling test.
 */
export async function runGatekeeper(home: string, command: string | undefined, stdin = ''): Promise<{ code: number; out: any }> {
  const env: Record<string, string> = {
    PATH: process.env.PATH!, HOME: home, SUMMON_HOME_OVERRIDE: home,
    SUMMON_TEST_GUI: '1', SUMMON_TEST_RUNNER: '1', SUMMON_CLAUDE_BIN: '/bin/echo',
  }
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command
  const p = Bun.spawn(['bun', MAIN], { env, stdin: new Blob([stdin]), stdout: 'pipe', stderr: 'pipe' })
  const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
  const lines = text.split('\n').filter(Boolean)
  if (lines.length !== 1 || !text.endsWith('\n')) throw new Error(`expected exactly one JSON line, got ${JSON.stringify(text)} (exit ${code})`)
  return { code, out: JSON.parse(lines[0]!) }
}
