import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import {
  findNearestProjectProfile,
  loadProjectProfile,
  observationProvidersForProject,
  projectProfileSchema,
  readProjectProfile,
} from "../src/project-profile.js";
import { profile } from "./relay-fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-project-profile-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeProfile(directory: string, value: unknown = profile): string {
  const agenttool = join(directory, ".agenttool");
  mkdirSync(agenttool, { recursive: true });
  const path = join(agenttool, "project.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

describe("agenttool.project/1 profile", () => {
  test("loads the nearest explicit profile without consulting Git remotes", () => {
    const root = temporaryDirectory();
    const nested = join(root, "packages", "collab");
    mkdirSync(nested, { recursive: true });
    const path = writeProfile(root);
    mkdirSync(join(root, ".git"));
    writeFileSync(
      join(root, ".git", "config"),
      "[remote \"origin\"]\nurl = https://example.invalid/wrong/repo.git\n",
    );

    expect(findNearestProjectProfile(nested)).toBe(realpathSync(path));
    expect(loadProjectProfile({ cwd: nested, env: {} })).toEqual({
      path: realpathSync(path),
      profile,
    });
  });

  test("allows an explicit empty deployments object for non-deploying repos", () => {
    expect(projectProfileSchema.parse({
      ...profile,
      deployments: {},
    }).deployments).toEqual({});
  });

  test("requires stable deployment resource IDs and exact Vercel binding", () => {
    expect(() => projectProfileSchema.parse({
      ...profile,
      deployments: {
        preview: {
          provider: "vercel",
          environment: "production",
          resource_id: "another-project",
        },
      },
      vercel: {
        enabled: true,
        team_id: "team_agenttool",
        project_id: "agenttool-web",
      },
    })).toThrow();

    expect(projectProfileSchema.parse({
      ...profile,
      deployments: {
        preview: {
          provider: "vercel",
          environment: "production",
          resource_id: "agenttool-web",
        },
      },
      vercel: {
        enabled: true,
        team_id: "team_agenttool",
        project_id: "agenttool-web",
      },
    }).vercel.enabled).toBe(true);
  });

  test("derives one canonical enrollment provider policy from the profile", () => {
    expect(observationProvidersForProject(profile)).toEqual([
      "cloudflare-pages",
      "fly",
      "github",
      "npm",
    ]);
    expect(observationProvidersForProject({
      ...profile,
      deployments: {
        preview: {
          provider: "vercel",
          environment: "preview",
          resource_id: "agenttool-web",
        },
      },
      vercel: {
        enabled: true,
        team_id: "team_agenttool",
        project_id: "agenttool-web",
      },
    })).toEqual(["github", "npm", "vercel"]);
  });

  test("rejects unknown fields and inconsistent GitHub identity", () => {
    expect(() => projectProfileSchema.parse({
      ...profile,
      secret: "must-not-be-accepted",
    })).toThrow();
    expect(() => projectProfileSchema.parse({
      ...profile,
      repository: {
        ...profile.repository,
        key: "github:999",
      },
    })).toThrow();
    expect(() => projectProfileSchema.parse({
      ...profile,
      npm: {
        ...profile.npm!,
        workflow: "../publish-npm.yml",
      },
    })).toThrow();
    expect(() => projectProfileSchema.parse({
      ...profile,
      deployments: {
        api: {
          ...profile.deployments.api!,
          environment: "Production",
        },
      },
    })).toThrow();
  });

  test("rejects symlinked and oversized profile files", () => {
    const root = temporaryDirectory();
    const real = join(root, "real.json");
    writeFileSync(real, JSON.stringify(profile));
    const link = join(root, "project.json");
    symlinkSync(real, link);
    expectCollabCode(() => readProjectProfile(link), "project_profile_unsafe");

    const large = join(root, "large.json");
    writeFileSync(large, " ".repeat(64 * 1024 + 1));
    expectCollabCode(() => readProjectProfile(large), "project_profile_too_large");
  });

  test("uses an explicit environment path and fails when no profile exists", () => {
    const root = temporaryDirectory();
    const path = writeProfile(root);
    const elsewhere = temporaryDirectory();
    expect(loadProjectProfile({
      cwd: elsewhere,
      env: { AGENTOOL_COLLAB_PROJECT_FILE: path },
    }).path).toBe(path);

    expectCollabCode(
      () => loadProjectProfile({ cwd: elsewhere, env: {} }),
      "project_profile_not_found",
    );
  });
});

function expectCollabCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CollabError);
    expect((error as CollabError).code).toBe(code);
  }
}
