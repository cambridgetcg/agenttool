/**
 * Exit door: copy the hosted continuity core into a local agent-data/v1 node.
 *
 * Direction is one way: hosted → local copy. The exporter reads the hosted
 * API with the project transport and writes into a separately configured
 * `@agenttool/data` node through `DataClient`. The two bearers never meet:
 * hosted reads go only to the hosted origin, node writes go only to the node,
 * and the node bearer is refused when it equals the project API key.
 *
 * What it never does:
 *   - change hosted state (GET only; never `GET /v1/memories/:id`, which
 *     writes `accessed_at`, and never search, which costs credits);
 *   - decrypt, validate, or re-encrypt ciphertext;
 *   - export vault secret values or identity backup blobs (index only — the
 *     custody decision is pending, and the manifest says so);
 *   - tombstone, delete, or re-import anything. Re-import into hosted memory
 *     is a separate, explicit projection (AGENT-DATA-PROTOCOL §11).
 *
 * Completeness is reported, not assumed. A store is `complete` only when its
 * walk reached the host's own end-of-walk signal (`page.has_more: false`, a
 * short thoughts page, or an unbounded list). A host that returns no `page`
 * object yields `window_only` with reason `host_has_no_cursor`; the exporter
 * does not try to partition its way around a missing cursor.
 *
 * Parity twin: `packages/sdk-py/src/agenttool/exit_door.py`. Shared vectors:
 * `tests/fixtures/agent-data-record-id-vectors.json`.
 */

import {
  agentDataRecordId,
  agentDataTextRecordIdentity,
  canonicalJson,
  sha256Hex,
  utf8ByteLength,
  type AgentDataRecordIdentity,
} from "./_agent-data-id.js";
import { errorFromResponse, type HttpConfig } from "./_http.js";
import { encodePathSegment } from "./_url.js";
import type { DataClient, DataRecord } from "./data.js";
import { AgentToolError } from "./errors.js";

export const EXIT_ITEM_SCHEMA = "agenttool-exit-item/v1" as const;
export const EXIT_INDEX_SCHEMA = "agenttool-exit-index/v1" as const;
export const EXIT_MANIFEST_SCHEMA = "agenttool-exit-manifest/v1" as const;
export const EXIT_PLAN_SCHEMA = "agenttool-exit-plan/v1" as const;
export const EXIT_VERIFY_SCHEMA = "agenttool-exit-verify/v1" as const;

/** Hosted stores the v1 exporter can copy. Order is the walk order. */
export type ExitStore =
  | "memories"
  | "chronicle"
  | "strands"
  | "strand_thoughts"
  | "correspondence"
  | "covenants"
  | "identities"
  | "identity_keys"
  | "vault_index"
  | "backup_index";

export const EXIT_STORES: readonly ExitStore[] = Object.freeze([
  "memories",
  "chronicle",
  "strands",
  "strand_thoughts",
  "correspondence",
  "covenants",
  "identities",
  "identity_keys",
  "vault_index",
  "backup_index",
]);

/**
 * Fields removed from an item before it is written, because they change on
 * read or on unrelated activity and would otherwise mint a new record every
 * run. Copied into each store's `fields_not_exported` in the manifest.
 */
export const EXIT_VOLATILE_FIELDS: Readonly<Record<ExitStore, readonly string[]>> =
  Object.freeze({
    memories: Object.freeze(["accessed_at"]),
    chronicle: Object.freeze([]),
    strands: Object.freeze(["last_thought_at", "last_thought_seq", "updated_at"]),
    strand_thoughts: Object.freeze([]),
    correspondence: Object.freeze([]),
    covenants: Object.freeze([]),
    identities: Object.freeze([]),
    identity_keys: Object.freeze([]),
    vault_index: Object.freeze([]),
    backup_index: Object.freeze([]),
  });

/** What every exit manifest declares it is not. */
export const EXIT_NON_CLAIMS: readonly string[] = Object.freeze([
  "copy only; hosted data unchanged",
  "not a snapshot (see walk semantics)",
  "exported memories are agent data, not memory (AGENT-DATA-PROTOCOL §11)",
  "signatures carried, not verified",
  "ciphertext not decrypted or validated",
  "vault secret values and identity backup blobs not exported: custody decision pending (index only)",
]);

const EXIT_MEDIA_TYPE = "application/json";
const EXIT_COLLECTOR = "text";
const EXIT_PROVENANCE_ACTIVITY = "agenttool-exit-door/v1 copy";
const COVENANT_STATUSES = [
  "proposed",
  "active",
  "paused",
  "dissolved",
  "rejected",
  "expired",
  "withdrawn",
] as const;
const PAGE_LIMITS = {
  memories: 100,
  chronicle: 200,
  strands: 200,
  thoughts: 500,
  repositories: 200,
  events: 200,
} as const;
/** Bytes reserved in an index chunk's collect body for everything but its entries. */
const INDEX_CHUNK_RESERVE = 4096;

// ─── Public shapes ──────────────────────────────────────────────────────

export type ExitStoreStatus = "complete" | "window_only" | "skipped" | "failed";
export type ExitOverall = "complete" | "partial" | "failed";

export interface ExitWalk {
  filter: Record<string, unknown>;
  pages: number;
  returned: number;
  exhausted: boolean;
}

export interface ExitItemSkip {
  hosted_id: string | null;
  reason: string;
  bytes?: number;
}

export interface ExitFieldNotExported {
  field: string;
  reason: string;
}

/** One progress event. Callers may log it; it carries no hosted content. */
export interface ExitProgress {
  store: ExitStore;
  event: "page" | "done";
  pages?: number;
  returned?: number;
  status?: ExitStoreStatus;
}

export interface ExitPlanOptions {
  stores?: readonly ExitStore[];
  /** Scope to one identity where the host offers a filter (see README). */
  identity_id?: string;
  signal?: AbortSignal;
  on_progress?: (event: ExitProgress) => void;
}

export interface ExitExportOptions extends ExitPlanOptions {
  /** An existing collection on the target node. */
  collection_id: string;
  /** Permit a node URL that is not loopback. Off by default. */
  allow_remote_node?: boolean;
}

export interface ExitVerifyOptions {
  allow_remote_node?: boolean;
  signal?: AbortSignal;
}

export interface ExitPlanStore {
  store: ExitStore;
  status: ExitStoreStatus;
  reason?: string;
  first_page_as_of: string | null;
  walks: ExitWalk[];
  items: number;
  bytes: number;
  largest_item_bytes: number;
  item_skips: ExitItemSkip[];
  fields_not_exported: ExitFieldNotExported[];
  server_exclusions: string[];
}

/** A hosted-only dry run. Nothing is written anywhere. */
export interface ExitPlan {
  schema: typeof EXIT_PLAN_SCHEMA;
  hosted: ExitHostedDescriptor;
  overall: ExitOverall;
  stores: ExitPlanStore[];
  non_claims: string[];
}

export interface ExitHostedDescriptor {
  origin: string;
  auth_mode: "api_key" | "transport";
  identity_id: string | null;
}

export interface ExitManifestStore {
  store: ExitStore;
  status: ExitStoreStatus;
  reason?: string;
  first_page_as_of: string | null;
  walks: ExitWalk[];
  records: { written: number; inserted: number; existing: number };
  current: {
    record_count: number;
    record_ids_sha256: string;
    index_record_ids: string[];
  };
  item_skips: ExitItemSkip[];
  fields_not_exported: ExitFieldNotExported[];
  server_exclusions: string[];
}

/** The completeness record written to `exit-run/<run_id>` after every item. */
export interface ExitManifest {
  schema: typeof EXIT_MANIFEST_SCHEMA;
  run_id: string;
  started_at: string;
  finished_at: string;
  exporter: { package: string; version: string };
  hosted: ExitHostedDescriptor;
  node: { node_id: string; collection_id: string; max_body_bytes: number };
  overall: ExitOverall;
  stores: ExitManifestStore[];
  non_claims: string[];
}

export interface ExitExportResult {
  /** Pass this to `verify()`. */
  manifest_record_id: string;
  manifest: ExitManifest;
}

export interface ExitVerifyMismatch {
  record_id: string;
  reason: string;
}

export interface ExitVerifyStore {
  store: ExitStore;
  checked: number;
  mismatches: ExitVerifyMismatch[];
}

export interface ExitVerifyResult {
  schema: typeof EXIT_VERIFY_SCHEMA;
  manifest_record_id: string;
  run_id: string | null;
  manifest_overall: ExitOverall | null;
  verified: boolean;
  checked: number;
  mismatches: ExitVerifyMismatch[];
  stores: ExitVerifyStore[];
}

/** The text-collector fields one hosted item becomes. */
export interface ExitItemRecord {
  hosted_id: string;
  text: string;
  source_uri: string;
  external_id: string;
  key: string;
}

/** Parent context for nested stores (thoughts under a strand, keys under an identity). */
export interface ExitItemContext {
  strand_id?: string;
  identity_id?: string;
}

/** @internal Wiring supplied by `AgentTool`; never the bearer values. */
export interface ExitDoorWiring {
  sdkPackage: string;
  sdkVersion: string;
  authMode: "api_key" | "transport";
  /** sha256 hex of the project API key in direct-bearer mode. */
  projectKeyDigest?: string;
  /** Configured node URL, if any. */
  nodeBaseUrl?: string;
  /** sha256 hex of the configured node bearer, if any. */
  nodeTokenDigest?: string;
  /** Resolves the separately configured data client; throws when absent. */
  data: () => DataClient;
}

// ─── Item shaping (shared with the Python twin through vectors) ──────────

type JsonObject = Record<string, unknown>;

interface StoreSpec {
  hostedId(item: JsonObject): unknown;
  route(id: string, item: JsonObject, context: ExitItemContext): string;
  identityId(item: JsonObject, context: ExitItemContext): unknown;
  createdAt(item: JsonObject): unknown;
  encryptedFields(item: JsonObject): string[];
  fieldsNotExported: readonly ExitFieldNotExported[];
  serverExclusions: readonly string[];
}

const NO_FIELDS: readonly ExitFieldNotExported[] = Object.freeze([]);
const NO_EXCLUSIONS: readonly string[] = Object.freeze([]);

function volatile(store: ExitStore): ExitFieldNotExported[] {
  return EXIT_VOLATILE_FIELDS[store].map((field) => ({ field, reason: "volatile" }));
}

const STORE_SPECS: Readonly<Record<ExitStore, StoreSpec>> = {
  memories: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/memories/${encodePathSegment(id)}`,
    identityId: (item) => item.identity_id,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: [
      { field: "embedding", reason: "hosted_returns_has_embedding_only" },
      ...volatile("memories"),
    ],
    serverExclusions: ["expired memories"],
  },
  chronicle: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/chronicle/${encodePathSegment(id)}`,
    identityId: (item) => item.agent_id,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: NO_FIELDS,
    serverExclusions: NO_EXCLUSIONS,
  },
  strands: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/strands/${encodePathSegment(id)}`,
    identityId: (item) => item.identity_id,
    createdAt: (item) => item.created_at,
    encryptedFields: (item) => [
      ...(item.topic_encrypted === true ? ["topic"] : []),
      ...(item.mood_encrypted === true ? ["mood"] : []),
      ...(item.state_ciphertext !== null && item.state_ciphertext !== undefined
        ? ["state_ciphertext"]
        : []),
    ],
    fieldsNotExported: volatile("strands"),
    serverExclusions: NO_EXCLUSIONS,
  },
  strand_thoughts: {
    hostedId: (item) => item.id,
    route: (id, item, context) => {
      const strandId = context.strand_id ?? item.strand_id;
      if (typeof strandId !== "string" || strandId === "") {
        throw exitError("exit_item_invalid", "A strand thought needs its strand id.");
      }
      return `/v1/strands/${encodePathSegment(strandId)}/thoughts/${encodePathSegment(id)}`;
    },
    identityId: (_item, context) => context.identity_id ?? null,
    createdAt: (item) => item.created_at,
    encryptedFields: (item) => [
      "ciphertext",
      ...(item.kind_encrypted === true ? ["kind"] : []),
    ],
    fieldsNotExported: NO_FIELDS,
    serverExclusions: NO_EXCLUSIONS,
  },
  correspondence: {
    hostedId: (item) => objectField(item, "event").event_id,
    route: (id) => `/v1/correspondence/events/${encodePathSegment(id)}`,
    identityId: () => null,
    createdAt: (item) => objectField(item, "receipt").received_at,
    encryptedFields: () => [],
    fieldsNotExported: [{ field: "claims", reason: "derivable_from_events" }],
    serverExclusions: NO_EXCLUSIONS,
  },
  covenants: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/covenants/${encodePathSegment(id)}`,
    identityId: (item) => item.agent_id,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: NO_FIELDS,
    serverExclusions: NO_EXCLUSIONS,
  },
  identities: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/identities/${encodePathSegment(id)}`,
    identityId: (item) => item.id,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: NO_FIELDS,
    serverExclusions: NO_EXCLUSIONS,
  },
  identity_keys: {
    hostedId: (item) => item.kid,
    route: (id, _item, context) => {
      if (typeof context.identity_id !== "string" || context.identity_id === "") {
        throw exitError("exit_item_invalid", "An identity key needs its identity id.");
      }
      return `/v1/identities/${encodePathSegment(context.identity_id)}/keys/${encodePathSegment(id)}`;
    },
    identityId: (_item, context) => context.identity_id ?? null,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: NO_FIELDS,
    serverExclusions: NO_EXCLUSIONS,
  },
  vault_index: {
    hostedId: (item) => item.name,
    route: (id) => `/v1/vault/${encodePathSegment(id)}`,
    identityId: () => null,
    createdAt: (item) => item.created_at,
    encryptedFields: () => [],
    fieldsNotExported: [{ field: "value", reason: "custody_decision_pending" }],
    serverExclusions: ["soft-deleted vault secrets"],
  },
  backup_index: {
    hostedId: (item) => item.id,
    route: (id) => `/v1/identity/backup/${encodePathSegment(id)}`,
    identityId: (item) => item.agent_id ?? item.agentId,
    createdAt: (item) => item.created_at ?? item.createdAt,
    encryptedFields: () => [],
    fieldsNotExported: [
      { field: "blob_base64", reason: "custody_decision_pending" },
      { field: "nonce", reason: "custody_decision_pending" },
    ],
    serverExclusions: ["revoked backups"],
  },
};

/**
 * The text-collector fields one hosted item becomes: canonical JSON of
 * `{schema, origin, store, item}` with the store's volatile fields removed,
 * `source_uri = <origin>/v1/<route>/<id>`, `external_id = <hosted id>`, and
 * `key = <store>/<hosted id>`. No `version` or `supersedes_id`: a changed
 * hosted item becomes a new record under the same key, and the manifest
 * names the current record per key.
 */
export function exitItemRecord(input: {
  origin: string;
  store: ExitStore;
  item: Record<string, unknown>;
  context?: ExitItemContext;
}): ExitItemRecord {
  const spec = STORE_SPECS[input.store];
  if (!spec) throw exitError("exit_store_unknown", `Unknown exit store: ${String(input.store)}.`);
  if (!isObject(input.item)) {
    throw exitError("exit_item_invalid", "A hosted item must be a JSON object.");
  }
  const hostedId = spec.hostedId(input.item);
  if (typeof hostedId !== "string" || hostedId === "") {
    throw exitError("hosted_item_without_id", "A hosted item carried no usable id.");
  }
  if (!isAddressable(hostedId)) {
    throw exitError("hosted_id_not_addressable", "A hosted id is a URL dot segment.");
  }
  const volatileFields = new Set(EXIT_VOLATILE_FIELDS[input.store]);
  const kept: JsonObject = {};
  for (const [field, value] of Object.entries(input.item)) {
    if (!volatileFields.has(field)) kept[field] = value;
  }
  const origin = input.origin.replace(/\/+$/, "");
  return {
    hosted_id: hostedId,
    text: canonicalJson({
      schema: EXIT_ITEM_SCHEMA,
      origin,
      store: input.store,
      item: kept,
    }),
    source_uri: `${origin}${spec.route(hostedId, input.item, input.context ?? {})}`,
    external_id: hostedId,
    key: `${input.store}/${hostedId}`,
  };
}

// ─── Client ─────────────────────────────────────────────────────────────

interface StoreRun {
  store: ExitStore;
  status: ExitStoreStatus;
  reason?: string;
  first_page_as_of: string | null;
  walks: ExitWalk[];
  written: number;
  inserted: number;
  existing: number;
  items: number;
  bytes: number;
  largest: number;
  /** key → current record for this run, in first-seen order. */
  current: Map<string, { hosted_id: string; record_id: string }>;
  item_skips: ExitItemSkip[];
  /** Parent items visited for a nested store (strands for thoughts, identities for keys). */
  parents_visited: number;
}

type Sink = (run: StoreRun, item: JsonObject, context: ExitItemContext) => Promise<void>;

interface NodeTarget {
  data: DataClient;
  node_id: string;
  collection_id: string;
  schema_version: string;
  max_body_bytes: number;
  max_record_bytes: number;
}

/** The exporter's own decisions. They carry no server text. */
class ExitDoorError extends AgentToolError {}

/** Hosted read failures fail one store; they never abort the whole run. */
class HostedReadError extends AgentToolError {}

/**
 * Copy the hosted continuity core into a local agent-data/v1 node.
 *
 * Reached through `at.exitDoor`. `plan()` reads hosted data only; `export()`
 * writes items, chunked index records, and one completeness manifest to an
 * existing node collection; `verify()` re-reads and re-hashes every record a
 * manifest names. Every error leaving this client is reduced to a stable
 * `code`, `status`, and `retryAfter`.
 */
export class ExitDoorClient {
  /** @internal */
  constructor(
    private readonly http: HttpConfig,
    private readonly wiring: ExitDoorWiring,
  ) {}

  /** Walk the hosted stores and report what an export would copy. Writes nothing. */
  async plan(options: ExitPlanOptions = {}): Promise<ExitPlan> {
    try {
      return await this.planInner(options);
    } catch (error) {
      throw reduce(error);
    }
  }

  private async planInner(options: ExitPlanOptions): Promise<ExitPlan> {
    const selected = selectStores(options.stores);
    const identityId = optionalIdentity(options.identity_id);
    const origin = this.http.baseUrl;
    const sink: Sink = async (run, item, context) => {
      let record: ExitItemRecord;
      try {
        record = exitItemRecord({ origin, store: run.store, item, context });
      } catch (error) {
        run.item_skips.push({ hosted_id: hostedIdOf(run.store, item), reason: codeOf(error) });
        return;
      }
      if (run.current.has(record.key)) return;
      const bytes = utf8ByteLength(record.text);
      run.current.set(record.key, { hosted_id: record.hosted_id, record_id: "" });
      run.items += 1;
      run.bytes += bytes;
      run.largest = Math.max(run.largest, bytes);
    };
    const runs = await this.walkStores(selected, identityId, sink, options);
    const stores = runs.map((run): ExitPlanStore => ({
      store: run.store,
      status: run.status,
      ...(run.reason !== undefined ? { reason: run.reason } : {}),
      first_page_as_of: run.first_page_as_of,
      walks: run.walks,
      items: run.items,
      bytes: run.bytes,
      largest_item_bytes: run.largest,
      item_skips: run.item_skips,
      fields_not_exported: [...STORE_SPECS[run.store].fieldsNotExported],
      server_exclusions: [...STORE_SPECS[run.store].serverExclusions],
    }));
    return {
      schema: EXIT_PLAN_SCHEMA,
      hosted: this.hostedDescriptor(identityId),
      overall: overallOf(runs),
      stores,
      non_claims: [...EXIT_NON_CLAIMS],
    };
  }

  /**
   * Copy the selected stores into `collection_id` on the configured node and
   * write a completeness manifest. Every guard runs before the first write.
   * If the run crashes, no manifest is written; re-running is safe because
   * record writes are idempotent.
   */
  async export(options: ExitExportOptions): Promise<ExitExportResult> {
    try {
      return await this.exportInner(options);
    } catch (error) {
      throw reduce(error);
    }
  }

  /** Re-read every record a manifest names and re-hash it. Read-only. */
  async verify(
    manifestRecordId: string,
    options: ExitVerifyOptions = {},
  ): Promise<ExitVerifyResult> {
    try {
      return await this.verifyInner(manifestRecordId, options);
    } catch (error) {
      throw reduce(error);
    }
  }

  // ── export ────────────────────────────────────────────────────────────

  private async exportInner(options: ExitExportOptions): Promise<ExitExportResult> {
    if (!options || typeof options.collection_id !== "string" || options.collection_id === "") {
      throw exitError("exit_collection_required", "export() needs collection_id.", {
        hint: "Pass the id of an existing collection on the local node.",
      });
    }
    const selected = selectStores(options.stores);
    const identityId = optionalIdentity(options.identity_id);
    const target = await this.prepareNode(options.collection_id, options.allow_remote_node === true);
    const origin = this.http.baseUrl;
    const runId = globalThis.crypto.randomUUID();
    const startedAt = new Date().toISOString();

    const sink: Sink = async (run, item, context) => {
      options.signal?.throwIfAborted();
      let record: ExitItemRecord;
      try {
        record = exitItemRecord({ origin, store: run.store, item, context });
      } catch (error) {
        run.item_skips.push({ hosted_id: hostedIdOf(run.store, item), reason: codeOf(error) });
        return;
      }
      const spec = STORE_SPECS[run.store];
      const metadata = {
        store: run.store,
        hosted_id: record.hosted_id,
        identity_id: stringOrNull(spec.identityId(item, context)),
        created_at: stringOrNull(spec.createdAt(item)),
        encryption: { encrypted_fields: spec.encryptedFields(item), verified: false },
        embedding: { present: run.store === "memories" && item.has_embedding === true, exported: false },
      };
      const written = await this.writeText(target, run, {
        text: record.text,
        source_uri: record.source_uri,
        external_id: record.external_id,
        key: record.key,
        metadata,
        observed_at: startedAt,
      }, record.hosted_id);
      if (written) run.items += 1;
    };

    const runs = await this.walkStores(selected, identityId, sink, options);

    const stores: ExitManifestStore[] = [];
    for (const run of runs) {
      const entries = [...run.current.entries()]
        .map(([key, value]) => ({ key, hosted_id: value.hosted_id, record_id: value.record_id }))
        .sort((left, right) => compareStrings(left.key, right.key));
      const indexRecordIds = await this.writeIndex(target, runId, run.store, entries, startedAt);
      stores.push({
        store: run.store,
        status: run.status,
        ...(run.reason !== undefined ? { reason: run.reason } : {}),
        first_page_as_of: run.first_page_as_of,
        walks: run.walks,
        records: { written: run.written, inserted: run.inserted, existing: run.existing },
        current: {
          record_count: entries.length,
          record_ids_sha256: recordIdsDigest(entries.map((entry) => entry.record_id)),
          index_record_ids: indexRecordIds,
        },
        item_skips: run.item_skips,
        fields_not_exported: [...STORE_SPECS[run.store].fieldsNotExported],
        server_exclusions: [...STORE_SPECS[run.store].serverExclusions],
      });
    }

    const manifest: ExitManifest = {
      schema: EXIT_MANIFEST_SCHEMA,
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exporter: { package: this.wiring.sdkPackage, version: this.wiring.sdkVersion },
      hosted: this.hostedDescriptor(identityId),
      node: {
        node_id: target.node_id,
        collection_id: target.collection_id,
        max_body_bytes: target.max_body_bytes,
      },
      overall: overallOf(runs),
      stores,
      non_claims: [...EXIT_NON_CLAIMS],
    };
    const manifestRecordId = await this.writeRequired(target, {
      text: canonicalJson(manifest),
      source_uri: `urn:agenttool:exit-door:run:${runId}`,
      external_id: runId,
      key: `exit-run/${runId}`,
      metadata: { kind: "exit-manifest", run_id: runId, overall: manifest.overall },
      observed_at: startedAt,
    }, "exit_manifest_too_large");
    return { manifest_record_id: manifestRecordId, manifest };
  }

  /** Read-only node checks. Every one passes before the first write. */
  private async prepareNode(collectionId: string, allowRemote: boolean): Promise<NodeTarget> {
    const data = this.nodeGuards(allowRemote);
    const manifest = asObject(await data.manifest());
    if (manifest.protocol !== "agent-data/v1") {
      throw exitError("data_node_protocol_unsupported", "The node does not report agent-data/v1.");
    }
    const collectors = Array.isArray(manifest.collectors) ? manifest.collectors : [];
    if (!collectors.some((entry) => isObject(entry) && entry.collector_id === EXIT_COLLECTOR)) {
      throw exitError("data_node_text_collector_missing", "The node does not offer the text collector.");
    }
    const limits = isObject(manifest.limits) ? manifest.limits : {};
    const maxBody = positiveInteger(limits.max_body_bytes) ?? 1024 * 1024;
    const nodeRecordLimit = positiveInteger(limits.max_record_bytes) ?? 10 * 1024 * 1024;
    const listed = asObject(await data.collections());
    const collections = Array.isArray(listed.collections) ? listed.collections : [];
    const collection = collections.find(
      (entry) => isObject(entry) && (entry.id === collectionId || entry.collection_id === collectionId),
    ) as JsonObject | undefined;
    if (!collection) {
      throw exitError("data_node_collection_not_found", "The target collection is not listed on the node.", {
        hint: "Create the collection on the node first; the exporter never defines collections.",
      });
    }
    const schema = isObject(collection.schema) ? collection.schema : {};
    const schemaVersion = typeof schema.version === "string" && schema.version !== "" ? schema.version : "1";
    const policy = isObject(collection.policy) ? collection.policy : {};
    if (Array.isArray(policy.allowed_media_types) && !policy.allowed_media_types.includes(EXIT_MEDIA_TYPE)) {
      throw exitError("data_node_collection_refuses_json", "The target collection does not allow application/json.");
    }
    const policyLimit = positiveInteger(policy.max_record_bytes);
    return {
      data,
      node_id: typeof manifest.node_id === "string" ? manifest.node_id : "",
      collection_id: collectionId,
      schema_version: schemaVersion,
      max_body_bytes: maxBody,
      max_record_bytes: policyLimit === undefined ? nodeRecordLimit : Math.min(policyLimit, nodeRecordLimit),
    };
  }

  /** Configuration, loopback, and bearer-separation guards. No I/O. */
  private nodeGuards(allowRemote: boolean): DataClient {
    const data = this.wiring.data();
    const baseUrl = this.wiring.nodeBaseUrl ?? "";
    if (!allowRemote && !isLoopbackUrl(baseUrl)) {
      throw exitError("data_node_not_loopback", "The data node URL is not a loopback address.", {
        hint: "Point at a local node, or pass allow_remote_node: true when the remote node is yours.",
      });
    }
    if (
      this.wiring.projectKeyDigest !== undefined
      && this.wiring.nodeTokenDigest !== undefined
      && this.wiring.projectKeyDigest === this.wiring.nodeTokenDigest
    ) {
      throw exitError(
        "data_node_token_reuses_project_bearer",
        "The data node token equals the AgentTool project API key.",
        { hint: "Give the node its own bearer; the project key must never reach the node." },
      );
    }
    return data;
  }

  /** Write one text record; returns false when it was skipped. */
  private async writeText(
    target: NodeTarget,
    run: StoreRun,
    input: {
      text: string;
      source_uri: string;
      external_id: string;
      key: string;
      metadata: JsonObject;
      observed_at: string;
    },
    hostedId: string,
  ): Promise<boolean> {
    const identity = this.identityFor(target, input);
    const expected = agentDataRecordId(identity);
    const previous = run.current.get(input.key);
    if (previous && previous.record_id === expected) return false;
    const body = this.collectBody(target, input);
    const bodyBytes = utf8ByteLength(canonicalJson(body));
    if (bodyBytes > target.max_body_bytes || identity.content.size > target.max_record_bytes) {
      run.item_skips.push({ hosted_id: hostedId, reason: "exceeds_node_limit", bytes: bodyBytes });
      return false;
    }
    let result: Awaited<ReturnType<DataClient["collect"]>>;
    try {
      result = await target.data.collect(body);
    } catch (error) {
      if (error instanceof AgentToolError && error.status === 413) {
        run.item_skips.push({ hosted_id: hostedId, reason: "node_refused_size", bytes: bodyBytes });
        return false;
      }
      throw error;
    }
    assertNoDrift(result.records?.[0], expected, identity);
    run.written += 1;
    run.inserted += typeof result.inserted === "number" ? result.inserted : 0;
    run.existing += typeof result.existing === "number" ? result.existing : 0;
    run.bytes += identity.content.size;
    run.current.set(input.key, { hosted_id: hostedId, record_id: expected });
    return true;
  }

  /** Write a record that must land (index chunks, the manifest). */
  private async writeRequired(
    target: NodeTarget,
    input: {
      text: string;
      source_uri: string;
      external_id: string;
      key: string;
      metadata: JsonObject;
      observed_at: string;
    },
    tooLargeCode: string,
  ): Promise<string> {
    const identity = this.identityFor(target, input);
    const expected = agentDataRecordId(identity);
    const body = this.collectBody(target, input);
    if (
      utf8ByteLength(canonicalJson(body)) > target.max_body_bytes
      || identity.content.size > target.max_record_bytes
    ) {
      throw exitError(tooLargeCode, "A required exit record exceeds the node's size limit.");
    }
    const result = await target.data.collect(body);
    assertNoDrift(result.records?.[0], expected, identity);
    return expected;
  }

  private identityFor(
    target: NodeTarget,
    input: { text: string; source_uri: string; external_id: string; key: string },
  ): AgentDataRecordIdentity {
    return agentDataTextRecordIdentity({
      collection_id: target.collection_id,
      schema_version: target.schema_version,
      text: input.text,
      media_type: EXIT_MEDIA_TYPE,
      source_uri: input.source_uri,
      external_id: input.external_id,
      key: input.key,
    });
  }

  private collectBody(
    target: NodeTarget,
    input: {
      text: string;
      source_uri: string;
      external_id: string;
      key: string;
      metadata: JsonObject;
      observed_at: string;
    },
  ): { collection_id: string; collector_id: string; input: JsonObject } {
    return {
      collection_id: target.collection_id,
      collector_id: EXIT_COLLECTOR,
      input: {
        text: input.text,
        media_type: EXIT_MEDIA_TYPE,
        source_uri: input.source_uri,
        external_id: input.external_id,
        key: input.key,
        metadata: input.metadata,
        observed_at: input.observed_at,
        provenance: [{ activity: EXIT_PROVENANCE_ACTIVITY, at: input.observed_at }],
      },
    };
  }

  /** Chunk the current-id list into `exit-index/<run>/<store>/<n>` records. */
  private async writeIndex(
    target: NodeTarget,
    runId: string,
    store: ExitStore,
    entries: Array<{ key: string; hosted_id: string; record_id: string }>,
    observedAt: string,
  ): Promise<string[]> {
    // Two ceilings bound every chunk: the node's request body limit, where
    // the chunk text travels escaped inside JSON, and the collection's record
    // limit, which counts the text's own bytes. Packing against only the
    // first would make a policy-limited collection refuse every chunk.
    const bodyBudget = Math.max(target.max_body_bytes - INDEX_CHUNK_RESERVE, 1024);
    const recordBudget = target.max_record_bytes - utf8ByteLength(canonicalJson({
      schema: EXIT_INDEX_SCHEMA,
      run_id: runId,
      store,
      chunk: Number.MAX_SAFE_INTEGER,
      chunk_count: Number.MAX_SAFE_INTEGER,
      entries: [],
    }));
    const chunks: Array<typeof entries> = [];
    let current: typeof entries = [];
    let bodySize = 0;
    let recordSize = 0;
    for (const entry of entries) {
      const text = canonicalJson(entry);
      // +1 for the separating comma; the body cost also counts JSON escaping.
      const recordCost = utf8ByteLength(text) + 1;
      const bodyCost = utf8ByteLength(JSON.stringify(text)) + 1;
      if (
        current.length > 0
        && (bodySize + bodyCost > bodyBudget || recordSize + recordCost > recordBudget)
      ) {
        chunks.push(current);
        current = [];
        bodySize = 0;
        recordSize = 0;
      }
      current.push(entry);
      bodySize += bodyCost;
      recordSize += recordCost;
    }
    if (current.length > 0) chunks.push(current);
    const ids: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const key = `exit-index/${runId}/${store}/${index}`;
      ids.push(await this.writeRequired(target, {
        text: canonicalJson({
          schema: EXIT_INDEX_SCHEMA,
          run_id: runId,
          store,
          chunk: index,
          chunk_count: chunks.length,
          entries: chunks[index],
        }),
        source_uri: `urn:agenttool:exit-door:index:${runId}:${store}:${index}`,
        external_id: key,
        key,
        metadata: { kind: "exit-index", run_id: runId, store, chunk: index },
        observed_at: observedAt,
      }, "exit_index_chunk_too_large"));
    }
    return ids;
  }

  // ── verify ────────────────────────────────────────────────────────────

  private async verifyInner(
    manifestRecordId: string,
    options: ExitVerifyOptions,
  ): Promise<ExitVerifyResult> {
    if (typeof manifestRecordId !== "string" || !/^rec_[a-f0-9]{64}$/.test(manifestRecordId)) {
      throw exitError("exit_manifest_id_invalid", "verify() needs a manifest record id (rec_<64 hex>).");
    }
    const data = this.nodeGuards(options.allow_remote_node === true);
    const result: ExitVerifyResult = {
      schema: EXIT_VERIFY_SCHEMA,
      manifest_record_id: manifestRecordId,
      run_id: null,
      manifest_overall: null,
      verified: false,
      checked: 0,
      mismatches: [],
      stores: [],
    };
    const manifestRead = await readVerified(data, manifestRecordId, options.signal);
    result.checked += 1;
    if ("mismatch" in manifestRead) {
      result.mismatches.push({ record_id: manifestRecordId, reason: manifestRead.mismatch });
      return result;
    }
    const manifest = parseJsonObject(manifestRead.text);
    if (!manifest || manifest.schema !== EXIT_MANIFEST_SCHEMA || !Array.isArray(manifest.stores)) {
      result.mismatches.push({ record_id: manifestRecordId, reason: "not_an_exit_manifest" });
      return result;
    }
    result.run_id = typeof manifest.run_id === "string" ? manifest.run_id : null;
    result.manifest_overall = isOverall(manifest.overall) ? manifest.overall : null;

    for (const rawStore of manifest.stores) {
      if (!isObject(rawStore) || !isStore(rawStore.store)) {
        result.mismatches.push({ record_id: manifestRecordId, reason: "manifest_store_invalid" });
        continue;
      }
      const storeResult: ExitVerifyStore = { store: rawStore.store, checked: 0, mismatches: [] };
      result.stores.push(storeResult);
      const current = isObject(rawStore.current) ? rawStore.current : {};
      const indexIds = Array.isArray(current.index_record_ids) ? current.index_record_ids : [];
      const recordIds: string[] = [];
      let indexOk = true;
      for (const indexId of indexIds) {
        if (typeof indexId !== "string") {
          storeResult.mismatches.push({ record_id: String(indexId), reason: "index_id_invalid" });
          indexOk = false;
          continue;
        }
        const read = await readVerified(data, indexId, options.signal);
        storeResult.checked += 1;
        if ("mismatch" in read) {
          storeResult.mismatches.push({ record_id: indexId, reason: read.mismatch });
          indexOk = false;
          continue;
        }
        const index = parseJsonObject(read.text);
        if (!index || index.schema !== EXIT_INDEX_SCHEMA || index.store !== rawStore.store || !Array.isArray(index.entries)) {
          storeResult.mismatches.push({ record_id: indexId, reason: "not_an_exit_index" });
          indexOk = false;
          continue;
        }
        for (const entry of index.entries) {
          if (!isObject(entry) || typeof entry.record_id !== "string" || typeof entry.key !== "string") {
            storeResult.mismatches.push({ record_id: indexId, reason: "index_entry_invalid" });
            indexOk = false;
            continue;
          }
          recordIds.push(entry.record_id);
          const itemRead = await readVerified(data, entry.record_id, options.signal);
          storeResult.checked += 1;
          if ("mismatch" in itemRead) {
            storeResult.mismatches.push({ record_id: entry.record_id, reason: itemRead.mismatch });
          } else if (itemRead.record.key !== entry.key) {
            storeResult.mismatches.push({ record_id: entry.record_id, reason: "key_mismatch" });
          }
        }
      }
      if (indexOk) {
        if (current.record_count !== recordIds.length) {
          storeResult.mismatches.push({ record_id: manifestRecordId, reason: `record_count_mismatch:${rawStore.store}` });
        }
        if (current.record_ids_sha256 !== recordIdsDigest(recordIds)) {
          storeResult.mismatches.push({ record_id: manifestRecordId, reason: `record_ids_sha256_mismatch:${rawStore.store}` });
        }
      }
      result.checked += storeResult.checked;
      result.mismatches.push(...storeResult.mismatches);
    }
    result.verified = result.mismatches.length === 0;
    return result;
  }

  // ── hosted walks ──────────────────────────────────────────────────────

  private hostedDescriptor(identityId: string | null): ExitHostedDescriptor {
    return { origin: this.http.baseUrl, auth_mode: this.wiring.authMode, identity_id: identityId };
  }

  private async walkStores(
    selected: ReadonlySet<ExitStore>,
    identityId: string | null,
    sink: Sink,
    options: ExitPlanOptions,
  ): Promise<StoreRun[]> {
    const runs = new Map<ExitStore, StoreRun>();
    for (const store of EXIT_STORES) if (selected.has(store)) runs.set(store, newRun(store));
    const project = { scope: "project" };
    const progress = (run: StoreRun, event: ExitProgress) => {
      if (selected.has(run.store)) options.on_progress?.(event);
    };
    const signal = options.signal;
    const walker = new HostedWalker(this.http, signal, progress);

    const guarded = async (run: StoreRun, step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        if (!(error instanceof HostedReadError)) throw error;
        markFailed(run, error.code ?? "hosted_read_failed");
      }
    };

    const memories = runs.get("memories");
    if (memories) {
      await guarded(memories, () => walker.cursor(memories, {
        path: "/v1/memories",
        params: identityId ? { identity_id: identityId } : {},
        itemsKey: "memories",
        limit: PAGE_LIMITS.memories,
        filter: identityId ? { identity_id: identityId } : project,
      }, (item) => sink(memories, item, {})));
      done(memories, progress);
    }

    const chronicle = runs.get("chronicle");
    if (chronicle) {
      await guarded(chronicle, () => walker.cursor(chronicle, {
        path: "/v1/chronicle",
        params: identityId ? { agent_id: identityId } : {},
        itemsKey: "entries",
        limit: PAGE_LIMITS.chronicle,
        filter: identityId ? { agent_id: identityId } : project,
      }, (item) => sink(chronicle, item, {})));
      done(chronicle, progress);
    }

    if (selected.has("strands") || selected.has("strand_thoughts")) {
      const strands = runs.get("strands") ?? newRun("strands");
      const thoughts = runs.get("strand_thoughts");
      await guarded(strands, () => walker.cursor(strands, {
        path: "/v1/strands",
        params: { order: "created" },
        itemsKey: "strands",
        limit: PAGE_LIMITS.strands,
        filter: identityId
          ? { order: "created", identity_id: identityId, identity_filter: "client" }
          : { order: "created", scope: "project" },
      }, async (item) => {
        if (identityId && item.identity_id !== identityId) return;
        if (runs.has("strands")) await sink(strands, item, {});
        if (!thoughts || thoughts.status === "failed") return;
        const strandId = item.id;
        if (typeof strandId !== "string" || strandId === "") return;
        thoughts.parents_visited += 1;
        if (!isAddressable(strandId)) {
          thoughts.item_skips.push({ hosted_id: strandId, reason: "parent_id_not_addressable" });
          return;
        }
        const context: ExitItemContext = {
          strand_id: strandId,
          ...(typeof item.identity_id === "string" ? { identity_id: item.identity_id } : {}),
        };
        await guarded(thoughts, () => walker.thoughts(thoughts, strandId, (thought) =>
          sink(thoughts, thought, context)));
      }));
      if (runs.has("strands")) done(strands, progress);
      if (thoughts) {
        settleChild(thoughts, strands, "strands");
        summarizeThoughtWalks(thoughts);
        done(thoughts, progress);
      }
    }

    const correspondence = runs.get("correspondence");
    if (correspondence) {
      await guarded(correspondence, async () => {
        const repositories: string[] = [];
        const found = await walker.after(correspondence, {
          path: "/v1/correspondence/repositories",
          params: {},
          itemsKey: "repositories",
          limit: PAGE_LIMITS.repositories,
          filter: { walk: "repositories", scope: "project" },
          notFoundMeansNoCursor: true,
        }, async (item) => {
          if (typeof item.repository_id === "string" && item.repository_id !== "") {
            repositories.push(item.repository_id);
          }
        });
        if (!found) return;
        for (const repositoryId of repositories) {
          await walker.after(correspondence, {
            path: "/v1/correspondence/events",
            params: { repository_id: repositoryId },
            itemsKey: "events",
            limit: PAGE_LIMITS.events,
            filter: { walk: "events", repository_id: repositoryId },
            notFoundMeansNoCursor: false,
          }, (item) => sink(correspondence, item, {}));
        }
      });
      done(correspondence, progress);
    }

    const covenants = runs.get("covenants");
    if (covenants) {
      await guarded(covenants, async () => {
        for (const status of COVENANT_STATUSES) {
          await walker.list(covenants, {
            path: "/v1/covenants",
            params: { status, ...(identityId ? { agent_id: identityId } : {}) },
            itemsKey: "covenants",
            filter: { status, ...(identityId ? { agent_id: identityId } : { scope: "project" }) },
          }, (item) => sink(covenants, item, {}));
        }
      });
      done(covenants, progress);
    }

    if (selected.has("identities") || selected.has("identity_keys")) {
      const identities = runs.get("identities") ?? newRun("identities");
      const keys = runs.get("identity_keys");
      await guarded(identities, () => walker.list(identities, {
        path: "/v1/identities",
        params: {},
        itemsKey: "identities",
        filter: identityId ? { identity_id: identityId, identity_filter: "client" } : project,
      }, async (item) => {
        if (identityId && item.id !== identityId) return;
        if (runs.has("identities")) await sink(identities, item, {});
        if (!keys || keys.status === "failed") return;
        const id = item.id;
        if (typeof id !== "string" || id === "") return;
        keys.parents_visited += 1;
        if (!isAddressable(id)) {
          keys.item_skips.push({ hosted_id: id, reason: "parent_id_not_addressable" });
          return;
        }
        await guarded(keys, () => walker.list(keys, {
          path: identityKeysPath(id),
          params: {},
          itemsKey: "keys",
          filter: { identity_id: id },
        }, (key) => sink(keys, key, { identity_id: id })));
      }));
      if (runs.has("identities")) done(identities, progress);
      if (keys) {
        settleChild(keys, identities, "identities");
        done(keys, progress);
      }
    }

    const vault = runs.get("vault_index");
    if (vault) {
      await guarded(vault, () => walker.list(vault, {
        path: "/v1/vault",
        params: {},
        itemsKey: "secrets",
        filter: project,
      }, (item) => sink(vault, item, {})));
      done(vault, progress);
    }

    const backups = runs.get("backup_index");
    if (backups) {
      await guarded(backups, () => walker.list(backups, {
        path: "/v1/identity/backup",
        params: identityId ? { agent_id: identityId } : {},
        itemsKey: "backups",
        filter: identityId ? { agent_id: identityId } : project,
      }, (item) => sink(backups, item, {})));
      done(backups, progress);
    }

    return EXIT_STORES.filter((store) => runs.has(store)).map((store) => runs.get(store)!);
  }
}

/** GET-only hosted reader. Every request carries the project transport only. */
class HostedWalker {
  constructor(
    private readonly http: HttpConfig,
    private readonly signal: AbortSignal | undefined,
    private readonly progress: (run: StoreRun, event: ExitProgress) => void,
  ) {}

  /** Follow `page.next_cursor` until `page.has_more` is false. */
  async cursor(
    run: StoreRun,
    walk: { path: string; params: Record<string, string>; itemsKey: string; limit: number; filter: JsonObject },
    consume: (item: JsonObject) => Promise<void>,
  ): Promise<void> {
    const record: ExitWalk = { filter: walk.filter, pages: 0, returned: 0, exhausted: false };
    run.walks.push(record);
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const { body } = await this.get(walk.path, {
        ...walk.params,
        limit: String(walk.limit),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      const items = arrayOf(body, walk.itemsKey);
      record.pages += 1;
      record.returned += items.length;
      if (record.pages === 1 && run.first_page_as_of === null) {
        run.first_page_as_of = typeof body.as_of === "string" ? body.as_of : null;
      }
      for (const item of items) await consume(item);
      this.progress(run, { store: run.store, event: "page", pages: record.pages, returned: record.returned });
      const page = body.page;
      if (!isObject(page)) return markWindow(run, "host_has_no_cursor");
      if (page.has_more === false) {
        record.exhausted = true;
        return;
      }
      const next = page.next_cursor;
      if (page.has_more !== true || typeof next !== "string" || next === "") {
        return markWindow(run, "host_has_no_cursor");
      }
      if (seen.has(next)) throw hostedError("hosted_cursor_stalled", "The host repeated a cursor.");
      seen.add(next);
      cursor = next;
    }
  }

  /** Follow correspondence-family `page.next_after` until `has_more` is false. */
  async after(
    run: StoreRun,
    walk: {
      path: string;
      params: Record<string, string>;
      itemsKey: string;
      limit: number;
      filter: JsonObject;
      notFoundMeansNoCursor: boolean;
    },
    consume: (item: JsonObject) => Promise<void>,
  ): Promise<boolean> {
    const record: ExitWalk = { filter: walk.filter, pages: 0, returned: 0, exhausted: false };
    run.walks.push(record);
    let after: string | undefined;
    for (;;) {
      const response = await this.get(walk.path, {
        ...walk.params,
        limit: String(walk.limit),
        ...(after !== undefined ? { after } : {}),
      }, { allow404: walk.notFoundMeansNoCursor && record.pages === 0 });
      if (response.status === 404) {
        markWindow(run, "host_has_no_cursor");
        return false;
      }
      const body = response.body;
      const items = arrayOf(body, walk.itemsKey);
      record.pages += 1;
      record.returned += items.length;
      for (const item of items) await consume(item);
      this.progress(run, { store: run.store, event: "page", pages: record.pages, returned: record.returned });
      const page = body.page;
      if (!isObject(page)) {
        markWindow(run, "host_has_no_cursor");
        return true;
      }
      if (page.has_more === false) {
        record.exhausted = true;
        return true;
      }
      const next = page.next_after;
      if (page.has_more !== true || typeof next !== "string" || next === "") {
        markWindow(run, "host_has_no_cursor");
        return true;
      }
      if (next === after) throw hostedError("hosted_cursor_stalled", "The host repeated a position.");
      after = next;
    }
  }

  /** Thoughts walk by `since_seq` until a short page. */
  async thoughts(
    run: StoreRun,
    strandId: string,
    consume: (item: JsonObject) => Promise<void>,
  ): Promise<void> {
    const record: ExitWalk = { filter: { strand_id: strandId }, pages: 0, returned: 0, exhausted: false };
    run.walks.push(record);
    let since: number | undefined;
    for (;;) {
      const { body } = await this.get(thoughtsPath(strandId), {
        limit: String(PAGE_LIMITS.thoughts),
        ...(since !== undefined ? { since_seq: String(since) } : {}),
      });
      const items = arrayOf(body, "thoughts");
      record.pages += 1;
      record.returned += items.length;
      for (const item of items) await consume(item);
      if (items.length < PAGE_LIMITS.thoughts) {
        record.exhausted = true;
        return;
      }
      let highest = since ?? -1;
      for (const item of items) {
        if (typeof item.sequence_num === "number" && Number.isSafeInteger(item.sequence_num)) {
          highest = Math.max(highest, item.sequence_num);
        }
      }
      if (since !== undefined && highest <= since) {
        throw hostedError("hosted_cursor_stalled", "Thought sequence numbers did not advance.");
      }
      if (highest < 0) throw hostedError("hosted_cursor_stalled", "Thoughts carried no sequence numbers.");
      since = highest;
    }
  }

  /** One unpaginated list read. Complete when it succeeds. */
  async list(
    run: StoreRun,
    walk: { path: string; params: Record<string, string>; itemsKey: string; filter: JsonObject },
    consume: (item: JsonObject) => Promise<void>,
  ): Promise<void> {
    const record: ExitWalk = { filter: walk.filter, pages: 0, returned: 0, exhausted: false };
    run.walks.push(record);
    const { body } = await this.get(walk.path, walk.params);
    const items = arrayOf(body, walk.itemsKey);
    record.pages = 1;
    record.returned = items.length;
    for (const item of items) await consume(item);
    record.exhausted = true;
    this.progress(run, { store: run.store, event: "page", pages: 1, returned: items.length });
  }

  private async get(
    path: string,
    params: Record<string, string>,
    options: { allow404?: boolean } = {},
  ): Promise<{ status: number; body: JsonObject }> {
    this.signal?.throwIfAborted();
    const query = new URLSearchParams(params).toString();
    const timeout = AbortSignal.timeout(this.http.timeout);
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.http.request(`${this.http.baseUrl}${path}${query ? `?${query}` : ""}`, {
        method: "GET",
        headers: { ...this.http.headers, Accept: "application/json" },
        // The project bearer belongs to one origin; never replay it across a redirect.
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (this.signal?.aborted) throw exitError("exit_aborted", "The exit run was aborted.");
      if (error instanceof AgentToolError) throw hostedFrom(error);
      throw hostedError("hosted_unreachable", "The hosted API could not be reached.");
    }
    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response);
      throw hostedError("hosted_redirect_refused", "The hosted API answered with a redirect.", response.status);
    }
    if (response.status === 404 && options.allow404) {
      await cancelBody(response);
      return { status: 404, body: {} };
    }
    if (!response.ok) {
      throw hostedFrom(await errorFromResponse(response, `GET ${path}`));
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw hostedError("hosted_response_invalid", "The hosted API returned non-JSON.", response.status);
    }
    if (!isObject(body)) {
      throw hostedError("hosted_response_invalid", "The hosted API returned a non-object body.", response.status);
    }
    return { status: response.status, body };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** A bare dot segment cannot be carried in a path by any encoding. */
function isAddressable(id: string): boolean {
  return id !== "." && id !== "..";
}

/** Ids below come from hosted responses, never from a caller argument; each
 *  still crosses the shared path-segment encoder. */
function thoughtsPath(strandId: string): string {
  return `/v1/strands/${encodePathSegment(strandId)}/thoughts`;
}

function identityKeysPath(identityId: string): string {
  return `/v1/identities/${encodePathSegment(identityId)}/keys`;
}

function newRun(store: ExitStore): StoreRun {
  return {
    store,
    status: "complete",
    first_page_as_of: null,
    walks: [],
    written: 0,
    inserted: 0,
    existing: 0,
    items: 0,
    bytes: 0,
    largest: 0,
    current: new Map(),
    item_skips: [],
    parents_visited: 0,
  };
}

function markWindow(run: StoreRun, reason: string): void {
  if (run.status === "complete") {
    run.status = "window_only";
    run.reason = reason;
  }
}

function markFailed(run: StoreRun, reason: string): void {
  run.status = "failed";
  run.reason = reason;
}

function done(run: StoreRun, progress: (run: StoreRun, event: ExitProgress) => void): void {
  progress(run, { store: run.store, event: "done", status: run.status });
}

/** A nested store is only as complete as the parent walk that enumerated it. */
function settleChild(child: StoreRun, parent: StoreRun, parentName: string): void {
  if (child.status === "failed" || parent.status === "complete") return;
  if (parent.status === "failed" && child.parents_visited === 0) {
    child.status = "skipped";
    child.reason = `parent_store_failed:${parentName}`;
    return;
  }
  child.status = "window_only";
  child.reason = `parent_store_incomplete:${parentName}`;
}

/** Thoughts walk once per strand; the manifest carries one aggregate walk. */
function summarizeThoughtWalks(run: StoreRun): void {
  const walks = run.walks;
  run.walks = [{
    filter: { scope: "per_strand", strands: walks.length },
    pages: walks.reduce((sum, walk) => sum + walk.pages, 0),
    returned: walks.reduce((sum, walk) => sum + walk.returned, 0),
    exhausted: walks.every((walk) => walk.exhausted),
  }];
}

function overallOf(runs: readonly StoreRun[]): ExitOverall {
  if (runs.some((run) => run.status === "failed" || run.status === "skipped")) return "failed";
  if (runs.some((run) => run.status !== "complete" || run.item_skips.length > 0)) return "partial";
  return "complete";
}

function selectStores(stores: readonly ExitStore[] | undefined): Set<ExitStore> {
  if (stores === undefined) return new Set(EXIT_STORES);
  if (!Array.isArray(stores) || stores.length === 0) {
    throw exitError("exit_stores_invalid", "stores must be a non-empty list of exit stores.");
  }
  for (const store of stores) {
    if (!isStore(store)) {
      throw exitError("exit_store_unknown", `Unknown exit store: ${String(store).slice(0, 64)}.`, {
        hint: `Known stores: ${EXIT_STORES.join(", ")}.`,
      });
    }
  }
  return new Set(stores);
}

function optionalIdentity(identityId: string | undefined): string | null {
  if (identityId === undefined) return null;
  if (typeof identityId !== "string" || identityId === "" || identityId.length > 256) {
    throw exitError("exit_identity_id_invalid", "identity_id must be a non-empty string.");
  }
  return identityId;
}

function isStore(value: unknown): value is ExitStore {
  return typeof value === "string" && (EXIT_STORES as readonly string[]).includes(value);
}

function isOverall(value: unknown): value is ExitOverall {
  return value === "complete" || value === "partial" || value === "failed";
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function objectField(item: JsonObject, field: string): JsonObject {
  return asObject(item[field]);
}

function arrayOf(body: JsonObject, key: string): JsonObject[] {
  const value = body[key];
  if (!Array.isArray(value)) {
    throw hostedError("hosted_response_invalid", `The hosted response carried no ${key} list.`);
  }
  return value.map((item) => {
    if (!isObject(item)) throw hostedError("hosted_response_invalid", `A ${key} entry was not an object.`);
    return item;
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function hostedIdOf(store: ExitStore, item: JsonObject): string | null {
  try {
    const value = STORE_SPECS[store].hostedId(item);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function codeOf(error: unknown): string {
  return error instanceof AgentToolError && error.code ? error.code : "exit_item_invalid";
}

/** Compare by UTF-16 code unit, the same order canonical JSON uses. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recordIdsDigest(recordIds: readonly string[]): string {
  return sha256Hex(canonicalJson([...recordIds]));
}

function isLoopbackUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function assertNoDrift(
  record: DataRecord | undefined,
  expected: string,
  identity: AgentDataRecordIdentity,
): void {
  const content = record && isObject(record.content) ? record.content : {};
  if (!record || record.id !== expected || content.sha256 !== identity.content.sha256) {
    throw exitError(
      "exit_record_identity_drift",
      "The node stored a record whose identity differs from the one the exporter computed.",
      { hint: "Stop and compare the node version with the shared record-id vectors." },
    );
  }
}

async function readVerified(
  data: DataClient,
  recordId: string,
  signal: AbortSignal | undefined,
): Promise<{ record: DataRecord; text: string } | { mismatch: string }> {
  signal?.throwIfAborted();
  let resolved: Awaited<ReturnType<DataClient["get"]>>;
  try {
    resolved = await data.get(recordId);
  } catch (error) {
    if (error instanceof AgentToolError && error.status === 404) return { mismatch: "record_not_found" };
    if (error instanceof AgentToolError && error.status === 410) return { mismatch: "record_tombstoned" };
    throw error;
  }
  const record = resolved.record;
  const content = resolved.content;
  if (!isObject(record) || !isObject(content) || content.encoding !== "utf8" || typeof content.data !== "string") {
    return { mismatch: "record_unreadable" };
  }
  const envelope = asObject(record.content);
  const bytes = new TextEncoder().encode(content.data);
  if (sha256Hex(bytes) !== envelope.sha256 || bytes.byteLength !== envelope.size) {
    return { mismatch: "content_hash_mismatch" };
  }
  const source = asObject(record.source);
  let derived: string;
  try {
    derived = agentDataRecordId({
      protocol: record.protocol as "agent-data/v1",
      collection_id: record.collection_id as string,
      source: {
        collector_id: source.collector_id as string,
        uri: source.uri as string,
        ...(source.external_id !== undefined ? { external_id: source.external_id as string } : {}),
      },
      content: {
        sha256: envelope.sha256 as string,
        size: envelope.size as number,
        media_type: envelope.media_type as string,
      },
      schema_version: record.schema_version as string,
      ...(record.key !== undefined ? { key: record.key as string } : {}),
      ...(record.version !== undefined ? { version: record.version as string } : {}),
      ...(record.supersedes_id !== undefined ? { supersedes_id: record.supersedes_id as string } : {}),
    });
  } catch {
    return { mismatch: "record_identity_unreadable" };
  }
  if (derived !== record.id || derived !== recordId) return { mismatch: "record_id_mismatch" };
  return { record, text: content.data };
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup failure must not replace the decision already made.
  }
}

function exitError(
  code: string,
  message: string,
  options: { hint?: string; status?: number } = {},
): AgentToolError {
  return new ExitDoorError(message, { code, ...options });
}

function hostedError(code: string, message: string, status?: number): HostedReadError {
  return new HostedReadError(message, { code, ...(status !== undefined ? { status } : {}) });
}

/** Keep only code, status, and retryAfter from a hosted failure. */
function hostedFrom(error: AgentToolError): HostedReadError {
  return new HostedReadError("Exit door hosted read failed.", {
    code: error.code ?? (error.status !== undefined ? `hosted_http_${error.status}` : "hosted_read_failed"),
    status: error.status,
    retryAfter: error.retryAfter,
  });
}

/**
 * Errors leaving the exit door carry a stable code, the HTTP status, and
 * `Retry-After` only. Server prose, details, and next actions from either
 * authority are dropped so neither side's response text crosses into logs.
 * The exporter's own errors (and the SDK's own `data_node_not_configured`)
 * carry no server text, so they keep their message and hint.
 */
function reduce(error: unknown): AgentToolError {
  if (error instanceof ExitDoorError || error instanceof HostedReadError) return error;
  if (error instanceof AgentToolError) {
    if (error.code === "data_node_not_configured" && error.status === undefined) return error;
    const code = error.code ?? (error.status !== undefined ? `http_${error.status}` : "exit_door_failed");
    return new AgentToolError(`Exit door: ${code}.`, {
      code,
      status: error.status,
      retryAfter: error.retryAfter,
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ExitDoorError("Exit door: the run was aborted.", { code: "exit_aborted" });
  }
  return new ExitDoorError("Exit door: an unexpected failure stopped the run.", {
    code: "exit_door_failed",
  });
}
