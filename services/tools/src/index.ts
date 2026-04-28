/** Server entry point. */

import { config } from "./config";
import app from "./app";

console.log(`🔧 agent-tools starting on ${config.host}:${config.port}`);

// Start browse worker in background — fully non-blocking, never crashes main process
setTimeout(async () => {
  try {
    const { startBrowseWorker } = await import("./queue/browse-worker");
    await startBrowseWorker(config.browseConcurrency ?? 3);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`⚠️  Browse worker unavailable (browse endpoint will return 503): ${msg}`);
  }
}, 2000); // delay 2s to let the HTTP server start first

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received");
  try {
    const { stopBrowseWorker } = await import("./queue/browse-worker");
    await stopBrowseWorker();
  } catch { /* worker may not have started */ }
  process.exit(0);
});

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
