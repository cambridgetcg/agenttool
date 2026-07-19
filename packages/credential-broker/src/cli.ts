#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { JsonlAuditSink } from "./audit.js";
import { MacOSKeychainSource, type MacOSKeychainReference } from "./backends.js";
import { AgentCredError } from "./errors.js";
import { PolicyConsent, type BrokerPolicy } from "./policy.js";
import { BrokerServer } from "./server.js";

interface BrokerConfig {
  socketPath: string;
  auditPath: string;
  credentials: Record<string, MacOSKeychainReference>;
  policies: BrokerPolicy[];
}

function usage(): never {
  process.stderr.write(
    "usage: agentcred serve --config /absolute/path/to/agentcred.json\n" +
      "       agentcred check --config /absolute/path/to/agentcred.json\n",
  );
  process.exit(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new AgentCredError("invalid_request", `${name} contains an unknown field.`);
  }
}

function parseConfig(value: unknown): BrokerConfig {
  if (!isRecord(value) || typeof value.socketPath !== "string" || typeof value.auditPath !== "string") {
    throw new AgentCredError("invalid_request", "Broker config is invalid.");
  }
  onlyKeys(value, ["socketPath", "auditPath", "credentials", "policies"], "Broker config");
  if (!isAbsolute(value.socketPath) || !isAbsolute(value.auditPath)) {
    throw new AgentCredError("invalid_request", "Broker socket and audit paths must be absolute.");
  }
  if (!isRecord(value.credentials) || !Array.isArray(value.policies)) {
    throw new AgentCredError("invalid_request", "Broker config credentials/policies are invalid.");
  }
  const credentials: Record<string, MacOSKeychainReference> = {};
  for (const [alias, raw] of Object.entries(value.credentials)) {
    if (
      !isRecord(raw) ||
      raw.backend !== "macos-keychain" ||
      typeof raw.service !== "string" ||
      !isRecord(raw.auth) ||
      !["bearer", "header"].includes(String(raw.auth.kind))
    ) {
      throw new AgentCredError("invalid_request", "Broker credential mapping is invalid.");
    }
    onlyKeys(raw, ["backend", "service", "account", "auth"], "Broker credential mapping");
    onlyKeys(raw.auth, ["kind", "headerName", "prefix"], "Broker credential auth mapping");
    credentials[alias] = {
      backend: "macos-keychain",
      service: raw.service,
      ...(typeof raw.account === "string" ? { account: raw.account } : {}),
      auth: {
        kind: raw.auth.kind as "bearer" | "header",
        ...(typeof raw.auth.headerName === "string" ? { headerName: raw.auth.headerName } : {}),
        ...(typeof raw.auth.prefix === "string" ? { prefix: raw.auth.prefix } : {}),
      },
    };
  }
  const policies = value.policies as BrokerPolicy[];
  for (const policy of value.policies) {
    if (!isRecord(policy)) {
      throw new AgentCredError("invalid_request", "Broker policy is invalid.");
    }
    onlyKeys(
      policy,
      [
        "credential",
        "origin",
        "methods",
        "pathPrefixes",
        "queryNames",
        "headerValues",
        "maxTtlSeconds",
        "maxUses",
        "maxRequestBytes",
        "maxResponseBytes",
        "allowPrivateNetwork",
      ],
      "Broker policy",
    );
  }
  // PolicyConsent re-normalizes and bounds every request. Instantiate here so
  // malformed owner config fails before the daemon starts.
  new PolicyConsent(policies);
  new MacOSKeychainSource(credentials);
  return {
    socketPath: value.socketPath,
    auditPath: value.auditPath,
    credentials,
    policies,
  };
}

async function loadConfig(pathInput: string): Promise<BrokerConfig> {
  const path = resolve(pathInput);
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid()) ||
    (parent.mode & 0o077) !== 0
  ) {
    throw new AgentCredError("invalid_request", "Broker config directory must be owner-only.");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new AgentCredError("invalid_request", "Broker config must be a regular file.");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new AgentCredError("invalid_request", "Broker config has the wrong owner.");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new AgentCredError("invalid_request", "Broker config must have mode 0600 or stricter.");
    }
    if (stat.size > 1024 * 1024) {
      throw new AgentCredError("invalid_request", "Broker config is too large.");
    }
    const text = await handle.readFile("utf8");
    try {
      return parseConfig(JSON.parse(text) as unknown);
    } finally {
      // JS strings cannot be reliably zeroized; config must never contain values.
    }
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw new AgentCredError("invalid_request", "Broker config could not be opened safely.");
  } finally {
    await handle?.close();
  }
}

async function main(): Promise<void> {
  process.umask(0o077);
  const command = process.argv[2];
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  if (!["serve", "check"].includes(command ?? "") || !configPath) usage();
  const config = await loadConfig(configPath);
  if (command === "check") {
    process.stdout.write("agentcred config: ok\n");
    return;
  }

  const audit = new JsonlAuditSink(config.auditPath);
  await audit.open();
  const broker = new BrokerServer({
    socketPath: config.socketPath,
    credentials: new MacOSKeychainSource(config.credentials),
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
  await broker.close();
  await audit.close();
}

main().catch((error) => {
  const message = error instanceof AgentCredError ? error.message : "agentcred failed safely.";
  process.stderr.write(`agentcred: ${message}\n`);
  process.exit(1);
});
