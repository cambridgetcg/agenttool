import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabRelayClient } from "../src/relay-client.js";
import { CollabStore } from "../src/store.js";
import {
  ACTION_ID,
  claimInput,
  observationInput,
} from "./relay-fixtures.js";

const remoteTools = [
  "collab_operation_begin",
  "collab_operation_claim",
  "collab_operation_complete",
  "collab_operation_events",
  "collab_operation_recover",
  "collab_operation_release",
  "collab_operation_renew",
  "collab_operation_status",
  "collab_provider_list",
  "collab_provider_observe",
].sort();

const temporaryDirectories: string[] = [];
const stores: CollabStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()!.close();
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function store(): CollabStore {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-relay-mcp-"));
  temporaryDirectories.push(directory);
  const value = new CollabStore(join(directory, "collab.sqlite"));
  stores.push(value);
  return value;
}

async function callTool(
  server: any,
  name: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("conditional release-room MCP tools", () => {
  test("keeps the default SQLite surface at exactly 31 local tools", () => {
    const server = buildCollabMcpServer(store());
    const names = Object.keys((server as any)._registeredTools);
    expect(names).toHaveLength(31);
    for (const name of remoteTools) expect(names).not.toContain(name);
  });

  test("registers exactly ten open-world relay tools only when configured", () => {
    const relay = mockRelay();
    const server = buildCollabMcpServer(store(), { relay: relay.client });
    const tools = (server as any)._registeredTools;
    const names = Object.keys(tools);
    expect(names).toHaveLength(41);
    expect(names.filter((name) => remoteTools.includes(name)).sort()).toEqual(
      remoteTools,
    );

    for (const name of [
      "collab_operation_events",
      "collab_operation_status",
      "collab_provider_list",
    ]) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
    for (const name of remoteTools.filter(
      (name) =>
        ![
          "collab_operation_events",
          "collab_operation_status",
          "collab_provider_list",
        ].includes(name),
    )) {
      expect(tools[name].annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
    expect(tools.collab_operation_claim.description).toContain(
      "does not authorize GitHub, npm, Vercel, Fly, Cloudflare",
    );
    expect(tools.collab_provider_observe.description).toContain(
      "device_observed",
    );
  });

  test("derives one stable relay session UUID and keeps actor labels self-declared", async () => {
    const relay = mockRelay();
    const server = buildCollabMcpServer(store(), { relay: relay.client });
    const claim = await callTool(server, "collab_operation_claim", {
      idempotency_key: claimInput.idempotency_key,
      action_id: ACTION_ID,
      actor_label: "mcp-release-agent",
      operation: claimInput.operation,
      environment: claimInput.environment,
      target: claimInput.target,
      source_revision: claimInput.source_revision,
      parameters_sha256: claimInput.parameters_sha256,
      lease_seconds: claimInput.lease_seconds,
    });
    expect(claim.isError).not.toBe(true);
    const observe = await callTool(server, "collab_provider_observe", {
      idempotency_key: observationInput.idempotency_key,
      actor_label: "mcp-release-agent",
      action_id: ACTION_ID,
      provider: observationInput.provider,
      provider_event_id: observationInput.provider_event_id,
      observed_at: observationInput.observed_at,
      occurred_at: observationInput.occurred_at,
      normalized_state: observationInput.normalized_state,
      source_revision: observationInput.source_revision,
      environment: observationInput.environment,
      resource_kind: observationInput.resource_kind,
      resource_id: observationInput.resource_id,
      native_state: observationInput.native_state,
      url: observationInput.url,
      payload_sha256: observationInput.payload_sha256,
    });
    expect(observe.isError).not.toBe(true);

    expect(relay.calls.claim).toHaveLength(1);
    expect(relay.calls.observe).toHaveLength(1);
    const sessionId = relay.calls.claim[0]!.session_id;
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(relay.calls.observe[0]!.session_id).toBe(sessionId);
    expect(relay.calls.claim[0]!.actor_label).toBe("mcp-release-agent");
    expect(relay.calls.observe[0]!.actor_label).toBe("mcp-release-agent");
  });
});

function mockRelay(): {
  client: CollabRelayClient;
  calls: {
    claim: Array<Record<string, any>>;
    observe: Array<Record<string, any>>;
  };
} {
  const calls = {
    claim: [] as Array<Record<string, any>>,
    observe: [] as Array<Record<string, any>>,
  };
  const client = {
    context: () => ({}),
    events: async () => ({ ok: true }),
    operations: async () => ({ ok: true }),
    claim: async (input: Record<string, any>) => {
      calls.claim.push(input);
      return { accepted: true };
    },
    renew: async () => ({ accepted: true }),
    begin: async () => ({ accepted: true }),
    complete: async () => ({ accepted: true }),
    release: async () => ({ accepted: true }),
    recover: async () => ({ accepted: true }),
    observe: async (input: Record<string, any>) => {
      calls.observe.push(input);
      return { accepted: true };
    },
    observations: async () => ({ ok: true }),
  } as unknown as CollabRelayClient;
  return { client, calls };
}
