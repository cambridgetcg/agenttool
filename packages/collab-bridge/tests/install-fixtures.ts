// Fixtures for the installer's tests (Tasks 55–57): the trial repo on the "Air", a Nuance home where Summon is installed,
// and a bundle folder with its MANIFEST. A shared fixture lives here, never in a *.test.ts (Summon ruling R1: bun re-runs
// an imported test file). Task 57 adds the whole AirDrop bundle around the bash installer and a runner for it.
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ToolDef } from '../src/link/messages.ts'
import { localYmd, renderManifest, type CheckInput, type Manifest } from '../src/nuance/install-steps.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { writeToolsFile } from '../src/tools-digest.ts'
import { renderInstaller, type InstallerValues } from '../scripts/prepare-pairing.ts'
import { commitFiles, modeOf, PKG, REAL_GIT, repoGit, sha256File, temp, testEnv, writeStub } from './helpers.ts'
import { allowlistYaml } from './nuance-home.ts'

export const FIXTURE_TRAILER = 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>'

/** A small seat tool list for tools.json: the installer only stores and seeds it, so any valid list will do. */
export const FIXTURE_TOOLS: ToolDef[] = [
  { name: 'collab_next', description: 'What needs your attention next.', inputSchema: { type: 'object', properties: {} } },
  { name: 'collab_session_start', description: 'Start a Collab session.',
    inputSchema: { type: 'object', properties: { actor: { type: 'string', maxLength: 64 } }, required: ['actor'] } },
]

export interface TrialRepo { repo: string; commit: string }

/** The Air's trial repo (spec §10.2 step 1): README.md and notes/.gitkeep, one commit whose message ends with the trailer. */
export function makeTrialRepo(o: { files?: Record<string, string> } = {}): TrialRepo {
  const repo = temp('cb-air-trial-')
  repoGit(repo, ['init', '-q', '-b', 'main'])
  const commit = commitFiles(repo, o.files ?? { 'README.md': 'collab trial\n', 'notes/.gitkeep': '' }, `collab trial base\n\n${FIXTURE_TRAILER}`)
  return { repo, commit }
}

/** Summon's key line as its installer writes it (the key is a fixture, not a real key). */
export function summonLine(home: string): string {
  return `restrict,from="192.168.50.0/24",expiry-time="20270110",command="${home}/.local/share/summon/summon-gatekeeper" ` +
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixture1 summon-air'
}

export interface NuanceHome { home: string; env: Record<string, string>; paths: NuancePaths; share: string }

/**
 * A "Nuance" home where Summon is installed and live (spec §10.1), as `install check` asks of a fresh home: its INSTALLED
 * and keys-only marker, the drop-in (owned by this user here: P60), its summon-air key line, ~/Projects, and an allowlist
 * (Task 21's allowlistYaml) with ~/Projects review-only and ~/Projects/collab-trial `access: edit` (Y1). `share` is the
 * trial folder, not yet there. `home` defaults to a new temp dir; Tasks 58 and 62 pass their own.
 */
export function summonReadyHome(o: { allowlist?: string; home?: string } = {}): NuanceHome {
  const home = o.home ?? temp('cb-nuance-')
  const env = testEnv(home)
  const paths = nuancePaths(home, env)
  mkdirSync(join(home, 'Projects'), { recursive: true })
  mkdirSync(dirname(paths.summonInstalled), { recursive: true, mode: 0o700 })
  writeFileSync(paths.summonInstalled, 'build 5c09726b\nprepared 20261012090000\n', { mode: 0o600 })
  writeFileSync(paths.summonKeysOnly, '', { mode: 0o600 })
  mkdirSync(dirname(paths.summonDropin), { recursive: true })
  writeFileSync(paths.summonDropin, 'PasswordAuthentication no\n', { mode: 0o600 })
  chmodSync(paths.summonDropin, 0o600)
  mkdirSync(dirname(paths.authorizedKeys), { recursive: true, mode: 0o700 })
  writeFileSync(paths.authorizedKeys, summonLine(home) + '\n', { mode: 0o600 })
  mkdirSync(dirname(paths.summonAllowlist), { recursive: true, mode: 0o700 })
  writeFileSync(paths.summonAllowlist, o.allowlist ??
    allowlistYaml([{ path: '~/Projects', access: 'review' }, { path: '~/Projects/collab-trial', access: 'edit' }]))
  return { home, env, paths, share: join(home, 'Projects', 'collab-trial') }
}

export interface CheckBundle { dir: string; manifest: Manifest }

/**
 * A bundle folder as install check reads it: collab-bridge (the given file, or a two-line `exit 0` stand-in), tools.json, the trial repo's
 * git bundle and MANIFEST.txt listing all three. The build defaults to the first 8 hex of the binary's sha256 (Task 58).
 */
export function writeCheckBundle(o: { trial: TrialRepo; shares: string[]; dir?: string; binary?: string; tools?: ToolDef[];
  device?: string; build?: string; prepared?: string; expiry?: string }): CheckBundle {
  const dir = o.dir ?? temp('cb-bundle-')
  chmodSync(dir, 0o700)
  const bin = join(dir, 'collab-bridge')
  if (o.binary) copyFileSync(o.binary, bin)
  else writeFileSync(bin, '#!/bin/bash\nexit 0\n')
  chmodSync(bin, 0o700)
  const tools = writeToolsFile(join(dir, 'tools.json'), o.tools ?? FIXTURE_TOOLS)
  repoGit(o.trial.repo, ['bundle', 'create', '-q', join(dir, 'collab-trial.bundle'), '--all'])
  chmodSync(join(dir, 'collab-trial.bundle'), 0o600)
  const files = { 'collab-bridge': sha256File(bin), 'tools.json': sha256File(join(dir, 'tools.json')),
    'collab-trial.bundle': sha256File(join(dir, 'collab-trial.bundle')) }
  const manifest: Manifest = {
    device: o.device ?? 'nuance', build: o.build ?? files['collab-bridge'].slice(0, 8), prepared: o.prepared ?? '20261013120000',
    expiry: o.expiry ?? '20991231', binary_sha256: files['collab-bridge'], tools_digest: tools.digest, trial_commit: o.trial.commit,
    shares: o.shares, files,
  }
  writeFileSync(join(dir, 'MANIFEST.txt'), renderManifest(manifest), { mode: 0o600 })
  return { dir, manifest }
}

/** A claude stand-in that answers --version and does nothing else. */
export function claudeStub(): string {
  return writeStub(temp('cb-claude-'), 'claude', 'if [ "${1:-}" = --version ]; then echo "2.1.296 (Claude Code)"; fi\nexit 0')
}

/** installCheck's input for a home and a bundle, every check passing unless `over` changes one. */
export function checkInput(h: NuanceHome, b: CheckBundle, over: Partial<CheckInput> = {}): CheckInput {
  return {
    bundle: b.dir, shares: b.manifest.shares, terminalGit: REAL_GIT, claude: claudeStub(), paths: h.paths,
    uid: process.getuid!(), user: 'macair', platform: 'darwin', arch: 'arm64', zsh: '/bin/zsh', xcrun: '/usr/bin/xcrun',
    today: localYmd(new Date()), dropinOwnerUid: process.getuid!(), ...over,
  }
}

// ---- Task 57: the whole AirDrop bundle around the bash installer, and what a run may change ----

/** The Air's collab key line as prepare-pairing puts it in the template (a fixture key, never a real one). */
export const FIXTURE_PUBKEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAirCollabKeyFixtureAirCollabKeyFixtureAirColl collab-air'

/** This Mac's user name from passwd (never $USER): the installer refuses a bundle prepared for another user. */
export const THIS_USER = Bun.spawnSync(['/usr/bin/id', '-un'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString().trim()

/**
 * The binary a test bundle carries: a bash wrapper that records how it was run ($0) and runs the Nuance entry from source.
 * Like Gatekeeper with a quarantined download, it refuses to run (exit 86) while it carries com.apple.quarantine.
 */
function standIn(dir: string, runs: string): string {
  const p = join(dir, 'collab-bridge-stand-in')
  writeFileSync(p, [
    '#!/bin/bash',
    `echo "$0" >> '${runs}'`,
    `if /usr/bin/xattr -p com.apple.quarantine "$0" >/dev/null 2>&1; then echo "quarantined: $0" >> '${runs}'; exit 86; fi`,
    `exec '${process.execPath}' --no-env-file --config=/dev/null '${PKG}/src/nuance/main.ts' "$@"`, '',
  ].join('\n'))
  chmodSync(p, 0o755)
  return p
}

export interface InstallBundle { dir: string; values: InstallerValues; manifest: Manifest; runs: string }

/**
 * The AirDrop bundle prepare-pairing makes (Task 60), around a stand-in binary or `binary` (Task 58 passes the compiled
 * one): collab-install.sh rendered from the real template, collab-bridge, MANIFEST.txt, tools.json and collab-trial.bundle,
 * in a folder named as production names it. `quarantine` marks the bundle's binary as an AirDropped file is marked.
 * `runs` is the file the stand-in appends its $0 to.
 */
export function makeInstallBundle(o: { airRepo: string; shares: string[]; expiry?: string; prepared?: string; build?: string; quarantine?: boolean;
  binary?: string }): InstallBundle {
  const work = temp('cb-airdrop-')
  const runs = join(work, 'runs.log')
  writeFileSync(runs, '')
  const binary = o.binary ?? standIn(work, runs)
  const expiry = o.expiry ?? '20991231'
  const build = o.build ?? sha256File(binary).slice(0, 8)
  const dir = join(work, `collab-bridge-nuance-bundle-${expiry}-${build}`)
  mkdirSync(dir, { mode: 0o700 })
  const trial = { repo: o.airRepo, commit: repoGit(o.airRepo, ['rev-parse', 'HEAD']) }
  const { manifest } = writeCheckBundle({ trial, shares: o.shares, dir, binary, build, prepared: o.prepared, expiry })
  const sha = (name: string) => sha256File(join(dir, name))
  const values: InstallerValues = {
    device: 'nuance', user: THIS_USER, pubkey: FIXTURE_PUBKEY, expiry, preparedAt: manifest.prepared, build,
    shaBinary: sha('collab-bridge'), shaManifest: sha('MANIFEST.txt'), shaTools: sha('tools.json'), shaTrialBundle: sha('collab-trial.bundle'),
    trailer: FIXTURE_TRAILER, shares: o.shares,
  }
  writeFileSync(join(dir, 'collab-install.sh'), renderInstaller(readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8'), values), { mode: 0o600 })
  if (o.quarantine) {
    const q = Bun.spawnSync(['/usr/bin/xattr', '-w', 'com.apple.quarantine', '0081;6708f000;Safari;', join(dir, 'collab-bridge')])
    if (q.exitCode !== 0) throw new Error('makeInstallBundle: could not set com.apple.quarantine')
  }
  return { dir, values, manifest, runs }
}

/** The one line the installer adds to authorized_keys (spec §5.1), for a home and a key. */
export function expectedKeyLine(o: { home: string; pubkey: string; expiry: string }): string {
  return `restrict,from="192.168.50.0/24",expiry-time="${o.expiry}",command="${o.home}/.local/share/collab-bridge/collab-bridge gate" ${o.pubkey}`
}

/**
 * Runs the bundle's installer with bash, as Yu does, in the home's test env. `answers` are the lines typed at the two
 * prompts (through COLLAB_BRIDGE_TTY, which the installer reads only under the override); without them the answer file
 * does not exist, which reads as no terminal, so a test never reaches the real /dev/tty.
 */
export function runInstaller(dir: string, home: string, o: { answers?: string | null; extraEnv?: Record<string, string> } = {}):
  { code: number; stdout: string; stderr: string } {
  const tty = join(temp('cb-tty-'), 'answers')
  if (typeof o.answers === 'string') writeFileSync(tty, o.answers)
  const r = Bun.spawnSync(['/bin/bash', join(dir, 'collab-install.sh')],
    { env: testEnv(home, { COLLAB_BRIDGE_TTY: tty, ...o.extraEnv }), cwd: home, stdout: 'pipe', stderr: 'pipe' })
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
}

export interface ClaudeRecorder { bin: string; calls(): Array<{ cwd: string; argv: string[] }> }

/** A claude stand-in that records each call's folder and argv (tab-separated) and answers --version like 2.1.296. */
export function recordingClaude(): ClaudeRecorder {
  const dir = temp('cb-claude-rec-')
  const log = join(dir, 'calls.tsv')
  writeFileSync(log, '')
  const bin = writeStub(dir, 'claude', [
    `{ printf '%s' "$(pwd -P)"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> '${log}'`,
    'if [ "${1:-}" = --version ]; then echo "2.1.296 (Claude Code)"; fi',
    'exit 0',
  ].join('\n'))
  return {
    bin,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { const [cwd, ...argv] = l.split('\t'); return { cwd: cwd!, argv } }),
  }
}

/** Every path under `root` with its mode and content hash (a link with its target): what "nothing was changed" compares. */
export function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) out[r] = `link ${readlinkSync(p)}`
      else if (e.isDirectory()) { out[r] = `dir ${modeOf(p).toString(8)}`; walk(p, r) }
      else out[r] = `${modeOf(p).toString(8)} ${sha256File(p)}`
    }
  }
  walk(root, '')
  return out
}
