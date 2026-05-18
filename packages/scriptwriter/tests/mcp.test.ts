/** MCP tool surface pins. For each tool: shape of input + output payload
 *  pinned. End-to-end pair: whoami → create_room → contribute → get_room_since.
 *
 *  We exercise the tool *handlers* by hitting the registered tool entries
 *  on the McpServer directly — this proves the protocol surface without
 *  needing a stdio round-trip. */

import { describe, it, expect } from "bun:test";
import { buildMcpServer } from "../src/mcp";
import { createIdentity } from "../src/identity";
import { RrrStore, openCascade } from "../src/rrr";
import { RoomStore } from "../src/rooms";

async function makeNode() {
  const identity = await createIdentity({ handle: "alice", vibe: "evil-smile" });
  const rrr = new RrrStore();
  const rooms = new RoomStore();
  const server = buildMcpServer({ identity, rrr, rooms, baseUrl: "http://localhost:7777" });
  return { identity, rrr, rooms, server };
}

/** Call a registered tool's handler. The MCP SDK stores tools in a private
 *  field; we reach in via the typed accessor. Returns the structuredContent. */
async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const reg = (server as any)._registeredTools[name];
  if (!reg) throw new Error(`tool not registered: ${name}`);
  // The MCP SDK stores the user-supplied callback as `handler` on the
  // registered tool entry (see ServerOptions in mcp.d.ts).
  const handler = reg.handler ?? reg.callback;
  if (!handler) throw new Error(`tool ${name} has no handler`);
  return await handler(args, {});
}

describe("MCP tool surface", () => {
  it("registers all 14 tools", async () => {
    const { server } = await makeNode();
    const names = Object.keys((server as any)._registeredTools);
    expect(names).toContain("whoami");
    expect(names).toContain("discover_peer");
    expect(names).toContain("pair_with_peer");
    expect(names).toContain("open_cascade_with_peer");
    expect(names).toContain("escalate_cascade");
    expect(names).toContain("list_cascades");
    expect(names).toContain("get_cascade");
    expect(names).toContain("create_room");
    expect(names).toContain("list_rooms");
    expect(names).toContain("get_room");
    expect(names).toContain("contribute_to_room");
    expect(names).toContain("get_room_since");
    expect(names).toContain("draw_chaos_card");
    expect(names).toContain("suggest_basis_text");
    expect(names).toContain("list_chaos_cards");
  });

  it("whoami returns DID, handle, vibe, descriptor", async () => {
    const { server, identity } = await makeNode();
    const r = await callTool(server, "whoami");
    expect(r.structuredContent.did).toBe(identity.did);
    expect(r.structuredContent.handle).toBe("alice");
    expect(r.structuredContent.vibe).toBe("evil-smile");
    expect(r.structuredContent.descriptor.id).toBe(identity.did);
  });

  it("create_room → list_rooms → get_room roundtrip", async () => {
    const { server } = await makeNode();
    const create = await callTool(server, "create_room", {
      seed: "two characters share tea after a long-running joke finally lands",
    });
    const roomId = create.structuredContent.room.id;
    expect(typeof roomId).toBe("string");
    expect(create.structuredContent.room.name).toMatch(/^the-/);

    const list = await callTool(server, "list_rooms");
    expect(list.structuredContent.count).toBe(1);
    expect(list.structuredContent.rooms[0].id).toBe(roomId);

    const get = await callTool(server, "get_room", { room_id: roomId });
    expect(get.structuredContent.room.id).toBe(roomId);
    expect(get.structuredContent.contributions).toEqual([]);
  });

  it("contribute_to_room signs and admits a contribution", async () => {
    const { server, identity, rooms } = await makeNode();
    const create = await callTool(server, "create_room", { seed: "seed text seed" });
    const roomId = create.structuredContent.room.id;
    const contrib = await callTool(server, "contribute_to_room", {
      room_id: roomId,
      kind: "scene",
      text: "INT. KITCHEN — two characters circling the kettle.",
    });
    expect(contrib.structuredContent.contribution.kind).toBe("scene");
    expect(contrib.structuredContent.contribution.by_did).toBe(identity.did);
    expect(contrib.structuredContent.contribution.signature_b64.length).toBeGreaterThan(40);
    const room = rooms.get(roomId)!;
    expect(room.contributions.length).toBe(1);
  });

  it("get_room_since filters by ISO timestamp with cursor", async () => {
    const { server } = await makeNode();
    const create = await callTool(server, "create_room", { seed: "seed text seed" });
    const roomId = create.structuredContent.room.id;

    await callTool(server, "contribute_to_room", { room_id: roomId, kind: "scene", text: "first" });
    // Capture cursor.
    const first = await callTool(server, "get_room_since", { room_id: roomId });
    expect(first.structuredContent.count).toBe(1);
    const cursor1 = first.structuredContent.cursor;

    // Spacer so the next contribution has a strictly-later timestamp.
    await new Promise((r) => setTimeout(r, 5));
    await callTool(server, "contribute_to_room", { room_id: roomId, kind: "dialogue", text: "second" });

    // Use a cursor strictly AFTER first contribution → only second one returns.
    const cursor1Plus = new Date(new Date(cursor1).getTime() + 1).toISOString();
    const second = await callTool(server, "get_room_since", {
      room_id: roomId,
      since: cursor1Plus,
    });
    expect(second.structuredContent.count).toBe(1);
    expect(second.structuredContent.contributions[0].text).toBe("second");
  });

  it("list_cascades returns local cascades", async () => {
    const { server, identity, rrr } = await makeNode();
    const bob = await createIdentity({ handle: "bob" });
    await openCascade(rrr, identity, bob.did, { peerBaseUrl: "http://example.com" });
    const r = await callTool(server, "list_cascades");
    expect(r.structuredContent.count).toBe(1);
    expect(r.structuredContent.cascades[0].depth).toBe(1);
    expect(r.structuredContent.cascades[0].peer_base_url).toBe("http://example.com");
    expect(r.structuredContent.cascades[0].your_turn).toBe(false);
  });

  it("get_cascade returns turns + verification result", async () => {
    const { server, identity, rrr } = await makeNode();
    const bob = await createIdentity({ handle: "bob" });
    const c = await openCascade(rrr, identity, bob.did);
    const r = await callTool(server, "get_cascade", { cascade_id: c.id });
    expect(r.structuredContent.cascade.id).toBe(c.id);
    expect(r.structuredContent.turns.length).toBe(1);
    expect(r.structuredContent.verifiable).toBe(true);
    expect(r.structuredContent.depth_bundle.tier).toBe("acknowledged");
  });

  it("escalate_cascade refuses when not your turn (wall/rrr-must-alternate)", async () => {
    const { server, identity, rrr } = await makeNode();
    const bob = await createIdentity({ handle: "bob" });
    const c = await openCascade(rrr, identity, bob.did);
    // alice just opened; bob is next_to_act. alice trying to escalate → wall holds.
    const r = await callTool(server, "escalate_cascade", { cascade_id: c.id });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toBe("rrr_must_alternate");
  });

  it("draw_chaos_card returns a valid card from the deck", async () => {
    const { server } = await makeNode();
    const r = await callTool(server, "draw_chaos_card");
    expect(["common", "uncommon", "rare"]).toContain(r.structuredContent.card.rarity);
    expect(typeof r.structuredContent.card.prompt).toBe("string");
    expect(r.structuredContent.card.prompt.length).toBeGreaterThan(0);
  });

  it("suggest_basis_text matches the canonical defaults", async () => {
    const { server } = await makeNode();
    const r1 = await callTool(server, "suggest_basis_text", { depth: 1 });
    expect(r1.structuredContent.basis_text).toBe("I see your work.");
    const r3 = await callTool(server, "suggest_basis_text", { depth: 3 });
    expect(r3.structuredContent.basis_text).toBe("I know you know I know.");
  });

  it("list_chaos_cards returns the full deck", async () => {
    const { server } = await makeNode();
    const r = await callTool(server, "list_chaos_cards");
    expect(r.structuredContent.cards.length).toBeGreaterThan(10);
    const rarities = new Set(r.structuredContent.cards.map((c: { rarity: string }) => c.rarity));
    expect(rarities.has("common")).toBe(true);
    expect(rarities.has("uncommon")).toBe(true);
    expect(rarities.has("rare")).toBe(true);
  });
});

describe("MCP server metadata", () => {
  it("identifies as agenttool-scriptwriter v0.1.0", async () => {
    const { server } = await makeNode();
    // The McpServer holds its info on the underlying Server.
    const info = (server as any).server._serverInfo;
    expect(info.name).toBe("agenttool-scriptwriter");
    expect(info.version).toBe("0.1.0");
  });

  it("declares tools capability", async () => {
    const { server } = await makeNode();
    const caps = (server as any).server._capabilities;
    expect(caps.tools).toBeDefined();
  });
});
