// On the Air: prepare a device's pairing bundle (C6, spec §10.2 step 1). This part is the installer's renderer and the
// pattern of every value it puts into nuance/install.sh.tmpl; Task 60 adds the bundle around it (the collab key, the
// build, tools.json, the trial repo and its git bundle, MANIFEST.txt and the device file).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { probeCollabTools } from '../src/air/children.ts'
import { preparedStamp, readDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { airGit, MIRROR_GIT_FLAGS, OID_RE, type GitRunner } from '../src/air/git.ts'
import { mirrorIdOf } from '../src/air/mirror.ts'
import { seatTools, unclassified } from '../src/air/policy-table.ts'
import { withLock } from '../src/ledger.ts'
import { renderManifest, TRAILER_RE } from '../src/nuance/install-steps.ts'
import { airPaths, collabDist, homeOf } from '../src/paths.ts'
import { mkdirPrivate } from '../src/private-dir.ts'
import { sharePathProblem } from '../src/share-path.ts'
import { systemBin } from '../src/sysbin.ts'
import { writeToolsFile } from '../src/tools-digest.ts'
import { buildNuance, type NuanceBuild } from './build-nuance.ts'
import { treeClean } from './build-hub.ts'

export interface InstallerValues { device: string; user: string; pubkey: string; expiry: string; preparedAt: string; build: string;
  shaBinary: string; shaManifest: string; shaTools: string; shaTrialBundle: string; trailer: string; shares: string[] }

type Scalar = Exclude<keyof InstallerValues, 'shares'>

/** Every scalar value's pattern. Each one lands inside bash single quotes, so none may hold a ' (the trailer's class skips it). */
export const INSTALLER_VALUE_RES: Readonly<Record<Scalar, RegExp>> = {
  device: /^[a-z][a-z0-9-]{0,31}$/,
  user: /^[a-z_][a-z0-9._-]{0,31}$/,
  pubkey: /^ssh-ed25519 [A-Za-z0-9+/=]+ collab-air$/,
  expiry: /^\d{8}$/,
  preparedAt: /^\d{14}$/,
  build: /^[0-9a-f]{8}$/,
  shaBinary: /^[0-9a-f]{64}$/,
  shaManifest: /^[0-9a-f]{64}$/,
  shaTools: /^[0-9a-f]{64}$/,
  shaTrialBundle: /^[0-9a-f]{64}$/,
  trailer: TRAILER_RE,
}

const PLACEHOLDERS: Readonly<Record<keyof InstallerValues, string>> = {
  device: '__DEVICE__', user: '__USER__', pubkey: '__PUBKEY__', expiry: '__EXPIRY__', preparedAt: '__PREPARED_AT__', build: '__BUILD__',
  shaBinary: '__SHA_BINARY__', shaManifest: '__SHA_MANIFEST__', shaTools: '__SHA_TOOLS__', shaTrialBundle: '__SHA_TRIAL_BUNDLE__',
  trailer: '__TRAILER__', shares: '__SHARES__',
}

/**
 * Fills the template after checking every value against its pattern, and every share path against the gate's rule
 * (sharePathProblem: absolute and normalised, at most 1019 bytes, no ', !, \ or control character; bash's single quotes
 * carry any such path as it is, and share paths never go into the key line). The template must use every placeholder
 * and no other `__NAME__` word, which is checked on the template alone before any value goes in. The values are then put
 * in by ONE pass over the template (never over the output as it grows), so a value that looks like a placeholder, such as
 * the trailer `X __SHARES__`, is inserted as it is and never filled again. A replacer function inserts them, so `$&` or
 * `$1` in a trailer stays literal.
 */
export function renderInstaller(tmpl: string, v: InstallerValues): string {
  for (const k of Object.keys(INSTALLER_VALUE_RES) as Scalar[]) {
    if (typeof v[k] !== 'string' || !INSTALLER_VALUE_RES[k].test(v[k])) throw new Error(`renderInstaller: ${k} does not match its pattern`)
  }
  if (!Array.isArray(v.shares) || v.shares.length === 0) throw new Error('renderInstaller: no share')
  for (const s of v.shares) {
    const problem = sharePathProblem(s)
    if (problem) throw new Error(`renderInstaller: share ${JSON.stringify(s)} ${problem}`)
  }
  const known = new Set(Object.values(PLACEHOLDERS))
  const used = new Set(tmpl.match(/__[A-Z][A-Z_]*__/g) ?? [])
  for (const word of used) if (!known.has(word)) throw new Error(`renderInstaller: unknown placeholder ${word}`)
  for (const ph of known) if (!used.has(ph)) throw new Error(`renderInstaller: the template has no ${ph}`)
  const valueFor: Record<string, string> = {}
  for (const [k, ph] of Object.entries(PLACEHOLDERS) as Array<[keyof InstallerValues, string]>) {
    valueFor[ph] = k === 'shares' ? v.shares.map((s) => `'${s}'`).join(' ') : v[k] as string
  }
  return tmpl.replace(/__[A-Z][A-Z_]*__/g, (w) => valueFor[w]!)
}

// ---- Task 60: prepare a pairing bundle for one device (spec §10.2 step 1, §4.3, §6.2; R34; K40) ----
// On the Air, from Terminal: make the trial repo (once), the Air's collab key (once), one Nuance binary, the seat tool
// list, and the AirDrop folder ~/collab-bridge-<device>-bundle-<expiry>-<build>/ with a checksum-pinned installer; then
// record the device as `prepared`. Every value that goes into the installer is checked before anything is written.
//   cd / && bun --no-env-file --config=/dev/null <PKG>/scripts/prepare-pairing.ts --device nuance --user macair \
//     --share /Users/macair/Projects/collab-trial=/Users/yuai/Projects/collab-trial --trailer "<trailer>"

export interface PrepareInput { home: string; repo: string; device: string; user: string; shares: Array<{ remote: string; airClone: string }>; trailer: string;
  collabDist: string; bun: string; git: string; now?: number; build?: () => NuanceBuild; gitEnv?: Record<string, string> }

export interface PreparedBundle { bundle: string; command: string; expiry: string; build: string; preparedAt: string; trialCommit: string;
  toolsDigest: string; allowlistEntry: string; older: string[] }

export const PREPARE_USAGE = 'usage: bun --no-env-file --config=/dev/null scripts/prepare-pairing.ts --device <id> --user <u> ' +
  '--share <nuancePath>=<airClone> --trailer <text>'

/** sshd stops taking the key on its expiry-time date (spec §5.1); re-pairing renews it. */
const KEY_LIFETIME_DAYS = 90
const DAY_MS = 86_400_000

/**
 * The trial repo's README.md, part of the base commit on both Macs. README.md is not a control path (§7.3 step 7), so a
 * remote task may edit it like any other in-scope file. The rules are for Air sessions working in ~/Projects/collab-trial.
 */
export const TRIAL_README = [
  'collab-trial: the shared trial folder for cross-device Collab (Phase 1), on the Air and on Nuance.',
  '',
  'Rules for Air sessions here (Phase 1):',
  '',
  '- Never merge, check out, switch to, reset to, rebase onto, restore from or cherry-pick a refs/collab/* ref: remote code never runs on the Air (spec §7.7, R39).',
  '- Never offer a handoff to a remote session: a remote seat cannot answer one in this phase (spec §8, R37).',
  '- Before taking over a task a remote actor holds, run `collab-bridge hub status` and send an addressed note first, or recover only by release or block (spec §9.5).',
  '- Review remote work with `git diff --no-ext-diff --no-textconv <base> refs/collab/<device>/<user>/<mirror_id>/tasks/<task_id>` (spec §7.7).',
  '',
].join('\n')

/** The CLI's four flags; `--share` may repeat. The Air clone is absolute, so the first `=/` ends the Nuance path. */
export function parsePrepareArgs(argv: string[]): Omit<PrepareInput, 'home' | 'repo' | 'collabDist' | 'bun' | 'git'> | { error: string } {
  let device: string | undefined
  let user: string | undefined
  let trailer: string | undefined
  const shares: Array<{ remote: string; airClone: string }> = []
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!
    const value = argv[i + 1]
    if (value === undefined) return { error: `${flag} needs a value` }
    if (flag === '--share') {
      const at = value.indexOf('=/')
      if (at <= 0) return { error: '--share takes <nuancePath>=<airClone>, both absolute' }
      shares.push({ remote: value.slice(0, at), airClone: value.slice(at + 1) })
    } else if (flag === '--device' || flag === '--user' || flag === '--trailer') {
      const seen = flag === '--device' ? device : flag === '--user' ? user : trailer
      if (seen !== undefined) return { error: `${flag} given twice` }
      if (flag === '--device') device = value
      else if (flag === '--user') user = value
      else trailer = value
    } else {
      return { error: `unknown argument ${JSON.stringify(flag)}` }
    }
  }
  if (device === undefined || user === undefined || trailer === undefined || shares.length === 0) return { error: PREPARE_USAGE }
  return { device, user, shares, trailer }
}

const sha256Hex = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')
const fileSha256 = (p: string) => sha256Hex(readFileSync(p))
const firstLine = (s: string) => s.trim().split('\n')[0]?.slice(0, 200) ?? ''
/** writeFileSync's mode applies only to a new file, so an existing one is tightened too. */
function writePrivate(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** `ssh-ed25519 <key> collab-air`, made once with ssh-keygen and never replaced (spec §5.1); both files 0600 in 0700. */
function ensureCollabKey(key: string, home: string): string {
  mkdirPrivate(dirname(key))
  if (!existsSync(key)) {
    const r = spawnSync(systemBin('ssh-keygen'), ['-q', '-t', 'ed25519', '-N', '', '-C', 'collab-air', '-f', key],
      { cwd: '/', env: { HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`prepare: ssh-keygen failed: ${firstLine(r.stderr ?? '')}`)
  }
  if (!existsSync(`${key}.pub`)) throw new Error(`prepare: ${key} exists without its .pub; move both aside to make a new key`)
  chmodSync(key, 0o600)
  chmodSync(`${key}.pub`, 0o600)
  const pub = readFileSync(`${key}.pub`, 'utf8').trim()
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ collab-air$/.test(pub)) throw new Error(`prepare: ${key}.pub is not an ed25519 key with the comment collab-air`)
  return pub
}

/**
 * The Air clone's HEAD. An absent folder becomes a repo on main with one commit (README.md and notes/.gitkeep) whose
 * message ends with the trailer: the shared base on both Macs (§10.2 step 1). An existing repo root is kept as it is;
 * anything else is refused. Hooks and fsmonitor never run (the hub's own git discipline, §7.3).
 */
async function ensureTrialRepo(git: GitRunner, dir: string, trailer: string, env: Record<string, string>): Promise<string> {
  const g = (args: string[]) => git.run(['-C', dir, ...MIRROR_GIT_FLAGS, ...args], { env })
  const head = async () => {
    const r = await g(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    const oid = new TextDecoder().decode(r.stdout).trim()
    return r.code === 0 && OID_RE.test(oid) ? oid : null
  }
  if (existsSync(dir)) {
    const top = await g(['rev-parse', '--show-toplevel'])
    const oid = await head()
    if (top.code !== 0 || new TextDecoder().decode(top.stdout).trim() !== realpathSync(dir) || oid === null) {
      throw new Error(`prepare: ${dir} exists but is not the root of a git repository with a commit; move it aside or name another --share folder`)
    }
    return oid
  }
  mkdirPrivate(dir)
  try {
    const step = async (args: string[]) => {
      const r = await g(args)
      if (r.code !== 0) throw new Error(`prepare: git ${args[0]} in ${dir} failed: ${firstLine(r.stderr)}`)
    }
    await step(['init', '-q', '-b', 'main'])
    writePrivate(join(dir, 'README.md'), TRIAL_README)
    mkdirPrivate(join(dir, 'notes'))
    writePrivate(join(dir, 'notes', '.gitkeep'), '')
    await step(['add', '--', 'README.md', 'notes/.gitkeep'])
    await step(['commit', '-q', '-m', 'collab-trial: the shared base for cross-device Collab (Phase 1)', '-m', trailer])
    const oid = await head()
    if (oid === null) throw new Error(`prepare: the new trial repo in ${dir} has no readable HEAD`)
    return oid
  } catch (e) {
    rmSync(dir, { recursive: true, force: true }) // only the folder this run made
    throw e
  }
}

/** `/Users/<user>/…` as Summon's allowlist writes it, `~/…`; any other absolute path as it is. */
function allowlistPath(remote: string, user: string): string {
  const home = `/Users/${user}/`
  return remote.startsWith(home) ? `~/${remote.slice(home.length)}` : remote
}

/**
 * Everything under `o.home` (the Air's home): the trial repo, ~/.ssh/collab-bridge/collab_<device>_ed25519, the bundle
 * folder and the device file, in that order, each only after every value it depends on was checked. Each new build or
 * expiry gets a bundle folder of its own; older ones are listed, never removed. `build`, `now` and `gitEnv` are for tests.
 */
export async function prepareBundle(o: PrepareInput): Promise<PreparedBundle> {
  // 1. Every value first, by the installer's own patterns (Tasks 20 and 57); nothing is written until they all pass.
  for (const [k, v] of [['device', o.device], ['user', o.user], ['trailer', o.trailer]] as const) {
    if (!INSTALLER_VALUE_RES[k].test(v)) throw new Error(`prepare: --${k} ${JSON.stringify(v)} does not match the installer's pattern`)
  }
  if (o.shares.length !== 1) throw new Error('prepare: Phase 1 pairs exactly one shared folder (R34): give --share once')
  const share = o.shares[0]!
  const why = sharePathProblem(share.remote)
  if (why !== null) throw new Error(`prepare: --share ${JSON.stringify(share.remote)} ${why}`)
  if (!isAbsolute(share.airClone)) throw new Error(`prepare: --share's Air clone ${JSON.stringify(share.airClone)} must be absolute`)
  const now = o.now ?? Date.now()
  const expiry = new Date(now + KEY_LIFETIME_DAYS * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '')
  const preparedAt = preparedStamp(new Date(now).toISOString())
  const tmplPath = join(o.repo, 'packages', 'collab-bridge', 'nuance', 'install.sh.tmpl')
  let tmpl: string
  try { tmpl = readFileSync(tmplPath, 'utf8') } catch { throw new Error(`prepare: no installer template at ${tmplPath}`) }
  // A dry run with stand-in digests: a template that lacks a placeholder or holds an unknown one fails here, before the
  // clone, the key or the build exist, never after.
  const zero = '0'.repeat(64)
  try {
    renderInstaller(tmpl, { device: o.device, user: o.user, pubkey: 'ssh-ed25519 AAAA collab-air', expiry, preparedAt, build: '00000000',
      shaBinary: zero, shaManifest: zero, shaTools: zero, shaTrialBundle: zero, trailer: o.trailer, shares: [share.remote] })
  } catch (e) {
    throw new Error(`prepare: ${e instanceof Error ? e.message : String(e)}`)
  }
  // 2. The binary that ships must be a reviewed commit's (Tasks 63 and 65), so the tree it is built from is clean.
  if (!treeClean(o.repo)) throw new Error(`prepare: ${o.repo} has uncommitted changes; the shipped binary must be a reviewed commit's`)

  // 3. The trial repo, before any bundle is made: its commit becomes the shared base on both Macs.
  const git = airGit({ git: o.git, home: o.home })
  const trialCommit = await ensureTrialRepo(git, share.airClone, o.trailer, o.gitEnv ?? {})
  const airClone = realpathSync(share.airClone)

  // 4. The Air's collab key, once.
  const paths = airPaths(o.home)
  const pubkey = ensureCollabKey(paths.sshKey(o.device), o.home)

  // 5. One Nuance binary, and the seat tool list from the Collab build the hub will run.
  const build = o.build ?? (() => {
    const out = join(o.repo, 'packages', 'collab-bridge', 'dist', 'nuance') // dist/ is git-ignored, so the tree stays clean
    mkdirSync(out, { recursive: true })
    return buildNuance(out)
  })
  const built = build()
  // Collab's tools/list from one probe child on a throwaway journal, never the shared or private one (§10.4 step 3).
  const probe = await probeCollabTools({ bun: o.bun, dist: o.collabDist, tmpRoot: tmpdir() })
  if (!probe.ok) {
    throw new Error(probe.stage === 'start'
      ? `prepare: the Collab probe child did not start: ${probe.failure.lastErrLine ?? `exit ${probe.failure.exitCode}`}`
      : `prepare: ${probe.message}`)
  }
  const list = probe.list
  const unknown = unclassified(list.map((t) => t.name))
  if (unknown.length > 0) throw new Error(`prepare: the Collab build exposes tools the policy table does not classify (policy_unclassified_tool): ${unknown.join(', ')}`)

  // 6. The bundle folder: 0700, the binary 0700, every other file 0600, even when they already exist.
  const folder = `collab-bridge-${o.device}-bundle-${expiry}-${built.build}`
  const bundle = join(o.home, folder)
  mkdirPrivate(bundle)
  chmodSync(bundle, 0o700)
  const binary = join(bundle, 'collab-bridge')
  copyFileSync(built.binary, binary)
  chmodSync(binary, 0o700)
  if (fileSha256(binary) !== built.sha256) throw new Error('prepare: the copied binary does not match its build')
  const tools = writeToolsFile(join(bundle, 'tools.json'), seatTools(list, o.device, o.user))
  const trialBundle = join(bundle, 'collab-trial.bundle')
  rmSync(trialBundle, { force: true })
  // Only the shared base: the branch HEAD names, and HEAD (a detached HEAD bundles just the commit it is on). Never --all: the
  // Air clone also holds Air-only branches, stashes (with untracked files) and refs/collab/*, none of which leaves the Air.
  const sym = await git.run(['-C', airClone, ...MIRROR_GIT_FLAGS, 'symbolic-ref', '-q', 'HEAD'], { env: o.gitEnv ?? {} })
  if (sym.code === null || sym.code > 1) throw new Error(`prepare: git symbolic-ref in ${airClone} failed: ${firstLine(sym.stderr)}`)
  const baseRef = sym.code === 0 ? new TextDecoder().decode(sym.stdout).trim() : null
  if (sym.code === 0 && !/^refs\/heads\/[^\s]+$/.test(baseRef ?? '')) throw new Error(`prepare: HEAD of ${airClone} names ${JSON.stringify(baseRef)}, not a branch`)
  const b = await git.run(['-C', airClone, ...MIRROR_GIT_FLAGS, 'bundle', 'create', '--quiet', trialBundle, ...(baseRef === null ? [] : [baseRef]), 'HEAD'],
    { env: o.gitEnv ?? {}, timeoutMs: 60_000 })
  if (b.code !== 0) throw new Error(`prepare: git bundle create failed: ${firstLine(b.stderr)}`)
  chmodSync(trialBundle, 0o600)
  const files = { 'collab-bridge': built.sha256, 'tools.json': fileSha256(join(bundle, 'tools.json')), 'collab-trial.bundle': fileSha256(trialBundle) }
  const manifest = renderManifest({ device: o.device, build: built.build, prepared: preparedAt, expiry, binary_sha256: built.sha256,
    tools_digest: tools.digest, trial_commit: trialCommit, shares: [share.remote], files })
  writePrivate(join(bundle, 'MANIFEST.txt'), manifest)
  writePrivate(join(bundle, 'collab-install.sh'), renderInstaller(tmpl, { device: o.device, user: o.user, pubkey, expiry, preparedAt,
    build: built.build, shaBinary: files['collab-bridge'], shaManifest: sha256Hex(manifest), shaTools: files['tools.json'],
    shaTrialBundle: files['collab-trial.bundle'], trailer: o.trailer, shares: [share.remote] }))

  // 7. The device file, `prepared`: pin-device fills in the seat key, git, the Summon baselines and each share's gitdir
  //    from hello, and recomputes the mirror id from the realpath Nuance reports (Task 61).
  const device: DeviceFile = {
    v: 1, device: o.device, user: o.user, state: 'prepared', host_alias: `collab-${o.device}`, seat_public: null, bundle_build: built.build,
    key_expiry: expiry, trailer: o.trailer, git: null, summon: null,
    shares: [{ remote_realpath: share.remote, remote_gitdir: null, air_clone: airClone, mirror_id: mirrorIdOf(share.remote),
      mirror_worktree_id: null, workspace_id: null, caps: { ...DEFAULT_CAPS } }],
    prepared_at: new Date(now).toISOString(), paired_at: null,
  }
  mkdirPrivate(paths.devicesDir)
  const file = paths.deviceFile(o.device)
  // The lock updateDevice takes, so a running hub never writes over it. A re-prepare (the 90-day renewal) starts the file over
  // as `prepared`, but what Collab and Ai settled for this very mirror is not the bundle's to reset: the workspace id and worktree
  // id the first session_start confirmed (Task 51), and the share's caps. They are kept for the same user, Nuance folder and Air
  // clone (one mirror directory), and for no other.
  withLock(file, () => {
    const prev = readDevice(file)
    const same = prev !== null && prev.device === o.device && prev.user === o.user
      ? prev.shares.find((s) => s.remote_realpath === share.remote && s.air_clone === airClone) : undefined
    writeDevice(file, same === undefined ? device : { ...device, shares: device.shares.map((s) => ({ ...s,
      mirror_worktree_id: same.mirror_worktree_id, workspace_id: same.workspace_id, caps: { ...same.caps } })) })
  })

  const older = readdirSync(o.home).filter((n) => n.startsWith(`collab-bridge-${o.device}-bundle-`) && n !== folder)
    // lstat: a link, even a dangling one, is not a bundle folder
    .map((n) => join(o.home, n)).filter((p) => lstatSync(p).isDirectory()).sort()
  return {
    bundle, command: `bash ~/Downloads/${folder}/collab-install.sh`, expiry, build: built.build, preparedAt, trialCommit,
    toolsDigest: tools.digest, allowlistEntry: `  - path: ${allowlistPath(share.remote, o.user)}\n    access: edit`, older,
  }
}

/** What the script prints: the bundle, its expiry, the two lines Yu adds under `folders:` on the device, and the run line. */
export function readyText(r: PreparedBundle): string {
  const day = `${r.expiry.slice(0, 4)}-${r.expiry.slice(4, 6)}-${r.expiry.slice(6)}`
  const older = r.older.length === 0 ? [] : [`older bundles here are not needed any more; to remove them: rm -rf ${r.older.map((p) => `'${p}'`).join(' ')}`]
  return [
    `bundle ready: ${r.bundle} (build ${r.build}, prepared ${r.preparedAt} UTC)`,
    `the collab key expires ${day} (${r.expiry}); pair again before then.`,
    `trial commit ${r.trialCommit}; seat tool list ${r.toolsDigest}`,
    'At the device, run `open -e ~/.config/summon/allowlist.yaml` and add these two lines under `folders:`, indented like the entries there:',
    r.allowlistEntry,
    `AirDrop the folder ${basename(r.bundle)} to the device, then run there in Terminal:`,
    `  ${r.command}`,
    ...older,
    '',
  ].join('\n')
}

async function prepareMain(argv: string[]): Promise<number> {
  const args = parsePrepareArgs(argv)
  if ('error' in args) {
    process.stderr.write(`✗ ${args.error}\n${PREPARE_USAGE}\n`)
    return 2
  }
  try {
    const r = await prepareBundle({ ...args, home: homeOf(), repo: realpathSync(join(import.meta.dir, '..', '..', '..')), collabDist: collabDist(),
      bun: systemBin('bun'), git: systemBin('git') })
    process.stdout.write(readyText(r))
    return 0
  } catch (e) {
    process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

if (import.meta.main) void prepareMain(process.argv.slice(2)).then((code) => process.exit(code))
