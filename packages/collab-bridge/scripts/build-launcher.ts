// Builds CollabBridgeHub.app (C15), the hub's own responsible code for Local Network privacy (K45, spec §10.4):
//   bun --no-env-file --config=/dev/null scripts/build-launcher.ts --out /Users/yuai/Applications/CollabBridgeHub.app
// The build is reproducible (P46): the same source, flags and output name give the same bytes, so an ad hoc grant, which
// follows the cdhash, survives a rebuild. clang writes straight to the final name, because the linker's ad hoc
// signature carries the file name and that changes the LC_UUID Local Network tracks (F14, P15).
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { systemBin } from '../src/sysbin.ts'

const PKG = join(import.meta.dir, '..')
const SOURCE = join(PKG, 'air-launcher', 'main.c')
const INFO_PLIST = join(PKG, 'air-launcher', 'Info.plist')
export const APP_NAME = 'CollabBridgeHub.app'
export const EXECUTABLE_NAME = 'collab-bridge-hub'
export const CLANG_FLAGS: readonly string[] = ['-Wall', '-Wextra', '-Werror', '-O2', '-arch', 'arm64', '-mmacosx-version-min=13.0']

export interface LauncherBuild { app: string; executable: string; cdhash: string; uuid: string; sha256: string }

/** Runs a build tool with a two-key env (P14) and returns stdout + stderr; any non-zero exit throws with its output. */
function tool(cmd: string, args: string[], home: string): string {
  const r = spawnSync(cmd, args, { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: home }, encoding: 'utf8', timeout: 120_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) throw new Error(`buildLauncher: ${basename(cmd)} ${args[0] ?? ''} failed (${r.status ?? r.signal}): ${out.trim()}`)
  return out
}

export function buildLauncher(o: { out: string }): LauncherBuild {
  const parent = dirname(o.out)
  if (basename(o.out) !== APP_NAME || !o.out.startsWith('/')) throw new Error(`buildLauncher: --out must be an absolute path ending /${APP_NAME}`)
  if (!existsSync(parent)) throw new Error(`buildLauncher: ${parent} does not exist`)
  const tag = randomBytes(6).toString('hex')
  const partial = join(parent, `.${APP_NAME}.partial-${tag}`)
  const home = mkdtempSync(join(tmpdir(), 'cb-launcher-home-'))
  try {
    const macos = join(partial, 'Contents', 'MacOS')
    mkdirSync(macos, { recursive: true, mode: 0o755 })
    for (const d of [partial, join(partial, 'Contents'), macos]) chmodSync(d, 0o755)
    const exe = join(macos, EXECUTABLE_NAME)
    tool(systemBin('xcrun'), ['clang', ...CLANG_FLAGS, '-o', exe, SOURCE], home)
    chmodSync(exe, 0o755)
    const plist = join(partial, 'Contents', 'Info.plist')
    copyFileSync(INFO_PLIST, plist)
    chmodSync(plist, 0o644)
    tool(systemBin('plutil'), ['-lint', plist], home)
    // Sign the bundle as a bundle, after Info.plist is in place: a lone signed executable fails --deep (air-env §17).
    tool(systemBin('codesign'), ['-s', '-', '--force', partial], home)
    tool(systemBin('codesign'), ['--verify', '--deep', '--strict', partial], home)
    const cdhash = /^CDHash=([0-9a-f]{40})$/m.exec(tool(systemBin('codesign'), ['-dv', '--verbose=4', partial], home))?.[1]
    if (!cdhash) throw new Error('buildLauncher: codesign printed no CDHash')
    const bytes = readFileSync(exe)
    const uuid = /^UUID: ([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}) \(arm64\) /m.exec(tool(systemBin('xcrun'), ['dwarfdump', '--uuid', exe], home))?.[1]
    if (!uuid) throw new Error('buildLauncher: dwarfdump printed no arm64 UUID')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // Only a verified bundle replaces the installed one; the old one moves aside first and is removed after.
    const old = join(parent, `.${APP_NAME}.old-${tag}`)
    const had = existsSync(o.out)
    if (had) renameSync(o.out, old)
    try {
      renameSync(partial, o.out)
    } catch (e) {
      if (had) renameSync(old, o.out)
      throw e
    }
    if (had) rmSync(old, { recursive: true, force: true })
    return { app: o.out, executable: join(o.out, 'Contents', 'MacOS', EXECUTABLE_NAME), cdhash, uuid, sha256 }
  } finally {
    rmSync(partial, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

function main(argv: string[]): number {
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1]!.startsWith('/') || basename(argv[1]!) !== APP_NAME) {
    process.stderr.write(`usage: build-launcher.ts --out <absolute dir>/${APP_NAME}\n`)
    return 2
  }
  process.stdout.write(`${JSON.stringify(buildLauncher({ out: argv[1]! }))}\n`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
