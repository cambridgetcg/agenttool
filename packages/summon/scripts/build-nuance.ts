// Compile the two Nuance programs into standalone arm64 binaries (no runtime needed there), each validly signed ad hoc.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'

export interface NuanceBuild { gatekeeper: string; runner: string; sha: { gatekeeper: string; runner: string } }

const BUILD_FLAGS = ['--compile', '--target=bun-darwin-arm64',
  // sshd starts the gatekeeper in Yu's home, so a compiled program must not read .env* or bunfig.toml from where it starts.
  '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--no-compile-autoload-tsconfig', '--no-compile-autoload-package-json']

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
 * Bun signs what it compiles, but Apple's `codesign --verify` calls that signature invalid: Bun hashes the short last code
 * page as if zero-padded, and leaves zero bytes after __LINKEDIT, which strict validation (and so re-signing) rejects.
 * So cut the file at the end of __LINKEDIT, sign it ad hoc again, and require the strict check to pass.
 */
function resign(file: string): void {
  const end = linkeditEnd(readFileSync(file))
  const size = statSync(file).size
  if (size < end) throw new Error(`${file} is shorter than its __LINKEDIT segment`)
  if (size > end) truncateSync(file, end)
  for (const args of [['--force', '-s', '-'], ['--verify', '--strict']]) {
    const r = Bun.spawnSync(['/usr/bin/codesign', ...args, file])
    if (r.exitCode !== 0) throw new Error(`codesign ${args.join(' ')} ${file} failed: ${r.stderr.toString()}`)
  }
}

export function buildNuance(outDir: string): NuanceBuild {
  mkdirSync(outDir, { recursive: true })
  const root = join(import.meta.dir, '..')
  const out: Record<string, string> = {}
  for (const [name, entry] of [['summon-gatekeeper', 'src/gatekeeper-main.ts'], ['summon-runner', 'src/runner-main.ts']] as const) {
    const target = join(outDir, name)
    // The bundler writes each module's path relative to its cwd into the binary, so the cwd is pinned to the package:
    // the bytes (and the checksums in the bundle) are then the same wherever the build is started from.
    const r = Bun.spawnSync([process.execPath, 'build', ...BUILD_FLAGS, join(root, entry), '--outfile', target], { cwd: root })
    if (r.exitCode !== 0) throw new Error(`build ${name} failed: ${r.stderr.toString()}`)
    resign(target)
    out[name] = createHash('sha256').update(readFileSync(target)).digest('hex')
  }
  return { gatekeeper: join(outDir, 'summon-gatekeeper'), runner: join(outDir, 'summon-runner'),
    sha: { gatekeeper: out['summon-gatekeeper']!, runner: out['summon-runner']! } }
}

if (import.meta.main) console.log(JSON.stringify(buildNuance(join(import.meta.dir, '..', 'dist', 'nuance')), null, 2))
