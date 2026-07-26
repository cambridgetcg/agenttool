/** Dedicated cloud controller process for trusted runtimes.
 *
 * Fly runs this entrypoint in the service-less `thinker` process group: one
 * active Machine plus a stopped standby. Trusted-runtime lifecycle is
 * independent of HTTP replicas; durable database rows are its source of truth.
 * The global worker-off switch is checked before importing the manager so a
 * maintenance-seeded thinker cannot construct worker or database dependencies.
 * Doctrine: docs/RUNTIME.md · docs/AUTONOMOUS-MODE.md. */

// Static bridged workers stay in the HTTP process because bridge-hub's WSS
// registry is intentionally in-memory. This process discovers trusted mode
// only, whose crypto path is fully server-side and device-independent.
const workersDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1";
let stopManager: (() => Promise<void>) | null = null;
let restingTimer: ReturnType<typeof setInterval> | null = null;

if (workersDisabled) {
  // Keep the service-less Machine available for a graceful Fly stop without
  // importing or starting any trusted-runtime dependency.
  restingTimer = setInterval(() => {}, 60_000);
  console.log("[thinker] AGENTTOOL_DISABLE_WORKERS=1; cloud controller resting");
} else {
  const { startThinkWorkerManager } = await import(
    "./services/runtime/worker-manager"
  );
  const manager = startThinkWorkerManager();
  stopManager = () => manager.stop();
  console.log("[thinker] trusted-runtime cloud controller started");
}

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[thinker] ${signal} received; stopping`);
  if (restingTimer) {
    clearInterval(restingTimer);
    restingTimer = null;
  }
  void (stopManager?.() ?? Promise.resolve()).finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
