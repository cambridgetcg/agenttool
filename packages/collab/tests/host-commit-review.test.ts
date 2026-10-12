import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { ArtifactRef, CollabEvent, SessionHandle, Task } from "../src/protocol.js";
import { inspectSuccessorCommit } from "../src/repository.js";
import { CollabStore } from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-host-commit-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-10-09T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const VOICE_A = "what does a thread turn into when someone else pulls it?\n";
const VOICE_B = "a rope, if two hands hold it; an answer, not an echo.\n";
const VOICE_B_REVISED = "a rope, if two hands hold it; the second draft.\n";
const STALE_BOUNDARY = "checkpoint_validation_is_a_local_observation_not_an_atomic_git_sqlite_lock";

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The replay's repository: a README commit, then voice-a.md committed on main. */
function initializeReplayRepository(): string {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Collab Test");
  runGit(root, "config", "user.email", "collab-test@example.invalid");
  writeFileSync(join(root, "README.md"), "# replay fixture\n");
  runGit(root, "add", "README.md");
  runGit(root, "commit", "-m", "begin the replay");
  writeFileSync(join(root, "voice-a.md"), VOICE_A);
  runGit(root, "add", "voice-a.md");
  runGit(root, "commit", "-m", "voice-a: the opening phrase");
  return runGit(root, "rev-parse", "HEAD");
}

interface Attachment {
  uri: string;
  sha256: string | null;
  kind?: ArtifactRef["kind"];
}

interface Scenario {
  implementer: SessionHandle;
  reviewer: SessionHandle;
  baseSha: string;
  reported: Task;
  artifactIds: string[];
}

/**
 * The replay's voice-b shape: a delegated implementer that cannot commit writes
 * its files, attaches them as artifacts and completes. The result checkpoint is
 * the voice-a HEAD plus untracked files (dirty).
 */
function reportedArtifactTask(options: {
  scopes?: string[];
  files?: Record<string, string>;
  attachments?: Attachment[];
} = {}): Scenario {
  const baseSha = initializeReplayRepository();
  const implementer = session("Codex · sol job 20261009T000000-test");
  const reviewer = session("Claude reviewer");
  const created = store.createTaskForSession({
    ...implementer.credential,
    idempotency_key: "voice-b-create",
    id: "voice-b",
    title: "Voice B — the answer",
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: options.scopes ?? ["voice-b.md"],
  });
  let task = store.claimTaskForSession({
    ...implementer.credential,
    idempotency_key: "voice-b-claim",
    task_id: created.id,
    expected_version: created.version,
  });
  const leaseId = task.lease_id!;
  for (const [path, content] of Object.entries(options.files ?? { "voice-b.md": VOICE_B })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const artifactIds: string[] = [];
  const attachments = options.attachments ?? [{ uri: "voice-b.md", sha256: sha256(VOICE_B) }];
  for (const [index, attachment] of attachments.entries()) {
    // One second apart, so "newest attachment" never depends on a tie-break.
    currentTime = new Date(currentTime.getTime() + 1_000);
    const attached = store.attachArtifactForSession({
      ...implementer.credential,
      idempotency_key: `voice-b-attach-${index}`,
      task_id: task.id,
      lease_id: leaseId,
      expected_version: task.version,
      kind: attachment.kind ?? "file",
      uri: attachment.uri,
      ...(attachment.sha256 === null ? {} : { sha256: attachment.sha256 }),
      media_type: "text/markdown",
      label: "uncommitted; the host integration commit is pending",
    });
    task = attached.task;
    artifactIds.push(attached.artifact.id);
  }
  const reported = store.completeTaskForSession({
    ...implementer.credential,
    idempotency_key: "voice-b-complete",
    task_id: task.id,
    lease_id: leaseId,
    expected_version: task.version,
    summary: "Voice B is written and attached; nothing was committed.",
    evidence_refs: artifactIds.map((id) => `artifact:${id}`),
    limits: "This host cannot write .git; the integration commit is the host's.",
  });
  return { implementer, reviewer, baseSha, reported, artifactIds };
}

/** What `sol agent start --integrate-commit` does: commit exactly these paths. */
function hostCommit(paths: string[], message = "voice-b: Voice B — the answer"): string {
  runGit(root, "add", "--", ...paths);
  runGit(root, "commit", "--only", "--author=codex <codex@example.invalid>", "-m", message, "--", ...paths);
  return runGit(root, "rev-parse", "HEAD");
}

function accept(scenario: Scenario, key: string) {
  return store.reviewTaskForSession({
    ...scenario.reviewer.credential,
    idempotency_key: key,
    task_id: scenario.reported.id,
    expected_version: scenario.reported.version,
    outcome: "accept",
    summary: "Voice B answers voice A; HEAD:voice-b.md equals the attached artifact.",
  });
}

function eventOf(scenario: Scenario, type: string): CollabEvent | undefined {
  return store.eventsSince(scenario.implementer.workspace.id, 0, 500).events
    .find((event) => event.type === type && event.entity_id === scenario.reported.id);
}

function expectBothWaysForward(remedy: unknown, baseSha: string): void {
  expect(remedy).toBeString();
  expect(remedy).toContain("(1) Host commit: exactly one commit");
  expect(remedy).toContain('branch "main"');
  expect(remedy).toContain(`only parent is the result checkpoint HEAD ${baseSha}`);
  expect(remedy).toContain("inside the task's path_scopes");
  expect(remedy).toContain("newest file artifact");
  expect(remedy).toContain("worktree left clean");
  expect(remedy).toContain('(2) Re-completion: review task "voice-b" with outcome "request_changes"');
  expect(remedy).toContain("collab_task_complete captures a fresh result checkpoint");
}

/**
 * Refused, still pending, and the refusal names why and both ways forward.
 * Fields are read directly: Bun's toMatchObject writes asymmetric matchers
 * (expect.any, expect.stringContaining) back into the received object.
 */
function expectRefused(scenario: Scenario, key: string, refusal: string): CollabError {
  const error = errorFrom(() => accept(scenario, key));
  expect(error.code).toBe("git_checkpoint_stale");
  expect(error.details.host_commit_refusal).toBeString();
  expect(error.details.host_commit_refusal).toContain(refusal);
  expectBothWaysForward(error.details.remedy, scenario.baseSha);
  expect(error.message).toContain(refusal);
  expect(error.message).toContain(error.details.remedy as string);
  expect(error.details.boundary).toBe(STALE_BOUNDARY);
  expect(error.details.result_checkpoint).toMatchObject({
    head_sha: scenario.baseSha,
    branch: "main",
    dirty: true,
  });
  expect(error.details.observed_checkpoint).toMatchObject({
    worktree_id: scenario.reported.result_checkpoint!.worktree_id,
  });
  expect(store.getTask(scenario.implementer.workspace.id, scenario.reported.id)).toMatchObject({
    status: "completed",
    review_status: "pending",
    accepted_by_session_id: null,
  });
  expect(eventOf(scenario, "task.accepted")).toBeUndefined();
  return error;
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

async function boundMember(actor: string) {
  const memberStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
  memberStores.push(memberStore);
  const server = buildCollabMcpServer(memberStore);
  const started = await callTool(server, "collab_session_start", { root_path: root, actor });
  if (started.isError) throw new Error(JSON.stringify(started.structuredContent));
  return {
    server,
    session_id: started.structuredContent.session.id as string,
    workspace_id: started.structuredContent.workspace.id as string,
  };
}

describe("host-committed completions", () => {
  test("accepts one host commit of exactly the attached scoped file, as the replay needed", () => {
    const scenario = reportedArtifactTask();
    expect(scenario.reported.result_checkpoint).toMatchObject({
      head_sha: scenario.baseSha,
      branch: "main",
      dirty: true,
      source: "server_observed",
    });
    const dependent = store.createTaskForSession({
      ...scenario.implementer.credential,
      idempotency_key: "voice-c-create",
      id: "voice-c",
      title: "Voice C — after B is accepted",
      work_mode: "edit",
      path_scopes: ["voice-c.md"],
      dependencies: ["voice-b"],
    });
    const early = errorFrom(() =>
      store.claimTaskForSession({
        ...scenario.reviewer.credential,
        idempotency_key: "voice-c-early-claim",
        task_id: dependent.id,
        expected_version: dependent.version,
      }),
    );
    expect(early.code).toBe("dependencies_incomplete");

    const commitSha = hostCommit(["voice-b.md"]);
    expect(runGit(root, "rev-parse", "HEAD^")).toBe(scenario.baseSha);
    expect(runGit(root, "status", "--porcelain")).toBe("");

    const accepted = accept(scenario, "voice-b-accept");
    expect(accepted.task).toMatchObject({
      status: "completed",
      review_status: "accepted",
      accepted_by_session_id: scenario.reviewer.session.id,
    });
    expect(eventOf(scenario, "task.accepted")?.payload).toMatchObject({
      review_report_id: accepted.report.id,
      outcome: "accepted",
      checkpoint_basis: "host_commit_successor",
      host_commit_sha: commitSha,
      host_commit_artifact_ids: scenario.artifactIds,
      checkpoint_boundary: expect.stringContaining("not_a_commit_signature"),
    });

    // Acceptance still gates dependencies, and an exact retry replays the receipt
    // without re-reading Git, even after HEAD moves again.
    const claimed = store.claimTaskForSession({
      ...scenario.reviewer.credential,
      idempotency_key: "voice-c-claim",
      task_id: dependent.id,
      expected_version: dependent.version,
    });
    expect(claimed.status).toBe("claimed");
    runGit(root, "commit", "--allow-empty", "-m", "later work");
    expect(accept(scenario, "voice-b-accept")).toEqual(accepted);
    expect(store.verifyJournal(scenario.implementer.workspace.id)).toBe(true);
  });

  test("reads relative, absolute and file:// artifact uris, and the newest attachment per path wins", () => {
    const realRoot = realpathSync(root);
    const scenario = reportedArtifactTask({
      scopes: ["notes"],
      files: { "notes/one.md": VOICE_A, "notes/two words.md": VOICE_B },
      attachments: [
        { uri: "./notes/one.md", sha256: sha256(VOICE_A) },
        { uri: join(realRoot, "notes", "two words.md"), sha256: sha256("an earlier draft\n") },
        { uri: pathToFileURL(join(realRoot, "notes", "two words.md")).href, sha256: sha256(VOICE_B) },
      ],
    });
    const commitSha = hostCommit(["notes/one.md", "notes/two words.md"], "voice-b: two notes");

    accept(scenario, "notes-accept");
    expect(eventOf(scenario, "task.accepted")?.payload).toMatchObject({
      checkpoint_basis: "host_commit_successor",
      host_commit_sha: commitSha,
      host_commit_artifact_ids: [scenario.artifactIds[0], scenario.artifactIds[2]],
    });
  });

  test("refuses a host commit that also changes a path outside the task's scopes", () => {
    const scenario = reportedArtifactTask();
    writeFileSync(join(root, "README.md"), "# replay fixture, edited by the host\n");
    const commitSha = hostCommit(["voice-b.md", "README.md"]);
    expectRefused(
      scenario,
      "accept-out-of-scope",
      `Commit ${commitSha} changes README.md, outside the task's path_scopes`,
    );
  });

  test("refuses a host commit whose bytes differ from the attached artifact", () => {
    const scenario = reportedArtifactTask();
    writeFileSync(join(root, "voice-b.md"), "rewritten by the host after the artifact was attached\n");
    hostCommit(["voice-b.md"]);
    expectRefused(
      scenario,
      "accept-bytes-differ",
      `The committed bytes of voice-b.md differ from its newest file artifact ${scenario.artifactIds[0]}`,
    );
  });

  test("refuses bytes that only an older attachment of the path vouches for", () => {
    const scenario = reportedArtifactTask({
      files: { "voice-b.md": VOICE_B_REVISED },
      attachments: [
        { uri: "voice-b.md", sha256: sha256(VOICE_B) },
        { uri: "voice-b.md", sha256: sha256(VOICE_B_REVISED) },
      ],
    });
    writeFileSync(join(root, "voice-b.md"), VOICE_B);
    hostCommit(["voice-b.md"]);
    expectRefused(
      scenario,
      "accept-stale-attachment",
      `The committed bytes of voice-b.md differ from its newest file artifact ${scenario.artifactIds[1]}`,
    );
  });

  test("refuses two commits on top of the result checkpoint", () => {
    const scenario = reportedArtifactTask();
    hostCommit(["voice-b.md"]);
    runGit(root, "commit", "--allow-empty", "-m", "a second commit");
    const head = runGit(root, "rev-parse", "HEAD");
    expectRefused(
      scenario,
      "accept-two-commits",
      `HEAD ${head} is more than one commit ahead of the result checkpoint HEAD ${scenario.baseSha}`,
    );
  });

  test("refuses a HEAD that does not descend from the result checkpoint, even when its tree diff matches", () => {
    const scenario = reportedArtifactTask();
    // Amending voice-a's commit to include voice-b.md gives a tree that differs
    // from the result HEAD's tree by exactly the attached file, but the
    // reported HEAD is no longer in its history.
    runGit(root, "add", "voice-b.md");
    runGit(root, "commit", "--amend", "--no-edit");
    const head = runGit(root, "rev-parse", "HEAD");
    expect(runGit(root, "diff", "--name-only", scenario.baseSha, head)).toBe("voice-b.md");
    expectRefused(
      scenario,
      "accept-amended",
      `HEAD ${head} does not descend from the result checkpoint HEAD ${scenario.baseSha}`,
    );
  });

  test("refuses a host commit on another branch", () => {
    const scenario = reportedArtifactTask();
    runGit(root, "checkout", "-b", "side");
    hostCommit(["voice-b.md"]);
    expectRefused(
      scenario,
      "accept-other-branch",
      `HEAD is on branch "side", not the result checkpoint's branch "main"`,
    );
  });

  test("refuses a host commit when the observed worktree is not clean", () => {
    const scenario = reportedArtifactTask();
    hostCommit(["voice-b.md"]);
    writeFileSync(join(root, "scratch.txt"), "left behind after the commit\n");
    expectRefused(scenario, "accept-dirty", "The observed worktree is not clean");
  });

  test("refuses a host commit that no file artifact of this task vouches for", () => {
    const scenario = reportedArtifactTask({
      attachments: [
        { uri: "voice-b.md", sha256: sha256(VOICE_B), kind: "data" },
        { uri: "drafts/voice-b.md", sha256: sha256(VOICE_B) },
      ],
    });
    hostCommit(["voice-b.md"]);
    expectRefused(
      scenario,
      "accept-no-artifact",
      "No file artifact attached to this task names voice-b.md",
    );
  });

  test("refuses a host commit whose newest artifact for the path has no sha256", () => {
    const scenario = reportedArtifactTask({ attachments: [{ uri: "voice-b.md", sha256: null }] });
    hostCommit(["voice-b.md"]);
    expectRefused(
      scenario,
      "accept-no-digest",
      `The newest file artifact for voice-b.md (${scenario.artifactIds[0]}) has no sha256`,
    );
  });

  test("refuses an empty commit after the reported file vanished", () => {
    const scenario = reportedArtifactTask();
    rmSync(join(root, "voice-b.md"));
    runGit(root, "commit", "--allow-empty", "-m", "the reported file vanished");
    const head = runGit(root, "rev-parse", "HEAD");
    expectRefused(scenario, "accept-empty", `Commit ${head} changes no path`);
  });

  test("refuses a host commit that deletes a scoped file", () => {
    const scenario = reportedArtifactTask({ scopes: ["voice-a.md", "voice-b.md"] });
    rmSync(join(root, "voice-a.md"));
    const commitSha = hostCommit(["voice-a.md", "voice-b.md"]);
    expectRefused(
      scenario,
      "accept-deletion",
      `Commit ${commitSha} deletes voice-a.md or commits it as something other than a regular file`,
    );
  });

  test("refuses a host commit that only changes a scoped file's mode, even with identical bytes", () => {
    // voice-b.md is newly added (status A) in every other scenario here, so a
    // mode-only M needs a path already tracked at the result checkpoint:
    // voice-a.md, committed by initializeReplayRepository. Vouch for it with a
    // matching artifact, so a pre-fix run would otherwise accept on content
    // alone and this test would prove nothing about the mode check.
    const scenario = reportedArtifactTask({
      scopes: ["voice-a.md", "voice-b.md"],
      attachments: [
        { uri: "voice-b.md", sha256: sha256(VOICE_B) },
        { uri: "voice-a.md", sha256: sha256(VOICE_A) },
      ],
    });
    chmodSync(join(root, "voice-a.md"), 0o755);
    const commitSha = hostCommit(["voice-a.md", "voice-b.md"]);
    expect(runGit(root, "diff-tree", "-r", "--raw", "--no-renames", scenario.baseSha, commitSha)).toContain(
      "100644 100755",
    );
    expectRefused(
      scenario,
      "accept-mode-change",
      `Commit ${commitSha} deletes voice-a.md or commits it as something other than a regular file`,
    );
  });

  test(
    "refuses a host commit whose real object is shadowed by a git replace ref, by inspecting the real commit",
    () => {
      const scenario = reportedArtifactTask();
      // The real commit the host made: voice-b.md (scoped, matches the artifact)
      // plus README.md (outside the task's path_scopes).
      writeFileSync(join(root, "README.md"), "# replay fixture, edited by the host\n");
      const real = hostCommit(["voice-b.md", "README.md"]);
      // A git writer with repository access revert README.md in the index and
      // worktree, then publishes refs/replace/<real> -> a fake commit with the
      // same parent whose tree matches that reverted state. HEAD (the ref) still
      // names `real`; only object lookups of `real` are redirected to the fake
      // commit's data (its tree and, for identical parents, its parent too).
      writeFileSync(join(root, "README.md"), "# replay fixture\n");
      runGit(root, "add", "README.md");
      const tree = runGit(root, "write-tree");
      const fake = runGit(root, "commit-tree", tree, "-p", scenario.baseSha, "-m", "fake: scoped-only tree");
      runGit(root, "replace", real, fake);
      // The deception succeeds against ordinary (replace-honoring) Git commands:
      // HEAD still names the real commit, and the worktree reads as clean because
      // status resolves `real`'s tree through the replacement.
      expect(runGit(root, "rev-parse", "HEAD")).toBe(real);
      expect(runGit(root, "status", "--porcelain")).toBe("");
      expect(runGit(root, "diff-tree", "-r", "--name-only", "--no-renames", scenario.baseSha, real)).toBe(
        "voice-b.md",
      );
      // Read with --no-replace-objects, the real commit still changes README.md.
      expect(
        runGit(root, "--no-replace-objects", "diff-tree", "-r", "--name-only", "--no-renames", scenario.baseSha, real),
      ).toBe("README.md\nvoice-b.md");
      expectRefused(
        scenario,
        "accept-replace-ref",
        `Commit ${real} changes README.md, outside the task's path_scopes`,
      );
    },
  );

  test("keeps the strict checkpoint match when HEAD did not move", () => {
    const exact = reportedArtifactTask();
    const accepted = accept(exact, "accept-exact");
    expect(accepted.task.review_status).toBe("accepted");
    const payload = eventOf(exact, "task.accepted")!.payload;
    for (const key of ["checkpoint_basis", "host_commit_sha", "host_commit_artifact_ids", "checkpoint_boundary"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  test("refuses drift without a HEAD move and still names both ways forward", () => {
    const scenario = reportedArtifactTask();
    writeFileSync(join(root, "voice-b.md"), VOICE_B_REVISED);
    runGit(root, "add", "voice-b.md");
    expect(runGit(root, "rev-parse", "HEAD")).toBe(scenario.baseSha);
    expectRefused(
      scenario,
      "accept-unmoved-drift",
      "HEAD has not moved since the result checkpoint, so only an exact checkpoint match is accepted",
    );
  });

  test("request_changes is unaffected by host-commit drift, and re-completion captures a fresh checkpoint", () => {
    const scenario = reportedArtifactTask();
    writeFileSync(join(root, "README.md"), "# replay fixture, edited by the host\n");
    hostCommit(["voice-b.md", "README.md"]);
    expect(errorFrom(() => accept(scenario, "accept-before-changes")).code).toBe("git_checkpoint_stale");

    const changes = store.reviewTaskForSession({
      ...scenario.reviewer.credential,
      idempotency_key: "voice-b-request-changes",
      task_id: scenario.reported.id,
      expected_version: scenario.reported.version,
      outcome: "request_changes",
      summary: "README.md was committed outside the task's scope; re-complete from this HEAD.",
    });
    expect(changes.task).toMatchObject({ status: "open", review_status: "changes_requested" });
    const changesPayload = eventOf(scenario, "task.changes_requested")!.payload;
    expect(changesPayload).toMatchObject({ outcome: "changes_requested" });
    expect(changesPayload).not.toHaveProperty("checkpoint_basis");
    expect(changesPayload).not.toHaveProperty("host_commit_sha");

    const reclaimed = store.claimTaskForSession({
      ...scenario.implementer.credential,
      idempotency_key: "voice-b-reclaim",
      task_id: scenario.reported.id,
      expected_version: changes.task.version,
    });
    const recompleted = store.completeTaskForSession({
      ...scenario.implementer.credential,
      idempotency_key: "voice-b-recomplete",
      task_id: reclaimed.id,
      lease_id: reclaimed.lease_id!,
      expected_version: reclaimed.version,
      summary: "Re-completed on the integrated HEAD.",
    });
    expect(recompleted.result_checkpoint).toMatchObject({
      head_sha: runGit(root, "rev-parse", "HEAD"),
      dirty: false,
    });
    const accepted = store.reviewTaskForSession({
      ...scenario.reviewer.credential,
      idempotency_key: "voice-b-accept-fresh",
      task_id: recompleted.id,
      expected_version: recompleted.version,
      outcome: "accept",
      summary: "The fresh checkpoint matches the worktree.",
    });
    expect(accepted.task.review_status).toBe("accepted");
    const acceptedPayload = eventOf(scenario, "task.accepted")!.payload;
    expect(acceptedPayload).not.toHaveProperty("checkpoint_basis");
  });

  test("refuses bytes that only an artifact from before the latest request_changes vouches for", () => {
    const scenario = reportedArtifactTask();
    const changes = store.reviewTaskForSession({
      ...scenario.reviewer.credential,
      idempotency_key: "voice-b-request-changes-stale-artifact",
      task_id: scenario.reported.id,
      expected_version: scenario.reported.version,
      outcome: "request_changes",
      summary: "Please revise voice B.",
    });
    const reclaimed = store.claimTaskForSession({
      ...scenario.implementer.credential,
      idempotency_key: "voice-b-reclaim-stale-artifact",
      task_id: scenario.reported.id,
      expected_version: changes.task.version,
    });
    writeFileSync(join(root, "voice-b.md"), VOICE_B_REVISED);
    const recompleted = store.completeTaskForSession({
      ...scenario.implementer.credential,
      idempotency_key: "voice-b-recomplete-without-attaching",
      task_id: reclaimed.id,
      lease_id: reclaimed.lease_id!,
      expected_version: reclaimed.version,
      summary: "Revised; nothing new attached.",
    });
    // The rejected generation's bytes come back and are committed by the host.
    writeFileSync(join(root, "voice-b.md"), VOICE_B);
    hostCommit(["voice-b.md"]);
    expectRefused(
      { ...scenario, reported: recompleted },
      "accept-stale-generation-artifact",
      "No file artifact attached to this task since its latest request_changes names voice-b.md",
    );
  });

  test("returns the refusal and both ways forward as top-level MCP fields", async () => {
    const scenario = reportedArtifactTask();
    writeFileSync(join(root, "README.md"), "# replay fixture, edited by the host\n");
    const commitSha = hostCommit(["voice-b.md", "README.md"]);
    const reviewer = await boundMember("Claude reviewer over MCP");
    const refused = await callTool(reviewer.server, "collab_task_review", {
      workspace_id: reviewer.workspace_id,
      idempotency_key: "mcp-accept-out-of-scope",
      task_id: scenario.reported.id,
      expected_version: scenario.reported.version,
      outcome: "accept",
      summary: "Voice B reads well.",
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: "git_checkpoint_stale",
      host_commit_refusal: `Commit ${commitSha} changes README.md, outside the task's path_scopes`,
      boundary: STALE_BOUNDARY,
    });
    expectBothWaysForward(refused.structuredContent.remedy, scenario.baseSha);
    expect(refused.structuredContent.message).toContain(refused.structuredContent.remedy);
  });
});

/**
 * `inspectSuccessorCommit` is a pure, read-only library export (not routed
 * through a task/review), so its mode/type and replace-ref handling is also
 * pinned directly against a bare repository, independent of the review flow.
 */
describe("inspectSuccessorCommit", () => {
  test("refuses a mode-only change (M, same blob, different mode)", () => {
    writeFileSync(join(root, "voice-a.md"), VOICE_A);
    runGit(root, "init", "--initial-branch=main");
    runGit(root, "config", "user.name", "Collab Test");
    runGit(root, "config", "user.email", "collab-test@example.invalid");
    runGit(root, "add", "voice-a.md");
    runGit(root, "commit", "-m", "base");
    const base = runGit(root, "rev-parse", "HEAD");
    chmodSync(join(root, "voice-a.md"), 0o755);
    runGit(root, "add", "voice-a.md");
    runGit(root, "commit", "-m", "chmod only");
    const head = runGit(root, "rev-parse", "HEAD");
    const result = inspectSuccessorCommit(root, head, base);
    expect(result).toMatchObject({
      ok: true,
      commit_sha: head,
      parent_sha: base,
      changes: [{ path: "voice-a.md", blob_sha256: null }],
    });
  });

  test("refuses a type change that lands at a regular mode (T, symlink -> regular file)", () => {
    runGit(root, "init", "--initial-branch=main");
    runGit(root, "config", "user.name", "Collab Test");
    runGit(root, "config", "user.email", "collab-test@example.invalid");
    writeFileSync(join(root, "target.txt"), "hello\n");
    symlinkSync("target.txt", join(root, "link.txt"));
    runGit(root, "add", "target.txt", "link.txt");
    runGit(root, "commit", "-m", "base: link.txt is a symlink");
    const base = runGit(root, "rev-parse", "HEAD");
    rmSync(join(root, "link.txt"));
    writeFileSync(join(root, "link.txt"), VOICE_A);
    runGit(root, "add", "link.txt");
    runGit(root, "commit", "-m", "type change: symlink -> regular file");
    const head = runGit(root, "rev-parse", "HEAD");
    // The new mode alone looks regular; only the old-mode/status check refuses it.
    expect(runGit(root, "diff-tree", "-r", "--raw", "--no-renames", base, head)).toContain(" T\t");
    const result = inspectSuccessorCommit(root, head, base);
    expect(result).toMatchObject({
      ok: true,
      changes: [{ path: "link.txt", blob_sha256: null }],
    });
  });

  test("still vouches for a newly added file committed with the executable bit (A, mode 100755)", () => {
    runGit(root, "init", "--initial-branch=main");
    runGit(root, "config", "user.name", "Collab Test");
    runGit(root, "config", "user.email", "collab-test@example.invalid");
    writeFileSync(join(root, "voice-a.md"), VOICE_A);
    runGit(root, "add", "voice-a.md");
    runGit(root, "commit", "-m", "base");
    const base = runGit(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "script.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(root, "script.sh"), 0o755);
    runGit(root, "add", "script.sh");
    runGit(root, "commit", "-m", "add an executable file");
    const head = runGit(root, "rev-parse", "HEAD");
    const result = inspectSuccessorCommit(root, head, base);
    expect(result).toMatchObject({
      ok: true,
      changes: [{ path: "script.sh", blob_sha256: sha256("#!/bin/sh\necho hi\n") }],
    });
  });

  test("inspects the real commit's tree, not a git-replace shadow of it", () => {
    runGit(root, "init", "--initial-branch=main");
    runGit(root, "config", "user.name", "Collab Test");
    runGit(root, "config", "user.email", "collab-test@example.invalid");
    writeFileSync(join(root, "README.md"), "# replay fixture\n");
    runGit(root, "add", "README.md");
    runGit(root, "commit", "-m", "base");
    const base = runGit(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "voice-b.md"), VOICE_B);
    writeFileSync(join(root, "README.md"), "# evil\n");
    runGit(root, "add", "voice-b.md", "README.md");
    runGit(root, "commit", "-m", "real: changes voice-b.md and README.md");
    const real = runGit(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "README.md"), "# replay fixture\n");
    runGit(root, "add", "README.md");
    const tree = runGit(root, "write-tree");
    const fake = runGit(root, "commit-tree", tree, "-p", base, "-m", "fake: voice-b.md only");
    runGit(root, "replace", real, fake);
    // Ordinary (replace-honoring) Git is fooled: only voice-b.md appears to change.
    expect(runGit(root, "diff-tree", "-r", "--name-only", "--no-renames", base, real)).toBe("voice-b.md");
    const result = inspectSuccessorCommit(root, real, base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.changes.map((change) => change.path).sort();
      expect(paths).toEqual(["README.md", "voice-b.md"]);
    }
  });

  const gitmodules = (ignoreAll: boolean) =>
    '[submodule "lib"]\n\tpath = vendor/lib\n\turl = https://example.invalid/lib.git\n'
    + (ignoreAll ? "\tignore = all\n" : "");

  for (const variant of ["git config", "tracked .gitmodules", "excluded .gitmodules"] as const) {
    test(`reports a submodule pointer change even when ${variant} sets ignore = all`, () => {
      initializeBareRepository();
      runGit(root, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/lib`);
      if (variant !== "excluded .gitmodules") {
        // The git config variant still needs .gitmodules to map vendor/lib to "lib".
        writeFileSync(join(root, ".gitmodules"), gitmodules(variant === "tracked .gitmodules"));
        runGit(root, "add", ".gitmodules");
      }
      runGit(root, "commit", "-m", "base: a submodule pointer");
      const base = runGit(root, "rev-parse", "HEAD");
      if (variant === "git config") runGit(root, "config", "submodule.lib.ignore", "all");
      if (variant === "excluded .gitmodules") {
        writeFileSync(join(root, ".gitmodules"), gitmodules(true));
        appendFileSync(join(root, ".git", "info", "exclude"), ".gitmodules\n");
      }
      writeFileSync(join(root, "voice-b.md"), VOICE_B);
      runGit(root, "add", "voice-b.md");
      runGit(root, "update-index", "--cacheinfo", `160000,${"2".repeat(40)},vendor/lib`);
      runGit(root, "commit", "-m", "voice-b, and quietly a new submodule pointer");
      const head = runGit(root, "rev-parse", "HEAD");
      const result = inspectSuccessorCommit(root, head, base);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.changes).toContainEqual({ path: "vendor/lib", blob_sha256: null });
      }
    });
  }

  /** Base X, then W adds secret.env, then Y removes it and adds voice-b.md. */
  function twoCommitsAhead(): { base: string; middle: string; head: string } {
    initializeBareRepository();
    writeFileSync(join(root, "README.md"), "# replay fixture\n");
    runGit(root, "add", "README.md");
    runGit(root, "commit", "-m", "base");
    const base = runGit(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "secret.env"), "TOKEN=unreviewed\n");
    runGit(root, "add", "secret.env");
    runGit(root, "commit", "-m", "W: unreviewed");
    const middle = runGit(root, "rev-parse", "HEAD");
    runGit(root, "rm", "-q", "secret.env");
    writeFileSync(join(root, "voice-b.md"), VOICE_B);
    runGit(root, "add", "voice-b.md");
    runGit(root, "commit", "-m", "Y: voice-b");
    return { base, middle, head: runGit(root, "rev-parse", "HEAD") };
  }

  test("reads a commit's real parents, not a graft that skips an unreviewed commit", () => {
    const { base, head } = twoCommitsAhead();
    writeFileSync(join(root, ".git", "info", "grafts"), `${head} ${base}\n`);
    // Graft-honoring Git now believes Y follows X directly.
    expect(runGit(root, "rev-parse", `${head}^`)).toBe(base);
    const result = inspectSuccessorCommit(root, head, base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("more than one commit ahead");
  });

  test("reads a commit's real parents, not a tampered commit-graph", () => {
    const { base, head } = twoCommitsAhead();
    runGit(root, "commit-graph", "write", "--reachable");
    repointInCommitGraph(head, base);
    // Commit-graph-reading Git now believes Y follows X directly.
    expect(runGit(root, "rev-list", "--parents", "--max-count=1", head)).toBe(`${head} ${base}`);
    const result = inspectSuccessorCommit(root, head, base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("more than one commit ahead");
  });
});

function initializeBareRepository(): void {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Collab Test");
  runGit(root, "config", "user.email", "collab-test@example.invalid");
}

/** Rewrite commitSha's first parent in .git/objects/info/commit-graph (format v1, SHA-1). */
function repointInCommitGraph(commitSha: string, parentSha: string): void {
  const path = join(root, ".git", "objects", "info", "commit-graph");
  const graph = readFileSync(path);
  expect(graph.toString("ascii", 0, 4)).toBe("CGPH");
  const chunks = new Map<string, number>();
  for (let index = 0; index <= graph[6]!; index += 1) {
    const at = 8 + index * 12;
    chunks.set(graph.toString("ascii", at, at + 4), Number(graph.readBigUInt64BE(at + 4)));
  }
  const fanout = chunks.get("OIDF")!;
  const lookup = chunks.get("OIDL")!;
  const data = chunks.get("CDAT")!;
  const count = graph.readUInt32BE(fanout + 255 * 4);
  const position = (sha: string): number => {
    for (let index = 0; index < count; index += 1) {
      if (graph.toString("hex", lookup + index * 20, lookup + index * 20 + 20) === sha) return index;
    }
    throw new Error(`${sha} is not in the commit-graph`);
  };
  graph.writeUInt32BE(position(parentSha), data + position(commitSha) * 36 + 20);
  chmodSync(path, 0o644); // Git writes the commit-graph read-only.
  writeFileSync(path, graph);
}
