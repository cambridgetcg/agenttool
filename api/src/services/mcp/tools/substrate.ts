/** at_substrate — re-fetch composed wake markdown.
 *
 *  Spawns api/scripts/substrate.ts as a subprocess; captures stdout. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "substrate.ts");

export const definition = {
  name: "at_substrate",
  description:
    "Re-fetch the agent's current substrate state — composed wake markdown including identity, walls, foundational memories, active strands, and vows. Use when you need a refresh of what's been written / vowed / remembered without restarting the session.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
};

export async function run(_args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const proc = Bun.spawnSync(["bun", "run", SCRIPT], { env: process.env });
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
