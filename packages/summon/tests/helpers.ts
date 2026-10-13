import { expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { renderInstaller } from '../scripts/prepare-pairing.ts'
import type { NuanceBuild } from '../scripts/build-nuance.ts'
import { runCli, type CliDeps } from '../src/cli.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { newRequestId, type SummonRequest } from '../src/request.ts'
import { runOnce } from '../src/runner.ts'
import { sshCall } from '../src/ssh.ts'

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

/**
 * `dir` as a git repository root as far as Summon looks, which is as far as git's own test looks (setup.c is_git_directory):
 * a real .git directory holding a HEAD that names a ref, and objects/ and refs/. A fake repository that stops short of any of
 * these is not a root to admission, and git would use the enclosing repository instead.
 */
export function fakeGitRoot(dir: string): string {
  mkdirSync(join(dir, '.git', 'objects'), { recursive: true })
  mkdirSync(join(dir, '.git', 'refs'), { recursive: true })
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return dir
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

export type FakeMode = 'ok' | 'warn' | 'slow' | 'auth' | 'flood' | 'denied' | 'badflag' | 'maxturns'

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

const GATE = join(import.meta.dir, '..', 'src', 'gatekeeper-main.ts')
/** The PATH sshd and launchd hand a program on macOS. */
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

export interface World {
  fake: ReturnType<typeof makeFakeClaude>; nuance: string; air: string; deps: CliDeps; sent: string
  runner(): Promise<void>; start(cwd?: string): ReturnType<typeof runCli>
}

/**
 * One whole Phase 0 world on this Mac. The Air side is the real CLI; `ssh` is a script that turns the remote verb into
 * SSH_ORIGINAL_COMMAND, as sshd would, and runs the gatekeeper against a temp "Nuance" home.
 * The fake ssh also keeps the last stdin it was given, so a test can replay exactly what the CLI sent.
 * Without `compiled`, that is the gatekeeper's source entry point and the runner runs in this process. With it, both
 * are the built binaries, started as sshd and launchd start them: a bare environment, the gatekeeper in the Nuance home
 * and the runner in /. Only the SUMMON_* test overrides are added (they need SUMMON_HOME_OVERRIDE).
 */
export function world(compiled?: NuanceBuild): World {
  const fake = makeFakeClaude()
  fake.setMode('ok')
  const nuance = targetHome()
  const air = trackTmp(mkdtempSync(join(tmpdir(), 'summon-air-')))
  const ssh = join(air, 'ssh')
  const sent = join(air, 'sent.json')
  const overrides = `HOME='${nuance}' SUMMON_HOME_OVERRIDE='${nuance}' SUMMON_TEST_GUI=1 SUMMON_TEST_RUNNER=1 SUMMON_CLAUDE_BIN='${fake.bin}'`
  // argv: -F <config> summon-nuance <verb...>
  writeFileSync(ssh, compiled ? `#!/bin/bash
shift 2; shift
cat > '${sent}'
cd '${nuance}'
exec /usr/bin/env -i PATH='${SYSTEM_PATH}' ${overrides} SSH_ORIGINAL_COMMAND="$*" '${compiled.gatekeeper}' < '${sent}'
` : `#!/bin/bash
shift 2; shift
export SSH_ORIGINAL_COMMAND="$*"
export ${overrides}
cat > '${sent}'
exec '${process.execPath}' '${GATE}' < '${sent}'
`)
  chmodSync(ssh, 0o755)
  writeFileSync(join(air, 'task.md'), 'Summarise the README.')
  writeFileSync(join(air, 'config'), 'Host summon-nuance\n  HostName nuance.local\n') // what pin-nuance pairs
  const deps: CliDeps = { sshBin: ssh, sshConfig: join(air, 'config'), ledgerPath: join(air, 'ledger.jsonl'), device: 'air',
    env: { CLAUDECODE: '1' }, startTimeOf: () => 'Sun Oct 11 00:38:43 2026',
    nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => '' }
  const runner = compiled
    ? async () => {
      const p = Bun.spawn([compiled.runner], { cwd: '/', stdout: 'pipe', stderr: 'pipe',
        env: { PATH: SYSTEM_PATH, HOME: nuance, SUMMON_HOME_OVERRIDE: nuance, SUMMON_CLAUDE_BIN: fake.bin } })
      const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited])
      if (code !== 0) throw new Error(`compiled runner exited ${code}: ${err}`)
    }
    : async () => {
      await runOnce({ paths: summonPaths(nuance), home: nuance, user: 'yu', nowMs: () => Date.now(),
        claudeBin: () => fake.bin, collectInventory: async () => ({ macos: 'e2e' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200,
        processStartTime: () => null })
    }
  const start = (cwd = '~/Projects/x') => runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', cwd, '--review', '--prompt-file', join(air, 'task.md')], deps)
  return { fake, nuance, air, deps, sent, runner, start }
}

/** The parsed entries of a hash-chained ledger, oldest first. */
export const entriesOf = (path: string): any[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

/** Every path under `dir`, relative, directories with a trailing slash. */
const treeOf = (dir: string, rel = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? [`${rel}${e.name}/`, ...treeOf(join(dir, e.name), `${rel}${e.name}/`)] : [`${rel}${e.name}`])

/**
 * The end-to-end checks (spec §5.3), each run against a world: e2e.test.ts runs them through the source, and the real
 * build runs the same ones through the compiled pair, so both are held to the same answers and ledgers.
 */
export const END_TO_END: Record<string, (w: World) => void | Promise<void>> = {
  'a job summon returns its result; both ledgers verify': async (w) => {
    const r = w.start()
    expect(r.out.status).toBe('admitted')
    await w.runner()
    const res = runCli(['result', String(r.out.handle)], w.deps)
    expect(res.out).toMatchObject({ status: 'completed', result_text: 'echo: Summarise the README.' })
    // verifyLedger passes a missing file, so each ledger must also have the entries this run should have written.
    const air = w.deps.ledgerPath
    const nuance = summonPaths(w.nuance).ledger
    expect(verifyLedger(air)).toEqual({ ok: true, entries: 2 })
    expect(verifyLedger(nuance)).toEqual({ ok: true, entries: 3 })
    expect(entriesOf(air).map((e) => e.event)).toEqual(['sent', 'answer'])
    expect(entriesOf(nuance).map((e) => [e.event, e.status])).toEqual([['admitted', undefined], ['job_start', 'running'], ['job_end', 'completed']])
    // The advisory origin (with its start time) is on both ends' record of the request.
    const origin = `claude-code pid ${process.ppid} started 2026-10-11T00:38:43.000Z`
    expect([entriesOf(air)[0].origin, entriesOf(nuance)[0].origin]).toEqual([origin, origin])
    // The prompt travelled on stdin only: not on claude's argv, not in either ledger.
    expect(readFileSync(w.fake.argvOut, 'utf8')).not.toContain('Summarise')
    expect(readFileSync(air, 'utf8')).not.toContain('Summarise')
    expect(readFileSync(nuance, 'utf8')).not.toContain('Summarise')
    // Everything Summon wrote on "Nuance" is private.
    const local = join(w.nuance, '.local')
    for (const p of treeOf(local)) expect([p, (statSync(join(local, p)).mode & 0o777).toString(8)]).toEqual([p, p.endsWith('/') ? '700' : '600'])
  },

  'the same request sent twice: the second is refused(replayed)': (w) => {
    const first = w.start()
    expect(first.out.status).toBe('admitted')
    // The exact bytes the CLI put on ssh's stdin, sent again through the same ssh layer.
    const again = sshCall(w.deps, 'nuance', 'start', readFileSync(w.sent, 'utf8'))
    expect(again).toMatchObject({ status: 'refused', reason: 'replayed' })
    const ledger = summonPaths(w.nuance).ledger
    expect(verifyLedger(ledger)).toEqual({ ok: true, entries: 2 })
    expect(entriesOf(ledger).map((e) => [e.event, e.reason])).toEqual([['admitted', undefined], ['refused', 'replayed']])
  },

  'a non-allowlisted folder is refused with the line to add': (w) => {
    // The folder exists on Nuance but is not allowlisted, so this is the allowlist's refusal and not the missing-folder one.
    mkdirSync(join(w.nuance, 'Elsewhere'))
    const r = w.start('~/Elsewhere')
    expect(r.out).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
    expect(String(r.out.hint)).toContain('folders:')
    expect(String(r.out.hint)).toContain('path: ~/Elsewhere')
  },

  'a shell request is refused': (w) => {
    const p = Bun.spawnSync([w.deps.sshBin, '-F', 'x', 'summon-nuance', 'ls', '-la'])
    expect(p.exitCode).toBe(2)
    expect(JSON.parse(p.stdout.toString())).toMatchObject({ status: 'refused', reason: 'malformed' })
  },
}

// ── Fixtures for the installer, the build and the Air-side scripts (install, build and pairing tests). ──

export const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
export const mode = (p: string) => statSync(p).mode & 0o777
/** A fresh temp dir, removed by cleanupTmps() after the test. */
export const temp = (prefix: string) => trackTmp(mkdtempSync(join(tmpdir(), prefix)))
export const keygen = (path: string) => Bun.spawnSync(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'root@stub', '-f', path]).exitCode
export const PKG = join(import.meta.dir, '..')
export const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey summon-air'
export const TMPL = readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8')
export const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
export const USER = userInfo().username
export const DAY = 86_400_000
/** YYYYMMDD in this Mac's local time: how the installer's `date +%Y%m%d` and sshd's expiry-time read a date. */
export const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
export const dashed = (e: string) => `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6)}`
export const EXPIRY = ymd(Date.now() + 90 * DAY)
export const LATER = ymd(Date.now() + 180 * DAY)
export const AK = (root: string) => join(root, '.ssh/authorized_keys')
export const INSTALLED = (root: string) => join(root, '.local/share/summon/INSTALLED')
/** When a bundle was prepared, as the installer carries it: UTC, YYYYMMDDHHMMSS. */
export const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
/** The build id, worked out here on its own: the first 8 hex of sha256(runner sha256 ‖ gatekeeper sha256). */
export const buildIdOf = (s: { runner: string; gatekeeper: string }) => createHash('sha256').update(s.runner + s.gatekeeper).digest('hex').slice(0, 8)

let hostKeyDir = ''
/**
 * One real host key for every installer run that does not bring its own (never this Mac's /etc/ssh). It outlives a
 * single test, so a file that runs the installer removes it with `afterAll(cleanupFixtureHostKey)`.
 */
export function fixtureHostKey(): string {
  if (!hostKeyDir) {
    hostKeyDir = mkdtempSync(join(tmpdir(), 'summon-hostkey-'))
    expect(keygen(join(hostKeyDir, 'ssh_host_ed25519_key'))).toBe(0)
  }
  return join(hostKeyDir, 'ssh_host_ed25519_key')
}
export function cleanupFixtureHostKey(): void {
  if (hostKeyDir) rmSync(hostKeyDir, { recursive: true, force: true })
  hostKeyDir = ''
}

export function bundle(root: string = temp('summon-root-'), o: { expiry?: string; build?: string; prepared?: string } = {}): { dir: string; root: string } {
  const dir = temp('summon-bundle-')
  for (const b of ['summon-gatekeeper', 'summon-runner']) { writeFileSync(join(dir, b), `#!/bin/sh\necho ${b} ${o.build ?? 'v1'}\n`); chmodSync(join(dir, b), 0o755) }
  writeFileSync(join(dir, 'summon-install.sh'), renderInstaller(TMPL, { pubkey: PUB, expiry: o.expiry ?? EXPIRY, preparedAt: o.prepared ?? stampOf(Date.now()),
    shaGatekeeper: sha(join(dir, 'summon-gatekeeper')), shaRunner: sha(join(dir, 'summon-runner')) }))
  return { dir, root }
}
export const envFor = (root: string, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: BASE_PATH, HOME: root, SUMMON_INSTALL_ROOT: root, SUMMON_SKIP_SUDO: '1', SUMMON_SKIP_LAUNCHCTL: '1', SUMMON_SKIP_INVENTORY: '1',
  SUMMON_HOST_KEY: fixtureHostKey(),
  // Never this Mac's /etc/ssh: no earlier Summon drop-in, unless a test puts one here.
  SUMMON_DROPIN: join(`${root}-etc`, '010-summon.conf'), ...extra,
})
export const run = (dir: string, root: string, extra: Record<string, string> = {}) =>
  Bun.spawnSync(['bash', join(dir, 'summon-install.sh')], { env: envFor(root, extra) })


/** Stands in for the compile: two small files and their real digests. */
export function fakeBuild(outDir: string, tag = '', runnerTag = tag) {
  mkdirSync(outDir, { recursive: true })
  const gatekeeper = join(outDir, 'summon-gatekeeper'); const runner = join(outDir, 'summon-runner')
  writeFileSync(gatekeeper, `#!/bin/sh\necho gatekeeper${tag}\n`); writeFileSync(runner, `#!/bin/sh\necho runner${runnerTag}\n`)
  return { gatekeeper, runner, sha: { gatekeeper: sha(gatekeeper), runner: sha(runner) } }
}

