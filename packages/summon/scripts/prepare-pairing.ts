// On the Air: make the summon key (once), build the Nuance binaries, and write the AirDrop bundle
// ~/summon-nuance-bundle-<expiry>-<build>/ with a checksum-pinned installer.
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildNuance, type NuanceBuild } from './build-nuance.ts'

export function renderInstaller(tmpl: string, v: { pubkey: string; expiry: string; preparedAt: string; shaGatekeeper: string; shaRunner: string }): string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ summon-air$/.test(v.pubkey)) throw new Error('unexpected public key format')
  if (!/^\d{8}$/.test(v.expiry) || !/^\d{14}$/.test(v.preparedAt) || !/^[0-9a-f]{64}$/.test(v.shaGatekeeper) || !/^[0-9a-f]{64}$/.test(v.shaRunner)) {
    throw new Error('bad template values')
  }
  return tmpl.replace('__PUBKEY__', v.pubkey).replace('__EXPIRY__', v.expiry).replace('__PREPARED_AT__', v.preparedAt)
    .replace('__SHA_GATEKEEPER__', v.shaGatekeeper).replace('__SHA_RUNNER__', v.shaRunner)
}

/** A build's id: the first 8 hex of sha256(runner sha256 ‖ gatekeeper sha256), so a change to either program changes it. */
export function buildId(sha: NuanceBuild['sha']): string {
  return createHash('sha256').update(sha.runner + sha.gatekeeper).digest('hex').slice(0, 8)
}

const KEY_LIFETIME_DAYS = 90

export interface PreparedBundle {
  bundle: string
  /** What Yu runs on Nuance once the bundle is AirDropped there. */
  command: string
  pubkey: string
  expiry: string
  buildId: string
  /** When the bundle was made, UTC YYYYMMDDHHMMSS: the installer refuses to replace a bundle prepared after it. */
  preparedAt: string
  sha: NuanceBuild['sha']
  /** Other bundle folders left in `home` by earlier runs (never removed here). */
  older: string[]
}

/**
 * Everything under `home` (the Air's home): the summon key in ~/.ssh/summon (made once, never replaced) and the bundle
 * folder ~/summon-nuance-bundle-<expiry>-<build id>. Each new build or expiry gets a folder of its own, so a bundle
 * AirDropped earlier can never be the one the printed command runs. Folders are 0700 and files 0600, the two programs 0700,
 * even when they already exist. `build` and `now` are for tests.
 */
export function prepareBundle(o: { home: string; build?: () => NuanceBuild; now?: number }): PreparedBundle {
  const build = o.build ?? (() => buildNuance(join(import.meta.dir, '..', 'dist', 'nuance')))
  const private700 = (dir: string) => { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700) }
  const writePrivate = (path: string, text: string) => { writeFileSync(path, text, { mode: 0o600 }); chmodSync(path, 0o600) }

  const sshDir = join(o.home, '.ssh', 'summon')
  private700(sshDir)
  const key = join(sshDir, 'summon_nuance_ed25519')
  if (!existsSync(key)) {
    const r = Bun.spawnSync(['/usr/bin/ssh-keygen', '-t', 'ed25519', '-N', '', '-C', 'summon-air', '-f', key])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  }
  chmodSync(key, 0o600); chmodSync(`${key}.pub`, 0o600)
  const pubkey = readFileSync(`${key}.pub`, 'utf8').trim()
  const now = o.now ?? Date.now()
  const expiry = new Date(now + KEY_LIFETIME_DAYS * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')
  const preparedAt = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)

  const built = build()
  const id = buildId(built.sha)
  const folder = `summon-nuance-bundle-${expiry}-${id}`
  const bundle = join(o.home, folder)
  private700(bundle)
  for (const [src, name] of [[built.gatekeeper, 'summon-gatekeeper'], [built.runner, 'summon-runner']] as const) {
    copyFileSync(src, join(bundle, name)); chmodSync(join(bundle, name), 0o700)
  }
  const tmpl = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
  writePrivate(join(bundle, 'summon-install.sh'),
    renderInstaller(tmpl, { pubkey, expiry, preparedAt, shaGatekeeper: built.sha.gatekeeper, shaRunner: built.sha.runner }))
  // The installer writes these same lines to INSTALLED on Nuance, so the two can be compared byte for byte.
  writePrivate(join(bundle, 'MANIFEST.txt'), `build ${id}\nprepared ${preparedAt}\nsummon-gatekeeper ${built.sha.gatekeeper}\n` +
    `summon-runner ${built.sha.runner}\nkey summon-air expires ${expiry}\n`)
  const older = readdirSync(o.home).filter((n) => n.startsWith('summon-nuance-bundle-') && n !== folder)
    // lstat: a link (even a dangling one) is not a bundle folder, and must not stop the ready text from printing.
    .map((n) => join(o.home, n)).filter((p) => lstatSync(p).isDirectory()).sort()
  return { bundle, command: `bash ~/Downloads/${folder}/summon-install.sh`, pubkey, expiry, buildId: id, preparedAt, sha: built.sha, older }
}

/** What the script prints once the bundle is ready: where it is, when its key expires, and the exact command for Nuance. */
export function bundleReadyText(r: PreparedBundle): string {
  const day = `${r.expiry.slice(0, 4)}-${r.expiry.slice(4, 6)}-${r.expiry.slice(6)}`
  const older = r.older.length === 0 ? [] : [`older bundles here are not needed any more; to remove them: rm -rf ${r.older.map((p) => `'${p}'`).join(' ')}`]
  return [`bundle ready: ${r.bundle} (build ${r.buildId}, prepared ${r.preparedAt} UTC)`,
    `the summon key expires ${day} (${r.expiry}); pair again before then (README step 1).`,
    'AirDrop the folder to Nuance. There, turn on Remote Login (only your user), then run:', `  ${r.command}`, ...older, ''].join('\n')
}

if (import.meta.main) process.stdout.write(bundleReadyText(prepareBundle({ home: homedir() })))
