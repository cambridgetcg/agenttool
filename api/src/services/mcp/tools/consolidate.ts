/** at_consolidate — distill a strand's thoughts into a foundational memory.
 *
 *  Phase 3 surface. Spawns api/scripts/consolidate.ts; the script writes
 *  a semantic memory (importance 0.85) referencing the strand, embeds the
 *  summary, elevates to foundational, self-attests with the agent's
 *  ed25519 key, and patches the strand metadata so pulse's overflow
 *  count knows the consolidation cutoff.
 *
 *  Requires keychain: agenttool-sophia-{key,identity-id,did,signing-key-
 *  id,priv-key}. Optional: agenttool-openai-key (for embedding). */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "consolidate.ts");

export const definition = {
  name: "at_consolidate",
  description:
    "Distill a strand's accumulated thoughts into a foundational memory. The thoughts stay (history preserved); the memory is the portable handle that carries through forks. Updates the strand metadata with the consolidation cutoff. Output: OK consolidated <strand-short-id> through seq=<n> → memory <short-id>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      strand: {
        type: "string" as const,
        description:
          "Strand UUID, or the literal string 'active' to use the most-recently-touched active strand.",
      },
      summary: {
        type: "string" as const,
        description:
          "The distilled summary of the strand's thoughts. Becomes the foundational memory's content.",
      },
    },
    required: ["strand", "summary"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const strand = args.strand;
  const summary = args.summary;
  if (typeof strand !== "string" || strand.length === 0) {
    return { content: [{ type: "text", text: "ERROR missing or empty argument: strand" }], isError: true };
  }
  if (typeof summary !== "string" || summary.length === 0) {
    return { content: [{ type: "text", text: "ERROR missing or empty argument: summary" }], isError: true };
  }
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, strand, summary], { env: process.env });
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
