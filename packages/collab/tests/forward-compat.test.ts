import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../src/canonical.js";
import type { CollabEvent, EventCursor } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
import {
  COLLAB_NOTES_EVENT_TYPES,
  exerciseFixture,
  FIXTURE_VIEWS,
  FixtureClock,
  VIEW_STATE_TABLES,
  type FixtureManifest,
} from "./compat/fixture.js";
import { GOLDEN_BARE_REPORT_BODY, type GoldenOutcome } from "./compat/golden-scenario.js";
import { normaliseEvents, Placeholders, type EventRow } from "./compat/normalise.js";

// Forward compatibility (Collab Notes spec 8.5): older builds keep opening,
// verifying, paging, acking and writing a journal this build wrote, and this
// build reads back what they wrote. Older builds re-verify the whole chain on
// every open and share the same SQLite file, so any break here breaks a device.

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = spawnSync("git", ["-C", packageRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .stdout?.trim() || packageRoot;
const worker = join(import.meta.dir, "compat", "old-store-worker.ts");
const DEFAULT_REVISIONS = ["collab-v0.4.0", "collab-v0.5.0", "1ec5ab4b", "a8799aad"];
const GOLDEN_REVISION = "a8799aad";
const WORKER_TIMEOUT_MS = 60_000;
const HOST_TIMEOUT_MS = 20_000;
const MCP_REQUEST_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 180_000;

const work = mkdtempSync(join(tmpdir(), "agenttool-collab-compat-"));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Revisions

interface Ships {
  mcp: boolean;
  host: boolean;
  host_wait: boolean;
  host_seat_ref: boolean;
}

interface StoreCapabilities {
  event_addresses_session: boolean;
  proposal_status: boolean;
}

/**
 * What each default revision is known to contain. Detection must agree, so a
 * detection mistake can never quietly skip a check.
 */
const KNOWN_REVISIONS: Record<string, { ships: Ships; store: StoreCapabilities }> = {
  // collab-v0.4.0
  e6302579e7f815ee03f1024df2c725ed36189715: {
    ships: { mcp: true, host: false, host_wait: false, host_seat_ref: false },
    store: { event_addresses_session: false, proposal_status: false },
  },
  // collab-v0.5.0
  bc71e87edc2c3cf921a25a38dc01ec4ec49cf157: {
    ships: { mcp: true, host: true, host_wait: false, host_seat_ref: false },
    store: { event_addresses_session: false, proposal_status: false },
  },
  // main before consent
  "1ec5ab4bebda3009e38633ce0d0f60d1ceff24dd": {
    ships: { mcp: true, host: true, host_wait: true, host_seat_ref: false },
    store: { event_addresses_session: true, proposal_status: false },
  },
  // consent S1+S2 and seat_ref
  a8799aad9f8d9774b6c966b970d4219a222fad22: {
    ships: { mcp: true, host: true, host_wait: true, host_seat_ref: true },
    store: { event_addresses_session: true, proposal_status: true },
  },
};

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  // From the repository root, so archive pathspecs name the same tree paths as `rev:path`.
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", timeout: 30_000 });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

interface Revision {
  name: string;
  sha: string | null;
  missing: string | null;
  ships: Ships;
}

function missingMessage(name: string, detail: string): string {
  return `Compatibility revision "${name}" is not in this clone (${detail.trim() || "git rev-parse failed"}). `
    + "The forward-compatibility harness needs full git history: set fetch-depth: 0 on the actions/checkout step, "
    + `or fetch ${name}. It does not skip a missing revision; COLLAB_COMPAT_REVS chooses the revisions.`;
}

function resolveRevision(name: string): Revision {
  const none: Ships = { mcp: false, host: false, host_wait: false, host_seat_ref: false };
  const parsed = git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  const sha = parsed.stdout.trim();
  if (!parsed.ok || !/^[0-9a-f]{40}$/.test(sha)) {
    return { name, sha: null, missing: missingMessage(name, parsed.stderr), ships: none };
  }
  const has = (path: string) => git(["cat-file", "-e", `${sha}:packages/collab/${path}`]).ok;
  const host = has("dist/agenttool-collab-host.js");
  const hostSource = host ? git(["show", `${sha}:packages/collab/src/host.ts`]).stdout : "";
  const usage = /COLLAB_HOST_USAGE =([\s\S]*?);\n/.exec(hostSource)?.[1] ?? "";
  return {
    name,
    sha,
    missing: null,
    ships: {
      mcp: has("dist/agenttool-collab-mcp.js"),
      host,
      host_wait: host && usage.includes("agenttool-collab-host wait"),
      host_seat_ref: host && usage.includes("--seat-ref"),
    },
  };
}

// A blank value means the default list: an empty run would be a skip in disguise.
const requestedRevisions = (process.env.COLLAB_COMPAT_REVS ?? "").trim().split(/\s+/).filter(Boolean);
const revisions = (requestedRevisions.length ? requestedRevisions : DEFAULT_REVISIONS).map(resolveRevision);
const golden = resolveRevision(GOLDEN_REVISION);

function lazy<T>(make: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= make());
}

const archives = new Map<string, () => Promise<string>>();
/** `git archive <rev> packages/collab` into a temp directory; returns its packages/collab. */
function archive(revision: Revision): Promise<string> {
  let make = archives.get(revision.sha!);
  if (!make) {
    make = lazy(async () => {
      const directory = join(work, "archives", revision.sha!);
      mkdirSync(directory, { recursive: true });
      const tarball = join(work, "archives", `${revision.sha}.tar`);
      const archived = git(["archive", "--format=tar", "-o", tarball, revision.sha!, "packages/collab"]);
      if (!archived.ok) throw new Error(`git archive ${revision.name} failed: ${archived.stderr}`);
      const extracted = spawnSync("tar", ["-xf", tarball, "-C", directory], { encoding: "utf8", timeout: 30_000 });
      if (extracted.status !== 0) throw new Error(`tar failed for ${revision.name}: ${extracted.stderr}`);
      return join(directory, "packages", "collab");
    });
    archives.set(revision.sha!, make);
  }
  return make();
}

// ---------------------------------------------------------------------------
// Processes

function hermeticEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const home = join(work, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  // Nothing from the machine running the tests: no Claude or Codex session ids,
  // no seat refs, no default journal under the real home directory.
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_DATA_HOME: join(home, "xdg"),
    TMPDIR: tmpdir(),
    GIT_CEILING_DIRECTORIES: tmpdir(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...extra,
  };
}

async function run(
  command: string[],
  options: { timeout_ms: number; cwd?: string; env?: Record<string, string> },
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? work,
    env: options.env ?? hermeticEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeout_ms);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (timedOut) {
      throw new Error(`timed out after ${options.timeout_ms} ms: ${command.join(" ")}\n${stderr}`);
    }
    return { exit_code: exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

interface WorkerOutput {
  errors: Record<string, string>;
  [field: string]: unknown;
}

async function runWorker(args: string[]): Promise<WorkerOutput> {
  const result = await run([process.execPath, worker, ...args], { timeout_ms: WORKER_TIMEOUT_MS });
  let output: WorkerOutput;
  try {
    output = JSON.parse(result.stdout) as WorkerOutput;
  } catch {
    throw new Error(`worker ${args[0]} printed no result (exit ${result.exit_code}):\n${result.stdout}\n${result.stderr}`);
  }
  if (result.exit_code !== 0) throw new Error(`worker ${args[0]} exited ${result.exit_code}: ${result.stderr}`);
  return output;
}

/** A minimal stdio MCP client for an old dist bundle, every request bounded. */
class StdioMcp {
  private readonly child: ReturnType<typeof Bun.spawn>;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffered = "";
  private nextId = 1;

  constructor(bundle: string, databasePath: string, cwd: string) {
    this.child = Bun.spawn([process.execPath, bundle], {
      cwd,
      env: hermeticEnvironment({ AGENTOOL_COLLAB_DB: databasePath }),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.reader = (this.child.stdout as ReadableStream<Uint8Array>).getReader();
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agenttool-collab-compat", version: "0.0.0" },
    });
    this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  async tools(): Promise<string[]> {
    const listed = await this.request("tools/list", {}) as { tools: Array<{ name: string }> };
    return listed.tools.map((tool) => tool.name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
    const result = await this.request("tools/call", { name, arguments: args }) as {
      isError?: boolean;
      structuredContent?: Record<string, any>;
      content?: Array<{ text: string }>;
    };
    const content = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
    if (result.isError) throw new Error(`old MCP ${name} failed: ${JSON.stringify(content)}`);
    return content;
  }

  async close(): Promise<void> {
    this.child.kill();
    await this.child.exited;
  }

  private write(message: Record<string, unknown>): void {
    const stdin = this.child.stdin as { write(text: string): void; flush(): void };
    stdin.write(`${JSON.stringify(message)}\n`);
    stdin.flush();
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    const deadline = Date.now() + MCP_REQUEST_TIMEOUT_MS;
    while (true) {
      const message = await this.read(deadline, method);
      if (message.id !== id) continue;
      if (message.error) throw new Error(`old MCP ${method} failed: ${JSON.stringify(message.error)}`);
      return message.result;
    }
  }

  private async read(deadline: number, method: string): Promise<Record<string, any>> {
    while (true) {
      const newline = this.buffered.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffered.slice(0, newline).trim();
        this.buffered = this.buffered.slice(newline + 1);
        if (line) return JSON.parse(line) as Record<string, any>;
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`old MCP ${method} timed out after ${MCP_REQUEST_TIMEOUT_MS} ms`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        this.reader.read(),
        new Promise<"timeout">((done) => {
          timer = setTimeout(() => done("timeout"), remaining);
        }),
      ]);
      clearTimeout(timer);
      if (next === "timeout") throw new Error(`old MCP ${method} timed out after ${MCP_REQUEST_TIMEOUT_MS} ms`);
      if (next.done) throw new Error(`old MCP closed its stdout during ${method}`);
      this.buffered += this.decoder.decode(next.value, { stream: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Journals

/**
 * Fold the WAL into the main file. bun:sqlite can leave a closed connection's
 * WAL on disk, and a copy of the main file alone would then miss every write.
 */
function checkpoint(databasePath: string): void {
  const db = new Database(databasePath);
  try {
    const result = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number };
    if (result.busy !== 0) throw new Error(`journal ${databasePath} is still in use`);
  } finally {
    db.close();
  }
  const wal = `${databasePath}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error(`journal ${databasePath} kept its WAL`);
}

/** Copy a closed, checkpointed journal and its credential files, keeping their private modes. */
function copyJournal(fromDirectory: string, toDirectory: string): string {
  checkpoint(join(fromDirectory, "collab.sqlite"));
  mkdirSync(toDirectory, { recursive: true, mode: 0o700 });
  chmodSync(toDirectory, 0o700);
  copyFileSync(join(fromDirectory, "collab.sqlite"), join(toDirectory, "collab.sqlite"));
  chmodSync(join(toDirectory, "collab.sqlite"), 0o600);
  const sessions = join(fromDirectory, "collab-sessions");
  if (existsSync(sessions)) {
    const target = join(toDirectory, "collab-sessions");
    mkdirSync(target, { mode: 0o700 });
    chmodSync(target, 0o700);
    for (const file of readdirSync(sessions)) {
      copyFileSync(join(sessions, file), join(target, file));
      chmodSync(join(target, file), 0o600);
    }
  }
  return join(toDirectory, "collab.sqlite");
}

function eventRows(databasePath: string): Array<EventRow & { workspace_id: string; sequence: number; hash: string; epoch_id: string }> {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, type, entity_id, actor, session_id,
        occurred_at, payload_json, hash
      FROM events ORDER BY workspace_id, sequence
    `).all() as Array<EventRow & { workspace_id: string; sequence: number; hash: string; epoch_id: string }>;
  } finally {
    db.close();
  }
}

function listAllReports(store: CollabStore, workspaceId: string): Array<{ id: string; body: string; event_sequence: number }> {
  const reports: Array<{ id: string; body: string; event_sequence: number }> = [];
  let after = 0;
  while (true) {
    const page = store.listReports(workspaceId, { after_event_sequence: after, limit: 100 });
    for (const report of page) reports.push({ id: report.id, body: report.body, event_sequence: report.event_sequence });
    if (page.length < 100) return reports;
    after = page[page.length - 1]!.event_sequence;
  }
}

function allEvents(store: CollabStore, workspaceId: string): CollabEvent[] {
  const events: CollabEvent[] = [];
  let after = 0;
  while (true) {
    const page = store.eventsSince(workspaceId, after, 500);
    events.push(...page.events);
    if (!page.has_more || page.events.length === 0) return events;
    after = page.events[page.events.length - 1]!.sequence;
  }
}

function verifyAll(store: CollabStore): Record<string, boolean> {
  const verified: Record<string, boolean> = {};
  for (const { id } of store.db.query(`SELECT id FROM workspaces ORDER BY id`).all() as Array<{ id: string }>) {
    verified[id] = store.verifyJournal(id);
  }
  return verified;
}

function computeViews(databasePath: string, manifest: FixtureManifest, at: string): Record<string, string> {
  const store = new CollabStore(databasePath, { now: () => new Date(at) });
  try {
    return Object.fromEntries(Object.entries(FIXTURE_VIEWS).map(([name, view]) => [name, canonicalJson(view(store, manifest))]));
  } finally {
    store.close();
  }
}

/** The CollabEventType union as written in a protocol.ts source. */
function eventTypeUnion(protocolSource: string): string[] {
  const union = /export type CollabEventType =([^;]+);/.exec(protocolSource)?.[1];
  if (!union) throw new Error("CollabEventType union not found");
  return [...union.matchAll(/"([^"]+)"/g)].map((match) => match[1]!).sort();
}

interface SchemaSnapshot {
  user_version: number;
  application_id: number;
  migrations: unknown[];
  objects: Map<string, { type: string; tbl_name: string; sql: string | null }>;
  foreign_keys: Map<string, number>;
}

function schema(databasePath: string): SchemaSnapshot {
  const db = new Database(databasePath, { readonly: true });
  try {
    const objects = new Map(
      (db.query(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>)
        .map((row) => [row.name, { type: row.type, tbl_name: row.tbl_name, sql: row.sql }]),
    );
    const foreignKeys = new Map<string, number>();
    for (const [name, object] of objects) {
      if (object.type !== "table") continue;
      foreignKeys.set(name, (db.query(`SELECT COUNT(*) AS count FROM pragma_foreign_key_list(?)`).get(name) as { count: number }).count);
    }
    return {
      user_version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      application_id: (db.query("PRAGMA application_id").get() as { application_id: number }).application_id,
      migrations: db.query(`SELECT version FROM schema_migrations ORDER BY version`).all(),
      objects,
      foreign_keys: foreignKeys,
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// The fixture, written once by this build

interface Fixture {
  directory: string;
  manifest: FixtureManifest;
  /** The instant every proposal view is read at, by both builds. */
  status_at: string;
  views: Record<string, string>;
  reports: Array<{ id: string; body: string; event_sequence: number }>;
  /** Legacy-type events this build routes to the waiter after its anchor. */
  waiter_legacy_sequences: number[];
}

const fixture = lazy(async (): Promise<Fixture> => {
  const directory = join(work, "fixture");
  const root = join(directory, "repo");
  mkdirSync(root, { recursive: true });
  const state = join(directory, "state");
  // Started half an hour ago so that older builds, which read the real clock,
  // still see the fixture's sessions and leases as recent.
  const clock = new FixtureClock(Date.now() - 30 * 60_000);
  const store = new CollabStore(join(state, "collab.sqlite"), { now: clock.now });
  let manifest: FixtureManifest;
  try {
    manifest = await exerciseFixture(store, { root, clock });
  } finally {
    store.close();
  }
  const statusAt = new Date(clock.time + 60_000).toISOString();
  const readCopy = copyJournal(state, join(directory, "read-copy"));
  const views = computeViews(readCopy, manifest, statusAt);
  const reader = new CollabStore(readCopy, { now: () => new Date(statusAt) });
  try {
    const reports = listAllReports(reader, manifest.workspace_id);
    const notes = new Set<string>(COLLAB_NOTES_EVENT_TYPES);
    const waiterLegacySequences = allEvents(reader, manifest.workspace_id)
      .filter((event) =>
        event.sequence > manifest.waiter.after_anchor.sequence
        && event.session_id !== manifest.waiter.session_id
        && !notes.has(event.type)
        && reader.eventAddressesSession(event, manifest.waiter.session_id))
      .map((event) => event.sequence);
    return { directory: state, manifest, status_at: statusAt, views, reports, waiter_legacy_sequences: waiterLegacySequences };
  } finally {
    reader.close();
  }
});

describe("forward-compatibility fixture", () => {
  test("covers every Collab Notes event type this build defines", async () => {
    const { manifest } = await fixture();
    const current = eventTypeUnion(readFileSync(join(packageRoot, "src", "protocol.ts"), "utf8"));
    const notes = new Set<string>(COLLAB_NOTES_EVENT_TYPES);
    // A type this build can write must be in the fixture, so older builds meet it.
    for (const type of current.filter((type) => notes.has(type))) expect(manifest.event_types).toContain(type);
    for (const type of manifest.produced_types) expect(manifest.event_types).toContain(type);
    for (const type of manifest.event_types) expect(current).toContain(type);
    expect(manifest.head_sequence).toBeGreaterThan(40);
    // The waiter's doorbell must have at least one legacy event to ring for.
    expect((await fixture()).waiter_legacy_sequences.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  test("adds no event type beyond a8799aad's union except the spec's", async () => {
    if (!golden.sha) throw new Error(golden.missing!);
    const base = eventTypeUnion(git(["show", `${golden.sha}:packages/collab/src/protocol.ts`]).stdout);
    const current = eventTypeUnion(readFileSync(join(packageRoot, "src", "protocol.ts"), "utf8"));
    const added = current.filter((type) => !base.includes(type));
    for (const type of added) expect(COLLAB_NOTES_EVENT_TYPES as readonly string[]).toContain(type);
    for (const type of base) expect(current).toContain(type);
  }, TEST_TIMEOUT_MS);

  test("dropping the view-state tables loses only view state", async () => {
    const { directory, manifest, status_at, views } = await fixture();
    const copy = copyJournal(directory, join(work, "drop-view-state"));
    const db = new Database(copy);
    try {
      for (const table of VIEW_STATE_TABLES) db.exec(`DROP TABLE IF EXISTS "${table}"`);
    } finally {
      db.close();
    }
    const store = new CollabStore(copy);
    try {
      expect(verifyAll(store)).toEqual({ [manifest.workspace_id]: true });
      expect(listAllReports(store, manifest.workspace_id)).toEqual((await fixture()).reports);
    } finally {
      store.close();
    }
    // Reopening recreates the tables; every view reads the same as before the drop.
    expect(computeViews(copy, manifest, status_at)).toEqual(views);
  }, TEST_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Each older revision against a copy of the fixture

interface Inspected {
  capabilities: StoreCapabilities;
  verified: Record<string, boolean>;
  reports: Array<{ id: string; body: string; event_sequence: number }>;
  proposals: unknown[] | null;
  addressing: { new_type_hits: unknown[]; control_addressed: boolean | null; waiter_sequences: number[] } | null;
  paging: {
    types: string[];
    pages: number;
    chain_valid: boolean;
    events_seen: number;
    cursor: EventCursor;
    head_sequence: number;
  } | null;
  task: { task_id: string; status: string; review_status: string | null } | null;
  written: Array<{ id: string; body: string }>;
  errors: Record<string, string>;
}

for (const revision of revisions) {
  describe(`older build ${revision.name}`, () => {
    if (revision.missing) {
      test("is available in this clone", () => {
        throw new Error(revision.missing!);
      });
      return;
    }
    const known = KNOWN_REVISIONS[revision.sha!];
    const directory = join(work, "revisions", revision.sha!);
    const copy = lazy(async () => copyJournal((await fixture()).directory, join(directory, "journal")));

    const inspected = lazy(async (): Promise<Inspected> => {
      const [source, databasePath, { manifest, status_at }] = [await archive(revision), await copy(), await fixture()];
      const request = join(directory, "inspect-request.json");
      writeFileSync(request, JSON.stringify({
        workspace_id: manifest.workspace_id,
        root_path: manifest.root_path,
        new_types: manifest.event_types.filter((type) => (COLLAB_NOTES_EVENT_TYPES as readonly string[]).includes(type)),
        status_at,
        proposals: manifest.proposals,
        waiter: {
          session_id: manifest.waiter.session_id,
          after_sequence: manifest.waiter.after_anchor.sequence,
          addressed_report_id: manifest.waiter.addressed_report_id,
        },
      }));
      return await runWorker(["inspect", join(source, "src"), databasePath, request]) as unknown as Inspected;
    });

    test("ships what it is known to ship", async () => {
      if (known) expect(revision.ships).toEqual(known.ships);
      const source = await archive(revision);
      if (revision.ships.host) {
        const help = await run([process.execPath, join(source, "dist", "agenttool-collab-host.js"), "--help"], {
          timeout_ms: HOST_TIMEOUT_MS,
        });
        const usage = (JSON.parse(help.stdout) as { usage: string }).usage;
        // The bundle and the source it was built from agree.
        expect(usage.includes("agenttool-collab-host wait")).toBe(revision.ships.host_wait);
        expect(usage.includes("--seat-ref")).toBe(revision.ships.host_seat_ref);
      }
      const { capabilities } = await inspected();
      if (known) expect(capabilities).toEqual(known.store);
    }, TEST_TIMEOUT_MS);

    test("opens and verifies the journal, lists byte-equal reports, and keeps proposal status", async () => {
      const result = await inspected();
      const { manifest, reports, views } = await fixture();
      expect(result.errors).toEqual({});
      expect(result.verified[manifest.workspace_id]).toBe(true);
      expect(Object.values(result.verified).every(Boolean)).toBe(true);
      expect(result.reports).toEqual(reports);
      if (result.capabilities.proposal_status) {
        expect(canonicalJson(result.proposals)).toBe(views.proposal_status!);
      } else {
        expect(result.proposals).toBeNull();
      }
    }, TEST_TIMEOUT_MS);

    test("routes no new event type to any session, and still routes legacy ones", async () => {
      const result = await inspected();
      const { waiter_legacy_sequences } = await fixture();
      expect(result.errors).toEqual({});
      if (!result.capabilities.event_addresses_session) {
        expect(result.addressing).toBeNull();
        return;
      }
      expect(result.addressing!.new_type_hits).toEqual([]);
      expect(result.addressing!.control_addressed).toBe(true);
      if (result.capabilities.proposal_status) {
        // This build's routing of legacy events is unchanged from the newest older build's.
        expect(result.addressing!.waiter_sequences).toEqual(waiter_legacy_sequences);
      }
    }, TEST_TIMEOUT_MS);

    test("pages through every event type and acks to the head", async () => {
      const result = await inspected();
      const { manifest } = await fixture();
      expect(result.errors).toEqual({});
      const paging = result.paging!;
      for (const type of manifest.event_types) expect(paging.types).toContain(type);
      expect(paging.chain_valid).toBe(true);
      expect(paging.pages).toBeGreaterThan(1);
      expect(paging.cursor.sequence).toBe(paging.head_sequence);
      expect(paging.events_seen).toBe(paging.head_sequence);
      expect(paging.head_sequence).toBeGreaterThan(manifest.head_sequence);
    }, TEST_TIMEOUT_MS);

    test("creates, claims, completes and reviews a task", async () => {
      const result = await inspected();
      expect(result.errors).toEqual({});
      expect(result.task).toEqual({ task_id: expect.any(String), status: "completed", review_status: "accepted" });
      expect(result.written.length).toBe(2);
    }, TEST_TIMEOUT_MS);

    const host = (source: string) => join(source, "dist", "agenttool-collab-host.js");
    // Every step writes to the same copy, in this order: the old store, the old
    // host, the old MCP, and then this build reads the result back. A failed
    // step is reported by its own test; the later steps still run.
    const settle = (promise: Promise<unknown>) => promise.then(() => undefined, () => undefined);

    const waited = lazy(async () => {
      await settle(inspected());
      const [source, databasePath, { manifest }] = [await archive(revision), await copy(), await fixture()];
      const rows = eventRows(databasePath).filter((row) => row.workspace_id === manifest.workspace_id);
      const bySequence = new Map(rows.map((row) => [row.sequence, row]));
      const head = rows[rows.length - 1]!.sequence;
      const rings: Array<{ sequence: number; type: string }> = [];
      let anchor: EventCursor = manifest.waiter.after_anchor;
      for (let attempt = 0; attempt <= rows.length; attempt += 1) {
        const result = await run([
          process.execPath,
          host(source),
          "wait",
          "--session-file", join(directory, "journal", manifest.waiter.credential_file),
          "--db", databasePath,
          "--addressed",
          "--wait-ms", "200",
          "--after-anchor", JSON.stringify(anchor),
        ], { timeout_ms: HOST_TIMEOUT_MS });
        expect(result.exit_code).toBe(0);
        const receipt = JSON.parse(result.stdout) as { status: string; next_anchor: EventCursor; head_sequence: number };
        if (receipt.status === "idle") {
          return { rings, idle_at: receipt.next_anchor.sequence, head, head_seen: receipt.head_sequence };
        }
        expect(receipt.status).toBe("ready");
        // A ring names the anchor just before the event that rang.
        const rang = bySequence.get(receipt.next_anchor.sequence + 1)!;
        rings.push({ sequence: rang.sequence, type: rang.type });
        anchor = { epoch_id: rang.epoch_id, sequence: rang.sequence, hash: rang.hash };
      }
      throw new Error("the old doorbell never went idle");
    });

    test.skipIf(!revision.ships.host_wait)("old host `wait --addressed` idles over the new event types", async () => {
      const { rings, idle_at, head, head_seen } = await waited();
      const inspectedResult = await inspected();
      expect(idle_at).toBe(head);
      expect(head_seen).toBe(head);
      for (const ring of rings) expect(COLLAB_NOTES_EVENT_TYPES as readonly string[]).not.toContain(ring.type);
      // The host rings exactly where its own store routes events to the waiter.
      expect(rings.map((ring) => ring.sequence)).toEqual(inspectedResult.addressing!.waiter_sequences);
    }, TEST_TIMEOUT_MS);

    const endedByFile = lazy(async () => {
      if (revision.ships.host_wait) await settle(waited());
      const [source, databasePath, { manifest }] = [await archive(revision), await copy(), await fixture()];
      const credential = join(directory, "journal", manifest.end_by_session_file.credential_file);
      const result = await run([
        process.execPath, host(source), "end",
        "--session-file", credential,
        "--reason", "forward-compatibility check",
        "--db", databasePath,
      ], { timeout_ms: HOST_TIMEOUT_MS });
      return { result, credential_removed: !existsSync(credential) };
    });

    test.skipIf(!revision.ships.host)("old host `end --session-file` ends a session this build started", async () => {
      const { result, credential_removed } = await endedByFile();
      const { manifest } = await fixture();
      expect(result.exit_code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "ended",
        session_id: manifest.end_by_session_file.session_id,
      });
      expect(credential_removed).toBe(true);
    }, TEST_TIMEOUT_MS);

    const endedBySeat = lazy(async () => {
      await settle(endedByFile());
      const [source, databasePath, { manifest }] = [await archive(revision), await copy(), await fixture()];
      const result = await run([
        process.execPath, host(source), "end",
        "--seat-ref", manifest.end_by_seat_ref.seat_ref,
        "--reason", "forward-compatibility check",
        "--db", databasePath,
      ], { timeout_ms: HOST_TIMEOUT_MS });
      return {
        result,
        credential_removed: !existsSync(join(directory, "journal", manifest.end_by_seat_ref.credential_file)),
      };
    });

    test.skipIf(!revision.ships.host_seat_ref)("old host `end --seat-ref` ends a session this build started", async () => {
      const { result, credential_removed } = await endedBySeat();
      const { manifest } = await fixture();
      expect(result.exit_code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "ended_by_seat_ref",
        sessions: [{ session_id: manifest.end_by_seat_ref.session_id, status: "ended" }],
      });
      expect(credential_removed).toBe(true);
    }, TEST_TIMEOUT_MS);

    const hostDone = async () => {
      if (revision.ships.host_wait) await settle(waited());
      if (revision.ships.host) await settle(endedByFile());
      if (revision.ships.host_seat_ref) await settle(endedBySeat());
    };

    const mcpPaged = lazy(async () => {
      await hostDone();
      const [source, databasePath, { manifest }] = [await archive(revision), await copy(), await fixture()];
      const client = new StdioMcp(join(source, "dist", "agenttool-collab-mcp.js"), databasePath, directory);
      try {
        await client.initialize();
        const tools = await client.tools();
        const started = await client.call("collab_session_start", {
          root_path: manifest.root_path,
          actor: "old-mcp-reader",
          role: "pages a journal a newer build wrote",
        });
        const types = new Set<string>();
        let pages = 0;
        let cursor: EventCursor = started.session.cursor;
        let head = 0;
        while (pages < 1_000) {
          const next = await client.call("collab_next", { workspace_id: started.workspace.id, event_limit: 10 });
          pages += 1;
          for (const event of next.events.events as Array<{ type: string }>) types.add(event.type);
          head = next.events.head_sequence;
          const acknowledged = await client.call("collab_cursor_ack", {
            workspace_id: started.workspace.id,
            anchor: next.events.next_anchor,
            expected_cursor_version: next.session.cursor_version,
          });
          cursor = acknowledged.session.cursor;
          if (!next.events.has_more) break;
        }
        return { tools, workspace_id: started.workspace.id as string, types: [...types], pages, cursor, head };
      } finally {
        await client.close();
      }
    });

    test.skipIf(!revision.ships.mcp)("old MCP answers tools/list and pages collab_next over every event type", async () => {
      const paged = await mcpPaged();
      const { manifest } = await fixture();
      expect(paged.tools).toContain("collab_session_start");
      expect(paged.tools).toContain("collab_next");
      expect(paged.tools).toContain("collab_cursor_ack");
      expect(paged.workspace_id).toBe(manifest.workspace_id);
      for (const type of manifest.event_types) expect(paged.types).toContain(type);
      expect(paged.pages).toBeGreaterThan(1);
      expect(paged.cursor.sequence).toBe(paged.head);
    }, TEST_TIMEOUT_MS);

    test("this build reads back the journal after the old build wrote to it", async () => {
      await hostDone();
      if (revision.ships.mcp) await settle(mcpPaged());
      const result = await inspected();
      const { manifest, reports, views, status_at } = await fixture();
      const databasePath = await copy();
      const store = new CollabStore(databasePath);
      try {
        const verified = verifyAll(store);
        expect(verified[manifest.workspace_id]).toBe(true);
        expect(Object.values(verified).every(Boolean)).toBe(true);
        const after = new Map(listAllReports(store, manifest.workspace_id).map((report) => [report.id, report.body]));
        for (const report of reports) expect(after.get(report.id)).toBe(report.body);
        for (const report of result.written) expect(after.get(report.id)).toBe(report.body);
        if (revision.ships.host) {
          expect(store.getCoordinationSession(manifest.end_by_session_file.session_id)?.status).toBe("ended");
        }
        if (revision.ships.host_seat_ref) {
          expect(store.getCoordinationSession(manifest.end_by_seat_ref.session_id)?.status).toBe("ended");
        }
      } finally {
        store.close();
      }
      // Older writes change no view this build computes from the journal.
      expect(computeViews(databasePath, manifest, status_at)).toEqual(views);
    }, TEST_TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// Golden: the same tool script on this build and on a8799aad

describe(`golden scenario against ${GOLDEN_REVISION}`, () => {
  if (golden.missing) {
    test("is available in this clone", () => {
      throw new Error(golden.missing!);
    });
    return;
  }
  const root = join(work, "golden", "repo");

  async function runGolden(label: string, source: string): Promise<{ databasePath: string; directory: string; outcome: GoldenOutcome }> {
    const directory = join(work, "golden", label);
    mkdirSync(root, { recursive: true });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const databasePath = join(directory, "collab.sqlite");
    const output = await runWorker(["golden", source, databasePath, root]);
    expect(output.errors).toEqual({});
    checkpoint(databasePath);
    return { databasePath, directory, outcome: output as unknown as GoldenOutcome };
  }

  const current = lazy(() => runGolden("current", join(packageRoot, "src")));
  const base = lazy(async () => {
    const source = await archive(golden);
    // The archived MCP layer imports the same pinned packages; reuse them rather than install.
    const archivedPackage = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as { dependencies: unknown };
    const currentPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { dependencies: unknown };
    expect(archivedPackage.dependencies).toEqual(currentPackage.dependencies);
    if (!existsSync(join(source, "node_modules"))) symlinkSync(join(packageRoot, "node_modules"), join(source, "node_modules"));
    return await runGolden("base", join(source, "src"));
  });

  test("writes the same normalised rows as the base build", async () => {
    const [mine, theirs] = [await current(), await base()];
    const minePlaceholders = new Placeholders();
    const theirPlaceholders = new Placeholders();
    const mineRows = normaliseEvents(eventRows(mine.databasePath), minePlaceholders);
    const theirRows = normaliseEvents(eventRows(theirs.databasePath), theirPlaceholders);
    expect(mineRows.length).toBeGreaterThan(30);
    expect(mineRows).toEqual(theirRows);
    // The proposal hash covers random ids, so compare the bytes it hashes, and check each hash.
    expect(mine.outcome.proposals.length).toBe(theirs.outcome.proposals.length);
    mine.outcome.proposals.forEach((proposal, index) => {
      const other = theirs.outcome.proposals[index]!;
      expect(createHash("sha256").update(proposal.proposal_bytes).digest("hex")).toBe(proposal.proposal_sha256);
      expect(createHash("sha256").update(other.proposal_bytes).digest("hex")).toBe(other.proposal_sha256);
      expect(canonicalJson(minePlaceholders.value(JSON.parse(proposal.proposal_bytes))))
        .toBe(canonicalJson(theirPlaceholders.value(JSON.parse(other.proposal_bytes))));
    });
  }, TEST_TIMEOUT_MS);

  test("a bare collab_report_append writes the same payload keys as the base build", async () => {
    const keys = (databasePath: string) => {
      const db = new Database(databasePath, { readonly: true });
      try {
        const report = db.query(`SELECT id FROM reports WHERE body = ?`).get(GOLDEN_BARE_REPORT_BODY) as { id: string };
        const event = db.query(`SELECT payload_json FROM events WHERE type = 'report.posted' AND entity_id = ?`)
          .get(report.id) as { payload_json: string };
        return Object.keys(JSON.parse(event.payload_json) as Record<string, unknown>).sort();
      } finally {
        db.close();
      }
    };
    const [mine, theirs] = [await current(), await base()];
    expect(keys(mine.databasePath)).toEqual(keys(theirs.databasePath));
  }, TEST_TIMEOUT_MS);

  test("each build verifies the other's chain", async () => {
    const [mine, theirs] = [await current(), await base()];
    const theirCopy = copyJournal(theirs.directory, join(work, "golden", "base-read-by-current"));
    const store = new CollabStore(theirCopy);
    try {
      const verified = verifyAll(store);
      expect(Object.keys(verified).length).toBe(1);
      expect(Object.values(verified).every(Boolean)).toBe(true);
    } finally {
      store.close();
    }
    const mineCopy = copyJournal(mine.directory, join(work, "golden", "current-read-by-base"));
    const output = await runWorker(["verify", join(await archive(golden), "src"), mineCopy]);
    expect(output.errors).toEqual({});
    const verified = output.verified as Record<string, boolean>;
    expect(Object.keys(verified).length).toBe(1);
    expect(Object.values(verified).every(Boolean)).toBe(true);
  }, TEST_TIMEOUT_MS);

  test("the schema stays additive: same version, same tables and checks, new tables view state only", async () => {
    const [mine, theirs] = [schema((await current()).databasePath), schema((await base()).databasePath)];
    expect(mine.user_version).toBe(theirs.user_version);
    expect(mine.application_id).toBe(theirs.application_id);
    expect(mine.migrations).toEqual(theirs.migrations);
    for (const [name, object] of theirs.objects) expect(mine.objects.get(name)).toEqual(object);
    const added = [...mine.objects].filter(([name, object]) => object.type === "table" && !theirs.objects.has(name));
    for (const [name] of added) {
      expect(VIEW_STATE_TABLES).toContain(name);
      expect(name).not.toBe("proposal_rejections");
      expect(mine.foreign_keys.get(name)).toBe(0);
    }
  }, TEST_TIMEOUT_MS);
});
