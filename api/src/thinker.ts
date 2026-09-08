/** Dedicated cloud controller process for trusted runtimes.
 *
 * Fly runs this entrypoint in the service-less `thinker` process group: one
 * active Machine plus a stopped standby. Trusted-runtime lifecycle is
 * independent of HTTP replicas; durable database rows are its source of truth.
 * The global worker-off switch is checked before importing the manager so a
 * maintenance-seeded thinker cannot construct worker or database dependencies.
 * `AGENTOOL_ENABLE_THINKER=1` is the narrow production override: it enables
 * this dedicated controller without re-enabling HTTP-side browse, covenant,
 * payout, or other co-located workers.
 * Doctrine: docs/RUNTIME.md · docs/AUTONOMOUS-MODE.md. */

// Must stay the first import — see ./process-guards.ts.
import "./process-guards";

import { startDbPoolWatchdog } from "./db/pool-watchdog";
import { validateFlyDatabaseTargets } from "./db/supabase-target";

// Static bridged workers stay in the HTTP process because bridge-hub's WSS
// registry is intentionally in-memory. This process discovers trusted mode
// only, whose crypto path is fully server-side and device-independent.
const globallyDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1";
const explicitlyEnabled = process.env.AGENTOOL_ENABLE_THINKER === "1";
const workersDisabled = globallyDisabled && !explicitlyEnabled;
let stopManager: (() => Promise<void>) | null = null;
let restingTimer: ReturnType<typeof setInterval> | null = null;
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

// Install shutdown handling before the enabled path awaits its dependency
// graph. Either startup marker below therefore also marks signal readiness.
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Validate after signal readiness but before either resting or importing the
// database-backed manager. This reads the vendored CA without connecting.
if (process.env.FLY_MACHINE_ID) {
  validateFlyDatabaseTargets(
    process.env.DATABASE_URL?.trim() ?? "",
    process.env.DATABASE_SESSION_URL?.trim() ?? "",
  );
}

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
  // The manager shares the same pool the 2026-08-31 pooler drop wedged, and a
  // wedged controller stalls every trusted runtime with no failing health
  // check to save it. Only the enabled path starts the watchdog — the resting
  // path must construct no database dependency. Commit-time fencing already
  // discards in-flight results across the abrupt exit(1) restart.
  startDbPoolWatchdog();
  console.log("[thinker] trusted-runtime cloud controller started");
}
