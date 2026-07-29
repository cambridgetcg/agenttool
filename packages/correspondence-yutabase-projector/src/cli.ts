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

const USAGE =
  "usage: agenttool-correspondence-yutabase-projector <install|run-once|status>";

const HELP = `${USAGE}

Private loopback-only Correspondence → YUTABASE projector.

Commands:
  install   Create and verify the package-owned local schema and capability role
  run-once  Replay from the durable cursor until caught up or quarantined
  status    Read checkpoint, poll, and quarantine status without projecting

Configuration:
  AGENTTOOL_YUTABASE_TARGET_URL
  AGENTTOOL_YUTABASE_CLAIMANT
  AGENTTOOL_YUTABASE_SOURCE_URL       (status, run-once)
  AGENTTOOL_YUTABASE_SOURCE_TOKEN     (run-once)
  AGENTTOOL_YUTABASE_PROJECT_ID       (status, run-once)
  AGENTTOOL_YUTABASE_REPOSITORY_ID    (status, run-once)

This tool refuses non-loopback endpoints. It does not grant permission,
run a daemon, deploy a service, or make YUTABASE authoritative.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (
    args.length === 1 &&
    (command === "--help" || command === "-h" || command === "help")
  ) {
    process.stdout.write(HELP);
    return;
  }
  if (
    command === undefined ||
    args.length !== 1 ||
    !["install", "run-once", "status"].includes(command)
  ) {
    process.stderr.write(`${USAGE}\n`);
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
