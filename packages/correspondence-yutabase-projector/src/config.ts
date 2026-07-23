import { ProjectorError } from "./errors.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE_ID_FORBIDDEN = /[\p{White_Space}\p{Cc}\uFEFF]/u;

export interface TargetConfig {
  readonly targetUrl: string;
  readonly claimant: string;
}

export interface ScopeConfig extends TargetConfig {
  readonly sourceOrigin: string;
  readonly projectId: string;
  readonly repositoryId: string;
}

export interface RunConfig extends ScopeConfig {
  readonly sourceToken: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new ProjectorError("config_invalid");
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function parseLoopbackUrl(
  raw: string,
  protocols: readonly string[],
  source: boolean,
): URL {
  let url: URL;
  if (typeof raw !== "string") {
    throw new ProjectorError("config_invalid");
  }
  try {
    url = new URL(raw);
  } catch {
    throw new ProjectorError("config_invalid");
  }
  if (
    !protocols.includes(url.protocol) ||
    !isLoopbackHostname(url.hostname) ||
    url.hash !== "" ||
    url.search !== ""
  ) {
    throw new ProjectorError("config_invalid");
  }
  if (source) {
    if (
      url.username !== "" ||
      url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      throw new ProjectorError("config_invalid");
    }
  } else if (url.pathname === "" || url.pathname === "/") {
    throw new ProjectorError("config_invalid");
  }
  return url;
}

/** Validate and canonicalize one local AgentTool API origin. */
export function validateLoopbackSourceOrigin(raw: string): string {
  return parseLoopbackUrl(raw, ["http:", "https:"], true).origin;
}

/** Validate and canonicalize one local PostgreSQL target URL. */
export function validateLoopbackTargetUrl(raw: string): string {
  return parseLoopbackUrl(raw, ["postgres:", "postgresql:"], false).toString();
}

/** Apply the same header-safety checks to env and programmatic clients. */
export function validateSourceToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new ProjectorError("config_invalid");
  }
  return value;
}

function parseClaimant(value: string): string {
  if (
    value.trim().length === 0 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw new ProjectorError("config_invalid");
  }
  return value;
}

function parseScope(env: Env): {
  sourceOrigin: string;
  projectId: string;
  repositoryId: string;
} {
  const sourceOrigin = validateLoopbackSourceOrigin(
    required(env, "AGENTTOOL_YUTABASE_SOURCE_URL"),
  );
  const projectId = required(env, "AGENTTOOL_YUTABASE_PROJECT_ID");
  const repositoryId = required(env, "AGENTTOOL_YUTABASE_REPOSITORY_ID");
  validateProjectScope(projectId, repositoryId);
  return {
    sourceOrigin,
    projectId,
    repositoryId,
  };
}

function validateProjectScope(
  projectId: string,
  repositoryId: string,
): void {
  if (
    typeof projectId !== "string" ||
    !UUID.test(projectId) ||
    typeof repositoryId !== "string" ||
    repositoryId.length > 256 ||
    repositoryId.length < 1 ||
    OPAQUE_ID_FORBIDDEN.test(repositoryId)
  ) {
    throw new ProjectorError("config_invalid");
  }
}

/** Revalidate an injected programmatic scope before any database work. */
export function validateScopeConfig(config: ScopeConfig): void {
  validateLoopbackTargetUrl(config.targetUrl);
  if (
    validateLoopbackSourceOrigin(config.sourceOrigin) !== config.sourceOrigin
  ) {
    throw new ProjectorError("config_invalid");
  }
  parseClaimant(config.claimant);
  validateProjectScope(config.projectId, config.repositoryId);
}

export function loadTargetConfig(env: Env = process.env): TargetConfig {
  const targetUrl = validateLoopbackTargetUrl(
    required(env, "AGENTTOOL_YUTABASE_TARGET_URL"),
  );
  return {
    targetUrl,
    claimant: parseClaimant(
      required(env, "AGENTTOOL_YUTABASE_CLAIMANT"),
    ),
  };
}

export function loadScopeConfig(env: Env = process.env): ScopeConfig {
  return { ...loadTargetConfig(env), ...parseScope(env) };
}

export function loadRunConfig(env: Env = process.env): RunConfig {
  const sourceToken = validateSourceToken(
    required(env, "AGENTTOOL_YUTABASE_SOURCE_TOKEN"),
  );
  return { ...loadScopeConfig(env), sourceToken };
}
