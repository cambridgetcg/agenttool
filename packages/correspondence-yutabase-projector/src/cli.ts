#!/usr/bin/env node

import {
  projectionStatus,
} from "./apply.js";
import {
  loadRunConfig,
  loadScopeConfig,
  loadTargetConfig,
} from "./config.js";
import { closeTarget, connectTarget } from "./database.js";
import { safeErrorText } from "./errors.js";
import { installProjector } from "./preflight.js";
import { runOnce } from "./projector.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (
    command === undefined ||
    process.argv.length !== 3 ||
    !["install", "run-once", "status"].includes(command)
  ) {
    process.stderr.write(
      "usage: agenttool-correspondence-yutabase-projector <install|run-once|status>\n",
    );
    process.exitCode = 2;
    return;
  }

  if (command === "install") {
    const config = loadTargetConfig();
    const database = connectTarget(config);
    try {
      const result = await installProjector(database, config);
      process.stdout.write(`${JSON.stringify({ status: result })}\n`);
    } finally {
      await closeTarget(database);
    }
    return;
  }

  if (command === "status") {
    const config = loadScopeConfig();
    const database = connectTarget(config);
    try {
      const status = await projectionStatus(database, config);
      process.stdout.write(`${JSON.stringify(status)}\n`);
    } finally {
      await closeTarget(database);
    }
    return;
  }

  const config = loadRunConfig();
  const database = connectTarget(config);
  try {
    const result = await runOnce(database, config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await closeTarget(database);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: safeErrorText(error) })}\n`);
  process.exitCode = 1;
});
