import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import {
  EnvironmentRelaySecretStore,
  generateRelayToken,
  MacOSKeychainRelaySecretStore,
  normalizeRelayUrl,
  readRelayCredentialFile,
  relayTokenPrefix,
  relayTokenSha256,
  type SecurityCommandRunner,
  writeRelayCredentialFile,
} from "../src/relay-credential.js";
import {
  DEVICE_ID,
  NOW,
  profile,
  RELAY_TOKEN,
  TOKEN_PREFIX,
} from "./relay-fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-relay-credential-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("scoped relay credentials", () => {
  test("generates exact opaque atc_ tokens, prefixes, and hashes", () => {
    const token = generateRelayToken();
    expect(token).toMatch(/^atc_[A-Za-z0-9_-]{43}$/);
    expect(relayTokenPrefix(token)).toBe(token.slice(0, 12));
    expect(relayTokenSha256(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("writes Keychain secrets over stdin and never argv", () => {
    const calls: Array<{
      args: string[];
      secret_stdin?: string;
    }> = [];
    const runner: SecurityCommandRunner = {
      run(args, options) {
        calls.push({ args: [...args], secret_stdin: options?.secret_stdin });
        return { status: 0, stdout: "" };
      },
    };
    const store = new MacOSKeychainRelaySecretStore(runner, "darwin");
    const reference = store.store(RELAY_TOKEN, {
      repository_key: profile.repository.key,
      device_id: DEVICE_ID,
    });

    expect(reference.source).toBe("keychain");
    expect(reference.prefix).toBe(TOKEN_PREFIX);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.at(-1)).toBe("-w");
    expect(calls[0]!.args.join(" ")).not.toContain(RELAY_TOKEN);
    expect(calls[0]!.secret_stdin).toBe(RELAY_TOKEN);
  });

  test("does not expose a Keychain token in failures", () => {
    const runner: SecurityCommandRunner = {
      run() {
        return { status: 1, stdout: RELAY_TOKEN };
      },
    };
    const store = new MacOSKeychainRelaySecretStore(runner, "darwin");
    try {
      store.store(RELAY_TOKEN, {
        repository_key: profile.repository.key,
        device_id: DEVICE_ID,
      });
      throw new Error("expected Keychain write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CollabError);
      expect(JSON.stringify(error)).not.toContain(RELAY_TOKEN);
      expect((error as Error).message).not.toContain(RELAY_TOKEN);
    }
  });

  test("persists only mode-0600 metadata, never the raw bearer", () => {
    const root = temporaryDirectory();
    const path = join(root, "private", "credential.json");
    writeRelayCredentialFile(path, {
      format: "agenttool.collab/relay-credential/1",
      state: "active",
      relay_url: "https://relay.example",
      repository: {
        key: profile.repository.key,
        id: "11111111-1111-4111-8111-111111111111",
      },
      device: { id: DEVICE_ID, label: "Yu Mac", version: 1 },
      token: {
        source: "environment",
        variable: "AGENTOOL_COLLAB_RELAY_TOKEN",
        prefix: TOKEN_PREFIX,
      },
      pending_enrolment: null,
      created_at: NOW,
      updated_at: NOW,
    });

    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(RELAY_TOKEN);
    expect(text).toContain(TOKEN_PREFIX);
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(join(root, "private")).mode & 0o077).toBe(0);
    expect(readRelayCredentialFile(path).state).toBe("active");

    chmodSync(path, 0o644);
    expectCollabCode(
      () => readRelayCredentialFile(path),
      "relay_credential_file_not_private",
    );
  });

  test("allows only canonical HTTPS origins, except loopback HTTP", () => {
    expect(normalizeRelayUrl("https://relay.example/")).toBe(
      "https://relay.example",
    );
    expect(normalizeRelayUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    for (const invalid of [
      "http://relay.example",
      "https://user:pass@relay.example",
      "https://relay.example/path",
      "https://relay.example?token=secret",
      "https://relay.example#fragment",
    ]) {
      expectCollabCode(() => normalizeRelayUrl(invalid), "relay_url_invalid");
    }
  });

  test("environment storage resolves only the explicitly scoped exact token", () => {
    const store = new EnvironmentRelaySecretStore({
      AGENTOOL_COLLAB_RELAY_TOKEN: RELAY_TOKEN,
    });
    const reference = store.store(RELAY_TOKEN, {
      repository_key: profile.repository.key,
      device_id: DEVICE_ID,
    });
    expect(store.resolve(reference)).toBe(RELAY_TOKEN);

    const wrong = new EnvironmentRelaySecretStore({
      AGENTOOL_COLLAB_RELAY_TOKEN: `atc_${"B".repeat(43)}`,
    });
    expectCollabCode(
      () => wrong.resolve(reference),
      "relay_token_prefix_mismatch",
    );
  });
});

function expectCollabCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CollabError);
    expect((error as CollabError).code).toBe(code);
  }
}
