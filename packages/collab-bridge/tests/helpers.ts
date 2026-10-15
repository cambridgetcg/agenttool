// Shared fixtures for every test file (Summon ruling R1: never export a fixture from a *.test.ts, because bun re-runs an
// imported test file). It imports nothing from src/, so the preload loads before any source exists, and its knob list is
// an independent statement of spec §12.1 that the guard test holds systemBin to.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** packages/collab-bridge, absolute. */
export const PKG = realpathSync(join(import.meta.dir, '..'))
/** The worktree root. */
export const TREE = realpathSync(join(PKG, '..', '..'))
/** This tree's tracked Collab dist: hermetic children run it, never the installed one (P35, spec §12.1). */
export const COLLAB_DIST = join(TREE, 'packages', 'collab', 'dist')
/** This Mac's real home, for the guard test's "never touch" list. */
export const REAL_HOME = '/Users/' + Bun.spawnSync(['/usr/bin/id', '-un'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString().trim()

/** The PATH sshd and launchd hand a program on macOS; tests put their stub dir in front of it. */
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/** What the preload made. Filled once by setupSuite(); the preload and every test file share this module. */
export const SUITE: { root: string; home: string; stubs: string; stubLog: string; sockRoot: string } = {
  root: '', home: '', stubs: '', stubLog: '', sockRoot: '',
}

/** The knob of every system binary and what the suite points it at, filled by setupSuite() (spec §12.1, P42, P43). */
const suiteKnobs: Record<string, string> = {}

const tmps: string[] = []

/** Records a temp dir so cleanupTmps() removes it; returns the dir unchanged. */
export function trackTmp(dir: string): string {
  tmps.push(dir)
  return dir
}

export function cleanupTmps(): void {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
  tmps.length = 0
}

/** A fresh temp dir by its realpath (macOS's $TMPDIR is a symlink chain), removed by cleanupTmps(). */
export function temp(prefix: string): string {
  return trackTmp(realpathSync(mkdtempSync(join(tmpdir(), prefix))))
}

/** A short socket root: $TMPDIR alone is 49 chars and sun_path is 104 bytes (K46). Removed by cleanupTmps(). */
export function shortSockRoot(): string {
  return trackTmp(realpathSync(mkdtempSync('/tmp/cbs-')))
}

/** Where a hermetic Summon drop-in lives for a test home: never this Mac's /etc/ssh (P60). */
export function testDropin(home: string): string {
  return join(home, 'etc', 'ssh', 'sshd_config.d', '010-summon.conf')
}

/**
 * The env a spawned bridge process gets in a test: the override on, the stubs first on PATH, every knob, the tracked
 * Collab dist, a fresh short socket root and a drop-in path inside `home`. Nothing is inherited from process.env (P14).
 */
export function testEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  if (!SUITE.root) throw new Error('testEnv: the preload has not run')
  return {
    HOME: home,
    COLLAB_BRIDGE_HOME_OVERRIDE: home,
    NODE_ENV: 'test',
    PATH: `${SUITE.stubs}:${SYSTEM_PATH}`,
    STUB_LOG: SUITE.stubLog,
    ...suiteKnobs,
    COLLAB_BRIDGE_COLLAB_DIST: COLLAB_DIST,
    COLLAB_BRIDGE_SOCK_ROOT: shortSockRoot(),
    COLLAB_BRIDGE_SUMMON_DROPIN: testDropin(home),
    COLLAB_BRIDGE_DROPIN_OWNER_UID: String(process.getuid!()),
    ...extra,
  }
}

/** The first timeout `untilStubStarted` gives a stub, and how many times it doubles that before it gives up. */
export const STUB_START_FIRST_MS = 500
export const STUB_START_TRIES = 5

/**
 * Runs `attempt(timeoutMs)` until the bash stub in `dir` has written the pid of its child to `dir/child`, and returns that last
 * attempt's result with the pid. The attempt is the code under test timing the stub out; the stub can only write its pid if it
 * started before that timer fired, and a first exec of a new script took 170-260 ms on the Air (probed) and now and then
 * seconds, so no one short timeout is safe and one long timeout makes every run slow. Each try gives the stub twice the time of
 * the last (500 ms up to 8 s), so a quick stub costs one short try and a slow one is waited for. A try whose stub did not start
 * is a call that timed out, as the test means it: with ownGroup the whole group is stopped with it, and without it at most a
 * `sleep 60` the stub forked just before it was stopped lives out its minute. A pid file from before the first try is removed,
 * never taken for the stub's. A stub that never starts fails with a message that says so, where a bare read of `child` would
 * fail with ENOENT. A test using this has room for every try: give it 45 s.
 */
export async function untilStubStarted<R>(dir: string, attempt: (timeoutMs: number) => Promise<R>): Promise<{ result: R; child: number }> {
  const file = join(dir, 'child')
  let timeoutMs = STUB_START_FIRST_MS
  for (let tries = 1; ; tries += 1) {
    rmSync(file, { force: true })
    const result = await attempt(timeoutMs)
    let child = 0
    try { child = Number(readFileSync(file, 'utf8').trim()) } catch { /* the stub did not get as far as writing it */ }
    if (Number.isInteger(child) && child > 0) return { result, child }
    if (tries >= STUB_START_TRIES) {
      throw new Error(`the stub in ${dir} wrote no child pid in ${STUB_START_TRIES} tries, the last with ${timeoutMs} ms to start`)
    }
    timeoutMs *= 2
  }
}

/** A logging stub: every call appends `<name> <args>` to $STUB_LOG (to /dev/null when unset), then runs `body`. */
export function writeStub(dir: string, name: string, body: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`writeStub: bad stub name ${JSON.stringify(name)}`)
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/bash\necho "${name} $*" >> "\${STUB_LOG:-/dev/null}"\n${body}\n`, { mode: 0o755 })
  chmodSync(p, 0o755)
  accessSync(p, constants.X_OK)
  return p
}

/** The fake claude host every stubbed process table chains to (P43). */
export const PS_STUB_HOST = { pid: 4100, lstart: 'Wed Oct  7 16:22:59 2026' } as const

/** The lstart the stub gives the caller's own line. */
const CALLER_LSTART = 'Tue Oct 13 11:33:11 2026'
const LSTART_RE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/

/**
 * P43's process table as an executable `<dir>/ps`. For `-o tty= -p <pid>` it prints the tty (`??` for null), padded as
 * ps pads it. Otherwise it prints, in ps's own `pid= ppid= lstart= comm=` layout, the caller ($PPID: whoever ran ps)
 * as a child of the host, and the host as a `claude` whose parent is launchd. So a pipe or tap run in a test finds a
 * claude host by its real code, and never walks to the Claude process the implementer is running in.
 */
export function writePsStub(dir: string, o: { host?: { pid: number; lstart: string }; tty?: string | null } = {}): string {
  const host = o.host ?? PS_STUB_HOST
  const tty = o.tty === undefined ? 'ttys001' : o.tty === null ? '??' : o.tty
  if (!Number.isInteger(host.pid) || host.pid < 2 || host.pid > 99998) throw new Error('writePsStub: bad host pid')
  if (!LSTART_RE.test(host.lstart)) throw new Error('writePsStub: host lstart is not in ps format')
  if (!/^[A-Za-z0-9?]{1,16}$/.test(tty)) throw new Error('writePsStub: bad tty')
  return writeStub(dir, 'ps', [
    'case " $* " in',
    `  *" tty= "*) printf '%-8s\\n' '${tty}'; exit 0 ;;`,
    'esac',
    `printf '%5d %5d %s     %s\\n' "$PPID" ${host.pid} '${CALLER_LSTART}' 'collab-bridge'`,
    `printf '%5d %5d %s     %s\\n' ${host.pid} 1 '${host.lstart}' 'claude'`,
  ].join('\n'))
}

/** Every line a stub appended to `log`, oldest first. */
export function stubCalls(log: string): string[] {
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
}

export const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
export const modeOf = (p: string): number => statSync(p).mode & 0o777

/** Variables an implementer's shell or harness may carry that no test may inherit (harness labels, git, Collab, ssh agent). */
const INHERITED = [/^CLAUDE/, /^CODEX_/, /^HERMES_/, /^GIT_/, /^AGENTOOL_/, /^XDG_/, /^SSH_/, /^BUN_OPTIONS$/, /^BUN_BE_BUN$/, /^COLLAB_BRIDGE_/]

/** Binaries a knob may point at for real (P42); ssh and launchctl are stubs, ps is P43's stub, bun is this bun. */
const REAL_KNOBS: Record<string, string> = {
  COLLAB_BRIDGE_BIN_GIT: '/opt/homebrew/bin/git',
  COLLAB_BRIDGE_BIN_ZSH: '/bin/zsh',
  COLLAB_BRIDGE_BIN_SSH_KEYGEN: '/usr/bin/ssh-keygen',
  COLLAB_BRIDGE_BIN_CODESIGN: '/usr/bin/codesign',
  COLLAB_BRIDGE_BIN_XCRUN: '/usr/bin/xcrun',
  COLLAB_BRIDGE_BIN_PLUTIL: '/usr/bin/plutil',
  COLLAB_BRIDGE_BIN_ID: '/usr/bin/id',
}

/** Builds the hermetic suite once per `bun test` run; tests/preload.ts calls it before any test file loads. */
export function setupSuite(): void {
  if (SUITE.root) return
  for (const k of Object.keys(process.env)) if (INHERITED.some((re) => re.test(k))) delete process.env[k]
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cb-suite-')))
  const home = join(root, 'home')
  const stubs = join(root, 'stubs')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(stubs, { mode: 0o700 })
  // Not tracked: it must outlive every afterEach(cleanupTmps); teardownSuite() removes it.
  const sockRoot = realpathSync(mkdtempSync('/tmp/cbs-'))
  Object.assign(SUITE, { root, home, stubs, stubLog: join(root, 'stub.log'), sockRoot })
  writeStub(stubs, 'ssh', "echo 'preload stub: no ssh' >&2\nexit 255")
  writeStub(stubs, 'launchctl', 'if [ "${1:-}" = print ]; then echo \'Could not find service\' >&2; exit 113; fi\nexit 0')
  writeStub(stubs, 'claude', 'exit 0')
  writeStub(stubs, 'sudo', 'exit 97')
  writePsStub(stubs)
  Object.assign(suiteKnobs, {
    COLLAB_BRIDGE_BIN_SSH: join(stubs, 'ssh'),
    COLLAB_BRIDGE_BIN_LAUNCHCTL: join(stubs, 'launchctl'),
    COLLAB_BRIDGE_BIN_PS: join(stubs, 'ps'),
    COLLAB_BRIDGE_BIN_BUN: process.execPath,
    ...REAL_KNOBS,
  })
  Object.assign(process.env, {
    HOME: home,
    COLLAB_BRIDGE_HOME_OVERRIDE: home,
    NODE_ENV: 'test',
    PATH: `${stubs}:${SYSTEM_PATH}`,
    STUB_LOG: SUITE.stubLog,
    ...suiteKnobs,
    COLLAB_BRIDGE_COLLAB_DIST: COLLAB_DIST,
    COLLAB_BRIDGE_SOCK_ROOT: sockRoot,
    COLLAB_BRIDGE_SUMMON_DROPIN: testDropin(home),
    COLLAB_BRIDGE_DROPIN_OWNER_UID: String(process.getuid!()),
  })
}

/** Runs once after the last test file: removes the suite, and fails the run if anything called sudo (spec §12.1). */
export function teardownSuite(): void {
  const sudo = stubCalls(SUITE.stubLog).filter((l) => l === 'sudo' || l.startsWith('sudo '))
  rmSync(SUITE.root, { recursive: true, force: true })
  rmSync(SUITE.sockRoot, { recursive: true, force: true })
  if (sudo.length > 0) throw new Error(`the stub log has ${sudo.length} sudo call(s): no code may invoke sudo (spec §12.1)`)
}

// ---- Task 27: temp git repos for the git tests (appended; the imports above already cover them) ----

/** The Air's git (spec §7.1): hermetic repos are made and read with the same binary the hub runs. */
export const REAL_GIT = '/opt/homebrew/bin/git'

/**
 * `git -C <repo> <args>` in a scrubbed env: HOME is a fresh empty temp dir and the system config is skipped, so neither
 * this Mac's ~/.gitconfig (its global hooksPath, credential helpers) nor Homebrew's gitconfig reaches a test repo.
 * Throws on a non-zero exit; returns stdout without its last newline.
 */
export function repoGit(repo: string, args: string[]): string {
  const r = Bun.spawnSync([REAL_GIT, '-C', repo, ...args], {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', HOME: temp('cb-githome-'), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} in ${repo}: exit ${r.exitCode}: ${r.stderr.toString().trim()}`)
  return r.stdout.toString().replace(/\n$/, '')
}

/** Writes each file (null deletes it), stages everything with `add -A`, commits, and returns the new HEAD. */
export function commitFiles(repo: string, files: Record<string, string | null>, message: string): string {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(repo, rel)
    if (content === null) {
      rmSync(p, { force: true })
    } else {
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, content)
    }
  }
  repoGit(repo, ['add', '-A'])
  repoGit(repo, ['-c', 'user.name=Collab Test', '-c', 'user.email=test@collab-bridge.invalid', 'commit', '-q', '--allow-empty', '-m', message])
  return repoGit(repo, ['rev-parse', 'HEAD'])
}

/**
 * A repo at `dir` (created if absent) on branch main with one commit holding `files`, by default the trial repo's shape
 * (spec §10.2 step 1: README.md and notes/.gitkeep). Returns that first commit's oid.
 */
export function makeRepo(dir: string, files: Record<string, string> = { 'README.md': 'collab trial\n', 'notes/.gitkeep': '' }): string {
  mkdirSync(dir, { recursive: true })
  repoGit(dir, ['init', '-q', '-b', 'main'])
  return commitFiles(dir, files, 'trial base')
}

// ---- Task 42 fix round 1: a process that must not outlive its caller ----

/** True once no process has this pid (polled, since a SIGKILLed process takes a moment to leave the table). */
export async function pidGone(pid: number, withinMs: number): Promise<boolean> {
  const until = Date.now() + withinMs
  for (;;) {
    try { process.kill(pid, 0) } catch { return true }
    if (Date.now() >= until) return false
    await Bun.sleep(50)
  }
}

/** Best-effort SIGKILL, for a test's `finally`: a failed assertion must not leave a stray sleep behind. */
export function killQuietly(pid: number): void {
  try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
}

/**
 * SIGKILLs the process whose pid a test recorded in `file`, for a `finally`. Only a positive integer written in digits is ever
 * signalled: an empty file reads as 0, and kill(0) would signal the test runner's own process group (kill(-n), another one).
 * A missing, empty or garbled file, or a process that is gone, is skipped.
 */
export function killRecordedPid(file: string): void {
  let text: string
  try { text = readFileSync(file, 'utf8').trim() } catch { return }
  if (!/^[0-9]+$/.test(text)) return
  const pid = Number(text)
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
}

// ---- Task 63 fold (mirror batch): exact git paths, whatever this Mac's file system makes of their names ----

/**
 * Commits the given index entries on top of HEAD without touching the work tree, so paths that APFS (case- and
 * normalisation-insensitive) would merge into one file, such as `a.ts` and `A.ts`, or a symlink, can be committed
 * together. Every name reaches git exactly as written: core.ignorecase and core.precomposeunicode are off in `repo`.
 * Returns the new HEAD.
 */
export function commitIndexEntries(repo: string, entries: Array<{ path: string; content: string; mode?: string }>, message: string): string {
  repoGit(repo, ['config', 'core.ignorecase', 'false'])
  repoGit(repo, ['config', 'core.precomposeunicode', 'false'])
  const dir = temp('cb-blob-')
  entries.forEach((e, i) => {
    const file = join(dir, `blob-${i}`)
    writeFileSync(file, e.content)
    const oid = repoGit(repo, ['hash-object', '-w', file])
    repoGit(repo, ['update-index', '--add', '--cacheinfo', `${e.mode ?? '100644'},${oid},${e.path}`])
  })
  repoGit(repo, ['-c', 'user.name=Collab Test', '-c', 'user.email=test@collab-bridge.invalid', 'commit', '-q', '--allow-empty', '-m', message])
  return repoGit(repo, ['rev-parse', 'HEAD'])
}
