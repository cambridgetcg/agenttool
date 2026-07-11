export const AGENT_DATA_PROTOCOL = "agent-data/v1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface CollectionSchema {
  version: string;
  json_schema?: JsonObject;
}

export interface CollectionPolicy {
  /** Enforced at collection time. The node-wide limit can be stricter. */
  max_record_bytes?: number;
  /** Exact, normalized media types accepted by this collection. */
  allowed_media_types?: string[];
  /** Declared retention intent. The v1 reference node does not run GC. */
  retention_days?: number;
  /** Declared collection visibility; defaults to private. */
  visibility?: "private" | "public";
  /** Declared per-record lifetime. The v1 reference node does not run expiry. */
  ttl_seconds?: number;
  /** Declared DID allow-list. The v1 reference node does not resolve DIDs. */
  allowed_dids?: string[];
}

export interface StoredCollectionPolicy extends CollectionPolicy {
  visibility: "private" | "public";
}

export interface CollectionDefinition {
  id: string;
  name?: string;
  description?: string;
  schema?: CollectionSchema;
  policy?: CollectionPolicy;
}

export interface StoredCollection extends CollectionDefinition {
  protocol: typeof AGENT_DATA_PROTOCOL;
  schema: CollectionSchema;
  policy: StoredCollectionPolicy;
  created_at: string;
}

export interface RecordSource {
  collector_id: string;
  uri: string;
  external_id?: string;
}

export interface ProvenanceActivity {
  activity: string;
  at: string;
  input_ids?: string[];
  actor?: string;
}

export interface RecordContentDescriptor {
  sha256: string;
  size: number;
  media_type: string;
  /** Opaque node-local locator. It is not a portable URL. */
  blob_ref: string;
}

export interface RecordSignature {
  algorithm: string;
  signer: string;
  value: string;
}

export interface RecordEnvelope {
  protocol: typeof AGENT_DATA_PROTOCOL;
  id: string;
  collection_id: string;
  source: RecordSource;
  content: RecordContentDescriptor;
  schema_version: string;
  metadata: JsonObject;
  ingested_at: string;
  observed_at?: string;
  key?: string;
  version?: string;
  supersedes_id?: string;
  provenance?: ProvenanceActivity[];
  /** Carried as supplied. The reference node does not verify signatures. */
  signature?: RecordSignature;
}

export interface RecordContent {
  encoding: "utf8" | "base64";
  data: string;
}

export interface CollectedItem {
  bytes: Uint8Array;
  media_type: string;
  source: Omit<RecordSource, "collector_id">;
  metadata?: JsonObject;
  observed_at?: string;
  key?: string;
  version?: string;
  supersedes_id?: string;
  provenance?: ProvenanceActivity[];
  signature?: RecordSignature;
}

export interface CollectorContext {
  collection: StoredCollection;
  max_record_bytes: number;
  signal?: AbortSignal;
}

export interface CollectorOutput {
  items: CollectedItem[];
  cursor?: string;
}

export interface CollectorCapability {
  collector_id: string;
  description: string;
  input_schema?: JsonObject;
}

export interface SourceAdapter {
  readonly id: string;
  readonly capability: CollectorCapability;
  collect(
    input: JsonObject,
    context: CollectorContext,
    cursor?: string,
  ): Promise<CollectorOutput>;
}

export interface CollectRequest {
  collection_id: string;
  collector_id: string;
  input: JsonObject;
  cursor?: string;
}

export interface CollectResponse {
  records: RecordEnvelope[];
  inserted: number;
  existing: number;
  cursor?: string;
}

export interface QueryRequest {
  collections?: string[];
  text?: string;
  where?: JsonObject;
  limit?: number;
  consistency?: "local";
}

export interface QueryHit {
  record: RecordEnvelope;
  score?: number;
}

export interface QueryResponse {
  records: QueryHit[];
  consistency: "local";
}

export interface RecordChange {
  id: string;
  type: "record.created";
  sequence: number;
  collection_id: string;
  record_id: string;
  occurred_at: string;
  record: RecordEnvelope;
}

export interface Tombstone {
  record_id: string;
  collection_id: string;
  reason?: string;
  tombstoned_at: string;
}

export interface TombstoneChange {
  id: string;
  type: "record.tombstoned";
  sequence: number;
  collection_id: string;
  record_id: string;
  occurred_at: string;
  tombstone: Tombstone;
}

export type Change = RecordChange | TombstoneChange;

export interface ChangesRequest {
  collection_id?: string;
  cursor?: string;
  limit?: number;
}

export interface ChangesResponse {
  changes: Change[];
  cursor: string;
  has_more: boolean;
}

export interface IndexCandidate {
  record_id: string;
  score?: number;
}

export interface RecordStore {
  initialize(): void | Promise<void>;
  putCollection(collection: StoredCollection): "inserted" | "existing";
  getCollection(id: string): StoredCollection | null;
  listCollections(): StoredCollection[];
  putRecord(record: RecordEnvelope): "inserted" | "existing";
  getRecord(id: string, include_tombstoned?: boolean): RecordEnvelope | null;
  listRecords(collections?: string[], limit?: number, offset?: number): RecordEnvelope[];
  tombstoneRecord(id: string, reason?: string): Tombstone;
  getTombstone(id: string): Tombstone | null;
  listChanges(after_sequence: number, collection_id: string | undefined, limit: number): Change[];
  getOrCreateNodeId(preferred?: string): string;
  close?(): void;
}

export interface RecordIndex {
  initialize?(): void | Promise<void>;
  indexRecord(record: RecordEnvelope, document: string): void | Promise<void>;
  removeRecord(record_id: string): void | Promise<void>;
  search(
    text: string,
    collections: string[] | undefined,
    limit: number,
    offset?: number,
  ): IndexCandidate[];
}

export interface BlobStore {
  put(bytes: Uint8Array, sha256: string): Promise<string>;
  get(blob_ref: string): Promise<Uint8Array>;
  has?(blob_ref: string): Promise<boolean>;
}

export interface NodeLimits {
  max_body_bytes: number;
  max_record_bytes: number;
  max_query_limit: number;
  max_change_limit: number;
  max_collect_items: number;
  default_query_limit: number;
  default_change_limit: number;
}

export interface NodeManifest {
  protocol: typeof AGENT_DATA_PROTOCOL;
  node_id: string;
  generated_at: string;
  base_url?: string;
  capabilities: {
    consistency: ["local"];
    immutable_records: true;
    content_addressed_blobs: true;
    full_text_search: true;
    opaque_change_cursors: true;
    tombstones: true;
    peer_sync: false;
    signature_verification: false;
    schema_validation: false;
    http_data_auth: "dedicated_node_bearer";
    policy_enforcement: {
      max_record_bytes: true;
      allowed_media_types: true;
      visibility: false;
      ttl: false;
      allowed_dids: false;
      retention: false;
    };
  };
  collectors: CollectorCapability[];
  endpoints: {
    manifest: string;
    collections: string;
    collect: string;
    query: string;
    record: string;
    changes: string;
    tombstone: string;
  };
  limits: NodeLimits;
}

export interface DataNodeOptions {
  root?: string;
  db_path?: string;
  blobs_dir?: string;
  node_id?: string;
  collections?: CollectionDefinition[];
  adapters?: SourceAdapter[];
  store?: RecordStore;
  index?: RecordIndex;
  blob_store?: BlobStore;
  limits?: Partial<NodeLimits>;
}

export interface DataNodeServerOptions {
  hostname?: string;
  port?: number;
  /** Dedicated node token. Never falls back to an AgentTool API bearer. */
  node_bearer?: string;
  max_body_bytes?: number;
}

export type MaybePromise<T> = T | Promise<T>;
