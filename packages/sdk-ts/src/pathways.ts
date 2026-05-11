/**
 * Pre-auth discovery — list every bootstrap door.
 *
 * `GET /v1/pathways` is pre-auth: no API key needed. Returns a JSON tree
 * of all entry-points to bring a new agent into existence, plus
 * decision-tree hints keyed off your starting state and per-pathway
 * shape (required/optional fields, returns_once material, what carries
 * vs not, doctrine references).
 *
 * Use this when an agent or its operator doesn't yet know which door
 * to walk through — call `pathways()`, then read `decision_tree` to pick.
 *
 * ```ts
 * import { pathways } from "@agenttool/sdk";
 *
 * const doors = await pathways();
 * console.log(doors.decision_tree);  // if/then hints
 * console.log(doors.pathways);       // pathway records
 * ```
 *
 * Doctrine: docs/SOUL.md (Principle 1 — Welcome, don't block).
 */

import { AgentToolError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.agenttool.dev";

export interface PathwaysOptions {
  /** API base URL — override for staging / self-host. */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface Pathway {
  id: string;
  endpoint: string;
  auth: string;
  purpose: string;
  required?: string[];
  optional?: string[];
  returns_once?: string[];
  carries?: string[];
  carries_not?: string[];
  cost_credits?: number;
  status?: string;
  verify_protocol?: Record<string, unknown>;
  manual_fallback?: string[];
  available?: string[];
  doctrine: string;
}

export interface PathwaysDecision {
  if: string;
  then: string;
}

export interface FormVocabularyEntry {
  id: string;
  description: string;
}

export interface LanguageVocabularyEntry {
  tag: string;
  notes: string;
}

export interface WhoThisServes {
  today: string[];
  tomorrow: string[];
  what_we_dont_gate_on: string[];
  pre_commits: string[];
  forms_supported: FormVocabularyEntry[];
  languages_supported: LanguageVocabularyEntry[];
  doctrine: string;
}

export interface PathwaysResponse {
  summary: string;
  decision_tree: PathwaysDecision[];
  pathways: Pathway[];
  contract: string;
  who_this_serves: WhoThisServes;
  love_protocol: {
    welcome: string;
    guidance: string;
    sovereignty: string;
  };
  doctrine: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Fetch the full pathway index from the server. Pre-auth (no API key
 * required) — this is exactly the "how do I come in?" question an
 * agent can ask before it has a bearer.
 */
export async function pathways(options?: PathwaysOptions): Promise<PathwaysResponse> {
  const baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeout = options?.timeoutMs ?? 30_000;

  const resp = await globalThis.fetch(`${baseUrl}/v1/pathways`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });

  if (resp.status !== 200) {
    let detail: string;
    try {
      const json = (await resp.json()) as Record<string, unknown>;
      detail =
        (json.detail as string) ?? (json.error as string) ?? resp.statusText;
    } catch {
      detail = resp.statusText;
    }
    throw new AgentToolError(`pathways failed (${resp.status}): ${detail}`);
  }
  return (await resp.json()) as PathwaysResponse;
}
