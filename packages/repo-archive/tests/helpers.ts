import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSystemBlockStore } from "@agenttool/adds/fs";

import type { ArchiveZone } from "../src/index.js";

export const temporaryRoots: string[] = [];

export async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix));
  temporaryRoots.push(root);
  return root;
}

export async function cleanupTemporaryRoots(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export async function git(
  cwd: string,
  args: readonly string[],
  options: { allowExit?: readonly number[] } = {},
): Promise<string> {
  const child = Bun.spawn({
    cmd: [
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (!(options.allowExit ?? [0]).includes(exitCode)) {
    throw new Error(`git ${args[0] ?? "operation"} failed (${exitCode}): ${stderr.trim()}`);
  }
  return stdout;
}

export interface FixtureRepository {
  root: string;
  head: string;
}

export async function createFixtureRepository(
  options: {
    hookSentinel?: string;
    detachedExtraCommit?: boolean;
    objectFormat?: "sha1" | "sha256";
  } = {},
): Promise<FixtureRepository> {
  const parent = await temporaryRoot("agent-repo-archive-fixture-");
  const root = join(parent, "source");
  await mkdir(root, { mode: 0o700 });
  await git(root, [
    "init",
    "--quiet",
    `--object-format=${options.objectFormat ?? "sha1"}`,
    "--initial-branch=main",
  ]);
  await git(root, ["config", "user.name", "Archive Test"]);
  await git(root, ["config", "user.email", "archive@example.test"]);
  await writeFile(join(root, "README.md"), "recoverable source marker\n", { mode: 0o600 });
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "hello.ts"), "export const hello = 'world';\n", { mode: 0o600 });
  await writeFile(join(root, "src", "snow-雪.ts"), "export const snow = true;\n", { mode: 0o600 });

  if (options.hookSentinel !== undefined) {
    const hookDirectory = join(root, ".githooks");
    await mkdir(hookDirectory);
    const hookPath = join(hookDirectory, "post-checkout");
    await writeFile(
      hookPath,
      `#!/bin/sh\ntouch '${options.hookSentinel.replaceAll("'", "'\\''")}'\n`,
      { mode: 0o700 },
    );
    await chmod(hookPath, 0o700);
    await git(root, ["config", "core.hooksPath", ".githooks"]);
  }

  await git(root, ["add", "--all"]);
  await git(root, ["commit", "--quiet", "-m", "initial"]);
  await git(root, ["branch", "feature/archive"]);
  await git(root, ["tag", "-a", "v0.1-fixture", "-m", "fixture tag"]);
  await writeFile(join(root, "README.md"), "temporary stash state\n", { mode: 0o600 });
  await git(root, ["stash", "push", "--quiet", "-m", "fixture stash"]);

  if (options.detachedExtraCommit === true) {
    await git(root, ["checkout", "--quiet", "--detach"]);
    await writeFile(join(root, "detached.txt"), "detached-only commit\n", { mode: 0o600 });
    await git(root, ["add", "detached.txt"]);
    await git(root, ["commit", "--quiet", "-m", "detached-only"]);
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  return { root, head };
}

export async function createArchiveZones(
  root: string,
): Promise<Array<ArchiveZone & { storageRoot: string }>> {
  const results = [];
  for (const label of ["a", "b", "c"] as const) {
    const storageRoot = join(root, `zone-${label}`);
    await mkdir(storageRoot, { mode: 0o700 });
    results.push({
      storageRoot,
      descriptor: {
        zone_id: `zone-${label}`,
        transport: "filesystem" as const,
        locator: `file-zone:test-${label}`,
        assurance: "simulated" as const,
        delete_authority: "routine_writer" as const,
        failure_domain: {
          failure_domain_id: `test-domain-${label}`,
          provider: `test-provider-${label}`,
          account_root: `test-account-${label}`,
          region: `test-region-${label}`,
          credential_root: `test-credential-${label}`,
          media: `test-media-${label}`,
        },
      },
      store: new FileSystemBlockStore(storageRoot),
    });
  }
  return results;
}
