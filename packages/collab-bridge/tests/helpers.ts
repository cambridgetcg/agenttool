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
