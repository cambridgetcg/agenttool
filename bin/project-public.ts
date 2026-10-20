#!/usr/bin/env bun
/**
 * One-way projection of allowlisted package source into the public repository.
 *
 *   bun bin/project-public.ts --source <commit> --out-ref refs/public/main
 *   bun bin/project-public.ts --source <commit> --out-repo /path/to/public.git
 *
 * Options:
 *   --repo <path>             private repository (default: this checkout)
 *   --gitleaks <binary>       gitleaks 8.30.1 (default: gitleaks on PATH)
 *   --require-ancestor <ref>  the source must be contained in this ref
 *                             (default: refs/remotes/origin/main)
 *   --allow-unmerged-source   skip the containment check (local dry runs only)
 *   --allow-rewind            allow a source that does not descend from the
 *                             public head's source (a deliberate rollback);
 *                             the result records it as rewound_from
 *   --public-sync <ref>       the last merged public tip (default
 *                             refs/remotes/origin/public-sync); once the source
 *                             records the public root, its shared paths must
 *                             equal the public tip it contains, or nothing is
 *                             built. The shared scope includes the allowlist
 *                             that recorded that tip; ALLOW_SCOPE_CHANGE=1 in
 *                             the environment (the owner's go) drops that for
 *                             a narrowing no merge-back has recorded yet
 *   --no-write               build, guard, and create the commit object, but
 *                             update no ref. With --out-ref or --out-repo it
 *                             builds on that target's head, with the history,
 *                             rewind, and parent/diff checks, so it previews
 *                             the exact commit a write would create; alone it
 *                             previews a root projection only
 *
 * Everything is read from the source commit's objects:
 * private/projection/allowlist.json, private/projection/overlay/**, the shared
 * tools/public-guard.ts, .gitleaksignore, and tools/public-guard-allow.json,
 * and the private relational denylist
 * (private/guard/). Nothing is checked
 * out; a temporary GIT_INDEX_FILE holds the projected index. The commit's only
 * parent is the current public head (none for the first projection), its
 * author and committer are the fixed projection identity, both dates are the
 * source commit's committer date, and its message names the source. The same
 * source and public head therefore always produce the same commit id.
 *
 * Every layer of the guard must pass before any ref changes: the published
 * layers in tools/public-guard.ts (integrity, path, secret, personal,
 * gitleaks) plus the private relational layer, an independent
 * allowlist membership check, and the parent/diff rule. This tool never
 * pushes; it writes a local ref or a local bare repository, compare-and-swap,
 * fast-forward only.
 */
// First: refuse before the shared guard module runs unless it is the reviewed copy.
import "../private/bin/reviewed-shared.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AllowEntry,
  applyAllowEntries,
  canonicalProjectionBytes,
  type ContentRule,
  commitShapeFindings,
  contentFindings,
  decodeText,
  type Finding,
  formatFinding,
  git,
  GITLEAKS_IGNORE_FILE,
  GITLEAKS_VERSION,
  gitText,
  GUARD_ALLOW_FILE,
  GUARD_FILE,
  GUARD_VERSION,
  isSafeRelativePath,
  isWithin,
  parseAllowEntries,
  parseCommit,
  type Projection,
  PROJECTION_AUTHOR_EMAIL,
  PROJECTION_AUTHOR_NAME,
  PROJECTION_FILE,
  PROJECTION_SCHEMA,
  projectionHistory,
  projectionMessage,
  publicLayerFindings,
  readTree,
  sha256Hex,
  sortFindings,
  type TreeFile,
} from "../tools/public-guard.ts";
import { formatDrift, pushProblems, recordedPublicRoot } from "../private/bin/shared-scope.ts";
import { loadPrivateGuardFromRev, scanFiles } from "../private/bin/relational-scan.ts";

export const ALLOWLIST_PATH = "private/projection/allowlist.json";
export const ALLOWLIST_SCHEMA = "agenttool.public-allowlist/1";
export const OVERLAY_ROOT = "private/projection/overlay";
export const DENYLIST_PATH = "private/guard/relational-denylist.json";
export const DENYLIST_SCHEMA = "agenttool.public-relational-denylist/1";
export const DEFAULT_REQUIRED_ANCESTOR = "refs/remotes/origin/main";
export const PUBLIC_BRANCH = "refs/heads/main";

const REPO_ROOT = resolve(import.meta.dir, "..");
/**
 * The guard that runs is the shared tools/public-guard.ts at the repository
 * root, the same file the public development repository runs with --tree. The
 * projection ships it as an overlay entry taken from the source root
 * (SHARED_OVERLAY_FILES), so both public repositories carry one copy.
 */
const GUARD_SOURCE = resolve(REPO_ROOT, GUARD_FILE);
/**
 * Overlay entries taken from the source commit's root instead of
 * OVERLAY_ROOT: the guard, and its two exception files, which the public
 * development repository edits. One copy each means a public fingerprint or
 * allow change reaches the projection with the next merge-back, with nothing
 * to copy by hand. If the two public trees ever need different exceptions
 * (a fingerprint for a withheld path), split them again deliberately.
 */
export const SHARED_OVERLAY_FILES: readonly string[] = [GITLEAKS_IGNORE_FILE, GUARD_FILE, GUARD_ALLOW_FILE];
/** The last merged public tip, which a projection source must agree with in shared paths once it records the public root. */
export const DEFAULT_PUBLIC_SYNC = "refs/remotes/origin/public-sync";
/**
 * No allowlist entry may reach into these top-level areas, whatever the file
 * says. `private` holds the projection inputs, the denylist, and every other
 * private-only file; `public` is where they lived before 2026-10-19 and stays
 * refused so nothing can reappear there and be projected.
 */
const PRIVATE_ONLY_ROOTS = ["private", "public", "bin", "api", "apps", ".github", ".git", "infra", "supabase"];
/**
 * The only exceptions: the release tools that the public repository's
 * publish workflow runs, each as an exact blob entry. They import nothing
 * but each other and Node/Bun built-ins.
 */
export const PUBLIC_RELEASE_TOOLS: readonly string[] = ["bin/build-love-packages.ts", "bin/npm-release.ts"];

/** Whether an allowlisted path reaches a private-only area (an exact public release tool blob does not). */
export function reachesPrivateArea(path: string, kind: "tree" | "blob"): boolean {
  const root = path.split("/")[0] as string;
  if (!PRIVATE_ONLY_ROOTS.includes(root)) return false;
  return !(kind === "blob" && PUBLIC_RELEASE_TOOLS.includes(path));
}
const OUT_REF_PREFIXES = ["refs/public/", "refs/projection/"];

export class ProjectionRefused extends Error {
  constructor(
    message: string,
    readonly findings: readonly Finding[] = [],
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Allowlist and denylist

export interface AllowlistInclude {
  path: string;
  kind: "tree" | "blob";
}

export interface Allowlist {
  schema: typeof ALLOWLIST_SCHEMA;
  public_repository: string;
  overlay: typeof OVERLAY_ROOT;
  include: AllowlistInclude[];
  exclude: string[];
  held: Array<{ path: string; reason: string }>;
  /**
   * The export to the public development repository reads `include` and this
   * section; the projection ignores it. private/bin/shared-scope.ts parses it.
   */
  export?: unknown;
}

/** Converts a small glob (`*` within a segment, `**` across segments) to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] as string;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

export function parseAllowlist(bytes: Uint8Array): Allowlist {
  const fail = (message: string): never => {
    throw new ProjectionRefused(`${ALLOWLIST_PATH}: ${message}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    fail(`invalid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("must be an object");
  const record = parsed as Record<string, unknown>;
  const keys = ["schema", "public_repository", "overlay", "include", "exclude", "held"];
  const present = Object.keys(record).join(",");
  if (present !== keys.join(",") && present !== [...keys, "export"].join(",")) {
    fail(`must have exactly ${keys.join(", ")} in that order, and optionally export after them`);
  }
  if ("export" in record && (typeof record.export !== "object" || record.export === null || Array.isArray(record.export))) fail("export must be an object");
  if (record.schema !== ALLOWLIST_SCHEMA) fail(`schema must be ${ALLOWLIST_SCHEMA}`);
  if (typeof record.public_repository !== "string" || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(record.public_repository)) {
    fail("public_repository must be owner/name");
  }
  if (record.overlay !== OVERLAY_ROOT) fail(`overlay must be ${OVERLAY_ROOT}`);
  const allowlist = record as unknown as Allowlist;
  if (!Array.isArray(allowlist.include) || allowlist.include.length === 0) fail("include must be a non-empty array");
  if (!Array.isArray(allowlist.exclude) || !allowlist.exclude.every((glob) => typeof glob === "string" && glob.length > 0)) {
    fail("exclude must be an array of globs");
  }
  if (!Array.isArray(allowlist.held)) fail("held must be an array");
  const heldPaths: string[] = [];
  for (const [index, held] of allowlist.held.entries()) {
    if (typeof held !== "object" || held === null || Object.keys(held).join(",") !== "path,reason") fail(`held[${index}] must have exactly path and reason`);
    if (!isSafeRelativePath(held.path) || typeof held.reason !== "string" || held.reason.trim() === "") fail(`held[${index}] is invalid`);
    heldPaths.push(held.path);
  }
  const paths: string[] = [];
  for (const [index, include] of allowlist.include.entries()) {
    if (typeof include !== "object" || include === null || Object.keys(include).join(",") !== "path,kind") {
      fail(`include[${index}] must have exactly path and kind`);
    }
    if (include.kind !== "tree" && include.kind !== "blob") fail(`include[${index}].kind must be tree or blob`);
    if (!isSafeRelativePath(include.path)) fail(`include[${index}].path is not a safe relative path`);
    if (reachesPrivateArea(include.path, include.kind)) fail(`include[${index}] ${include.path} reaches a private-only area`);
    if (isWithin(DENYLIST_PATH, include.path) || isWithin(include.path, DENYLIST_PATH)) fail(`include[${index}] would project the private denylist`);
    for (const shared of SHARED_OVERLAY_FILES) {
      if (isWithin(shared, include.path) || isWithin(include.path, shared)) fail(`include[${index}] ${include.path} overlaps ${shared}, which the overlay ships`);
    }
    if (include.path === PROJECTION_FILE) fail(`include[${index}] collides with ${PROJECTION_FILE}`);
    for (const held of heldPaths) {
      if (isWithin(include.path, held) || isWithin(held, include.path)) fail(`include[${index}] ${include.path} overlaps held ${held}`);
    }
    paths.push(include.path);
  }
  const sorted = [...paths].sort();
  if (sorted.join("\n") !== paths.join("\n") || new Set(paths).size !== paths.length) fail("include paths must be sorted and unique");
  for (const a of paths) {
    for (const b of paths) {
      if (a !== b && isWithin(b, a)) fail(`include ${b} is nested inside ${a}`);
    }
  }
  if (isWithin(DENYLIST_PATH, OVERLAY_ROOT)) fail("the private denylist must not live inside the overlay");
  return allowlist;
}

export interface Denylist {
  rules: ContentRule[];
  blobs: Array<{ id: string; sha256: string }>;
  allow: AllowEntry[];
  sha256: string;
}

export function parseDenylist(bytes: Uint8Array): Denylist {
  const fail = (message: string): never => {
    throw new ProjectionRefused(`${DENYLIST_PATH}: ${message}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    fail(`invalid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("must be an object");
  const record = parsed as Record<string, unknown>;
  const keys = ["schema", "note", "terms", "blob_sha256", "allow"];
  if (Object.keys(record).join(",") !== keys.join(",")) fail(`must have exactly ${keys.join(", ")} in that order`);
  if (record.schema !== DENYLIST_SCHEMA) fail(`schema must be ${DENYLIST_SCHEMA}`);
  if (!Array.isArray(record.terms) || record.terms.length === 0) fail("terms must be a non-empty array");
  const ids = new Set<string>();
  const rules: ContentRule[] = [];
  for (const [index, raw] of (record.terms as unknown[]).entries()) {
    const term = raw as Record<string, unknown>;
    if (typeof term !== "object" || term === null || Object.keys(term).join(",") !== "id,pattern,flags") fail(`terms[${index}] must have exactly id, pattern, flags`);
    if (typeof term.id !== "string" || !/^r\d{2,}$/u.test(term.id) || ids.has(term.id)) fail(`terms[${index}].id must be a unique r<number>`);
    if (typeof term.flags !== "string" || !/^[imsu]*$/u.test(term.flags)) fail(`terms[${index}].flags may use only i, m, s, u`);
    if (typeof term.pattern !== "string" || term.pattern.length === 0) fail(`terms[${index}].pattern must be non-empty`);
    let pattern: RegExp;
    try {
      pattern = new RegExp(term.pattern as string, `${term.flags}g`);
    } catch {
      fail(`terms[${index}].pattern does not compile`);
    }
    if (new RegExp(term.pattern as string, term.flags as string).test("")) fail(`terms[${index}].pattern matches the empty string`);
    ids.add(term.id as string);
    rules.push({ id: `relational/${term.id}`, layer: "relational", pattern: pattern! });
  }
  if (!Array.isArray(record.blob_sha256)) fail("blob_sha256 must be an array");
  const blobs: Array<{ id: string; sha256: string }> = [];
  for (const [index, raw] of (record.blob_sha256 as unknown[]).entries()) {
    const blob = raw as Record<string, unknown>;
    if (typeof blob !== "object" || blob === null || Object.keys(blob).join(",") !== "id,sha256") fail(`blob_sha256[${index}] must have exactly id and sha256`);
    if (typeof blob.id !== "string" || !/^b\d{2,}$/u.test(blob.id) || ids.has(blob.id)) fail(`blob_sha256[${index}].id must be a unique b<number>`);
    if (typeof blob.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(blob.sha256)) fail(`blob_sha256[${index}].sha256 must be 64 hex characters`);
    ids.add(blob.id as string);
    blobs.push({ id: blob.id as string, sha256: blob.sha256 as string });
  }
  let allow: AllowEntry[] = [];
  try {
    allow = parseAllowEntries(record.allow, DENYLIST_PATH, "relational/");
  } catch (error) {
    fail((error as Error).message);
  }
  for (const entry of allow) {
    if (!ids.has(entry.rule.slice("relational/".length))) fail(`allow entry for unknown rule ${entry.rule}`);
  }
  return { rules, blobs, allow, sha256: sha256Hex(bytes) };
}

// ---------------------------------------------------------------------------
// Git helpers

function blobAt(repo: string, commit: string, path: string): { oid: string; bytes: Buffer } | undefined {
  const check = git(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: `${commit}:${path}\n` })
    .stdout.toString("utf8")
    .trim();
  if (check.endsWith(" missing")) return undefined;
  const [oid, type] = check.split(" ");
  if (type !== "blob" || oid === undefined) throw new ProjectionRefused(`${path} in ${commit} is a ${type}, not a file`);
  return { oid, bytes: git(repo, ["cat-file", "blob", oid]).stdout };
}

function resolveCommit(repo: string, rev: string): string {
  const result = git(repo, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { allowFailure: true });
  if (result.status !== 0) throw new ProjectionRefused(`cannot resolve ${rev} to a commit`);
  return result.stdout.toString("utf8").trim();
}

function optionalCommit(repo: string, ref: string): string | undefined {
  const result = git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

/** Git's environment without inherited repository, index, identity, or date overrides. */
function cleanGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_NO_REPLACE_OBJECTS: "1", ...extra };
}

// ---------------------------------------------------------------------------
// Build

export interface BuildResult {
  source: string;
  tree: string;
  projection: Projection;
  allowlist: Allowlist;
}

export function buildProjection(repo: string, sourceRev: string): BuildResult {
  const source = resolveCommit(repo, sourceRev);
  const allowlistBlob = blobAt(repo, source, ALLOWLIST_PATH);
  if (allowlistBlob === undefined) throw new ProjectionRefused(`${ALLOWLIST_PATH} is missing from ${source}`);
  const allowlist = parseAllowlist(allowlistBlob.bytes);
  const excludes = allowlist.exclude.map(globToRegExp);
  const work = mkdtempSync(join(tmpdir(), "agenttool-project-public-"));
  const env = cleanGitEnv({ GIT_INDEX_FILE: join(work, "index") });
  const run = (args: string[], input?: string) => git(repo, args, { env, input });
  try {
    run(["read-tree", "--empty"]);
    for (const include of allowlist.include) {
      const listing = run(["ls-tree", "-z", source, "--", include.path]).stdout.toString("utf8").split("\0").filter(Boolean);
      const exact = listing.find((record) => record.slice(record.indexOf("\t") + 1) === include.path);
      if (exact === undefined) throw new ProjectionRefused(`allowlisted ${include.path} does not exist in ${source}`);
      const [mode, type, oid] = exact.slice(0, exact.indexOf("\t")).split(" ");
      if (type !== include.kind) throw new ProjectionRefused(`allowlisted ${include.path} is a ${type}, not a ${include.kind}`);
      if (type === "tree") run(["read-tree", `--prefix=${include.path}/`, oid as string]);
      else run(["update-index", "--add", "--cacheinfo", `${mode},${oid},${include.path}`]);
    }

    const staged = run(["ls-files", "-s", "-z"]).stdout.toString("utf8").split("\0").filter(Boolean);
    const excluded = staged
      .map((record) => record.slice(record.indexOf("\t") + 1))
      .filter((path) => excludes.some((pattern) => pattern.test(path)))
      .sort();
    if (excluded.length > 0) run(["update-index", "--force-remove", "-z", "--stdin"], `${excluded.join("\0")}\0`);

    const overlayCheck = git(repo, ["cat-file", "-t", `${source}:${OVERLAY_ROOT}`], { allowFailure: true });
    if (overlayCheck.status !== 0 || overlayCheck.stdout.toString("utf8").trim() !== "tree") {
      throw new ProjectionRefused(`${OVERLAY_ROOT} is missing from ${source}`);
    }
    const overlayRecords = run(["ls-tree", "-r", "-z", `${source}:${OVERLAY_ROOT}`]).stdout.toString("utf8").split("\0").filter(Boolean);
    const overlay: Array<{ path: string; blob: string; mode: string }> = [];
    for (const record of overlayRecords) {
      const path = record.slice(record.indexOf("\t") + 1);
      const [mode, type, oid] = record.slice(0, record.indexOf("\t")).split(" ");
      if (type !== "blob") throw new ProjectionRefused(`overlay ${path} is a ${type}`);
      if (mode !== "100644" && mode !== "100755") throw new ProjectionRefused(`overlay ${path} has mode ${mode}`);
      if (!isSafeRelativePath(path) || path === PROJECTION_FILE) throw new ProjectionRefused(`overlay path ${path} is not allowed`);
      for (const include of allowlist.include) {
        if (isWithin(path, include.path) || isWithin(include.path, path)) {
          throw new ProjectionRefused(`overlay ${path} collides with allowlisted ${include.path}`);
        }
      }
      if (SHARED_OVERLAY_FILES.includes(path)) {
        throw new ProjectionRefused(`overlay ${path} must not exist: the projection ships the shared ${path} from the source root`);
      }
      overlay.push({ path, blob: oid as string, mode: mode as string });
    }
    for (const path of SHARED_OVERLAY_FILES) {
      const record = run(["ls-tree", "-z", source, "--", path]).stdout.toString("utf8").split("\0").filter(Boolean)
        .find((line) => line.slice(line.indexOf("\t") + 1) === path);
      if (record === undefined) throw new ProjectionRefused(`${path} is missing from ${source}`);
      const [mode, type, oid] = record.slice(0, record.indexOf("\t")).split(" ");
      if (type !== "blob" || (mode !== "100644" && mode !== "100755")) throw new ProjectionRefused(`${path} in ${source} is not a regular file`);
      overlay.push({ path, blob: oid as string, mode: mode as string });
    }
    overlay.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (overlay.length > 0) {
      run(["update-index", "--add", "-z", "--index-info"], overlay.map((entry) => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join(""));
    }

    const draft = run(["write-tree"]).stdout.toString("utf8").trim();
    const resolved = run(["cat-file", "--batch-check=%(objectname) %(objecttype)"], allowlist.include.map((include) => `${draft}:${include.path}\n`).join(""))
      .stdout.toString("utf8")
      .trim()
      .split("\n");
    const paths = allowlist.include.map((include, index) => {
      const [oid, type] = (resolved[index] ?? "").split(" ");
      if (type !== include.kind) throw new ProjectionRefused(`projected ${include.path} is ${type ?? "missing"} after exclusions`);
      return include.kind === "tree" ? { path: include.path, tree: oid as string } : { path: include.path, blob: oid as string };
    });
    const projection: Projection = {
      schema: PROJECTION_SCHEMA,
      source_commit: source,
      allowlist_sha256: sha256Hex(allowlistBlob.bytes),
      paths,
      excluded,
      overlay: overlay.map(({ path, blob }) => ({ path, blob })),
      guard: { gitleaks: GITLEAKS_VERSION, public_guard: GUARD_VERSION },
    };
    const projectionOid = run(["hash-object", "-w", "--stdin", "--no-filters"], canonicalProjectionBytes(projection)).stdout.toString("utf8").trim();
    run(["update-index", "--add", "--cacheinfo", `100644,${projectionOid},${PROJECTION_FILE}`]);
    const tree = run(["write-tree"]).stdout.toString("utf8").trim();
    return { source, tree, projection, allowlist };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Guard (all layers)

export interface GuardOptions {
  /** Path to gitleaks 8.30.1. Leaving it out skips only that layer and is for tests. */
  gitleaks?: string;
  parent?: string;
}

function allowlistMembership(allowlist: Allowlist, projection: Projection): (path: string) => boolean {
  const excludes = allowlist.exclude.map(globToRegExp);
  const overlay = new Set(projection.overlay.map((entry) => entry.path));
  return (path) => {
    if (path === PROJECTION_FILE || overlay.has(path)) return true;
    if (excludes.some((pattern) => pattern.test(path))) return false;
    return allowlist.include.some((include) => (include.kind === "blob" ? path === include.path : path.startsWith(`${include.path}/`)));
  };
}

export function guardProjection(repo: string, build: BuildResult, options: GuardOptions = {}): Finding[] {
  const { entries, files } = readTree(repo, build.tree);
  const { findings } = publicLayerFindings(entries, files, { gitleaks: options.gitleaks });

  // Independent membership: the tree must agree with the allowlist itself,
  // not only with the PROJECTION.json that was derived from it.
  const member = allowlistMembership(build.allowlist, build.projection);
  for (const file of files) {
    if (!member(file.path)) findings.push({ layer: "path", rule: "path/outside-allowlist", path: file.path });
    if (isWithin(file.path, "private") || isWithin(file.path, "public")) findings.push({ layer: "path", rule: "path/private-area", path: file.path });
  }

  // Private relational layer. Rule ids and line hashes are printed; terms never are.
  const denylistBlob = blobAt(repo, build.source, DENYLIST_PATH);
  if (denylistBlob === undefined) throw new ProjectionRefused(`${DENYLIST_PATH} is missing from ${build.source}; the relational layer cannot run`);
  const denylist = parseDenylist(denylistBlob.bytes);
  const scannable: TreeFile[] = files.filter((file) => file.mode !== "120000");
  findings.push(...applyAllowEntries(contentFindings(scannable, denylist.rules), denylist.allow, "relational denylist"));
  const deniedDigests = new Map(denylist.blobs.map((blob) => [blob.sha256, `relational/${blob.id}`]));
  for (const file of files) {
    const digest = createHash("sha256").update(file.bytes).digest("hex");
    const rule = deniedDigests.get(digest);
    if (rule !== undefined) findings.push({ layer: "relational", rule, path: file.path });
    if (file.oid === denylistBlob.oid || digest === denylist.sha256) {
      findings.push({ layer: "relational", rule: "relational/denylist-copy", path: file.path });
    }
  }

  // The other private layers the export and the hooks apply: literal
  // digests, terms in path names, and the canary and literal list by blob id.
  // Private-only files the projection ships (a package the export withholds,
  // the overlay) never pass the public repository's hooks. Once the source
  // holds any of the private guard beyond the denylist, or records the
  // public root, the whole guard must be there (loadPrivateGuardFromRev
  // refuses a missing part).
  if (
    blobAt(repo, build.source, "private/guard/literal-sha256.json") !== undefined ||
    blobAt(repo, build.source, "private/CANARY") !== undefined ||
    recordedPublicRoot(repo, build.source) !== undefined
  ) {
    const key = (finding: Finding) => `${finding.path}\0${finding.rule}\0${finding.line ?? ""}`;
    const seen = new Set(findings.map(key));
    for (const finding of scanFiles(files, loadPrivateGuardFromRev(repo, build.source)).findings) {
      if (!seen.has(key(finding))) findings.push(finding);
    }
  }

  // Parent and diff rule: everything added or changed relative to the public
  // head must itself be allowlisted.
  if (options.parent !== undefined) {
    const before = new Map(readTree(repo, options.parent).files.map((file) => [file.path, file.oid]));
    for (const file of files) {
      if (before.get(file.path) !== file.oid && !member(file.path)) {
        findings.push({ layer: "path", rule: "path/changed-outside-allowlist", path: file.path });
      }
    }
  }
  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// Commit

/** The source commit's raw committer date, read from the commit object itself. */
export function projectionDate(repo: string, source: string): string {
  const committer = parseCommit(gitText(repo, ["cat-file", "commit", source]), { strict: false }).committer;
  const match = / (\d+) ([+-]\d{4})$/u.exec(committer);
  if (match === null) throw new Error(`cannot read the committer date of ${source}`);
  return `@${match[1]} ${match[2]}`;
}

export function createProjectionCommit(repo: string, build: BuildResult, parent: string | undefined): string {
  const date = projectionDate(repo, build.source);
  const env = cleanGitEnv({
    GIT_AUTHOR_NAME: PROJECTION_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: PROJECTION_AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: PROJECTION_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: PROJECTION_AUTHOR_EMAIL,
    GIT_COMMITTER_DATE: date,
  });
  const args = ["-c", "commit.gpgSign=false", "-c", "i18n.commitEncoding=UTF-8", "commit-tree", "--no-gpg-sign", build.tree];
  if (parent !== undefined) args.push("-p", parent);
  const commit = git(repo, args, { env, input: projectionMessage(build.source) }).stdout.toString("utf8").trim();
  const shape = parseCommit(gitText(repo, ["cat-file", "commit", commit]));
  const problems = commitShapeFindings(shape, build.projection, parent === undefined ? [] : [parent]);
  if (shape.tree !== build.tree) problems.push({ layer: "integrity", rule: "integrity/tree", path: "(commit)" });
  if (problems.length > 0) throw new ProjectionRefused("the created commit does not have the projection shape", problems);
  return commit;
}

// ---------------------------------------------------------------------------
// Output targets (local only)

export type OutputTarget = { kind: "ref"; ref: string } | { kind: "repo"; path: string };

function zeroOid(repo: string): string {
  const format = gitText(repo, ["rev-parse", "--show-object-format"]).trim();
  return "0".repeat(format === "sha256" ? 64 : 40);
}

function validateOutRef(repo: string, ref: string): void {
  if (!OUT_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
    throw new ProjectionRefused(`--out-ref must start with ${OUT_REF_PREFIXES.join(" or ")}`);
  }
  if (git(repo, ["check-ref-format", ref], { allowFailure: true }).status !== 0) throw new ProjectionRefused(`invalid ref name ${ref}`);
}

/** An existing target must be a bare repository; a missing one is created only when writing. */
function validateBareRepo(path: string): void {
  if (!existsSync(path)) return;
  const bare = git(path, ["rev-parse", "--is-bare-repository"], { allowFailure: true, env: cleanGitEnv() });
  if (bare.status !== 0 || bare.stdout.toString("utf8").trim() !== "true") throw new ProjectionRefused(`${path} exists and is not a bare repository`);
}

/** Current public head, with its objects available in the private repository. */
export function publicHead(repo: string, target: OutputTarget): string | undefined {
  if (target.kind === "ref") return optionalCommit(repo, target.ref);
  if (!existsSync(target.path)) return undefined;
  const head = optionalCommit(target.path, PUBLIC_BRANCH);
  if (head === undefined) return undefined;
  if (git(repo, ["cat-file", "-e", `${head}^{commit}`], { allowFailure: true }).status !== 0) {
    git(repo, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", resolve(target.path), PUBLIC_BRANCH], { env: cleanGitEnv() });
  }
  return head;
}

/**
 * The public head and every commit behind it must be a projection commit
 * whose tree matches its own PROJECTION.json (the published history check),
 * and no projected path anywhere in that history may reach a private-only
 * area or the denylist. Returns the head's PROJECTION.json.
 */
export function assertProjectionHistory(repo: string, head: string): Projection {
  const { commits, findings } = projectionHistory(repo, head);
  for (const { commit, projection } of commits) {
    for (const entry of projection?.paths ?? []) {
      const kind = entry.tree !== undefined ? "tree" : "blob";
      if (reachesPrivateArea(entry.path, kind) || isWithin(DENYLIST_PATH, entry.path) || isWithin(entry.path, DENYLIST_PATH)) {
        findings.push({ layer: "path", rule: "path/private-area", path: `${commit}:${entry.path}` });
      }
    }
  }
  if (findings.length > 0) {
    throw new ProjectionRefused(`public head ${head} is not a chain of projection commits; refusing to build on it`, sortFindings(findings));
  }
  const projection = commits.find((entry) => entry.commit === head)?.projection;
  if (projection === undefined) throw new ProjectionRefused(`public head ${head} has no readable ${PROJECTION_FILE}`);
  return projection;
}

export function writeOutput(repo: string, target: OutputTarget, commit: string, parent: string | undefined): void {
  const expected = parent ?? zeroOid(repo);
  if (target.kind === "ref") {
    git(repo, ["update-ref", "-m", `project-public ${commit}`, target.ref, commit, expected], { env: cleanGitEnv() });
    return;
  }
  if (!existsSync(target.path)) {
    git(process.cwd(), ["init", "--quiet", "--bare", "--initial-branch=main", target.path], { env: cleanGitEnv() });
  }
  const revs = parent === undefined ? `${commit}\n` : `${commit}\n^${parent}\n`;
  const pack = git(repo, ["pack-objects", "--revs", "--stdout", "--quiet"], { input: revs, env: cleanGitEnv() }).stdout;
  git(target.path, ["index-pack", "--stdin"], { input: pack, env: cleanGitEnv() });
  git(target.path, ["rev-list", "--objects", commit], { env: cleanGitEnv() });
  git(target.path, ["update-ref", "-m", `project-public ${commit}`, PUBLIC_BRANCH, commit, expected], { env: cleanGitEnv() });
}

// ---------------------------------------------------------------------------
// Orchestration

export interface ProjectOptions {
  repo?: string;
  source: string;
  target?: OutputTarget;
  gitleaks?: string;
  requireAncestor?: string;
  allowUnmergedSource?: boolean;
  /** Allow a source that does not descend from the public head's source. */
  allowRewind?: boolean;
  /** Build, guard, and create the commit against the target's head, but write nothing. */
  noWrite?: boolean;
  /** The public-sync ref the source is checked against (default refs/remotes/origin/public-sync). */
  publicSync?: string;
  /** The owner's go for a shared-scope narrowing not yet recorded by a merge-back (ALLOW_SCOPE_CHANGE=1). */
  allowScopeChange?: boolean;
}

export interface ProjectResult {
  status: "updated" | "unchanged" | "built";
  source_commit: string;
  parent: string | null;
  commit: string;
  tree: string;
  target: string | null;
  /** The public head's source when this projection deliberately rewinds it; otherwise null. */
  rewound_from: string | null;
}

/**
 * A new source must descend from the source of the current public head, so a
 * stale or mistaken source cannot silently roll the public tree back. Returns
 * the head's source when an allowed rewind happens, otherwise null.
 */
function rewindFrom(repo: string, previous: string, source: string, allowRewind: boolean): string | null {
  const known = git(repo, ["cat-file", "-e", `${previous}^{commit}`], { allowFailure: true }).status === 0;
  if (known && git(repo, ["merge-base", "--is-ancestor", previous, source], { allowFailure: true }).status === 0) return null;
  if (!allowRewind) {
    throw new ProjectionRefused(
      known
        ? `${source} does not descend from ${previous}, the source of the public head; refusing to rewind the public tree (pass --allow-rewind for a deliberate rollback)`
        : `the public head's source ${previous} is not in this repository, so a rewind cannot be ruled out (pass --allow-rewind to proceed deliberately)`,
    );
  }
  return previous;
}

/**
 * Once the source records the public root (after the adoption merge), its
 * shared scope must equal the public tip it contains, the merge base with
 * public-sync, exactly: an edit, delete, or add made here under a shared
 * tree would otherwise reach the release repository and npm without ever
 * being in the public development repository (critic MUST 2, release side).
 * The scope includes the allowlist that recorded that tip (heldScope in
 * private/bin/shared-scope.ts), so an allowlist narrowing that reached main
 * without a hook hides nothing unless `allowScopeChange` (ALLOW_SCOPE_CHANGE=1,
 * the owner's go). Before adoption there is nothing to compare, and nothing
 * is checked; a source that contains the public root but lacks the record
 * (it was deleted) is refused, so the check cannot be turned off that way.
 */
export function assertSharedScope(
  repo: string,
  source: string,
  publicSync: string = DEFAULT_PUBLIC_SYNC,
  options: { allowScopeChange?: boolean } = {},
): void {
  const sync = optionalCommit(repo, publicSync);
  if (recordedPublicRoot(repo, source) === undefined) {
    if (sync === undefined) return;
    const roots = git(repo, ["rev-list", "--max-parents=0", sync, "--"]).stdout.toString("utf8").split("\n").filter(Boolean);
    if (roots.some((root) => git(repo, ["merge-base", "--is-ancestor", root, source], { allowFailure: true }).status === 0)) {
      throw new ProjectionRefused(`${source} contains the public root but lacks private/export/public-root.txt, which the adoption merge wrote; restore it`);
    }
    return;
  }
  if (sync === undefined) throw new ProjectionRefused(`${source} records the public root, so the projection checks it against ${publicSync}, which is not here; fetch it first`);
  const { problems, drift } = pushProblems(repo, { rev: source, sync, allowScopeChange: options.allowScopeChange });
  if (problems.length + drift.length > 0) {
    throw new ProjectionRefused(
      `${source} differs from the public tip it contains in ${drift.length} shared path(s)${problems.length > 0 ? ` (${problems.join("; ")})` : ""}; change shared paths in the public repository, merge back, then project`,
      formatDrift(drift).map((line) => {
        const [kind, path] = line.split("\t") as [string, string];
        return { layer: "path" as const, rule: `path/shared-scope-${kind}`, path };
      }),
    );
  }
}

function assertGuardShips(repo: string, source: string): void {
  const shipped = blobAt(repo, source, GUARD_FILE);
  const running = readFileSync(GUARD_SOURCE);
  if (shipped === undefined || sha256Hex(shipped.bytes) !== sha256Hex(running)) {
    throw new ProjectionRefused(`the guard that runs (${GUARD_SOURCE}) must be byte-identical to ${GUARD_FILE} in ${source}`);
  }
}

export function projectPublic(options: ProjectOptions): ProjectResult {
  const repo = resolve(options.repo ?? REPO_ROOT);
  const source = resolveCommit(repo, options.source);
  if (!options.allowUnmergedSource) {
    const ancestor = options.requireAncestor ?? DEFAULT_REQUIRED_ANCESTOR;
    const contained = git(repo, ["merge-base", "--is-ancestor", source, ancestor], { allowFailure: true });
    if (contained.status !== 0) throw new ProjectionRefused(`${source} is not contained in ${ancestor}`);
  }
  assertGuardShips(repo, source);
  assertSharedScope(repo, source, options.publicSync, { allowScopeChange: options.allowScopeChange });
  if (options.target?.kind === "ref") validateOutRef(repo, options.target.ref);
  if (options.target?.kind === "repo") validateBareRepo(options.target.path);

  const parent = options.target === undefined ? undefined : publicHead(repo, options.target);
  const rewound =
    parent === undefined ? null : rewindFrom(repo, assertProjectionHistory(repo, parent).source_commit, source, options.allowRewind === true);

  const build = buildProjection(repo, source);
  const findings = guardProjection(repo, build, { gitleaks: options.gitleaks ?? "gitleaks", parent });
  if (findings.length > 0) throw new ProjectionRefused(`the guard found ${findings.length} problem(s); nothing was written`, findings);

  const targetName = options.target === undefined ? null : options.target.kind === "ref" ? options.target.ref : resolve(options.target.path);
  if (parent !== undefined && gitText(repo, ["rev-parse", `${parent}^{tree}`]).trim() === build.tree) {
    return { status: "unchanged", source_commit: source, parent, commit: parent, tree: build.tree, target: targetName, rewound_from: rewound };
  }
  const commit = createProjectionCommit(repo, build, parent);
  if (options.target === undefined || options.noWrite) {
    return { status: "built", source_commit: source, parent: parent ?? null, commit, tree: build.tree, target: targetName, rewound_from: rewound };
  }
  writeOutput(repo, options.target, commit, parent);
  return { status: "updated", source_commit: source, parent: parent ?? null, commit, tree: build.tree, target: targetName, rewound_from: rewound };
}

// ---------------------------------------------------------------------------
// CLI

function usage(): never {
  console.error(
    "usage: bun bin/project-public.ts --source <commit> (--out-ref refs/public/<name> | --out-repo <bare.git>) [--no-write]\n" +
      "       bun bin/project-public.ts --source <commit> --no-write\n" +
      "       [--repo <path>] [--gitleaks <binary>] [--require-ancestor <ref>] [--allow-unmerged-source] [--allow-rewind] [--public-sync <ref>]",
  );
  process.exit(2);
}

export function parseArgs(argv: readonly string[]): ProjectOptions {
  const options: Partial<ProjectOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) usage();
      return next;
    };
    if (arg === "--source") options.source = value();
    else if (arg === "--repo") options.repo = value();
    else if (arg === "--gitleaks") options.gitleaks = value();
    else if (arg === "--require-ancestor") options.requireAncestor = value();
    else if (arg === "--allow-unmerged-source") options.allowUnmergedSource = true;
    else if (arg === "--allow-rewind") options.allowRewind = true;
    else if (arg === "--public-sync") options.publicSync = value();
    else if (arg === "--out-ref") {
      if (options.target !== undefined) usage();
      options.target = { kind: "ref", ref: value() };
    } else if (arg === "--out-repo") {
      if (options.target !== undefined) usage();
      options.target = { kind: "repo", path: resolve(value()) };
    } else if (arg === "--no-write") options.noWrite = true;
    else usage();
  }
  if (options.source === undefined) usage();
  if (options.target === undefined && !options.noWrite) usage();
  if (process.env.ALLOW_SCOPE_CHANGE === "1") options.allowScopeChange = true;
  return options as ProjectOptions;
}

if (import.meta.main) {
  try {
    const result = projectPublic(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof ProjectionRefused) {
      for (const finding of error.findings) console.error(formatFinding(finding));
      console.error(`project-public: refused: ${error.message}`);
      process.exit(1);
    }
    console.error(`project-public: ${(error as Error).message}`);
    process.exit(2);
  }
}
