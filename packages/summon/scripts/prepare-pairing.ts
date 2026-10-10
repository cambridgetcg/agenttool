// On the Air: make the summon key (once), build the Nuance binaries, and write the
// AirDrop bundle ~/summon-nuance-bundle/ with a checksum-pinned installer.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildNuance, type NuanceBuild } from './build-nuance.ts'

export function renderInstaller(tmpl: string, v: { pubkey: string; expiry: string; shaGatekeeper: string; shaRunner: string }): string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ summon-air$/.test(v.pubkey)) throw new Error('unexpected public key format')
  if (!/^\d{8}$/.test(v.expiry) || !/^[0-9a-f]{64}$/.test(v.shaGatekeeper) || !/^[0-9a-f]{64}$/.test(v.shaRunner)) throw new Error('bad template values')
  return tmpl.replace('__PUBKEY__', v.pubkey).replace('__EXPIRY__', v.expiry)
    .replace('__SHA_GATEKEEPER__', v.shaGatekeeper).replace('__SHA_RUNNER__', v.shaRunner)
}

const KEY_LIFETIME_DAYS = 90

export interface PreparedBundle { bundle: string; pubkey: string; expiry: string; sha: NuanceBuild['sha'] }

/**
 * Everything under `home` (the Air's home): the summon key in ~/.ssh/summon (made once, never replaced) and the
 * bundle folder ~/summon-nuance-bundle. Folders are 0700 and files 0600, the two programs 0700, even when they already exist.
 * `build` and `now` are for tests.
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
  const expiry = new Date((o.now ?? Date.now()) + KEY_LIFETIME_DAYS * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')

  const bundle = join(o.home, 'summon-nuance-bundle')
  private700(bundle)
  const built = build()
  for (const [src, name] of [[built.gatekeeper, 'summon-gatekeeper'], [built.runner, 'summon-runner']] as const) {
    copyFileSync(src, join(bundle, name)); chmodSync(join(bundle, name), 0o700)
  }
  const tmpl = readFileSync(join(import.meta.dir, '..', 'nuance', 'install.sh.tmpl'), 'utf8')
  writePrivate(join(bundle, 'summon-install.sh'), renderInstaller(tmpl, { pubkey, expiry, shaGatekeeper: built.sha.gatekeeper, shaRunner: built.sha.runner }))
  writePrivate(join(bundle, 'MANIFEST.txt'), `summon-gatekeeper ${built.sha.gatekeeper}\nsummon-runner ${built.sha.runner}\nkey summon-air expires ${expiry}\n`)
  return { bundle, pubkey, expiry, sha: built.sha }
}

if (import.meta.main) {
  const r = prepareBundle({ home: homedir() })
  console.log(`bundle ready: ${r.bundle}\nAirDrop the folder to Nuance, then on Nuance: bash ~/Downloads/summon-nuance-bundle/summon-install.sh`)
}
