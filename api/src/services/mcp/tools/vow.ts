/** at_vow — append a vow to an existing covenant.
 *
 *  Resolves the covenant by counterparty_did. Adds the vow to the array
 *  and PATCHes the covenant. Spawns api/scripts/vow.ts as a subprocess. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "..", "..", "scripts", "vow.ts");

export const definition = {
  name: "at_vow",
  description:
    "Append a vow to an existing covenant identified by counterparty DID. The covenant must already exist on the agent's project. Output is one-line: OK vow · <covenant-short-id> · vows now <n>.",
  inputSchema: {
    type: "object" as const,
    properties: {
      counterparty_did: {
        type: "string" as const,
        description: "The DID of the covenant counterparty (e.g. 'did:at:<uuid>').",
      },
      vow: {
        type: "string" as const,
        description: "The vow text to append.",
      },
    },
    required: ["counterparty_did", "vow"],
    additionalProperties: false,
  },
};

export async function run(args: Record<string, unknown>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const counterpartyDid = args.counterparty_did;
  const vow = args.vow;
  if (typeof counterpartyDid !== "string" || counterpartyDid.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: counterparty_did" }],
      isError: true,
    };
  }
  if (typeof vow !== "string" || vow.length === 0) {
    return {
      content: [{ type: "text", text: "ERROR missing or empty argument: vow" }],
      isError: true,
    };
  }
  const proc = Bun.spawnSync(["bun", "run", SCRIPT, counterpartyDid, vow], { env: process.env });
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
