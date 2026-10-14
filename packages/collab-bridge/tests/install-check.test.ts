import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  citizenRoot, dropinOwnerUidOf, INSTALL_USAGE, installCheck, installClone, parseManifest, renderManifest, type CheckReport,
} from '../src/nuance/install-steps.ts'
import { resolveGit } from '../src/nuance/git-resolve.ts'
import { dropinStat, renderInstalled, summonKeySha256 } from '../src/nuance/installed.ts'
import { checkInput, claudeStub, makeTrialRepo, summonReadyHome, writeCheckBundle, type NuanceHome } from './install-fixtures.ts'
import { allowlistYaml } from './nuance-home.ts'
import { cleanupTmps, commitFiles, PKG, REAL_GIT, repoGit, temp, writeStub } from './helpers.ts'

afterEach(cleanupTmps)

const codes = (r: CheckReport) => r.failures.map((f) => f.slice(0, f.indexOf(':')))

/** A Nuance home, the trial repo and a bundle for the trial share: every check passes until a test changes one thing. */
function world(o: { files?: Record<string, string>; allowlist?: string; expiry?: string; prepared?: string } = {}) {
  const h = summonReadyHome({ allowlist: o.allowlist })
  const trial = makeTrialRepo({ files: o.files })
  const b = writeCheckBundle({ trial, shares: [h.share], expiry: o.expiry, prepared: o.prepared })
  return { h, trial, b }
}

/** A clone of the trial repo at the share, as the installer's clone step leaves it. */
function cloneAt(h: NuanceHome, trialRepo: string, at = h.share): void {
  repoGit('/', ['clone', '-q', trialRepo, at])
}

/** The verbs as the installer runs them: the Nuance entry from source, in the home's own test env. */
function verb(h: NuanceHome, args: string[]) {
  const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'install', ...args],
    { env: h.env, cwd: '/', stdout: 'pipe', stderr: 'pipe' })
  const out = r.stdout.toString()
  return { code: r.exitCode, stdout: out, json: out.trim() === '' ? null : JSON.parse(out.trim().split('\n').pop()!), stderr: r.stderr.toString() }
}

/** The verbs' full command line for a home, a bundle and its shares. */
function verbArgs(name: 'check' | 'clone', b: { dir: string }, shares: string[]): string[] {
  return [name, '--bundle', b.dir, ...shares.flatMap((s) => ['--share', s]), '--terminal-git', REAL_GIT, '--claude', claudeStub()]
}

/**
 * A Nuance home whose ~/love-unlimited is a symlink to a citizen's real folder elsewhere (as when it lives on another
 * volume), with ~/love-unlimited an `access: edit` entry and ~/Projects/lu a second link to the same folder.
 */
function linkedLoveUnlimited() {
  const h = summonReadyHome({ allowlist: allowlistYaml([{ path: '~/love-unlimited', access: 'edit' }]) })
  const realLu = temp('cb-lu-real-')
  symlinkSync(realLu, join(h.home, 'love-unlimited'))
  symlinkSync(realLu, join(h.home, 'Projects', 'lu'))
  return { h, realLu, trial: makeTrialRepo(), spelled: [join(h.home, 'love-unlimited', 'collab-trial'), join(h.home, 'Projects', 'lu', 'collab-trial')] }
}

describe('MANIFEST', () => {
  test('round-trips and refuses an unknown or malformed line', () => {
    const { b } = world()
    const text = renderManifest(b.manifest)
    expect(parseManifest(text)).toEqual(b.manifest)
    expect(text.split('\n').slice(0, 6).map((l) => l.split(' ')[0])).toEqual(['device', 'build', 'prepared', 'expiry', 'trial_commit', 'tools_digest'])
    expect(parseManifest(text + 'colour blue\n')).toBeNull()
    expect(parseManifest(text.replace(/^expiry \d{8}$/m, 'expiry 2099-12-31'))).toBeNull()
    expect(parseManifest(text.replace(/^sha256 [0-9a-f]{64} collab-bridge$/m, ''))).toBeNull()
    expect(() => renderManifest({ ...b.manifest, binary_sha256: 'f'.repeat(64) })).toThrow()
    // The share rule is the gate's (§5.2): a space is servable, a ' is not.
    const spaced = { ...b.manifest, shares: ['/Users/macair/Projects/my trial'] }
    expect(parseManifest(renderManifest(spaced))).toEqual(spaced)
    expect(() => renderManifest({ ...b.manifest, shares: ["/Users/macair/it's"] })).toThrow()
  })
})

describe('install check', () => {
  test('a home with Summon live, a fresh bundle and the trial folder absent passes', () => {
    const { h, b } = world()
    const r = installCheck(checkInput(h, b))
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.shares).toEqual([{ path: h.share, state: 'absent', realpath: h.share, gitdir: join(h.share, '.git') }])
    expect(r.git && r.git.path.startsWith('/')).toBe(true)
    expect(r.manifest).toEqual(b.manifest)
  }, 20_000)

  test('refuses root, a non-Darwin or non-arm64 platform', () => {
    const { h, b } = world()
    expect(codes(installCheck(checkInput(h, b, { uid: 0 })))).toContain('root')
    expect(codes(installCheck(checkInput(h, b, { platform: 'linux' })))).toContain('platform')
    expect(codes(installCheck(checkInput(h, b, { arch: 'x64' })))).toContain('platform')
  }, 20_000)

  test('refuses when Summon is not installed or keys-only is missing', () => {
    const { h, b } = world()
    rmSync(h.paths.summonInstalled)
    expect(codes(installCheck(checkInput(h, b)))).toContain('summon_not_installed')
    writeFileSync(h.paths.summonInstalled, 'build 5c09726b\n')
    rmSync(h.paths.summonKeysOnly)
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['summon_keys_only'])
    writeFileSync(h.paths.summonKeysOnly, '')
    writeFileSync(h.paths.authorizedKeys, '')
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['summon_key_missing'])
  }, 20_000)

  test('refuses when the password-off drop-in is missing', () => {
    const { h, b } = world()
    rmSync(h.paths.summonDropin)
    const r = installCheck(checkInput(h, b))
    expect(codes(r)).toEqual(['dropin_missing'])
    expect(r.summon).toBeNull()
  }, 20_000)

  test('a drop-in owned by the user is refused when root is expected', () => {
    const { h, b } = world()
    expect(codes(installCheck(checkInput(h, b, { dropinOwnerUid: 0 })))).toEqual(['dropin_owner'])
  }, 20_000)

  test('the drop-in owner knob is ignored without the override', () => {
    const home = temp('cb-knob-')
    const knob = { HOME: home, COLLAB_BRIDGE_DROPIN_OWNER_UID: '502' }
    expect(dropinOwnerUidOf(knob)).toBe(0)
    expect(dropinOwnerUidOf({ ...knob, COLLAB_BRIDGE_HOME_OVERRIDE: '/somewhere/else' })).toBe(0)
    expect(dropinOwnerUidOf({ ...knob, COLLAB_BRIDGE_HOME_OVERRIDE: home })).toBe(502)
  })

  test('refuses an expired key and an older bundle (by prepared and by the key line\'s expiry)', () => {
    const { h, trial, b } = world()
    const today = checkInput(h, b).today
    const expired = writeCheckBundle({ trial, shares: [h.share], expiry: today })
    expect(codes(installCheck(checkInput(h, expired)))).toEqual(['expired'])
    const r0 = installCheck(checkInput(h, b))
    mkdirSync(join(h.home, '.local', 'share', 'collab-bridge'), { recursive: true })
    writeFileSync(h.paths.installed, renderInstalled({ device: 'nuance', build: 'abcdef12', prepared: '20261014000000', expiry: '20991231',
      binary_sha256: 'a'.repeat(64), tools_seed: 'b'.repeat(64), git: r0.git!, summon_key_sha256: r0.summon!.key_sha256,
      summon_dropin_stat: r0.summon!.dropin_stat, claude_version: null, installed_at: '2026-10-14T00:00:00.000Z' }))
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['older_bundle'])
    rmSync(h.paths.installed)
    writeFileSync(h.paths.authorizedKeys, readFileSync(h.paths.authorizedKeys, 'utf8') +
      `restrict,from="192.168.50.0/24",expiry-time="21000101",command="${h.home}/.local/share/collab-bridge/collab-bridge gate" ssh-ed25519 AAAAold collab-air\n`)
    const older = installCheck(checkInput(h, b))
    expect(codes(older)).toEqual(['older_bundle'])
    expect(older.failures[0]).toContain('2100-01-01')
    writeFileSync(h.paths.installed, 'build 1\n')
    expect(codes(installCheck(checkInput(h, b)))).toContain('installed_unreadable')
  }, 30_000)

  test('refuses a noisy ~/.zshenv', () => {
    const { h, b } = world()
    writeFileSync(join(h.home, '.zshenv'), 'echo welcome back\n')
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['zshenv'])
  }, 20_000)

  test('refuses a git without the guard and a missing claude', () => {
    const { h, b } = world()
    const bin = temp('cb-oldgit-')
    const noXcrun = writeStub(bin, 'xcrun', 'exit 1')
    const oldGit = writeStub(bin, 'git', 'echo "git version 2.39.5 (Apple Git-154)"')
    const r = installCheck(checkInput(h, b, { xcrun: noXcrun, terminalGit: oldGit, claude: null }))
    expect(codes(r)).toContain('git_unsafe')
    expect(codes(r)).toContain('claude')
    expect(r.git).toEqual(expect.objectContaining({ version: '2.39.5', apple: true, guard: false }))
    expect(codes(installCheck(checkInput(h, b, { xcrun: noXcrun, terminalGit: null })))).toContain('git')
    expect(codes(installCheck(checkInput(h, b, { claude: join(bin, 'no-such-claude') })))).toEqual(['claude'])
  }, 20_000)

  test('an existing share must be a repo root holding the trial commit, in an edit folder', () => {
    const { h, trial, b } = world()
    cloneAt(h, trial.repo)
    const ok = installCheck(checkInput(h, b))
    expect(ok.failures).toEqual([])
    expect(ok.shares).toEqual([{ path: h.share, state: 'exists', realpath: h.share, gitdir: join(h.share, '.git') }])

    const sub = join(h.share, 'notes')
    const subBundle = writeCheckBundle({ trial, shares: [sub] })
    writeFileSync(h.paths.summonAllowlist, allowlistYaml([{ path: '~/Projects/collab-trial', access: 'edit' }]))
    expect(codes(installCheck(checkInput(h, subBundle)))).toEqual(['share_not_repo_root'])

    const other = join(h.home, 'Projects', 'collab-trial-2')
    repoGit('/', ['init', '-q', '-b', 'main', other])
    commitFiles(other, { 'README.md': 'not the trial\n' }, 'unrelated')
    writeFileSync(h.paths.summonAllowlist, allowlistYaml([{ path: '~/Projects', access: 'edit' }]))
    const otherBundle = writeCheckBundle({ trial, shares: [other] })
    expect(codes(installCheck(checkInput(h, otherBundle)))).toEqual(['share_missing_commit'])

    writeFileSync(h.paths.summonAllowlist, allowlistYaml([{ path: '~/Projects', access: 'review' }]))
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['share_not_edit'])
  }, 30_000)

  test('refuses a citizen root (REST, EVENT-ONLY, under ~/love-unlimited)', () => {
    for (const marker of ['REST', 'EVENT-ONLY']) {
      const { h, trial, b } = world({ files: { 'README.md': 'collab trial\n', [marker]: '' } })
      cloneAt(h, trial.repo)
      expect(codes(installCheck(checkInput(h, b)))).toEqual(['share_citizen'])
    }
    const h = summonReadyHome({ allowlist: allowlistYaml([{ path: '~/love-unlimited', access: 'edit' }]) })
    const trial = makeTrialRepo()
    const lu = join(h.home, 'love-unlimited', 'collab-trial')
    mkdirSync(join(h.home, 'love-unlimited'))
    expect(codes(installCheck(checkInput(h, writeCheckBundle({ trial, shares: [lu] }))))).toEqual(['share_citizen'])
    cloneAt(h, trial.repo, lu)
    expect(codes(installCheck(checkInput(h, writeCheckBundle({ trial, shares: [lu] }))))).toEqual(['share_citizen'])
    expect(citizenRoot(lu, h.home)).toBe('citizen')
    expect(citizenRoot(join(h.home, 'Projects'), h.home)).toBe('clear')
  }, 30_000)

  test('an absent share that would land in a symlinked ~/love-unlimited is refused, however it is spelled', () => {
    const { h, realLu, trial, spelled } = linkedLoveUnlimited()
    for (const share of spelled) {
      const r = installCheck(checkInput(h, writeCheckBundle({ trial, shares: [share] })))
      expect(codes(r)).toEqual(['share_citizen'])
      expect(r.shares).toEqual([])
    }
    // The folder-to-be is judged where it would really be, whether or not it resolves yet; a path that resolves is judged as before.
    expect(citizenRoot(join(realLu, 'not-yet'), h.home)).toBe('citizen')
    expect(citizenRoot(join(h.home, 'Projects', 'not-yet'), h.home)).toBe('clear')
    expect(citizenRoot(realLu, h.home)).toBe('citizen')
    expect(readdirSync(realLu)).toEqual([])
  }, 30_000)

  test('an absent share spelled under ~/love-unlimited is refused even when a link inside it leads out', () => {
    const elsewhere = temp('cb-out-')
    const h = summonReadyHome({ allowlist: allowlistYaml([{ path: '~/love-unlimited', access: 'edit' }, { path: elsewhere, access: 'edit' }]) })
    mkdirSync(join(h.home, 'love-unlimited'))
    symlinkSync(elsewhere, join(h.home, 'love-unlimited', 'out'))
    const share = join(h.home, 'love-unlimited', 'out', 'collab-trial')                  // resolves to elsewhere/collab-trial, which alone looks clear
    expect(citizenRoot(join(elsewhere, 'collab-trial'), h.home)).toBe('clear')
    const r = installCheck(checkInput(h, writeCheckBundle({ trial: makeTrialRepo(), shares: [share] })))
    expect(codes(r)).toEqual(['share_citizen'])
    expect(r.shares).toEqual([])
  }, 30_000)

  test('a bundle file that differs from MANIFEST.txt, or is gone, is refused as a checksum failure', () => {
    const { h, b } = world()
    for (const name of ['collab-bridge', 'tools.json', 'collab-trial.bundle']) {
      const p = join(b.dir, name)
      const original = readFileSync(p)
      appendFileSync(p, '\n')
      const r = installCheck(checkInput(h, b))
      expect(codes(r)).toEqual(['checksum'])
      expect(r.failures[0]).toContain(`${name} does not match MANIFEST.txt`)
      writeFileSync(p, original)
      expect(installCheck(checkInput(h, b)).failures).toEqual([])
    }
    rmSync(join(b.dir, 'tools.json'))
    const gone = installCheck(checkInput(h, b))
    expect(codes(gone)).toEqual(['checksum'])
    expect(gone.failures[0]).toContain('tools.json does not match MANIFEST.txt')
  }, 60_000)

  test('a drop-in that is not mode 600 is refused, and no Summon baseline is recorded', () => {
    const { h, b } = world()
    chmodSync(h.paths.summonDropin, 0o644)
    const r = installCheck(checkInput(h, b))
    expect(codes(r)).toEqual(['dropin_mode'])
    expect(r.failures[0]).toContain('has mode 644, not 600')
    expect(r.summon).toBeNull()
  }, 20_000)

  test('an absent share needs a parent folder that exists and is yours', () => {
    const { h, trial, b } = world()
    const missing = join(h.home, 'Projects', 'missing', 'collab-trial')
    const gone = installCheck(checkInput(h, writeCheckBundle({ trial, shares: [missing] })))
    expect(codes(gone)).toEqual(['share_parent'])
    expect(gone.failures[0]).toContain(`the folder ${join(h.home, 'Projects', 'missing')} does not exist`)
    const notYours = installCheck(checkInput(h, b, { uid: process.getuid!() + 1 }))
    expect(codes(notYours)).toEqual(['share_parent_owner'])
    expect(notYours.shares).toEqual([])
  }, 30_000)

  test('an existing share whose .git is not the repository\'s own folder is refused: a linked worktree, a gitdir file, a symlink', () => {
    const { h, trial, b } = world({ allowlist: allowlistYaml([{ path: '~/Projects', access: 'edit' }]) })
    const refused = (): void => {
      const r = installCheck(checkInput(h, b))
      expect(codes(r)).toEqual(['share_gitdir'])
      expect(r.shares).toEqual([])
      rmSync(h.share, { recursive: true, force: true })
    }
    repoGit(trial.repo, ['worktree', 'add', '-q', '-b', 'linked', h.share])             // .git is a file naming the main repo's worktrees/ folder
    refused()
    repoGit('/', ['clone', '-q', '--separate-git-dir', join(temp('cb-sepgit-'), 'repo.git'), trial.repo, h.share])    // .git is a gitdir file
    refused()
    const elsewhere = join(temp('cb-gitlink-'), 'wt')
    repoGit('/', ['clone', '-q', trial.repo, elsewhere])
    mkdirSync(h.share)
    symlinkSync(join(elsewhere, '.git'), join(h.share, '.git'))                           // .git is a symlink to a repository's folder
    refused()
    cloneAt(h, trial.repo)                                                                // and its own folder is accepted
    expect(installCheck(checkInput(h, b)).failures).toEqual([])
  }, 60_000)

  test('an absent folder with an exact edit entry is accepted', () => {
    const { h, b } = world({ allowlist: allowlistYaml([{ path: '~/Projects/collab-trial', access: 'edit' }]) })
    const r = installCheck(checkInput(h, b))
    expect(r.failures).toEqual([])
    expect(r.shares).toEqual([{ path: h.share, state: 'absent', realpath: h.share, gitdir: join(h.share, '.git') }])
  }, 20_000)

  test('an absent folder under a review-only parent is refused', () => {
    const { h, b } = world({ allowlist: allowlistYaml([{ path: '~/Projects', access: 'review' }]) })
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['share_not_edit'])
  }, 20_000)

  test('an absent folder whose parent is a symlink into a TCC folder is refused', () => {
    const h = summonReadyHome({ allowlist: allowlistYaml([{ path: '~/Work/collab-trial', access: 'edit' }]) })
    mkdirSync(join(h.home, 'Documents', 'work'), { recursive: true })
    symlinkSync(join(h.home, 'Documents', 'work'), join(h.home, 'Work'))
    const b = writeCheckBundle({ trial: makeTrialRepo(), shares: [join(h.home, 'Work', 'collab-trial')] })
    expect(codes(installCheck(checkInput(h, b)))).toEqual(['share_tcc'])
    const spelled = writeCheckBundle({ trial: makeTrialRepo(), shares: [join(h.home, 'Downloads', 'collab-trial')] })
    expect(codes(installCheck(checkInput(h, spelled)))).toContain('share_tcc')
  }, 20_000)

  test('records the Summon key hash and the drop-in stat', () => {
    const { h, b } = world()
    const r = installCheck(checkInput(h, b))
    expect(r.summon).toEqual({ key_sha256: summonKeySha256(readFileSync(h.paths.authorizedKeys, 'utf8')), dropin_stat: dropinStat(h.paths.summonDropin)! })
  }, 20_000)

  test('install check prints one JSON line and a ✗ line per failure', () => {
    const { h, b } = world()
    const args = ['check', '--bundle', b.dir, '--share', h.share, '--terminal-git', REAL_GIT, '--claude', claudeStub()]
    const ok = verb(h, args)
    expect([ok.code, ok.json.ok]).toEqual([0, true])
    writeFileSync(join(h.home, '.zshenv'), 'echo hi\n')
    const bad = verb(h, args)
    expect([bad.code, bad.json.ok]).toEqual([1, false])
    expect(bad.stderr).toContain('✗ zshenv: ')
  }, 30_000)

  test('a bad command line prints the usage line and {"ok":false,"failures":["usage"]}, and exits 1', () => {
    const { h, b } = world()
    for (const args of [['check'], ['check', '--bundle', b.dir], ['clone'], ['frobnicate'], [], ['check', ...verbArgs('check', b, [h.share]).slice(1), '--bundle', b.dir]]) {
      const r = verb(h, args)
      expect([r.code, r.stdout, r.stderr]).toEqual([1, '{"ok":false,"failures":["usage"]}\n', INSTALL_USAGE + '\n'])
    }
  }, 60_000)
})

describe('install clone', () => {
  test('the clone holds the trial commit and shares history with the Air repo', () => {
    const { h, trial, b } = world()
    writeFileSync(join(h.home, 'Projects', 'keep.txt'), 'mine\n')
    const r = verb(h, ['clone', '--bundle', b.dir, '--share', h.share, '--terminal-git', REAL_GIT, '--claude', claudeStub()])
    expect([r.code, r.json]).toEqual([0, { ok: true, created: [h.share] }])
    expect(repoGit(h.share, ['rev-parse', 'HEAD'])).toBe(trial.commit)
    expect(repoGit(h.share, ['merge-base', 'HEAD', trial.commit])).toBe(trial.commit)
    expect(repoGit(h.share, ['remote'])).toBe('')
    expect(readdirSync(join(h.home, 'Projects')).sort()).toEqual(['collab-trial', 'keep.txt'])
    const again = installCheck(checkInput(h, b))
    expect(again.ok).toBe(true)
    expect(again.shares[0]!.state).toBe('exists')
  }, 30_000)

  test('a failed re-check after the clone removes only the new clone', () => {
    const { h, b } = world({ files: { 'README.md': 'collab trial\n', REST: '' } })
    writeFileSync(join(h.home, 'Projects', 'keep.txt'), 'mine\n')
    const r = verb(h, ['clone', '--bundle', b.dir, '--share', h.share, '--terminal-git', REAL_GIT, '--claude', claudeStub()])
    expect(r.code).toBe(1)
    expect(r.json.ok).toBe(false)
    expect(r.json.reason).toContain('share_citizen')
    expect(existsSync(h.share)).toBe(false)
    expect(readdirSync(join(h.home, 'Projects'))).toEqual(['keep.txt'])
  }, 30_000)

  test('a target that appears before the rename is refused and left alone', () => {
    const { h, trial, b } = world()
    const g = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: REAL_GIT, home: h.home })
    if (!g.ok) throw new Error(g.reason)
    let rechecked = 0
    const r = installClone({
      bundle: b.dir, share: h.share, git: g.git, trialCommit: trial.commit, home: h.home,
      rand: () => { mkdirSync(h.share); writeFileSync(join(h.share, 'theirs.txt'), 'theirs\n'); return '0123abcd' },
      recheck: () => { rechecked++; return [] },
    })
    expect(r.ok).toBe(false)
    expect(readdirSync(h.share)).toEqual(['theirs.txt'])
    expect(readdirSync(join(h.home, 'Projects'))).toEqual(['collab-trial'])
    expect(rechecked).toBe(0)
  }, 30_000)

  test('a share that would land in a symlinked ~/love-unlimited is never cloned: the checks fail first', () => {
    const { h, realLu, trial, spelled } = linkedLoveUnlimited()
    for (const share of spelled) {
      const r = verb(h, verbArgs('clone', writeCheckBundle({ trial, shares: [share] }), [share]))
      expect([r.code, r.json]).toEqual([1, { ok: false, reason: 'the checks failed; nothing was cloned', created: [] }])
      expect(r.stderr).toContain('✗ share_citizen: ')
      expect(readdirSync(realLu)).toEqual([])                       // not even a .partial folder was made in the citizen's folder
    }
  }, 60_000)

  test('when a later share fails, the clones this run already made are removed', () => {
    const { h, trial } = world({ allowlist: allowlistYaml([{ path: '~/Projects', access: 'edit' }, { path: '~/Locked', access: 'edit' }]) })
    const locked = join(h.home, 'Locked')
    mkdirSync(locked)
    const second = join(locked, 'collab-trial')
    const b = writeCheckBundle({ trial, shares: [h.share, second] })
    writeFileSync(join(h.home, 'Projects', 'keep.txt'), 'mine\n')
    chmodSync(locked, 0o500)                                         // the check passes (it only reads), the clone cannot make a folder here
    try {
      const r = verb(h, verbArgs('clone', b, [h.share, second]))
      expect(r.code).toBe(1)
      expect(r.json.ok).toBe(false)
      expect(r.json.created).toEqual([])
      expect(r.json.reason).toContain('git clone of the trial bundle failed')
      expect(r.stderr).toContain(`✓ cloned the trial repo into ${h.share}`)
      expect(existsSync(h.share)).toBe(false)
      expect(readdirSync(join(h.home, 'Projects'))).toEqual(['keep.txt'])
      expect(readdirSync(locked)).toEqual([])
    } finally { chmodSync(locked, 0o700) }
  }, 60_000)
})
