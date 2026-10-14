// One whole Phase 1 world on this Mac (spec §12.1, §12.3 in miniature): a temp "Air" home and a temp "Nuance" home, the
// bundle prepare-pairing makes, the real bash installer and its verbs at "Nuance", pin-device through the fake ssh (so
// the mirror exists), and a hub spawned from source exactly as `collab-bridge hub run` runs. Nothing here touches this
// Mac's ~/.ssh, launchd, the network or either real journal: ssh is the fake (Task 11), the hub's own TCP probe goes to
// 127.0.0.1, and every path is under a temp root. A shared fixture lives here, never in a *.test.ts (Summon ruling R1).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readDeviceStatus, readHubStatus } from '../src/air/status.ts'
import { airGit } from '../src/air/git.ts'
import { liveMirrorDeps } from '../src/air/mirror.ts'
import { readLedger, type LedgerEntry } from '../src/ledger.ts'
import { writeFileDurable } from '../src/native.ts'
import { readPipeRecords } from '../src/nuance/pipe-record.ts'
import { readRelayStatus } from '../src/nuance/relay.ts'
import { airPaths, nuancePaths, type AirPaths, type NuancePaths } from '../src/paths.ts'
import { pidAlive } from '../src/proc.ts'
import type { NuanceBuild } from '../scripts/build-nuance.ts'
import { pinDevice } from '../scripts/pin-device.ts'
import { prepareBundle } from '../scripts/prepare-pairing.ts'
import { makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { COLLAB_DIST, makeRepo, PKG, REAL_GIT, REAL_HOME, repoGit, sha256File, shortSockRoot, temp, testDropin, testEnv } from './helpers.ts'
import { runInstaller, summonReadyHome } from './install-fixtures.ts'
import { collabHarness, stdioHarness, type StdioHarness } from './mcp-harness.ts'

export interface World { air: string; nuance: string; airClone: string; nuanceShare: string; sockRoot: string; fakeSsh: FakeSsh;
  startHub(): Promise<void>; killHub(signal?: 'SIGKILL' | 'SIGTERM'): Promise<void>; pipe(): StdioHarness; tap(): Promise<string | null>;
  airSession(): StdioHarness; commitOnNuance(files: Record<string, string>, message: string): string; dropLink(): Promise<void>;
  hubLedger(): LedgerEntry[]; nuanceLedger(): LedgerEntry[]; close(): Promise<void>
  pipeStates(): string[] }

/** hello's user is getpwuid's name (F3) and the installer refuses a bundle prepared for another user: this Mac's. */
export const WORLD_USER = basename(REAL_HOME)
export const WORLD_TRAILER = 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>'
/** At 0.01 a session_start's 600 ms deadline is shorter than one Collab child's start, so the world runs at 0.1 (P33). */
export const WORLD_TIME_SCALE = 0.1
const SUMMON_PIN = 'summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorldHostKeyForTheCollabBridgeEndToEndTest'
/** The trial repo's commit gets a test identity: the temp Air home has no ~/.gitconfig. */
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Collab World', GIT_AUTHOR_EMAIL: 'world@collab-bridge.invalid',
  GIT_COMMITTER_NAME: 'Collab World', GIT_COMMITTER_EMAIL: 'world@collab-bridge.invalid' }

/** Polls `ok` every 20 ms; throws naming `what` after `ms`. */
export async function waitFor(what: string, ok: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`world: timed out after ${ms} ms waiting for ${what}`)
    await Bun.sleep(20)
  }
}

/**
 * The hub's ps: the real /bin/ps with only the caller's parent shown as launchd (pid 1), the body of Task 53's launchdPs.
 * The hub's start check (Task 53) refuses a harness ancestor, and this suite runs under Claude; every pid and lstart the
 * hub reads for its children stays real (P43).
 */
function launchdPs(dir: string): string {
  const p = join(dir, 'ps')
  writeFileSync(p, ['#!/bin/bash', 'set -o pipefail', `LC_ALL=C /bin/ps "$@" | /usr/bin/awk -v me="$PPID" '$1 == me { $2 = 1 } { print }'`, ''].join('\n'))
  chmodSync(p, 0o755)
  return p
}

/**
 * pin-device's ssh config with its one `HostName nuance.local` line pointed at 127.0.0.1, so the hub's own TCP probe (P56)
 * stays on this Mac. Keeps the line's indentation; throws unless exactly one line matched, because a config text that
 * pin-device changed would otherwise leave the probe going to the real nuance.local:22 with every test still green.
 */
export function loopbackHostName(config: string): string {
  let hits = 0
  const out = config.replace(/^(\s*)HostName nuance\.local$/gm, (_line, indent: string) => { hits++; return `${indent}HostName 127.0.0.1` })
  if (hits !== 1) throw new Error(`world: expected exactly one "HostName nuance.local" line in the ssh config pin-device wrote, found ${hits}; the hub's TCP probe would not stay on this Mac`)
  return out
}

/** A clean git repo standing in for the bridge worktree: prepare reads the installer template from it and needs it clean. */
function bridgeRepo(): string {
  const repo = temp('cb-world-repo-')
  makeRepo(repo, { 'packages/collab-bridge/nuance/install.sh.tmpl': readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8') })
  return repo
}

/** The bundle's program in source mode: the Nuance entry from source, as the installed binary would run (Task 57's shape). */
function sourceBuild(): NuanceBuild {
  const binary = join(temp('cb-world-build-'), 'collab-bridge')
  writeFileSync(binary, `#!/bin/bash\nexec '${process.execPath}' --no-env-file --config=/dev/null '${PKG}/src/nuance/main.ts' "$@"\n`, { mode: 0o755 })
  const sha256 = sha256File(binary)
  return { binary, sha256, build: sha256.slice(0, 8) }
}

export async function makeWorld(o: { compiled?: NuanceBuild; timeScale?: number } = {}): Promise<World> {
  const scale = String(o.timeScale ?? WORLD_TIME_SCALE)
  const air = temp('cb-world-air-')
  const nuance = temp('cb-world-nuance-')
  const sockRoot = shortSockRoot()
  const ap: AirPaths = airPaths(air)
  const airClone = join(air, 'Projects', 'collab-trial')
  const nuanceShare = join(nuance, 'Projects', 'collab-trial')
  // One socket root for the relay, the pipes and the taps; the time scale for every link deadline (P33).
  const nuanceEnv = testEnv(nuance, { COLLAB_BRIDGE_SOCK_ROOT: sockRoot, COLLAB_BRIDGE_TEST_TIME_SCALE: scale })
  const np: NuancePaths = nuancePaths(nuance, nuanceEnv)

  mkdirSync(join(air, '.ssh', 'summon'), { recursive: true, mode: 0o700 })
  writeFileSync(ap.summonKnownHosts, `${SUMMON_PIN}\n`, { mode: 0o600 })
  summonReadyHome({ home: nuance }) // Task 55: Summon installed and live, Y1's allowlist, ~/Projects without the trial folder

  // §10.2 step 1 (Task 60): the trial repo, the collab key, the bundle and the device file, prepared.
  const prepared = await prepareBundle({ home: air, repo: bridgeRepo(), device: 'nuance', user: WORLD_USER,
    shares: [{ remote: nuanceShare, airClone }], trailer: WORLD_TRAILER, collabDist: COLLAB_DIST, bun: process.execPath, git: REAL_GIT,
    build: o.compiled ? () => o.compiled! : sourceBuild, gitEnv: GIT_ENV })
  // §10.3 (Task 57): the real installer and its verbs at "Nuance", two y's; it clones the trial folder from the bundle.
  const inst = runInstaller(prepared.bundle, nuance, { answers: 'y\ny\n', extraEnv: { COLLAB_BRIDGE_SOCK_ROOT: sockRoot } })
  if (inst.code !== 0 || !/(^|\n)Done\b/.test(inst.stdout)) throw new Error(`world: the installer stopped (${inst.code}):\n${inst.stdout}\n${inst.stderr}`)
  // sshd's forced command runs the installed program: the wrapper (source) or the compiled binary.
  const fakeSsh = makeFakeSsh({ nuanceHome: nuance, target: [np.binary, 'gate'], env: nuanceEnv })
  // §10.2 step 2 (Task 61): hello through the fake ssh; the mirror is created, synced and locked here.
  const pinned = await pinDevice({ paths: ap, device: 'nuance', ssh: fakeSsh.bin, now: () => new Date(),
    mirrorDeps: { ...liveMirrorDeps({ paths: ap, git: airGit({ git: REAL_GIT, home: air }), ssh: fakeSsh.bin, alias: 'collab-nuance' }), freeBytes: () => 1e15 } })
  if (!pinned.ok) throw new Error(`world: pin-device refused: ${pinned.problems.join('; ')}`)
  // The hub's own TCP connect before each dial loop (P56) must stay on this Mac: only HostName changes; the fake ssh
  // ignores it, and the dial is still `ssh -F <config> collab-nuance relay 1 <nonce>`.
  writeFileDurable(ap.sshConfig, loopbackHostName(readFileSync(ap.sshConfig, 'utf8')), 0o600)

  // The hub: from source, as `collab-bridge hub run`, the fake ssh as its ssh, the real ps for its pid checks with its
  // parent shown as launchd, so its start check passes under a harness (Task 53, P43).
  const hubEnv = testEnv(air, { COLLAB_BRIDGE_BIN_SSH: fakeSsh.bin, COLLAB_BRIDGE_BIN_PS: launchdPs(temp('cb-world-ps-')), COLLAB_BRIDGE_TEST_TIME_SCALE: scale })
  let hub: ReturnType<typeof Bun.spawn> | null = null
  let hubErr = ''
  const harnesses: StdioHarness[] = []
  const nuanceArgv = (verb: string[]) => [np.binary, ...verb]

  const killHub = async (signal: 'SIGKILL' | 'SIGTERM' = 'SIGTERM') => {
    if (hub === null) return
    const h = hub
    hub = null
    const relay = readRelayStatus(np)
    h.kill(signal)
    const gone = await Promise.race([h.exited.then(() => true), Bun.sleep(20_000).then(() => false)])
    if (!gone) { h.kill('SIGKILL'); await h.exited }
    // The relay's stdin is the hub's ssh: it exits on EOF, and a SIGKILL of the hub reaches it that way.
    if (relay && pidAlive(relay.pid)) await waitFor('the old relay to exit', () => !pidAlive(relay.pid), 10_000)
  }

  return {
    air, nuance, airClone, nuanceShare, sockRoot, fakeSsh,

    async startHub() {
      if (hub !== null) throw new Error('world: the hub is already running')
      const before = readRelayStatus(np)?.pid ?? null
      const h = Bun.spawn([process.execPath, '--no-env-file', '--config=/dev/null', join(PKG, 'bin', 'collab-bridge.ts'), 'hub', 'run'],
        { cwd: '/', env: hubEnv, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
      hub = h
      void (async () => { for await (const c of h.stderr as ReadableStream<Uint8Array>) hubErr += new TextDecoder().decode(c) })()
      try {
        await waitFor('the hub to bring nuance up', () => {
          if (h.exitCode !== null) throw new Error(`the hub exited ${h.exitCode}`)
          const r = readRelayStatus(np)
          return readDeviceStatus(ap, 'nuance')?.word === 'up' && r !== null && r.pid !== before && pidAlive(r.pid)
        }, 30_000)
      } catch (e) {
        throw new Error(`world: ${(e as Error).message}\nhub status: ${JSON.stringify(readHubStatus(ap))}\nhub stderr:\n${hubErr.slice(-4000)}`)
      }
    },

    killHub,

    pipe() {
      // Claude starts the pipe in the shared folder; the preload's ps stub (P43) gives it the claude host 4100 and a tty.
      const h = stdioHarness({ argv: nuanceArgv(['pipe']), env: { ...nuanceEnv, CLAUDE_CODE_ENTRYPOINT: 'cli' }, cwd: nuanceShare })
      harnesses.push(h)
      return h
    },

    async tap() {
      const p = Bun.spawn(nuanceArgv(['tap', '--host', 'claude']), { cwd: nuanceShare, env: nuanceEnv, stdout: 'pipe', stderr: 'ignore',
        stdin: new Blob([JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'the next prompt' })]) })
      const [out, code] = await Promise.all([new Response(p.stdout as ReadableStream<Uint8Array>).text(), p.exited])
      if (code !== 0) throw new Error(`world: the tap exited ${code}`)
      const line = out.trim()
      return line === '' ? null : line
    },

    airSession() {
      // An Air session in the trial folder: the shared journal, the hub's way (§10.2 step 4); the caller starts it.
      const h = collabHarness({ journal: ap.sharedJournal, home: air })
      harnesses.push(h)
      return h
    },

    commitOnNuance(files, message) {
      // As the Nuance agent commits: only its own files, never `add -A`.
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(nuanceShare, rel)), { recursive: true })
        writeFileSync(join(nuanceShare, rel), text)
      }
      repoGit(nuanceShare, ['add', '--', ...Object.keys(files)])
      repoGit(nuanceShare, ['-c', 'user.name=Nuance Seat', '-c', 'user.email=seat@collab-bridge.invalid', 'commit', '-q', '-m', message])
      return repoGit(nuanceShare, ['rev-parse', 'HEAD'])
    },

    async dropLink() {
      // The Air's Wi-Fi goes off: the relay dies with its socket left behind (F8), and every redial fails until the
      // caller clears fakeSsh.setFail255 again. Resolves once the pipe has seen the link go.
      const relay = readRelayStatus(np)
      if (relay === null || !pidAlive(relay.pid)) throw new Error('world: no relay to drop')
      fakeSsh.setFail255('ssh: connect to host 127.0.0.1 port 22: No route to host\r\n')
      process.kill(relay.pid, 'SIGKILL')
      await waitFor('the relay to die', () => !pidAlive(relay.pid), 10_000)
      await waitFor('the pipe to see the link go', () => readPipeRecords(np).every((r) => r.state !== 'ready'), 10_000)
    },

    pipeStates: () => readPipeRecords(np).map((r) => r.state),
    hubLedger: () => (existsSync(ap.ledger) ? readLedger(ap.ledger) : []),
    nuanceLedger: () => (existsSync(np.ledger) ? readLedger(np.ledger) : []),

    async close() {
      for (const h of harnesses.splice(0)) await h.close().catch(() => null)
      await killHub('SIGTERM')
      const relay = readRelayStatus(np)
      if (relay && pidAlive(relay.pid)) {
        process.kill(relay.pid, 'SIGKILL')
        await waitFor('the relay to exit', () => !pidAlive(relay.pid), 10_000)
      }
    },
  }
}
