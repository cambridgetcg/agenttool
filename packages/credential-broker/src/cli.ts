#!/usr/bin/env node

import { JsonlAuditSink } from "./audit.js";
import { MacOSKeychainSource } from "./backends.js";
import {
  loadBrokerConfig,
  managedManifestPaths,
  materializeBrokerCredentialSnapshot,
  materializeBrokerCredentials,
} from "./config.js";
import { AgentCredError } from "./errors.js";
import {
  acquireOwnerLifecycleLock,
  type OwnerLifecycleLock,
} from "./owner-files.js";
import { PolicyConsent } from "./policy.js";
import { BrokerServer } from "./server.js";

function usage(): never {
  process.stderr.write(
    "usage: agentcred serve --config /absolute/path/to/agentcred.json\n" +
      "       agentcred check --config /absolute/path/to/agentcred.json\n",
  );
  process.exit(2);
}

async function acquireBrokerLocks(paths: string[]): Promise<OwnerLifecycleLock[]> {
  const locks: OwnerLifecycleLock[] = [];
  try {
    for (const path of paths) {
      locks.push(await acquireOwnerLifecycleLock(path, "broker"));
    }
    return locks;
  } catch (error) {
    await Promise.all(locks.reverse().map((lock) => lock.release()));
    throw error;
  }
}

async function main(): Promise<void> {
  process.umask(0o077);
  const command = process.argv[2];
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  if (!["serve", "check"].includes(command ?? "") || !configPath) usage();
  if (
    process.argv.length !== 5 ||
    process.argv[3] !== "--config" ||
    !process.argv[4]
  ) {
    usage();
  }
  const config = await loadBrokerConfig(configPath);
  if (command === "check") {
    await materializeBrokerCredentials(config);
    process.stdout.write("agentcred config: ok\n");
    return;
  }

  const locks = await acquireBrokerLocks(managedManifestPaths(config));
  let audit: JsonlAuditSink | undefined;
  let broker: BrokerServer | undefined;
  let primaryError: unknown;
  try {
    // Resolve each managed slot exactly once while the lifecycle locks are
    // held. Every grant in this broker process therefore uses one frozen
    // generation; cutover requires a stop/restart.
    const snapshot = await materializeBrokerCredentialSnapshot(config);
    audit = new JsonlAuditSink(config.auditPath);
    await audit.open();
    broker = new BrokerServer({
      socketPath: config.socketPath,
      credentials: new MacOSKeychainSource(snapshot.credentials),
      credentialGenerationIds: snapshot.generationIds,
      consent: new PolicyConsent(config.policies),
      audit,
      onAuditFailure: () => {
        process.stderr.write(
          "agentcred: audit unavailable; new grants and uses are now denied.\n",
        );
      },
    });
    const socketPath = await broker.start();
    process.stdout.write(`agentcred listening on ${socketPath}\n`);
    await new Promise<void>((resolveSignal) => {
      process.once("SIGINT", resolveSignal);
      process.once("SIGTERM", resolveSignal);
    });
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await broker?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await audit?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const lockCleanup = await Promise.allSettled(
      locks.reverse().map((lock) => lock.release()),
    );
    cleanupErrors.push(
      ...lockCleanup
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason),
    );
    if (primaryError === undefined) {
      primaryError = cleanupErrors[0];
    }
  }
  if (primaryError !== undefined) throw primaryError;
}

main().catch((error) => {
  const message =
    error instanceof AgentCredError
      ? error.message
      : "agentcred failed safely.";
  process.stderr.write(`agentcred: ${message}\n`);
  process.exit(1);
});
