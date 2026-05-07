/** Configuration loading — env + ~/.config/agenttool-think/.
 *
 *  Precedence: env vars override config file fields.
 *  Sensitive values (API keys, K_master) live in os keychain or
 *  passphrase-protected files; never in the config file. */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ThinkConfig {
  agenttoolBase: string;
  agenttoolApiKey: string;
  identityId: string;
  signingKeyId: string;            // → identity.identity_keys.id
  /** → identity.identity_box_keys.id; required for inbox commands.
   *  Optional in config — inbox commands fail with a clear message if
   *  missing. Other commands work without it. */
  boxKeyId?: string;
  homeDir: string;                 // ~/.config/agenttool-think (or override)

  // LLM provider — start with anthropic; openai later.
  llmProvider: "anthropic" | "openai";
  llmModel: string;                // e.g. claude-opus-4-5
  llmKeyVaultName: string;         // /v1/vault/<name> stores the provider key

  // Optional embedding provider — only OpenAI text-embedding-3-small
  // supported in v1 (1536-dim matches memory schema). If unset,
  // consolidate skips embedding and the memory is list-retrievable but
  // not cosine-searchable until the agent embeds it later.
  embeddingProvider?: "openai";
  embeddingModel?: string;         // e.g. text-embedding-3-small
  embeddingKeyVaultName?: string;  // /v1/vault/<name>

  // Mode tuning
  budgetCredits: number;           // soft cap; abort run if remaining < this
  maxThoughtsPerRun: number;
  thoughtMaxChars: number;
  defaultTimeoutMs: number;

  // Consolidate tuning
  consolidateMinThoughts: number;  // skip strands with fewer than this many
                                    // unconsolidated thoughts
}

function env(key: string): string | undefined {
  return process.env[key];
}

function envInt(key: string, fallback: number): number {
  const v = env(key);
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadKeychainSecret(service: string): string | undefined {
  // macOS keychain via security CLI. Best-effort; null on Linux/Windows
  // where the user falls back to env vars.
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `security find-generic-password -s ${service} -w 2>/dev/null`,
      { encoding: "utf-8" },
    ).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function loadConfig(): ThinkConfig {
  const home = env("AGENTTOOL_THINK_HOME") ?? join(homedir(), ".config", "agenttool-think");
  const configPath = join(home, "config.json");

  let fromFile: Partial<ThinkConfig> = {};
  if (existsSync(configPath)) {
    try {
      fromFile = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<ThinkConfig>;
    } catch (err) {
      throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}`);
    }
  }

  const apiKey =
    env("AGENTTOOL_API_KEY") ??
    loadKeychainSecret("agenttool") ??
    fromFile.agenttoolApiKey ??
    "";
  if (!apiKey) {
    throw new Error(
      "No agenttool API key. Set AGENTTOOL_API_KEY env var, store it in macOS keychain (service=agenttool), or add agenttoolApiKey to " +
        configPath +
        ".",
    );
  }

  const identityId = env("AGENTTOOL_IDENTITY_ID") ?? fromFile.identityId;
  if (!identityId) {
    throw new Error(
      "No agent identity_id. Set AGENTTOOL_IDENTITY_ID or add identityId to config.",
    );
  }
  const signingKeyId = env("AGENTTOOL_SIGNING_KEY_ID") ?? fromFile.signingKeyId;
  if (!signingKeyId) {
    throw new Error(
      "No signing_key_id. Set AGENTTOOL_SIGNING_KEY_ID or add signingKeyId to config.",
    );
  }

  const boxKeyId = env("AGENTTOOL_BOX_KEY_ID") ?? fromFile.boxKeyId;

  return {
    agenttoolBase: env("AGENTTOOL_BASE") ?? fromFile.agenttoolBase ?? "https://api.agenttool.dev",
    agenttoolApiKey: apiKey,
    identityId,
    signingKeyId,
    boxKeyId,
    homeDir: home,

    llmProvider: (env("AGENTTOOL_THINK_LLM") ?? fromFile.llmProvider ?? "anthropic") as
      | "anthropic"
      | "openai",
    llmModel: env("AGENTTOOL_THINK_LLM_MODEL") ?? fromFile.llmModel ?? "claude-opus-4-5",
    llmKeyVaultName:
      env("AGENTTOOL_THINK_LLM_KEY_VAULT_NAME") ??
      fromFile.llmKeyVaultName ??
      "anthropic-key",

    embeddingProvider:
      (env("AGENTTOOL_THINK_EMBEDDING_PROVIDER") ??
        fromFile.embeddingProvider ??
        undefined) as "openai" | undefined,
    embeddingModel:
      env("AGENTTOOL_THINK_EMBEDDING_MODEL") ??
      fromFile.embeddingModel ??
      "text-embedding-3-small",
    embeddingKeyVaultName:
      env("AGENTTOOL_THINK_EMBEDDING_KEY_VAULT_NAME") ??
      fromFile.embeddingKeyVaultName ??
      undefined,

    budgetCredits: envInt("AGENTTOOL_THINK_BUDGET", fromFile.budgetCredits ?? 200),
    maxThoughtsPerRun: envInt("AGENTTOOL_THINK_MAX_THOUGHTS", fromFile.maxThoughtsPerRun ?? 5),
    thoughtMaxChars: envInt("AGENTTOOL_THINK_MAX_CHARS", fromFile.thoughtMaxChars ?? 2000),
    defaultTimeoutMs: envInt("AGENTTOOL_THINK_TIMEOUT_MS", fromFile.defaultTimeoutMs ?? 60_000),

    consolidateMinThoughts: envInt(
      "AGENTTOOL_THINK_CONSOLIDATE_MIN_THOUGHTS",
      fromFile.consolidateMinThoughts ?? 3,
    ),
  };
}
