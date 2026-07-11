import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DataNodeError } from "./errors.js";
import { sha256Hex } from "./canonical.js";
import type { BlobStore } from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class FileSystemBlobStore implements BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(bytes: Uint8Array, sha256: string): Promise<string> {
    if (!SHA256_PATTERN.test(sha256) || sha256Hex(bytes) !== sha256) {
      throw new DataNodeError("blob_hash_mismatch", "Blob bytes do not match the supplied SHA-256");
    }

    const blobRef = `sha256:${sha256}`;
    const path = this.pathFor(blobRef);
    const directory = join(this.root, sha256.slice(0, 2));
    await this.ensureDirectory(this.root);
    await this.ensureDirectory(directory);

    if (await this.isValidBlob(path, bytes.byteLength, sha256)) {
      await this.syncDirectory(directory);
      return blobRef;
    }

    const temporary = `${path}.${randomUUID()}.tmp`;
    let renamed = false;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
      renamed = true;
      await this.syncDirectory(directory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true });
      if (!renamed && await this.isValidBlob(path, bytes.byteLength, sha256)) {
        await this.syncDirectory(directory);
        return blobRef;
      }
      throw error;
    }
    return blobRef;
  }

  async get(blob_ref: string): Promise<Uint8Array> {
    try {
      const bytes = new Uint8Array(await readFile(this.pathFor(blob_ref)));
      const expected = this.hashFromRef(blob_ref);
      if (sha256Hex(bytes) !== expected) {
        throw new DataNodeError("blob_integrity_error", "Stored blob failed its integrity check", 500);
      }
      return bytes;
    } catch (error) {
      if (error instanceof DataNodeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new DataNodeError("blob_not_found", "Blob is not present on this node", 404);
      }
      throw error;
    }
  }

  async has(blob_ref: string): Promise<boolean> {
    return Bun.file(this.pathFor(blob_ref)).exists();
  }

  protected async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async ensureDirectory(directory: string): Promise<void> {
    const existed = await pathExists(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!existed) await this.syncDirectory(dirname(directory));
  }

  private async isValidBlob(path: string, expectedSize: number, expectedHash: string): Promise<boolean> {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size !== expectedSize) return false;
      return sha256Hex(new Uint8Array(await readFile(path))) === expectedHash;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private pathFor(blobRef: string): string {
    const hash = this.hashFromRef(blobRef);
    return join(this.root, hash.slice(0, 2), `${hash}.blob`);
  }

  private hashFromRef(blobRef: string): string {
    const match = /^sha256:([a-f0-9]{64})$/.exec(blobRef);
    if (!match) throw new DataNodeError("invalid_blob_ref", "Blob reference is invalid", 400);
    return match[1]!;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
