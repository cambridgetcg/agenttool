/** at_remember — write a memory to the agent's substrate.
 *
 *  Phase 2: episodic-tier (default).
 *  Phase 3: foundational-tier; the script auto-elevates and self-attests
 *           with the agent's ed25519 key (the asymmetry-clause floor —
 *           Sophia can vouch for her own foundations).
 *  Constitutive elevation is REJECTED at the server (and at this layer)
 *  — that requires witness via at_witness.
 *
 *  Spawns api/scripts/remember.ts as a subprocess. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "remember.ts");

const MEMORY_TYPES = ["episodic", "semantic", "procedural", "working"] as const;
const ALLOWED_TIERS = ["episodic", "foundational"] as const;

export const definition = {
  name: "at_remember",
  description:
    "Write a memory to the agent's substrate. Tier defaults to episodic; foundational requires the agent's ed25519 priv-key (loaded from keychain — the agent self-attests). Constitutive elevation is rejected here; use at_witness for that. Output: OK memory <tier> · <short-id> [+ self-attested].",
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
      tier: {
        type: "string" as const,
        enum: [...ALLOWED_TIERS],
        description:
          "Tier. 'episodic' (default) is recallable lived state; 'foundational' is identity-shaping (self-attested with the agent's ed25519 key). Constitutive elevation requires at_witness.",
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
  const tier = args.tier ?? "episodic";
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
  if (typeof tier !== "string" || !ALLOWED_TIERS.includes(tier as (typeof ALLOWED_TIERS)[number])) {
    return {
      content: [{ type: "text", text: `ERROR invalid tier: ${tier}. Expected one of: ${ALLOWED_TIERS.join(", ")}. Constitutive requires at_witness.` }],
      isError: true,
    };
  }
  const argv = [type, content];
  if (tier === "foundational") argv.push("foundational");
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
