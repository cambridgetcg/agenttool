import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  CASTLE_DOCUMENT_PROFILE,
  CASTLE_FORMAT_SCHEMA,
  CASTLE_OWNER_SCHEMA,
  CASTLE_PENDING_SCHEMA,
  CASTLE_ROOT_SCHEMA,
  CASTLE_SELECTION_SCHEMA,
  CASTLE_STATE_SCHEMA,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  MAX_ROOT_BYTES,
  MAX_TOTAL_BYTES,
  searchCastle,
  showCastle,
  syncCastle,
  withdrawCastle,
  type CastleSelectionEntry,
} from "../agenttool-castle.ts";
import {
  canonicalJson,
  DataNode,
  sha256Hex,
  type JsonObject,
} from "../../packages/data/src/index.ts";

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

async function snapshotTree(
  root: string,
  prefix = "",
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshotTree(root, relativePath));
    } else if (entry.isFile()) {
      result[relativePath] = sha256Hex(await readFile(join(root, relativePath)));
    } else {
      result[relativePath] = `special:${entry.isSymbolicLink() ? "symlink" : "other"}`;
    }
  }
  return Object.freeze(result);
}

async function materializeExactV01Bridge(fixture: Fixture): Promise<string> {
  const repository = resolve(import.meta.dir, "../..");
  const destination = join(fixture.parent, "exact-agenttool-v0.1");
  await mkdir(destination, { mode: 0o700 });
  const commit = "8525b77ac9f51b13e0e5fdd44606456bc76a3903";
  const archived = spawnSync("git", [
    "--no-replace-objects",
    "-C",
    repository,
    "archive",
    "--format=tar",
    commit,
    "--",
    "bin/agenttool-castle.ts",
    "packages/data",
  ], {
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (archived.status !== 0 || !archived.stdout) {
    throw new Error(`could not archive exact v0.1 bridge: ${archived.stderr}`);
  }
  const extracted = spawnSync("tar", ["-xf", "-", "-C", destination], {
    input: archived.stdout,
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    throw new Error(`could not extract exact v0.1 bridge: ${extracted.stderr}`);
  }
  const script = join(destination, "bin", "agenttool-castle.ts");
  const version = spawnSync(process.execPath, [script, "--version"], {
    encoding: "utf8",
  });
  expect(version.status).toBe(0);
  expect(version.stdout.trim()).toBe("0.1.0");
  return script;
}

function stateEntryFromRecord(record: any): any {
  return {
    logical_id: record.metadata.logical_id,
    kind: record.metadata.document_kind,
    record_id: record.id,
    sha256: record.content.sha256,
    bytes: record.content.size,
    title: record.metadata.title,
    source_revision: record.metadata.source_revision,
  };
}

async function collectDocumentVariant(
  node: DataNode,
  original: any,
  options: {
    profile: "castle-document/v1" | typeof CASTLE_DOCUMENT_PROFILE;
    title: string;
    supersedes_id?: string;
  },
): Promise<any> {
  const text = new TextDecoder().decode(await node.readContent(original));
  const observedAt = new Date(Date.now() + 1_000).toISOString();
  const version = options.profile === CASTLE_DOCUMENT_PROFILE
    ? original.version
    : `${original.metadata.source_revision}:sha256:${original.content.sha256}`;
  return (await node.collect({
    collection_id: CASTLE_COLLECTION_ID,
    collector_id: "text",
    input: {
      text,
      media_type: "text/markdown",
      source_uri: original.source.uri,
      external_id: original.source.external_id,
      key: original.key,
      version,
      ...(options.supersedes_id
        ? { supersedes_id: options.supersedes_id }
        : {}),
      observed_at: observedAt,
      metadata: {
        ...original.metadata,
        profile: options.profile,
        title: options.title,
      },
      provenance: [{
        activity: "projected_from_committed_git_blob",
        at: observedAt,
        actor: "local:agenttool-castle",
        input_ids: [],
      }],
    } as JsonObject,
  })).records[0]!;
}

async function collectReplacementRoot(
  node: DataNode,
  state: any,
  active: Readonly<Record<string, any>>,
  mutate?: (manifest: any) => void,
): Promise<any> {
  const original = node.getRecord(state.root_record_id, true)!;
  const manifest = JSON.parse(
    new TextDecoder().decode(await node.readContent(original)),
  );
  manifest.active = Object.keys(active).sort().map((path) => ({
    path,
    ...active[path],
  }));
  mutate?.(manifest);
  const text = `${canonicalJson(manifest)}\n`;
  const digest = sha256Hex(text);
  const observedAt = new Date(Date.now() + 2_000).toISOString();
  return (await node.collect({
    collection_id: CASTLE_COLLECTION_ID,
    collector_id: "text",
    input: {
      text,
      media_type: "application/json",
      source_uri: "castle:///manifest",
      external_id: "castle-root",
      key: "castle:root:manifest",
      version: `${state.current_revision}:sha256:${digest}`,
      supersedes_id: state.root_record_id,
      observed_at: observedAt,
      metadata: {
        profile: CASTLE_ROOT_SCHEMA,
        source_revision: state.current_revision,
        source_committed_at: manifest.source_committed_at,
        selection_sha256: state.selection_sha256,
        active_records: manifest.active.length,
        local_private_projection: true,
      },
      provenance: [{
        activity: "bound_local_projection",
        at: observedAt,
        actor: "local:agenttool-castle",
        input_ids: manifest.active.map((entry: any) => entry.record_id),
      }],
    } as JsonObject,
  })).records[0]!;
}

function replacementState(
  state: any,
  active: Readonly<Record<string, any>>,
  root: any,
  additionalKnownIds: readonly string[],
): any {
  return {
    ...state,
    root_record_id: root.id,
    root_lineage_record_id: root.id,
    active,
    lineage: {
      ...state.lineage,
      ...active,
    },
    known_record_ids: [
      ...new Set([...state.known_record_ids, ...additionalKnownIds, root.id]),
    ].sort(),
  };
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

  test("keeps truncated headings valid for durable state", async () => {
    const fixture = await createFixture({
      "words/long-title.md": `# ${"a".repeat(199)} tail\n\nA bounded title.\n`,
    });
    const selectedRevision = revision(fixture);
    const selected = {
      path: "words/long-title.md",
      logical_id: "castle:word:long-title",
      kind: "word",
    } as const;
    await writeSelection(fixture, selectedRevision, [selected]);

    const plan = await buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    });
    expect(plan.documents[0]!.title.length).toBe(199);
    expect(plan.documents[0]!.title.trim()).toBe(plan.documents[0]!.title);

    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "synced",
      active_records: 1,
    });
  });

  test("bounds Unicode and fallback titles by durable code-unit limits", async () => {
    const fallbackStem = "b".repeat(205);
    const fallbackPath = `words/${fallbackStem}.md`;
    const fixture = await createFixture({
      "words/unicode-title.md": `# ${"🌻".repeat(101)} tail\n\nA Unicode title.\n`,
      [fallbackPath]: "#   \n\nA blank heading uses the filename.\n",
      "words/cross-line.md": "#\nBorrowed body text is not a heading.\n",
    });
    const selectedRevision = revision(fixture);
    await writeSelection(fixture, selectedRevision, [
      {
        path: "words/unicode-title.md",
        logical_id: "castle:word:unicode-title",
        kind: "word",
      },
      {
        path: fallbackPath,
        logical_id: "castle:word:bounded-fallback",
        kind: "word",
      },
      {
        path: "words/cross-line.md",
        logical_id: "castle:word:cross-line",
        kind: "word",
      },
    ]);

    const plan = await buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    });
    const unicode = plan.documents.find(
      (document) => document.path === "words/unicode-title.md",
    );
    const fallback = plan.documents.find(
      (document) => document.path === fallbackPath,
    );
    const crossLine = plan.documents.find(
      (document) => document.path === "words/cross-line.md",
    );
    expect(unicode?.title).toBe("🌻".repeat(100));
    expect(unicode?.title.length).toBe(200);
    expect(fallback?.title).toBe("b".repeat(200));
    expect(fallback?.title.length).toBe(200);
    expect(crossLine?.title).toBe("cross line");

    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "synced",
      active_records: 3,
    });
    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "unchanged",
      active_records: 3,
    });
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

    await writeFile(
      join(fixture.castle, "words/c1-control.md"),
      "# C1 control\n\nunsafe\u009b31mterminal text\n",
    );
    await writeFile(
      join(fixture.castle, "words/bare-cr.md"),
      "# Bare CR\n\nunsafe\rterminal text\n",
    );
    const controlRevision = await commit(fixture, "add terminal control canaries");
    for (const path of ["words/c1-control.md", "words/bare-cr.md"]) {
      await writeSelection(fixture, controlRevision, [{
        path,
        logical_id: `castle:word:${path.slice("words/".length, -".md".length)}`,
        kind: "word",
      }]);
      await expectCode(buildCastlePlan({
        castle_root: fixture.castle,
        selection_path: fixture.selection,
      }), "selected_document_contains_control_character");
    }

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
    expect(JSON.parse(
      await readFile(join(fixture.data, "castle-owner.json"), "utf8"),
    ).schema).toBe(CASTLE_OWNER_SCHEMA);
    expect(JSON.parse(
      await readFile(join(fixture.data, "castle-format.json"), "utf8"),
    )).toMatchObject({
      schema: CASTLE_FORMAT_SCHEMA,
      collection_id: CASTLE_COLLECTION_ID,
      source_root_sha256: state.source_root_sha256,
    });

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

  test("fences the exact merged v0.1 binary before downgrade writes", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM, WORD]);
    await syncCastle(syncOptions(fixture));
    const exactV01 = await materializeExactV01Bridge(fixture);

    await writeFile(
      join(fixture.castle, ROOM.path),
      "# Harbor\n\nA changed harbor that v0.1 must not project.\n",
    );
    const changedRevision = await commit(fixture, "change one downgrade document");
    await writeSelection(fixture, changedRevision, [ROOM, WORD]);

    const ownerPath = join(fixture.data, "castle-owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    owner.schema = "castle-agenttool-owner/v1";
    await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
      mode: 0o600,
    });
    expect(JSON.parse(
      await readFile(join(fixture.data, "castle-format.json"), "utf8"),
    ).schema).toBe(CASTLE_FORMAT_SCHEMA);
    const before = await snapshotTree(fixture.data);

    const downgraded = spawnSync(process.execPath, [
      exactV01,
      "sync",
      "--castle-root",
      fixture.castle,
      "--data-root",
      fixture.data,
      "--selection",
      fixture.selection,
      "--json",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fixture.parent,
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 30_000,
    });
    expect(downgraded.error).toBeUndefined();
    expect(downgraded.status).toBe(1);
    expect(downgraded.stderr).toContain("data_root_contains_unowned_entry");
    expect(await snapshotTree(fixture.data)).toEqual(before);

    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "synced",
      active_records: 2,
    });
    expect(JSON.parse(await readFile(ownerPath, "utf8")).schema).toBe(
      CASTLE_OWNER_SCHEMA,
    );
  });

  test("migrates a v1 pending title wedge beyond its immutable first envelope", async () => {
    const path = "words/legacy-title.md";
    const logicalId = "castle:word:legacy-title";
    const legacyTitle = `${"a".repeat(199)} `;
    const fixture = await createFixture({
      [path]: `# ${legacyTitle}tail\n\nA legacy boundary title.\n`,
    });
    const selectedRevision = revision(fixture);
    await writeSelection(fixture, selectedRevision, [{
      path,
      logical_id: logicalId,
      kind: "word",
    }]);
    const plan = await buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    });
    const document = plan.documents[0]!;
    expect(document.title).toBe("a".repeat(199));
    expect(legacyTitle.trim()).not.toBe(legacyTitle);

    await mkdir(fixture.data, { mode: 0o700 });
    const sourceRoot = await realpath(fixture.castle);
    await writeFile(join(fixture.data, "castle-owner.json"), `${JSON.stringify({
      schema: "castle-agenttool-owner/v1",
      collection_id: CASTLE_COLLECTION_ID,
      source_root_sha256: sha256Hex(sourceRoot),
      created_at: "2026-07-23T12:00:00.000Z",
    })}\n`, { mode: 0o600 });
    await writeFile(join(fixture.data, "castle-attempt.json"), `${JSON.stringify({
      schema: CASTLE_ATTEMPT_SCHEMA,
      revision: selectedRevision,
      selection_sha256: plan.selection_sha256,
      started_at: "2026-07-23T12:01:00.000Z",
    })}\n`, { mode: 0o600 });

    let node = await DataNode.open({
      root: fixture.data,
      collections: [{
        id: CASTLE_COLLECTION_ID,
        name: "Castle of Understanding",
        description:
          "Operator-selected committed Castle Markdown and its canonical local root manifest",
        schema: { version: CASTLE_COLLECTION_SCHEMA },
        policy: {
          visibility: "private",
          max_record_bytes: MAX_ROOT_BYTES,
          allowed_media_types: ["text/markdown", "application/json"],
        },
      }],
      limits: {
        max_record_bytes: MAX_ROOT_BYTES,
        max_query_limit: 100,
      },
    });
    const projectedAt = "2026-07-23T12:01:01.000Z";
    const legacyMetadata = (title: string): JsonObject => ({
      profile: "castle-document/v1",
      logical_id: logicalId,
      document_kind: "word",
      source_path: path,
      source_revision: selectedRevision,
      source_committed_at: plan.revision_time,
      source_blob_oid: document.git_blob_oid,
      source_sha256: document.sha256,
      title,
      links: [...document.links],
      content_is_untrusted_markdown: true,
      local_private_projection: true,
    });
    const legacyInput: JsonObject = {
      text: document.text,
      media_type: "text/markdown",
      source_uri: `castle:///${path}`,
      external_id: path,
      key: logicalId,
      version: `${selectedRevision}:sha256:${document.sha256}`,
      observed_at: projectedAt,
      metadata: legacyMetadata(legacyTitle),
      provenance: [{
        activity: "projected_from_committed_git_blob",
        at: projectedAt,
        actor: "local:agenttool-castle",
        input_ids: [],
      }],
    };
    const legacyDocument = (await node.collect({
      collection_id: CASTLE_COLLECTION_ID,
      collector_id: "text",
      input: legacyInput,
    })).records[0]!;

    const collided = await node.collect({
      collection_id: CASTLE_COLLECTION_ID,
      collector_id: "text",
      input: {
        ...legacyInput,
        metadata: legacyMetadata(document.title),
      },
    });
    expect(collided).toMatchObject({ inserted: 0, existing: 1 });
    expect(collided.records[0]!.metadata.title).toBe(legacyTitle);

    const active = {
      logical_id: logicalId,
      kind: "word",
      record_id: legacyDocument.id,
      sha256: document.sha256,
      bytes: document.bytes,
      title: legacyTitle,
      source_revision: selectedRevision,
    };
    const manifest = {
      schema: CASTLE_ROOT_SCHEMA,
      audience: "local-private",
      source_revision: selectedRevision,
      source_committed_at: plan.revision_time,
      selection_sha256: plan.selection_sha256,
      purpose: plan.purpose,
      retention: plan.retention,
      retired_paths: [],
      active: [{ path, ...active }],
      limits: {
        max_documents: MAX_DOCUMENTS,
        max_document_bytes: MAX_DOCUMENT_BYTES,
        max_total_bytes: MAX_TOTAL_BYTES,
      },
      exclusions: [
        "live working tree",
        "courtyard, questions, quests, chronicle, journal, garden, hidden state",
        "Tower and authored works unless separately selected by a later profile",
        "hosted AgentTool memory, traces, correspondence, and wake",
      ],
      proof_limits: [
        "A Git commit and digest prove captured bytes, not truth, understanding, authorship, authority, consent, rights, completeness, or currentness.",
        "Markdown remains untrusted data and is never executed or fetched by this bridge.",
        "Agent Data visibility and retention fields are declarations; local in-process custody is the actual privacy boundary.",
        "A tombstone hides a record from normal reads but does not physically erase blobs, Git history, backups, caches, or copies.",
      ],
    };
    const rootText = `${canonicalJson(manifest)}\n`;
    const rootDigest = sha256Hex(rootText);
    const legacyRoot = (await node.collect({
      collection_id: CASTLE_COLLECTION_ID,
      collector_id: "text",
      input: {
        text: rootText,
        media_type: "application/json",
        source_uri: "castle:///manifest",
        external_id: "castle-root",
        key: "castle:root:manifest",
        version: `${selectedRevision}:sha256:${rootDigest}`,
        observed_at: projectedAt,
        metadata: {
          profile: CASTLE_ROOT_SCHEMA,
          source_revision: selectedRevision,
          source_committed_at: plan.revision_time,
          selection_sha256: plan.selection_sha256,
          active_records: 1,
          local_private_projection: true,
        },
        provenance: [{
          activity: "bound_local_projection",
          at: projectedAt,
          actor: "local:agenttool-castle",
          input_ids: [legacyDocument.id],
        }],
      },
    })).records[0]!;
    node.close();

    const legacyState = {
      schema: CASTLE_STATE_SCHEMA,
      status: "active",
      source_root_sha256: plan.source_root_sha256,
      current_revision: selectedRevision,
      selection_sha256: plan.selection_sha256,
      root_record_id: legacyRoot.id,
      root_lineage_record_id: legacyRoot.id,
      active: { [path]: active },
      lineage: { [path]: active },
      known_record_ids: [legacyDocument.id, legacyRoot.id].sort(),
    };
    await writeFile(join(fixture.data, "castle-pending.json"), `${JSON.stringify({
      schema: CASTLE_PENDING_SCHEMA,
      next_state: legacyState,
      tombstone_ids: [],
    })}\n`, { mode: 0o600 });

    const withdrawalFixture = {
      ...fixture,
      data: join(fixture.parent, "withdraw-legacy-pending"),
    };
    await cp(fixture.data, withdrawalFixture.data, {
      recursive: true,
      preserveTimestamps: true,
    });
    await expect(withdrawCastle({
      data_root: withdrawalFixture.data,
      reason: "Exercise the legacy pending escape hatch",
    })).resolves.toMatchObject({
      status: "withdrawn",
      known_records: 2,
      new_logical_tombstones: 2,
    });
    const withdrawnLegacy = await readState(withdrawalFixture);
    expect(withdrawnLegacy.status).toBe("withdrawn");
    expect(withdrawnLegacy.active).toEqual({});
    const withdrawnNode = await openFixtureNode(withdrawalFixture);
    try {
      expect(withdrawnNode.getTombstone(legacyDocument.id)).not.toBeNull();
      expect(withdrawnNode.getTombstone(legacyRoot.id)).not.toBeNull();
    } finally {
      withdrawnNode.close();
    }
    await expect(
      lstat(join(withdrawalFixture.data, "castle-pending.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(join(withdrawalFixture.data, "castle-attempt.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    })).resolves.toMatchObject({
      state: "empty",
      recovery_pending: true,
      pending_transaction: true,
      interrupted_attempt: true,
    });

    const originalCollect = DataNode.prototype.collect;
    let interruptedV2 = false;
    const interruptingCollect: DataNode["collect"] = async function (
      this: DataNode,
      request,
      signal,
    ) {
      const response = await originalCollect.call(this, request, signal);
      const metadata = request.input.metadata;
      if (
        !interruptedV2
        && metadata
        && typeof metadata === "object"
        && !Array.isArray(metadata)
        && metadata.profile === CASTLE_DOCUMENT_PROFILE
      ) {
        interruptedV2 = true;
        throw new Error("synthetic_v2_migration_crash");
      }
      return response;
    };
    DataNode.prototype.collect = interruptingCollect;
    try {
      await expect(syncCastle(syncOptions(fixture))).rejects.toThrow(
        "synthetic_v2_migration_crash",
      );
    } finally {
      DataNode.prototype.collect = originalCollect;
    }
    expect(interruptedV2).toBe(true);
    expect(JSON.parse(
      await readFile(join(fixture.data, "castle-owner.json"), "utf8"),
    ).schema).toBe(CASTLE_OWNER_SCHEMA);
    expect(JSON.parse(
      await readFile(join(fixture.data, "castle-format.json"), "utf8"),
    ).schema).toBe(CASTLE_FORMAT_SCHEMA);
    expect((await readState(fixture)).active[path].title).toBe(legacyTitle);
    await expect(lstat(join(fixture.data, "castle-pending.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(join(fixture.data, "castle-attempt.json"))).resolves.toBeTruthy();

    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "synced",
      active_records: 1,
      inserted_records: 1,
      retired_or_superseded: 2,
    });
    const migrated = await readState(fixture);
    const migratedDocumentId = migrated.active[path].record_id;
    expect(migrated.active[path].title).toBe(document.title);
    expect(migratedDocumentId).not.toBe(legacyDocument.id);
    expect(migrated.root_record_id).not.toBe(legacyRoot.id);

    node = await openFixtureNode(fixture);
    try {
      const migratedDocument = node.getRecord(migratedDocumentId)!;
      const migratedRoot = node.getRecord(migrated.root_record_id)!;
      const migratedManifest = JSON.parse(
        new TextDecoder().decode(await node.readContent(migratedRoot)),
      );
      expect(migratedDocument.metadata.profile).toBe(CASTLE_DOCUMENT_PROFILE);
      expect(migratedDocument.metadata.title).toBe(document.title);
      expect(migratedDocument.version).toEndWith(":profile:v2");
      expect(migratedDocument.supersedes_id).toBe(legacyDocument.id);
      expect(migratedRoot.metadata.profile).toBe(CASTLE_ROOT_SCHEMA);
      expect(migratedRoot.supersedes_id).toBe(legacyRoot.id);
      expect(migratedManifest.active).toEqual([{
        path,
        ...migrated.active[path],
      }]);
      expect(migratedManifest.source_revision).toBe(migrated.current_revision);
      expect(migratedManifest.selection_sha256).toBe(migrated.selection_sha256);
      expect(node.getTombstone(legacyDocument.id)).not.toBeNull();
      expect(node.getTombstone(legacyRoot.id)).not.toBeNull();
    } finally {
      node.close();
    }
    await expect(lstat(join(fixture.data, "castle-pending.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(join(fixture.data, "castle-attempt.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "unchanged",
      active_records: 1,
    });
  });

  test("rejects a v2 title fabricated against the stored Markdown bytes", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);

    const node = await openFixtureNode(fixture);
    const original = node.getRecord(state.active[ROOM.path].record_id)!;
    const fabricated = await collectDocumentVariant(node, original, {
      profile: CASTLE_DOCUMENT_PROFILE,
      title: "Fabricated Harbor",
      supersedes_id: original.id,
    });
    const active = {
      [ROOM.path]: stateEntryFromRecord(fabricated),
    };
    const root = await collectReplacementRoot(node, state, active);
    node.close();
    const fabricatedState = replacementState(
      state,
      active,
      root,
      [fabricated.id],
    );
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify(fabricatedState, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    }), "state_current_record_missing_or_mismatched");
    await expectCode(searchCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      text: "anchor",
    }), "state_current_record_missing_or_mismatched");
    await expectCode(
      syncCastle(syncOptions(fixture)),
      "state_current_record_missing_or_mismatched",
    );
    await expect(castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    })).resolves.toMatchObject({
      state: "invalid",
      recorded_state: "active",
      projection_integrity: "invalid",
      usable: false,
      validation_error: "state_current_record_missing_or_mismatched",
    });
    await expect(withdrawCastle({
      data_root: fixture.data,
      reason: "Remove the fabricated projection",
    })).resolves.toMatchObject({
      status: "withdrawn",
      new_logical_tombstones: 4,
    });
  });

  test("accepts and migrates the trimmed boundary title written by merged v0.1", async () => {
    const path = "words/trimmed-legacy.md";
    const selected = {
      path,
      logical_id: "castle:word:trimmed-legacy",
      kind: "word",
    } as const;
    const fixture = await createFixture({
      [path]: `# ${"a".repeat(199)} tail\n\nMerged v0.1 trimmed this boundary.\n`,
    });
    await writeSelection(fixture, revision(fixture), [selected]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    const node = await openFixtureNode(fixture);
    const original = node.getRecord(state.active[path].record_id)!;
    expect(original.metadata.title).toBe("a".repeat(199));
    const legacy = await collectDocumentVariant(node, original, {
      profile: "castle-document/v1",
      title: "a".repeat(199),
      supersedes_id: original.id,
    });
    const active = { [path]: stateEntryFromRecord(legacy) };
    const root = await collectReplacementRoot(node, state, active);
    node.close();
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify(replacementState(
        state,
        active,
        root,
        [legacy.id],
      ), null, 2)}\n`,
      { mode: 0o600 },
    );

    await expect(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path,
    })).resolves.toContain("Merged v0.1");
    await expect(syncCastle(syncOptions(fixture))).resolves.toMatchObject({
      status: "synced",
      active_records: 1,
    });
    expect((await readState(fixture)).active[path].title).toBe("a".repeat(199));
  });

  test("rejects a canonical fabricated root whose active mapping differs from state", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    const node = await openFixtureNode(fixture);
    const root = await collectReplacementRoot(
      node,
      state,
      state.active,
      (manifest) => {
        manifest.active[0].title = "Root-only fabrication";
      },
    );
    node.close();
    const fabricatedState = {
      ...state,
      root_record_id: root.id,
      root_lineage_record_id: root.id,
      known_record_ids: [...new Set([
        ...state.known_record_ids,
        root.id,
      ])].sort(),
    };
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify(fabricatedState, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    }), "state_root_record_missing_or_mismatched");
    await expectCode(
      syncCastle(syncOptions(fixture)),
      "state_root_record_missing_or_mismatched",
    );
  });

  test("binds control state to the durable format source root", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify({
        ...state,
        source_root_sha256: state.source_root_sha256 === "f".repeat(64)
          ? "e".repeat(64)
          : "f".repeat(64),
      }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    }), "data_root_belongs_to_another_castle");
    await expect(castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    })).resolves.toMatchObject({
      state: "invalid",
      recorded_state: "active",
      projection_integrity: "invalid",
      validation_error: "data_root_belongs_to_another_castle",
      usable: false,
    });
  });

  test("rejects an impossible v1 title but keeps withdrawal available", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    const node = await openFixtureNode(fixture);
    const original = node.getRecord(state.active[ROOM.path].record_id)!;
    const impossible = await collectDocumentVariant(node, original, {
      profile: "castle-document/v1",
      title: "Impossible historical title",
      supersedes_id: original.id,
    });
    const active = {
      [ROOM.path]: stateEntryFromRecord(impossible),
    };
    const root = await collectReplacementRoot(node, state, active);
    node.close();
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify(replacementState(
        state,
        active,
        root,
        [impossible.id],
      ), null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    }), "state_current_record_missing_or_mismatched");
    await expect(withdrawCastle({
      data_root: fixture.data,
      reason: "Withdraw an impossible legacy envelope",
    })).resolves.toMatchObject({
      status: "withdrawn",
      new_logical_tombstones: 4,
    });
    const withdrawn = await readState(fixture);
    expect(withdrawn.lineage[ROOM.path].record_id).toBe(original.id);
    expect(withdrawn.lineage[ROOM.path].record_id).not.toBe(impossible.id);
  });

  test("rejects mixed active profiles everywhere except the withdrawal path", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM, WORD]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    const node = await openFixtureNode(fixture);
    const originalWord = node.getRecord(state.active[WORD.path].record_id)!;
    const legacyWord = await collectDocumentVariant(node, originalWord, {
      profile: "castle-document/v1",
      title: "Joy",
      supersedes_id: originalWord.id,
    });
    const active = {
      ...state.active,
      [WORD.path]: stateEntryFromRecord(legacyWord),
    };
    const root = await collectReplacementRoot(node, state, active);
    node.close();
    await writeFile(
      join(fixture.data, "castle-state.json"),
      `${JSON.stringify(replacementState(
        state,
        active,
        root,
        [legacyWord.id],
      ), null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(showCastle({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
      path: ROOM.path,
    }), "state_current_record_missing_or_mismatched");
    await expect(castleStatus({
      data_root: fixture.data,
      halt_paths: [fixture.halt],
    })).resolves.toMatchObject({
      state: "invalid",
      recorded_state: "active",
      projection_integrity: "invalid",
      usable: false,
    });
    await expect(withdrawCastle({
      data_root: fixture.data,
      reason: "Withdraw a mixed legacy projection",
    })).resolves.toMatchObject({
      status: "withdrawn",
      new_logical_tombstones: 5,
    });
  });

  test("fully validates pending state before applying any tombstone", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));
    const state = await readState(fixture);
    const stateBytes = await readFile(
      join(fixture.data, "castle-state.json"),
      "utf8",
    );
    const node = await openFixtureNode(fixture);
    const original = node.getRecord(state.active[ROOM.path].record_id)!;
    const fabricated = await collectDocumentVariant(node, original, {
      profile: CASTLE_DOCUMENT_PROFILE,
      title: "Pending fabrication",
      supersedes_id: original.id,
    });
    const active = {
      [ROOM.path]: stateEntryFromRecord(fabricated),
    };
    const root = await collectReplacementRoot(node, state, active);
    node.close();
    const nextState = replacementState(state, active, root, [fabricated.id]);
    await writeFile(
      join(fixture.data, "castle-pending.json"),
      `${JSON.stringify({
        schema: CASTLE_PENDING_SCHEMA,
        next_state: nextState,
        tombstone_ids: [original.id, state.root_record_id],
      }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expectCode(
      syncCastle(syncOptions(fixture)),
      "state_current_record_missing_or_mismatched",
    );
    expect(await readFile(
      join(fixture.data, "castle-state.json"),
      "utf8",
    )).toBe(stateBytes);
    await expect(lstat(join(fixture.data, "castle-pending.json"))).resolves.toBeTruthy();
    const reopened = await openFixtureNode(fixture);
    try {
      expect(reopened.getTombstone(original.id)).toBeNull();
      expect(reopened.getTombstone(state.root_record_id)).toBeNull();
    } finally {
      reopened.close();
    }
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
    const originalReadContent = DataNode.prototype.readContent;
    let statusBlobReads = 0;
    DataNode.prototype.readContent = async function (...args) {
      statusBlobReads += 1;
      return originalReadContent.apply(this, args);
    };
    let stopped: Readonly<Record<string, unknown>>;
    try {
      stopped = await castleStatus({
        data_root: fixture.data,
        halt_paths: [fixture.halt],
      });
    } finally {
      DataNode.prototype.readContent = originalReadContent;
    }
    expect(statusBlobReads).toBe(0);
    expect(stopped.state).toBe("withdrawn");
    expect(stopped).toMatchObject({
      recorded_state: "withdrawn",
      projection_integrity: "not_checked",
      usable: false,
    });

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
    const fifo = join(deadLock, "owner-999999.json");
    const madeFifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    expect(madeFifo.status).toBe(0);
    const script = resolve(import.meta.dir, "..", "agenttool-castle.ts");
    const fifoAttempt = spawnSync(process.execPath, [
      script,
      "sync",
      "--castle-root",
      fixture.castle,
      "--data-root",
      fixture.data,
      "--selection",
      fixture.selection,
      "--json",
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: fixture.parent },
      timeout: 2_000,
    });
    expect(fifoAttempt.error).toBeUndefined();
    expect(fifoAttempt.status).toBe(1);
    expect(fifoAttempt.stderr).toContain("castle_bridge_lock_busy");
    expect((await lstat(fifo)).isFIFO()).toBe(true);
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

  test("honors HALT raised during late unchanged-state validation", async () => {
    const fixture = await createFixture();
    await writeSelection(fixture, revision(fixture), [ROOM]);
    await syncCastle(syncOptions(fixture));

    const statePath = join(fixture.data, "castle-state.json");
    const state = await readFile(statePath, "utf8");
    await writeFile(statePath, `${state}${" ".repeat(48 * 1024 * 1024)}`, {
      mode: 0o600,
    });
    const stateInfo = await lstat(statePath);
    await utimes(statePath, new Date(0), stateInfo.mtime);

    const outcome = syncCastle(syncOptions(fixture)).then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    let lateReadObserved = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if ((await lstat(statePath)).atimeMs > 1_000) {
        lateReadObserved = true;
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
    }
    expect(lateReadObserved).toBe(true);
    await writeFile(fixture.halt, "halt\n", { mode: 0o600 });

    const settled = await outcome;
    expect(settled.status).toBe("rejected");
    if (settled.status !== "rejected") {
      throw new Error(`unchanged sync returned after late HALT: ${JSON.stringify(settled.value)}`);
    }
    expect(settled.error).toMatchObject({ code: "castle_bridge_halted" });
  });

  test("keeps a final HALT check adjacent to every successful sync return", async () => {
    const source = await readFile(
      resolve(import.meta.dir, "..", "agenttool-castle.ts"),
      "utf8",
    );
    const syncSource = source.slice(
      source.indexOf("export async function syncCastle"),
      source.indexOf("export async function castleStatus"),
    );
    expect(
      syncSource.match(
        /await assertHaltsClear\(options\.halt_paths\);\n\s+return Object\.freeze\(\{/g,
      ),
    ).toHaveLength(3);
  });

  test("withdraws first-sync crash orphans and can resume their lineage", async () => {
    const fixture = await createFixture({
      "rooms/harbor.md": "# Harbor\n\nCrash-safe understanding.\n",
    });
    const selectedRevision = revision(fixture);
    await writeSelection(fixture, selectedRevision, [ROOM]);
    const plan = await buildCastlePlan({
      castle_root: fixture.castle,
      selection_path: fixture.selection,
    });
    const document = plan.documents[0]!;
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
      selection_sha256: plan.selection_sha256,
      started_at: "2026-07-23T12:01:00.000Z",
    })}\n`, { mode: 0o600 });

    const text = document.text;
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
    const observedAt = "2026-07-23T12:01:01.000Z";
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
        observed_at: observedAt,
        metadata: {
          profile: "castle-document/v1",
          logical_id: ROOM.logical_id,
          document_kind: ROOM.kind,
          source_path: ROOM.path,
          source_revision: selectedRevision,
          source_committed_at: plan.revision_time,
          source_blob_oid: document.git_blob_oid,
          source_sha256: digest,
          title: "Harbor",
          links: [...document.links],
          content_is_untrusted_markdown: true,
          local_private_projection: true,
        },
        provenance: [{
          activity: "projected_from_committed_git_blob",
          at: observedAt,
          actor: "local:agenttool-castle",
          input_ids: [],
        }],
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
