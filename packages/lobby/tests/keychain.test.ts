/** Hub custody. The macOS Keychain store is tested through an injected
 * runner that records what /usr/bin/security would receive; no test touches
 * a real Keychain. The file-backed store is the tests' stand-in. */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { LobbyError } from "../src/errors.js";
import {
  FileSecretStore,
  MacKeychainStore,
  readBearer,
  readDoorKey,
  SECURITY_TOOL,
  type SecurityRunner,
} from "../src/keychain.js";
import { publicKeyBase64 } from "../src/wire.js";
import { cleanupTempHomes, tempHome } from "./helpers.js";

afterEach(cleanupTempHomes);

const REF = { service: "agenttool-lobby.door-key", account: "agenttool-lobby" };
const SEED = Buffer.alloc(32, 7).toString("base64url");

/** A scripted /usr/bin/security: an in-memory item map, every call recorded. */
function fakeSecurity() {
  const items = new Map<string, string>();
  const calls: Array<{ args: readonly string[]; stdin: string | null }> = [];
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args: [...args], stdin });
    if (args[0] === "find-generic-password") {
      const key = `${args[2]}|${args[4]}`;
      if (!items.has(key)) return { code: 44, stdout: "" };
      return { code: 0, stdout: args.includes("-w") ? `${items.get(key)}\n` : 'keychain: "login.keychain-db"\n' };
    }
    if (args[0] === "-i") {
      const match = /^add-generic-password -s (\S+) -a (\S+) -w (\S+)\n$/.exec(stdin ?? "");
      if (match && !items.has(`${match[1]}|${match[2]}`)) items.set(`${match[1]}|${match[2]}`, match[3]!);
      return { code: 0, stdout: "security> " };
    }
    return { code: 1, stdout: "" };
  };
  return { items, calls, run };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

describe("macOS Keychain store (scripted /usr/bin/security)", () => {
  test("the tool is /usr/bin/security and no secret ever appears in argv", async () => {
    expect(SECURITY_TOOL).toBe("/usr/bin/security");
    const security = fakeSecurity();
    const store = new MacKeychainStore(security.run);
    expect(await store.has(REF)).toBe(false);
    await store.add(REF, SEED);
    expect(await store.has(REF)).toBe(true);
    expect(await store.read(REF)).toBe(SEED);
    for (const call of security.calls) expect(call.args.join(" ")).not.toContain(SEED);
    const add = security.calls.find((call) => call.args[0] === "-i")!;
    expect(add.args).toEqual(["-i"]);
    expect(add.stdin).toBe(`add-generic-password -s ${REF.service} -a ${REF.account} -w ${SEED}\n`);
    // Existence checks never ask for the secret.
    expect(security.calls.filter((call) => call.args.includes("-w") && call.args[0] === "find-generic-password")).toHaveLength(2);
  });

  test("an existing item is never overwritten; unreadable or mismatched writes fail", async () => {
    const security = fakeSecurity();
    const store = new MacKeychainStore(security.run);
    await store.add(REF, SEED);
    expect(await code(store.add(REF, Buffer.alloc(32, 9).toString("base64url")))).toBe("keychain_item_exists");
    expect(await store.read(REF)).toBe(SEED);
    const silent = new MacKeychainStore(async (args) => args[0] === "find-generic-password" ? { code: 44, stdout: "" } : { code: 0, stdout: "" });
    expect(await code(silent.add(REF, SEED))).toBe("keychain_write_unverified");
    let stored = false;
    const wrong = new MacKeychainStore(async (args) => {
      if (args[0] === "-i") {
        stored = true;
        return { code: 0, stdout: "" };
      }
      if (!stored) return { code: 44, stdout: "" };
      return { code: 0, stdout: args.includes("-w") ? "something-else\n" : "" };
    });
    expect(await code(wrong.add(REF, SEED))).toBe("keychain_write_unverified");
  });

  test("missing items, failures, odd names and odd secret shapes are refused", async () => {
    const store = new MacKeychainStore(fakeSecurity().run);
    expect(await code(store.read(REF))).toBe("keychain_item_missing");
    const broken = new MacKeychainStore(async () => ({ code: 51, stdout: "" }));
    expect(await code(broken.has(REF))).toBe("keychain_unavailable");
    expect(await code(broken.read(REF))).toBe("keychain_unavailable");
    expect(await code(store.has({ service: "bad service", account: "a" }))).toBe("invalid_keychain_name");
    expect(await code(store.has({ service: "-w", account: "a" }))).toBe("invalid_keychain_name");
    expect(await code(store.has({ service: "svc", account: "-U" }))).toBe("invalid_keychain_name");
    expect(await code(store.add(REF, "two words"))).toBe("invalid_secret_shape");
    expect(await code(store.add(REF, "x\nadd-generic-password -s evil"))).toBe("invalid_secret_shape");
  });

  test("bearer and door key shapes are checked on read", async () => {
    const security = fakeSecurity();
    const store = new MacKeychainStore(security.run);
    const bearerRef = { service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" };
    await store.add(bearerRef, "not_a_bearer");
    expect(await code(readBearer(store, bearerRef))).toBe("keychain_bearer_shape");
    await store.add(REF, "short");
    expect(await code(readDoorKey(store, REF))).toBe("keychain_door_key_shape");
    const good = new MacKeychainStore(fakeSecurity().run);
    await good.add(REF, SEED);
    expect(publicKeyBase64(await readDoorKey(good, REF))).toHaveLength(44);
  });
});

describe("file-backed store for tests", () => {
  test("owner-only directory and files, no overwrite, no wider modes", async () => {
    const { parent } = tempHome();
    const directory = join(parent, "keychain");
    const store = new FileSecretStore(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    await store.add(REF, SEED);
    expect(statSync(join(directory, `${REF.service}__${REF.account}`)).mode & 0o777).toBe(0o600);
    expect(await store.read(REF)).toBe(SEED);
    expect(await code(store.add(REF, SEED))).toBe("keychain_item_exists");
    chmodSync(join(directory, `${REF.service}__${REF.account}`), 0o644);
    expect(await code(store.read(REF))).toBe("secret_not_private");
    const wide = join(parent, "wide");
    new FileSecretStore(wide);
    chmodSync(wide, 0o755);
    expect(() => new FileSecretStore(wide)).toThrow();
  });
});
