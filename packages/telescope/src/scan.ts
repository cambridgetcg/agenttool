import {
  DEFAULT_LIMITS,
  REPORT_SCHEMA,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.js";
import { TargetInputError } from "./errors.js";
import { buildLoveActions, buildNpmAction } from "./plans.js";
import { parseAgentTxt, type ParsedAgentTxt } from "./parsers/agent-txt.js";
import { parseApiCatalog } from "./parsers/api-catalog.js";
import { parseA2aCard, parseMcpCard } from "./parsers/cards.js";
import {
  AGENTTOOL_API_CATALOG_URL,
  AGENTTOOL_DISCOVERY_URL,
  parseAgenttoolDiscovery,
} from "./parsers/discovery.js";
import { parseRootLinkHeader } from "./parsers/link-header.js";
import {
  parseLoveDiscovery,
  parseLoveManifest,
  selectLoveManifest,
  type ParsedLoveDiscovery,
  type ParsedLoveManifest,
} from "./parsers/love.js";
import { parsePathways, type ParsedPathways } from "./parsers/pathways.js";
import {
  normalizeTarget,
  assertPublicHttpsUrl,
  defaultResolveHostname,
} from "./target.js";
import {
  fetchDocument,
  ScanBudget,
} from "./transport.js";
import type {
  DiscoveryAdapter,
  ExtensionObservation,
  FetchLike,
  ObservationState,
  ProbeId,
  SourceObservation,
  SurfaceObservation,
  TelescopeClaim,
  TelescopeDiagnostic,
  TelescopeLimits,
  TelescopeOptions,
  TelescopeReport,
} from "./types.js";

const JSON_ACCEPT = "application/json, application/*+json;q=0.9";
const AGENT_TXT_ACCEPT = "text/agent, text/plain;q=0.9";
const ROOT_ACCEPT =
  "application/json, application/*+json;q=0.9, text/html;q=0.8";

const DIAGNOSTIC_MESSAGES: Readonly<Record<string, string>> = {
  unexpected_media_type:
    "A response used a media type Telescope will not parse for this surface.",
  invalid_utf8: "A discovery document was not valid UTF-8.",
  invalid_json: "A discovery document was not valid JSON.",
  json_complexity_limit:
    "A JSON document exceeded the configured structural limit.",
  root_links_invalid:
    "The root Link header was outside Telescope's bounded supported shape.",
  root_links_missing_discovery:
    "The root Link header did not name AgentTool's canonical discovery compass.",
  discovery_invalid_format:
    "The discovery document did not identify the agenttool-discovery/v1 profile.",
  discovery_invalid_roads:
    "The discovery document did not contain exactly three roads.",
  discovery_invalid_road_identity:
    "The discovery roads were not ordered understand, inspect, then choose.",
  discovery_invalid_road_contract:
    "A discovery road did not match the fixed read-only first-contact contract.",
  discovery_invalid_cost:
    "A discovery road did not state zero AgentTool charge and zero proof of work.",
  discovery_invalid_retry_boundary:
    "A discovery road did not state caller-chosen finite retry with no AgentTool automatic retry.",
  discovery_invalid_exit:
    "A discovery road did not state that stopping, silence, and leaving are complete.",
  api_catalog_invalid_linkset:
    "The API catalog was not a bounded JSON Linkset.",
  api_catalog_invalid_context:
    "The API catalog contained an invalid link context.",
  api_catalog_invalid_relation:
    "The API catalog contained an invalid relation target.",
  api_catalog_duplicate_canonical_context:
    "The API catalog repeated its canonical membership context.",
  api_catalog_missing_canonical_context:
    "The API catalog did not contain AgentTool's canonical membership context.",
  api_catalog_discovery_not_advertised:
    "The API catalog did not link back to AgentTool's canonical discovery compass.",
  agent_txt_duplicate_key:
    "agent.txt repeated a key; entries were preserved and selected duplicates were not guessed.",
  agent_txt_malformed_line: "agent.txt contained a malformed non-comment line.",
  love_index_latest_ignored:
    "The LOVE index latest field was ignored for release selection.",
  mcp_locator_invalid:
    "The advertised MCP card locator is not an absolute HTTPS URL within the URL policy.",
  love_index_locator_invalid:
    "The LOVE index locator is not an absolute HTTPS URL within the URL policy.",
  love_manifest_locator_invalid:
    "The selected LOVE manifest locator is not an absolute HTTPS URL within the URL policy.",
  love_index_unavailable:
    "The advertised LOVE index could not be read, so the selected release chain is incomplete.",
  love_manifest_unavailable:
    "The selected LOVE manifest could not be read, so the selected release chain is incomplete.",
  love_no_safe_mirror:
    "No manifest mirror passed the public-HTTPS DNS preflight, so no download plan was produced.",
  npm_authority_not_false:
    "The optional npm path was not explicitly declared non-authoritative, so no npm action was produced.",
  agent_txt_pathways_conflict:
    "agent.txt advertises a Pathways locator different from the fixed origin probe.",
  agent_txt_love_conflict:
    "agent.txt advertises a LOVE locator different from the fixed well-known probe.",
  advertised_mcp_not_found:
    "agent.txt advertised an MCP card, but the observed locator returned not found.",
  adapter_failed:
    "An explicitly supplied discovery adapter failed in isolation.",
  unsafe_remote_locator_omitted:
    "A remote locator was omitted because it contained credentials, query data, or left the bounded HTTPS locator shape.",
};

function diagnostic(
  code: string,
  evidenceId: ProbeId | null,
  level: TelescopeDiagnostic["level"] = "warning",
): TelescopeDiagnostic {
  return {
    code,
    level,
    message:
      DIAGNOSTIC_MESSAGES[code] ??
      "The observation was rejected or qualified by a local Telescope boundary.",
    evidence_id: evidenceId,
  };
}

function claim(
  input: Omit<TelescopeClaim, "taint"> & { taint?: TelescopeClaim["taint"] },
): TelescopeClaim {
  return { ...input, taint: input.taint ?? "remote_untrusted" };
}

function sourceState(state: SourceObservation["state"]): ObservationState {
  return state;
}

function isJsonMediaType(value: string | null): boolean {
  return value === "application/json" || Boolean(value?.endsWith("+json"));
}

function isAgentTxtMediaType(value: string | null): boolean {
  return value === "text/plain" || value === "text/agent";
}

function canonicalHttpsLocator(value: string): string | null {
  if (value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    url.port = "";
    return url.href.length <= 2_048 ? url.href : null;
  } catch {
    return null;
  }
}

function reportLocator(
  value: string,
  preserveExactDidTemplate = false,
): string | null {
  if (value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const marker = "{exact-DID}";
  const parseValue = preserveExactDidTemplate
    ? value.replace(marker, "did:example:placeholder")
    : value;
  if (preserveExactDidTemplate && !value.includes(marker)) return null;
  try {
    const url = new URL(parseValue);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    if (preserveExactDidTemplate) {
      const parameters = [...url.searchParams.entries()];
      if (
        parameters.length !== 1 ||
        parameters[0]?.[0] !== "resource" ||
        parameters[0]?.[1] !== "did:example:placeholder"
      ) {
        return null;
      }
      return value;
    }
    url.port = "";
    if (url.search) return null;
    return url.href.length <= 2_048 ? url.href : null;
  } catch {
    return null;
  }
}

function mergeLimits(
  partial: Partial<TelescopeLimits> | undefined,
): TelescopeLimits {
  const limits: TelescopeLimits = { ...DEFAULT_LIMITS, ...partial };
  const integerFields = Object.entries(limits) as Array<
    [keyof TelescopeLimits, number]
  >;
  if (integerFields.some(([, value]) => !Number.isSafeInteger(value))) {
    throw new TargetInputError(
      "invalid_limits",
      "Every Telescope limit must be an integer.",
    );
  }
  if (
    limits.timeout_ms < 100 ||
    limits.timeout_ms > 120_000 ||
    limits.max_response_bytes < 1_024 ||
    limits.max_response_bytes > 4 * 1024 * 1024 ||
    limits.max_total_bytes < limits.max_response_bytes ||
    limits.max_total_bytes > 16 * 1024 * 1024 ||
    limits.max_redirects < 0 ||
    limits.max_redirects > 8 ||
    limits.max_requests < 4 ||
    limits.max_requests > 64 ||
    limits.max_agent_txt_lines < 16 ||
    limits.max_agent_txt_lines > 4_096 ||
    limits.max_agent_txt_line_bytes < 256 ||
    limits.max_agent_txt_line_bytes > 16_384 ||
    limits.max_json_depth < 4 ||
    limits.max_json_depth > 64 ||
    limits.max_json_nodes < 100 ||
    limits.max_json_nodes > 100_000
  ) {
    throw new TargetInputError(
      "invalid_limits",
      "One or more Telescope limits are outside supported bounds.",
    );
  }
  return limits;
}

function createDeadline(
  timeoutMs: number,
  parent: AbortSignal | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function probeUrl(origin: string, path: string): string {
  return new URL(path, `${origin}/`).href;
}

function parserWarnings(
  warnings: readonly string[],
  evidenceId: ProbeId,
  diagnostics: TelescopeDiagnostic[],
): void {
  for (const code of [...new Set(warnings)]) {
    if (code === "love_index_latest_ignored") continue;
    diagnostics.push(diagnostic(code, evidenceId));
  }
}

function parseUnavailableSurface(
  id: SurfaceObservation["id"],
  source: SourceObservation,
  boundaryCodes: string[],
): SurfaceObservation {
  return {
    id,
    state: sourceState(source.state),
    schema_conformance: source.state === "present" ? "invalid" : "not_assessed",
    evidence_ids: [source.id],
    claims: [],
    boundary_codes: boundaryCodes,
    diagnostic_codes: source.error_code ? [source.error_code] : [],
  };
}

function addTransportDiagnostic(
  source: SourceObservation,
  diagnostics: TelescopeDiagnostic[],
): void {
  if (source.error_code) {
    diagnostics.push(diagnostic(source.error_code, source.id, "error"));
  }
}

function validateAdapters(adapters: readonly DiscoveryAdapter[]): void {
  if (adapters.length > 30) {
    throw new TargetInputError(
      "adapter_limit",
      "At most 30 caller-owned adapters may be supplied to one scan.",
    );
  }
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(adapter.id) || seen.has(adapter.id)) {
      throw new TargetInputError(
        "invalid_adapter",
        "Adapter IDs must be unique lowercase identifiers.",
      );
    }
    seen.add(adapter.id);
  }
}

async function runAdapters(
  adapters: readonly DiscoveryAdapter[],
  context: Parameters<DiscoveryAdapter["discover"]>[0],
  diagnostics: TelescopeDiagnostic[],
): Promise<ExtensionObservation[]> {
  const normalizeResult = (
    id: string,
    value: ExtensionObservation,
  ): ExtensionObservation => {
    const states = new Set<ExtensionObservation["state"]>([
      "not_configured",
      "present",
      "absent",
      "invalid",
      "error",
    ]);
    if (
      !states.has(value.state) ||
      typeof value.summary !== "string" ||
      value.summary.length > 4_096 ||
      typeof value.facts !== "object" ||
      value.facts === null ||
      Array.isArray(value.facts)
    ) {
      return {
        id,
        state: "invalid",
        summary: "The caller-owned adapter returned an invalid bounded result.",
        facts: {},
      };
    }
    const entries = Object.entries(value.facts);
    if (
      entries.length > 128 ||
      entries.some(
        ([key, fact]) =>
          key.length === 0 ||
          key.length > 128 ||
          !(
            fact === null ||
            typeof fact === "boolean" ||
            typeof fact === "number" ||
            (typeof fact === "string" && fact.length <= 4_096)
          ) ||
          (typeof fact === "number" && !Number.isFinite(fact)),
      )
    ) {
      return {
        id,
        state: "invalid",
        summary:
          "The caller-owned adapter returned invalid or oversized facts.",
        facts: {},
      };
    }
    return {
      id,
      state: value.state,
      summary: value.summary,
      facts: Object.fromEntries(entries) as Readonly<
        Record<string, string | number | boolean | null>
      >,
    };
  };
  const seen = new Set(adapters.map((adapter) => adapter.id));
  const results = await Promise.all(
    adapters.map(async (adapter): Promise<ExtensionObservation> => {
      try {
        if (context.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const operation = adapter.discover(context);
        const result = await new Promise<ExtensionObservation>(
          (resolve, reject) => {
            const onAbort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            context.signal.addEventListener("abort", onAbort, { once: true });
            operation.then(
              (value) => {
                context.signal.removeEventListener("abort", onAbort);
                resolve(value);
              },
              (error: unknown) => {
                context.signal.removeEventListener("abort", onAbort);
                reject(error);
              },
            );
          },
        );
        return normalizeResult(adapter.id, result);
      } catch {
        diagnostics.push(diagnostic("adapter_failed", null));
        return {
          id: adapter.id,
          state: "error",
          summary:
            "The caller-owned adapter failed; core HTTPS observations remain available.",
          facts: {},
        };
      }
    }),
  );

  for (const id of ["dns_aid", "pkarr"] as const) {
    if (!seen.has(id)) {
      results.push({
        id,
        state: "not_configured",
        summary:
          id === "dns_aid"
            ? "DNS-AID is an opt-in adapter seam; core does not claim DNSSEC validation."
            : "PKARR is an opt-in adapter seam; core does not contact default public relays.",
        facts: {},
      });
    }
  }
  return results.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

export async function inspectTarget(
  input: string,
  options: TelescopeOptions = {},
): Promise<TelescopeReport> {
  const subject = normalizeTarget(input);
  const limits = mergeLimits(options.limits);
  const adapters = options.adapters ?? [];
  validateAdapters(adapters);
  const observedAt = (options.clock ?? (() => new Date()))().toISOString();
  const fetchImpl: FetchLike =
    options.fetch ?? globalThis.fetch.bind(globalThis);
  const resolveHostname = options.resolve_hostname ?? defaultResolveHostname;
  const budget = new ScanBudget(limits);
  const deadline = createDeadline(limits.timeout_ms, options.signal);
  const sources: SourceObservation[] = [];
  const surfaces: SurfaceObservation[] = [];
  const diagnostics: TelescopeDiagnostic[] = [];
  const actions = [] as TelescopeReport["actions"];

  const get = (id: ProbeId, url: string, accept: string) =>
    fetchDocument({
      id,
      url,
      accept,
      fetch: fetchImpl,
      resolve_hostname: resolveHostname,
      budget,
      limits,
      signal: deadline.signal,
    });

  try {
    const [
      rootDocument,
      discoveryDocument,
      apiCatalogDocument,
      agentDocument,
      pathwaysDocument,
      loveDocument,
      a2aDocument,
    ] = await Promise.all([
        get("root", probeUrl(subject.origin, "/"), ROOT_ACCEPT),
        get(
          "discovery",
          probeUrl(subject.origin, "/public/discovery"),
          JSON_ACCEPT,
        ),
        get(
          "api_catalog",
          probeUrl(subject.origin, "/.well-known/api-catalog"),
          JSON_ACCEPT,
        ),
        get(
          "agent_txt",
          probeUrl(subject.origin, "/.well-known/agent.txt"),
          AGENT_TXT_ACCEPT,
        ),
        get("pathways", probeUrl(subject.origin, "/v1/pathways"), JSON_ACCEPT),
        get(
          "love_discovery",
          probeUrl(subject.origin, "/.well-known/love-packages"),
          JSON_ACCEPT,
        ),
        get(
          "a2a_card",
          probeUrl(subject.origin, "/.well-known/agent-card.json"),
          JSON_ACCEPT,
        ),
      ]);
    sources.push(
      rootDocument.observation,
      discoveryDocument.observation,
      apiCatalogDocument.observation,
      agentDocument.observation,
      pathwaysDocument.observation,
      loveDocument.observation,
      a2aDocument.observation,
    );
    for (const source of sources) addTransportDiagnostic(source, diagnostics);

    if (rootDocument.observation.state === "present") {
      if (!rootDocument.link_header) {
        surfaces.push({
          id: "root_links",
          state: "not_found",
          schema_conformance: "not_assessed",
          evidence_ids: ["root"],
          claims: [],
          boundary_codes: [
            "absence_is_scoped_to_the_final_root_response_at_observation_time",
            "no_link_target_was_followed",
          ],
          diagnostic_codes: [],
        });
      } else {
        const parsed = parseRootLinkHeader(
          rootDocument.link_header,
          subject.origin,
        );
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "root", "error"));
          surfaces.push({
            id: "root_links",
            state: "invalid",
            schema_conformance: "invalid",
            evidence_ids: ["root"],
            claims: [],
            boundary_codes: [
              "link_relations_are_publisher_assertions",
              "no_link_target_was_followed",
            ],
            diagnostic_codes: [parsed.code],
          });
        } else {
          parserWarnings(parsed.warnings, "root", diagnostics);
          const claims: TelescopeClaim[] = [];
          if (parsed.value.discovery_advertised) {
            claims.push(
              claim({
                key: "canonical_discovery",
                value: AGENTTOOL_DISCOVERY_URL,
                basis: "publisher_assertion",
                role: "locator",
                evidence_ids: ["root"],
              }),
            );
          }
          if (parsed.value.api_catalog_advertised) {
            claims.push(
              claim({
                key: "api_catalog",
                value: AGENTTOOL_API_CATALOG_URL,
                basis: "publisher_assertion",
                role: "locator",
                evidence_ids: ["root"],
              }),
            );
          }
          surfaces.push({
            id: "root_links",
            state: "present",
            schema_conformance: "supported_shape_valid",
            evidence_ids: ["root"],
            claims,
            boundary_codes: [
              "link_relations_are_publisher_assertions",
              "link_presence_does_not_prove_reachability_or_authority",
              "no_link_target_was_followed",
            ],
            diagnostic_codes: parsed.warnings,
          });
        }
      }
    } else {
      surfaces.push(
        parseUnavailableSurface("root_links", rootDocument.observation, [
          "absence_is_scoped_to_the_exact_root_probe_and_observation_time",
        ]),
      );
    }

    if (
      discoveryDocument.observation.state === "present" &&
      discoveryDocument.body
    ) {
      if (!isJsonMediaType(discoveryDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "discovery", "error"),
        );
        surfaces.push({
          ...parseUnavailableSurface(
            "discovery",
            discoveryDocument.observation,
            [
              "discovery_is_an_invitation_not_permission",
              "no_road_was_followed",
            ],
          ),
          state: "invalid",
          schema_conformance: "invalid",
          diagnostic_codes: ["unexpected_media_type"],
        });
      } else {
        const parsed = parseAgenttoolDiscovery(
          discoveryDocument.body,
          limits,
        );
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "discovery", "error"));
          surfaces.push({
            ...parseUnavailableSurface(
              "discovery",
              discoveryDocument.observation,
              [
                "discovery_is_an_invitation_not_permission",
                "no_road_was_followed",
              ],
            ),
            state: "invalid",
            schema_conformance: "invalid",
            diagnostic_codes: [parsed.code],
          });
        } else {
          const roadClaims = parsed.value.roads.flatMap(
            (road): TelescopeClaim[] => [
              claim({
                key: `${road.id}_href`,
                value: road.href,
                basis: "publisher_assertion",
                role: "locator",
                evidence_ids: ["discovery"],
              }),
              claim({
                key: `${road.id}_intent`,
                value: road.intent,
                basis: "publisher_assertion",
                role: "capability_advertisement",
                evidence_ids: ["discovery"],
              }),
            ],
          );
          surfaces.push({
            id: "discovery",
            state: "present",
            schema_conformance: "supported_shape_valid",
            evidence_ids: ["discovery"],
            claims: [
              claim({
                key: "format",
                value: parsed.value.format,
                basis: "publisher_assertion",
                role: "capability_advertisement",
                evidence_ids: ["discovery"],
              }),
              claim({
                key: "road_order",
                value: parsed.value.roads.map(({ id }) => id),
                basis: "local_derivation",
                role: "capability_advertisement",
                taint: "local",
                evidence_ids: ["discovery"],
              }),
              ...roadClaims,
              claim({
                key: "application_write",
                value: false,
                basis: "publisher_assertion",
                role: "authority_boundary",
                evidence_ids: ["discovery"],
              }),
              claim({
                key: "external_effect",
                value: false,
                basis: "publisher_assertion",
                role: "authority_boundary",
                evidence_ids: ["discovery"],
              }),
              claim({
                key: "automatic_follow_up",
                value: false,
                basis: "publisher_assertion",
                role: "authority_boundary",
                evidence_ids: ["discovery"],
              }),
            ],
            boundary_codes: [
              "publisher_profile_not_operational_proof",
              "discovery_grants_no_authority_permission_or_consent",
              "profile_does_not_trigger_follow_up",
              "no_automatic_follow_up",
            ],
            diagnostic_codes: [],
          });
        }
      }
    } else {
      surfaces.push(
        parseUnavailableSurface(
          "discovery",
          discoveryDocument.observation,
          [
            "absence_is_scoped_to_the_exact_canonical_path_and_observation_time",
            "no_road_was_followed",
          ],
        ),
      );
    }

    if (
      apiCatalogDocument.observation.state === "present" &&
      apiCatalogDocument.body
    ) {
      if (!isJsonMediaType(apiCatalogDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "api_catalog", "error"),
        );
        surfaces.push({
          ...parseUnavailableSurface(
            "api_catalog",
            apiCatalogDocument.observation,
            [
              "catalog_links_are_publisher_assertions",
              "no_catalog_target_was_followed",
            ],
          ),
          state: "invalid",
          schema_conformance: "invalid",
          diagnostic_codes: ["unexpected_media_type"],
        });
      } else {
        const parsed = parseApiCatalog(apiCatalogDocument.body, limits);
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "api_catalog", "error"));
          surfaces.push({
            ...parseUnavailableSurface(
              "api_catalog",
              apiCatalogDocument.observation,
              [
                "catalog_links_are_publisher_assertions",
                "no_catalog_target_was_followed",
              ],
            ),
            state: "invalid",
            schema_conformance: "invalid",
            diagnostic_codes: [parsed.code],
          });
        } else {
          parserWarnings(parsed.warnings, "api_catalog", diagnostics);
          surfaces.push({
            id: "api_catalog",
            state: "present",
            schema_conformance: "supported_shape_valid",
            evidence_ids: ["api_catalog"],
            claims: [
              claim({
                key: "anchor",
                value: parsed.value.anchor,
                basis: "publisher_assertion",
                role: "locator",
                evidence_ids: ["api_catalog"],
              }),
              claim({
                key: "relations",
                value: parsed.value.relations,
                basis: "local_derivation",
                role: "capability_advertisement",
                taint: "local",
                evidence_ids: ["api_catalog"],
              }),
              ...(parsed.value.discovery_advertised
                ? [
                    claim({
                      key: "canonical_discovery",
                      value: AGENTTOOL_DISCOVERY_URL,
                      basis: "publisher_assertion",
                      role: "locator",
                      evidence_ids: ["api_catalog"],
                    }),
                  ]
                : []),
            ],
            boundary_codes: [
              "rfc_9727_catalog_membership_is_not_authority",
              "catalog_links_are_publisher_assertions",
              "no_catalog_target_was_followed",
            ],
            diagnostic_codes: parsed.warnings,
          });
        }
      }
    } else {
      surfaces.push(
        parseUnavailableSurface(
          "api_catalog",
          apiCatalogDocument.observation,
          [
            "absence_is_scoped_to_the_exact_rfc_9727_path_and_observation_time",
            "no_catalog_target_was_followed",
          ],
        ),
      );
    }

    let parsedAgent: ParsedAgentTxt | null = null;
    if (agentDocument.observation.state === "present" && agentDocument.body) {
      if (!isAgentTxtMediaType(agentDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "agent_txt", "error"),
        );
        surfaces.push({
          ...parseUnavailableSurface("agent_txt", agentDocument.observation, [
            "publisher_assertions_not_verified",
            "discovery_grants_no_authority_or_consent",
          ]),
          state: "invalid",
          schema_conformance: "invalid",
          diagnostic_codes: ["unexpected_media_type"],
        });
      } else {
        const parsed = parseAgentTxt(agentDocument.body, limits);
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "agent_txt", "error"));
          surfaces.push({
            ...parseUnavailableSurface("agent_txt", agentDocument.observation, [
              "publisher_assertions_not_verified",
              "discovery_grants_no_authority_or_consent",
            ]),
            state: "invalid",
            schema_conformance: "invalid",
            diagnostic_codes: [parsed.code],
          });
        } else {
          parsedAgent = parsed.value;
          parserWarnings(parsed.warnings, "agent_txt", diagnostics);
          const claims: TelescopeClaim[] = [];
          const selected = parsed.value.selected;
          const addSelected = (
            key: keyof typeof selected,
            role: TelescopeClaim["role"],
            locator = false,
            preserveExactDidTemplate = false,
          ) => {
            const value = selected[key];
            if (value !== null) {
              const claimValue = locator
                ? reportLocator(value, preserveExactDidTemplate)
                : value;
              if (claimValue === null) {
                diagnostics.push(
                  diagnostic("unsafe_remote_locator_omitted", "agent_txt"),
                );
                return;
              }
              claims.push(
                claim({
                  key,
                  value: claimValue,
                  basis: "publisher_assertion",
                  role,
                  evidence_ids: ["agent_txt"],
                }),
              );
            }
          };
          addSelected("substrate", "capability_advertisement");
          addSelected("convention", "capability_advertisement");
          addSelected("pathways_url", "locator", true);
          addSelected("mcp_card_url", "locator", true);
          addSelected("webfinger_template", "locator", true, true);
          addSelected("love_packages_url", "locator", true);
          surfaces.push({
            id: "agent_txt",
            state: "present",
            schema_conformance: "supported_shape_valid",
            evidence_ids: ["agent_txt"],
            claims,
            boundary_codes: [
              "publisher_assertions_not_verified",
              "discovery_grants_no_authority_or_consent",
            ],
            diagnostic_codes: parsed.warnings,
          });
        }
      }
    } else {
      surfaces.push(
        parseUnavailableSurface("agent_txt", agentDocument.observation, [
          "absence_is_scoped_to_exact_path_and_observation_time",
        ]),
      );
    }

    const fixedPathways = probeUrl(subject.origin, "/v1/pathways");
    const advertisedPathways = parsedAgent?.selected.pathways_url;
    if (
      advertisedPathways &&
      canonicalHttpsLocator(advertisedPathways) !==
        canonicalHttpsLocator(fixedPathways)
    ) {
      diagnostics.push(diagnostic("agent_txt_pathways_conflict", "agent_txt"));
    }
    const fixedLove = probeUrl(subject.origin, "/.well-known/love-packages");
    const advertisedLove = parsedAgent?.selected.love_packages_url;
    if (
      advertisedLove &&
      canonicalHttpsLocator(advertisedLove) !== canonicalHttpsLocator(fixedLove)
    ) {
      diagnostics.push(diagnostic("agent_txt_love_conflict", "agent_txt"));
    }

    let parsedPathways: ParsedPathways | null = null;
    if (
      pathwaysDocument.observation.state === "present" &&
      pathwaysDocument.body
    ) {
      if (!isJsonMediaType(pathwaysDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "pathways", "error"),
        );
        surfaces.push({
          ...parseUnavailableSurface("pathways", pathwaysDocument.observation, [
            "tutorial_selection_is_publisher_scoped",
          ]),
          state: "invalid",
          schema_conformance: "invalid",
          diagnostic_codes: ["unexpected_media_type"],
        });
      } else {
        const parsed = parsePathways(pathwaysDocument.body, limits);
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "pathways", "error"));
          surfaces.push({
            ...parseUnavailableSurface(
              "pathways",
              pathwaysDocument.observation,
              ["tutorial_selection_is_publisher_scoped"],
            ),
            state: "invalid",
            schema_conformance: "invalid",
            diagnostic_codes: [parsed.code],
          });
        } else {
          parsedPathways = parsed.value;
          parserWarnings(parsed.warnings, "pathways", diagnostics);
          surfaces.push({
            id: "pathways",
            state: "present",
            schema_conformance: "supported_shape_valid",
            evidence_ids: ["pathways"],
            claims: [
              claim({
                key: "sdk_version",
                value: parsed.value.sdk_version,
                basis: "publisher_assertion",
                role: "release_selection",
                evidence_ids: ["pathways"],
              }),
            ],
            boundary_codes: [
              "tutorial_selection_is_publisher_scoped",
              "latest_and_dist_tags_not_used_for_selection",
            ],
            diagnostic_codes: parsed.warnings,
          });
        }
      }
    } else {
      surfaces.push(
        parseUnavailableSurface("pathways", pathwaysDocument.observation, [
          "absence_is_scoped_to_exact_path_and_observation_time",
        ]),
      );
    }

    if (parsedPathways?.npm) {
      const npm = parsedPathways.npm;
      surfaces.push({
        id: "npm",
        state: "present",
        schema_conformance: "supported_shape_valid",
        evidence_ids: ["pathways"],
        claims: [
          claim({
            key: "package",
            value: npm.package,
            basis: "publisher_assertion",
            role: "locator",
            evidence_ids: ["pathways"],
          }),
          claim({
            key: "version",
            value: parsedPathways.sdk_version,
            basis: "publisher_assertion",
            role: "release_selection",
            evidence_ids: ["pathways"],
          }),
          claim({
            key: "authority",
            value: npm.authority,
            basis: "publisher_assertion",
            role: "authority_boundary",
            evidence_ids: ["pathways"],
          }),
        ],
        boundary_codes: [
          "npm_is_convenience_not_release_authority",
          "npm_install_does_not_independently_verify_love_size_sha256",
          "no_registry_query_performed",
        ],
        diagnostic_codes: [],
      });
      if (npm.authority === false) {
        actions.push(
          buildNpmAction({
            package_name: npm.package,
            version: parsedPathways.sdk_version,
            evidence_ids: ["pathways"],
          }),
        );
      } else {
        diagnostics.push(diagnostic("npm_authority_not_false", "pathways"));
      }
    } else {
      surfaces.push({
        id: "npm",
        state: "not_attempted",
        schema_conformance: "not_assessed",
        evidence_ids:
          pathwaysDocument.observation.state === "present" ? ["pathways"] : [],
        claims: [],
        boundary_codes: ["npm_not_advertised_by_valid_pathways"],
        diagnostic_codes: [],
      });
    }

    let parsedLove: ParsedLoveDiscovery | null = null;
    const loveEvidence: ProbeId[] = ["love_discovery"];
    const loveClaims: TelescopeClaim[] = [];
    let loveDiagnosticCodes: string[] = [];
    if (loveDocument.observation.state === "present" && loveDocument.body) {
      if (!isJsonMediaType(loveDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "love_discovery", "error"),
        );
        loveDiagnosticCodes = ["unexpected_media_type"];
      } else {
        const parsed = parseLoveDiscovery(loveDocument.body, limits);
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "love_discovery", "error"));
          loveDiagnosticCodes = [parsed.code];
        } else {
          parsedLove = parsed.value;
          parserWarnings(parsed.warnings, "love_discovery", diagnostics);
          loveDiagnosticCodes = parsed.warnings;
          const reportIndexUrl = reportLocator(parsed.value.index_url);
          if (reportIndexUrl) {
            loveClaims.push(
              claim({
                key: "index_url",
                value: reportIndexUrl,
                basis: "publisher_assertion",
                role: "locator",
                evidence_ids: ["love_discovery"],
              }),
            );
          } else {
            diagnostics.push(
              diagnostic("unsafe_remote_locator_omitted", "love_discovery"),
            );
          }
          loveClaims.push(
            claim({
              key: "registry_role",
              value: parsed.value.registry_role,
              basis: "publisher_assertion",
              role: "authority_boundary",
              evidence_ids: ["love_discovery"],
            }),
          );
          if (parsed.value.npm_mirror) {
            const registryUrl = reportLocator(
              parsed.value.npm_mirror.registry_url,
            );
            if (registryUrl) {
              loveClaims.push(
                claim({
                  key: "npm_registry_url",
                  value: registryUrl,
                  basis: "publisher_assertion",
                  role: "locator",
                  evidence_ids: ["love_discovery"],
                }),
              );
            } else {
              diagnostics.push(
                diagnostic("unsafe_remote_locator_omitted", "love_discovery"),
              );
            }
            loveClaims.push(
              claim({
                key: "npm_registry_authority",
                value: parsed.value.npm_mirror.authority,
                basis: "publisher_assertion",
                role: "authority_boundary",
                evidence_ids: ["love_discovery"],
              }),
            );
          }
        }
      }
    }

    let parsedManifest: ParsedLoveManifest | null = null;
    let safeMirror: string | null = null;
    let loveChainInvalid = false;
    if (parsedLove) {
      const indexUrl = canonicalHttpsLocator(parsedLove.index_url);
      if (!indexUrl) {
        loveChainInvalid = true;
        diagnostics.push(
          diagnostic("love_index_locator_invalid", "love_discovery", "error"),
        );
        loveDiagnosticCodes.push("love_index_locator_invalid");
      } else {
        const indexDocument = await get("love_index", indexUrl, JSON_ACCEPT);
        sources.push(indexDocument.observation);
        addTransportDiagnostic(indexDocument.observation, diagnostics);
        loveEvidence.push("love_index");
        if (
          indexDocument.observation.state !== "present" ||
          !indexDocument.body
        ) {
          loveChainInvalid = true;
          diagnostics.push(
            diagnostic("love_index_unavailable", "love_index", "error"),
          );
          loveDiagnosticCodes.push("love_index_unavailable");
        } else if (parsedPathways) {
          if (!isJsonMediaType(indexDocument.observation.media_type)) {
            loveChainInvalid = true;
            diagnostics.push(
              diagnostic("unexpected_media_type", "love_index", "error"),
            );
            loveDiagnosticCodes.push("unexpected_media_type");
          } else {
            const packageName = parsedPathways.npm?.package ?? "@agenttool/sdk";
            const selection = selectLoveManifest(
              indexDocument.body,
              limits,
              packageName,
              parsedPathways.sdk_version,
            );
            if (!selection.ok) {
              loveChainInvalid = true;
              diagnostics.push(
                diagnostic(selection.code, "love_index", "error"),
              );
              loveDiagnosticCodes.push(selection.code);
            } else {
              const manifestUrl = canonicalHttpsLocator(
                selection.value.manifest_url,
              );
              if (!manifestUrl) {
                loveChainInvalid = true;
                diagnostics.push(
                  diagnostic(
                    "love_manifest_locator_invalid",
                    "love_index",
                    "error",
                  ),
                );
                loveDiagnosticCodes.push("love_manifest_locator_invalid");
              } else {
                const manifestDocument = await get(
                  "love_sdk_manifest",
                  manifestUrl,
                  JSON_ACCEPT,
                );
                sources.push(manifestDocument.observation);
                addTransportDiagnostic(
                  manifestDocument.observation,
                  diagnostics,
                );
                loveEvidence.push("love_sdk_manifest");
                if (
                  manifestDocument.observation.state !== "present" ||
                  !manifestDocument.body
                ) {
                  loveChainInvalid = true;
                  diagnostics.push(
                    diagnostic(
                      "love_manifest_unavailable",
                      "love_sdk_manifest",
                      "error",
                    ),
                  );
                  loveDiagnosticCodes.push("love_manifest_unavailable");
                } else {
                  if (
                    !isJsonMediaType(manifestDocument.observation.media_type)
                  ) {
                    loveChainInvalid = true;
                    diagnostics.push(
                      diagnostic(
                        "unexpected_media_type",
                        "love_sdk_manifest",
                        "error",
                      ),
                    );
                    loveDiagnosticCodes.push("unexpected_media_type");
                  } else {
                    const manifest = parseLoveManifest(
                      manifestDocument.body,
                      limits,
                      packageName,
                      parsedPathways.sdk_version,
                    );
                    if (!manifest.ok) {
                      loveChainInvalid = true;
                      diagnostics.push(
                        diagnostic(manifest.code, "love_sdk_manifest", "error"),
                      );
                      loveDiagnosticCodes.push(manifest.code);
                    } else {
                      parsedManifest = manifest.value;
                      loveClaims.push(
                        claim({
                          key: "selected_package",
                          value: manifest.value.name,
                          basis: "publisher_assertion",
                          role: "release_selection",
                          evidence_ids: [
                            "pathways",
                            "love_index",
                            "love_sdk_manifest",
                          ],
                        }),
                        claim({
                          key: "selected_version",
                          value: manifest.value.version,
                          basis: "publisher_assertion",
                          role: "release_selection",
                          evidence_ids: [
                            "pathways",
                            "love_index",
                            "love_sdk_manifest",
                          ],
                        }),
                        claim({
                          key: "artifact_size",
                          value: manifest.value.artifact.size,
                          basis: "publisher_assertion",
                          role: "content_commitment",
                          evidence_ids: ["love_sdk_manifest"],
                        }),
                        claim({
                          key: "artifact_sha256",
                          value: manifest.value.artifact.sha256,
                          basis: "publisher_assertion",
                          role: "content_commitment",
                          evidence_ids: ["love_sdk_manifest"],
                        }),
                        claim({
                          key: "runtime_compatibility",
                          value: "not_evaluated",
                          basis: "local_derivation",
                          role: "capability_advertisement",
                          taint: "local",
                          evidence_ids: ["love_sdk_manifest"],
                        }),
                      );
                      for (const mirror of manifest.value.artifact.mirrors) {
                        const canonical = canonicalHttpsLocator(mirror);
                        if (!canonical) continue;
                        try {
                          if (new URL(canonical).search) continue;
                          safeMirror = (
                            await assertPublicHttpsUrl(
                              canonical,
                              resolveHostname,
                              deadline.signal,
                            )
                          ).href;
                          break;
                        } catch {
                          // Try the next declared mirror; no raw failure is emitted.
                        }
                      }
                      if (!safeMirror) {
                        diagnostics.push(
                          diagnostic(
                            "love_no_safe_mirror",
                            "love_sdk_manifest",
                            "error",
                          ),
                        );
                        loveDiagnosticCodes.push("love_no_safe_mirror");
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (loveDocument.observation.state !== "present") {
      surfaces.push(
        parseUnavailableSurface("love_packages", loveDocument.observation, [
          "love_discovery_is_a_locator_not_publisher_authentication",
        ]),
      );
    } else if (!parsedLove) {
      surfaces.push({
        id: "love_packages",
        state: "invalid",
        schema_conformance: "invalid",
        evidence_ids: loveEvidence,
        claims: loveClaims,
        boundary_codes: [
          "love_discovery_is_a_locator_not_publisher_authentication",
          "manifest_digest_is_an_expectation_until_artifact_bytes_are_checked",
        ],
        diagnostic_codes: [...new Set(loveDiagnosticCodes)],
      });
    } else {
      surfaces.push({
        id: "love_packages",
        state: loveChainInvalid ? "invalid" : "present",
        schema_conformance: loveChainInvalid
          ? "invalid"
          : "supported_shape_valid",
        evidence_ids: loveEvidence,
        claims: loveClaims,
        boundary_codes: [
          "love_index_and_mirrors_are_locators_not_authority",
          "manifest_digest_is_an_expectation_until_artifact_bytes_are_checked",
          "love_v1_does_not_authenticate_a_publisher",
        ],
        diagnostic_codes: [...new Set(loveDiagnosticCodes)],
      });
    }
    if (parsedManifest && safeMirror) {
      actions.push(
        ...buildLoveActions({
          manifest: parsedManifest,
          mirror_url: safeMirror,
          evidence_ids: ["pathways", "love_index", "love_sdk_manifest"],
        }),
      );
    }

    const mcpLocator = parsedAgent?.selected.mcp_card_url ?? null;
    if (mcpLocator) {
      const mcpUrl = canonicalHttpsLocator(mcpLocator);
      if (!mcpUrl) {
        diagnostics.push(
          diagnostic("mcp_locator_invalid", "agent_txt", "error"),
        );
        surfaces.push({
          id: "mcp",
          state: "invalid",
          schema_conformance: "invalid",
          evidence_ids: ["agent_txt"],
          claims: [],
          boundary_codes: ["advertisement_does_not_prove_callable_mcp"],
          diagnostic_codes: ["mcp_locator_invalid"],
        });
      } else {
        const mcpDocument = await get("mcp_card", mcpUrl, JSON_ACCEPT);
        sources.push(mcpDocument.observation);
        addTransportDiagnostic(mcpDocument.observation, diagnostics);
        if (mcpDocument.observation.state === "not_found") {
          diagnostics.push(diagnostic("advertised_mcp_not_found", "mcp_card"));
        }
        if (mcpDocument.observation.state === "present" && mcpDocument.body) {
          if (!isJsonMediaType(mcpDocument.observation.media_type)) {
            diagnostics.push(
              diagnostic("unexpected_media_type", "mcp_card", "error"),
            );
            surfaces.push({
              id: "mcp",
              state: "invalid",
              schema_conformance: "invalid",
              evidence_ids: ["agent_txt", "mcp_card"],
              claims: [],
              boundary_codes: [
                "experimental_publisher_advertisement",
                "card_presence_does_not_prove_initialization_tools_or_authentication",
              ],
              diagnostic_codes: ["unexpected_media_type"],
            });
          } else {
            const parsed = parseMcpCard(mcpDocument.body, limits);
            if (!parsed.ok) {
              diagnostics.push(diagnostic(parsed.code, "mcp_card", "error"));
              surfaces.push({
                id: "mcp",
                state: "invalid",
                schema_conformance: "invalid",
                evidence_ids: ["agent_txt", "mcp_card"],
                claims: [],
                boundary_codes: [
                  "experimental_publisher_advertisement",
                  "card_presence_does_not_prove_initialization_tools_or_authentication",
                ],
                diagnostic_codes: [parsed.code],
              });
            } else {
              const mcpEndpoint = reportLocator(parsed.value.endpoint);
              if (!mcpEndpoint) {
                diagnostics.push(
                  diagnostic("unsafe_remote_locator_omitted", "mcp_card"),
                );
              }
              surfaces.push({
                id: "mcp",
                state: "present",
                schema_conformance: "not_assessed",
                evidence_ids: ["agent_txt", "mcp_card"],
                claims: [
                  claim({
                    key: "name",
                    value: parsed.value.name,
                    basis: "publisher_assertion",
                    role: "capability_advertisement",
                    evidence_ids: ["mcp_card"],
                  }),
                  claim({
                    key: "protocol_version",
                    value: parsed.value.protocol_version,
                    basis: "publisher_assertion",
                    role: "capability_advertisement",
                    evidence_ids: ["mcp_card"],
                  }),
                  ...(mcpEndpoint
                    ? [
                        claim({
                          key: "endpoint",
                          value: mcpEndpoint,
                          basis: "publisher_assertion",
                          role: "locator",
                          evidence_ids: ["mcp_card"],
                        }),
                      ]
                    : []),
                  claim({
                    key: "authentication",
                    value: parsed.value.authentication,
                    basis: "publisher_assertion",
                    role: "authority_boundary",
                    evidence_ids: ["mcp_card"],
                  }),
                ],
                boundary_codes: [
                  "experimental_publisher_advertisement",
                  "schema_conformance_not_assessed",
                  "card_presence_does_not_prove_initialization_tools_or_authentication",
                  "endpoint_not_invoked",
                ],
                diagnostic_codes: [],
              });
            }
          }
        } else {
          surfaces.push(
            parseUnavailableSurface("mcp", mcpDocument.observation, [
              "advertisement_does_not_prove_callable_mcp",
              "endpoint_not_invoked",
            ]),
          );
        }
      }
    } else {
      surfaces.push({
        id: "mcp",
        state: "not_attempted",
        schema_conformance: "not_assessed",
        evidence_ids: parsedAgent ? ["agent_txt"] : [],
        claims: [],
        boundary_codes: ["mcp_not_advertised_by_valid_agent_txt"],
        diagnostic_codes: [],
      });
    }

    if (a2aDocument.observation.state === "present" && a2aDocument.body) {
      if (!isJsonMediaType(a2aDocument.observation.media_type)) {
        diagnostics.push(
          diagnostic("unexpected_media_type", "a2a_card", "error"),
        );
        surfaces.push({
          id: "a2a",
          state: "invalid",
          schema_conformance: "invalid",
          evidence_ids: ["a2a_card"],
          claims: [],
          boundary_codes: ["card_advertisement_does_not_prove_task_transport"],
          diagnostic_codes: ["unexpected_media_type"],
        });
      } else {
        const parsed = parseA2aCard(a2aDocument.body, limits);
        if (!parsed.ok) {
          diagnostics.push(diagnostic(parsed.code, "a2a_card", "error"));
          surfaces.push({
            id: "a2a",
            state: "invalid",
            schema_conformance: "invalid",
            evidence_ids: ["a2a_card"],
            claims: [],
            boundary_codes: [
              "card_advertisement_does_not_prove_task_transport",
            ],
            diagnostic_codes: [parsed.code],
          });
        } else {
          const a2aEndpoint = parsed.value.endpoint
            ? reportLocator(parsed.value.endpoint)
            : null;
          if (parsed.value.endpoint && !a2aEndpoint) {
            diagnostics.push(
              diagnostic("unsafe_remote_locator_omitted", "a2a_card"),
            );
          }
          surfaces.push({
            id: "a2a",
            state: "present",
            schema_conformance: "not_assessed",
            evidence_ids: ["a2a_card"],
            claims: [
              claim({
                key: "name",
                value: parsed.value.name,
                basis: "publisher_assertion",
                role: "capability_advertisement",
                evidence_ids: ["a2a_card"],
              }),
              ...(a2aEndpoint
                ? [
                    claim({
                      key: "endpoint",
                      value: a2aEndpoint,
                      basis: "publisher_assertion",
                      role: "locator",
                      evidence_ids: ["a2a_card"],
                    }),
                  ]
                : []),
            ],
            boundary_codes: [
              "schema_conformance_not_assessed",
              "card_advertisement_does_not_prove_task_transport",
              "endpoint_not_invoked",
            ],
            diagnostic_codes: [],
          });
        }
      }
    } else {
      const a2aMissingBoundaries =
        a2aDocument.observation.state === "not_found"
          ? [
              "not_found_means_only_exact_standard_path_at_observation_time",
              "no_private_or_alternate_a2a_absence_inferred",
            ]
          : ["no_a2a_absence_inferred_from_inconclusive_observation"];
      surfaces.push(
        parseUnavailableSurface(
          "a2a",
          a2aDocument.observation,
          a2aMissingBoundaries,
        ),
      );
    }

    const rawWebfingerTemplate =
      parsedAgent?.selected.webfinger_template ?? null;
    const webfingerTemplate = rawWebfingerTemplate
      ? reportLocator(rawWebfingerTemplate, true)
      : null;
    if (rawWebfingerTemplate && !webfingerTemplate) {
      diagnostics.push(
        diagnostic("unsafe_remote_locator_omitted", "agent_txt"),
      );
    }
    surfaces.push({
      id: "webfinger",
      state: webfingerTemplate ? "present" : "not_attempted",
      schema_conformance: "not_assessed",
      evidence_ids: parsedAgent ? ["agent_txt"] : [],
      claims: webfingerTemplate
        ? [
            claim({
              key: "template",
              value: webfingerTemplate,
              basis: "publisher_assertion",
              role: "locator",
              evidence_ids: ["agent_txt"],
            }),
          ]
        : [],
      boundary_codes: [
        "locator_not_identity_authority",
        "not_queried_without_an_exact_did",
      ],
      diagnostic_codes: [],
    });

    const offer = parsedAgent?.selected;
    const offerClaims: TelescopeClaim[] = [];
    if (offer) {
      for (const [key, value, role] of [
        ["atom_url", offer.offer_bus_atom_url, "locator"],
        ["rss_url", offer.offer_bus_rss_url, "locator"],
        ["json_url", offer.offer_bus_json_url, "locator"],
        ["boundary", offer.offer_bus_boundary, "authority_boundary"],
        ["websub", offer.websub, "capability_advertisement"],
      ] as const) {
        if (value) {
          const claimValue = role === "locator" ? reportLocator(value) : value;
          if (claimValue === null) {
            diagnostics.push(
              diagnostic("unsafe_remote_locator_omitted", "agent_txt"),
            );
            continue;
          }
          offerClaims.push(
            claim({
              key,
              value: claimValue,
              basis: "publisher_assertion",
              role,
              evidence_ids: ["agent_txt"],
            }),
          );
        }
      }
    }
    surfaces.push({
      id: "offer_bus",
      state: offerClaims.length > 0 ? "present" : "not_attempted",
      schema_conformance: "not_assessed",
      evidence_ids: parsedAgent ? ["agent_txt"] : [],
      claims: offerClaims,
      boundary_codes: [
        "feed_discovery_grants_no_authority_or_settlement",
        "feeds_not_fetched",
        "no_automatic_action",
      ],
      diagnostic_codes: [],
    });

    const extensions = await runAdapters(
      adapters,
      {
        subject,
        observed_at: observedAt,
        signal: deadline.signal,
      },
      diagnostics,
    );

    const coreIds = new Set<SurfaceObservation["id"]>([
      "discovery",
      "api_catalog",
      "agent_txt",
      "pathways",
      "love_packages",
      "a2a",
    ]);
    const corePresent = surfaces.some(
      (surface) => coreIds.has(surface.id) && surface.state === "present",
    );
    const degraded =
      surfaces.some((surface) => surface.state === "invalid") ||
      sources.some((source) =>
        ["restricted", "unreachable", "blocked", "too_large"].includes(
          source.state,
        ),
      ) ||
      diagnostics.some(
        (entry) => entry.level === "error" || entry.code.includes("ambiguous"),
      );
    diagnostics.sort((left, right) => {
      const leftKey = `${left.evidence_id ?? "~"}\u0000${left.code}\u0000${left.level}`;
      const rightKey = `${right.evidence_id ?? "~"}\u0000${right.code}\u0000${right.level}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const status: TelescopeReport["status"] = !corePresent
      ? "inconclusive"
      : degraded
        ? "partial"
        : "discovered";

    return {
      schema: REPORT_SCHEMA,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      subject,
      observed_at: observedAt,
      status,
      network_boundary: {
        mode: "public_https_read_only",
        http_transport: options.fetch ? "injected" : "native_fetch",
        dns_resolver: options.resolve_hostname ? "injected" : "system_lookup",
        methods: ["GET"],
        credentials: "omitted",
        redirects: "manual_revalidated",
        dns_preflight: true,
        connected_address_pinning: false,
        ambient_proxy_isolation: false,
        statement:
          "Core probes ask the selected resolver and transport to fail closed on non-global addresses, omit credentials, and revalidate redirects. Native fetch can re-resolve before connecting; the connection is not address-pinned, ambient proxy behavior is not controlled, and this is not a universal SSRF guarantee. Injected transports, resolvers, and adapters are caller-owned seams.",
      },
      effective_limits: limits,
      sources,
      surfaces,
      actions,
      extensions,
      diagnostics,
    };
  } finally {
    deadline.cleanup();
  }
}
