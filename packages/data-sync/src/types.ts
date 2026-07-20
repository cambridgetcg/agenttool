import type {
  AgentDataIdentity,
  SignedGrant,
} from "@agenttool/adds";
import type {
  DataNode,
  NodeManifest,
  DataNodeServerOptions,
  RecordEnvelope,
  StoredCollection,
  Tombstone,
} from "@agenttool/data";

export const AGENT_DATA_SYNC_PROTOCOL = "agent-data-sync/v1" as const;
export const AGENT_DATA_SYNC_OBJECT_PROTOCOL = "agent-data-sync-object/v1" as const;
export const ADDS_INLINE_PROFILE = "adds/0.1-inline" as const;

export interface SyncRecipient {
  id: string;
  x25519_public_key: string;
  x25519_key_id: string;
}

export interface SyncPublisher {
  id: string;
  ed25519_public_key: string;
}

export interface SyncPeerConfig {
  /** Stable local alias. It is the only peer selector accepted over HTTP. */
  peer_id: string;
  /** Origin node id that every response must match. */
  expected_node_id: string;
  /** ADDS signer pinned by the local operator, not learned from the pull response. */
  expected_publisher: SyncPublisher;
  /** Exact peer origin. Paths, credentials, query strings, and fragments are refused. */
  base_url: string;
  /** Page-only bearer scoped by that peer; never accepted in a pull request. */
  bearer: string;
}

export interface SyncPageAuthority {
  /** Local label for the remote reader; never sent on the wire. */
  peer_id: string;
  /** Page-only bearer. It must differ from this node's local/admin bearer. */
  bearer: string;
  /** Explicit collection allow-list for this reader. */
  collection_ids: readonly string[];
  /** Recipient identity/key pinned for every Grant issued under this authority. */
  recipient: SyncRecipient;
}

export interface SyncLimits {
  default_page_changes: number;
  max_page_changes: number;
  default_plaintext_bytes: number;
  max_plaintext_bytes: number;
  default_pull_pages: number;
  max_pull_pages: number;
  max_response_bytes: number;
  request_timeout_ms: number;
  grant_ttl_seconds: number;
}

export interface SyncPageRequest {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  collection_id: string;
  cursor?: string;
  /** Bound to an existing checkpoint so a reset feed fails before cursor use. */
  expected_feed_id?: string;
  limit?: number;
  max_plaintext_bytes?: number;
  recipient: SyncRecipient;
}

export interface SyncPullRequest {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  peer_id: string;
  collection_id: string;
  limit?: number;
  max_pages?: number;
  max_plaintext_bytes?: number;
}

export interface WirePortableBlock {
  cid: string;
  /** Canonical unpadded base64url. */
  data: string;
}

export interface WirePortableBundle {
  protocol: "adds-bundle/v1";
  root: { cid: string };
  blocks: WirePortableBlock[];
}

export interface InlineEncryptedObject {
  profile: typeof ADDS_INLINE_PROFILE;
  bundle: WirePortableBundle;
  grant: SignedGrant;
}

export interface SyncChangeHeader {
  id: string;
  type: "record.created" | "record.tombstoned";
  sequence: number;
  collection_id: string;
  record_id: string;
  occurred_at: string;
  object: InlineEncryptedObject;
}

export interface SyncPage {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  origin_node_id: string;
  feed_id: string;
  collection_id: string;
  previous_cursor?: string;
  cursor: string;
  has_more: boolean;
  /** Encrypted signed binding over cursors, ordered headers, and object roots. */
  control_object: InlineEncryptedObject;
  collection_object: InlineEncryptedObject;
  changes: SyncChangeHeader[];
}

export interface CollectionSyncPayload {
  protocol: typeof AGENT_DATA_SYNC_OBJECT_PROTOCOL;
  kind: "collection";
  collection: StoredCollection;
}

export interface RecordSyncPayload {
  protocol: typeof AGENT_DATA_SYNC_OBJECT_PROTOCOL;
  kind: "record";
  record: RecordEnvelope;
  content: {
    encoding: "base64url";
    data: string;
  };
}

export interface TombstoneSyncPayload {
  protocol: typeof AGENT_DATA_SYNC_OBJECT_PROTOCOL;
  kind: "tombstone";
  tombstone: Tombstone;
}

export interface PageSyncPayload {
  protocol: typeof AGENT_DATA_SYNC_OBJECT_PROTOCOL;
  kind: "page";
  origin_node_id: string;
  feed_id: string;
  collection_id: string;
  previous_cursor?: string;
  cursor: string;
  has_more: boolean;
  collection_object_cid: string;
  changes: Array<{
    id: string;
    type: "record.created" | "record.tombstoned";
    sequence: number;
    collection_id: string;
    record_id: string;
    occurred_at: string;
    object_cid: string;
  }>;
}

export type SyncObjectPayload =
  | CollectionSyncPayload
  | RecordSyncPayload
  | TombstoneSyncPayload
  | PageSyncPayload;

export interface SyncCheckpoint {
  peer_id: string;
  collection_id: string;
  /** Normalized exact origin that received the scoped peer bearer. */
  peer_base_url: string;
  origin_node_id: string;
  feed_id: string;
  publisher_id: string;
  publisher_ed25519_public_key: string;
  /** Internal resumability state. HTTP status deliberately does not return it. */
  cursor: string;
  last_applied_at: string;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
}

export interface SyncCheckpointStore {
  get(peer_id: string, collection_id: string): SyncCheckpoint | null;
  set(checkpoint: SyncCheckpoint): void;
  delete(peer_id: string, collection_id: string): boolean;
  close?(): void;
}

export interface SyncStatus {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  peer_id: string;
  collection_id: string;
  cursor_present: boolean;
  last_applied_at?: string;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
}

export interface SyncPullResult {
  protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
  peer_id: string;
  origin_node_id: string;
  collection_id: string;
  pages_applied: number;
  changes_applied: number;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
  has_more: boolean;
  status: SyncStatus;
}

export interface DataSyncManifest {
  protocol: "agent-data/v1";
  node_id: string;
  generated_at: string;
  base_url?: string;
  capabilities: Omit<NodeManifest["capabilities"], "peer_sync"> & { peer_sync: true };
  collectors: NodeManifest["collectors"];
  endpoints: NodeManifest["endpoints"] & {
    sync_page: string;
    sync_pull: string;
    sync_status: string;
  };
  limits: NodeManifest["limits"];
  sync: {
    protocol: typeof AGENT_DATA_SYNC_PROTOCOL;
    feed_id: string;
    mode: "explicit_pull";
    peer_discovery: false;
    encrypted_profile: typeof ADDS_INLINE_PROFILE;
    recipient: SyncRecipient;
    publisher: SyncPublisher;
    limits: SyncLimits;
  };
}

export interface DataSyncServiceOptions {
  node: DataNode;
  identity: AgentDataIdentity;
  peers?: readonly SyncPeerConfig[];
  checkpoint_store?: SyncCheckpointStore;
  checkpoint_path?: string;
  limits?: Partial<SyncLimits>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date | string | number;
}

export interface DataSyncServerOptions extends DataNodeServerOptions {
  /** Page-only inbound capabilities. Local/admin node_bearer never authorises page reads. */
  page_authorities?: readonly SyncPageAuthority[];
}
