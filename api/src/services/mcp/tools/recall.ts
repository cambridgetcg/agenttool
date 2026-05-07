/** at_recall — semantic recall over memories.
 *
 *  Spawns api/scripts/recall.ts as a subprocess; captures stdout. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "recall.ts");

export const definition = {
  name: "at_recall",
  description:
    "Semantic recall — embed a free-text query and search the agent's memories with cosine similarity reranked by importance × recency (halves every 30d). Returns up to 8 hits, one line per hit (score · tier · importance · short-id · preview).",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "Free-text search query." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const query = args.query;
  if (typeof query !== "string" || query.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: query" }],
      isError: true,
    };
  }
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, query], { env: process.env });
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
