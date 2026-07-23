import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import type { SessionCredential } from "../src/protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
  writeSessionCredentialFile,
} from "../src/session-file.js";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-session-file-"));
  directories.push(directory);
  return directory;
}

function credential(): SessionCredential {
  return {
    session_id: "session_test",
    session_token: "test-only-placeholder-token",
    generation: 3,
    last_cursor: {
      epoch_id: "epoch_test",
      sequence: 7,
      hash: "a".repeat(64),
    },
  };
}

function collabError(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

describe("host-only session credential files", () => {
  test("creates private state atomically and round-trips it", () => {
    const directory = fixture();
    const path = join(directory, "private", "session.json");
    expect(writeSessionCredentialFile(path, credential())).toBe(path);
    expect(statSync(join(directory, "private")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSessionCredentialFile(path)).toEqual(credential());
    expect(readFileSync(path, "utf8")).toContain(
      "agenttool.collab/session-file/1",
    );
  });

  test("refuses overwrite, symlink, and non-private boundaries without leaking paths", () => {
    const directory = fixture();
    const privateDirectory = join(directory, "private");
    mkdirSync(privateDirectory, { mode: 0o700 });
    const existing = join(privateDirectory, "existing.json");
    writeSessionCredentialFile(existing, credential());
    const overwrite = collabError(() =>
      writeSessionCredentialFile(existing, credential()),
    );
    expect(overwrite.code).toBe("session_file_exists");
    expect(JSON.stringify(overwrite.details)).not.toContain(directory);

    const target = join(privateDirectory, "target.txt");
    const link = join(privateDirectory, "session-link.json");
    writeFileSync(target, "do not replace\n", { mode: 0o600 });
    symlinkSync(target, link);
    const symlink = collabError(() =>
      writeSessionCredentialFile(link, credential(), { replace: true }),
    );
    expect(symlink.code).toBe("session_file_unsafe");
    expect(readFileSync(target, "utf8")).toBe("do not replace\n");
    expect(JSON.stringify(symlink.details)).not.toContain(directory);

    const publicDirectory = join(directory, "public");
    mkdirSync(publicDirectory, { mode: 0o755 });
    chmodSync(publicDirectory, 0o755);
    const publicError = collabError(() =>
      writeSessionCredentialFile(
        join(publicDirectory, "session.json"),
        credential(),
      ),
    );
    expect(publicError.code).toBe("session_directory_not_private");
    expect(statSync(publicDirectory).mode & 0o777).toBe(0o755);
    expect(JSON.stringify(publicError.details)).not.toContain(directory);
  });

  test("does not silently chmod or remove an unsafe credential path", () => {
    const directory = fixture();
    const privateDirectory = join(directory, "private");
    mkdirSync(privateDirectory, { mode: 0o700 });
    const exposed = join(privateDirectory, "exposed.json");
    writeSessionCredentialFile(exposed, credential());
    chmodSync(exposed, 0o644);
    const readError = collabError(() => readSessionCredentialFile(exposed));
    expect(readError.code).toBe("session_file_not_private");
    expect(statSync(exposed).mode & 0o777).toBe(0o644);

    const target = join(privateDirectory, "keep.txt");
    const link = join(privateDirectory, "remove-link.json");
    writeFileSync(target, "keep\n", { mode: 0o600 });
    symlinkSync(target, link);
    const removeError = collabError(() => removeSessionCredentialFile(link));
    expect(removeError.code).toBe("session_file_unsafe");
    expect(readFileSync(target, "utf8")).toBe("keep\n");
    expect(JSON.stringify(removeError.details)).not.toContain(directory);
  });
});
