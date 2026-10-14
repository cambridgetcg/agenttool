// Fixtures for the installer's tests (Tasks 55–57): the trial repo on the "Air", a Nuance home where Summon is installed,
// and a bundle folder with its MANIFEST. A shared fixture lives here, never in a *.test.ts (Summon ruling R1: bun re-runs
// an imported test file). Task 57 adds the whole AirDrop bundle around the bash installer and a runner for it.
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ToolDef } from '../src/link/messages.ts'
import { localYmd, renderManifest, type CheckInput, type Manifest } from '../src/nuance/install-steps.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { writeToolsFile } from '../src/tools-digest.ts'
import { commitFiles, REAL_GIT, repoGit, sha256File, temp, testEnv, writeStub } from './helpers.ts'
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
