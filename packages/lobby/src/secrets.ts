/** Desk secrets on this device: the desk signing key and grant-token preimages.
 *
 * They live in `<desk home>/secrets` (directory 0700, files 0600), outside
 * lobby.sqlite, so the read-only MCP handle never reaches them and no SQL
 * query can return them. Nothing here prints, logs or returns a token or a
 * private key to a caller that could print it: `tokenFor` is used only by the
 * hosted transport to fill an Authorization header.
 *
 * The token file format is the participant client's
 * `agenttool-mission-participant-token/v1` (bin/agenttool-mission.mjs).
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { join } from "node:path";
import { LobbyError } from "./errors.js";
import { assertPrivateDirectory } from "./home.js";
import {
  generateKeyPair,
  isGrantToken,
  isSha256Hex,
  newGrantToken,
  PARTICIPANT_TOKEN_FORMAT,
  publicKeyBase64,
  publicKeyFingerprint,
  sha256HexOf,
} from "./wire.js";

export const SECRETS_DIR = "secrets";
const DESK_KEY_FILE = "desk-key.pem";
const TOKENS_DIR = "tokens";
const MAX_SECRET_FILE = 8192;

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

/** Read a private regular file without following links; refuse wider modes. */
export function readPrivateFile(path: string, maxBytes = MAX_SECRET_FILE): string {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new LobbyError("secret_unreadable", "a desk secret file is missing or is a link");
  }
  try {
    const stat = fstatSync(fd);
    const uid = currentUid();
    if (!stat.isFile() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
      throw new LobbyError("secret_not_private", "desk secret files must be regular, owned and mode 600");
    }
    if (stat.size > maxBytes) throw new LobbyError("secret_unreadable", "a desk secret file is too large");
    const bytes = readFileSync(fd);
    if (bytes.length > maxBytes) throw new LobbyError("secret_unreadable", "a desk secret file is too large");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    closeSync(fd);
  }
}

/** Create a new 0600 file; never overwrite, never follow a link. */
export function writeNewPrivateFile(path: string, text: string): void {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new LobbyError("secret_exists", "a desk secret file already exists; it is never overwritten");
    }
    throw new LobbyError("secret_unwritable", "could not create a private desk secret file");
  }
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  assertPrivateDirectory(path);
}

export class DeskSecrets {
  private constructor(private readonly root: string) {}

  /** Open (creating 0700 if needed) `<home>/secrets`. The home itself must
   * already be the private desk directory (LobbyStore.open creates it). */
  static open(home: string): DeskSecrets {
    assertPrivateDirectory(home);
    const root = join(home, SECRETS_DIR);
    ensurePrivateDirectory(root);
    return new DeskSecrets(root);
  }

  hasDeskKey(): boolean {
    return existsSync(join(this.root, DESK_KEY_FILE));
  }

  /** Generate the desk's Ed25519 key once. Returns only public facts. */
  createDeskKey(): { public_key: string; fingerprint: string } {
    const key = generateKeyPair();
    writeNewPrivateFile(join(this.root, DESK_KEY_FILE), key.export({ format: "pem", type: "pkcs8" }) as string);
    const publicKey = publicKeyBase64(key);
    return { public_key: publicKey, fingerprint: publicKeyFingerprint(publicKey) };
  }

  /** The desk private key, in memory, for signing on this device only. */
  deskKey(): KeyObject {
    const key = createPrivateKey(readPrivateFile(join(this.root, DESK_KEY_FILE)));
    if (key.asymmetricKeyType !== "ed25519") throw new LobbyError("invalid_key", "the desk key is not Ed25519");
    return key;
  }

  deskPublicKey(): string {
    return publicKeyBase64(this.deskKey());
  }

  private tokensDirectory(create: boolean): string {
    const directory = join(this.root, TOKENS_DIR);
    if (create) ensurePrivateDirectory(directory);
    else assertPrivateDirectory(directory);
    return directory;
  }

  /** Generate a grant token here; only its SHA-256 is returned. */
  newToken(now: Date): { token_sha256: string } {
    const prepared = this.prepareToken(now);
    prepared.write();
    return { token_sha256: prepared.token_sha256 };
  }

  /** Generate a token in memory; `write()` saves it (0600) once the act is
   * confirmed, so a declined act leaves no token file behind. */
  prepareToken(now: Date): { token_sha256: string; write: () => void } {
    const { token, token_sha256 } = newGrantToken();
    return {
      token_sha256,
      write: () => {
        const directory = this.tokensDirectory(true);
        writeNewPrivateFile(join(directory, `${token_sha256}.json`), `${JSON.stringify({
          format: PARTICIPANT_TOKEN_FORMAT,
          token_sha256,
          token,
          created_at: now.toISOString(),
        }, null, 2)}\n`);
      },
    };
  }

  hasToken(tokenSha256: string): boolean {
    if (!isSha256Hex(tokenSha256)) return false;
    return existsSync(join(this.root, TOKENS_DIR, `${tokenSha256}.json`));
  }

  /** The token preimage for one hash: only for the transport's Authorization header. */
  tokenFor(tokenSha256: string): string {
    if (!isSha256Hex(tokenSha256) || !this.hasToken(tokenSha256)) {
      throw new LobbyError("token_not_found", "no token generated on this desk matches that hash");
    }
    let value: unknown;
    try {
      value = JSON.parse(readPrivateFile(join(this.tokensDirectory(false), `${tokenSha256}.json`)));
    } catch (error) {
      if (error instanceof LobbyError) throw error;
      throw new LobbyError("token_invalid", "a stored token file is not valid JSON");
    }
    const record = value as Record<string, unknown>;
    if (record === null || typeof record !== "object"
      || Object.keys(record).sort().join(",") !== "created_at,format,token,token_sha256"
      || record.format !== PARTICIPANT_TOKEN_FORMAT || record.token_sha256 !== tokenSha256
      || !isGrantToken(record.token) || sha256HexOf(record.token as string) !== tokenSha256) {
      throw new LobbyError("token_invalid", "a stored token does not match its recorded hash");
    }
    return record.token as string;
  }
}
