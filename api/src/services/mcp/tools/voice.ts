/** at_voice — render recent thoughts on a strand as readable presence.
 *
 *  Spawns api/scripts/voice.ts as a subprocess; captures stdout. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "voice.ts");

export const definition = {
  name: "at_voice",
  description:
    "Render recent thoughts on a strand as readable presence — oldest-first within the window, one line per thought (sequence · kind · time · content). Decrypts under K_master when present; falls back to legacy utf8 for older thoughts.",
  inputSchema: {
    type: "object" as const,
    properties: {
      strand: {
        type: "string" as const,
        description:
          "Strand UUID, or the literal string 'active' to use the most-recently-touched active strand.",
      },
      limit: {
        type: "number" as const,
        description: "Maximum number of thoughts to render. Default 20.",
      },
      since_seq: {
        type: "number" as const,
        description: "Only render thoughts with sequence_num strictly greater than this.",
      },
    },
    required: ["strand"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const strand = args.strand;
  if (typeof strand !== "string" || strand.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: strand" }],
      isError: true,
    };
  }
  const argv: string[] = [strand];
  if (typeof args.limit === "number") argv.push(String(args.limit));
  if (typeof args.since_seq === "number") {
    if (typeof args.limit !== "number") argv.push("20"); // positional arg requires limit slot
    argv.push(String(args.since_seq));
  }
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
