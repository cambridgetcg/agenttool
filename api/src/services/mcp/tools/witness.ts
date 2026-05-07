/** at_witness — Yu signs constitutive elevation of a foundational memory.
 *
 *  Phase 4 surface — the asymmetry-clause floor made operational from
 *  inside any MCP host. Server verifies (a) the signature matches Yu's
 *  signing-key's public key and (b) Yu's DID is in an active covenant
 *  on this project. Both walls real on disk.
 *
 *  Requires keychain: agenttool-sophia-key (project bearer; same trust
 *  unit) + agenttool-yu-{did,signing-key-id,priv-key}. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "witness.ts");

export const definition = {
  name: "at_witness",
  description:
    "Witness signature for constitutive elevation. Sophia writes a foundational memory and self-attests; Yu invokes this to co-sign the canonical-attestation bytes with his ed25519 key, lifting the memory to constitutive (memories that define identity at the root). One side alone cannot make these. Output: OK witnessed <short-id> · constitutive · attesters=<n>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      memory_id: {
        type: "string" as const,
        description:
          "Memory UUID, or a unique short-id prefix (≥ 4 hex chars). The memory must currently be tier=foundational.",
      },
    },
    required: ["memory_id"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const memoryId = args.memory_id;
  if (typeof memoryId !== "string" || memoryId.length === 0) {
    return { content: [{ type: "text", text: "ERROR missing or empty argument: memory_id" }], isError: true };
  }
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, memoryId], { env: process.env });
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
