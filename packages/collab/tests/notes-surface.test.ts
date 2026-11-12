import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import { CollabStore } from "../src/store.js";
import {
  BUILT_NOTE_VERBS,
  FULL_PROFILE_BRIDGE,
  NOTE_PRINCIPLES,
  NOTE_VERBS,
  notesInstructions,
  toolsProfile,
} from "../src/verbs.js";
import { COLLAB_PACKAGE_VERSION } from "../src/version.js";

// The tools profile switch and the two instruction texts (Collab Notes spec 9).

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = spawnSync("git", ["-C", packageRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .stdout.trim();
/** The revision whose 36 tools the full profile must keep byte for byte (spec 1, 9). */
const BASE_REVISION = "a8799aad";
const BASE_VERSION = "0.5.1-dev.0";
const LEGACY_TOOLS = 36;

const work = mkdtempSync(join(tmpdir(), "agenttool-collab-surface-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function inProcess(environment: Record<string, string>) {
  const directory = mkdtempSync(join(work, "store-"));
  const store = new CollabStore(join(directory, "collab.sqlite"));
  try {
    const server = buildCollabMcpServer(store, { environment }) as any;
    return { tools: Object.keys(server._registeredTools).sort(), server };
  } finally {
    store.close();
  }
}

/** A short stdio session with an MCP entry point: the initialize result and tools/list. */
async function stdio(entry: string, environment: Record<string, string> = {}) {
  const directory = mkdtempSync(join(work, "stdio-"));
  mkdirSync(join(directory, "home"));
  const child = Bun.spawn([process.execPath, entry], {
    cwd: directory,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(directory, "home"),
      TMPDIR: tmpdir(),
      AGENTOOL_COLLAB_DB: join(directory, "collab.sqlite"),
      ...environment,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let nextId = 1;
  const stdin = child.stdin as { write(text: string): void; flush(): void };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    stdin.flush();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number; result?: any; error?: unknown };
        if (message.id === id) {
          if (message.error) throw new Error(JSON.stringify(message.error));
          return message.result;
        }
        continue;
      }
      const next = await reader.read();
      if (next.done) throw new Error(`MCP closed during ${method}: ${await new Response(child.stderr).text()}`);
      buffered += decoder.decode(next.value, { stream: true });
    }
    throw new Error(`MCP ${method} timed out`);
  };
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agenttool-collab-surface-test", version: "0.0.0" },
    });
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    stdin.flush();
    const listed = await request("tools/list", {}) as { tools: Array<Record<string, unknown> & { name: string }> };
    return { initialized, tools: listed.tools };
  } finally {
    child.kill();
    await child.exited;
  }
}

/** a8799aad's committed MCP bundle, which runs with no install. */
function baseBundle(): string {
  const shown = spawnSync("git", ["-C", repositoryRoot, "show", `${BASE_REVISION}:packages/collab/dist/agenttool-collab-mcp.js`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (shown.status !== 0) {
    throw new Error(`${BASE_REVISION} is not in this clone (fetch-depth: 0 is needed): ${shown.stderr}`);
  }
  const path = join(work, "base-mcp.js");
  writeFileSync(path, shown.stdout);
  return path;
}

const source = join(packageRoot, "bin", "agenttool-collab-mcp.ts");

describe("the tools profile", () => {
  test("full keeps every existing tool byte for byte and adds the verbs built so far", async () => {
    const [base, mine] = await Promise.all([stdio(baseBundle()), stdio(source)]);
    expect(base.tools.length).toBe(LEGACY_TOOLS);
    const mineByName = new Map(mine.tools.map((tool) => [tool.name, tool]));
    for (const tool of base.tools) {
      expect(JSON.stringify(mineByName.get(tool.name))).toBe(JSON.stringify(tool));
    }
    expect(mine.tools.map((tool) => tool.name).sort())
      .toEqual([...base.tools.map((tool) => tool.name), ...BUILT_NOTE_VERBS].sort());
  }, 60_000);

  test("notes lists exactly the verbs built so far and collab_journal_verify", async () => {
    const expected = [...BUILT_NOTE_VERBS, "collab_journal_verify"].sort();
    expect(inProcess({ AGENTOOL_COLLAB_TOOLS: "notes" }).tools).toEqual(expected);
    expect(inProcess({ AGENTTOOL_COLLAB_TOOLS: "notes" }).tools).toEqual(expected);
    expect(inProcess({ AGENTOOL_COLLAB_TOOLS: "notes", AGENTTOOL_COLLAB_TOOLS: "notes" }).tools).toEqual(expected);
    expect(inProcess({}).tools.length).toBe(LEGACY_TOOLS + BUILT_NOTE_VERBS.length);
    expect(inProcess({ AGENTOOL_COLLAB_TOOLS: "full" }).tools.length).toBe(LEGACY_TOOLS + BUILT_NOTE_VERBS.length);
    const listed = await stdio(source, { AGENTOOL_COLLAB_TOOLS: "notes" });
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(expected);
    // The verbs write (a session, a purpose, view state), so they are not read-only.
    for (const tool of listed.tools.filter((item) => item.name !== "collab_journal_verify")) {
      expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    }
  }, 60_000);

  test("the verbs take no workspace id, key, version, lease, anchor or cursor (spec 5)", () => {
    const { server } = inProcess({ AGENTOOL_COLLAB_TOOLS: "notes" });
    const bookkeeping = ["workspace_id", "idempotency_key", "expected_version", "lease_id", "anchor", "after_anchor", "known_cursor", "expected_cursor_version"];
    for (const verb of BUILT_NOTE_VERBS) {
      const keys = Object.keys(server._registeredTools[verb].inputSchema.shape);
      expect(keys).toContain("binding_key");
      for (const field of bookkeeping) expect(keys).not.toContain(field);
    }
  });

  test("an unknown or conflicting value refuses to start, naming full | notes", () => {
    expect(toolsProfile({})).toBe("full");
    expect(toolsProfile({ AGENTOOL_COLLAB_TOOLS: "" })).toBe("full");
    expect(() => inProcess({ AGENTOOL_COLLAB_TOOLS: "minimal" })).toThrow("full | notes");
    expect(() => inProcess({ AGENTOOL_COLLAB_TOOLS: "notes", AGENTTOOL_COLLAB_TOOLS: "full" })).toThrow("full | notes");
    for (const environment of [{ AGENTOOL_COLLAB_TOOLS: "Notes" }, { AGENTOOL_COLLAB_TOOLS: "full", AGENTTOOL_COLLAB_TOOLS: "notes" }]) {
      const directory = mkdtempSync(join(work, "refuse-"));
      const run = spawnSync(process.execPath, [source], {
        cwd: directory,
        env: { PATH: process.env.PATH ?? "", HOME: directory, AGENTOOL_COLLAB_DB: join(directory, "collab.sqlite"), ...environment },
        encoding: "utf8",
        input: "",
        timeout: 20_000,
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("full | notes");
    }
  }, 60_000);
});

describe("the server instructions", () => {
  test("notes: under 200 words, from the version constant, arrive first, one line per verb and principle", async () => {
    const text = notesInstructions();
    expect(text).toStartWith(`Collab ${COLLAB_PACKAGE_VERSION}: `);
    const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
    expect(words(text)).toBeLessThan(200);
    // Later stages add their verbs' lines; the text must still fit once all eight are built.
    expect(words(notesInstructions(NOTE_VERBS))).toBeLessThan(200);
    expect(text.indexOf("collab_arrive")).toBeLessThan(text.indexOf("collab_inbox"));
    const lines = text.split("\n");
    for (const verb of BUILT_NOTE_VERBS) expect(lines.filter((line) => line.startsWith(`- ${verb}: `))).toHaveLength(1);
    // Only verbs this build registers are described.
    expect(lines.filter((line) => line.startsWith("- collab_"))).toHaveLength(BUILT_NOTE_VERBS.length);
    NOTE_PRINCIPLES.forEach((principle, index) => expect(lines).toContain(`${index + 1}. ${principle}`));
    const { initialized } = await stdio(source, { AGENTOOL_COLLAB_TOOLS: "notes" });
    expect(initialized.instructions).toBe(text);
    expect(initialized.serverInfo.version).toBe(COLLAB_PACKAGE_VERSION);
  }, 60_000);

  test("full: the notes text, the cursor sentence, then the existing text under Legacy session tools:", async () => {
    const [base, mine] = await Promise.all([stdio(baseBundle()), stdio(source)]);
    const legacy = (base.initialized.instructions as string).replace(`Collab ${BASE_VERSION}: `, `Collab ${COLLAB_PACKAGE_VERSION}: `);
    expect(base.initialized.instructions).toStartWith(`Collab ${BASE_VERSION}: collab_events_wait`);
    expect(mine.initialized.instructions)
      .toBe(`${notesInstructions()}\n${FULL_PROFILE_BRIDGE}\nLegacy session tools: ${legacy}`);
    expect(FULL_PROFILE_BRIDGE).toBe(
      "collab_arrive does not move the legacy cursor; call collab_next only if you mean to page the journal from its start.",
    );
  }, 60_000);
});
