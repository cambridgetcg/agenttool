/**
 * Local orchestration for immutable agent-data/v1 records and query.
 * Doctrine: docs/AGENT-DATA-PROTOCOL.md
 */
import { resolve } from "node:path";
import {
  canonicalJson,
  cloneJsonObject,
  deepFreeze,
  isTextualMediaType,
  normalizeIsoDate,
  normalizeMediaType,
  sha256Hex,
} from "./canonical.js";
import { FileSystemBlobStore } from "./blob-store.js";
import { decodeChangeCursor, encodeChangeCursor } from "./cursor.js";
import { FileSourceAdapter, HttpSourceAdapter, TextSourceAdapter } from "./collectors.js";
import { DataNodeError, invariant } from "./errors.js";
import { SQLiteStore } from "./sqlite-store.js";
import {
  AGENT_DATA_PROTOCOL,
  type BlobStore,
  type Change,
  type ChangesRequest,
  type ChangesResponse,
  type CollectedItem,
  type CollectRequest,
  type CollectResponse,
  type CollectionDefinition,
  type DataNodeOptions,
  type JsonObject,
  type JsonValue,
  type NodeLimits,
  type NodeManifest,
  type ProvenanceActivity,
  type QueryHit,
  type QueryRequest,
  type QueryResponse,
  type RecordContent,
  type RecordEnvelope,
  type RecordIndex,
  type RecordSignature,
  type RecordStore,
  type SourceAdapter,
  type StoredCollection,
  type Tombstone,
} from "./types.js";

export const DEFAULT_NODE_LIMITS: Readonly<NodeLimits> = Object.freeze({
  max_body_bytes: 1024 * 1024,
  max_record_bytes: 10 * 1024 * 1024,
  max_query_limit: 100,
  max_change_limit: 1000,
  max_collect_items: 100,
  default_query_limit: 20,
  default_change_limit: 100,
});

export class DataNode {
  readonly node_id: string;
  readonly limits: NodeLimits;
  readonly store: RecordStore;
  readonly index: RecordIndex;
  readonly blob_store: BlobStore;
  private readonly adapters = new Map<string, SourceAdapter>();
  private closed = false;

  private constructor(
    nodeId: string,
    limits: NodeLimits,
    store: RecordStore,
    index: RecordIndex,
    blobStore: BlobStore,
    adapters: SourceAdapter[],
  ) {
    this.node_id = nodeId;
    this.limits = deepFreeze({ ...limits });
    this.store = store;
    this.index = index;
    this.blob_store = blobStore;
    for (const adapter of adapters) this.registerAdapter(adapter);
  }

  static async open(options: DataNodeOptions = {}): Promise<DataNode> {
    const root = resolve(options.root ?? ".agent-data");
    const limits = normalizeLimits(options.limits);
    const defaultStore = !options.store || !options.index
      ? new SQLiteStore(options.db_path ?? resolve(root, "data.sqlite"))
      : undefined;
    const store = options.store ?? defaultStore!;
    const index = options.index ?? defaultStore!;
    const blobStore = options.blob_store
      ?? new FileSystemBlobStore(options.blobs_dir ?? resolve(root, "blobs"));

    await store.initialize();
    if ((index as unknown) !== store && index.initialize) await index.initialize();
    const adapters: SourceAdapter[] = [
      new TextSourceAdapter(),
      new FileSourceAdapter(),
      new HttpSourceAdapter({ max_bytes: limits.max_record_bytes }),
    ];
    for (const custom of options.adapters ?? []) {
      const existing = adapters.findIndex((adapter) => adapter.id === custom.id);
      if (existing >= 0) adapters.splice(existing, 1, custom);
      else adapters.push(custom);
    }

    const node = new DataNode(
      store.getOrCreateNodeId(options.node_id),
      limits,
      store,
      index,
      blobStore,
      adapters,
    );
    if ((store as unknown) === index && store instanceof SQLiteStore) await node.repairDefaultIndex(store);
    for (const collection of options.collections ?? []) node.defineCollection(collection);
    return node;
  }

  registerAdapter(adapter: SourceAdapter): void {
    this.assertOpen();
    invariant(adapter && typeof adapter === "object", "invalid_adapter", "adapter is required");
    invariant(
      /^[a-z][a-z0-9._-]{0,63}$/.test(adapter.id),
      "invalid_adapter",
      "adapter id must use lowercase letters, digits, dot, underscore, or hyphen",
    );
    invariant(typeof adapter.collect === "function", "invalid_adapter", "adapter.collect must be a function");
    invariant(
      adapter.capability?.collector_id === adapter.id,
      "invalid_adapter",
      "adapter capability collector_id must match adapter id",
    );
    this.adapters.set(adapter.id, adapter);
  }

  defineCollection(definition: CollectionDefinition): StoredCollection {
    this.assertOpen();
    const collection = normalizeCollection(definition);
    this.store.putCollection(collection);
    return this.store.getCollection(collection.id)!;
  }

  getCollection(id: string): StoredCollection | null {
    this.assertOpen();
    validateCollectionId(id);
    return this.store.getCollection(id);
  }

  listCollections(): StoredCollection[] {
    this.assertOpen();
    return this.store.listCollections();
  }

  async collect(request: CollectRequest, signal?: AbortSignal): Promise<CollectResponse> {
    this.assertOpen();
    validateCollectionId(request.collection_id);
    invariant(
      typeof request.collector_id === "string" && request.collector_id.length > 0,
      "invalid_request",
      "collector_id is required",
    );
    const input = cloneJsonObject(request.input, "input");
    if (request.cursor !== undefined) {
      invariant(typeof request.cursor === "string", "invalid_request", "cursor must be a string");
    }
    const collection = this.store.getCollection(request.collection_id);
    if (!collection) {
      throw new DataNodeError(
        "collection_not_found",
        `Collection '${request.collection_id}' was not found`,
        404,
      );
    }
    const adapter = this.adapters.get(request.collector_id);
    if (!adapter) {
      throw new DataNodeError(
        "collector_not_found",
        `Collector '${request.collector_id}' is not registered`,
        404,
      );
    }
    const maxRecordBytes = Math.min(
      this.limits.max_record_bytes,
      collection.policy.max_record_bytes ?? Number.MAX_SAFE_INTEGER,
    );
    const output = await adapter.collect(input, {
      collection,
      max_record_bytes: maxRecordBytes,
      ...(signal ? { signal } : {}),
    }, request.cursor);
    invariant(output && Array.isArray(output.items), "invalid_collector_output", "collector output must contain items", 500);
    invariant(
      output.items.length <= this.limits.max_collect_items,
      "collector_item_limit",
      `Collector returned more than ${this.limits.max_collect_items} items`,
      413,
    );
    if (output.cursor !== undefined) {
      invariant(typeof output.cursor === "string", "invalid_collector_output", "collector cursor must be a string", 500);
    }

    const records: RecordEnvelope[] = [];
    let inserted = 0;
    let existing = 0;
    for (const item of output.items) {
      const prepared = this.prepareRecord(collection, adapter.id, item, maxRecordBytes);
      const blobRef = await this.blob_store.put(prepared.item.bytes, prepared.content_sha256);
      const record = buildRecordEnvelope(
        collection,
        adapter.id,
        prepared.item,
        prepared.content_sha256,
        blobRef,
      );
      const result = this.store.putRecord(record);
      const storedRecord = result === "inserted"
        ? record
        : this.store.getRecord(record.id, true) ?? record;
      if (!this.store.getTombstone(storedRecord.id)) {
        await this.index.indexRecord(storedRecord, indexDocument(storedRecord, prepared.item.bytes));
      }
      if (result === "inserted") {
        inserted += 1;
        records.push(storedRecord);
      } else {
        existing += 1;
        records.push(storedRecord);
      }
    }

    return deepFreeze({
      records,
      inserted,
      existing,
      ...(output.cursor !== undefined ? { cursor: output.cursor } : {}),
    });
  }

  query(request: QueryRequest = {}): QueryResponse {
    this.assertOpen();
    if (request.consistency !== undefined && request.consistency !== "local") {
      throw new DataNodeError("unsupported_consistency", "Only local consistency is available", 400);
    }
    const collections = request.collections === undefined
      ? undefined
      : validateCollectionList(request.collections, this.store);
    const limit = boundedLimit(
      request.limit,
      this.limits.default_query_limit,
      this.limits.max_query_limit,
      "limit",
    );
    const where = request.where === undefined ? undefined : cloneJsonObject(request.where, "where");
    if (request.text !== undefined) {
      invariant(typeof request.text === "string", "invalid_request", "text must be a string");
    }
    if (collections?.length === 0) {
      return deepFreeze({ records: [], consistency: "local" as const });
    }

    const hits: QueryHit[] = [];
    const seen = new Set<string>();
    const seenCandidates = new Set<string>();
    const batchSize = where ? Math.min(Math.max(limit * 4, 100), 500) : limit;
    let offset = 0;
    while (hits.length < limit) {
      let rawCount: number;
      let candidateIds: string[];
      let batch: QueryHit[];
      if (request.text?.trim()) {
        const candidates = this.index.search(request.text, collections, batchSize, offset);
        rawCount = candidates.length;
        candidateIds = candidates.map((candidate) => candidate.record_id);
        batch = candidates.map((candidate) => {
            const record = this.store.getRecord(candidate.record_id);
            return record ? { record, ...(candidate.score !== undefined ? { score: candidate.score } : {}) } : null;
          })
          .filter((hit): hit is QueryHit => Boolean(hit));
      } else {
        const records = this.store.listRecords(collections, batchSize, offset);
        rawCount = records.length;
        candidateIds = records.map((record) => record.id);
        batch = records.map((record) => ({ record }));
      }
      let newRawCandidates = 0;
      for (const id of candidateIds) {
        if (!seenCandidates.has(id)) {
          seenCandidates.add(id);
          newRawCandidates += 1;
        }
      }
      const fresh = batch.filter((hit) => {
        if (seen.has(hit.record.id)) return false;
        seen.add(hit.record.id);
        return !where || isSubset(where, hit.record);
      });
      hits.push(...fresh);
      if (rawCount < batchSize || newRawCandidates === 0) break;
      offset += rawCount;
      if (rawCount === 0) break;
    }
    return deepFreeze({ records: hits.slice(0, limit), consistency: "local" as const });
  }

  getRecord(id: string, includeTombstoned = false): RecordEnvelope | null {
    this.assertOpen();
    validateRecordId(id);
    return this.store.getRecord(id, includeTombstoned);
  }

  getTombstone(id: string): Tombstone | null {
    this.assertOpen();
    validateRecordId(id);
    return this.store.getTombstone(id);
  }

  async readContent(recordOrId: RecordEnvelope | string): Promise<Uint8Array> {
    this.assertOpen();
    const record = typeof recordOrId === "string"
      ? this.getRecord(recordOrId, true)
      : recordOrId;
    if (!record) throw new DataNodeError("record_not_found", "Record was not found", 404);
    const bytes = await this.blob_store.get(record.content.blob_ref);
    if (bytes.byteLength !== record.content.size || sha256Hex(bytes) !== record.content.sha256) {
      throw new DataNodeError("record_integrity_error", "Record content failed its integrity check", 500);
    }
    return bytes;
  }

  async resolveRecord(id: string): Promise<{ record: RecordEnvelope; content: RecordContent }> {
    const record = this.getRecord(id);
    if (!record) {
      if (this.getTombstone(id)) throw new DataNodeError("record_tombstoned", "Record has been tombstoned", 410);
      throw new DataNodeError("record_not_found", "Record was not found", 404);
    }
    const bytes = await this.readContent(record);
    const text = decodeText(bytes, record.content.media_type);
    return deepFreeze({
      record,
      content: text === null
        ? { encoding: "base64" as const, data: Buffer.from(bytes).toString("base64") }
        : { encoding: "utf8" as const, data: text },
    });
  }

  changes(request: ChangesRequest = {}): ChangesResponse {
    this.assertOpen();
    if (request.collection_id !== undefined) {
      validateCollectionId(request.collection_id);
      if (!this.store.getCollection(request.collection_id)) {
        throw new DataNodeError("collection_not_found", "Collection was not found", 404);
      }
    }
    const limit = boundedLimit(
      request.limit,
      this.limits.default_change_limit,
      this.limits.max_change_limit,
      "limit",
    );
    const afterSequence = decodeChangeCursor(request.cursor, request.collection_id);
    const page = this.store.listChanges(afterSequence, request.collection_id, limit + 1);
    const hasMore = page.length > limit;
    const changes = page.slice(0, limit);
    const sequence = changes.at(-1)?.sequence ?? afterSequence;
    return deepFreeze({
      changes,
      cursor: encodeChangeCursor(sequence, request.collection_id),
      has_more: hasMore,
    });
  }

  async tombstone(id: string, reason?: string): Promise<Tombstone> {
    this.assertOpen();
    validateRecordId(id);
    if (reason !== undefined) {
      invariant(typeof reason === "string" && reason.length <= 1000, "invalid_request", "reason must be at most 1000 characters");
    }
    const tombstone = this.store.tombstoneRecord(id, reason || undefined);
    await this.index.removeRecord(id);
    return tombstone;
  }

  manifest(baseUrl?: string): NodeManifest {
    this.assertOpen();
    const base = baseUrl?.replace(/\/$/, "");
    const endpoint = (path: string) => base ? `${base}${path}` : path;
    return deepFreeze({
      protocol: AGENT_DATA_PROTOCOL,
      node_id: this.node_id,
      generated_at: new Date().toISOString(),
      ...(base ? { base_url: base } : {}),
      capabilities: {
        consistency: ["local"] as ["local"],
        immutable_records: true,
        content_addressed_blobs: true,
        full_text_search: true,
        opaque_change_cursors: true,
        tombstones: true,
        peer_sync: false,
        signature_verification: false,
        schema_validation: false,
        http_data_auth: "dedicated_node_bearer",
        policy_enforcement: {
          max_record_bytes: true,
          allowed_media_types: true,
          visibility: false,
          ttl: false,
          allowed_dids: false,
          retention: false,
        },
      },
      collectors: [...this.adapters.values()]
        .map((adapter) => deepFreeze({ ...adapter.capability }))
        .sort((a, b) => a.collector_id.localeCompare(b.collector_id)),
      endpoints: {
        manifest: endpoint("/v1/data/manifest"),
        collections: endpoint("/v1/data/collections"),
        collect: endpoint("/v1/data/collect"),
        query: endpoint("/v1/data/query"),
        record: endpoint("/v1/data/records/{id}"),
        changes: endpoint("/v1/data/changes"),
        tombstone: endpoint("/v1/data/records/{id}/tombstone"),
      },
      limits: { ...this.limits },
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const closed = new Set<unknown>();
    for (const component of [this.index, this.store]) {
      if (!closed.has(component) && "close" in component && typeof component.close === "function") {
        component.close();
        closed.add(component);
      }
    }
  }

  private prepareRecord(
    collection: StoredCollection,
    collectorId: string,
    item: CollectedItem,
    maxRecordBytes: number,
  ): { item: CollectedItem; content_sha256: string } {
    invariant(item && typeof item === "object", "invalid_collector_output", "collector item must be an object", 500);
    invariant(item.bytes instanceof Uint8Array, "invalid_collector_output", "collector item bytes must be Uint8Array", 500);
    invariant(item.bytes.byteLength <= maxRecordBytes, "content_too_large", `Collected content exceeds the ${maxRecordBytes}-byte limit`, 413);
    const mediaType = normalizeMediaType(item.media_type);
    if (
      collection.policy.allowed_media_types !== undefined
      && !collection.policy.allowed_media_types.includes(mediaType)
    ) {
      throw new DataNodeError(
        "media_type_not_allowed",
        `Collection '${collection.id}' does not allow media type '${mediaType}'`,
        422,
      );
    }
    invariant(item.source && typeof item.source === "object", "invalid_collector_output", "collector item source is required", 500);
    invariant(typeof item.source.uri === "string" && item.source.uri.length > 0, "invalid_collector_output", "collector source uri is required", 500);
    if (item.supersedes_id) {
      validateRecordId(item.supersedes_id);
      const prior = this.store.getRecord(item.supersedes_id, true);
      if (!prior) throw new DataNodeError("superseded_record_not_found", "supersedes_id was not found", 422);
      if (prior.collection_id !== collection.id) {
        throw new DataNodeError("superseded_record_collection_mismatch", "supersedes_id belongs to another collection", 422);
      }
    }
    const normalizedItem: CollectedItem = {
      ...item,
      bytes: new Uint8Array(item.bytes),
      media_type: mediaType,
      source: {
        uri: item.source.uri,
        ...(item.source.external_id ? { external_id: item.source.external_id } : {}),
      },
      metadata: cloneJsonObject(item.metadata, "metadata"),
      ...(item.observed_at ? { observed_at: normalizeIsoDate(item.observed_at, "observed_at") } : {}),
      ...(item.provenance ? { provenance: normalizeProvenance(item.provenance) } : {}),
      ...(item.signature ? { signature: normalizeSignature(item.signature) } : {}),
    };
    invariant(collectorId.length > 0, "invalid_collector_output", "collector id is required", 500);
    return { item: normalizedItem, content_sha256: sha256Hex(normalizedItem.bytes) };
  }

  private async repairDefaultIndex(store: SQLiteStore): Promise<void> {
    for (const record of store.listUnindexedRecords()) {
      const bytes = await this.readContent(record);
      await store.indexRecord(record, indexDocument(record, bytes));
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new DataNodeError("node_closed", "Data node is closed", 410);
  }
}

function buildRecordEnvelope(
  collection: StoredCollection,
  collectorId: string,
  item: CollectedItem,
  contentHash: string,
  blobRef: string,
): RecordEnvelope {
  const source = {
    collector_id: collectorId,
    uri: item.source.uri,
    ...(item.source.external_id ? { external_id: item.source.external_id } : {}),
  };
  const identity = {
    protocol: AGENT_DATA_PROTOCOL,
    collection_id: collection.id,
    source,
    content: {
      sha256: contentHash,
      size: item.bytes.byteLength,
      media_type: item.media_type,
    },
    schema_version: collection.schema.version,
    ...(item.key ? { key: item.key } : {}),
    ...(item.version ? { version: item.version } : {}),
    ...(item.supersedes_id ? { supersedes_id: item.supersedes_id } : {}),
  };
  return deepFreeze({
    protocol: AGENT_DATA_PROTOCOL,
    id: `rec_${sha256Hex(canonicalJson(identity))}`,
    collection_id: collection.id,
    source,
    content: {
      sha256: contentHash,
      size: item.bytes.byteLength,
      media_type: item.media_type,
      blob_ref: blobRef,
    },
    schema_version: collection.schema.version,
    metadata: cloneJsonObject(item.metadata, "metadata"),
    ingested_at: new Date().toISOString(),
    ...(item.observed_at ? { observed_at: item.observed_at } : {}),
    ...(item.key ? { key: item.key } : {}),
    ...(item.version ? { version: item.version } : {}),
    ...(item.supersedes_id ? { supersedes_id: item.supersedes_id } : {}),
    ...(item.provenance ? { provenance: item.provenance } : {}),
    ...(item.signature ? { signature: item.signature } : {}),
  });
}

function normalizeCollection(definition: CollectionDefinition): StoredCollection {
  invariant(definition && typeof definition === "object", "invalid_collection", "Collection definition is required");
  validateCollectionId(definition.id);
  const schemaVersion = definition.schema?.version ?? "1";
  invariant(typeof schemaVersion === "string" && schemaVersion.length > 0, "invalid_collection", "schema.version must be a non-empty string");
  const policy = definition.policy ?? {};
  if (policy.max_record_bytes !== undefined) positiveSafeInteger(policy.max_record_bytes, "policy.max_record_bytes");
  if (policy.retention_days !== undefined) positiveNumber(policy.retention_days, "policy.retention_days");
  if (policy.ttl_seconds !== undefined) positiveSafeInteger(policy.ttl_seconds, "policy.ttl_seconds");
  if (policy.visibility !== undefined) {
    invariant(policy.visibility === "private" || policy.visibility === "public", "invalid_collection", "policy.visibility must be private or public");
  }
  const allowedMediaTypes = policy.allowed_media_types?.map(normalizeMediaType);
  const allowedDids = policy.allowed_dids?.map((did, index) => {
    invariant(typeof did === "string" && did.startsWith("did:"), "invalid_collection", `policy.allowed_dids[${index}] must be a DID`);
    return did;
  });
  for (const field of ["name", "description"] as const) {
    if (definition[field] !== undefined) invariant(typeof definition[field] === "string", "invalid_collection", `${field} must be a string`);
  }
  return deepFreeze({
    protocol: AGENT_DATA_PROTOCOL,
    id: definition.id,
    ...(definition.name ? { name: definition.name } : {}),
    ...(definition.description ? { description: definition.description } : {}),
    schema: {
      version: schemaVersion,
      ...(definition.schema?.json_schema
        ? { json_schema: cloneJsonObject(definition.schema.json_schema, "schema.json_schema") }
        : {}),
    },
    policy: {
      visibility: policy.visibility ?? "private",
      ...(policy.max_record_bytes !== undefined ? { max_record_bytes: policy.max_record_bytes } : {}),
      ...(allowedMediaTypes ? { allowed_media_types: [...new Set(allowedMediaTypes)].sort() } : {}),
      ...(policy.retention_days !== undefined ? { retention_days: policy.retention_days } : {}),
      ...(policy.ttl_seconds !== undefined ? { ttl_seconds: policy.ttl_seconds } : {}),
      ...(allowedDids ? { allowed_dids: [...new Set(allowedDids)].sort() } : {}),
    },
    created_at: new Date().toISOString(),
  });
}

function normalizeLimits(overrides: Partial<NodeLimits> | undefined): NodeLimits {
  const result = { ...DEFAULT_NODE_LIMITS, ...overrides };
  for (const [field, value] of Object.entries(result)) positiveSafeInteger(value, field);
  invariant(result.default_query_limit <= result.max_query_limit, "invalid_limits", "default_query_limit exceeds max_query_limit");
  invariant(result.default_change_limit <= result.max_change_limit, "invalid_limits", "default_change_limit exceeds max_change_limit");
  return result;
}

function normalizeProvenance(provenance: ProvenanceActivity[]): ProvenanceActivity[] {
  invariant(Array.isArray(provenance), "invalid_provenance", "provenance must be an array");
  return provenance.map((entry, index) => {
    invariant(entry && typeof entry === "object", "invalid_provenance", `provenance[${index}] must be an object`);
    invariant(typeof entry.activity === "string" && entry.activity.length > 0, "invalid_provenance", `provenance[${index}].activity is required`);
    const at = normalizeIsoDate(entry.at, `provenance[${index}].at`);
    if (entry.input_ids) {
      invariant(Array.isArray(entry.input_ids) && entry.input_ids.every((id) => typeof id === "string"), "invalid_provenance", `provenance[${index}].input_ids must contain strings`);
    }
    return {
      activity: entry.activity,
      at,
      ...(entry.actor ? { actor: entry.actor } : {}),
      ...(entry.input_ids ? { input_ids: [...entry.input_ids] } : {}),
    };
  });
}

function normalizeSignature(signature: RecordSignature): RecordSignature {
  invariant(signature && typeof signature === "object", "invalid_signature", "signature must be an object");
  for (const field of ["algorithm", "signer", "value"] as const) {
    invariant(typeof signature[field] === "string" && signature[field].length > 0, "invalid_signature", `signature.${field} is required`);
  }
  return { algorithm: signature.algorithm, signer: signature.signer, value: signature.value };
}

function indexDocument(record: RecordEnvelope, bytes: Uint8Array): string {
  const content = decodeText(bytes, record.content.media_type) ?? "";
  return [content, record.source.uri, record.source.external_id ?? "", record.key ?? "", ...flattenJson(record.metadata)]
    .filter(Boolean)
    .join("\n");
}

function decodeText(bytes: Uint8Array, mediaType: string): string | null {
  if (!isTextualMediaType(mediaType)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function flattenJson(value: JsonValue): string[] {
  if (value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  return Object.entries(value).flatMap(([key, child]) => [key, ...flattenJson(child)]);
}

function isSubset(expected: JsonValue, actual: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((item, index) => isSubset(item, actual[index]));
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => isSubset(value, (actual as Record<string, unknown>)[key]));
}

function validateCollectionList(collections: string[], store: RecordStore): string[] {
  invariant(Array.isArray(collections), "invalid_request", "collections must be an array");
  const unique = [...new Set(collections)];
  for (const id of unique) {
    validateCollectionId(id);
    if (!store.getCollection(id)) throw new DataNodeError("collection_not_found", `Collection '${id}' was not found`, 404);
  }
  return unique;
}

function validateCollectionId(id: string): void {
  invariant(
    typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id),
    "invalid_collection_id",
    "collection_id must be 1-128 letters, digits, dot, underscore, colon, or hyphen",
  );
}

function validateRecordId(id: string): void {
  invariant(typeof id === "string" && /^rec_[a-f0-9]{64}$/.test(id), "invalid_record_id", "record id is invalid");
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  positiveSafeInteger(result, field);
  if (result > maximum) throw new DataNodeError("limit_exceeded", `${field} cannot exceed ${maximum}`, 400);
  return result;
}

function positiveSafeInteger(value: number, field: string): void {
  invariant(Number.isSafeInteger(value) && value > 0, "invalid_number", `${field} must be a positive integer`);
}

function positiveNumber(value: number, field: string): void {
  invariant(Number.isFinite(value) && value > 0, "invalid_number", `${field} must be positive`);
}
