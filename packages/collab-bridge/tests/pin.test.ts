import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { airGit } from '../src/air/git.ts'
import { mirrorHead, mirrorIdOf, mirrorWorkspaceId, syncedOid, type MirrorDeps, type MirrorSpec } from '../src/air/mirror.ts'
import { targetOfConfig } from '../src/air/ssh.ts'
import { AIR_LEDGER_KEYS, appendLedger } from '../src/ledger.ts'
import type { Hello } from '../src/nuance/gate.ts'
import { hasLazyFetchGuard, parseGitVersion, sha256File, type ResolvedGit } from '../src/nuance/git-resolve.ts'
import { renderInstalled, summonKeySha256, writeShares } from '../src/nuance/installed.ts'
import { readSeatPublicHex, writeSeatKeyIfAbsent } from '../src/nuance/seatkey.ts'
import { airPaths, nuancePaths, type AirPaths } from '../src/paths.ts'
import { checkHello, collabSshConfig, parseHello, pinDevice, pinnedText, summonPinLine, writeCollabSsh } from '../scripts/pin-device.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, makeRepo, modeOf, REAL_GIT, REAL_HOME, repoGit, temp, testEnv } from './helpers.ts'
import { startCollabSession } from './mcp-harness.ts'

afterEach(cleanupTmps)

const T = 60_000 // every pin spawns the source gate through the fake ssh, twice (hello, then the first fetch)
/** hello's user is getpwuid's name (F3): in a test, the user running it. */
const USER = basename(REAL_HOME)
const BUILD = 'abcdef01'
const EXPIRY = '20270111'
const PIN_AT = Date.UTC(2026, 9, 13, 15, 0, 0)
const SUMMON_PIN = 'summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyExampleForCollabBridgePinTests1'
const SUMMON_AIR_LINE = 'restrict,from="192.168.50.0/24",expiry-time="20270110",command="/x/summon-gatekeeper" ssh-ed25519 AAAASUMMON summon-air'

/** The Air's git as "Nuance's recorded git": its Cellar realpath, as `install check` records it (Task 20). */
const NUANCE_GIT: ResolvedGit = (() => {
  const path = realpathSync(REAL_GIT)
  const v = parseGitVersion(Bun.spawnSync([path, '--version'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString())!
  return { path, version: v.version, sha256: sha256File(path), guard: hasLazyFetchGuard(path), apple: v.apple }
})()

interface PinWorld { air: string; paths: AirPaths; airClone: string; base: string; nuance: string; share: string; fake: FakeSsh; deps: MirrorDeps; deviceText: string }

/**
 * An Air home with Summon's pin, the trial clone and a `prepared` device file, and a "Nuance" home whose shared folder
 * is a clone of it with INSTALLED, the seat key, shares.json, authorized_keys and the Summon allowlist, as the install
 * leaves them. The Air side reaches the real gate from source through the fake ssh.
 */
function pinWorld(o: { related?: boolean; device?: Partial<DeviceFile> } = {}): PinWorld {
  const air = temp('cb-pin-air-')
  const paths = airPaths(air)
  const airClone = join(air, 'Projects', 'collab-trial')
  const base = makeRepo(airClone)
  mkdirSync(join(air, '.ssh', 'summon'), { recursive: true, mode: 0o700 })
  writeFileSync(paths.summonKnownHosts, `${SUMMON_PIN}\n`, { mode: 0o600 })
  const nuance = temp('cb-pin-nuance-')
  const share = join(nuance, 'Projects', 'collab-trial')
  if (o.related === false) makeRepo(share, { 'README.md': 'another repo\n' })
  else {
    mkdirSync(join(nuance, 'Projects'), { recursive: true })
    repoGit(join(nuance, 'Projects'), ['clone', '-q', airClone, 'collab-trial'])
  }
  const np = nuancePaths(nuance)
  mkdirSync(join(nuance, '.ssh'), { recursive: true, mode: 0o700 })
  writeFileSync(np.authorizedKeys, `${SUMMON_AIR_LINE}\n`, { mode: 0o600 })
  mkdirSync(np.share, { recursive: true, mode: 0o700 })
  writeFileSync(np.installed, renderInstalled({
    device: 'nuance', build: BUILD, prepared: '20261013120000', expiry: EXPIRY, binary_sha256: 'a'.repeat(64), tools_seed: 'b'.repeat(64),
    git: NUANCE_GIT, summon_key_sha256: summonKeySha256(`${SUMMON_AIR_LINE}\n`), summon_dropin_stat: '1 2 3 0 600',
    claude_version: '2.1.296 (Claude Code)', installed_at: '2026-10-13T12:00:00.000Z',
  }), { mode: 0o600 })
  writeSeatKeyIfAbsent(np)
  writeShares(np, [{ realpath: share, gitdir: join(share, '.git') }])
  mkdirSync(join(nuance, '.config', 'summon'), { recursive: true })
  writeFileSync(np.summonAllowlist, ['version: 1', 'device: nuance', 'peers: [air]', 'runtimes:', '  - id: claude', '    models:',
    '      - model: sonnet', 'folders:', '  - path: ~/Projects', '    access: review', '  - path: ~/Projects/collab-trial', '    access: edit',
    'limits:', '  max_concurrent: 1', '  starts_per_hour: 6', '  job_timeout_max: 30m', ''].join('\n'))
  const prepared: DeviceFile = {
    v: 1, device: 'nuance', user: USER, state: 'prepared', host_alias: 'collab-nuance', seat_public: null, bundle_build: BUILD,
    key_expiry: EXPIRY, trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>', git: null, summon: null,
    shares: [{ remote_realpath: share, remote_gitdir: null, air_clone: airClone, mirror_id: mirrorIdOf(share), mirror_worktree_id: null,
      workspace_id: null, caps: { ...DEFAULT_CAPS } }],
    prepared_at: '2026-10-13T12:00:00.000Z', paired_at: null, ...o.device,
  }
  writeDevice(paths.deviceFile('nuance'), prepared)
  const fake = makeFakeSsh({ nuanceHome: nuance, target: gateFromSource(), env: testEnv(nuance) })
  const deps: MirrorDeps = {
    git: airGit({ git: REAL_GIT, home: air }), sshBin: fake.bin, sshConfig: paths.sshConfig, alias: 'collab-nuance',
    freeBytes: () => 1e15, fetchedToday: () => 0, ledger: (f) => { appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) },
  }
  return { air, paths, airClone, base, nuance, share, fake, deps, deviceText: readFileSync(paths.deviceFile('nuance'), 'utf8') }
}

const pin = (w: PinWorld) => pinDevice({ paths: w.paths, device: 'nuance', ssh: w.fake.bin, mirrorDeps: w.deps, now: () => new Date(PIN_AT) })
const specOf = (w: PinWorld): MirrorSpec => {
  const mirrorId = mirrorIdOf(w.share)
  return { device: 'nuance', user: USER, mirrorId, mirrorPath: w.paths.mirrorDir('nuance', USER, mirrorId), airClone: w.airClone,
    remoteGitdir: join(w.share, '.git'), caps: DEFAULT_CAPS }
}
/** What the gate's hello prints for this world, read through the fake ssh as pin-device dials it. */
function helloOf(w: PinWorld): Hello {
  const r = Bun.spawnSync([w.fake.bin, '-F', w.paths.sshConfig, 'collab-nuance', 'hello'], { cwd: '/', env: { HOME: w.air, PATH: '/usr/bin:/bin' } })
  expect(r.exitCode).toBe(0)
  return parseHello(r.stdout.toString().trim())!
}

describe('the ssh config and the pinned host key (spec §5.6)', () => {
  test("copies Summon's pinned line and writes the exact config with absolute paths", async () => {
    expect(collabSshConfig({ home: '/Users/yuai', device: 'nuance', user: 'macair' })).toBe([
      'Host collab-nuance', '  HostName nuance.local', '  AddressFamily inet', '  User macair',
      '  IdentityFile /Users/yuai/.ssh/collab-bridge/collab_nuance_ed25519', '  IdentitiesOnly yes', '  IdentityAgent none',
      '  HostKeyAlias summon-nuance', '  UserKnownHostsFile /Users/yuai/.ssh/collab-bridge/known_hosts', '  GlobalKnownHostsFile /dev/null',
      '  StrictHostKeyChecking yes', '  UpdateHostKeys no', '  BatchMode yes', '  ConnectTimeout 8', '  ServerAliveInterval 15',
      '  ServerAliveCountMax 2', '  RequestTTY no', '  ForwardAgent no', '  ForwardX11 no', '  ClearAllForwardings yes',
      '  ControlMaster no', '  ControlPath none', '',
    ].join('\n'))
    for (const bad of [{ home: '/Users/yu ai', device: 'nuance', user: 'macair' }, { home: 'Users/yuai', device: 'nuance', user: 'macair' },
      { home: '/Users/yuai', device: 'Nuance', user: 'macair' }, { home: '/Users/yuai', device: 'nuance', user: 'mac air' }]) {
      expect(() => collabSshConfig(bad)).toThrow('pin:')
    }
    expect(summonPinLine(`${SUMMON_PIN}\n`)).toBe(SUMMON_PIN)
    expect(summonPinLine(`# pinned by Summon\n${SUMMON_PIN}\r\n`)).toBe(SUMMON_PIN)
    for (const text of ['', `${SUMMON_PIN}\n${SUMMON_PIN}x\n`, 'summon-zerone ssh-ed25519 AAAAC3Nza\n', 'summon-nuance ssh-rsa AAAAB3Nza\n',
      'summon-nuance ssh-ed25519 AAAA$bad\n', `${SUMMON_PIN} root@Nuance\n`]) expect(summonPinLine(text)).toBeNull()

    const w = pinWorld()
    const r = await pin(w)
    expect(r.ok).toBe(true)
    expect(readFileSync(w.paths.knownHosts, 'utf8')).toBe(`${SUMMON_PIN}\n`)
    expect(readFileSync(w.paths.sshConfig, 'utf8')).toBe(collabSshConfig({ home: w.air, device: 'nuance', user: USER }))
    expect(targetOfConfig(readFileSync(w.paths.sshConfig, 'utf8'), 'collab-nuance'))
      .toEqual({ host: 'nuance.local', user: USER, identityFile: w.paths.sshKey('nuance') })
    expect([modeOf(w.paths.sshDir), modeOf(w.paths.sshConfig), modeOf(w.paths.knownHosts)]).toEqual([0o700, 0o600, 0o600])
    // hello first, with the config's absolute path; then the first fetch through the gate's upload-pack form.
    expect(w.fake.calls()[0]).toEqual(['-F', w.paths.sshConfig, 'collab-nuance', 'hello'])
    expect(w.fake.calls().map((c) => c.at(-1))).toEqual(['hello', `git-upload-pack '${w.share}/.git'`])
    // A Summon pin that is missing or not one ed25519 line stops before any dial.
    const v = pinWorld()
    writeFileSync(v.paths.summonKnownHosts, 'summon-nuance ssh-rsa AAAAB3Nza\n')
    expect(await pin(v)).toEqual({ ok: false, problems: [expect.stringContaining("Summon's pin")] })
    expect(v.fake.calls()).toEqual([])
    expect(() => writeCollabSsh({ paths: v.paths, device: 'nuance', user: USER, summonKnownHosts: join(v.air, 'no-such-file') })).toThrow("Summon's pin")
  }, T)
})

describe('pinDevice (spec §10.2 step 2)', () => {
  test("records the device as paired from hello, with each share's remote gitdir and mirror id", async () => {
    const w = pinWorld()
    const r = await pin(w)
    if (!r.ok) throw new Error(r.problems.join('; '))
    const d = readDevice(w.paths.deviceFile('nuance'))!
    expect(r.device).toEqual(d)
    expect(d.state).toBe('paired')
    expect(d.seat_public).toBe(readSeatPublicHex(nuancePaths(w.nuance))!)
    expect(d.git).toEqual(NUANCE_GIT)
    expect(d.summon).toEqual({ key_sha256: summonKeySha256(`${SUMMON_AIR_LINE}\n`), dropin_stat: '1 2 3 0 600' })
    expect(d.paired_at).toBe(new Date(PIN_AT).toISOString())
    expect([d.bundle_build, d.key_expiry, d.prepared_at]).toEqual([BUILD, EXPIRY, '2026-10-13T12:00:00.000Z'])
    expect(d.shares).toHaveLength(1)
    expect(d.shares[0]).toMatchObject({ remote_realpath: w.share, remote_gitdir: join(w.share, '.git'), air_clone: w.airClone,
      mirror_id: mirrorIdOf(w.share), mirror_worktree_id: null })
    expect(modeOf(w.paths.deviceFile('nuance'))).toBe(0o600)
    expect(pinnedText(d, w.paths)).toContain(`paired: nuance (${USER}), build ${BUILD}, the collab key expires 2027-01-11\n`)
    expect(pinnedText(d, w.paths)).toContain(`mirror ${w.paths.mirrorDir('nuance', USER, mirrorIdOf(w.share))}`)
  }, T)

  test("records the share's derived workspace id", async () => {
    const w = pinWorld()
    const r = await pin(w)
    if (!r.ok) throw new Error(r.problems.join('; '))
    const ws = r.device.shares[0]!.workspace_id
    expect(ws).toMatch(/^ws_[0-9a-f]{24}$/)
    expect(ws).toBe((await mirrorWorkspaceId(specOf(w), w.deps))!)
    // The id a real Collab session rooted at the mirror reports, on a temp shared journal (P55).
    const s = await startCollabSession({ journal: w.paths.sharedJournal, home: w.air, root: specOf(w).mirrorPath, actor: 'pin-test' })
    expect(s.workspaceId).toBe(ws!)
  }, T)

  test('creates, syncs and locks the mirror before any session can bind', async () => {
    const w = pinWorld()
    const r = await pin(w)
    expect(r.ok).toBe(true)
    const spec = specOf(w)
    expect(repoGit(w.airClone, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${spec.mirrorPath}\nHEAD ${w.base}\ndetached\nlocked collab-bridge mirror`)
    expect([await mirrorHead(spec, w.deps), await syncedOid(spec, w.deps)]).toEqual([w.base, w.base])
    // A device whose repository shares no history with the Air clone gets no mirror and stays prepared: the hub dials
    // only paired devices, so no session can ever bind to a missing or unborn mirror (§7.1, K17).
    const m = pinWorld({ related: false })
    const bad = await pin(m)
    expect(bad).toEqual({ ok: false, problems: [expect.stringContaining('repo_mismatch')] })
    expect(readFileSync(m.paths.deviceFile('nuance'), 'utf8')).toBe(m.deviceText)
    expect(existsSync(specOf(m).mirrorPath)).toBe(false)
  }, T)

  test('refuses a hello whose user, build or shares differ, or whose zshenv is noisy', async () => {
    const w = pinWorld()
    writeCollabSsh({ paths: w.paths, device: 'nuance', user: USER, summonKnownHosts: w.paths.summonKnownHosts })
    const h = helloOf(w)
    const d = readDevice(w.paths.deviceFile('nuance'))!
    expect(checkHello(h, d)).toEqual([])
    expect(checkHello(h, { ...d, user: 'someone' })).toEqual([expect.stringContaining('user')])
    expect(checkHello(h, { ...d, bundle_build: '00000000' })).toEqual([expect.stringContaining('build')])
    expect(checkHello(h, { ...d, key_expiry: '20270112' })).toEqual([expect.stringContaining('expir')])
    const other = { ...d.shares[0]!, remote_realpath: join(w.nuance, 'Projects', 'other'), mirror_id: mirrorIdOf(join(w.nuance, 'Projects', 'other')) }
    expect(checkHello(h, { ...d, shares: [other] })).toEqual([expect.stringContaining('not among'), expect.stringContaining('did not prepare')])
    expect(checkHello({ ...h, shares: [{ realpath: w.share, gitdir: "/x/it's.git" }] }, d)).toEqual([expect.stringContaining('gitdir')])
    expect(checkHello({ ...h, seat_public: '0'.repeat(64) }, d)).toEqual([expect.stringContaining('seat')])
    expect(checkHello({ ...h, device: 'zerone' }, d)).toEqual([expect.stringContaining('device')])
    // parseHello takes exactly hello's fields with their forms, and nothing else.
    expect(parseHello(JSON.stringify(h))).toEqual(h)
    for (const broken of [{ ...h, extra: 1 }, { ...h, v: 2 }, { ...h, build: 'ABCDEF01' }, { ...h, shares: 'x' }, { ...h, zshenv_clean: 'yes' },
      { ...h, git: { ...h.git, sha256: 'x' } }, { ...h, summon: { key_sha256: 'a'.repeat(64), dropin_stat: 'later' } }, { ...h, clock: 'now' }]) {
      expect(parseHello(JSON.stringify(broken))).toBeNull()
    }
    expect(parseHello('not json')).toBeNull()
    // Through the dial: a ~/.zshenv that prints at login makes hello say zshenv_clean false, and nothing is recorded.
    const z = pinWorld()
    writeFileSync(join(z.nuance, '.zshenv'), 'echo hello from zshenv\n')
    expect(await pin(z)).toEqual({ ok: false, problems: [expect.stringContaining('zshenv')] })
    expect(readFileSync(z.paths.deviceFile('nuance'), 'utf8')).toBe(z.deviceText)
    // A user other than the one prepared is refused the same way.
    const u = pinWorld({ device: { user: 'someone' } })
    expect(await pin(u)).toEqual({ ok: false, problems: [expect.stringContaining('user')] })
    expect(existsSync(specOf(u).mirrorPath)).toBe(false)
  }, T)

  test('refuses a git without the guard', async () => {
    const w = pinWorld()
    writeCollabSsh({ paths: w.paths, device: 'nuance', user: USER, summonKnownHosts: w.paths.summonKnownHosts })
    const h = helloOf(w)
    const d = readDevice(w.paths.deviceFile('nuance'))!
    const apple = { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'c'.repeat(64), apple: true }
    expect(checkHello({ ...h, git: { ...apple, guard: true } }, d)).toEqual([])
    expect(checkHello({ ...h, git: { ...apple, guard: false } }, d)).toEqual([expect.stringContaining('guard')])
    expect(checkHello({ ...h, git: { ...h.git, version: '2.44.0', apple: false, guard: true } }, d)).toEqual([expect.stringContaining('guard')])
  }, T)

  test('an ssh failure is reported with its class and nothing is written', async () => {
    const w = pinWorld()
    w.fake.setFail255('ssh: connect to host nuance.local port 22: No route to host\r\n')
    expect(await pin(w)).toEqual({ ok: false, problems: ['ssh: unreachable (no_route): ssh: connect to host nuance.local port 22: No route to host'] })
    expect(readFileSync(w.paths.deviceFile('nuance'), 'utf8')).toBe(w.deviceText)
    expect(existsSync(w.paths.mirrorsRoot)).toBe(false)
    expect(repoGit(w.airClone, ['for-each-ref', 'refs/collab'])).toBe('')
    // The gate's own refusal (no INSTALLED on the device) is reported with its line, and nothing is written either.
    const g = pinWorld()
    rmSync(nuancePaths(g.nuance).installed)
    const r = await pin(g)
    expect(r).toEqual({ ok: false, problems: [expect.stringMatching(/^the device's gate refused hello \(exit 64\): collab-bridge gate: hello: INSTALLED/)] })
    expect(readFileSync(g.paths.deviceFile('nuance'), 'utf8')).toBe(g.deviceText)
    // An unpaired or missing device file is refused before any dial.
    const n = pinWorld({ device: { state: 'unpaired' } })
    expect(await pin(n)).toEqual({ ok: false, problems: [expect.stringContaining('unpaired')] })
    rmSync(n.paths.deviceFile('nuance'))
    expect(await pin(n)).toEqual({ ok: false, problems: [expect.stringContaining('prepare-pairing')] })
    expect(n.fake.calls()).toEqual([])
  }, T)
})
