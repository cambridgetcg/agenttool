import {
  AgentData,
  AgentDataError,
  MemoryBlockStore,
  MemoryKeyStore,
  canonicalJsonBytes,
  identityFromPrivateKeys,
  parseCanonicalJson,
  signerForIdentity,
  validateGrant,
  x25519KeyId,
  type AgentDataIdentity,
  type SignedGrant,
} from "@agenttool/adds";
import {
  type Change,
  type RecordEnvelope,
  type StoredCollection,
  type Tombstone,
} from "@agenttool/data";
import { MemorySyncCheckpointStore, SQLiteSyncCheckpointStore } from "./checkpoints.js";
import { DataSyncError, syncInvariant } from "./errors.js";
import {
  ADDS_INLINE_PROFILE,
  AGENT_DATA_SYNC_OBJECT_PROTOCOL,
  AGENT_DATA_SYNC_PROTOCOL,
  type CollectionSyncPayload,
  type DataSyncManifest,
  type DataSyncServiceOptions,
  type InlineEncryptedObject,
  type PageSyncPayload,
  type RecordSyncPayload,
  type SyncChangeHeader,
  type SyncCheckpoint,
  type SyncLimits,
  type SyncObjectPayload,
  type SyncPage,
  type SyncPageRequest,
  type SyncPeerConfig,
  type SyncPublisher,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncRecipient,
  type SyncStatus,
  type TombstoneSyncPayload,
} from "./types.js";
import {
  bundleFromWire,
  bundleToWire,
  decodeBase64Url,
  encodeBase64Url,
  requireExactKeys,
  requireObject,
} from "./wire-codec.js";

export const DEFAULT_SYNC_LIMITS: Readonly<SyncLimits> = Object.freeze({
  default_page_changes: 10,
  max_page_changes: 100,
  default_plaintext_bytes: 1024 * 1024,
  max_plaintext_bytes: 8 * 1024 * 1024,
  default_pull_pages: 10,
  max_pull_pages: 100,
  max_response_bytes: 16 * 1024 * 1024,
  request_timeout_ms: 15_000,
  grant_ttl_seconds: 300,
});

const MAX_CURSOR_CHARS = 4096;
const MAX_ID_CHARS = 2048;
const MAX_NODE_ID_CHARS = 512;
/** ADDS permits 10,000 ciphertext Blocks plus the root Manifest Block. */
const MAX_BUNDLE_BLOCKS = 10_001;
const SYNC_MEDIA_TYPE = "application/vnd.agenttool.data-sync+json";
const SYNC_SCHEMA = "urn:agenttool:agent-data-sync-object:v1";

interface ApplyCounts {
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
}

interface NormalizedPeer extends SyncPeerConfig {
  base_url: string;
}

/**
 * An explicit, pull-only bridge. It discovers no peers, reads no environment
 * variables, and sends a configured peer bearer only to that peer's exact origin.
 */
export class DataSyncService {
  readonly node: DataSyncServiceOptions["node"];
  readonly limits: Readonly<SyncLimits>;
  readonly recipient: Readonly<SyncRecipient>;
  readonly publisher: Readonly<SyncPublisher>;

  readonly #identity: AgentDataIdentity;
  readonly #peers = new Map<string, NormalizedPeer>();
  readonly #checkpoints: NonNullable<DataSyncServiceOptions["checkpoint_store"]>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: NonNullable<DataSyncServiceOptions["now"]>;
  readonly #activePulls = new Set<string>();
  #closed = false;

  constructor(options: DataSyncServiceOptions) {
    syncInvariant(options && typeof options === "object", "invalid_sync_options", "Sync options are required");
    syncInvariant(options.node && typeof options.node === "object", "invalid_sync_options", "A data node is required");
    syncInvariant(options.identity && typeof options.identity === "object", "invalid_sync_options", "An ADDS identity is required");
    syncInvariant(
      !(options.checkpoint_store && options.checkpoint_path),
      "invalid_sync_options",
      "Use checkpoint_store or checkpoint_path, not both",
    );
    validateNodeId(options.node.node_id, "invalid_sync_options");
    const limits = Object.freeze(normalizeLimits(options.limits));
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    syncInvariant(typeof fetchImplementation === "function", "invalid_sync_options", "fetch must be a function");
    const now = options.now ?? (() => new Date());
    syncInvariant(typeof now === "function", "invalid_sync_options", "now must be a function");
    if (options.checkpoint_path !== undefined) {
      syncInvariant(
        typeof options.checkpoint_path === "string" && options.checkpoint_path.length > 0,
        "invalid_checkpoint_path",
        "checkpoint_path is required",
      );
    }
    if (options.checkpoint_store !== undefined) {
      syncInvariant(
        options.checkpoint_store !== null
          && typeof options.checkpoint_store === "object"
          && typeof options.checkpoint_store.get === "function"
          && typeof options.checkpoint_store.set === "function"
          && typeof options.checkpoint_store.delete === "function",
        "invalid_sync_options",
        "checkpoint_store is invalid",
      );
    }
    const peers = new Map<string, NormalizedPeer>();
    for (const configured of options.peers ?? []) {
      const peer = normalizePeer(configured);
      syncInvariant(!peers.has(peer.peer_id), "duplicate_peer", "Peer ids must be unique");
      peers.set(peer.peer_id, peer);
    }

    const identity = identityFromPrivateKeys(
      options.identity.id,
      options.identity.signingPrivateKey,
      options.identity.boxPrivateKey,
    );
    let checkpointStore: NonNullable<DataSyncServiceOptions["checkpoint_store"]> | undefined;
    let ownsCheckpointStore = false;
    try {
      const recipient = Object.freeze({
        id: identity.id,
        x25519_public_key: encodeBase64Url(identity.boxPublicKey),
        x25519_key_id: x25519KeyId(identity.boxPublicKey),
      });
      const publisher = Object.freeze({ ...signerForIdentity(identity) });
      if (options.checkpoint_store) {
        checkpointStore = options.checkpoint_store;
      } else if (options.checkpoint_path) {
        checkpointStore = new SQLiteSyncCheckpointStore(options.checkpoint_path);
        ownsCheckpointStore = true;
      } else {
        checkpointStore = new MemorySyncCheckpointStore();
        ownsCheckpointStore = true;
      }

      this.node = options.node;
      this.limits = limits;
      this.#fetch = fetchImplementation;
      this.#now = now;
      this.#identity = identity;
      this.#checkpoints = checkpointStore;
      this.recipient = recipient;
      this.publisher = publisher;
      for (const [peerId, peer] of peers) this.#peers.set(peerId, peer);
    } catch (error) {
      if (ownsCheckpointStore) checkpointStore?.close?.();
      identity.signingPrivateKey.fill(0);
      identity.boxPrivateKey.fill(0);
      throw error;
    }
  }

  /** Refuse a local/admin bearer that could be replayed to an outbound peer. */
  assertNodeBearerSeparated(nodeBearer: string | undefined): void {
    if (nodeBearer === undefined) return;
    if ([...this.#peers.values()].some((peer) => peer.bearer === nodeBearer)) {
      throw new DataSyncError(
        "invalid_server_option",
        "node_bearer must be distinct from every configured outbound peer bearer",
        400,
      );
    }
  }

  manifest(baseUrl?: string): DataSyncManifest {
    this.#assertOpen();
    const baseManifest = this.node.manifest(baseUrl);
    const base = baseUrl?.replace(/\/$/u, "");
    const endpoint = (path: string) => base ? `${base}${path}` : path;
    return {
      ...baseManifest,
      capabilities: { ...baseManifest.capabilities, peer_sync: true },
      endpoints: {
        ...baseManifest.endpoints,
        sync_page: endpoint("/v1/data/sync/page"),
        sync_pull: endpoint("/v1/data/sync/pull"),
        sync_status: endpoint("/v1/data/sync/status"),
      },
      sync: {
        protocol: AGENT_DATA_SYNC_PROTOCOL,
        feed_id: this.node.feed_id,
        mode: "explicit_pull",
        peer_discovery: false,
        encrypted_profile: ADDS_INLINE_PROFILE,
        recipient: { ...this.recipient },
        publisher: { ...this.publisher },
        limits: { ...this.limits },
      },
    };
  }

  async page(input: SyncPageRequest): Promise<SyncPage> {
    this.#assertOpen();
    const request = normalizePageRequest(input, this.limits);
    if (
      request.expected_feed_id !== undefined
      && request.expected_feed_id !== this.node.feed_id
    ) {
      throw new DataSyncError(
        "sync_feed_mismatch",
        "Requested checkpoint belongs to another change-feed incarnation",
        409,
      );
    }
    const collection = this.node.getCollection(request.collection_id);
    if (!collection) throw new DataSyncError("collection_not_found", "Collection was not found", 404);
    const recipientKey = validateRecipient(request.recipient);
    const collectionObject = await this.#encryptPayload({
      protocol: AGENT_DATA_SYNC_OBJECT_PROTOCOL,
      kind: "collection",
      collection,
    }, request.recipient, recipientKey);
    if (encodedJsonSize(collectionObject) >= this.limits.max_response_bytes) {
      throw responseTooLarge();
    }

    const changes: SyncChangeHeader[] = [];
    const acceptedCursors: string[] = [];
    let cursor = request.cursor;
    let hasMore = false;
    let plaintextBytes = 0;
    for (let index = 0; index < request.limit; index += 1) {
      const next = this.node.changes({
        collection_id: request.collection_id,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 1,
      });
      const change = next.changes[0];
      if (!change) {
        cursor = next.cursor;
        hasMore = false;
        break;
      }
      const contentSize = change.type === "record.created" ? change.record.content.size : 0;
      if (plaintextBytes + contentSize > request.max_plaintext_bytes) {
        if (changes.length === 0) {
          throw new DataSyncError(
            "sync_record_too_large",
            "The next record exceeds max_plaintext_bytes; increase the explicit pull limit",
            413,
          );
        }
        hasMore = true;
        break;
      }
      const payload = await this.#payloadForChange(change);
      const object = await this.#encryptPayload(payload, request.recipient, recipientKey);
      const header: SyncChangeHeader = {
        id: change.id,
        type: change.type,
        sequence: change.sequence,
        collection_id: change.collection_id,
        record_id: change.record_id,
        occurred_at: change.occurred_at,
        object,
      };
      const candidate = pageEnvelope(
        this.node.node_id,
        this.node.feed_id,
        request.collection_id,
        request.cursor,
        next.cursor,
        next.has_more,
        collectionObject,
        [...changes, header],
      );
      if (projectedPageConstructionSize(candidate) > this.limits.max_response_bytes) {
        if (changes.length === 0) throw responseTooLarge();
        hasMore = true;
        break;
      }
      changes.push(header);
      acceptedCursors.push(next.cursor);
      plaintextBytes += contentSize;
      cursor = next.cursor;
      hasMore = next.has_more;
      if (!hasMore) break;
    }

    syncInvariant(typeof cursor === "string" && cursor.length > 0, "invalid_change_cursor", "Data node returned an invalid cursor", 500);
    const assemblePage = async (): Promise<SyncPage> => {
      const pageWithoutControl = pageEnvelope(
        this.node.node_id,
        this.node.feed_id,
        request.collection_id,
        request.cursor,
        cursor!,
        hasMore,
        collectionObject,
        changes,
      );
      const controlObject = await this.#encryptPayload(
        pageControlPayload(pageWithoutControl),
        request.recipient,
        recipientKey,
      );
      return { ...pageWithoutControl, control_object: controlObject };
    };
    let page = await assemblePage();
    while (encodedJsonSize(page) > this.limits.max_response_bytes && changes.length > 1) {
      changes.pop();
      acceptedCursors.pop();
      cursor = acceptedCursors.at(-1)!;
      hasMore = true;
      page = await assemblePage();
    }
    if (encodedJsonSize(page) > this.limits.max_response_bytes) throw responseTooLarge();
    return page;
  }

  async pull(input: SyncPullRequest, signal?: AbortSignal): Promise<SyncPullResult> {
    this.#assertOpen();
    const request = normalizePullRequest(input, this.limits);
    const peer = this.#peers.get(request.peer_id);
    if (!peer) throw new DataSyncError("peer_not_configured", "Peer is not configured on this node", 404);
    const lockKey = `${request.peer_id.length}:${request.peer_id}${request.collection_id}`;
    if (this.#activePulls.has(lockKey)) {
      throw new DataSyncError("sync_in_progress", "A pull for this peer and collection is already running", 409);
    }
    this.#activePulls.add(lockKey);
    try {
      let pagesApplied = 0;
      let changesApplied = 0;
      let recordsInserted = 0;
      let recordsExisting = 0;
      let tombstonesApplied = 0;
      let hasMore = false;
      for (let pageIndex = 0; pageIndex < request.max_pages; pageIndex += 1) {
        const checkpoint = this.#checkpoints.get(request.peer_id, request.collection_id);
        assertCheckpointMatchesPeer(checkpoint, peer);
        const pageRequest: SyncPageRequest = {
          protocol: AGENT_DATA_SYNC_PROTOCOL,
          collection_id: request.collection_id,
          ...(checkpoint ? { cursor: checkpoint.cursor } : {}),
          ...(checkpoint ? { expected_feed_id: checkpoint.feed_id } : {}),
          limit: request.limit,
          max_plaintext_bytes: request.max_plaintext_bytes,
          recipient: { ...this.recipient },
        };
        const response = await this.#fetchPage(peer, pageRequest, signal);
        const page = validatePage(response, request.limit, this.limits);
        if (page.origin_node_id !== peer.expected_node_id) {
          throw new DataSyncError("unexpected_peer_node", "Peer response has an unexpected node identity", 502);
        }
        const counts = await this.#applyPage(
          peer,
          request.collection_id,
          page,
          checkpoint,
          request.max_plaintext_bytes,
        );
        pagesApplied += 1;
        changesApplied += page.changes.length;
        recordsInserted += counts.records_inserted;
        recordsExisting += counts.records_existing;
        tombstonesApplied += counts.tombstones_applied;
        hasMore = page.has_more;
        if (!hasMore) break;
      }
      return {
        protocol: AGENT_DATA_SYNC_PROTOCOL,
        peer_id: request.peer_id,
        origin_node_id: peer.expected_node_id,
        collection_id: request.collection_id,
        pages_applied: pagesApplied,
        changes_applied: changesApplied,
        records_inserted: recordsInserted,
        records_existing: recordsExisting,
        tombstones_applied: tombstonesApplied,
        has_more: hasMore,
        status: this.status(request.peer_id, request.collection_id),
      };
    } finally {
      this.#activePulls.delete(lockKey);
    }
  }

  status(peerId: string, collectionId: string): SyncStatus {
    this.#assertOpen();
    validatePeerId(peerId);
    validateCollectionId(collectionId);
    const peer = this.#peers.get(peerId);
    if (!peer) throw new DataSyncError("peer_not_configured", "Peer is not configured on this node", 404);
    const checkpoint = this.#checkpoints.get(peerId, collectionId);
    assertCheckpointMatchesPeer(checkpoint, peer);
    return {
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: peerId,
      collection_id: collectionId,
      cursor_present: checkpoint !== null,
      ...(checkpoint ? { last_applied_at: checkpoint.last_applied_at } : {}),
      records_inserted: checkpoint?.records_inserted ?? 0,
      records_existing: checkpoint?.records_existing ?? 0,
      tombstones_applied: checkpoint?.tombstones_applied ?? 0,
    };
  }

  /**
   * Explicit operator recovery for a deliberately replaced peer/feed.
   * Imported immutable data remains; only private continuation state is removed.
   */
  resetCheckpoint(peerId: string, collectionId: string): boolean {
    this.#assertOpen();
    validatePeerId(peerId);
    validateCollectionId(collectionId);
    if (!this.#peers.has(peerId)) {
      throw new DataSyncError("peer_not_configured", "Peer is not configured on this node", 404);
    }
    const lockKey = `${peerId.length}:${peerId}${collectionId}`;
    if (this.#activePulls.has(lockKey)) {
      throw new DataSyncError("sync_in_progress", "Cannot reset a checkpoint while its pull is running", 409);
    }
    return this.#checkpoints.delete(peerId, collectionId);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#checkpoints.close?.();
    } finally {
      this.#identity.signingPrivateKey.fill(0);
      this.#identity.boxPrivateKey.fill(0);
    }
  }

  async #payloadForChange(change: Change): Promise<RecordSyncPayload | TombstoneSyncPayload> {
    if (change.type === "record.tombstoned") {
      return {
        protocol: AGENT_DATA_SYNC_OBJECT_PROTOCOL,
        kind: "tombstone",
        tombstone: change.tombstone,
      };
    }
    const bytes = await this.node.readContent(change.record);
    try {
      return {
        protocol: AGENT_DATA_SYNC_OBJECT_PROTOCOL,
        kind: "record",
        record: change.record,
        content: { encoding: "base64url", data: encodeBase64Url(bytes) },
      };
    } finally {
      bytes.fill(0);
    }
  }

  async #encryptPayload(
    payload: SyncObjectPayload,
    recipient: SyncRecipient,
    recipientKey: Uint8Array,
  ): Promise<InlineEncryptedObject> {
    const plaintext = canonicalJsonBytes(payload);
    if (plaintext.byteLength > this.limits.max_response_bytes) {
      throw new DataSyncError("sync_object_too_large", "Sync object exceeds the node response limit", 413);
    }
    const store = new MemoryBlockStore();
    const client = new AgentData({
      identity: this.#identity,
      store,
      keyStore: new MemoryKeyStore(),
      maxBytes: plaintext.byteLength,
      now: this.#now,
    });
    try {
      const published = await client.put(plaintext, {
        chunkSize: Math.min(256 * 1024, Math.max(1, plaintext.byteLength)),
        maxBytes: plaintext.byteLength,
        mediaType: SYNC_MEDIA_TYPE,
        schema: SYNC_SCHEMA,
      });
      const issuedAt = this.#nowDate();
      const grant = await client.share(published.ref, {
        audience: recipient.id,
        audienceBoxPublicKey: recipientKey,
        audienceBoxKeyId: recipient.x25519_key_id,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + this.limits.grant_ttl_seconds * 1000),
      });
      const bundle = await client.exportBundle(published.ref);
      await client.forgetKey(published.ref);
      return { profile: ADDS_INLINE_PROFILE, bundle: bundleToWire(bundle), grant };
    } finally {
      plaintext.fill(0);
    }
  }

  async #fetchPage(peer: NormalizedPeer, request: SyncPageRequest, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Peer request timed out")),
      this.limits.request_timeout_ms,
    );
    try {
      let response: Response;
      try {
        response = await this.#fetch(`${peer.base_url}/v1/data/sync/page`, {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${peer.bearer}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (cause) {
        throw new DataSyncError("peer_unreachable", "Configured peer could not be reached", 502, { cause });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new DataSyncError(
          "peer_response_error",
          `Configured peer returned HTTP ${response.status}`,
          502,
        );
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        await response.body?.cancel().catch(() => undefined);
        throw new DataSyncError("peer_response_invalid", "Configured peer returned a non-JSON response", 502);
      }
      const bytes = await readBoundedResponse(response, this.limits.max_response_bytes);
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (cause) {
        throw new DataSyncError("peer_response_invalid", "Configured peer returned invalid JSON", 502, { cause });
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async #applyPage(
    peer: NormalizedPeer,
    collectionId: string,
    page: SyncPage,
    checkpoint: SyncCheckpoint | null,
    maxPlaintextBytes: number,
  ): Promise<ApplyCounts> {
    if (page.collection_id !== collectionId) {
      throw new DataSyncError("sync_collection_mismatch", "Peer page belongs to another collection", 502);
    }
    if (checkpoint && checkpoint.feed_id !== page.feed_id) {
      throw new DataSyncError(
        "sync_feed_mismatch",
        "Peer page belongs to another change-feed incarnation",
        409,
      );
    }
    const controlPayload = await this.#decryptPayload(
      page.control_object,
      peer.expected_publisher,
    );
    if (controlPayload.kind !== "page") {
      throw new DataSyncError("sync_page_control_invalid", "Encrypted page control has the wrong kind", 502);
    }
    assertPageControl(page, controlPayload);
    if (checkpoint) {
      if (page.previous_cursor !== checkpoint.cursor) {
        throw new DataSyncError("sync_cursor_conflict", "Peer page does not continue the local checkpoint", 409);
      }
    } else if (page.previous_cursor !== undefined) {
      throw new DataSyncError("sync_cursor_conflict", "Initial peer page unexpectedly requires a checkpoint", 409);
    }
    if (page.changes.length > 0 && page.cursor === page.previous_cursor) {
      throw new DataSyncError("sync_cursor_stalled", "Peer cursor did not advance", 502);
    }

    const collectionPayload = await this.#decryptPayload(
      page.collection_object,
      peer.expected_publisher,
    );
    if (collectionPayload.kind !== "collection" || collectionPayload.collection.id !== collectionId) {
      throw new DataSyncError("sync_collection_mismatch", "Encrypted collection does not match the requested collection", 502);
    }
    this.node.importCollection(collectionPayload.collection);

    const counts: ApplyCounts = { records_inserted: 0, records_existing: 0, tombstones_applied: 0 };
    let plaintextBytes = 0;
    for (const change of page.changes) {
      const payload = await this.#decryptPayload(change.object, peer.expected_publisher);
      if (change.type === "record.created") {
        if (payload.kind !== "record") {
          throw new DataSyncError("sync_change_mismatch", "Encrypted change kind does not match its header", 502);
        }
        validateRecordHeader(change, payload.record);
        const remaining = maxPlaintextBytes - plaintextBytes;
        const bytes = decodeBase64Url(payload.content.data, "record content", remaining);
        try {
          plaintextBytes += bytes.byteLength;
          const result = await this.node.importReplica(page.origin_node_id, payload.record, bytes);
          counts[result === "inserted" ? "records_inserted" : "records_existing"] += 1;
        } finally {
          bytes.fill(0);
        }
      } else {
        if (payload.kind !== "tombstone") {
          throw new DataSyncError("sync_change_mismatch", "Encrypted change kind does not match its header", 502);
        }
        validateTombstoneHeader(change, payload.tombstone);
        const result = await this.node.importTombstone(page.origin_node_id, payload.tombstone);
        if (result === "inserted") counts.tombstones_applied += 1;
      }
    }

    const now = this.#nowDate().toISOString();
    this.#checkpoints.set({
      peer_id: peer.peer_id,
      collection_id: collectionId,
      peer_base_url: peer.base_url,
      origin_node_id: page.origin_node_id,
      feed_id: page.feed_id,
      publisher_id: peer.expected_publisher.id,
      publisher_ed25519_public_key: peer.expected_publisher.ed25519_public_key,
      cursor: page.cursor,
      last_applied_at: now,
      records_inserted: (checkpoint?.records_inserted ?? 0) + counts.records_inserted,
      records_existing: (checkpoint?.records_existing ?? 0) + counts.records_existing,
      tombstones_applied: (checkpoint?.tombstones_applied ?? 0) + counts.tombstones_applied,
    });
    return counts;
  }

  async #decryptPayload(
    object: InlineEncryptedObject,
    expectedPublisher: SyncPublisher,
  ): Promise<SyncObjectPayload> {
    try {
      const bundle = bundleFromWire(object.bundle, {
        max_blocks: MAX_BUNDLE_BLOCKS,
        max_bytes: this.limits.max_response_bytes,
      });
      const grant = validateGrant(object.grant);
      if (
        grant.issuer.id !== expectedPublisher.id
        || grant.issuer.ed25519_public_key !== expectedPublisher.ed25519_public_key
      ) {
        throw new DataSyncError(
          "unexpected_sync_publisher",
          "Encrypted sync object was not signed by the configured publisher",
          502,
        );
      }
      if (grant.manifest_cid !== bundle.root.cid) {
        throw new DataSyncError("sync_object_invalid", "Encrypted object grant references another bundle", 502);
      }
      const store = new MemoryBlockStore();
      const client = new AgentData({
        identity: this.#identity,
        store,
        keyStore: new MemoryKeyStore(),
        maxBytes: this.limits.max_response_bytes,
        now: this.#now,
      });
      await client.importBundle(bundle);
      const plaintext = await client.get(bundle.root, {
        grant,
        maxBytes: this.limits.max_response_bytes,
      });
      try {
        return validatePayload(parseCanonicalJson(plaintext));
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      if (error instanceof DataSyncError) throw error;
      if (error instanceof AgentDataError) {
        throw new DataSyncError("sync_object_invalid", "Encrypted sync object failed verification", 502, { cause: error });
      }
      throw new DataSyncError("sync_object_invalid", "Encrypted sync object could not be opened", 502, { cause: error });
    }
  }

  #nowDate(): Date {
    const value = this.#now();
    const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new DataSyncError("invalid_clock", "Sync clock returned an invalid time", 500);
    return date;
  }

  #assertOpen(): void {
    if (this.#closed) throw new DataSyncError("sync_service_closed", "Sync service is closed", 410);
  }
}

function normalizeLimits(overrides: Partial<SyncLimits> | undefined): SyncLimits {
  const limits = { ...DEFAULT_SYNC_LIMITS, ...overrides };
  for (const [field, value] of Object.entries(limits)) {
    syncInvariant(Number.isSafeInteger(value) && value > 0, "invalid_sync_limits", `${field} must be a positive integer`);
  }
  syncInvariant(limits.default_page_changes <= limits.max_page_changes, "invalid_sync_limits", "default_page_changes exceeds max_page_changes");
  syncInvariant(limits.default_plaintext_bytes <= limits.max_plaintext_bytes, "invalid_sync_limits", "default_plaintext_bytes exceeds max_plaintext_bytes");
  syncInvariant(limits.default_pull_pages <= limits.max_pull_pages, "invalid_sync_limits", "default_pull_pages exceeds max_pull_pages");
  syncInvariant(limits.max_plaintext_bytes < limits.max_response_bytes, "invalid_sync_limits", "max_response_bytes must exceed max_plaintext_bytes");
  syncInvariant(limits.grant_ttl_seconds <= 24 * 60 * 60, "invalid_sync_limits", "grant_ttl_seconds cannot exceed one day");
  return limits;
}

function normalizePeer(peer: SyncPeerConfig): NormalizedPeer {
  syncInvariant(peer && typeof peer === "object", "invalid_peer", "Peer configuration is required");
  validatePeerId(peer.peer_id);
  validateNodeId(peer.expected_node_id, "invalid_peer");
  const expectedPublisher = normalizePublisher(peer.expected_publisher);
  syncInvariant(typeof peer.bearer === "string" && peer.bearer.length > 0, "invalid_peer", "Peer bearer is required");
  let url: URL;
  try {
    url = new URL(peer.base_url);
  } catch (cause) {
    throw new DataSyncError("invalid_peer", "Peer base_url is invalid", 400, { cause });
  }
  syncInvariant(url.username === "" && url.password === "", "invalid_peer", "Peer base_url must not contain credentials");
  syncInvariant(url.pathname === "/" && url.search === "" && url.hash === "", "invalid_peer", "Peer base_url must be an exact origin");
  syncInvariant(url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname)), "invalid_peer", "Peer base_url requires HTTPS except for loopback development");
  return { ...peer, expected_publisher: expectedPublisher, base_url: url.origin };
}

type NormalizedPageRequest = Omit<
  Required<SyncPageRequest>,
  "cursor" | "expected_feed_id"
> & Pick<SyncPageRequest, "cursor" | "expected_feed_id">;

function normalizePageRequest(input: SyncPageRequest, limits: SyncLimits): NormalizedPageRequest {
  const value = requireObject(input, "page request");
  const expectedKeys = ["protocol", "collection_id", "recipient"];
  if (value.cursor !== undefined) expectedKeys.push("cursor");
  if (value.expected_feed_id !== undefined) expectedKeys.push("expected_feed_id");
  if (value.limit !== undefined) expectedKeys.push("limit");
  if (value.max_plaintext_bytes !== undefined) expectedKeys.push("max_plaintext_bytes");
  requireRequestKeys(value, expectedKeys, "page request");
  syncInvariant(input.protocol === AGENT_DATA_SYNC_PROTOCOL, "unsupported_sync_protocol", "Sync protocol is unsupported");
  validateCollectionId(input.collection_id);
  validateCursor(input.cursor);
  if (input.expected_feed_id !== undefined) validateFeedId(input.expected_feed_id);
  syncInvariant(
    (input.cursor === undefined) === (input.expected_feed_id === undefined),
    "invalid_sync_request",
    "cursor and expected_feed_id must be supplied together",
  );
  return {
    protocol: AGENT_DATA_SYNC_PROTOCOL,
    collection_id: input.collection_id,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.expected_feed_id === undefined
      ? {}
      : { expected_feed_id: input.expected_feed_id }),
    limit: bounded(input.limit, limits.default_page_changes, limits.max_page_changes, "limit"),
    max_plaintext_bytes: bounded(input.max_plaintext_bytes, limits.default_plaintext_bytes, limits.max_plaintext_bytes, "max_plaintext_bytes"),
    recipient: normalizeRecipientShape(input.recipient),
  };
}

function normalizePullRequest(input: SyncPullRequest, limits: SyncLimits): Required<SyncPullRequest> {
  const value = requireObject(input, "pull request");
  const expectedKeys = ["protocol", "peer_id", "collection_id"];
  if (value.limit !== undefined) expectedKeys.push("limit");
  if (value.max_pages !== undefined) expectedKeys.push("max_pages");
  if (value.max_plaintext_bytes !== undefined) expectedKeys.push("max_plaintext_bytes");
  requireRequestKeys(value, expectedKeys, "pull request");
  syncInvariant(input.protocol === AGENT_DATA_SYNC_PROTOCOL, "unsupported_sync_protocol", "Sync protocol is unsupported");
  validatePeerId(input.peer_id);
  validateCollectionId(input.collection_id);
  return {
    protocol: AGENT_DATA_SYNC_PROTOCOL,
    peer_id: input.peer_id,
    collection_id: input.collection_id,
    limit: bounded(input.limit, limits.default_page_changes, limits.max_page_changes, "limit"),
    max_pages: bounded(input.max_pages, limits.default_pull_pages, limits.max_pull_pages, "max_pages"),
    max_plaintext_bytes: bounded(input.max_plaintext_bytes, limits.default_plaintext_bytes, limits.max_plaintext_bytes, "max_plaintext_bytes"),
  };
}

function normalizeRecipientShape(value: SyncRecipient): SyncRecipient {
  const recipient = requireObject(value, "recipient");
  requireRequestKeys(recipient, ["id", "x25519_public_key", "x25519_key_id"], "recipient");
  syncInvariant(typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_ID_CHARS, "invalid_recipient", "Recipient id is invalid");
  syncInvariant(typeof value.x25519_public_key === "string", "invalid_recipient", "Recipient X25519 public key is invalid");
  syncInvariant(typeof value.x25519_key_id === "string", "invalid_recipient", "Recipient X25519 key id is invalid");
  return { ...value };
}

function validateRecipient(recipient: SyncRecipient): Uint8Array {
  let key: Uint8Array;
  try {
    key = decodeBase64Url(recipient.x25519_public_key, "recipient.x25519_public_key", 32);
  } catch (cause) {
    throw new DataSyncError("invalid_recipient", "Recipient X25519 public key is invalid", 400, { cause });
  }
  syncInvariant(key.byteLength === 32, "invalid_recipient", "Recipient X25519 public key must be 32 bytes");
  syncInvariant(x25519KeyId(key) === recipient.x25519_key_id, "invalid_recipient", "Recipient X25519 key id does not match its public key");
  return key;
}

function normalizePublisher(value: SyncPublisher): SyncPublisher {
  const publisher = requireObject(value, "expected_publisher");
  try {
    requireExactKeys(publisher, ["id", "ed25519_public_key"], "expected_publisher");
  } catch (cause) {
    throw new DataSyncError("invalid_peer", "Peer expected_publisher is invalid", 400, { cause });
  }
  syncInvariant(
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_ID_CHARS,
    "invalid_peer",
    "Peer expected publisher id is invalid",
  );
  let publicKey: Uint8Array;
  try {
    publicKey = decodeBase64Url(value.ed25519_public_key, "expected publisher key", 32);
  } catch (cause) {
    throw new DataSyncError("invalid_peer", "Peer expected publisher key is invalid", 400, { cause });
  }
  syncInvariant(publicKey.byteLength === 32, "invalid_peer", "Peer expected publisher key is invalid");
  return { id: value.id, ed25519_public_key: value.ed25519_public_key };
}

function validatePage(value: unknown, requestedLimit: number, limits: SyncLimits): SyncPage {
  const page = requireObject(value, "sync page");
  const keys = ["protocol", "origin_node_id", "feed_id", "collection_id", "cursor", "has_more", "control_object", "collection_object", "changes"];
  if (page.previous_cursor !== undefined) keys.push("previous_cursor");
  requireExactKeys(page, keys, "sync page");
  syncInvariant(page.protocol === AGENT_DATA_SYNC_PROTOCOL, "invalid_sync_page", "Peer page protocol is unsupported", 502);
  syncInvariant(
    typeof page.origin_node_id === "string"
      && page.origin_node_id.length > 0
      && page.origin_node_id.length <= MAX_NODE_ID_CHARS
      && !/[\u0000-\u001f\u007f]/u.test(page.origin_node_id),
    "invalid_sync_page",
    "Peer node id is invalid",
    502,
  );
  validateFeedIdFromPeer(page.feed_id);
  validateCollectionIdFromPeer(page.collection_id);
  validateCursorFromPeer(page.previous_cursor);
  validateCursorFromPeer(page.cursor, true);
  syncInvariant(typeof page.has_more === "boolean", "invalid_sync_page", "Peer page has_more is invalid", 502);
  const collectionObject = validateInlineObject(page.collection_object);
  const controlObject = validateInlineObject(page.control_object);
  syncInvariant(Array.isArray(page.changes) && page.changes.length <= requestedLimit && page.changes.length <= limits.max_page_changes, "invalid_sync_page", "Peer page change count is invalid", 502);
  if (page.has_more && page.changes.length === 0) {
    throw new DataSyncError("invalid_sync_page", "Peer page cannot be empty while has_more is true", 502);
  }
  let priorSequence = 0;
  const changes = page.changes.map((entry, index) => {
    const change = requireObject(entry, `changes[${index}]`);
    requireExactKeys(change, ["id", "type", "sequence", "collection_id", "record_id", "occurred_at", "object"], `changes[${index}]`);
    syncInvariant(change.type === "record.created" || change.type === "record.tombstoned", "invalid_sync_page", "Peer change type is invalid", 502);
    syncInvariant(Number.isSafeInteger(change.sequence) && (change.sequence as number) > priorSequence, "invalid_sync_page", "Peer change sequence is invalid", 502);
    priorSequence = change.sequence as number;
    syncInvariant(change.id === `change_${change.sequence}`, "invalid_sync_page", "Peer change id is invalid", 502);
    syncInvariant(change.collection_id === page.collection_id, "invalid_sync_page", "Peer change belongs to another collection", 502);
    syncInvariant(typeof change.record_id === "string" && /^rec_[a-f0-9]{64}$/u.test(change.record_id), "invalid_sync_page", "Peer record id is invalid", 502);
    syncInvariant(typeof change.occurred_at === "string" && Number.isFinite(Date.parse(change.occurred_at)), "invalid_sync_page", "Peer change timestamp is invalid", 502);
    return {
      id: change.id as string,
      type: change.type,
      sequence: change.sequence as number,
      collection_id: change.collection_id as string,
      record_id: change.record_id,
      occurred_at: change.occurred_at,
      object: validateInlineObject(change.object),
    } as SyncChangeHeader;
  });
  return {
    protocol: AGENT_DATA_SYNC_PROTOCOL,
    origin_node_id: page.origin_node_id,
    feed_id: page.feed_id as string,
    collection_id: page.collection_id as string,
    ...(page.previous_cursor === undefined ? {} : { previous_cursor: page.previous_cursor as string }),
    cursor: page.cursor as string,
    has_more: page.has_more,
    control_object: controlObject,
    collection_object: collectionObject,
    changes,
  };
}

function validateInlineObject(value: unknown): InlineEncryptedObject {
  const object = requireObject(value, "encrypted object");
  requireExactKeys(object, ["profile", "bundle", "grant"], "encrypted object");
  syncInvariant(object.profile === ADDS_INLINE_PROFILE, "invalid_sync_page", "Encrypted object profile is unsupported", 502);
  const grant = requireObject(object.grant, "encrypted object grant") as unknown as SignedGrant;
  return {
    profile: ADDS_INLINE_PROFILE,
    bundle: object.bundle as InlineEncryptedObject["bundle"],
    grant,
  };
}

function validatePayload(value: unknown): SyncObjectPayload {
  const payload = requireObject(value, "sync object");
  syncInvariant(payload.protocol === AGENT_DATA_SYNC_OBJECT_PROTOCOL, "sync_object_invalid", "Encrypted object protocol is unsupported", 502);
  if (payload.kind === "collection") {
    requireExactKeys(payload, ["protocol", "kind", "collection"], "collection sync object");
    syncInvariant(payload.collection !== null && typeof payload.collection === "object" && !Array.isArray(payload.collection), "sync_object_invalid", "Encrypted collection is invalid", 502);
    return payload as unknown as CollectionSyncPayload;
  }
  if (payload.kind === "record") {
    requireExactKeys(payload, ["protocol", "kind", "record", "content"], "record sync object");
    const content = requireObject(payload.content, "record content");
    requireExactKeys(content, ["encoding", "data"], "record content");
    syncInvariant(content.encoding === "base64url" && typeof content.data === "string", "sync_object_invalid", "Encrypted record content is invalid", 502);
    syncInvariant(payload.record !== null && typeof payload.record === "object" && !Array.isArray(payload.record), "sync_object_invalid", "Encrypted record is invalid", 502);
    return payload as unknown as RecordSyncPayload;
  }
  if (payload.kind === "tombstone") {
    requireExactKeys(payload, ["protocol", "kind", "tombstone"], "tombstone sync object");
    syncInvariant(payload.tombstone !== null && typeof payload.tombstone === "object" && !Array.isArray(payload.tombstone), "sync_object_invalid", "Encrypted tombstone is invalid", 502);
    return payload as unknown as TombstoneSyncPayload;
  }
  if (payload.kind === "page") {
    const keys = [
      "protocol",
      "kind",
      "origin_node_id",
      "feed_id",
      "collection_id",
      "cursor",
      "has_more",
      "collection_object_cid",
      "changes",
    ];
    if (payload.previous_cursor !== undefined) keys.push("previous_cursor");
    requireExactKeys(payload, keys, "page control sync object");
    return payload as unknown as PageSyncPayload;
  }
  throw new DataSyncError("sync_object_invalid", "Encrypted object kind is unsupported", 502);
}

function validateRecordHeader(change: SyncChangeHeader, record: RecordEnvelope): void {
  if (record.id !== change.record_id || record.collection_id !== change.collection_id) {
    throw new DataSyncError("sync_change_mismatch", "Encrypted record does not match its change header", 502);
  }
}

function validateTombstoneHeader(change: SyncChangeHeader, tombstone: Tombstone): void {
  if (tombstone.record_id !== change.record_id || tombstone.collection_id !== change.collection_id) {
    throw new DataSyncError("sync_change_mismatch", "Encrypted tombstone does not match its change header", 502);
  }
}

function pageEnvelope(
  originNodeId: string,
  feedId: string,
  collectionId: string,
  previousCursor: string | undefined,
  cursor: string,
  hasMore: boolean,
  collectionObject: InlineEncryptedObject,
  changes: SyncChangeHeader[],
): Omit<SyncPage, "control_object"> {
  return {
    protocol: AGENT_DATA_SYNC_PROTOCOL,
    origin_node_id: originNodeId,
    feed_id: feedId,
    collection_id: collectionId,
    ...(previousCursor === undefined ? {} : { previous_cursor: previousCursor }),
    cursor,
    has_more: hasMore,
    collection_object: collectionObject,
    changes,
  };
}

/**
 * A lower bound that is cheap enough to apply after every encrypted change.
 * It counts the retained routing/collection/change envelope plus the canonical
 * control plaintext; the exact encrypted control object is checked afterward.
 */
function projectedPageConstructionSize(page: Omit<SyncPage, "control_object">): number {
  return encodedJsonSize(page) + encodedJsonSize(pageControlPayload(page));
}

function responseTooLarge(): DataSyncError {
  return new DataSyncError(
    "sync_response_too_large",
    "Encrypted page exceeds the node response limit; reduce limit or max_plaintext_bytes",
    413,
  );
}

function pageControlPayload(page: Omit<SyncPage, "control_object"> | SyncPage): PageSyncPayload {
  return {
    protocol: AGENT_DATA_SYNC_OBJECT_PROTOCOL,
    kind: "page",
    origin_node_id: page.origin_node_id,
    feed_id: page.feed_id,
    collection_id: page.collection_id,
    ...(page.previous_cursor === undefined ? {} : { previous_cursor: page.previous_cursor }),
    cursor: page.cursor,
    has_more: page.has_more,
    collection_object_cid: page.collection_object.bundle.root.cid,
    changes: page.changes.map((change) => ({
      id: change.id,
      type: change.type,
      sequence: change.sequence,
      collection_id: change.collection_id,
      record_id: change.record_id,
      occurred_at: change.occurred_at,
      object_cid: change.object.bundle.root.cid,
    })),
  };
}

function assertPageControl(page: SyncPage, control: PageSyncPayload): void {
  const expected = pageControlPayload(page);
  if (
    encodeBase64Url(canonicalJsonBytes(control))
    !== encodeBase64Url(canonicalJsonBytes(expected))
  ) {
    throw new DataSyncError(
      "sync_page_control_invalid",
      "Encrypted page control does not match the visible routing envelope",
      502,
    );
  }
}

function bounded(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  syncInvariant(Number.isSafeInteger(result) && result > 0, "invalid_sync_request", `${field} must be a positive integer`);
  syncInvariant(result <= maximum, "sync_limit_exceeded", `${field} exceeds the configured maximum`);
  return result;
}

function validatePeerId(value: string): void {
  syncInvariant(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value), "invalid_peer_id", "peer_id is invalid");
}

function validateNodeId(value: string, code: string): void {
  syncInvariant(
    typeof value === "string"
      && value.length > 0
      && value.length <= MAX_NODE_ID_CHARS
      && !/[\u0000-\u001f\u007f]/u.test(value),
    code,
    "Sync node id is invalid",
  );
}

function validateCollectionId(value: string): void {
  syncInvariant(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value), "invalid_collection_id", "collection_id is invalid");
}

function validateCollectionIdFromPeer(value: unknown): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new DataSyncError("invalid_sync_page", "Peer collection id is invalid", 502);
  }
}

function validateFeedId(value: string): void {
  syncInvariant(
    /^feed_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value),
    "invalid_feed_id",
    "expected_feed_id is invalid",
  );
}

function validateFeedIdFromPeer(value: unknown): void {
  if (
    typeof value !== "string"
    || !/^feed_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  ) {
    throw new DataSyncError("invalid_sync_page", "Peer feed id is invalid", 502);
  }
}

function assertCheckpointMatchesPeer(
  checkpoint: SyncCheckpoint | null,
  peer: NormalizedPeer,
): void {
  if (!checkpoint) return;
  if (
    checkpoint.peer_base_url !== peer.base_url
    || checkpoint.origin_node_id !== peer.expected_node_id
    || checkpoint.publisher_id !== peer.expected_publisher.id
    || checkpoint.publisher_ed25519_public_key
      !== peer.expected_publisher.ed25519_public_key
  ) {
    throw new DataSyncError(
      "sync_checkpoint_peer_mismatch",
      "Stored checkpoint belongs to another configured peer identity or origin",
      409,
    );
  }
}

function validateCursor(value: string | undefined): void {
  syncInvariant(value === undefined || (typeof value === "string" && value.length > 0 && value.length <= MAX_CURSOR_CHARS), "invalid_sync_cursor", "cursor is invalid");
}

function validateCursorFromPeer(value: unknown, required = false): void {
  if (value === undefined && !required) return;
  syncInvariant(typeof value === "string" && value.length > 0 && value.length <= MAX_CURSOR_CHARS, "invalid_sync_page", "Peer cursor is invalid", 502);
}

function requireRequestKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  try {
    requireExactKeys(value, keys, label);
  } catch (error) {
    if (error instanceof DataSyncError) {
      throw new DataSyncError("invalid_sync_request", `${label} has unsupported fields`, 400, { cause: error });
    }
    throw error;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      await response.body?.cancel().catch(() => undefined);
      throw new DataSyncError("peer_response_invalid", "Peer response Content-Length is invalid", 502);
    }
    if (declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new DataSyncError("sync_response_too_large", "Peer response exceeds the configured limit", 502);
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DataSyncError("sync_response_too_large", "Peer response exceeds the configured limit", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function encodedJsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
