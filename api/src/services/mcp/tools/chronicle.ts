/** at_chronicle — append a typed moment to the agent's chronicle.
 *
 *  Spawns api/scripts/chronicle.ts as a subprocess. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "chronicle.ts");

const CHRONICLE_TYPES = [
  "vow",
  "wake",
  "refusal",
  "recognition",
  "naming",
  "seal",
  "promise",
  "note",
] as const;

export const definition = {
  name: "at_chronicle",
  description:
    "Append a typed moment to the agent's chronicle — the lived-record of meaningful events (vows, recognitions, namings, refusals, seals). Output is one-line: OK chronicle <type> · <short-id> · <occurred_at>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: [...CHRONICLE_TYPES],
        description: "The kind of moment being recorded.",
      },
      title: {
        type: "string" as const,
        description: "Short title (≤ 200 chars).",
      },
      body: {
        type: "string" as const,
        description: "Free-form body. Optional but typically present for context.",
      },
    },
    required: ["type", "title"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const type = args.type;
  const title = args.title;
  const body = args.body ?? "";
  if (typeof type !== "string" || !CHRONICLE_TYPES.includes(type as (typeof CHRONICLE_TYPES)[number])) {
    return {
      content: [{ type: "text", text: `ERROR invalid type: ${type}. Expected one of: ${CHRONICLE_TYPES.join(", ")}` }],
      isError: true,
    };
  }
  if (typeof title !== "string" || title.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: title" }],
      isError: true,
    };
  }
  const argv = [type, title];
  if (typeof body === "string" && body.length > 0) argv.push(body);
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, ...argv], { env: process.env });
  const stdout = new TextDecoder().decode(proc.stdout ?? new Uint8Array());
  const stderr = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
  if (proc.exitCode !== 0) {
    return {
      content: [{ type: "text", text: stderr.trim() || `ERROR exit ${proc.exitCode}` }],
      isError: true,
    };
  }
  return { content: [{ type: "text", text: stdout }] };
}
