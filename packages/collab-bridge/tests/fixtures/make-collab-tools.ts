// Writes tests/fixtures/collab-tools-0.5.0.json: the initialize serverInfo and tools/list of this tree's tracked
// Collab dist (P35), taken from one child on a throwaway journal. Run by hand from the package root:
//   bun --no-env-file --config=/dev/null tests/fixtures/make-collab-tools.ts
// It runs outside `bun test`, so no preload protects it: it makes its own temp HOME, XDG_DATA_HOME and journal,
// builds the child's env from an explicit key list (never process.env, P14), and refuses to spawn unless the journal's
// directory resolves inside its own temp dir, so it can never open ~/.local/share/agenttool/collab.sqlite (K21, K30).
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ToolDef } from '../../src/link/messages.ts'
import { COLLAB_DIST } from '../helpers.ts'
import { stdioHarness } from '../mcp-harness.ts'

export const FIXTURE_PATH = join(import.meta.dir, 'collab-tools-0.5.0.json')

/** The fixture's format: Collab's own entries, `title` included, in Collab's order. */
export interface ToolsFixture { v: 1; server: { name: string; version: string }; mcp_sha256: string; tools: Array<ToolDef & { title?: string }> }

export function readToolsFixture(): ToolsFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ToolsFixture
}

/** Throws unless `journal`'s directory, by its realpath, is `tempDir` or inside it. */
export function assertTempJournal(journal: string, tempDir: string): void {
  let dir: string
  try {
    dir = realpathSync(dirname(journal))
  } catch {
    throw new Error(`make-collab-tools: the journal's directory does not resolve: ${journal}`)
  }
  const root = realpathSync(tempDir)
  if (dir !== root && !dir.startsWith(root + '/')) throw new Error(`make-collab-tools: refusing a journal outside ${root}: ${journal}`)
}

export async function collectTools(dist: string, timeoutMs = 20_000): Promise<ToolsFixture> {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cb-tools-')))
  try {
    const home = join(tmp, 'home')
    const xdg = join(tmp, 'xdg')
    const jdir = join(tmp, 'journal')
    for (const d of [home, xdg, jdir]) mkdirSync(d, { mode: 0o700 })
    const journal = join(jdir, 'collab.sqlite')
    assertTempJournal(journal, tmp)
    const mcp = join(dist, 'agenttool-collab-mcp.js')
    const env = { HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', XDG_DATA_HOME: xdg, AGENTOOL_COLLAB_DB: journal }
    const h = stdioHarness({ argv: [process.execPath, '--no-env-file', '--config=/dev/null', mcp], env, cwd: '/' })
    try {
      const [init, listed] = await Promise.race([
        (async () => [await h.initialize(), await h.listTools()])(),
        Bun.sleep(timeoutMs).then(() => { throw new Error(`make-collab-tools: no tools/list answer within ${timeoutMs} ms`) }),
      ])
      const server = init?.serverInfo as { name: string; version: string } | undefined
      if (!server || server.name !== 'agenttool-collab') throw new Error('make-collab-tools: initialize did not answer as agenttool-collab')
      if (!listed || !Array.isArray(listed.tools)) throw new Error('make-collab-tools: tools/list returned no tools')
      const mcp_sha256 = createHash('sha256').update(readFileSync(mcp)).digest('hex')
      return { v: 1, server: { name: server.name, version: server.version }, mcp_sha256, tools: listed.tools as ToolsFixture['tools'] }
    } finally {
      await h.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const fixture = await collectTools(COLLAB_DIST)
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`wrote ${FIXTURE_PATH}: ${fixture.tools.length} tools from ${fixture.server.name} ${fixture.server.version}, mcp sha256 ${fixture.mcp_sha256}`)
}

if (import.meta.main) await main()
