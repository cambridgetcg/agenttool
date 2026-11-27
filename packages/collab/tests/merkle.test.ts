import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import {
  JOURNAL_MERKLE_LEAF_DOMAIN,
  RFC6962_EMPTY_ROOT,
  journalLeafHash,
  journalLeafPreimage,
  journalMerkleRoot,
  largestPowerOfTwoLessThan,
  proveJournalConsistency,
  proveJournalInclusion,
  rfc6962ConsistencyProof,
  rfc6962InclusionProof,
  rfc6962LeafHash,
  rfc6962NodeHash,
  rfc6962Root,
  verifyJournalConsistency,
  verifyJournalInclusion,
  verifyRfc6962Consistency,
  verifyRfc6962Inclusion,
} from "../src/merkle.js";
import { GENESIS_HASH } from "../src/store.js";
import { CollabStore } from "../src/store-notes.js";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const VECTORS_PATH = join(REPO_ROOT, "docs/specs/rfc6962-vectors.json");

interface VectorsDoc {
  vector_version: string;
  algorithm: {
    empty_root: string;
    journal_leaf_domain: string;
  };
  raw_rfc6962: {
    empty_leaf_hash: string;
    sample_hex_leaves: {
      inputs_hex: string[];
      leaf_hashes: string[];
      root: string;
    };
    roots: Array<{ n: number; root: string }>;
    inclusion: Array<{
      tree_size: number;
      leaf_index: number;
      leaf_hash: string;
      root: string;
      path: string[];
    }>;
    consistency: Array<{
      from_size: number;
      to_size: number;
      from_root: string;
      to_root: string;
      path: string[];
    }>;
  };
  collab_journal: {
    epoch_id: string;
    leaves: Array<{ epoch_id: string; sequence: number; event_hash: string; leaf_hash: string }>;
    roots: Array<{ tree_size: number; root: string }>;
    inclusion: Array<{
      epoch_id: string;
      sequence: number;
      event_hash: string;
      leaf_hash: string;
      tree_size: number;
      root: string;
      path: string[];
    }>;
    consistency: Array<{
      epoch_id: string;
      from_size: number;
      to_size: number;
      from_root: string;
      to_root: string;
      path: string[];
    }>;
  };
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorsDoc;

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()!();
});

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "agenttool-collab-merkle-"));
  const root = join(dir, "repo");
  mkdirSync(root, { recursive: true });
  const store = new CollabStore(join(dir, "collab.sqlite"));
  const server = buildCollabMcpServer(store);
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, root, store, server };
}

async function callTool(server: ReturnType<typeof buildCollabMcpServer>, name: string, args: Record<string, unknown>) {
  const tool = (server as any)._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return await tool.handler(args, {});
}

describe("RFC 6962 conformance vectors (docs/specs/rfc6962-vectors.json)", () => {
  test("matches empty root, empty leaf, sample hex leaves, and all raw roots n=0..1000", () => {
    expect(vectors.algorithm.empty_root).toBe(RFC6962_EMPTY_ROOT);
    expect(vectors.algorithm.journal_leaf_domain).toBe(JOURNAL_MERKLE_LEAF_DOMAIN);
    expect(rfc6962LeafHash(new Uint8Array(0))).toBe(vectors.raw_rfc6962.empty_leaf_hash);
    expect(largestPowerOfTwoLessThan(2)).toBe(1);
    expect(largestPowerOfTwoLessThan(3)).toBe(2);
    expect(largestPowerOfTwoLessThan(4)).toBe(2);
    expect(largestPowerOfTwoLessThan(5)).toBe(4);
    expect(largestPowerOfTwoLessThan(8)).toBe(4);
    expect(largestPowerOfTwoLessThan(9)).toBe(8);

    const sampleLeaves = vectors.raw_rfc6962.sample_hex_leaves.inputs_hex.map((h) =>
      rfc6962LeafHash(Buffer.from(h, "hex")),
    );
    expect(sampleLeaves).toEqual(vectors.raw_rfc6962.sample_hex_leaves.leaf_hashes);
    expect(rfc6962Root(sampleLeaves)).toBe(vectors.raw_rfc6962.sample_hex_leaves.root);

    const rawLeaves = Array.from({ length: 1000 }, (_, i) => rfc6962LeafHash(`rfc6962-leaf-${i}`));
    for (const row of vectors.raw_rfc6962.roots) {
      expect(rfc6962Root(rawLeaves, row.n)).toBe(row.root);
    }
    for (const inc of vectors.raw_rfc6962.inclusion) {
      expect(rfc6962InclusionProof(rawLeaves, inc.leaf_index, inc.tree_size)).toEqual(inc.path);
      expect(verifyRfc6962Inclusion(inc)).toBe(true);
    }
    for (const cons of vectors.raw_rfc6962.consistency) {
      expect(rfc6962ConsistencyProof(rawLeaves, cons.from_size, cons.to_size)).toEqual(cons.path);
      expect(verifyRfc6962Consistency(cons)).toBe(true);
    }
  });

  test("matches all Collab journal leaf hashes, roots, inclusion proofs, and consistency proofs", () => {
    const { epoch_id, leaves, roots, inclusion, consistency } = vectors.collab_journal;
    const eventHashes = leaves.map((l) => l.event_hash);

    for (const leaf of leaves) {
      const preimage = journalLeafPreimage(leaf.epoch_id, leaf.sequence, leaf.event_hash);
      expect(new TextDecoder().decode(preimage)).toBe(
        `${JOURNAL_MERKLE_LEAF_DOMAIN}\0${leaf.epoch_id}\0${leaf.sequence}\0${leaf.event_hash}`,
      );
      expect(journalLeafHash(leaf.epoch_id, leaf.sequence, leaf.event_hash)).toBe(leaf.leaf_hash);
    }
    for (const r of roots) {
      expect(journalMerkleRoot(epoch_id, eventHashes.slice(0, r.tree_size))).toBe(r.root);
    }
    for (const inc of inclusion) {
      expect(proveJournalInclusion(inc.epoch_id, eventHashes, inc.sequence, inc.tree_size)).toEqual(inc);
      expect(verifyJournalInclusion(inc)).toBe(true);
    }
    for (const cons of consistency) {
      expect(proveJournalConsistency(cons.epoch_id, eventHashes, cons.from_size, cons.to_size)).toEqual(cons);
      expect(verifyJournalConsistency(cons)).toBe(true);
    }
  });

  test("break-checks: tampered hash, swapped leaves, wrong tree_size, wrong epoch, and rewritten history all fail", () => {
    const { epoch_id, leaves } = vectors.collab_journal;
    const eventHashes = leaves.map((l) => l.event_hash);

    const inc = proveJournalInclusion(epoch_id, eventHashes, 4, 7);
    expect(verifyJournalInclusion(inc)).toBe(true);

    // 1. Changed event hash fails inclusion.
    const flippedHash = (inc.event_hash[0] === "0" ? "1" : "0") + inc.event_hash.slice(1);
    expect(verifyJournalInclusion({ ...inc, event_hash: flippedHash })).toBe(false);

    // 2. Swapped leaves (claiming seq 3's hash at seq 4, or seq 4's hash at seq 3) fail inclusion.
    expect(verifyJournalInclusion({ ...inc, event_hash: eventHashes[2]! })).toBe(false);
    expect(verifyJournalInclusion({ ...inc, sequence: 3 })).toBe(false);

    // 3. Wrong tree_size (changing tree shape or paired with that size's root) fails inclusion.
    expect(verifyJournalInclusion({
      ...inc,
      tree_size: 6,
      root: journalMerkleRoot(epoch_id, eventHashes.slice(0, 6)),
    })).toBe(false);
    expect(verifyJournalInclusion({ ...inc, tree_size: 4 })).toBe(false);
    expect(verifyJournalInclusion({ ...inc, tree_size: 9 })).toBe(false);
    const inc6of7 = proveJournalInclusion(epoch_id, eventHashes, 6, 7);
    expect(verifyJournalInclusion(inc6of7)).toBe(true);
    expect(verifyJournalInclusion({ ...inc6of7, tree_size: 6 })).toBe(false);

    // 4. Wrong epoch_id or NUL byte fails inclusion.
    expect(verifyJournalInclusion({ ...inc, epoch_id: "epoch_other" })).toBe(false);
    expect(verifyJournalInclusion({ ...inc, epoch_id: `${epoch_id}\0evil` })).toBe(false);
    expect(() => journalLeafPreimage("bad\0epoch", 1, eventHashes[0]!)).toThrow(/NUL/);

    // 5. Truncated or padded path fails inclusion.
    expect(verifyJournalInclusion({ ...inc, path: inc.path.slice(0, -1) })).toBe(false);
    expect(verifyJournalInclusion({ ...inc, path: [...inc.path, inc.root] })).toBe(false);

    // 6. Rewritten event before m fails consistency.
    const cons = proveJournalConsistency(epoch_id, eventHashes, 4, 9);
    expect(verifyJournalConsistency(cons)).toBe(true);
    const rewrittenHashes = [...eventHashes];
    rewrittenHashes[1] = flippedHash;
    const rewrittenToRoot = journalMerkleRoot(epoch_id, rewrittenHashes);
    expect(verifyJournalConsistency({ ...cons, to_root: rewrittenToRoot })).toBe(false);
    const rewrittenCons = proveJournalConsistency(epoch_id, rewrittenHashes, 4, 9);
    expect(verifyJournalConsistency({ ...rewrittenCons, from_root: cons.from_root })).toBe(false);

    // 7. Consistency edge cases: from_size=0 requires EMPTY_ROOT and empty path.
    expect(verifyJournalConsistency({
      from_size: 0,
      to_size: 5,
      from_root: RFC6962_EMPTY_ROOT,
      to_root: journalMerkleRoot(epoch_id, eventHashes.slice(0, 5)),
      path: [],
    })).toBe(true);
    expect(verifyJournalConsistency({
      from_size: 0,
      to_size: 5,
      from_root: eventHashes[0]!,
      to_root: journalMerkleRoot(epoch_id, eventHashes.slice(0, 5)),
      path: [],
    })).toBe(false);
    expect(verifyJournalConsistency({
      from_size: 0,
      to_size: 0,
      from_root: RFC6962_EMPTY_ROOT,
      to_root: eventHashes[0]!,
      path: [],
    })).toBe(false);

    // 8. Second-preimage resistance: leaf prefix 0x00 vs node prefix 0x01 differ.
    const left = eventHashes[0]!;
    const right = eventHashes[1]!;
    const node = rfc6962NodeHash(left, right);
    const forgedLeaf = rfc6962LeafHash(Buffer.concat([Buffer.from(left, "hex"), Buffer.from(right, "hex")]));
    expect(forgedLeaf).not.toBe(node);
  });
});

describe("store & MCP collab_journal_proof + collab_journal_verify merkle_root", () => {
  test("serves root, inclusion, and consistency proofs over a live journal and verifies end-to-end", async () => {
    const { root, store, server } = makeStore();
    const opened = await callTool(server, "collab_session_start", { root_path: root, actor: "root" });
    expect(opened.isError).toBeUndefined();
    const workspaceId = opened.structuredContent.workspace.id as string;
    const epochId = opened.structuredContent.workspace.epoch_id as string;

    // Empty prefix (tree_size = 0) yields EMPTY_ROOT and GENESIS_HASH.
    const emptyProof = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "root",
      tree_size: 0,
    });
    expect(emptyProof.isError).toBeUndefined();
    expect(emptyProof.structuredContent).toEqual({
      observed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      workspace_id: workspaceId,
      kind: "root",
      epoch_id: epochId,
      tree_size: 0,
      root: RFC6962_EMPTY_ROOT,
      head_hash: GENESIS_HASH,
      head_sequence: 2,
    });

    // Append 4 reports (total 6 events: workspace.opened + session.joined + 4 reports).
    for (let i = 1; i <= 4; i += 1) {
      const posted = await callTool(server, "collab_report_append", {
        workspace_id: workspaceId,
        idempotency_key: `merkle-rep-${i}`,
        kind: "observation",
        body: `observation ${i}`,
        confidence: "high",
        confidence_basis: "direct test",
        limits: "test only",
      });
      expect(posted.isError).toBeUndefined();
    }

    // Snapshot 1 at tree_size = 3, then full head at tree_size = 6.
    const rootAt3 = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "root",
      tree_size: 3,
    });
    const rootAt6 = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "root",
    });
    expect(rootAt3.structuredContent.tree_size).toBe(3);
    expect(rootAt6.structuredContent.tree_size).toBe(6);
    expect(rootAt6.structuredContent.head_sequence).toBe(6);

    // Consistency from 3 to 6 verifies cleanly.
    const cons3to6 = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "consistency",
      from_size: 3,
    });
    expect(cons3to6.isError).toBeUndefined();
    expect(cons3to6.structuredContent.from_root).toBe(rootAt3.structuredContent.root);
    expect(cons3to6.structuredContent.to_root).toBe(rootAt6.structuredContent.root);
    expect(cons3to6.structuredContent.root).toBe(rootAt6.structuredContent.root);
    expect(verifyJournalConsistency(cons3to6.structuredContent)).toBe(true);

    // Inclusion proof for sequence 4 verified against the fetched event's own hash.
    const page = store.eventsSince(workspaceId, 0, 10);
    const event4 = page.events[3]!;
    expect(event4.sequence).toBe(4);
    const inc4 = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "inclusion",
      sequence: 4,
    });
    expect(inc4.isError).toBeUndefined();
    expect(inc4.structuredContent.event_hash).toBe(event4.hash);
    expect(inc4.structuredContent.root).toBe(rootAt6.structuredContent.root);
    expect(verifyJournalInclusion({
      epoch_id: epochId,
      sequence: 4,
      event_hash: event4.hash,
      tree_size: 6,
      root: rootAt6.structuredContent.root,
      path: inc4.structuredContent.path,
    })).toBe(true);

    // collab_journal_verify returns merkle_root + optional expected_root / expected_tree_size checks.
    const verifyOk = await callTool(server, "collab_journal_verify", {
      workspace_id: workspaceId,
      expected_root: rootAt6.structuredContent.root,
      expected_tree_size: 6,
    });
    expect(verifyOk.isError).toBeUndefined();
    expect(verifyOk.structuredContent).toEqual({
      observed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      workspace_id: workspaceId,
      chain_valid: true,
      verification_scope: "full_journal",
      epoch_id: epochId,
      tree_size: 6,
      merkle_root: rootAt6.structuredContent.root,
      expected_root: rootAt6.structuredContent.root,
      root_matches: true,
      expected_tree_size: 6,
      tree_size_matches: true,
    });

    const verifyMismatch = await callTool(server, "collab_journal_verify", {
      workspace_id: workspaceId,
      expected_root: rootAt3.structuredContent.root,
      expected_tree_size: 3,
    });
    expect(verifyMismatch.structuredContent.chain_valid).toBe(true);
    expect(verifyMismatch.structuredContent.root_matches).toBe(false);
    expect(verifyMismatch.structuredContent.tree_size_matches).toBe(false);

    // Refuses invalid proof argument combinations cleanly.
    const badSeq = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "inclusion",
      sequence: 7,
    });
    expect(badSeq.isError).toBe(true);
    expect(badSeq.structuredContent.error).toBe("sequence_out_of_range");

    const badMix = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "root",
      sequence: 1,
    });
    expect(badMix.isError).toBe(true);
    expect(badMix.structuredContent.error).toBe("invalid_proof_request");

    // Tampered payload fails collab_journal_verify with merkle_root: null and root_matches: false.
    store.db.query(`UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = 2`)
      .run('{"tampered":true}', workspaceId);
    const verifyTampered = await callTool(server, "collab_journal_verify", {
      workspace_id: workspaceId,
      expected_root: rootAt6.structuredContent.root,
    });
    expect(verifyTampered.structuredContent.chain_valid).toBe(false);
    expect(verifyTampered.structuredContent.merkle_root).toBeNull();
    expect(verifyTampered.structuredContent.root_matches).toBe(false);

    // Epoch corruption in events table makes collab_journal_proof fail closed.
    store.db.query(`UPDATE events SET epoch_id = 'epoch_corrupt' WHERE workspace_id = ? AND sequence = 2`)
      .run(workspaceId);
    const corruptProof = await callTool(server, "collab_journal_proof", {
      workspace_id: workspaceId,
      kind: "root",
    });
    expect(corruptProof.isError).toBe(true);
    expect(corruptProof.structuredContent.error).toBe("database_journal_invalid");
  });
});
