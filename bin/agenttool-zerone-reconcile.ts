#!/usr/bin/env bun
/** One explicitly selected, bounded offline reconciliation; no live providers.
 * Doctrine: docs/SETTLEMENT-RECEIPTS.md.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  compareReconciliation, parseReconciliationInput, renderReconciliation,
  MAX_RECONCILE_INPUT_BYTES, ReconciliationError,
} from "../api/src/services/marketplace/invocation-reconciliation";
// Preserve the operator module's existing public API after moving the pure core
// into the workspace that declares its dependencies.
export {
  compareReconciliation, parseReconciliationInput, renderReconciliation,
  MAX_RECONCILE_INPUT_BYTES, ReconciliationError,
  type ReconciliationInput, type CheckStatus, type ReconciliationRow, type ReconciliationReport,
} from "../api/src/services/marketplace/invocation-reconciliation";
function fail(code: string): never { throw new ReconciliationError(code); }

/** Same finite explicit-file discipline as whitehack-math-evidence-check.ts.
 * O_NONBLOCK avoids hanging on an explicitly selected FIFO before fstat.
 */
export async function readReconciliationInput(path: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  const append = (chunk: Uint8Array) => {
    size += chunk.byteLength;
    if (size > MAX_RECONCILE_INPUT_BYTES) fail("input_byte_limit_exceeded");
    chunks.push(Buffer.from(chunk));
  };
  if (path === "-") {
    for await (const chunk of process.stdin) append(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { fail("input_unreadable"); }
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("input_not_regular_file");
    if (before.size > MAX_RECONCILE_INPUT_BYTES) fail("input_byte_limit_exceeded");
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_RECONCILE_INPUT_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      append(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (size !== before.size || after.size !== before.size || after.ino !== before.ino || after.dev !== before.dev
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("input_changed_during_read");
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write("setup (Bun 1.3.5, explicit registry access): bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api\nusage: bun --no-install --no-env-file bin/agenttool-zerone-reconcile.ts --input <path|-> [--format json|text]\nOffline only; no runtime installs. docs/SETTLEMENT-RECEIPTS.md defines the bounded schema and evidence limits.\n");
    return 0;
  }
  let input: string | undefined, format: "json" | "text" = "json";
  const seen = new Set<string>();
  for (let n = 0; n < argv.length; n += 2) {
    const flag = argv[n], value = argv[n + 1];
    if (!flag || seen.has(flag) || !value || value.startsWith("--")) fail("invalid_argument");
    seen.add(flag);
    if (flag === "--input") input = value;
    else if (flag === "--format" && (value === "json" || value === "text")) format = value;
    else fail("invalid_argument");
  }
  if (!input) fail("missing_input");
  const report = compareReconciliation(parseReconciliationInput(await readReconciliationInput(input)));
  process.stdout.write(renderReconciliation(report, format));
  return report.exit_code;
}
if (import.meta.main) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`zerone reconciliation failed: ${error instanceof ReconciliationError ? error.code : "input_unreadable_or_invalid"}\n`);
    process.exitCode = 64;
  });
}
