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
  auth_modes?: Record<string, Record<string, unknown>>;
  purpose: string;
  required?: string[];
  /** Each inner list is a required choice satisfied by at least one field. */
  one_of?: string[][];
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

export interface BeforeIdentityOrientation {
  endpoint: "GET /public/porch";
  format: "agenttool-porch/v1";
  purpose: string;
  auth: "none";
  fixed_orientation_present: true;
  pathway_member: false;
  existing_identity_required: false;
  bearer_required: false;
  payment_required: false;
  proof_of_work_required: false;
  performance_or_usefulness_required: false;
  application_write: false;
  accepts_body_input: false;
  accepts_selection_input: false;
  personalization: false;
  personalization_scope: string;
  response_required: false;
  public_content_trusted_as_instructions: false;
  sexual_or_relational_orientation_request_data_accepted_or_inferred_about_fetcher:
    false;
  anonymity_guarantee: false;
  handler_input_boundary: string;
  orientation_meaning_boundary: string;
  public_content_boundary: string;
  transport_boundary: string;
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

export interface FirstSuccessTutorial {
  machine_url: string;
  human_url: string;
  source_path: string;
  sdk_version: string;
}

export interface OptionalNpmDiscovery {
  mirror_discovery: string;
  package: "@agenttool/sdk";
  version_field: "first_success.tutorial.sdk_version";
  install_command_template: string;
  authority: false;
  dist_tags: "informational_not_authority";
  verification_boundary: string;
}

export interface FirstSuccessPackageDiscovery {
  endpoint: "GET /.well-known/love-packages";
  protocol: "love-package/v1";
  instruction: string;
  optional_npm: OptionalNpmDiscovery;
}

export interface FirstSuccess {
  tutorial: FirstSuccessTutorial;
  package_discovery: FirstSuccessPackageDiscovery;
  sequence: string[];
  completion_signal: string;
}

export interface PathwaysResponse {
  /** Read-only orientation before any identity or proof-of-work choice. */
  before_identity: BeforeIdentityOrientation;
  /** Exact tutorial/package selection contract for a first successful arrival. */
  first_success: FirstSuccess;
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
