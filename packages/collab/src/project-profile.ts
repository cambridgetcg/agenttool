import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { CollabError } from "./errors.js";

export const PROJECT_PROFILE_SCHEMA = "agenttool.project/1" as const;
export const PROJECT_PROFILE_ENV = "AGENTOOL_COLLAB_PROJECT_FILE" as const;
const MAX_PROFILE_BYTES = 64 * 1024;

const safeIdentifier = z.string().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const deploymentEnvironment = z.string().min(1).max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const projectId = z.string().min(1).max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const repositoryKey = z.string().min(3).max(256)
  .regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const displayName = z.string().min(1).max(256)
  .refine((value) => !hasControlCharacter(value), "must not contain control characters");
const boundedString = z.string().min(1).max(300)
  .refine((value) => !hasControlCharacter(value), "must not contain control characters");
const packageName = z.string().min(1).max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
const releaseKey = z.string().min(1).max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const repositoryRelativePathPattern =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const repositoryRelativePath = z.string().min(1).max(500)
  .regex(repositoryRelativePathPattern);

const repositorySchema = z.object({
  key: repositoryKey,
  provider: z.enum(["github", "git", "other"]),
  provider_repository_id: safeIdentifier,
  display_name: displayName,
}).strict();

const githubSchema = z.object({
  release_branch: safeIdentifier,
  required_checks: z.array(boundedString).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.required_checks).size !== value.required_checks.length) {
    context.addIssue({
      code: "custom",
      path: ["required_checks"],
      message: "required checks must be unique",
    });
  }
});

const npmPackageSchema = z.object({
  tag_prefix: z.string().min(1).max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  release_key: releaseKey,
  path: repositoryRelativePath,
}).strict();

const npmSchema = z.object({
  workflow: z.string().min(1).max(200)
    .regex(repositoryRelativePathPattern)
    .regex(/\.ya?ml$/),
  packages: z.record(packageName, npmPackageSchema),
}).strict().superRefine((value, context) => {
  const count = Object.keys(value.packages).length;
  if (count < 1 || count > 100) {
    context.addIssue({
      code: "custom",
      path: ["packages"],
      message: "npm packages must contain between 1 and 100 entries",
    });
  }
});

const deploymentSchema = z.object({
  provider: z.enum([
    "fly",
    "cloudflare-pages",
    "vercel",
  ]),
  environment: deploymentEnvironment,
  resource_id: safeIdentifier,
}).strict();

const deploymentsSchema = z.record(
  z.string().min(1).max(100).regex(/^[a-z][a-z0-9._-]*$/),
  deploymentSchema,
).superRefine((value, context) => {
  const count = Object.keys(value).length;
  if (count > 100) {
    context.addIssue({
      code: "custom",
      message: "deployments must contain no more than 100 entries",
    });
  }
});

const vercelSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({
    enabled: z.literal(true),
    team_id: safeIdentifier,
    project_id: safeIdentifier,
  }).strict(),
]);

export const projectProfileSchema = z.object({
  $schema: z.string().min(1).max(1000)
    .refine((value) => !hasControlCharacter(value), "must not contain control characters")
    .optional(),
  schema: z.literal(PROJECT_PROFILE_SCHEMA),
  project_id: projectId,
  repository: repositorySchema,
  github: githubSchema.optional(),
  npm: npmSchema.optional(),
  deployments: deploymentsSchema,
  vercel: vercelSchema,
}).strict().superRefine((value, context) => {
  if (value.repository.provider === "github") {
    if (!/^[1-9][0-9]*$/.test(value.repository.provider_repository_id)) {
      context.addIssue({
        code: "custom",
        path: ["repository", "provider_repository_id"],
        message: "GitHub repository identity must be the numeric repository ID",
      });
    }
    if (
      value.repository.key
      !== `github:${value.repository.provider_repository_id}`
    ) {
      context.addIssue({
        code: "custom",
        path: ["repository", "key"],
        message: "GitHub repository key must be github:<numeric repository ID>",
      });
    }
    if (!value.github) {
      context.addIssue({
        code: "custom",
        path: ["github"],
        message: "GitHub repositories require release branch and required checks",
      });
    }
  }
  const hasVercelDeployment = Object.values(value.deployments)
    .some((deployment) => deployment.provider === "vercel");
  if (hasVercelDeployment !== value.vercel.enabled) {
    context.addIssue({
      code: "custom",
      path: ["vercel"],
      message:
        "Vercel deployment surfaces require enabled binding, and disabled projects must not declare Vercel surfaces",
    });
  }
  if (value.vercel.enabled) {
    for (const [surface, deployment] of Object.entries(value.deployments)) {
      if (
        deployment.provider === "vercel"
        && deployment.resource_id !== value.vercel.project_id
      ) {
        context.addIssue({
          code: "custom",
          path: ["deployments", surface, "resource_id"],
          message: "Vercel deployment resource IDs must match the enabled project binding",
        });
      }
    }
  }
});

export type ProjectProfile = z.infer<typeof projectProfileSchema>;
export type ProjectObservationProvider =
  | "github"
  | "npm"
  | "fly"
  | "cloudflare-pages"
  | "vercel";

export function observationProvidersForProject(
  input: ProjectProfile,
): ProjectObservationProvider[] {
  const profile = validateProjectProfile(input);
  const providers = new Set<ProjectObservationProvider>();
  if (profile.repository.provider === "github") providers.add("github");
  if (profile.npm) providers.add("npm");
  for (const deployment of Object.values(profile.deployments)) {
    providers.add(deployment.provider);
  }
  return [...providers].sort();
}

export interface LoadedProjectProfile {
  path: string;
  profile: ProjectProfile;
}

export interface LoadProjectProfileOptions {
  path?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export function loadProjectProfile(
  options: LoadProjectProfileOptions = {},
): LoadedProjectProfile {
  const cwd = resolve(options.cwd ?? process.cwd());
  const environment = options.env ?? process.env;
  const environmentPath = environment[PROJECT_PROFILE_ENV];
  const requested = options.path ?? environmentPath;
  const path = requested
    ? resolveExplicitProfilePath(requested, cwd)
    : findNearestProjectProfile(cwd);
  if (!path) {
    throw new CollabError(
      "project_profile_not_found",
      `No ${PROJECT_PROFILE_SCHEMA} profile was provided or found in a parent .agenttool directory`,
      { environment_variable: PROJECT_PROFILE_ENV },
    );
  }
  return { path, profile: readProjectProfile(path) };
}

export function readProjectProfile(pathInput: string): ProjectProfile {
  const path = resolve(pathInput);
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CollabError(
        "project_profile_unsafe",
        "Project profile must be a regular non-symlink file",
      );
    }
    if (metadata.size > MAX_PROFILE_BYTES) {
      throw new CollabError(
        "project_profile_too_large",
        `Project profile exceeds ${MAX_PROFILE_BYTES} bytes`,
      );
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return validateProjectProfile(parsed);
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "project_profile_read_failed",
      "Could not read or parse the project profile",
    );
  }
}

export function validateProjectProfile(input: unknown): ProjectProfile {
  const result = projectProfileSchema.safeParse(input);
  if (!result.success) {
    throw new CollabError(
      "project_profile_invalid",
      "Project profile does not match agenttool.project/1",
      { issues: boundedIssues(result.error.issues) },
    );
  }
  return result.data;
}

export function findNearestProjectProfile(startInput: string): string | null {
  let current = realDirectory(startInput);
  const filesystemRoot = parse(current).root;
  while (true) {
    const candidate = join(current, ".agenttool", "project.json");
    if (existsSync(candidate)) return candidate;
    if (current === filesystemRoot) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveExplicitProfilePath(value: string, cwd: string): string {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacter(trimmed)) {
    throw new CollabError(
      "project_profile_path_invalid",
      "Project profile path must be non-empty and contain no control characters",
    );
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function realDirectory(pathInput: string): string {
  const path = resolve(pathInput);
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      throw new CollabError(
        "project_profile_start_invalid",
        "Project profile discovery must start from a directory",
      );
    }
    return realpathSync(path);
  } catch (error) {
    if (error instanceof CollabError) throw error;
    throw new CollabError(
      "project_profile_start_invalid",
      "Project profile discovery directory is unavailable",
    );
  }
}

function boundedIssues(issues: z.core.$ZodIssue[]): Array<{
  path: string;
  message: string;
}> {
  return issues.slice(0, 20).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message.slice(0, 300),
  }));
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
