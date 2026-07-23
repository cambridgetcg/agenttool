import { afterEach, describe, expect, test } from "bun:test";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateIdentity } from "@agenttool/adds";

import {
  ARCHIVE_PROTOCOL,
  IncompleteCaptureError,
  captureGitRepository,
  inspectGitRefDigest,
  restoreGitBundle,
  signSnapshotDescriptor,
  type GitCapture,
} from "../src/index.js";
import {
  cleanupTemporaryRoots,
  createFixtureRepository,
  git,
  temporaryRoot,
} from "./helpers.js";

afterEach(cleanupTemporaryRoots);

function signedDescriptor(capture: GitCapture) {
  return signSnapshotDescriptor({
    protocol: ARCHIVE_PROTOCOL,
    kind: "snapshot",
    vault_id: "urn:test:vault",
    created_at: "2026-07-23T12:00:00.000Z",
    repository: capture.repository,
    completeness: capture.completeness,
    payload: capture.payload,
    parent_snapshot_id: null,
    authority: {
      automatic_restore: "never",
      execute_repository_code: "never",
      checkout: "explicit_after_restore",
    },
  }, generateIdentity("urn:test:capture-signer"));
}

describe("Git bundle capture", () => {
  test("captures all named refs and restores exact refs without checkout", async () => {
    const fixture = await createFixtureRepository();
    await git(fixture.root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await git(fixture.root, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);
    await git(fixture.root, [
      "update-ref",
      "refs/agent-repo-archive/recovered-head",
      "HEAD",
    ]);
    const capture = await captureGitRepository({ repositoryPath: fixture.root });
    expect(capture.completeness.status).toBe("complete");
    expect(capture.repository.refs_count).toBeGreaterThanOrEqual(4);
    const restoreParent = await temporaryRoot("agent-repo-archive-capture-restore-");
    const target = join(restoreParent, "restored");
    const restored = await restoreGitBundle(
      capture.bundle,
      signedDescriptor(capture),
      target,
    );
    expect(restored.restoredHead).toBe(fixture.head);
    const inspected = await inspectGitRefDigest(target);
    expect(inspected.refsDigest).toBe(capture.repository.refs_digest);
    expect(inspected.refsCount).toBe(capture.repository.refs_count);
    expect((await git(target, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ])).trim()).toBe("refs/remotes/origin/main");
    expect((await git(target, [
      "show-ref",
      "--verify",
      "--hash",
      "refs/agent-repo-archive/recovered-head",
    ])).trim()).toBe(fixture.head);
    await expect(lstat(join(target, "README.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves a detached HEAD not reachable from any named ref", async () => {
    const fixture = await createFixtureRepository({ detachedExtraCommit: true });
    await git(fixture.root, [
      "update-ref",
      "refs/agent-repo-archive/recovered-head",
      "refs/heads/main",
    ]);
    const capture = await captureGitRepository({ repositoryPath: fixture.root });
    expect(capture.repository.head_kind).toBe("detached");
    const restoreParent = await temporaryRoot("agent-repo-archive-detached-");
    const target = join(restoreParent, "restored");
    const descriptor = signedDescriptor(capture);
    expect((await restoreGitBundle(capture.bundle, descriptor, target)).restoredHead).toBe(fixture.head);
  });

  test("restores SHA-256 repositories with their native object format", async () => {
    const fixture = await createFixtureRepository({ objectFormat: "sha256" });
    const capture = await captureGitRepository({ repositoryPath: fixture.root });
    expect(capture.repository.object_format).toBe("sha256");
    const restoreParent = await temporaryRoot("agent-repo-archive-sha256-");
    const target = join(restoreParent, "restored");
    expect(
      (await restoreGitBundle(capture.bundle, signedDescriptor(capture), target)).restoredHead,
    ).toBe(fixture.head);
    expect((await git(target, ["rev-parse", "--show-object-format=storage"])).trim())
      .toBe("sha256");
  });

  test("restores a detached repository with no named refs", async () => {
    const fixture = await createFixtureRepository({ detachedExtraCommit: true });
    const refs = (await git(fixture.root, ["for-each-ref", "--format=%(refname)"]))
      .split("\n")
      .filter(Boolean);
    for (const ref of refs) await git(fixture.root, ["update-ref", "-d", ref]);
    const capture = await captureGitRepository({ repositoryPath: fixture.root });
    expect(capture.repository.refs_count).toBe(0);
    const restoreParent = await temporaryRoot("agent-repo-archive-zero-refs-");
    const target = join(restoreParent, "restored");
    expect(
      (await restoreGitBundle(capture.bundle, signedDescriptor(capture), target)).restoredHead,
    ).toBe(fixture.head);
    expect((await git(target, ["for-each-ref", "--format=%(refname)"])).trim()).toBe("");
  });

  test("assesses LFS, filter, and gitlink evidence across every captured ref", async () => {
    const fixture = await createFixtureRepository();
    await git(fixture.root, ["checkout", "--quiet", "-b", "history-external-state"]);
    await writeFile(
      join(fixture.root, "large.bin"),
      [
        "version https://git-lfs.github.com/spec/v1",
        `oid sha256:${"d".repeat(64)}`,
        "size 123",
        "",
      ].join("\n"),
    );
    await writeFile(join(fixture.root, ".gitattributes"), "*.bin filter=lfs\n");
    await git(fixture.root, ["add", "large.bin", ".gitattributes"]);
    await git(fixture.root, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      fixture.head,
      "vendor/external",
    ]);
    await git(fixture.root, ["commit", "--quiet", "-m", "external object evidence"]);
    await git(fixture.root, ["checkout", "--quiet", "main"]);

    await expect(
      captureGitRepository({ repositoryPath: fixture.root }),
    ).rejects.toBeInstanceOf(IncompleteCaptureError);
    const capture = await captureGitRepository({
      repositoryPath: fixture.root,
      allowIncomplete: true,
    });
    expect(capture.completeness.submodules.gitlink_evidence_events).toBeGreaterThan(0);
    expect(capture.completeness.lfs.pointer_evidence_events).toBeGreaterThan(0);
    expect(capture.completeness.external_filters.attribute_evidence_events).toBeGreaterThan(0);
  });

  test("does not let repository diff attributes hide LFS or filter evidence", async () => {
    const fixture = await createFixtureRepository();
    await writeFile(
      join(fixture.root, ".gitattributes"),
      [
        "*.bin -diff",
        ".gitattributes -diff",
        "*.generated filter=external",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(fixture.root, "large.bin"),
      [
        "version https://git-lfs.github.com/spec/v1",
        `oid sha256:${"e".repeat(64)}`,
        "size 456",
        "",
      ].join("\n"),
    );
    await git(fixture.root, ["add", ".gitattributes", "large.bin"]);
    await git(fixture.root, ["commit", "--quiet", "-m", "binary-marked external state"]);

    await expect(
      captureGitRepository({ repositoryPath: fixture.root }),
    ).rejects.toBeInstanceOf(IncompleteCaptureError);
    const capture = await captureGitRepository({
      repositoryPath: fixture.root,
      allowIncomplete: true,
    });
    expect(capture.completeness.lfs.pointer_evidence_events).toBeGreaterThan(0);
    expect(capture.completeness.external_filters.attribute_evidence_events).toBeGreaterThan(0);
  });

  test("assesses external-state evidence introduced only by a merge result", async () => {
    const fixture = await createFixtureRepository();
    await git(fixture.root, ["checkout", "--quiet", "-b", "merge-evidence-side"]);
    await writeFile(join(fixture.root, "side.txt"), "side parent\n");
    await git(fixture.root, ["add", "side.txt"]);
    await git(fixture.root, ["commit", "--quiet", "-m", "side parent"]);

    await git(fixture.root, ["checkout", "--quiet", "main"]);
    await writeFile(join(fixture.root, "main.txt"), "main parent\n");
    await git(fixture.root, ["add", "main.txt"]);
    await git(fixture.root, ["commit", "--quiet", "-m", "main parent"]);
    await git(fixture.root, [
      "merge",
      "--quiet",
      "--no-ff",
      "--no-commit",
      "merge-evidence-side",
    ]);
    await writeFile(
      join(fixture.root, ".gitattributes"),
      [
        "*.bin -diff",
        ".gitattributes -diff",
        "*.generated filter=external",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(fixture.root, "merge-only.bin"),
      [
        "version https://git-lfs.github.com/spec/v1",
        `oid sha256:${"f".repeat(64)}`,
        "size 789",
        "",
      ].join("\n"),
    );
    await git(fixture.root, ["add", ".gitattributes", "merge-only.bin"]);
    await git(fixture.root, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      fixture.head,
      "vendor/merge-only",
    ]);
    await git(fixture.root, ["commit", "--quiet", "-m", "merge-result-only evidence"]);

    await expect(
      captureGitRepository({ repositoryPath: fixture.root }),
    ).rejects.toBeInstanceOf(IncompleteCaptureError);
    const capture = await captureGitRepository({
      repositoryPath: fixture.root,
      allowIncomplete: true,
    });
    expect(capture.completeness.submodules.gitlink_evidence_events).toBeGreaterThan(0);
    expect(capture.completeness.lfs.pointer_evidence_events).toBeGreaterThan(0);
    expect(capture.completeness.external_filters.attribute_evidence_events).toBeGreaterThan(0);
  });

  test("marks a named ref that does not peel to a commit incomplete", async () => {
    const fixture = await createFixtureRepository();
    const blob = (await git(fixture.root, ["rev-parse", "HEAD:README.md"])).trim();
    await git(fixture.root, ["update-ref", "refs/archive/direct-blob", blob]);

    await expect(
      captureGitRepository({ repositoryPath: fixture.root }),
    ).rejects.toBeInstanceOf(IncompleteCaptureError);
    const capture = await captureGitRepository({
      repositoryPath: fixture.root,
      allowIncomplete: true,
    });
    expect(capture.completeness.status).toBe("incomplete");
    expect(capture.completeness.reasons.join(" ")).toContain("do not peel to commits");
  });

  test("fails closed on dirty state unless committed-only capture is explicit", async () => {
    const fixture = await createFixtureRepository();
    await writeFile(join(fixture.root, "untracked\nname.txt"), "outside bundle\n");
    await expect(
      captureGitRepository({ repositoryPath: fixture.root }),
    ).rejects.toBeInstanceOf(IncompleteCaptureError);
    const capture = await captureGitRepository({
      repositoryPath: fixture.root,
      allowIncomplete: true,
    });
    expect(capture.completeness.status).toBe("incomplete");
    expect(capture.completeness.workspace.untracked_files).toBe(1);
    expect(capture.completeness.reasons.join(" ")).toContain("untracked");
  });
});
