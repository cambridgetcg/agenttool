/** Server entry point. */

import { config } from "./config";
import app from "./app";

console.log(`💰 agent-economy starting on ${config.host}:${config.port}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
