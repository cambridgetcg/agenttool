/** Test-only lifecycle observer around the real CLI entrypoint. No forced
 * exit, output interception, or store behavior change. Only fixed stage names
 * are written to an owned fixture sidecar; CLI output stays on its own pipes.
 */
import { writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ConstructiveStore } from "../../src/store.js";

const marker = process.argv[2]!;
if (!/^settlement\.json\.child-[01]\.json$/.test(basename(marker)) ||
  !basename(dirname(marker)).startsWith("constructive-")) {
  throw new Error("invalid test lifecycle marker");
}
const mark = (stage: string) => {
  try { writeFileSync(marker, JSON.stringify({ stage }), { mode: 0o600 }); }
  catch { /* A diagnostic failure must not change CLI ownership or exit. */ }
};
const close = ConstructiveStore.prototype.close;
ConstructiveStore.prototype.close = function () {
  mark("store_close_entered");
  try {
    close.call(this);
    mark("store_close_returned");
  } catch (error) {
    mark("store_close_threw");
    throw error;
  }
};
process.argv = [process.argv[0]!, "src/bin.ts", ...process.argv.slice(3)];
mark("entrypoint_importing");
try {
  await import("../../src/bin.js");
  mark("entrypoint_completed");
} catch (error) {
  // Preserve a more precise close-side failure marker.
  throw error;
}
