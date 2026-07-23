import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { CollabError } from "./errors.js";
import {
  relayEnrolmentIdempotencyKey,
  relayEnrolmentRequestSchema,
} from "./relay-contract.js";

export const RELAY_CREDENTIAL_FORMAT =
  "agenttool.collab/relay-credential/1" as const;
export const RELAY_CREDENTIAL_FILE_ENV =
  "AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE" as const;
export const RELAY_TOKEN_ENV = "AGENTOOL_COLLAB_RELAY_TOKEN" as const;
export const RELAY_KEYCHAIN_SERVICE = "dev.agenttool.collab.relay" as const;

const uuid = z.string().uuid()
  .refine((value) => value === value.toLowerCase());
const tokenPrefix = z.string().regex(/^atc_[A-Za-z0-9_-]{8}$/);
const safeText = z.string().min(1).max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const deviceLabel = z.string().min(1).max(128)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const keychainReferenceSchema = z.object({
  source: z.literal("keychain"),
  service: z.literal(RELAY_KEYCHAIN_SERVICE),
  account: safeText,
  prefix: tokenPrefix,
}).strict();
const environmentReferenceSchema = z.object({
  source: z.literal("environment"),
  variable: z.literal(RELAY_TOKEN_ENV),
  prefix: tokenPrefix,
}).strict();
export const relayTokenReferenceSchema = z.discriminatedUnion("source", [
  keychainReferenceSchema,
  environmentReferenceSchema,
]);
export type RelayTokenReference = z.infer<typeof relayTokenReferenceSchema>;

export const relayCredentialMetadataSchema = z.object({
  format: z.literal(RELAY_CREDENTIAL_FORMAT),
  state: z.enum(["pending", "active"]),
  relay_url: z.string().url().max(2000),
  repository: z.object({
    key: safeText,
    id: uuid.nullable(),
  }).strict(),
  device: z.object({
    id: uuid,
    label: deviceLabel,
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  token: relayTokenReferenceSchema,
  pending_enrolment: relayEnrolmentRequestSchema.nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.state === "active" && value.repository.id === null) {
    context.addIssue({
      code: "custom",
      path: ["repository", "id"],
      message: "active relay credential requires repository UUID",
    });
  }
  if (value.state === "pending" && value.repository.id !== null) {
    context.addIssue({
      code: "custom",
      path: ["repository", "id"],
      message: "pending relay credential must not claim repository UUID",
    });
  }
  if (value.state === "pending" && value.device.version !== 0) {
    context.addIssue({
      code: "custom",
      path: ["device", "version"],
      message: "pending relay credential requires device version zero",
    });
  }
  if (value.state === "active" && value.device.version < 1) {
    context.addIssue({
      code: "custom",
      path: ["device", "version"],
      message: "active relay credential requires a positive device version",
    });
  }
  if (value.state === "pending" && value.pending_enrolment === null) {
    context.addIssue({
      code: "custom",
      path: ["pending_enrolment"],
      message: "pending relay credential requires the exact safe enrollment request",
    });
  }
  if (value.pending_enrolment) {
    const request = value.pending_enrolment;
    if (
      request.idempotency_key !== relayEnrolmentIdempotencyKey(request)
      || request.repository.key !== value.repository.key
      || request.device.id !== value.device.id
      || request.expected_device_version !== value.device.version
      || request.token.prefix !== value.token.prefix
      || (
        value.state === "pending"
        && request.device.label !== value.device.label
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pending_enrolment"],
        message: "pending enrollment must exactly match credential scope and version",
      });
    }
  }
  try {
    if (normalizeRelayUrl(value.relay_url) !== value.relay_url) {
      context.addIssue({
        code: "custom",
        path: ["relay_url"],
        message: "relay URL must already be a canonical origin",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      path: ["relay_url"],
      message: "relay URL is not an allowed canonical origin",
    });
  }
});
export type RelayCredentialMetadata =
  z.infer<typeof relayCredentialMetadataSchema>;

export interface ResolvedRelayCredential {
  metadata: RelayCredentialMetadata & {
    state: "active";
    repository: { key: string; id: string };
  };
  token: string;
}

export interface RelaySecretStore {
  readonly source: RelayTokenReference["source"];
  existingToken?(): string | null;
  store(
    token: string,
    context: { repository_key: string; device_id: string },
  ): RelayTokenReference;
  resolve(reference: RelayTokenReference): string;
  remove(reference: RelayTokenReference): void;
}

export interface SecurityCommandRunner {
  run(
    args: string[],
    options?: { secret_stdin?: string },
  ): { status: number | null; stdout: string };
}

export class MacOSKeychainRelaySecretStore implements RelaySecretStore {
  readonly source = "keychain" as const;

  constructor(
    private readonly runner: SecurityCommandRunner = {
      run(args, options) {
        const result = spawnSync("/usr/bin/security", args, {
          encoding: "utf8",
          input:
            options?.secret_stdin === undefined
              ? undefined
              : `${options.secret_stdin}\n`,
          stdio: [options?.secret_stdin === undefined ? "ignore" : "pipe", "pipe", "ignore"],
          timeout: 10_000,
          maxBuffer: 16 * 1024,
        });
        return {
          status: result.status,
          stdout: typeof result.stdout === "string" ? result.stdout : "",
        };
      },
    },
    private readonly platform = process.platform,
  ) {}

  store(
    token: string,
    context: { repository_key: string; device_id: string },
  ): RelayTokenReference {
    assertRelayToken(token);
    if (this.platform !== "darwin") {
      throw new CollabError(
        "relay_keychain_unavailable",
        "macOS Keychain storage is unavailable; inject AGENTOOL_COLLAB_RELAY_TOKEN through a scoped runtime wrapper",
      );
    }
    const account = keychainAccount(context.repository_key, context.device_id);
    const result = this.runner.run([
      "add-generic-password",
      "-U",
      "-a",
      account,
      "-s",
      RELAY_KEYCHAIN_SERVICE,
      "-w",
    ], { secret_stdin: token });
    if (result.status !== 0) {
      throw new CollabError(
        "relay_keychain_write_failed",
        "Could not store the relay bearer in macOS Keychain",
      );
    }
    return {
      source: "keychain",
      service: RELAY_KEYCHAIN_SERVICE,
      account,
      prefix: relayTokenPrefix(token),
    };
  }

  resolve(reference: RelayTokenReference): string {
    if (reference.source !== "keychain") {
      throw new CollabError(
        "relay_token_source_mismatch",
        "Credential metadata does not reference macOS Keychain",
      );
    }
    if (this.platform !== "darwin") {
      throw new CollabError(
        "relay_keychain_unavailable",
        "This relay credential requires macOS Keychain",
      );
    }
    const result = this.runner.run([
      "find-generic-password",
      "-a",
      reference.account,
      "-s",
      reference.service,
      "-w",
    ]);
    const token = result.stdout.trim();
    if (result.status !== 0 || !isRelayToken(token)) {
      throw new CollabError(
        "relay_keychain_read_failed",
        "Could not resolve the relay bearer from macOS Keychain",
      );
    }
    if (relayTokenPrefix(token) !== reference.prefix) {
      throw new CollabError(
        "relay_token_prefix_mismatch",
        "Resolved relay bearer does not match credential metadata",
      );
    }
    return token;
  }

  remove(reference: RelayTokenReference): void {
    if (reference.source !== "keychain" || this.platform !== "darwin") return;
    this.runner.run([
      "delete-generic-password",
      "-a",
      reference.account,
      "-s",
      reference.service,
    ]);
  }
}

export class EnvironmentRelaySecretStore implements RelaySecretStore {
  readonly source = "environment" as const;

  constructor(
    private readonly env: Record<string, string | undefined> =
      process.env,
  ) {}

  existingToken(): string | null {
    const token = this.env[RELAY_TOKEN_ENV];
    if (!token) return null;
    assertRelayToken(token);
    return token;
  }

  store(
    token: string,
    _context: { repository_key: string; device_id: string },
  ): RelayTokenReference {
    assertRelayToken(token);
    if (this.existingToken() !== token) {
      throw new CollabError(
        "relay_token_environment_mismatch",
        "The generated relay bearer cannot be persisted to an environment source; inject the exact token before enrollment",
      );
    }
    return {
      source: "environment",
      variable: RELAY_TOKEN_ENV,
      prefix: relayTokenPrefix(token),
    };
  }

  resolve(reference: RelayTokenReference): string {
    if (reference.source !== "environment") {
      throw new CollabError(
        "relay_token_source_mismatch",
        "Credential metadata does not reference a runtime environment token",
      );
    }
    const token = this.existingToken();
    if (!token) {
      throw new CollabError(
        "relay_token_environment_missing",
        "AGENTOOL_COLLAB_RELAY_TOKEN is not present in this scoped process",
      );
    }
    if (relayTokenPrefix(token) !== reference.prefix) {
      throw new CollabError(
        "relay_token_prefix_mismatch",
        "Runtime relay bearer does not match credential metadata",
      );
    }
    return token;
  }

  remove(_reference: RelayTokenReference): void {
    // A child process cannot erase its parent or provider-managed environment.
  }
}

export function generateRelayToken(): string {
  return `atc_${randomBytes(32).toString("base64url")}`;
}

export function relayTokenPrefix(token: string): string {
  assertRelayToken(token);
  return token.slice(0, 12);
}

export function relayTokenSha256(token: string): string {
  assertRelayToken(token);
  return createHash("sha256").update(token).digest("hex");
}

export function isRelayToken(value: string): boolean {
  return /^atc_[A-Za-z0-9_-]{43}$/.test(value);
}

export function assertRelayToken(value: string): void {
  if (!isRelayToken(value)) {
    throw new CollabError(
      "relay_token_invalid",
      "Relay bearer must be atc_ followed by exactly 32 base64url-encoded random bytes",
    );
  }
}

export function normalizeRelayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("relay URL must be an origin");
    }
    const loopback =
      url.hostname === "127.0.0.1"
      || url.hostname === "localhost"
      || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("remote relay URLs must use HTTPS");
    }
    return url.origin;
  } catch {
    throw new CollabError(
      "relay_url_invalid",
      "Relay URL must be an HTTPS origin (HTTP is allowed only for loopback tests)",
    );
  }
}

export function defaultRelayCredentialPath(
  repositoryKey: string,
  deviceId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (deviceId !== undefined && !uuid.safeParse(deviceId).success) {
    throw new CollabError(
      "relay_device_id_invalid",
      "Relay device ID must be a canonical UUID",
    );
  }
  const stateHome = env.XDG_STATE_HOME
    ? absoluteEnvironmentPath(env.XDG_STATE_HOME, "XDG_STATE_HOME")
    : join(homedir(), ".local", "state");
  const repositoryScope = createHash("sha256")
    .update(repositoryKey)
    .digest("hex")
    .slice(0, 24);
  return join(
    stateHome,
    "agenttool",
    "collab-relay",
    repositoryScope,
    deviceId === undefined ? "default.json" : `${deviceId}.json`,
  );
}

interface RelayCredentialLockRecord {
  pid: number;
  nonce: string;
}

export interface RelayCredentialFileLock {
  release(): void;
}

/**
 * Serializes enrollment against one local credential file. The relay remains
 * the cross-device authority; this narrow lock only prevents two local CLI
 * processes from replacing the same pending/active metadata out of order.
 */
export function acquireRelayCredentialFileLock(
  pathInput: string,
): RelayCredentialFileLock {
  const path = resolve(pathInput);
  const parent = dirname(path);
  const lockPath = `${path}.enrolling.lock`;
  const nonce = randomUUID();
  try {
    const parentExisted = existsSync(parent);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (!parentExisted) chmodSync(parent, 0o700);
    assertPrivateDirectory(parent);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = openSync(lockPath, "wx", 0o600);
        try {
          writeFileSync(
            descriptor,
            `${JSON.stringify({ pid: process.pid, nonce })}\n`,
            "utf8",
          );
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        return {
          release() {
            releaseRelayCredentialFileLock(lockPath, nonce);
          },
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = readRelayCredentialLock(lockPath);
        if (isProcessAlive(existing.pid)) {
          throw new CollabError(
            "relay_enrolment_in_progress",
            "Another local process is enrolling this scoped relay credential",
          );
        }
        try {
          unlinkSync(lockPath);
        } catch (unlinkError) {
          if (
            (unlinkError as NodeJS.ErrnoException).code !== "ENOENT"
            || attempt === 1
          ) {
            throw unlinkError;
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "relay_enrolment_lock_failed",
      "Could not acquire the private local relay enrollment lock",
    );
  }
  throw new CollabError(
    "relay_enrolment_in_progress",
    "Another local process is enrolling this scoped relay credential",
  );
}

export function readRelayCredentialFile(
  pathInput: string,
): RelayCredentialMetadata {
  const path = resolve(pathInput);
  try {
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError(
        "relay_credential_file_unsafe",
        "Relay credential path must be a private regular file owned by this user",
      );
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new CollabError(
        "relay_credential_file_not_private",
        "Relay credential file must not be accessible by group or other users",
      );
    }
    if (stat.size > 32 * 1024) {
      throw new CollabError(
        "relay_credential_file_too_large",
        "Relay credential metadata exceeds its size bound",
      );
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const result = relayCredentialMetadataSchema.safeParse(parsed);
    if (!result.success) {
      throw new CollabError(
        "relay_credential_file_invalid",
        "Relay credential metadata has an unsupported or malformed format",
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "relay_credential_file_read_failed",
      "Could not read the scoped relay credential metadata",
    );
  }
}

export function writeRelayCredentialFile(
  pathInput: string,
  credential: RelayCredentialMetadata,
  options: { replace?: boolean } = {},
): string {
  const result = relayCredentialMetadataSchema.safeParse(credential);
  if (!result.success) {
    throw new CollabError(
      "relay_credential_file_invalid",
      "Refusing to write malformed relay credential metadata",
    );
  }
  const path = resolve(pathInput);
  const parent = dirname(path);
  let temporary: string | null = null;
  let linkedFinal = false;
  try {
    const parentExisted = existsSync(parent);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (!parentExisted) chmodSync(parent, 0o700);
    assertPrivateDirectory(parent);
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (
        !options.replace
        || !stat.isFile()
        || stat.isSymbolicLink()
        || !isOwnedByCurrentUser(stat.uid)
        || (stat.mode & 0o077) !== 0
      ) {
        throw new CollabError(
          options.replace
            ? "relay_credential_file_unsafe"
            : "relay_credential_file_exists",
          options.replace
            ? "Replacement requires a private regular credential file owned by this user"
            : "Refusing to overwrite an existing relay credential path",
        );
      }
    }
    temporary = `${path}.tmp-${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify(result.data, null, 2)}\n`,
        "utf8",
      );
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (options.replace) {
      renameSync(temporary, path);
    } else {
      try {
        linkSync(temporary, path);
        linkedFinal = true;
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new CollabError(
            "relay_credential_file_exists",
            "Refusing to overwrite an existing relay credential path",
          );
        }
        throw error;
      }
    }
    temporary = null;
    chmodSync(path, 0o600);
    return path;
  } catch (error) {
    if (linkedFinal && existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Preserve the primary write error.
      }
    }
    if (temporary && existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Preserve the primary write error.
      }
    }
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "relay_credential_file_write_failed",
      "Could not atomically write scoped relay credential metadata",
    );
  }
}

export function removeRelayCredentialFile(pathInput: string): void {
  const path = resolve(pathInput);
  try {
    if (!existsSync(path)) return;
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError(
        "relay_credential_file_unsafe",
        "Refusing to remove a non-regular relay credential path",
      );
    }
    unlinkSync(path);
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "relay_credential_file_remove_failed",
      "Could not remove scoped relay credential metadata",
    );
  }
}

export function resolveRelayCredential(
  metadata: RelayCredentialMetadata,
  stores: {
    keychain?: RelaySecretStore;
    environment?: RelaySecretStore;
  } = {},
): ResolvedRelayCredential {
  if (metadata.state !== "active" || metadata.repository.id === null) {
    throw new CollabError(
      "relay_enrolment_pending",
      "Relay enrollment is pending and cannot authenticate repository requests",
    );
  }
  const store = metadata.token.source === "keychain"
    ? stores.keychain ?? new MacOSKeychainRelaySecretStore()
    : stores.environment ?? new EnvironmentRelaySecretStore();
  const token = store.resolve(metadata.token);
  assertRelayToken(token);
  return {
    metadata: metadata as ResolvedRelayCredential["metadata"],
    token,
  };
}

function keychainAccount(repositoryKey: string, deviceId: string): string {
  return `relay:${createHash("sha256").update(repositoryKey).digest("hex").slice(0, 24)}:${deviceId}`;
}

function absoluteEnvironmentPath(value: string, name: string): string {
  if (!isAbsolute(value)) {
    throw new CollabError(
      "relay_state_path_invalid",
      `${name} must be an absolute path`,
    );
  }
  return resolve(value);
}

function readRelayCredentialLock(path: string): RelayCredentialLockRecord {
  const stat = lstatSync(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || !isOwnedByCurrentUser(stat.uid)
    || (stat.mode & 0o077) !== 0
    || stat.size > 1_024
  ) {
    throw new CollabError(
      "relay_enrolment_lock_unsafe",
      "Existing relay enrollment lock is not a private regular file owned by this user",
    );
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      pid?: unknown;
      nonce?: unknown;
    };
    if (
      !Number.isSafeInteger(value.pid)
      || (value.pid as number) < 1
      || typeof value.nonce !== "string"
      || !uuid.safeParse(value.nonce).success
    ) {
      throw new Error("invalid lock record");
    }
    return value as RelayCredentialLockRecord;
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "relay_enrolment_lock_unsafe",
      "Existing relay enrollment lock has an unsupported format",
    );
  }
}

function releaseRelayCredentialFileLock(path: string, nonce: string): void {
  try {
    if (!existsSync(path)) return;
    const current = readRelayCredentialLock(path);
    if (current.nonce === nonce) unlinkSync(path);
  } catch {
    // Never replace the enrollment result with cleanup failure. A surviving
    // lock fails closed and can be reclaimed only after its recorded PID exits.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || !isOwnedByCurrentUser(stat.uid)
    || (stat.mode & 0o077) !== 0
  ) {
    throw new CollabError(
      "relay_credential_directory_not_private",
      "Relay credential directory must be a private non-symlink directory owned by this user",
    );
  }
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}
