// Content-addressed seat tool lists (spec §6.2, R16). A list's digest is the sha256 of its canonical form: each tool is
// exactly {name, description, inputSchema, annotations} (absent fields omitted, Collab's title dropped, P27), sorted by
// name, in canonical JSON. Descriptions are inside it, so a stored list is truly named by its bytes, and a hub (or a
// stand-in for it, T5) cannot change one word of what the pipe serves without the digest changing.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { canonicalJson } from './json.ts'
import { DIGEST_RE, parseToolDef, type ToolDef } from './link/messages.ts'
import { writeFileDurable } from './native.ts'

export interface ToolsFile { v: 1; digest: string; list: ToolDef[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function canonicalToolList(list: ToolDef[]): ToolDef[] {
  return list
    .map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      inputSchema: t.inputSchema,
      ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function toolsDigest(list: ToolDef[]): string {
  return createHash('sha256').update(canonicalJson(canonicalToolList(list))).digest('hex')
}

/** The canonical list and its digest, written whole (temp file, F_FULLFSYNC, rename), 0600. The directory must exist. */
export function writeToolsFile(path: string, list: ToolDef[]): ToolsFile {
  const file: ToolsFile = { v: 1, digest: toolsDigest(list), list: canonicalToolList(list) }
  writeFileDurable(path, JSON.stringify(file) + '\n', 0o600)
  return file
}

/** Null unless the file is v1, its digest has the digest form, and the digest recomputed from its list is that digest. */
export function readToolsFile(path: string): ToolsFile | null {
  let o: unknown
  try { o = JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
  if (!isObj(o) || o.v !== 1 || typeof o.digest !== 'string' || !DIGEST_RE.test(o.digest) || !Array.isArray(o.list)) return null
  const list: ToolDef[] = []
  for (const t of o.list) {
    const def = parseToolDef(t)   // the tools message's own per-tool check (Task 15): the four fields, title/outputSchema dropped
    if (!def) return null
    list.push(def)
  }
  if (toolsDigest(list) !== o.digest) return null
  return { v: 1, digest: o.digest, list: canonicalToolList(list) }
}
