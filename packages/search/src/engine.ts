import { randomUUID as nodeRandomUUID } from "node:crypto";
import {
  redactUrlForOutput,
  redactUrlsInText,
} from "@agenttool/browser";
import {
  DEFAULT_SEARCH_LIMITS,
  SEARCH_SCHEMA,
  UNTRUSTED_SEARCH_NOTE,
} from "./constants.js";
import { SearchError } from "./errors.js";
import { isUnicodeScalarString } from "./text.js";
import type {
  SearchClaim,
  SearchDiagnostic,
  SearchEvidence,
  SearchKind,
  SearchLimits,
  SearchOptions,
  SearchProvider,
  SearchProviderObservation,
  SearchResponse,
  SearchResult,
  SearchInput,
  ProviderCandidate,
  ProviderClaim,
  ProviderSearchBatch,
} from "./types.js";

const ALL_SEARCH_KINDS = new Set<SearchKind>([
  "web",
  "agent",
  "capability",
  "mcp_server",
  "tool",
  "package",
  "documentation",
  "other",
]);
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const RRF_K = 60;
const SAFE_PROVIDER_DIAGNOSTIC_CODES = new Set([
  "provider_request_invalid",
  "provider_cursor_unsupported",
  "provider_aborted",
  "provider_network_error",
  "provider_redirect",
  "provider_http_error",
  "provider_content_encoding_invalid",
  "provider_content_length_invalid",
  "provider_response_too_large",
  "provider_media_type_invalid",
  "provider_body_unavailable",
  "provider_body_read_failed",
  "provider_json_invalid",
  "provider_response_invalid",
]);

export interface SearchEngineOptions {
  limits?: Partial<SearchLimits>;
  now?: () => Date;
  randomUUID?: () => string;
  sessionId?: string;
}

export interface ResolvedSearchResult {
  targetUrl: string;
  inspectUrl: string;
  expiresAt: string;
}

interface StoredResult extends ResolvedSearchResult {
  queryId: string;
  expiresAtMs: number;
}

interface CursorState {
  token: string;
  queryId: string;
  query: string;
  kinds: SearchKind[];
  providerIds: string[];
  providerCursors: Map<string, string>;
  limit: number;
  deadlineMs: number;
  expiresAtMs: number;
}

interface QueryState {
  resultIds: Set<string>;
  cursorTokens: Set<string>;
  expiresAtMs: number;
}

interface NormalizedCandidate {
  providerId: string;
  providerOrder: number;
  providerRank: number;
  evidenceId: string;
  kind: SearchKind;
  title: string;
  summary: string;
  targetUrl: string;
  inspectUrl: string;
  canonicalKey: string;
  displayUrl: string;
  origin: string;
  mimeType: string | null;
  capabilities: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  providerScore: { value: number; basis: string } | null;
  claims: ProviderClaim[];
}

interface RankedGroup {
  key: string;
  primary: NormalizedCandidate;
  candidates: NormalizedCandidate[];
  score: number;
}

interface ProviderSuccess {
  provider: SearchProvider;
  providerOrder: number;
  queryDisclosed: true;
  state: "complete";
  batch: ProviderSearchBatch;
  candidates: NormalizedCandidate[];
  evidence: SearchEvidence;
  diagnostics: SearchDiagnostic[];
}

interface ProviderFailure {
  provider: SearchProvider;
  providerOrder: number;
  queryDisclosed: boolean;
  state: "error" | "timeout";
  diagnostic: SearchDiagnostic;
}

type ProviderOutcome = ProviderSuccess | ProviderFailure;

export class SearchEngine {
  readonly sessionId: string;
  readonly limits: SearchLimits;

  private readonly providers = new Map<string, SearchProvider>();
  private readonly now: () => Date;
  private readonly makeUuid: () => string;
  private readonly results = new Map<string, StoredResult>();
  private readonly cursors = new Map<string, CursorState>();
  private readonly queries = new Map<string, QueryState>();
  private searchActive = false;

  constructor(
    providers: readonly SearchProvider[],
    options: SearchEngineOptions = {},
  ) {
    this.limits = {
      ...DEFAULT_SEARCH_LIMITS,
      ...options.limits,
    };
    validateLimits(this.limits);
    if (providers.length === 0) {
      throw new SearchError(
        "invalid_request",
        "At least one search provider is required.",
      );
    }
    if (providers.length > this.limits.max_providers) {
      throw new SearchError(
        "invalid_request",
        `At most ${this.limits.max_providers} search providers are permitted.`,
      );
    }
    for (const provider of providers) {
      if (
        !provider
        || typeof provider !== "object"
        || typeof provider.id !== "string"
        || !PROVIDER_ID_PATTERN.test(provider.id)
      ) {
        throw new SearchError(
          "invalid_request",
          "Search provider IDs must be lowercase stable identifiers.",
        );
      }
      if (this.providers.has(provider.id)) {
        throw new SearchError(
          "invalid_request",
          `Duplicate search provider: ${provider.id}.`,
        );
      }
      if (
        !Array.isArray(provider.kinds) ||
        provider.kinds.length === 0 ||
        provider.kinds.some((kind) => !ALL_SEARCH_KINDS.has(kind))
      ) {
        throw new SearchError(
          "invalid_request",
          `Search provider ${provider.id} declares invalid result kinds.`,
        );
      }
      if (
        typeof provider.search !== "function"
        || !validProviderBoundary(provider.boundary)
      ) {
        throw new SearchError(
          "invalid_request",
          `Search provider ${provider.id} declares an invalid boundary.`,
        );
      }
      const snapshot = Object.freeze({
        id: provider.id,
        kinds: Object.freeze(unique(provider.kinds)),
        boundary: Object.freeze({
          mode: provider.boundary.mode.trim(),
          credentials: provider.boundary.credentials,
          query_disclosed: true as const,
          connected_address_pinning:
            provider.boundary.connected_address_pinning,
          statement: provider.boundary.statement.trim(),
        }),
        search: provider.search.bind(provider),
      }) satisfies SearchProvider;
      this.providers.set(snapshot.id, snapshot);
    }
    this.now = options.now ?? (() => new Date());
    this.makeUuid = options.randomUUID ?? nodeRandomUUID;
    this.sessionId =
      options.sessionId ?? `search_session_${this.makeUuid()}`;
    if (!this.sessionId.trim() || this.sessionId.length > 200) {
      throw new SearchError(
        "invalid_request",
        "Search session ID must contain 1 to 200 characters.",
      );
    }
  }

  async search(
    input: SearchInput,
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    if (options.signal?.aborted) {
      throw new SearchError(
        "search_cancelled",
        "Agent search was cancelled before provider disclosure.",
      );
    }
    if (this.searchActive) {
      throw new SearchError(
        "search_unavailable",
        "Another agent search is already active.",
      );
    }
    this.searchActive = true;
    try {
      return await this.searchOnce(input, options);
    } finally {
      this.searchActive = false;
    }
  }

  private async searchOnce(
    input: SearchInput,
    options: SearchOptions,
  ): Promise<SearchResponse> {
    validateSearchInputShape(input);
    const startedAt = this.now();
    const startedAtMs = startedAt.getTime();
    if (!Number.isFinite(startedAtMs)) {
      throw new SearchError(
        "internal_error",
        "Search clock returned an invalid timestamp.",
      );
    }

    let queryId: string;
    let query: string;
    let kinds: SearchKind[];
    let providerIds: string[];
    let providerCursors: Map<string, string | undefined>;
    let resultLimit: number;
    let deadlineMs: number;
    let expiresAtMs: number;

    if ("cursor" in input && typeof input.cursor === "string") {
      const state = this.cursors.get(input.cursor);
      if (!state) {
        throw new SearchError(
          "cursor_not_found",
          "Search cursor was not found in this session.",
        );
      }
      if (state.expiresAtMs <= startedAtMs) {
        this.deleteCursor(state);
        throw new SearchError(
          "cursor_expired",
          "Search cursor has expired.",
        );
      }
      this.pruneExpired(startedAtMs);
      queryId = state.queryId;
      query = state.query;
      kinds = [...state.kinds];
      providerIds = [...state.providerIds];
      providerCursors = new Map(state.providerCursors);
      resultLimit = state.limit;
      deadlineMs =
        input.deadline_ms === undefined
          ? state.deadlineMs
          : Math.min(
              state.deadlineMs,
              normalizeDeadline(input.deadline_ms, this.limits),
            );
      expiresAtMs = state.expiresAtMs;
      // Pagination handles are one-shot. Consuming before external work avoids
      // replaying an uncertain provider read and bounds per-query handle state.
      this.deleteCursor(state);
    } else {
      this.pruneExpired(startedAtMs);
      if (!("query" in input) || typeof input.query !== "string") {
        throw new SearchError(
          "invalid_request",
          "Agent search requires a query or cursor.",
        );
      }
      query = normalizeQuery(input.query, this.limits.max_query_chars);
      providerIds = this.selectProviderIds(input.provider_ids);
      kinds = this.selectKinds(input.kinds, providerIds);
      providerIds = providerIds.filter((providerId) =>
        intersects(this.providers.get(providerId)?.kinds ?? [], kinds),
      );
      if (providerIds.length === 0) {
        throw new SearchError(
          "invalid_request",
          "No selected provider supports the requested search kinds.",
        );
      }
      providerCursors = new Map(
        providerIds.map((providerId) => [providerId, undefined]),
      );
      resultLimit = normalizeResultLimit(input.limit, this.limits);
      deadlineMs = normalizeDeadline(input.deadline_ms, this.limits);
      queryId = this.newOpaqueId("search_query", this.queries);
      expiresAtMs = startedAtMs + this.limits.session_ttl_ms;
      this.queries.set(queryId, {
        resultIds: new Set(),
        cursorTokens: new Set(),
        expiresAtMs,
      });
      this.enforceQueryLimit();
    }

    const activeProviders = providerIds.map((providerId, providerOrder) => {
      const provider = this.providers.get(providerId);
      if (!provider) {
        throw new SearchError(
          "provider_not_found",
          `Search provider ${providerId} is unavailable.`,
        );
      }
      return {
        provider,
        providerOrder,
        cursor: providerCursors.get(providerId),
      };
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("deadline"), deadlineMs);
    const onExternalAbort = (): void => controller.abort("cancelled");
    if (options.signal?.aborted) {
      controller.abort("cancelled");
    } else {
      options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    }

    let outcomes: ProviderOutcome[];
    try {
      outcomes = await Promise.all(
        activeProviders.map(({ provider, providerOrder, cursor }) =>
          this.callProvider(
            provider,
            providerOrder,
            query,
            kinds,
            resultLimit,
            cursor,
            startedAt.toISOString(),
            controller.signal,
          ),
        ),
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }

    const successes = outcomes.filter(
      (outcome): outcome is ProviderSuccess => outcome.state === "complete",
    );
    const failures = outcomes.filter(
      (outcome): outcome is ProviderFailure => outcome.state !== "complete",
    );
    const querySentTo = outcomes
      .filter((outcome) => outcome.queryDisclosed)
      .sort((left, right) => left.providerOrder - right.providerOrder)
      .map((outcome) => outcome.provider.id);
    if (
      querySentTo.length === 0
      && controller.signal.reason === "cancelled"
    ) {
      throw new SearchError(
        "search_cancelled",
        "Agent search was cancelled before provider disclosure.",
      );
    }
    const evidence = successes
      .map((outcome) => outcome.evidence)
      .slice(0, this.limits.max_evidence);
    const diagnostics = outcomes.flatMap((outcome) =>
      outcome.state === "complete"
        ? outcome.diagnostics
        : [outcome.diagnostic],
    );
    const ranked = rankCandidates(
      successes.flatMap((outcome) => outcome.candidates),
    ).slice(0, resultLimit);
    const expiresAt = new Date(expiresAtMs).toISOString();
    const queryState = this.queries.get(queryId);
    if (!queryState) {
      throw new SearchError(
        "internal_error",
        "Search query state is unavailable.",
      );
    }

    const results = ranked.map((group, index) => {
      const resultId = this.newOpaqueId("search_result", this.results);
      this.results.set(resultId, {
        targetUrl: group.primary.targetUrl,
        inspectUrl: group.primary.inspectUrl,
        expiresAt,
        expiresAtMs,
        queryId,
      });
      queryState.resultIds.add(resultId);
      return toSearchResult(
        group,
        index + 1,
        this.sessionId,
        resultId,
        this.limits,
      );
    });

    const nextProviderCursors = new Map<string, string>();
    for (const outcome of successes) {
      if (outcome.batch.next_cursor) {
        nextProviderCursors.set(
          outcome.provider.id,
          boundOpaqueCursor(outcome.batch.next_cursor),
        );
      }
    }
    let nextCursor: string | null = null;
    if (nextProviderCursors.size > 0) {
      nextCursor = this.newOpaqueId("search_cursor", this.cursors);
      const nextProviderIds = providerIds.filter((providerId) =>
        nextProviderCursors.has(providerId),
      );
      const state: CursorState = {
        token: nextCursor,
        queryId,
        query,
        kinds: [...kinds],
        providerIds: nextProviderIds,
        providerCursors: nextProviderCursors,
        limit: resultLimit,
        deadlineMs,
        expiresAtMs,
      };
      this.cursors.set(nextCursor, state);
      queryState.cursorTokens.add(nextCursor);
    }

    const providerObservations = outcomes
      .sort((left, right) => left.providerOrder - right.providerOrder)
      .map(toProviderObservation);
    const status =
      successes.length === 0
        ? "inconclusive"
        : failures.length > 0
          ? "partial"
          : "complete";

    return {
      schema: SEARCH_SCHEMA,
      session_id: this.sessionId,
      query_id: queryId,
      observed_at: startedAt.toISOString(),
      expires_at: expiresAt,
      status,
      partial: failures.length > 0,
      query: {
        text: query,
        kinds,
        providers: providerIds,
      },
      privacy: {
        query_sent_to: querySentTo,
        provider_logging_and_retention: "not_evaluated",
        warning:
          "The query was disclosed to each listed provider; provider retention was not evaluated.",
      },
      effective_limits: {
        results: resultLimit,
        deadline_ms: deadlineMs,
        providers: activeProviders.length,
      },
      results,
      providers: providerObservations,
      evidence,
      diagnostics,
      next_cursor: nextCursor,
      untrusted: true,
      trust: "untrusted",
      authority: "none",
      automatic_action: "never",
      note: UNTRUSTED_SEARCH_NOTE,
    };
  }

  resolveResult(
    sessionId: string,
    resultId: string,
  ): ResolvedSearchResult {
    if (sessionId !== this.sessionId) {
      throw new SearchError(
        "foreign_session",
        "Search result belongs to a different session.",
      );
    }
    const stored = this.results.get(resultId);
    if (!stored) {
      throw new SearchError(
        "result_not_found",
        "Search result was not found in this session.",
      );
    }
    const nowMs = this.now().getTime();
    if (stored.expiresAtMs <= nowMs) {
      this.results.delete(resultId);
      this.queries.get(stored.queryId)?.resultIds.delete(resultId);
      throw new SearchError(
        "result_expired",
        "Search result has expired.",
      );
    }
    return {
      targetUrl: stored.targetUrl,
      inspectUrl: stored.inspectUrl,
      expiresAt: stored.expiresAt,
    };
  }

  private async callProvider(
    provider: SearchProvider,
    providerOrder: number,
    query: string,
    kinds: readonly SearchKind[],
    limit: number,
    cursor: string | undefined,
    observedAt: string,
    signal: AbortSignal,
  ): Promise<ProviderOutcome> {
    let queryDisclosed = false;
    try {
      // Promise arguments are evaluated before raceAbort runs. Check first so
      // an already-cancelled aggregate never calls the provider at all.
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const request = {
        query,
        kinds,
        limit: Math.min(
          this.limits.max_provider_results,
          Math.max(
            limit,
            Math.min(
              this.limits.default_results,
              this.limits.max_provider_results,
            ),
          ),
        ),
        ...(cursor === undefined ? {} : { cursor }),
      };
      queryDisclosed = true;
      const batch = await raceAbort(
        provider.search(request, {
          observed_at: observedAt,
          signal,
        }),
        signal,
      );
      if (batch.next_cursor !== undefined) {
        boundOpaqueCursor(batch.next_cursor);
      }
      const evidenceId = this.newOpaqueId("search_evidence");
      const diagnostics: SearchDiagnostic[] = [];
      const candidates: NormalizedCandidate[] = [];
      const seen = new Set<string>();
      for (
        let index = 0;
        index < batch.results.length &&
        index < this.limits.max_provider_results;
        index += 1
      ) {
        const candidate = batch.results[index];
        if (!candidate) continue;
        try {
          const normalized = normalizeCandidate(
            candidate,
            provider.id,
            providerOrder,
            index + 1,
            evidenceId,
            kinds,
            provider.kinds,
            this.limits,
          );
          if (seen.has(normalized.canonicalKey)) continue;
          seen.add(normalized.canonicalKey);
          candidates.push(normalized);
        } catch {
          diagnostics.push({
            code: "invalid_provider_result",
            level: "warning",
            provider_id: provider.id,
            message: "Provider returned a result outside the search contract.",
          });
        }
      }
      return {
        provider,
        providerOrder,
        queryDisclosed: true,
        state: "complete",
        batch,
        candidates,
        evidence: toEvidence(
          evidenceId,
          provider.id,
          observedAt,
          batch,
          this.limits,
        ),
        diagnostics: dedupeDiagnostics(diagnostics),
      };
    } catch (error) {
      const cancelled =
        signal.aborted && signal.reason === "cancelled";
      const timedOut =
        !cancelled && (signal.aborted || isTimeoutError(error));
      const code = cancelled
        ? "provider_cancelled"
        : timedOut
          ? "provider_timeout"
        : safeProviderDiagnosticCode(error);
      return {
        provider,
        providerOrder,
        queryDisclosed,
        state: timedOut ? "timeout" : "error",
        diagnostic: {
          code,
          level: "error",
          provider_id: provider.id,
          message: cancelled
            ? queryDisclosed
              ? "Provider search was cancelled after dispatch."
              : "Provider search was cancelled before dispatch."
            : timedOut
              ? "Provider did not complete before the search deadline."
              : "Provider search failed within its declared boundary.",
        },
      };
    }
  }

  private selectProviderIds(
    requested: readonly string[] | undefined,
  ): string[] {
    const providerIds =
      requested === undefined ? [...this.providers.keys()] : unique(requested);
    if (providerIds.length === 0) {
      throw new SearchError(
        "invalid_request",
        "At least one search provider must be selected.",
      );
    }
    if (providerIds.length > this.limits.max_providers) {
      throw new SearchError(
        "invalid_request",
        `At most ${this.limits.max_providers} search providers may be selected.`,
      );
    }
    for (const providerId of providerIds) {
      if (typeof providerId !== "string" || !this.providers.has(providerId)) {
        throw new SearchError(
          "provider_not_found",
          "A requested search provider is unavailable.",
        );
      }
    }
    return providerIds;
  }

  private selectKinds(
    requested: readonly SearchKind[] | undefined,
    providerIds: readonly string[],
  ): SearchKind[] {
    const kinds =
      requested === undefined
        ? unique(
            providerIds.flatMap(
              (providerId) => this.providers.get(providerId)?.kinds ?? [],
            ),
          )
        : unique(requested);
    if (
      kinds.length === 0 ||
      kinds.some((kind) => !ALL_SEARCH_KINDS.has(kind))
    ) {
      throw new SearchError(
        "invalid_request",
        "Search kinds must contain at least one supported value.",
      );
    }
    return kinds;
  }

  private newOpaqueId(
    prefix: string,
    existing?: ReadonlyMap<string, unknown>,
  ): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = `${prefix}_${this.makeUuid()}`;
      if (
        candidate.length <= 200 &&
        !existing?.has(candidate)
      ) {
        return candidate;
      }
    }
    throw new SearchError(
      "internal_error",
      "Could not allocate a search handle.",
    );
  }

  private pruneExpired(nowMs: number): void {
    for (const [resultId, result] of this.results) {
      if (result.expiresAtMs <= nowMs) {
        this.results.delete(resultId);
        this.queries.get(result.queryId)?.resultIds.delete(resultId);
      }
    }
    for (const cursor of this.cursors.values()) {
      if (cursor.expiresAtMs <= nowMs) this.deleteCursor(cursor);
    }
    for (const [queryId, query] of this.queries) {
      if (query.expiresAtMs <= nowMs) this.deleteQuery(queryId, query);
    }
  }

  private enforceQueryLimit(): void {
    while (this.queries.size > this.limits.max_stored_queries) {
      const oldest = this.queries.entries().next().value as
        | [string, QueryState]
        | undefined;
      if (!oldest) return;
      this.deleteQuery(oldest[0], oldest[1]);
    }
  }

  private deleteCursor(cursor: CursorState): void {
    this.cursors.delete(cursor.token);
    this.queries.get(cursor.queryId)?.cursorTokens.delete(cursor.token);
  }

  private deleteQuery(queryId: string, query: QueryState): void {
    for (const resultId of query.resultIds) this.results.delete(resultId);
    for (const token of query.cursorTokens) this.cursors.delete(token);
    this.queries.delete(queryId);
  }
}

function validateLimits(limits: SearchLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SearchError(
        "invalid_request",
        `Search limit ${name} must be a positive safe integer.`,
      );
    }
  }
  const hardMaxima: SearchLimits = {
    ...DEFAULT_SEARCH_LIMITS,
    default_results: DEFAULT_SEARCH_LIMITS.max_results,
    default_deadline_ms: DEFAULT_SEARCH_LIMITS.max_deadline_ms,
  };
  for (const [name, maximum] of Object.entries(hardMaxima) as Array<
    [keyof SearchLimits, number]
  >) {
    if (limits[name] > maximum) {
      throw new SearchError(
        "invalid_request",
        `Search limit ${name} exceeds the protocol maximum.`,
      );
    }
  }
  if (limits.default_results > limits.max_results) {
    throw new SearchError(
      "invalid_request",
      "Default result limit cannot exceed the maximum.",
    );
  }
  if (limits.default_deadline_ms > limits.max_deadline_ms) {
    throw new SearchError(
      "invalid_request",
      "Default deadline cannot exceed the maximum.",
    );
  }
  if (limits.max_evidence < limits.max_providers) {
    throw new SearchError(
      "invalid_request",
      "Evidence capacity must cover every configured provider.",
    );
  }
}

function validateSearchInputShape(input: SearchInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SearchError(
      "invalid_request",
      "Agent search input must be an object.",
    );
  }
  const record = input as unknown as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          "query",
          "provider_ids",
          "kinds",
          "limit",
          "deadline_ms",
          "cursor",
        ].includes(key),
    )
  ) {
    throw new SearchError(
      "invalid_request",
      "Agent search input contains an unknown field.",
    );
  }
  if (record.cursor !== undefined) {
    if (
      typeof record.cursor !== "string" ||
      record.cursor.length === 0 ||
      record.cursor.length > 8_192 ||
      record.query !== undefined ||
      record.provider_ids !== undefined ||
      record.kinds !== undefined ||
      record.limit !== undefined
    ) {
      throw new SearchError(
        "invalid_request",
        "A cursor is exclusive and restores its original search parameters.",
      );
    }
    return;
  }
  if (
    typeof record.query !== "string" ||
    (record.provider_ids !== undefined &&
      !Array.isArray(record.provider_ids)) ||
    (record.kinds !== undefined && !Array.isArray(record.kinds))
  ) {
    throw new SearchError(
      "invalid_request",
      "Agent search requires a query and array-valued filters.",
    );
  }
}

function normalizeQuery(query: string, maxChars: number): string {
  const normalized = query.trim();
  if (!normalized) {
    throw new SearchError(
      "invalid_request",
      "Search query cannot be empty.",
    );
  }
  if (!isUnicodeScalarString(normalized)) {
    throw new SearchError(
      "invalid_request",
      "Search query must contain valid Unicode scalar values.",
    );
  }
  if (normalized.length > maxChars) {
    throw new SearchError(
      "invalid_request",
      `Search query exceeds ${maxChars} characters.`,
    );
  }
  return normalized;
}

function normalizeResultLimit(
  requested: number | undefined,
  limits: SearchLimits,
): number {
  if (requested === undefined) return limits.default_results;
  if (
    !Number.isSafeInteger(requested) ||
    requested <= 0 ||
    requested > limits.max_results
  ) {
    throw new SearchError(
      "invalid_request",
      `Search result limit must be between 1 and ${limits.max_results}.`,
    );
  }
  return requested;
}

function normalizeDeadline(
  requested: number | undefined,
  limits: SearchLimits,
): number {
  if (requested === undefined) return limits.default_deadline_ms;
  if (
    !Number.isSafeInteger(requested) ||
    requested <= 0 ||
    requested > limits.max_deadline_ms
  ) {
    throw new SearchError(
      "invalid_request",
      `Search deadline must be between 1 and ${limits.max_deadline_ms} ms.`,
    );
  }
  return requested;
}

function normalizeCandidate(
  candidate: ProviderCandidate,
  providerId: string,
  providerOrder: number,
  providerRank: number,
  evidenceId: string,
  requestedKinds: readonly SearchKind[],
  providerKinds: readonly SearchKind[],
  limits: SearchLimits,
): NormalizedCandidate {
  if (
    !ALL_SEARCH_KINDS.has(candidate.kind) ||
    !requestedKinds.includes(candidate.kind) ||
    !providerKinds.includes(candidate.kind)
  ) {
    throw new Error("kind");
  }
  const target = parsePublicTarget(candidate.target_url, limits.max_url_chars);
  const inspect = parsePublicTarget(
    candidate.inspect_url ?? target.href,
    limits.max_url_chars,
  );
  const title = boundRemoteText(candidate.title, limits.max_title_chars);
  if (!title) throw new Error("title");
  const summary = boundRemoteText(candidate.summary, limits.max_summary_chars);
  const capabilities = unique(
    (candidate.capabilities ?? [])
      .map((value) => boundRemoteText(value, 128))
      .filter((value) => Boolean(value)),
  ).slice(0, limits.max_capabilities);
  const claims = (candidate.claims ?? [])
    .slice(0, limits.max_claims)
    .map(normalizeProviderClaim)
    .filter((claim): claim is ProviderClaim => claim !== null);
  const providerScoreBasis =
    candidate.provider_score === undefined
      ? ""
      : boundRemoteText(candidate.provider_score.basis, 256);
  const providerScore =
    candidate.provider_score !== undefined
    && Number.isFinite(candidate.provider_score.value)
    && providerScoreBasis
      ? {
          value: candidate.provider_score.value,
          basis: providerScoreBasis,
        }
      : null;
  const canonical = new URL(target.href);
  canonical.hash = "";
  const display = new URL(target.href);
  display.hash = "";

  return {
    providerId,
    providerOrder,
    providerRank,
    evidenceId,
    kind: candidate.kind,
    title,
    summary,
    targetUrl: target.href,
    inspectUrl: inspect.href,
    canonicalKey: canonical.href,
    displayUrl: redactSearchUrl(display, limits.max_url_chars),
    origin: target.origin,
    mimeType: normalizeOptionalText(candidate.mime_type, 256),
    capabilities,
    publishedAt: normalizeTimestamp(candidate.published_at),
    modifiedAt: normalizeTimestamp(candidate.modified_at),
    providerScore,
    claims,
  };
}

function parsePublicTarget(value: string, maxChars: number): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    throw new Error("url");
  }
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("scheme");
  if (url.username || url.password) throw new Error("credentials");
  if (url.href.length > maxChars) throw new Error("url");
  return url;
}

function normalizeProviderClaim(claim: ProviderClaim): ProviderClaim | null {
  if (
    !claim ||
    ![
      "publisher_assertion",
      "provider_assertion",
      "transport_observation",
      "local_derivation",
    ].includes(claim.basis)
  ) {
    return null;
  }
  const key = boundRemoteText(claim.key, 128);
  if (!key || !isClaimValue(claim.value)) return null;
  const value = Array.isArray(claim.value)
    ? claim.value
        .slice(0, 32)
        .map((item) => boundRemoteText(item, 512))
    : typeof claim.value === "string"
      ? boundRemoteText(claim.value, 2_000)
      : claim.value;
  return { key, value, basis: claim.basis };
}

function isClaimValue(value: unknown): value is ProviderClaim["value"] {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function normalizeOptionalText(
  value: string | undefined,
  maxChars: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = boundRemoteText(value, maxChars);
  return normalized || null;
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function boundRemoteText(value: string, maxChars: number): string {
  if (typeof value !== "string") return "";
  return redactUrlsInText(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function rankCandidates(
  candidates: readonly NormalizedCandidate[],
): RankedGroup[] {
  const groups = new Map<string, RankedGroup>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.canonicalKey);
    if (!existing) {
      groups.set(candidate.canonicalKey, {
        key: candidate.canonicalKey,
        primary: candidate,
        candidates: [candidate],
        score: 1 / (RRF_K + candidate.providerRank),
      });
      continue;
    }
    if (
      existing.candidates.some(
        (item) => item.providerId === candidate.providerId,
      )
    ) {
      continue;
    }
    existing.candidates.push(candidate);
    existing.score += 1 / (RRF_K + candidate.providerRank);
    if (compareCandidate(candidate, existing.primary) < 0) {
      existing.primary = candidate;
    }
  }
  return [...groups.values()].sort((left, right) => {
    const byScore = right.score - left.score;
    if (byScore !== 0) return byScore;
    const byPrimary = compareCandidate(left.primary, right.primary);
    if (byPrimary !== 0) return byPrimary;
    return left.key.localeCompare(right.key);
  });
}

function compareCandidate(
  left: NormalizedCandidate,
  right: NormalizedCandidate,
): number {
  return (
    left.providerOrder - right.providerOrder ||
    left.providerRank - right.providerRank ||
    left.canonicalKey.localeCompare(right.canonicalKey)
  );
}

function toSearchResult(
  group: RankedGroup,
  position: number,
  sessionId: string,
  resultId: string,
  limits: SearchLimits,
): SearchResult {
  const signals = [...group.candidates]
    .sort(compareCandidate)
    .map((candidate) => ({
      provider_id: candidate.providerId,
      provider_rank: candidate.providerRank,
      provider_score: candidate.providerScore,
    }));
  const evidenceIds = unique(
    group.candidates.map((candidate) => candidate.evidenceId),
  );
  const claims: SearchClaim[] = [];
  for (const candidate of [...group.candidates].sort(compareCandidate)) {
    for (const claim of candidate.claims) {
      if (claims.length >= limits.max_claims) break;
      claims.push({
        ...claim,
        provider_id: candidate.providerId,
        evidence_ids: [candidate.evidenceId],
        untrusted: true,
      });
    }
  }
  return {
    result_id: resultId,
    kind: group.primary.kind,
    title: group.primary.title,
    summary: group.primary.summary,
    display_url: group.primary.displayUrl,
    origin: group.primary.origin,
    mime_type: group.primary.mimeType,
    capabilities: unique(
      group.candidates.flatMap((candidate) => candidate.capabilities),
    ).slice(0, limits.max_capabilities),
    published_at: group.primary.publishedAt,
    modified_at: group.primary.modifiedAt,
    rank: {
      position,
      method: "reciprocal_rank_fusion",
      signals,
      explanation:
        "Deterministic reciprocal-rank fusion over provider positions; native provider scores are retained only as untrusted signals.",
    },
    claims,
    evidence_ids: evidenceIds,
    followups: [
      {
        id: "inspect",
        label: "Inspect public discovery surfaces",
        operation: "agent_inspect",
        session_id: sessionId,
        result_id: resultId,
        automatic: false,
        requires_explicit_choice: true,
        authority: "none",
      },
      {
        id: "plan",
        label: "Preview Browser consequences",
        operation: "browser_plan_result",
        session_id: sessionId,
        result_id: resultId,
        automatic: false,
        requires_explicit_choice: true,
        authority: "none",
      },
      {
        id: "open",
        label: "Open in the bounded browser",
        operation: "browser_open_result",
        session_id: sessionId,
        result_id: resultId,
        automatic: false,
        requires_explicit_choice: true,
        authority: "none",
      },
    ],
    untrusted: true,
    trust: "untrusted",
    authority: "none",
    automatic_action: "never",
  };
}

function toEvidence(
  evidenceId: string,
  providerId: string,
  observedAt: string,
  batch: ProviderSearchBatch,
  limits: SearchLimits,
): SearchEvidence {
  const observation = batch.observation;
  if (
    !Number.isSafeInteger(observation.status) ||
    observation.status < 100 ||
    observation.status > 599 ||
    !Number.isSafeInteger(observation.bytes) ||
    observation.bytes < 0 ||
    !/^[a-f0-9]{64}$/i.test(observation.sha256)
  ) {
    throw new Error("invalid observation");
  }
  const requestUrl = parsePublicTarget(
    observation.request_url,
    limits.max_url_chars,
  );
  const finalUrl = parsePublicTarget(
    observation.final_url,
    limits.max_url_chars,
  );
  requestUrl.hash = "";
  finalUrl.hash = "";
  return {
    evidence_id: evidenceId,
    provider_id: providerId,
    observed_at: observedAt,
    basis: "transport_observation",
    request: {
      method: "GET",
      url: redactSearchUrl(requestUrl, limits.max_url_chars),
      query_values_redacted: true,
    },
    response: {
      status: observation.status,
      final_url: redactSearchUrl(finalUrl, limits.max_url_chars),
      query_values_redacted: true,
      media_type: normalizeOptionalText(observation.media_type ?? undefined, 256),
      bytes: observation.bytes,
      sha256: observation.sha256.toLowerCase(),
    },
    untrusted: true,
    boundary_codes: unique(
      observation.boundary_codes
        .map((code) => boundRemoteText(code, 128))
        .filter(Boolean),
    ).slice(0, 64),
  };
}

function toProviderObservation(
  outcome: ProviderOutcome,
): SearchProviderObservation {
  if (outcome.state === "complete") {
    return {
      provider_id: outcome.provider.id,
      state: "complete",
      result_count: outcome.candidates.length,
      next_cursor_present: Boolean(outcome.batch.next_cursor),
      boundary: outcome.provider.boundary,
      evidence_ids: [outcome.evidence.evidence_id],
      diagnostic_codes: outcome.diagnostics.map((item) => item.code),
    };
  }
  return {
    provider_id: outcome.provider.id,
    state: outcome.state,
    result_count: 0,
    next_cursor_present: false,
    boundary: outcome.provider.boundary,
    evidence_ids: [],
    diagnostic_codes: [outcome.diagnostic.code],
  };
}

function safeProviderDiagnosticCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return SAFE_PROVIDER_DIAGNOSTIC_CODES.has(error.code)
      ? error.code
      : "provider_unavailable";
  }
  return "provider_unavailable";
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  let listener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}

function boundOpaqueCursor(cursor: string): string {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 8_192) {
    throw new Error("invalid provider cursor");
  }
  return cursor;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function intersects<T>(left: readonly T[], right: readonly T[]): boolean {
  const values = new Set(left);
  return right.some((item) => values.has(item));
}

function validProviderBoundary(
  boundary: SearchProvider["boundary"],
): boolean {
  return (
    boundary !== null &&
    typeof boundary === "object" &&
    typeof boundary.mode === "string" &&
    boundary.mode.trim().length > 0 &&
    boundary.mode.length <= 256 &&
    (boundary.credentials === "omitted" ||
      boundary.credentials === "provider_owned") &&
    boundary.query_disclosed === true &&
    typeof boundary.connected_address_pinning === "boolean" &&
    typeof boundary.statement === "string" &&
    boundary.statement.trim().length > 0 &&
    boundary.statement.length <= 2_000
  );
}

function redactSearchUrl(url: URL, maxChars: number): string {
  const candidate = new URL(url);
  candidate.hash = "";
  let output = redactUrlForOutput(candidate.href);
  if (output.length <= maxChars) return output;
  candidate.search = "";
  output = candidate.href;
  if (output.length <= maxChars) return output;
  throw new Error("url");
}

function dedupeDiagnostics(
  diagnostics: readonly SearchDiagnostic[],
): SearchDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.provider_id}:${diagnostic.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
