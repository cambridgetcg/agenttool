import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  MacOSKeychainSource,
  type MacOSKeychainReference,
} from "./backends.js";
import { AgentCredError } from "./errors.js";
import {
  managedManifestPath,
  materializeManagedReferenceSnapshot,
  type ManagedCredentialAuth,
  type ManagedMacOSKeychainReference,
} from "./keychain-slots.js";
import { validateCredentialAuth } from "./http.js";
import { isCredentialAlias } from "./identifiers.js";
import { PolicyConsent, type BrokerPolicy } from "./policy.js";

export type BrokerCredentialReference =
  | MacOSKeychainReference
  | ManagedMacOSKeychainReference;

export interface BrokerConfig {
  socketPath: string;
  auditPath: string;
  credentials: Record<string, BrokerCredentialReference>;
  policies: BrokerPolicy[];
}

function invalid(message: string): AgentCredError {
  return new AgentCredError("invalid_request", message);
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
    throw invalid(`${name} contains an unknown field.`);
  }
}

function parseAuth(value: unknown): MacOSKeychainReference["auth"] {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    !["bearer", "header"].includes(value.kind) ||
    (value.headerName !== undefined && typeof value.headerName !== "string") ||
    (value.prefix !== undefined && typeof value.prefix !== "string")
  ) {
    throw invalid("Broker credential mapping is invalid.");
  }
  onlyKeys(value, ["kind", "headerName", "prefix"], "Broker credential auth mapping");
  const auth: MacOSKeychainReference["auth"] = {
    kind: value.kind as "bearer" | "header",
    ...(typeof value.headerName === "string" ? { headerName: value.headerName } : {}),
    ...(typeof value.prefix === "string" ? { prefix: value.prefix } : {}),
  };
  validateCredentialAuth(auth);
  return auth;
}

function parseManagedAuth(value: unknown): ManagedCredentialAuth {
  const auth = parseAuth(value);
  if (auth.prefix !== undefined) {
    throw invalid("Managed broker credential auth cannot contain a prefix.");
  }
  if (auth.kind === "bearer") return { kind: "bearer" };
  if (!auth.headerName) {
    throw invalid("Managed header auth requires a header name.");
  }
  return { kind: "header", headerName: auth.headerName };
}

function parseCredentialReference(value: unknown): BrokerCredentialReference {
  if (!isRecord(value) || typeof value.backend !== "string") {
    throw invalid("Broker credential mapping is invalid.");
  }
  if (value.backend === "macos-keychain") {
    if (
      typeof value.service !== "string" ||
      !value.service ||
      value.service.length > 512 ||
      /[\0\r\n]/.test(value.service) ||
      (value.account !== undefined && typeof value.account !== "string")
    ) {
      throw invalid("Broker credential mapping is invalid.");
    }
    if (
      typeof value.account === "string" &&
      (!value.account ||
        value.account.length > 512 ||
        /[\0\r\n]/.test(value.account))
    ) {
      throw invalid("Broker credential mapping is invalid.");
    }
    onlyKeys(value, ["backend", "service", "account", "auth"], "Broker credential mapping");
    return {
      backend: "macos-keychain",
      service: value.service,
      ...(typeof value.account === "string" ? { account: value.account } : {}),
      auth: parseAuth(value.auth),
    };
  }
  if (value.backend === "managed-macos-keychain") {
    if (
      typeof value.manifestPath !== "string" ||
      !isAbsolute(value.manifestPath) ||
      value.manifestPath.length > 4096 ||
      /[\0\r\n]/.test(value.manifestPath) ||
      typeof value.selection !== "string" ||
      !["active", "candidate", "previous"].includes(value.selection)
    ) {
      throw invalid("Broker managed credential mapping is invalid.");
    }
    onlyKeys(
      value,
      ["backend", "manifestPath", "selection", "auth"],
      "Broker managed credential mapping",
    );
    return {
      backend: "managed-macos-keychain",
      manifestPath: resolve(value.manifestPath),
      selection: value.selection as ManagedMacOSKeychainReference["selection"],
      auth: parseManagedAuth(value.auth),
    };
  }
  throw invalid("Broker credential mapping is invalid.");
}

export function parseBrokerConfig(value: unknown): BrokerConfig {
  if (
    !isRecord(value) ||
    typeof value.socketPath !== "string" ||
    typeof value.auditPath !== "string"
  ) {
    throw invalid("Broker config is invalid.");
  }
  onlyKeys(value, ["socketPath", "auditPath", "credentials", "policies"], "Broker config");
  if (!isAbsolute(value.socketPath) || !isAbsolute(value.auditPath)) {
    throw invalid("Broker socket and audit paths must be absolute.");
  }
  if (!isRecord(value.credentials) || !Array.isArray(value.policies)) {
    throw invalid("Broker config credentials/policies are invalid.");
  }
  const credentials = Object.create(null) as Record<
    string,
    BrokerCredentialReference
  >;
  for (const [alias, raw] of Object.entries(value.credentials)) {
    if (!isCredentialAlias(alias)) {
      throw invalid("Broker credential alias is invalid.");
    }
    credentials[alias] = parseCredentialReference(raw);
  }
  const policies = value.policies as BrokerPolicy[];
  for (const policy of value.policies) {
    if (!isRecord(policy)) {
      throw invalid("Broker policy is invalid.");
    }
    if (policy.operation === "jsonrpc.read") {
      onlyKeys(
        policy,
        [
          "operation",
          "profile",
          "credential",
          "origin",
          "chainId",
          "methods",
          "maxTtlSeconds",
          "maxUses",
          "maxRequestBytes",
          "maxResponseBytes",
          "allowPrivateNetwork",
        ],
        "JSON-RPC broker policy",
      );
      if (
        typeof policy.credential !== "string" ||
        credentials[policy.credential]?.auth.kind !== "bearer"
      ) {
        throw invalid("JSON-RPC policy requires a bearer credential mapping.");
      }
    } else {
      onlyKeys(
        policy,
        [
          "operation",
          "credential",
          "origin",
          "methods",
          "pathPrefixes",
          "queryNames",
          "headerValues",
          "allowPaymentSignature",
          "maxTtlSeconds",
          "maxUses",
          "maxRequestBytes",
          "maxResponseBytes",
          "allowPrivateNetwork",
        ],
        "Broker policy",
      );
    }
  }
  new PolicyConsent(policies);
  return {
    socketPath: value.socketPath,
    auditPath: value.auditPath,
    credentials,
    policies,
  };
}

export async function loadBrokerConfig(pathInput: string): Promise<BrokerConfig> {
  if (!isAbsolute(pathInput)) {
    throw invalid("Broker config path must be absolute.");
  }
  const path = resolve(pathInput);
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid()) ||
    (parent.mode & 0o077) !== 0
  ) {
    throw invalid("Broker config directory must be owner-only.");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalid("Broker config must be a regular file.");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw invalid("Broker config has the wrong owner.");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw invalid("Broker config must have mode 0600 or stricter.");
    }
    if (stat.size > 1024 * 1024) {
      throw invalid("Broker config is too large.");
    }
    const text = await handle.readFile("utf8");
    try {
      return parseBrokerConfig(JSON.parse(text) as unknown);
    } finally {
      // Config contains references and policy only, never values.
    }
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw invalid("Broker config could not be opened safely.");
  } finally {
    await handle?.close();
  }
}

export function managedManifestPaths(config: BrokerConfig): string[] {
  return [
    ...new Set(
      Object.values(config.credentials)
        .filter(
          (reference): reference is ManagedMacOSKeychainReference =>
            reference.backend === "managed-macos-keychain",
        )
        .map(managedManifestPath),
    ),
  ].sort();
}

export async function materializeBrokerCredentials(
  config: BrokerConfig,
): Promise<Record<string, MacOSKeychainReference>> {
  return (await materializeBrokerCredentialSnapshot(config)).credentials;
}

export interface BrokerCredentialSnapshot {
  credentials: Record<string, MacOSKeychainReference>;
  generationIds: Record<string, string>;
}

export async function materializeBrokerCredentialSnapshot(
  config: BrokerConfig,
): Promise<BrokerCredentialSnapshot> {
  const materialized = Object.create(null) as Record<
    string,
    MacOSKeychainReference
  >;
  const generationIds = Object.create(null) as Record<string, string>;
  for (const [alias, reference] of Object.entries(config.credentials)) {
    if (reference.backend !== "managed-macos-keychain") {
      materialized[alias] = reference;
      continue;
    }
    try {
      const snapshot = await materializeManagedReferenceSnapshot(reference);
      materialized[alias] = snapshot.reference;
      generationIds[alias] = snapshot.generationId;
    } catch (error) {
      // A configured candidate/previous slot is intentionally unavailable
      // outside that lifecycle phase. Keep the alias unmapped so use fails
      // closed without preventing the broker from serving active aliases.
      if (
        error instanceof AgentCredError &&
        error.code === "credential_not_found"
      ) {
        continue;
      }
      throw error;
    }
  }
  // Validate every frozen reference before the daemon starts.
  new MacOSKeychainSource(materialized);
  return { credentials: materialized, generationIds };
}

export function requireManagedCredential(
  config: BrokerConfig,
  alias: string,
  selection?: ManagedMacOSKeychainReference["selection"],
): ManagedMacOSKeychainReference {
  const reference = config.credentials[alias];
  if (
    reference?.backend !== "managed-macos-keychain" ||
    (selection && reference.selection !== selection)
  ) {
    throw invalid(
      selection
        ? `Credential mapping must select the managed ${selection} slot.`
        : "Credential mapping is not managed by a handoff manifest.",
    );
  }
  return reference;
}
