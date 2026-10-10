// Compile the two Nuance programs into standalone arm64 binaries (no runtime needed there).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface NuanceBuild { gatekeeper: string; runner: string; sha: { gatekeeper: string; runner: string } }

export function buildNuance(outDir: string): NuanceBuild {
  mkdirSync(outDir, { recursive: true })
  const root = join(import.meta.dir, '..')
  const out: Record<string, string> = {}
  for (const [name, entry] of [['summon-gatekeeper', 'src/gatekeeper-main.ts'], ['summon-runner', 'src/runner-main.ts']] as const) {
    const target = join(outDir, name)
    const r = Bun.spawnSync(['bun', 'build', '--compile', '--target=bun-darwin-arm64', join(root, entry), '--outfile', target])
    if (r.exitCode !== 0) throw new Error(`build ${name} failed: ${r.stderr.toString()}`)
    out[name] = createHash('sha256').update(readFileSync(target)).digest('hex')
  }
  return { gatekeeper: join(outDir, 'summon-gatekeeper'), runner: join(outDir, 'summon-runner'),
    sha: { gatekeeper: out['summon-gatekeeper']!, runner: out['summon-runner']! } }
}

if (import.meta.main) console.log(JSON.stringify(buildNuance(join(import.meta.dir, '..', 'dist', 'nuance')), null, 2))
