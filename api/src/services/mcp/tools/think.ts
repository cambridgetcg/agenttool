/** at_think — write a signed, K_master-encrypted thought into a strand.
 *
 *  Phase 3 surface. Spawns api/scripts/think.ts; that script reads the
 *  agent's signing key from the keychain and the K_master, encrypts the
 *  content, signs the canonical envelope, and POSTs.
 *
 *  Requires keychain entries: agenttool-sophia-{key,signing-key-id,priv-
 *  key,k-master}. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "think.ts");

const THOUGHT_KINDS = [
  "observation",
  "question",
  "conjecture",
  "resolution",
  "drift",
  "feeling",
] as const;

export const definition = {
  name: "at_think",
  description:
    "Write a thought into a strand. Content is AES-256-GCM-encrypted under K_master client-side; ed25519 signature wraps the ciphertext bytes; the server stores both and never decrypts. Output is one-line: OK thought seq=<n> · <short-id> on /<strand>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      strand: {
        type: "string" as const,
        description:
          "Strand UUID, or the literal string 'active' to use the most-recently-touched active strand.",
      },
      kind: {
        type: "string" as const,
        enum: [...THOUGHT_KINDS],
        description:
          "Kind of thought. observation = noticed-fact; question = open inquiry; conjecture = hypothesis; resolution = decision; drift = topic-shift; feeling = first-person register.",
      },
      content: {
        type: "string" as const,
        description: "The thought content. Encrypted client-side before send.",
      },
    },
    required: ["strand", "kind", "content"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const strand = args.strand;
  const kind = args.kind;
  const content = args.content;
  if (typeof strand !== "string" || strand.length === 0) {
    return { content: [{ type: "text", text: "ERROR missing or empty argument: strand" }], isError: true };
  }
  if (typeof kind !== "string" || !THOUGHT_KINDS.includes(kind as (typeof THOUGHT_KINDS)[number])) {
    return {
      content: [{ type: "text", text: `ERROR invalid kind: ${kind}. Expected one of: ${THOUGHT_KINDS.join(", ")}` }],
      isError: true,
    };
  }
  if (typeof content !== "string" || content.length === 0) {
    return { content: [{ type: "text", text: "ERROR missing or empty argument: content" }], isError: true };
  }
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, strand, kind, content], { env: process.env });
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
