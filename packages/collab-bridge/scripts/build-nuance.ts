// Compiles the one Nuance program (P20) into a standalone arm64 binary, validly signed ad hoc (C6, K42):
//   bun --no-env-file --config=/dev/null scripts/build-nuance.ts [--out <absolute dir>]   (default: dist/nuance)
// Summon's build pattern (packages/summon/scripts/build-nuance.ts at b3ef7c95), copied: the compiled program reads no .env,
// bunfig.toml, tsconfig.json or package.json from where it starts, because sshd starts the gate in Nuance's home; the
// bundler writes each module's path relative to its cwd into the binary, so the compile runs with its cwd pinned to the
// package and the bytes are the same wherever the build is started from; Bun leaves zero bytes after __LINKEDIT and a
// signature `codesign --verify --strict` rejects, so the tail is cut and the file signed ad hoc again. Three changes from
// Summon: the compile goes straight to the final basename `collab-bridge`, because Bun embeds `/$bunfs/root/<basename>`
// (F14); it runs with `--no-env-file --config=/dev/null` and a fresh empty home, because `bun build` inlines a cwd bunfig's
// [define] (F5, P15) and nothing of the caller's, or of a git-ignored .env in the package, may steer it (P14); and the signature gets the fixed identifier
// dev.agenttool.collab-bridge instead of codesign's name-plus-UUID default.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { mkdirPrivate } from '../src/private-dir.ts'
import { systemBin } from '../src/sysbin.ts'

const PKG = join(import.meta.dir, '..')
const ENTRY = join(PKG, 'src', 'nuance', 'main.ts')
export const BINARY_NAME = 'collab-bridge'
export const SIGNING_IDENTIFIER = 'dev.agenttool.collab-bridge'

export interface NuanceBuild { binary: string; sha256: string; build: string }   // build = sha256.slice(0, 8)

export const NUANCE_BUILD_FLAGS: readonly string[] = Object.freeze(['--compile', '--target=bun-darwin-arm64',
  // sshd starts the gate in macair's home, so a compiled program must not read .env*, bunfig.toml, tsconfig.json or
  // package.json from where it starts (Summon's flags; a default compiled program loads a cwd .env, air-env §2.2).
  '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--no-compile-autoload-tsconfig', '--no-compile-autoload-package-json'])

const MH_MAGIC_64 = 0xfeedfacf
const LC_SEGMENT_64 = 0x19

/** Where the __LINKEDIT segment ends in a 64-bit Mach-O file (its fileoff + filesize, from the LC_SEGMENT_64 load command). */
export function linkeditEnd(macho: Uint8Array): number {
  const v = new DataView(macho.buffer, macho.byteOffset, macho.byteLength)
  if (macho.byteLength < 32 || v.getUint32(0, true) !== MH_MAGIC_64) throw new Error('not a 64-bit Mach-O file')
  const ncmds = v.getUint32(16, true)
  for (let i = 0, off = 32; i < ncmds; i++) {
    const cmd = v.getUint32(off, true)
    const size = v.getUint32(off + 4, true)
    if (cmd === LC_SEGMENT_64 && new TextDecoder().decode(macho.subarray(off + 8, off + 24)).replace(/\0+$/, '') === '__LINKEDIT') {
      return Number(v.getBigUint64(off + 40, true) + v.getBigUint64(off + 48, true))
    }
    if (size < 8) throw new Error('malformed Mach-O load command')
    off += size
  }
  throw new Error('no __LINKEDIT segment')
}

/**
 * Cuts the zero bytes Bun leaves after __LINKEDIT. Anything else there would be part of the program, so it refuses rather
 * than cut it, and leaves the file as it was. A file that already ends at __LINKEDIT is left alone.
 */
export function cutAfterLinkedit(file: string): void {
  const bytes = readFileSync(file)
  const end = linkeditEnd(bytes)
  if (bytes.length < end) throw new Error(`${file} is shorter than its __LINKEDIT segment`)
  if (bytes.subarray(end).some((b) => b !== 0)) throw new Error(`${file} has non-zero bytes after __LINKEDIT: not cutting it`)
  if (bytes.length > end) truncateSync(file, end)
}

/** Runs a build tool with a two-key env (P14: nothing inherited, so no BUN_OPTIONS preload); any non-zero exit throws. */
function tool(cmd: string, args: string[], o: { cwd: string; home: string }): void {
  const r = spawnSync(cmd, args, { cwd: o.cwd, env: { PATH: '/usr/bin:/bin', HOME: o.home }, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) {
    throw new Error(`buildNuance: ${basename(cmd)} ${args[0] ?? ''} failed (${r.status ?? r.signal}): ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()}`)
  }
}

/**
 * The compiler's argv. Like every bun the bridge runs it gets `--no-env-file --config=/dev/null` (R39): a git-ignored .env in
 * the package is invisible to prepare's clean-tree check, so nothing of it may reach the compile.
 */
export function nuanceCompileArgs(binary: string): string[] {
  return ['--no-env-file', '--config=/dev/null', 'build', ...NUANCE_BUILD_FLAGS, ENTRY, '--outfile', binary]
}

/**
 * The output folder: every folder made for it is 0700 (Global Constraints, Modes), and the folder itself is tightened when an
 * earlier run made it 0755 (a mode passed to mkdir applies only to a folder it creates).
 */
export function ensureOutDir(outDir: string): void {
  mkdirPrivate(outDir)
  chmodSync(outDir, 0o700)
}

export function buildNuance(outDir: string): NuanceBuild {
  if (!isAbsolute(outDir)) throw new Error(`buildNuance: the output dir must be absolute: ${outDir}`)
  ensureOutDir(outDir)
  const binary = join(outDir, BINARY_NAME)
  // The tools get a fresh empty home, never the caller's: nothing in a home can steer the compile or the signing.
  const home = mkdtempSync(join(tmpdir(), 'cb-build-home-'))
  try {
    tool(process.execPath, nuanceCompileArgs(binary), { cwd: PKG, home })
    cutAfterLinkedit(binary)
    const codesign = systemBin('codesign')
    tool(codesign, ['--force', '-s', '-', '-i', SIGNING_IDENTIFIER, binary], { cwd: '/', home })
    tool(codesign, ['--verify', '--strict', binary], { cwd: '/', home })
    chmodSync(binary, 0o755)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')
  return { binary, sha256, build: sha256.slice(0, 8) }
}

function main(argv: string[]): number {
  let out = join(PKG, 'dist', 'nuance')
  if (argv.length === 2 && argv[0] === '--out' && isAbsolute(argv[1]!)) out = argv[1]!
  else if (argv.length !== 0) {
    process.stderr.write('usage: build-nuance.ts [--out <absolute dir>]\n')
    return 2
  }
  try {
    process.stdout.write(`${JSON.stringify(buildNuance(out))}\n`)
    return 0
  } catch (e) {
    process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
