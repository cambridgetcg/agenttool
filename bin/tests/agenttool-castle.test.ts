import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildCastlePlan,
  castleStatus,
  CASTLE_ATTEMPT_SCHEMA,
  CASTLE_BRIDGE_VERSION,
  CASTLE_COLLECTION_ID,
  CASTLE_COLLECTION_SCHEMA,
  CASTLE_OWNER_SCHEMA,
  CASTLE_ROOT_SCHEMA,
  CASTLE_SELECTION_SCHEMA,
  searchCastle,
  showCastle,
  syncCastle,
  withdrawCastle,
  type CastleSelectionEntry,
} from "../agenttool-castle.ts";
import { DataNode, sha256Hex } from "../../packages/data/src/index.ts";

type Fixture = {
  parent: string;
  castle: string;
  selection: string;
  data: string;
  halt: string;
};

const scratch: string[] = [];
let commitSecond = 0;

afterEach(async () => {
  for (const path of scratch.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

function git(root: string, args: readonly string[]): string {
  const second = String(commitSecond++ % 60).padStart(2, "0");
  const result = spawnSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `2026-07-23T12:00:${second}Z`,
        GIT_COMMITTER_DATE: `2026-07-23T12:00:${second}Z`,
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeTree(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  for (const [path, value] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, value);
  }
}

async function createFixture(
  files: Readonly<Record<string, string | Uint8Array>> = {
    "rooms/harbor.md": "# Harbor\n\nA quiet anchor links to [Joy](../words/joy.md).\n",
    "words/joy.md": "# Joy\n\nSunflower abundance grows through understanding.\n",
  },
): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), "agenttool-castle-test-"));
  scratch.push(parent);
  const castle = join(parent, "castle");
  await mkdir(castle, { mode: 0o700 });
  git(castle, ["init", "-q"]);
  git(castle, ["config", "user.name", "Castle Test"]);
  git(castle, ["config", "user.email", "castle-test@example.invalid"]);
  await writeTree(castle, files);
  git(castle, ["add", "-A"]);
  git(castle, ["commit", "-q", "-m", "initial castle"]);
  return {
    parent,
    castle,
    selection: join(parent, "selection.json"),
    data: join(parent, "agent-data"),
    halt: join(parent, "HALT"),
  };
}

function revision(fixture: Fixture): string {
  return git(fixture.castle, ["rev-parse", "HEAD"]);
}

async function commit(
  fixture: Fixture,
  message: string,
): Promise<string> {
  git(fixture.castle, ["add", "-A"]);
  git(fixture.castle, ["commit", "-q", "-m", message]);
  return revision(fixture);
}

async function writeSelection(
  fixture: Fixture,
  selectedRevision: string,
  paths: readonly CastleSelectionEntry[],
  retirePaths: readonly string[] = [],
): Promise<void> {
  await writeFile(
    fixture.selection,
    `${JSON.stringify({
      schema: CASTLE_SELECTION_SCHEMA,
      revision: selectedRevision,
      audience: "local-private",
      purpose: "Test a bounded local projection",
      retention: "Withdraw when this fixture ends",
      paths,
      retire_paths: retirePaths,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

const ROOM: CastleSelectionEntry = Object.freeze({
  path: "rooms/harbor.md",
  logical_id: "castle:room:harbor",
  kind: "room",
});

const WORD: CastleSelectionEntry = Object.freeze({
  path: "words/joy.md",
  logical_id: "castle:word:joy",
  kind: "word",
});

function syncOptions(fixture: Fixture) {
  return {
    castle_root: fixture.castle,
    data_root: fixture.data,
    selection_path: fixture.selection,
    halt_paths: [fixture.halt],
  } as const;
}

async function readState(fixture: Fixture): Promise<any> {
  return JSON.parse(await readFile(join(fixture.data, "castle-state.json"), "utf8"));
}

async function openFixtureNode(fixture: Fixture): Promise<DataNode> {
  return DataNode.open({ root: fixture.data });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("Castle committed-snapshot plan", () => {
  test("pins exact Git blobs and ignores dirty and untracked working-tree bytes", async () => {
    const fixture = await createFixture();
    const selectedRevision = revision(fixture);
    await writeSelection(fixture, selectedRevision, [ROOM, WORD]);

    await writeFile(
      join(fixture.castle, ROOM.path),
      "# Dirty working tree\n\nThis must never cross.\n",
    );
    await writeFile(join(fixture.castle, "rooms/untracked.md"), "# Untracked\n");

    const plan = await buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    });
    expect(plan.revision).toBe(selectedRevision);
    expect(plan.documents.map((document) => document.path)).toEqual([
      ROOM.path,
      WORD.path,
    ]);
    expect(plan.documents[0]!.text).toContain("# Harbor");
    expect(plan.documents[0]!.text).not.toContain("Dirty working tree");
    expect(plan.documents[0]!.links).toEqual([WORD.path]);
    expect(plan.documents[0]!.sha256).toBe(
      sha256Hex(plan.documents[0]!.text),
    );
  });

  test("rejects unsafe declarations, non-UTF-8 blobs, Git symlinks, and partial clones", async () => {
    const fixture = await createFixture();
    const firstRevision = revision(fixture);
    await writeSelection(fixture, firstRevision, [ROOM]);

    const insideSelection = join(fixture.castle, "selection.json");
    await writeFile(insideSelection, await readFile(fixture.selection));
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: insideSelection,
    }), "selection_must_live_outside_castle");

    const linkedSelection = join(fixture.parent, "selection-link.json");
    await symlink(fixture.selection, linkedSelection);
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: linkedSelection,
    }), "selection_not_regular");

    await writeFile(join(fixture.castle, "words/binary.md"), new Uint8Array([0xff]));
    const binaryRevision = await commit(fixture, "add invalid utf8");
    await writeSelection(fixture, binaryRevision, [{
      path: "words/binary.md",
      logical_id: "castle:word:binary",
      kind: "word",
    }]);
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    }), "selected_document_not_utf8");

    await symlink("../words/joy.md", join(fixture.castle, "rooms/link.md"));
    const linkRevision = await commit(fixture, "add git symlink");
    await writeSelection(fixture, linkRevision, [{
      path: "rooms/link.md",
      logical_id: "castle:room:link",
      kind: "room",
    }]);
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    }), "selected_document_not_plain_git_blob");

    await writeFile(
      join(fixture.castle, "words/secret.md"),
      "# Secret\n\n-----BEGIN PRIVATE KEY-----\n",
    );
    const secretRevision = await commit(fixture, "add secret canary");
    await writeSelection(fixture, secretRevision, [{
      path: "words/secret.md",
      logical_id: "castle:word:secret",
      kind: "word",
    }]);
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    }), "selected_document_contains_sensitive_marker");

    git(fixture.castle, ["config", "extensions.partialClone", "origin"]);
    await expectCode(buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    }), "partial_clone_not_allowed");
  });
});

describe("Castle local projection", () => {
  test("syncs, searches, shows, and repeats idempotently without absolute source paths", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM, WORD]);

    const synced = await syncCastle(syncOptions(fixture));
    expect(synced).toMatchObject({
      status: "synced",
      active_records: 2,
      inserted_records: 3,
      network: "not used",
    });

    const state = await readState(fixture);
    expect(state.status).toBe("active");
    expect(state.root_lineage_record_id).toBe(state.root_record_id);
    expect(JSON.stringify(state)).not.toContain(fixture.castle);
    expect(JSON.stringify(state)).not.toContain(fixture.selection);
    expect((await lstat(fixture.data)).mode & 0o077).toBe(0);
    expect((await lstat(join(fixture.data, "castle-state.json"))).mode & 0o077).toBe(0);

    const search = await searchCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      text: "sunflower",
    });
    expect(search.hits).toHaveLength(1);
    expect((search.hits as any[])[0]).toMatchObject({
      path: WORD.path,
      logical_id: WORD.logical_id,
    });
    expect(search.truth_boundary).toContain("does not prove truth");
    expect(await showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    })).toContain("A quiet anchor");

    const node = await openFixtureNode(fixture);
    try {
      for (const id of [
        ...Object.values(state.active).map((record: any) => record.record_id),
        state.root_record_id,
      ]) {
        const record = node.getRecord(id)!;
        expect(JSON.stringify(record)).not.toContain(fixture.castle);
        expect(JSON.stringify(record)).not.toContain(fixture.selection);
      }
      const root = node.getRecord(state.root_record_id)!;
      const rootText = new TextDecoder().decode(await node.readContent(root));
      expect(rootText).toContain(CASTLE_ROOT_SCHEMA);
      expect(rootText).not.toContain(fixture.castle);
    } finally {
      node.close();
    }

    expect(await syncCastle(syncOptions(fixture))).toMatchObject({
      status: "unchanged",
      active_records: 2,
    });
  });

  test("records same-path corrections and requires explicit retirement", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM, WORD]);
    await syncCastle(syncOptions(fixture));
    const first = await readState(fixture);

    await writeFile(
      join(fixture.castle, ROOM.path),
      "# Harbor\n\nA corrected harbor grows a moonlit bridge.\n",
    );
    const correctedRevision = await commit(fixture, "correct harbor");
    await writeSelection(fixture, correctedRevision, [ROOM, WORD]);
    const corrected = await syncCastle(syncOptions(fixture));
    expect(corrected).toMatchObject({
      status: "synced",
      active_records: 2,
      retired_or_superseded: 2,
    });
    const second = await readState(fixture);
    expect(second.active[ROOM.path].record_id).not.toBe(
      first.active[ROOM.path].record_id,
    );
    expect(second.active[WORD.path].record_id).toBe(first.active[WORD.path].record_id);

    let node = await openFixtureNode(fixture);
    try {
      expect(node.getTombstone(first.active[ROOM.path].record_id)).not.toBeNull();
      expect(node.getRecord(second.active[ROOM.path].record_id)!.supersedes_id).toBe(
        first.active[ROOM.path].record_id,
      );
    } finally {
      node.close();
    }

    await writeSelection(fixture, correctedRevision, [ROOM]);
    await expectCode(
      syncCastle(syncOptions(fixture)),
      "selection_omitted_active_path_without_retirement",
    );
    expect((await readState(fixture)).active[WORD.path].record_id).toBe(
      first.active[WORD.path].record_id,
    );

    await writeSelection(fixture, correctedRevision, [ROOM], [WORD.path]);
    await syncCastle(syncOptions(fixture));
    const retired = await readState(fixture);
    expect(Object.keys(retired.active)).toEqual([ROOM.path]);
    node = await openFixtureNode(fixture);
    try {
      expect(node.getTombstone(first.active[WORD.path].record_id)).not.toBeNull();
    } finally {
      node.close();
    }
    const oldWord = await searchCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      text: "sunflower",
    });
    expect(oldWord.hits).toEqual([]);
  });

  test("blocks before writes on regular or dangling HALT and rejects unsafe data roots", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);

    await writeFile(fixture.halt, "rest\n");
    await expectCode(syncCastle(syncOptions(fixture)), "castle_bridge_halted");
    await expect(lstat(fixture.data)).rejects.toMatchObject({ code: "ENOENT" });
    const status = await castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    });
    expect(status).toMatchObject({
      state: "empty",
      data_root: "absent",
    });

    await unlink(fixture.halt);
    await symlink(join(fixture.parent, "missing-halt-target"), fixture.halt);
    await expectCode(syncCastle(syncOptions(fixture)), "castle_bridge_halted");
    await expect(lstat(fixture.data)).rejects.toMatchObject({ code: "ENOENT" });
    await unlink(fixture.halt);

    const shared = join(fixture.parent, "shared");
    await mkdir(shared, { mode: 0o700 });
    await writeFile(join(shared, "other.txt"), "not this bridge\n");
    await expectCode(syncCastle({
      ...syncOptions(fixture),
      data_root: shared,
    }), "data_root_contains_unowned_entry");

    const broad = join(fixture.parent, "broad");
    await mkdir(broad, { mode: 0o755 });
    await chmod(broad, 0o755);
    await expectCode(syncCastle({
      ...syncOptions(fixture),
      data_root: broad,
    }), "data_root_permissions_not_private");

    const linked = join(fixture.parent, "linked-data");
    await symlink(shared, linked);
    await expectCode(syncCastle({
      ...syncOptions(fixture),
      data_root: linked,
    }), "data_root_not_directory");

    const inside = join(fixture.castle, "private-data");
    await expectCode(syncCastle({
      ...syncOptions(fixture),
      data_root: inside,
    }), "data_root_must_live_outside_castle");
    await expect(lstat(inside)).rejects.toMatchObject({ code: "ENOENT" });

    const intoCastle = join(fixture.parent, "into-castle");
    await symlink(fixture.castle, intoCastle);
    const hiddenInside = join(intoCastle, "hidden-data");
    await expectCode(syncCastle({
      ...syncOptions(fixture),
      data_root: hiddenInside,
    }), "data_root_must_live_outside_castle");
    await expect(lstat(join(fixture.castle, "hidden-data"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("withdraws through HALT, keeps physical bytes, and requires explicit resume", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM, WORD]);
    await syncCastle(syncOptions(fixture));
    const before = await readState(fixture);
    const firstRoom = before.active[ROOM.path].record_id;

    await writeFile(fixture.halt, "rest\n");
    const withdrawn = await withdrawCastle({
      data_root: fixture.data,
      reason: "Fixture is complete",
    });
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      physical_erasure: false,
    });
    const stopped = await castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    });
    expect(stopped.state).toBe("withdrawn");

    let node = await openFixtureNode(fixture);
    try {
      for (const id of before.known_record_ids) {
        expect(node.getTombstone(id)).not.toBeNull();
      }
      expect(new TextDecoder().decode(await node.readContent(firstRoom))).toContain(
        "A quiet anchor",
      );
    } finally {
      node.close();
    }

    await unlink(fixture.halt);
    await expectCode(
      syncCastle(syncOptions(fixture)),
      "withdrawn_projection_requires_explicit_resume",
    );
    const resumed = await syncCastle({
      ...syncOptions(fixture),
      resume: true,
    });
    expect(resumed).toMatchObject({ status: "synced", active_records: 2 });
    const after = await readState(fixture);
    expect(after.status).toBe("active");
    expect(after.active[ROOM.path].record_id).not.toBe(firstRoom);
    node = await openFixtureNode(fixture);
    try {
      expect(node.getRecord(after.active[ROOM.path].record_id)!.supersedes_id).toBe(
        firstRoom,
      );
    } finally {
      node.close();
    }
  });

  test("recovers dead-process locks and control temporaries but refuses ambiguous or live locks", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));

    const deadLock = join(fixture.data, "castle-sync.lock");
    await mkdir(deadLock, { mode: 0o700 });
    await writeFile(
      join(deadLock, "owner-999999.json"),
      "{\"pid\":999999,\"started_at\":\"2026-07-23T12:00:00.000Z\"}\n",
      { mode: 0o600 },
    );
    expect(await syncCastle(syncOptions(fixture))).toMatchObject({
      status: "unchanged",
    });
    await expect(lstat(deadLock)).rejects.toMatchObject({ code: "ENOENT" });

    const deadTemporary = join(
      fixture.data,
      "castle-state.json.tmp-999999-00000000-0000-4000-8000-000000000000",
    );
    await writeFile(deadTemporary, "interrupted\n", { mode: 0o600 });
    expect(await syncCastle(syncOptions(fixture))).toMatchObject({
      status: "unchanged",
    });
    await expect(lstat(deadTemporary)).rejects.toMatchObject({ code: "ENOENT" });

    await mkdir(deadLock, { mode: 0o700 });
    const old = new Date(Date.now() - 120_000);
    await utimes(deadLock, old, old);
    await expectCode(syncCastle(syncOptions(fixture)), "castle_bridge_lock_busy");
    expect((await lstat(deadLock)).isDirectory()).toBe(true);
    await rm(deadLock, { recursive: true });

    await mkdir(deadLock, { mode: 0o700 });
    await writeFile(
      join(deadLock, `owner-${process.pid}.json`),
      `${JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );
    await expectCode(syncCastle(syncOptions(fixture)), "castle_bridge_lock_busy");
  });

  test("withdraws first-sync crash orphans and can resume their lineage", async () => {
    const fixture = await createFixture({
      "rooms/harbor.md": "# Harbor\n\nCrash-safe understanding.\n",
    });
    const selectedRevision = revision(fixture);
    await writeSelection(fixture, selectedRevision, [ROOM]);
    await mkdir(fixture.data, { mode: 0o700 });
    const sourceRoot = await realpath(fixture.castle);
    await writeFile(join(fixture.data, "castle-owner.json"), `${JSON.stringify({
      schema: CASTLE_OWNER_SCHEMA,
      collection_id: CASTLE_COLLECTION_ID,
      source_root_sha256: sha256Hex(sourceRoot),
      created_at: "2026-07-23T12:00:00.000Z",
    })}\n`, { mode: 0o600 });
    await writeFile(join(fixture.data, "castle-attempt.json"), `${JSON.stringify({
      schema: CASTLE_ATTEMPT_SCHEMA,
      revision: selectedRevision,
      selection_sha256: "a".repeat(64),
      started_at: "2026-07-23T12:01:00.000Z",
    })}\n`, { mode: 0o600 });

    const text = await readFile(join(fixture.castle, ROOM.path), "utf8");
    const digest = sha256Hex(text);
    const node = await DataNode.open({
      root: fixture.data,
      collections: [{
        id: CASTLE_COLLECTION_ID,
        name: "Castle of Understanding",
        description:
          "Operator-selected committed Castle Markdown and its canonical local root manifest",
        schema: { version: CASTLE_COLLECTION_SCHEMA },
        policy: {
          visibility: "private",
          max_record_bytes: 4 * 1024 * 1024,
          allowed_media_types: ["text/markdown", "application/json"],
        },
      }],
    });
    const orphan = await node.collect({
      collection_id: CASTLE_COLLECTION_ID,
      collector_id: "text",
      input: {
        text,
        media_type: "text/markdown",
        source_uri: `castle:///${ROOM.path}`,
        external_id: ROOM.path,
        key: ROOM.logical_id,
        version: `${selectedRevision}:sha256:${digest}`,
        metadata: {
          profile: "castle-document/v1",
          logical_id: ROOM.logical_id,
          document_kind: ROOM.kind,
          source_path: ROOM.path,
          source_revision: selectedRevision,
          source_sha256: digest,
          title: "Harbor",
        },
      },
    });
    const orphanId = orphan.records[0]!.id;
    node.close();

    expect(await withdrawCastle({
      data_root: fixture.data,
      reason: "Stop an interrupted first sync",
    })).toMatchObject({
      status: "withdrawn",
      new_logical_tombstones: 1,
    });
    let state = await readState(fixture);
    expect(state.status).toBe("withdrawn");
    expect(state.lineage[ROOM.path].record_id).toBe(orphanId);

    await syncCastle({ ...syncOptions(fixture), resume: true });
    state = await readState(fixture);
    expect(state.active[ROOM.path].record_id).not.toBe(orphanId);
    const reopened = await openFixtureNode(fixture);
    try {
      expect(reopened.getTombstone(orphanId)).not.toBeNull();
      expect(reopened.getRecord(state.active[ROOM.path].record_id)!.supersedes_id).toBe(
        orphanId,
      );
    } finally {
      reopened.close();
    }
  });

  test("recovers an interrupted intermediate revision without adopting its first envelope", async () => {
    const fixture = await createFixture({
      "rooms/harbor.md": "# Harbor\n\nVersion A.\n",
    });
    const revisionA = revision(fixture);
    await writeSelection(fixture, revisionA, [ROOM]);
    await syncCastle(syncOptions(fixture));
    const stateA = await readState(fixture);

    await writeFile(join(fixture.castle, ROOM.path), "# Harbor\n\nVersion B and C.\n");
    const revisionB = await commit(fixture, "version b");
    const text = await readFile(join(fixture.castle, ROOM.path), "utf8");
    const digest = sha256Hex(text);
    let node = await openFixtureNode(fixture);
    const orphan = await node.collect({
      collection_id: CASTLE_COLLECTION_ID,
      collector_id: "text",
      input: {
        text,
        media_type: "text/markdown",
        source_uri: `castle:///${ROOM.path}`,
        external_id: ROOM.path,
        key: ROOM.logical_id,
        version: `${revisionB}:sha256:${digest}`,
        supersedes_id: stateA.active[ROOM.path].record_id,
        metadata: {
          profile: "castle-document/v1",
          logical_id: ROOM.logical_id,
          document_kind: ROOM.kind,
          source_path: ROOM.path,
          source_revision: revisionB,
          source_sha256: digest,
          title: "Harbor",
        },
      },
    });
    const orphanId = orphan.records[0]!.id;
    node.close();
    await writeFile(join(fixture.data, "castle-attempt.json"), `${JSON.stringify({
      schema: CASTLE_ATTEMPT_SCHEMA,
      revision: revisionB,
      selection_sha256: "b".repeat(64),
      started_at: "2026-07-23T12:02:00.000Z",
    })}\n`, { mode: 0o600 });

    await writeFile(join(fixture.castle, "rooms/other.md"), "# Other\n");
    const revisionC = await commit(fixture, "version c same selected bytes");
    await writeSelection(fixture, revisionC, [ROOM]);
    await syncCastle(syncOptions(fixture));
    const stateC = await readState(fixture);
    expect(stateC.current_revision).toBe(revisionC);
    expect(stateC.active[ROOM.path].source_revision).toBe(revisionC);
    expect(stateC.active[ROOM.path].record_id).not.toBe(orphanId);
    node = await openFixtureNode(fixture);
    try {
      expect(node.getTombstone(orphanId)).not.toBeNull();
      expect(node.getRecord(stateC.active[ROOM.path].record_id)!.version).toContain(
        revisionC,
      );
    } finally {
      node.close();
    }
  });
});

describe("Castle CLI boundaries", () => {
  test("rejects duplicate and irrelevant options", () => {
    const script = resolve(import.meta.dir, "..", "agenttool-castle.ts");
    const duplicate = spawnSync(process.execPath, [
      script,
      "status",
      "--data-root",
      "/tmp/one",
      "--data-root",
      "/tmp/two",
    ], { encoding: "utf8" });
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("duplicate_argument");

    const irrelevant = spawnSync(process.execPath, [
      script,
      "status",
      "--limit",
      "2",
    ], { encoding: "utf8" });
    expect(irrelevant.status).toBe(1);
    expect(irrelevant.stderr).toContain("argument_not_allowed_for_command");

    const version = spawnSync(process.execPath, [script, "--version"], {
      encoding: "utf8",
    });
    expect(version.stdout.trim()).toBe(CASTLE_BRIDGE_VERSION);
  });
});
