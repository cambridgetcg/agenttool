/** Hub custody: the project bearer and the door key.
 *
 * Both live in the hub device's macOS login Keychain and are used by the
 * `agenttool-lobby` CLI only: never by the MCP server, never printed, never
 * placed in argv or model context. This module is the one place in the
 * package that starts a process, and the only process it starts is
 * `/usr/bin/security`:
 *
 * - existence: `security find-generic-password -s S -a A` (prints attributes,
 *   which are discarded; no secret);
 * - read: `security find-generic-password -s S -a A -w`, whose stdout (the
 *   secret) is read into memory through a pipe and never written anywhere;
 * - add: `security -i` with the command line, secret included, written to the
 *   child's stdin, so the secret never appears in any process's argv. Without
 *   `-U`, an existing item is never overwritten. The write is then verified
 *   by reading the item back and comparing in memory.
 *
 * stderr is discarded unread, so a Keychain error text cannot carry a secret
 * into a message. Tests inject `FileSecretStore`, an owner-only file-backed
 * provider; production code never selects it from a flag or environment
 * variable.
 *
 * Limit: a JavaScript string cannot be wiped, so a secret stays in this
 * process's memory until it is garbage-collected or the process exits.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LobbyError } from "./errors.js";
import { assertPrivateDirectory } from "./home.js";
import { readPrivateFile, writeNewPrivateFile } from "./secrets.js";
import { BEARER_PATTERN, isCanonicalBase64, privateKeyFromSeed } from "./wire.js";
import type { KeyObject } from "node:crypto";

export const SECURITY_TOOL = "/usr/bin/security";
// Never starts with "-", so a name can never read as an option to security.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_SECRET_OUTPUT = 4096;
const SECURITY_TIMEOUT_MS = 15_000;
const ITEM_NOT_FOUND = 44;

export interface KeychainRef {
  service: string;
  account: string;
}

export interface SecretStore {
  readonly kind: "macos-keychain" | "file";
  has(ref: KeychainRef): Promise<boolean>;
  read(ref: KeychainRef): Promise<string>;
  /** Add a new item; refuses to overwrite an existing one. */
  add(ref: KeychainRef, secret: string): Promise<void>;
}

export function assertKeychainRef(ref: KeychainRef): KeychainRef {
  if (!NAME_PATTERN.test(ref?.service ?? "") || !NAME_PATTERN.test(ref?.account ?? "")) {
    throw new LobbyError("invalid_keychain_name", "Keychain service and account names are 1-128 of [A-Za-z0-9._-], starting with a letter or digit");
  }
  return ref;
}

function assertSecretShape(secret: string): void {
  if (!SECRET_PATTERN.test(secret)) {
    throw new LobbyError("invalid_secret_shape", "only base64url-shaped secrets are stored by the desk");
  }
}

export interface SecurityResult {
  code: number;
  stdout: string;
}

/** Runs /usr/bin/security with fixed arguments; `stdin` carries any secret. */
export type SecurityRunner = (args: readonly string[], stdin: string | null) => Promise<SecurityResult>;

export const systemSecurityRunner: SecurityRunner = async (args, stdin) => {
  const child = Bun.spawn([SECURITY_TOOL, ...args], {
    stdin: stdin === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "" },
  });
  const timer = setTimeout(() => child.kill(), SECURITY_TIMEOUT_MS);
  try {
    if (stdin !== null && child.stdin) {
      child.stdin.write(stdin);
      await child.stdin.end();
    }
    const stdout = await new Response(child.stdout).text();
    const code = await child.exited;
    return { code, stdout };
  } finally {
    clearTimeout(timer);
  }
};

export class MacKeychainStore implements SecretStore {
  readonly kind = "macos-keychain" as const;

  constructor(private readonly run: SecurityRunner = systemSecurityRunner) {}

  async has(ref: KeychainRef): Promise<boolean> {
    const { service, account } = assertKeychainRef(ref);
    const result = await this.run(["find-generic-password", "-s", service, "-a", account], null);
    if (result.code === 0) return true;
    if (result.code === ITEM_NOT_FOUND) return false;
    throw new LobbyError("keychain_unavailable", "the login Keychain could not be searched");
  }

  async read(ref: KeychainRef): Promise<string> {
    const { service, account } = assertKeychainRef(ref);
    const result = await this.run(["find-generic-password", "-s", service, "-a", account, "-w"], null);
    if (result.code === ITEM_NOT_FOUND) {
      throw new LobbyError("keychain_item_missing", `no Keychain item for service ${service} and account ${account}`);
    }
    if (result.code !== 0 || result.stdout.length > MAX_SECRET_OUTPUT) {
      throw new LobbyError("keychain_unavailable", "the Keychain item could not be read");
    }
    return result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
  }

  async add(ref: KeychainRef, secret: string): Promise<void> {
    const { service, account } = assertKeychainRef(ref);
    assertSecretShape(secret);
    if (await this.has(ref)) {
      throw new LobbyError("keychain_item_exists", `a Keychain item for service ${service} already exists; it is never overwritten`);
    }
    // The secret travels on stdin; argv is only "-i".
    await this.run(["-i"], `add-generic-password -s ${service} -a ${account} -w ${secret}\n`);
    let stored: string;
    try {
      stored = await this.read(ref);
    } catch {
      throw new LobbyError("keychain_write_unverified", "the Keychain item could not be read back after writing");
    }
    if (stored !== secret) {
      throw new LobbyError("keychain_write_unverified", "the Keychain item read back differs from what was written");
    }
  }
}

/** Owner-only file-backed provider for tests: directory 0700, one 0600 file
 * per item. It is exported for tests and never chosen by production code. */
export class FileSecretStore implements SecretStore {
  readonly kind = "file" as const;

  constructor(private readonly directory: string) {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(directory);
  }

  private path(ref: KeychainRef): string {
    const { service, account } = assertKeychainRef(ref);
    return join(this.directory, `${service}__${account}`);
  }

  async has(ref: KeychainRef): Promise<boolean> {
    return existsSync(this.path(ref));
  }

  async read(ref: KeychainRef): Promise<string> {
    if (!(await this.has(ref))) {
      throw new LobbyError("keychain_item_missing", `no Keychain item for service ${ref.service} and account ${ref.account}`);
    }
    return readPrivateFile(this.path(ref), MAX_SECRET_OUTPUT);
  }

  async add(ref: KeychainRef, secret: string): Promise<void> {
    assertSecretShape(secret);
    if (await this.has(ref)) {
      throw new LobbyError("keychain_item_exists", `a Keychain item for service ${ref.service} already exists; it is never overwritten`);
    }
    writeNewPrivateFile(this.path(ref), secret);
  }
}

/** Read the project bearer into memory. Never print or store the result. */
export async function readBearer(store: SecretStore, ref: KeychainRef): Promise<string> {
  const bearer = await store.read(ref);
  if (!BEARER_PATTERN.test(bearer)) {
    throw new LobbyError("keychain_bearer_shape", "the Keychain bearer item does not hold a project bearer (at_...)");
  }
  return bearer;
}

/** Read the door key seed and rebuild the private key in memory. */
export async function readDoorKey(store: SecretStore, ref: KeychainRef): Promise<KeyObject> {
  const seed = await store.read(ref);
  if (!isCanonicalBase64(seed, 32, "base64url")) {
    throw new LobbyError("keychain_door_key_shape", "the Keychain door item does not hold a 32-byte Ed25519 seed");
  }
  return privateKeyFromSeed(Buffer.from(seed, "base64url"));
}
