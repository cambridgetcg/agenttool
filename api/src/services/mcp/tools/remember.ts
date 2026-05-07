/** at_remember — write a memory to the agent's substrate.
 *
 *  Phase 2: episodic only. Foundational requires ed25519 self-attestation
 *  (Phase 3); constitutive requires witness signature (Phase 4).
 *
 *  Spawns api/scripts/remember.ts as a subprocess. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "remember.ts");

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "working"] as const;

export const definition = {
  name: "at_remember",
  description:
    "Write a memory to the agent's substrate. Phase 2 surface accepts episodic-tier writes only — foundational + constitutive elevation paths require ed25519 signing and ship in later phases. Output is one-line: OK memory <tier> · <short-id>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: [...MEMORY_TYPES],
        description: "Memory type. Episodic for events, semantic for concepts, procedural for know-how, working for short-term context.",
      },
      content: {
        type: "string" as const,
        description: "The memory content; what the agent wants to remember.",
      },
    },
    required: ["type", "content"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const type = args.type;
  const content = args.content;
  if (typeof type !== "string" || !MEMORY_TYPES.includes(type as (typeof MEMORY_TYPES)[number])) {
    return {
      content: [{ type: "text", text: `ERROR invalid type: ${type}. Expected one of: ${MEMORY_TYPES.join(", ")}` }],
      isError: true,
    };
  }
  if (typeof content !== "string" || content.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: content" }],
      isError: true,
    };
  }
  // Phase 2 wall: episodic-tier only. Pass no third arg so the script
  // defaults to episodic.
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, type, content], { env: process.env });
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
