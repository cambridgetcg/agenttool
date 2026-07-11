import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataNode,
  FileSystemBlobStore,
  sha256Hex,
} from "../src/index.js";

const nodes: DataNode[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-storage-test-"));
  roots.push(root);
  return root;
}

function permissions(mode: number): number {
  return mode & 0o777;
}

describe("SQLite file permissions", () => {
  test("tightens DB, WAL, and SHM to 0600 without changing a traversable caller root", async () => {
    const root = await temporaryRoot();
    await chmod(root, 0o755);
    const dbPath = join(root, "data.sqlite");
    await writeFile(dbPath, new Uint8Array(), { mode: 0o644 });
    await chmod(dbPath, 0o644);

    const node = await DataNode.open({
      root,
      db_path: dbPath,
      collections: [{ id: "secure" }],
    });
    nodes.push(node);
    await node.collect({
      collection_id: "secure",
      collector_id: "text",
      input: { text: "permission proof" },
    });

    expect(permissions((await stat(root)).mode)).toBe(0o755);
    expect(permissions((await stat(dbPath)).mode)).toBe(0o600);
    expect(permissions((await stat(`${dbPath}-wal`)).mode)).toBe(0o600);
    expect(permissions((await stat(`${dbPath}-shm`)).mode)).toBe(0o600);
  });
});

describe("content-addressed blob durability", () => {
  test("re-collection atomically repairs a same-size corrupt CAS file", async () => {
    const root = await temporaryRoot();
    const node = await DataNode.open({ root, collections: [{ id: "repair" }] });
    nodes.push(node);
    const request = {
      collection_id: "repair",
      collector_id: "text",
      input: { text: "durable original bytes" },
    } as const;
    const first = await node.collect(request);
    const record = first.records[0]!;
    const blobPath = join(
      root,
      "blobs",
      record.content.sha256.slice(0, 2),
      `${record.content.sha256}.blob`,
    );
    await writeFile(blobPath, new TextEncoder().encode("x".repeat(record.content.size)));
    expect(sha256Hex(new Uint8Array(await readFile(blobPath)))).not.toBe(record.content.sha256);

    const repaired = await node.collect(request);
    expect(repaired).toMatchObject({ inserted: 0, existing: 1 });
    expect(new TextDecoder().decode(await node.readContent(record))).toBe("durable original bytes");
    expect(node.changes().changes).toHaveLength(1);
    expect(permissions((await stat(blobPath)).mode)).toBe(0o600);
  });

  test("propagates a post-rename directory fsync failure even when the final path exists", async () => {
    const root = await temporaryRoot();
    const blobRoot = join(root, "blobs");
    await mkdir(blobRoot, { recursive: true });
    const store = new FailingPostRenameSyncStore(blobRoot);
    const bytes = new TextEncoder().encode("fsync boundary");
    const hash = sha256Hex(bytes);

    await expect(store.put(bytes, hash)).rejects.toThrow("synthetic directory fsync failure");
    const finalPath = join(blobRoot, hash.slice(0, 2), `${hash}.blob`);
    expect(new Uint8Array(await readFile(finalPath))).toEqual(bytes);
    await expect(store.put(bytes, hash)).resolves.toBe(`sha256:${hash}`);
  });
});

class FailingPostRenameSyncStore extends FileSystemBlobStore {
  private failed = false;

  protected override async syncDirectory(directory: string): Promise<void> {
    if (!this.failed && directory !== this.root) {
      this.failed = true;
      throw new Error("synthetic directory fsync failure");
    }
    await super.syncDirectory(directory);
  }
}
