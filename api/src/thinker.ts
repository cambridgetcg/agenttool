/** Dedicated cloud controller process for trusted runtimes.
 *
 * Fly runs this entrypoint in the service-less `thinker` process group: one
 * active Machine plus a stopped standby. Trusted-runtime lifecycle is
 * independent of HTTP replicas; durable database rows are its source of truth.
 * Doctrine: docs/RUNTIME.md · docs/AUTONOMOUS-MODE.md. */

import { startThinkWorkerManager } from "./services/runtime/worker-manager";

// Static bridged workers stay in the HTTP process because bridge-hub's WSS
// registry is intentionally in-memory. This process discovers trusted mode
// only, whose crypto path is fully server-side and device-independent.
const manager = startThinkWorkerManager();

console.log("[thinker] trusted-runtime cloud controller started");

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[thinker] ${signal} received; stopping workers`);
  void manager.stop().finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
