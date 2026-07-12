import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateIdentity, x25519KeyId } from "@agenttool/adds";
import { DataNode } from "@agenttool/data";
import {
  AGENT_DATA_SYNC_PROTOCOL,
  DataSyncService,
  createDataSyncFetchHandler,
  serveDataSyncNode,
  type SyncPageAuthority,
  type SyncPublisher,
  type SyncRecipient,
} from "../src/index.js";

const NOW = 1_783_728_000;
const roots: string[] = [];
const openNodes: DataNode[] = [];
const openServices: DataSyncService[] = [];
const openServers: Bun.Server<undefined>[] = [];

afterEach(() => {
  for (const server of openServers.splice(0)) server.stop(true);
  for (const service of openServices.splice(0)) service.close();
  for (const node of openNodes.splice(0)) node.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function node(
  name: string,
  collections = true,
  nodeId = `node_${name}`,
): Promise<DataNode> {
  const root = mkdtempSync(join(tmpdir(), `agent-data-sync-${name}-`));
  roots.push(root);
  const value = await DataNode.open({
    root,
    node_id: nodeId,
    ...(collections ? {
      collections: [{
        id: "research",
        name: "private-watermelon-notes",
        schema: { version: "1" },
        policy: { visibility: "private", allowed_media_types: ["text/plain"] },
      }],
    } : {}),
  });
  openNodes.push(value);
  return value;
}

async function collect(source: DataNode, text: string, externalId: string): Promise<string> {
  const result = await source.collect({
    collection_id: "research",
    collector_id: "text",
    input: {
      text,
      media_type: "text/plain",
      source_uri: `urn:test:${externalId}`,
      external_id: externalId,
      metadata: { secret_topic: "juicy-ciphertext-only" },
    },
  });
  return result.records[0]!.id;
}

function service(
  local: DataNode,
  identity: ReturnType<typeof generateIdentity>,
  options: ConstructorParameters<typeof DataSyncService>[0] = { node: local, identity },
): DataSyncService {
  const value = new DataSyncService({ now: () => NOW, ...options, node: local, identity });
  openServices.push(value);
  return value;
}

function routedFetch(handler: (request: Request) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function recipientFor(identity: ReturnType<typeof generateIdentity>): SyncRecipient {
  return {
    id: identity.id,
    x25519_public_key: base64Url(identity.boxPublicKey),
    x25519_key_id: x25519KeyId(identity.boxPublicKey),
  };
}

function publisherFor(identity: ReturnType<typeof generateIdentity>): SyncPublisher {
  return { id: identity.id, ed25519_public_key: base64Url(identity.signingPublicKey) };
}

function pageAuthority(
  identity: ReturnType<typeof generateIdentity>,
  bearer: string,
  collectionIds: string[] = ["research"],
): SyncPageAuthority {
  return {
    peer_id: identity.id,
    bearer,
    collection_ids: collectionIds,
    recipient: recipientFor(identity),
  };
}

describe("agent-data-sync/v1", () => {
  test("pulls encrypted pages, resumes after restart, and queries completely offline", async () => {
    const source = await node("source");
    const destinationRoot = mkdtempSync(join(tmpdir(), "agent-data-sync-destination-"));
    roots.push(destinationRoot);
    let destination = await DataNode.open({ root: destinationRoot, node_id: "node_destination" });
    openNodes.push(destination);
    const sourceIdentity = generateIdentity("did:example:sync-source");
    const destinationIdentity = generateIdentity("did:example:sync-destination");
    const firstId = await collect(source, "watermelon alpha is extremely juicy", "alpha");
    await collect(source, "watermelon beta stayed in the fridge", "beta");

    const sourceService = service(source, sourceIdentity);
    const sourceServer = serveDataSyncNode(sourceService, {
      hostname: "127.0.0.1",
      port: 0,
      node_bearer: "source-local-token",
      page_authorities: [pageAuthority(destinationIdentity, "source-page-token")],
    });
    openServers.push(sourceServer);
    const checkpointPath = join(destinationRoot, "sync.sqlite");
    let destinationService = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: `http://127.0.0.1:${sourceServer.port}`,
        bearer: "source-page-token",
      }],
    });

    const first = await destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
      limit: 1,
      max_pages: 1,
    });
    expect(first).toMatchObject({ pages_applied: 1, changes_applied: 1, has_more: true });
    expect(first.status.cursor_present).toBe(true);
    expect(JSON.stringify(first)).not.toContain("cursor\":");

    destinationService.close();
    openServices.splice(openServices.indexOf(destinationService), 1);
    destination.close();
    openNodes.splice(openNodes.indexOf(destination), 1);
    destination = await DataNode.open({ root: destinationRoot, node_id: "node_destination" });
    openNodes.push(destination);
    destinationService = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: `http://127.0.0.1:${sourceServer.port}`,
        bearer: "source-page-token",
      }],
    });
    const resumed = await destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
      limit: 1,
      max_pages: 10,
    });
    expect(resumed.has_more).toBe(false);
    expect(resumed.records_inserted).toBe(1);
    expect(resumed.status.records_inserted).toBe(2);

    const hits = destination.query({
      collections: ["research"],
      text: "extremely juicy",
      consistency: "local",
    });
    expect(hits.records.map((hit) => hit.record.id)).toEqual([firstId]);
    expect(new TextDecoder().decode(await destination.readContent(firstId))).toContain("watermelon alpha");
  });

  test("keeps collection metadata, record metadata, content, and tombstone reason out of page plaintext", async () => {
    const source = await node("privacy");
    const recordId = await collect(source, "FRIDGED-WATERMELON-SECRET", "privacy-record");
    await source.tombstone(recordId, "SECRET-TOMBSTONE-REASON");
    const sourceService = service(source, generateIdentity("did:example:privacy-source"));
    const recipient = generateIdentity("did:example:privacy-recipient");
    const recipientService = service(await node("privacy-recipient", false), recipient);

    const page = await sourceService.page({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      collection_id: "research",
      limit: 10,
      recipient: { ...recipientService.recipient },
    });
    const wire = JSON.stringify(page);
    expect(wire).not.toContain("FRIDGED-WATERMELON-SECRET");
    expect(wire).not.toContain("SECRET-TOMBSTONE-REASON");
    expect(wire).not.toContain("private-watermelon-notes");
    expect(wire).not.toContain("juicy-ciphertext-only");
    expect(wire).not.toContain("signingPrivateKey");
    expect(wire).not.toContain("boxPrivateKey");
    expect(page.changes).toHaveLength(2);
  });

  test("stops page construction at the encrypted response budget", async () => {
    const source = await node("page-budget");
    for (let index = 0; index < 5; index += 1) {
      await collect(source, `bounded encrypted payload ${index} ${"x".repeat(96)}`, `page-budget-${index}`);
    }
    const sourceIdentity = generateIdentity("did:example:page-budget-source");
    const recipientIdentity = generateIdentity("did:example:page-budget-recipient");
    const recipient = recipientFor(recipientIdentity);
    const probe = service(source, sourceIdentity);
    const oneChangePage = await probe.page({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      collection_id: "research",
      limit: 1,
      max_plaintext_bytes: 4096,
      recipient,
    });
    const responseCap = new TextEncoder().encode(JSON.stringify(oneChangePage)).byteLength;
    let contentReads = 0;
    const readContent = source.readContent.bind(source);
    source.readContent = async (recordOrId) => {
      contentReads += 1;
      return readContent(recordOrId);
    };
    const bounded = service(source, sourceIdentity, {
      node: source,
      identity: sourceIdentity,
      limits: {
        default_page_changes: 5,
        max_page_changes: 5,
        default_plaintext_bytes: 4096,
        max_plaintext_bytes: 4096,
        max_response_bytes: responseCap,
      },
    });

    const page = await bounded.page({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      collection_id: "research",
      limit: 5,
      max_plaintext_bytes: 4096,
      recipient,
    });
    expect(page.changes).toHaveLength(1);
    expect(page.has_more).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(responseCap);
    expect(contentReads).toBe(2);
  });

  test("rejects tampered encrypted blocks without advancing a checkpoint", async () => {
    const source = await node("tamper-source");
    const destination = await node("tamper-destination", false);
    await collect(source, "tamper me only as ciphertext", "tamper");
    const sourceIdentity = generateIdentity("did:example:tamper-source");
    const destinationIdentity = generateIdentity("did:example:tamper-destination");
    const sourceService = service(source, sourceIdentity);
    const sourceHandler = createDataSyncFetchHandler(sourceService, {
      page_authorities: [pageAuthority(destinationIdentity, "tamper-token")],
    });
    const tamperingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const honest = await sourceHandler(new Request(input, init));
      const page = await honest.json() as Record<string, any>;
      const data = page.collection_object.bundle.blocks[0].data as string;
      page.collection_object.bundle.blocks[0].data = `${data.startsWith("A") ? "B" : "A"}${data.slice(1)}`;
      return new Response(JSON.stringify(page), {
        status: honest.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const pulling = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7789",
        bearer: "tamper-token",
      }],
      fetch: tamperingFetch,
    });

    await expect(pulling.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "sync_object_invalid" });
    expect(pulling.status("source", "research")).toMatchObject({
      cursor_present: false,
      records_inserted: 0,
    });
    expect(destination.getCollection("research")).toBeNull();
  });

  test("rejects a child object grant from any publisher other than the pinned source", async () => {
    const source = await node("child-publisher-source");
    const attacker = await node("child-publisher-attacker");
    const destination = await node("child-publisher-destination", false);
    await collect(source, "honest child object", "child-publisher");
    const sourceIdentity = generateIdentity("did:example:child-publisher-source");
    const attackerIdentity = generateIdentity("did:example:child-publisher-attacker");
    const destinationIdentity = generateIdentity("did:example:child-publisher-destination");
    const sourceService = service(source, sourceIdentity);
    const attackerService = service(attacker, attackerIdentity);
    const mixedPublisherFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json() as Parameters<DataSyncService["page"]>[0];
      const honestPage = await sourceService.page(body);
      const attackerPage = await attackerService.page(body);
      honestPage.collection_object.grant = attackerPage.collection_object.grant;
      return new Response(JSON.stringify(honestPage), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const pulling = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7799",
        bearer: "unused-by-injected-peer",
      }],
      fetch: mixedPublisherFetch,
    });

    await expect(pulling.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "unexpected_sync_publisher" });
    expect(pulling.status("source", "research").cursor_present).toBe(false);
    expect(destination.getCollection("research")).toBeNull();
  });

  test("detects cursor and ordering-envelope tampering through the encrypted page control", async () => {
    const source = await node("control-source");
    const destination = await node("control-destination", false);
    await collect(source, "signed page control", "control");
    const sourceIdentity = generateIdentity("did:example:control-source");
    const identity = generateIdentity("did:example:control-destination");
    const sourceService = service(source, sourceIdentity);
    const sourceHandler = createDataSyncFetchHandler(sourceService, {
      page_authorities: [pageAuthority(identity, "control-token")],
    });
    const cursorTamperingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const honest = await sourceHandler(new Request(input, init));
      const page = await honest.json() as Record<string, unknown>;
      page.cursor = `${String(page.cursor)}A`;
      return new Response(JSON.stringify(page), {
        status: honest.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const pulling = service(destination, identity, {
      node: destination,
      identity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7793",
        bearer: "control-token",
      }],
      fetch: cursorTamperingFetch,
    });

    await expect(pulling.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "sync_page_control_invalid" });
    expect(pulling.status("source", "research").cursor_present).toBe(false);
    expect(destination.getCollection("research")).toBeNull();
  });

  test("enforces the destination plaintext cap even when the peer ignores the request", async () => {
    const source = await node("dishonest-limit-source");
    const destination = await node("dishonest-limit-destination", false);
    const recordId = await collect(source, "larger than four bytes", "dishonest-limit");
    const sourceIdentity = generateIdentity("did:example:dishonest-limit-source");
    const destinationIdentity = generateIdentity("did:example:dishonest-limit-destination");
    const sourceService = service(source, sourceIdentity);
    const ignoresRequestedCap = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json() as Parameters<DataSyncService["page"]>[0];
      const page = await sourceService.page({
        ...body,
        max_plaintext_bytes: 1024,
      });
      return new Response(JSON.stringify(page), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const pulling = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7798",
        bearer: "unused-by-injected-peer",
      }],
      fetch: ignoresRequestedCap,
    });

    await expect(pulling.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
      max_plaintext_bytes: 4,
    })).rejects.toMatchObject({ code: "sync_response_too_large" });
    expect(pulling.status("source", "research").cursor_present).toBe(false);
    expect(destination.getRecord(recordId)).toBeNull();
  });

  test("separates page-only authority from local admin and pins collection, recipient, and publisher", async () => {
    const source = await node("authority-source");
    const destination = await node("authority-destination", false);
    await collect(source, "scoped peer data", "authority");
    const sourceIdentity = generateIdentity("did:example:authority-source");
    const destinationIdentity = generateIdentity("did:example:authority-destination");
    const sourceService = service(source, sourceIdentity);
    expect(() => createDataSyncFetchHandler(sourceService, {
      node_bearer: "same-token",
      page_authorities: [pageAuthority(destinationIdentity, "same-token")],
    })).toThrow("distinct from node_bearer");
    const handler = createDataSyncFetchHandler(sourceService, {
      node_bearer: "source-local-admin",
      page_authorities: [pageAuthority(destinationIdentity, "destination-page-only")],
    });
    const pageBody = {
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      collection_id: "research",
      recipient: recipientFor(destinationIdentity),
    };

    const pageTokenOnLocalData = await handler(new Request(
      "http://127.0.0.1/v1/data/collections",
      { headers: { authorization: "Bearer destination-page-only" } },
    ));
    expect(pageTokenOnLocalData.status).toBe(401);
    const pageTokenOnPull = await handler(new Request(
      "http://127.0.0.1/v1/data/sync/pull",
      {
        method: "POST",
        headers: {
          authorization: "Bearer destination-page-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          protocol: AGENT_DATA_SYNC_PROTOCOL,
          peer_id: "anything",
          collection_id: "research",
        }),
      },
    ));
    expect(pageTokenOnPull.status).toBe(401);
    const localTokenOnPage = await handler(new Request(
      "http://127.0.0.1/v1/data/sync/page",
      {
        method: "POST",
        headers: {
          authorization: "Bearer source-local-admin",
          "content-type": "application/json",
        },
        body: JSON.stringify(pageBody),
      },
    ));
    expect(localTokenOnPage.status).toBe(401);

    const wrongRecipient = structuredClone(pageBody);
    wrongRecipient.recipient = recipientFor(generateIdentity("did:example:not-authorised"));
    const recipientDenied = await handler(new Request(
      "http://127.0.0.1/v1/data/sync/page",
      {
        method: "POST",
        headers: {
          authorization: "Bearer destination-page-only",
          "content-type": "application/json",
        },
        body: JSON.stringify(wrongRecipient),
      },
    ));
    expect(recipientDenied.status).toBe(403);
    const collectionDenied = await handler(new Request(
      "http://127.0.0.1/v1/data/sync/page",
      {
        method: "POST",
        headers: {
          authorization: "Bearer destination-page-only",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...pageBody, collection_id: "other" }),
      },
    ));
    expect(collectionDenied.status).toBe(403);

    const validPage = await handler(new Request(
      "http://127.0.0.1/v1/data/sync/page",
      {
        method: "POST",
        headers: {
          authorization: "Bearer destination-page-only",
          "content-type": "application/json",
        },
        body: JSON.stringify(pageBody),
      },
    ));
    expect(validPage.status).toBe(200);

    const pulling = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(generateIdentity("did:example:attacker")),
        base_url: "http://127.0.0.1:7794",
        bearer: "destination-page-only",
      }],
      fetch: routedFetch(handler),
    });
    await expect(pulling.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "unexpected_sync_publisher" });
    expect(pulling.status("source", "research").cursor_present).toBe(false);
  });

  test("refuses a local/admin bearer reused by any outbound peer", async () => {
    const local = await node("outbound-token-collision", false);
    const identity = generateIdentity("did:example:outbound-token-collision");
    const remoteIdentity = generateIdentity("did:example:outbound-token-remote");
    const configured = service(local, identity, {
      node: local,
      identity,
      peers: [{
        peer_id: "remote",
        expected_node_id: "node_remote",
        expected_publisher: publisherFor(remoteIdentity),
        base_url: "http://127.0.0.1:7788",
        bearer: "remote-page-only",
      }],
    });

    expect(() => createDataSyncFetchHandler(configured, {
      node_bearer: "remote-page-only",
    })).toThrow("distinct from every configured outbound peer bearer");
    expect(() => serveDataSyncNode(configured, {
      hostname: "127.0.0.1",
      port: 0,
      node_bearer: "remote-page-only",
    })).toThrow("distinct from every configured outbound peer bearer");
  });

  test("validates peers before opening owned checkpoint state", async () => {
    const local = await node("constructor-validation", false);
    const stateRoot = mkdtempSync(join(tmpdir(), "agent-data-sync-constructor-state-"));
    roots.push(stateRoot);
    const checkpointPath = join(stateRoot, "must-not-open.sqlite");
    const identity = generateIdentity("did:example:constructor-validation");

    expect(() => new DataSyncService({
      node: local,
      identity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "remote",
        expected_node_id: "node_remote",
        expected_publisher: publisherFor(generateIdentity("did:example:constructor-remote")),
        base_url: "http://not-loopback.example",
        bearer: "remote-page-only",
      }],
    })).toThrow("requires HTTPS");
    expect(existsSync(checkpointPath)).toBe(false);
  });

  test("binds durable checkpoints to node, publisher, and feed incarnation before resume", async () => {
    const sourceNodeId = "node_feed_source";
    const sourceA = await node("feed-source-a", true, sourceNodeId);
    const destination = await node("feed-destination", false);
    const stateRoot = mkdtempSync(join(tmpdir(), "agent-data-sync-feed-state-"));
    roots.push(stateRoot);
    const checkpointPath = join(stateRoot, "sync.sqlite");
    const sourceIdentity = generateIdentity("did:example:feed-source");
    const destinationIdentity = generateIdentity("did:example:feed-destination");
    await collect(sourceA, "first feed incarnation", "feed-a");
    const sourceAService = service(sourceA, sourceIdentity);
    const sourceAHandler = createDataSyncFetchHandler(sourceAService, {
      page_authorities: [pageAuthority(destinationIdentity, "feed-page-token")],
    });
    let destinationService = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: sourceNodeId,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7795",
        bearer: "feed-page-token",
      }],
      fetch: routedFetch(sourceAHandler),
    });
    expect((await destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).records_inserted).toBe(1);
    destinationService.close();
    openServices.splice(openServices.indexOf(destinationService), 1);

    let fetches = 0;
    const movedOrigin = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: sourceNodeId,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7796",
        bearer: "feed-page-token",
      }],
      fetch: (async () => {
        fetches += 1;
        throw new Error("origin mismatch must stop before fetch");
      }) as typeof fetch,
    });
    await expect(movedOrigin.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "sync_checkpoint_peer_mismatch" });
    expect(() => movedOrigin.status("source", "research")).toThrow(
      "Stored checkpoint belongs to another configured peer identity or origin",
    );
    expect(fetches).toBe(0);
    movedOrigin.close();
    openServices.splice(openServices.indexOf(movedOrigin), 1);

    const repointed = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: "node_other",
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7796",
        bearer: "feed-page-token",
      }],
      fetch: (async () => {
        fetches += 1;
        throw new Error("checkpoint mismatch must stop before fetch");
      }) as typeof fetch,
    });
    await expect(repointed.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "sync_checkpoint_peer_mismatch" });
    expect(() => repointed.status("source", "research")).toThrow(
      "Stored checkpoint belongs to another configured peer identity",
    );
    expect(fetches).toBe(0);
    repointed.close();
    openServices.splice(openServices.indexOf(repointed), 1);

    const wrongPublisher = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: sourceNodeId,
        expected_publisher: publisherFor(generateIdentity("did:example:replacement-publisher")),
        base_url: "http://127.0.0.1:7796",
        bearer: "feed-page-token",
      }],
      fetch: (async () => {
        fetches += 1;
        throw new Error("publisher mismatch must stop before fetch");
      }) as typeof fetch,
    });
    await expect(wrongPublisher.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "sync_checkpoint_peer_mismatch" });
    expect(fetches).toBe(0);
    wrongPublisher.close();
    openServices.splice(openServices.indexOf(wrongPublisher), 1);

    const sourceB = await node("feed-source-b", true, sourceNodeId);
    expect(sourceB.feed_id).not.toBe(sourceA.feed_id);
    const secondId = await collect(sourceB, "replacement feed must not be skipped", "feed-b");
    const sourceBService = service(sourceB, sourceIdentity);
    const sourceBHandler = createDataSyncFetchHandler(sourceBService, {
      page_authorities: [pageAuthority(destinationIdentity, "feed-page-token")],
    });
    destinationService = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      checkpoint_path: checkpointPath,
      peers: [{
        peer_id: "source",
        expected_node_id: sourceNodeId,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7795",
        bearer: "feed-page-token",
      }],
      fetch: routedFetch(sourceBHandler),
    });
    await expect(destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "peer_response_error" });
    expect(destinationService.status("source", "research")).toMatchObject({
      cursor_present: true,
      records_inserted: 1,
    });
    expect(destination.getRecord(secondId)).toBeNull();
    expect(destinationService.resetCheckpoint("source", "research")).toBe(true);
    expect(destinationService.status("source", "research").cursor_present).toBe(false);
    expect((await destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    })).records_inserted).toBe(1);
    expect(destination.getRecord(secondId)?.id).toBe(secondId);
  });

  test("propagates tombstones and a reverse pull cycle settles without duplicate changes", async () => {
    const left = await node("left");
    const right = await node("right", false);
    const leftIdentity = generateIdentity("did:example:left");
    const rightIdentity = generateIdentity("did:example:right");
    let leftHandler: (request: Request) => Promise<Response>;
    let rightHandler: (request: Request) => Promise<Response>;
    const meshFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return new URL(request.url).port === "7790" ? leftHandler(request) : rightHandler(request);
    }) as typeof fetch;
    const leftService = service(left, leftIdentity, {
      node: left,
      identity: leftIdentity,
      peers: [{
        peer_id: "right",
        expected_node_id: right.node_id,
        expected_publisher: publisherFor(rightIdentity),
        base_url: "http://127.0.0.1:7791",
        bearer: "right-token",
      }],
      fetch: meshFetch,
    });
    const rightService = service(right, rightIdentity, {
      node: right,
      identity: rightIdentity,
      peers: [{
        peer_id: "left",
        expected_node_id: left.node_id,
        expected_publisher: publisherFor(leftIdentity),
        base_url: "http://127.0.0.1:7790",
        bearer: "left-token",
      }],
      fetch: meshFetch,
    });
    leftHandler = createDataSyncFetchHandler(leftService, {
      page_authorities: [pageAuthority(rightIdentity, "left-token")],
    });
    rightHandler = createDataSyncFetchHandler(rightService, {
      page_authorities: [pageAuthority(leftIdentity, "right-token")],
    });
    const recordId = await collect(left, "cycle settles safely", "cycle");

    expect((await rightService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "left",
      collection_id: "research",
    })).records_inserted).toBe(1);
    expect((await leftService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "right",
      collection_id: "research",
    })).records_existing).toBe(1);
    expect(left.changes({ collection_id: "research" }).changes).toHaveLength(1);
    expect(right.changes({ collection_id: "research" }).changes).toHaveLength(1);

    await left.tombstone(recordId, "superseded locally");
    expect((await rightService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "left",
      collection_id: "research",
    })).tombstones_applied).toBe(1);
    expect(right.getRecord(recordId)).toBeNull();
    expect(right.getTombstone(recordId)?.reason).toBe("superseded locally");
  });

  test("refuses unconfigured peers before fetch and never exposes checkpoint cursors over HTTP", async () => {
    const source = await node("status-source");
    const destination = await node("status-destination", false);
    let fetches = 0;
    const destinationIdentity = generateIdentity("did:example:status-destination");
    const destinationService = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      fetch: (async () => {
        fetches += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    await expect(destinationService.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "unknown",
      collection_id: "research",
    })).rejects.toMatchObject({ code: "peer_not_configured" });
    expect(fetches).toBe(0);

    const sourceIdentity = generateIdentity("did:example:status-source");
    const sourceService = service(source, sourceIdentity);
    const pageHandler = createDataSyncFetchHandler(sourceService, {
      page_authorities: [pageAuthority(destinationIdentity, "source-token")],
    });
    const configured = service(destination, destinationIdentity, {
      node: destination,
      identity: destinationIdentity,
      peers: [{
        peer_id: "source",
        expected_node_id: source.node_id,
        expected_publisher: publisherFor(sourceIdentity),
        base_url: "http://127.0.0.1:7792",
        bearer: "source-token",
      }],
      fetch: routedFetch(pageHandler),
    });
    await configured.pull({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      peer_id: "source",
      collection_id: "research",
    });
    const localHandler = createDataSyncFetchHandler(configured, { node_bearer: "local-token" });
    const statusResponse = await localHandler(new Request(
      "http://127.0.0.1/v1/data/sync/status?peer_id=source&collection_id=research",
      { headers: { authorization: "Bearer local-token" } },
    ));
    const statusText = await statusResponse.text();
    expect(statusResponse.status).toBe(200);
    expect(statusText).toContain('"cursor_present":true');
    expect(statusText).not.toContain('"cursor":');
    expect(statusText).not.toContain("source-token");
    expect(statusText).not.toContain("local-token");

    const manifest = await (await localHandler(new Request("http://127.0.0.1/v1/data/manifest"))).json();
    expect(manifest.capabilities.peer_sync).toBe(true);
    expect(manifest.sync).toMatchObject({
      protocol: AGENT_DATA_SYNC_PROTOCOL,
      mode: "explicit_pull",
      peer_discovery: false,
    });
    expect(JSON.stringify(manifest)).not.toContain("PrivateKey");
  });
});
