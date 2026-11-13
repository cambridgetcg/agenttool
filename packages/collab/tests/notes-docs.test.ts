import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import {
  checkNote,
  NOTE_ACTS,
  NOTE_BASES,
  NOTE_CARD_FAMILIES,
  parseNote,
  type NoteAct,
  type NoteInput,
} from "../src/note.js";
import { CollabStore, NOTE_DECISION_OUTCOMES } from "../src/store.js";
import { NOTE_CARD, NOTE_PRINCIPLES, NOTE_VERBS } from "../src/verbs.js";

// Every example in the card, PROTOCOL.md and the two skills is checked here
// against the real parser and the input schemas mcp.ts registers (Collab
// Notes spec 12). Examples are fenced blocks marked in their info string:
// `collab-note` holds one collab-note/1 note, and `collab-call` holds one or
// more tool calls, each a line `<tool> <JSON input>` (the JSON may run on).

const packageRoot = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(packageRoot, path), "utf8");
const HERMES_PREFIX = "mcp_agenttool_";
const SKILL = "skills/coordinate-agent-work/SKILL.md";
const HERMES_SKILL = "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md";

/** The card as the Hermes skill prints it: the same text, with Hermes's tool names. */
const hermesCard = NOTE_CARD.replace(/\bcollab_(arrive|inbox|note|take|done|propose|poll|vote)\b/g, `${HERMES_PREFIX}collab_$1`);

const DOCS: Array<{ name: string; text: string; prefix: string }> = [
  { name: "the card", text: NOTE_CARD, prefix: "" },
  { name: "PROTOCOL.md", text: read("PROTOCOL.md"), prefix: "" },
  { name: SKILL, text: read(SKILL), prefix: "" },
  { name: HERMES_SKILL, text: read(HERMES_SKILL), prefix: HERMES_PREFIX },
];

interface Fence {
  info: string[];
  body: string;
  line: number;
}

/** Fenced blocks at the start of a line, as CommonMark reads them (backtick fences only). */
function fences(text: string): Fence[] {
  const lines = text.split("\n");
  const found: Fence[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^(`{3,})(.*)$/.exec(lines[index]!);
    if (!open) continue;
    const close = new RegExp(`^${open[1]}\\s*$`);
    let end = index + 1;
    while (end < lines.length && !close.test(lines[end]!)) end += 1;
    found.push({ info: open[2]!.trim().split(/\s+/).filter(Boolean), body: lines.slice(index + 1, end).join("\n"), line: index + 1 });
    index = end;
  }
  return found;
}

const isNoteFence = (fence: Fence) => fence.info.includes("collab-note");
const isCallFence = (fence: Fence) => fence.info.includes("collab-call");

const CALL_START = /^((?:mcp_agenttool_)?collab_[a-z_]+)[ \t]+(\{.*)$/;

/** The calls in a collab-call block: each starts at a line naming a tool, and its JSON runs to the next. */
function calls(fence: Fence): Array<{ tool: string; input: unknown; text: string }> {
  const out: Array<{ tool: string; lines: string[] }> = [];
  for (const line of fence.body.split("\n")) {
    const start = CALL_START.exec(line);
    if (start) out.push({ tool: start[1]!, lines: [start[2]!] });
    else if (line.trim() !== "") {
      if (out.length === 0) throw new Error(`line ${fence.line}: a collab-call block starts with a tool name: ${line}`);
      out[out.length - 1]!.lines.push(line);
    }
  }
  return out.map((entry) => {
    const text = entry.lines.join("\n");
    return { tool: entry.tool, input: JSON.parse(text), text };
  });
}

const work = mkdtempSync(join(tmpdir(), "agenttool-collab-docs-"));
const store = new CollabStore(join(work, "collab.sqlite"));
afterAll(() => {
  store.close();
  rmSync(work, { recursive: true, force: true });
});
// The full profile registers every tool, so every documented call can be checked.
const registered = (buildCollabMcpServer(store, { environment: {} }) as any)._registeredTools as Record<string, { inputSchema: any }>;

/** Keys a schema does not name, at any depth (zod objects strip them silently, so a typo would pass safeParse). */
function unknownKeys(schema: any, value: unknown, path: string): string[] {
  const def = schema?.def ?? schema?._def;
  if (!def) return [];
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
      return unknownKeys(def.innerType, value, path);
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
        key in shape ? unknownKeys(shape[key], inner, `${path}.${key}`) : [`${path}.${key}`]);
    }
    case "array":
      return Array.isArray(value) ? value.flatMap((item, index) => unknownKeys(def.element, item, `${path}[${index}]`)) : [];
    case "union": {
      const fits = (def.options as any[]).filter((option) => option.safeParse(value).success);
      return fits.length === 0 ? [] : fits.map((option) => unknownKeys(option, value, path)).sort((a, b) => a.length - b.length)[0]!;
    }
    default:
      return [];
  }
}

// The schemas set types only (the verbs check values and give remedies), so
// the values their descriptions name are checked here too.
const NOTE_ACTS_IN_COLLAB_NOTE = ["note", "support", "challenge", "resolve", "withdraw", "accept", "request_changes", "relay_rejection", "decide"];
const ALLOWED: Record<string, Record<string, readonly string[]>> = {
  collab_note: { act: NOTE_ACTS_IN_COLLAB_NOTE, outcome: NOTE_DECISION_OUTCOMES },
  collab_done: { outcome: ["finished", "released", "blocked", "leave"] },
  collab_take: { review: ["required", "none"] },
  collab_inbox: { include: ["for_me", "all"], format: ["json", "note"] },
};

function valueProblems(tool: string, input: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [field, values] of Object.entries(ALLOWED[tool] ?? {})) {
    if (input[field] !== undefined && !values.includes(input[field] as string)) problems.push(`${field}: ${String(input[field])}`);
  }
  for (const reason of (input.why as Array<{ basis?: string }> | undefined) ?? []) {
    if (reason.basis !== undefined && !(NOTE_BASES as readonly string[]).includes(reason.basis)) problems.push(`basis: ${reason.basis}`);
  }
  return problems;
}

/** What parseNote says about a note example, and what checkNote would refuse when a tool writes it. */
function noteFindings(text: string) {
  const parsed = parseNote(text);
  const { advice, ...fields } = parsed;
  const refusals = parsed.act === null ? ["no act"] : checkNote({ ...fields, act: parsed.act } as NoteInput).map((problem) => problem.message);
  return { act: parsed.act, advice, refusals };
}

describe("documented examples", () => {
  for (const doc of DOCS) {
    describe(doc.name, () => {
      const blocks = fences(doc.text);

      test("has marked examples", () => {
        expect(blocks.filter(isNoteFence).length + blocks.filter(isCallFence).length).toBeGreaterThan(0);
      });

      test("every collab-note example parses with no advice and would be written as it reads", () => {
        for (const fence of blocks.filter(isNoteFence)) {
          expect({ line: fence.line, ...noteFindings(fence.body) })
            .toEqual({ line: fence.line, act: expect.any(String), advice: [], refusals: [] });
        }
      });

      test("every collab-call example fits the input schema its tool registers", () => {
        for (const fence of blocks.filter(isCallFence)) {
          for (const call of calls(fence)) {
            expect({ line: fence.line, prefixed: call.tool.startsWith(HERMES_PREFIX) })
              .toEqual({ line: fence.line, prefixed: doc.prefix !== "" });
            const tool = call.tool.slice(doc.prefix.length);
            const registration = registered[tool];
            expect({ line: fence.line, tool, registered: registration !== undefined }).toEqual({ line: fence.line, tool, registered: true });
            const parsed = registration!.inputSchema.safeParse(call.input);
            expect({ line: fence.line, tool, error: parsed.success ? null : String(parsed.error) })
              .toEqual({ line: fence.line, tool, error: null });
            expect({ line: fence.line, tool, unknown: unknownKeys(registration!.inputSchema, call.input, "input") })
              .toEqual({ line: fence.line, tool, unknown: [] });
            expect({ line: fence.line, tool, values: valueProblems(tool, call.input as Record<string, unknown>) })
              .toEqual({ line: fence.line, tool, values: [] });
            // collab_note reads a text that begins with an act word as a whole note.
            const text = (call.input as { text?: unknown; act?: unknown }).text;
            if (tool === "collab_note" && typeof text === "string" && (call.input as { act?: unknown }).act === undefined
              && /^([a-z_]+): /.test(text) && (NOTE_ACTS as readonly string[]).includes(/^([a-z_]+): /.exec(text)![1]!)) {
              expect({ line: fence.line, ...noteFindings(text) })
                .toEqual({ line: fence.line, act: expect.any(String), advice: [], refusals: [] });
            }
          }
        }
      });

      test("leaves no note or call example unmarked", () => {
        const acts = NOTE_ACTS as readonly string[];
        for (const fence of blocks.filter((block) => !isNoteFence(block) && !isCallFence(block))) {
          const first = fence.body.split("\n")[0] ?? "";
          const act = /^([a-z_]+): /.exec(first)?.[1];
          expect({ line: fence.line, note_shaped: act !== undefined && acts.includes(act) }).toEqual({ line: fence.line, note_shaped: false });
          expect({ line: fence.line, call_shaped: CALL_START.test(first) }).toEqual({ line: fence.line, call_shaped: false });
        }
      });
    });
  }
});

describe("the card", () => {
  test("names every act family, the principles, and how to leave", () => {
    for (const [family, acts] of Object.entries(NOTE_CARD_FAMILIES)) {
      expect(NOTE_CARD).toContain(`- ${family}: ${acts.join(", ")}`);
    }
    NOTE_PRINCIPLES.forEach((principle, index) => expect(NOTE_CARD).toContain(`${index + 1}. ${principle}`));
    for (const verb of NOTE_VERBS) expect(NOTE_CARD).toContain(verb);
    expect(NOTE_CARD).toContain('"outcome": "leave"');
    // About 40 lines, so it fits at the top of an AGENTS.md.
    expect(NOTE_CARD.split("\n").length).toBeLessThanOrEqual(52);
  });

  test("the skill prints it verbatim, and the Hermes skill with Hermes's tool names", () => {
    expect(read(SKILL)).toContain(NOTE_CARD);
    expect(read(HERMES_SKILL)).toContain(hermesCard);
    expect(hermesCard).not.toMatch(/(?<!mcp_agenttool_)\bcollab_(arrive|inbox|note|take|done|propose|poll|vote)\b/);
  });
});

describe("PROTOCOL.md", () => {
  const protocol = read("PROTOCOL.md");
  const blocks = fences(protocol);

  test("works an example of each family of act", () => {
    const acts = new Set<string>();
    for (const fence of blocks.filter(isNoteFence)) acts.add(parseNote(fence.body).act as NoteAct);
    for (const fence of blocks.filter(isCallFence)) {
      for (const call of calls(fence)) {
        const input = call.input as { act?: string; text?: string };
        const verbAct: Record<string, string> = {
          collab_take: "take", collab_done: "done", collab_propose: "propose", collab_poll: "poll", collab_vote: "vote",
        };
        if (verbAct[call.tool]) acts.add(verbAct[call.tool]!);
        if (call.tool === "collab_note") acts.add(input.act ?? parseNote(input.text ?? "").act ?? "note");
      }
    }
    for (const family of Object.values(NOTE_CARD_FAMILIES)) {
      expect({ family, missing: family.filter((act) => !acts.has(act)) }).toEqual({ family, missing: [] });
    }
  });

  test("covers each of the eight verbs with a ready example", () => {
    const tools = new Set(blocks.filter(isCallFence).flatMap((fence) => calls(fence).map((call) => call.tool)));
    expect(NOTE_VERBS.filter((verb) => !tools.has(verb))).toEqual([]);
  });
});
