import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataNode } from "../src/index.js";

const roots: string[] = [];
const nodes: DataNode[] = [];

afterEach(async () => {
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "agent-data-feed-id-"));
  roots.push(value);
  return value;
}

describe("change feed incarnation", () => {
  test("persists across reopen and changes when storage is recreated under the same node id", async () => {
    const firstRoot = await root();
    const first = await DataNode.open({ root: firstRoot, node_id: "node_stable" });
    const firstFeed = first.feed_id;
    expect(firstFeed).toMatch(
      /^feed_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    first.close();

    const reopened = await DataNode.open({ root: firstRoot, node_id: "node_stable" });
    nodes.push(reopened);
    expect(reopened.feed_id).toBe(firstFeed);

    const replacement = await DataNode.open({ root: await root(), node_id: "node_stable" });
    nodes.push(replacement);
    expect(replacement.feed_id).not.toBe(firstFeed);
  });
});
