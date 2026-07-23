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
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CollabError } from "./errors.js";
import type { SessionCredential } from "./protocol.js";

interface CredentialFileV1 {
  format: "agenttool.collab/session-file/1";
  session_id: string;
  session_token: string;
  generation: number;
  last_cursor?: {
    epoch_id: string;
    sequence: number;
    hash: string;
  };
}

export function readSessionCredentialFile(pathInput: string): SessionCredential {
  const path = resolve(pathInput);
  try {
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError(
        "session_file_unsafe",
        "Session credential path must be a private regular file owned by this user",
        { operation: "read_session_credential_file" },
      );
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new CollabError(
        "session_file_not_private",
        "Session credential file must not be accessible by group or other users",
        { operation: "read_session_credential_file" },
      );
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialFileV1>;
    if (
      parsed.format !== "agenttool.collab/session-file/1"
      || typeof parsed.session_id !== "string"
      || typeof parsed.session_token !== "string"
      || !Number.isInteger(parsed.generation)
      || parsed.generation! < 1
      || (
        parsed.last_cursor !== undefined
        && (
          typeof parsed.last_cursor?.epoch_id !== "string"
          || !Number.isInteger(parsed.last_cursor?.sequence)
          || parsed.last_cursor.sequence < 0
          || typeof parsed.last_cursor?.hash !== "string"
          || !/^[a-f0-9]{64}$/.test(parsed.last_cursor.hash)
        )
      )
    ) {
      throw new CollabError(
        "session_file_invalid",
        "Session credential file has an unsupported or malformed format",
        { operation: "read_session_credential_file" },
      );
    }
    return {
      session_id: parsed.session_id,
      session_token: parsed.session_token,
      generation: parsed.generation!,
      last_cursor: parsed.last_cursor,
    };
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "session_file_read_failed",
      "Could not read the local session credential file",
      { operation: "read_session_credential_file" },
    );
  }
}

export function writeSessionCredentialFile(
  pathInput: string,
  credential: SessionCredential,
  options: { replace?: boolean } = {},
): string {
  const path = resolve(pathInput);
  const parent = dirname(path);
  const parentExisted = existsSync(parent);
  let temporary: string | null = null;
  let linkedFinal = false;
  try {
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
          options.replace ? "session_file_unsafe" : "session_file_exists",
          options.replace
            ? "Replacement requires a private regular credential file owned by this user"
            : "Refusing to overwrite an existing session credential path",
          { operation: "write_session_credential_file" },
        );
      }
    }
    const payload: CredentialFileV1 = {
      format: "agenttool.collab/session-file/1",
      session_id: credential.session_id,
      session_token: credential.session_token,
      generation: credential.generation,
      last_cursor: credential.last_cursor,
    };
    temporary = `${path}.tmp-${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, "utf8");
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
            "session_file_exists",
            "Refusing to overwrite an existing session credential path",
            { operation: "write_session_credential_file" },
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
        // Avoid masking the primary atomic-write error.
      }
    }
    if (temporary && existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // The primary error below names the failed credential-file operation.
      }
    }
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "session_file_write_failed",
      "Could not atomically write the local session credential file",
      { operation: "write_session_credential_file" },
    );
  }
}

export function removeSessionCredentialFile(pathInput: string): void {
  const path = resolve(pathInput);
  try {
    if (!existsSync(path)) return;
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError(
        "session_file_unsafe",
        "Refusing to remove a non-regular session credential path",
        { operation: "remove_session_credential_file" },
      );
    }
    unlinkSync(path);
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "session_file_remove_failed",
      "The session ended, but its revoked local credential file could not be removed",
      { operation: "remove_session_credential_file" },
    );
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
      "session_directory_not_private",
      "Session credential directory must be a private non-symlink directory owned by this user",
      { operation: "validate_session_credential_directory" },
    );
  }
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}
