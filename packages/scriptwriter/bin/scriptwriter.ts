#!/usr/bin/env bun
/** scriptwriter CLI — decentralised scriptwriter node.
 *
 *   scriptwriter init [--handle X] [--vibe Y]   Mint a did:key, write .scriptwriter/.
 *   scriptwriter serve [--port N] [--base URL]  Run the HTTP server.
 *   scriptwriter pair <peer-base-url>           Discover + knock at a peer's door.
 *   scriptwriter open <peer-base-url> [text]    Open an RRR cascade with a peer.
 *   scriptwriter escalate <cascade-id> [text]   Bump depth on a local cascade.
 *   scriptwriter cascades                       List your cascades.
 *   scriptwriter rooms                          List local rooms.
 *   scriptwriter draft <seed>                   Create a local writers' room.
 *   scriptwriter draw                           Draw a chaos card.
 *   scriptwriter whoami                         Print your DID + handle.
 *   scriptwriter --help                         Show this help. */

import {
  createIdentity,
  loadIdentity,
  requireIdentity,
  saveIdentity,
  defaultIdentityPath,
} from "../src/identity";
import { buildServer } from "../src/server";
import { RrrStore, escalate as rrrEscalate, openCascade } from "../src/rrr";
import { RoomStore } from "../src/rooms";
import { drawCard, generateRoomName } from "../src/vibes";
import { knock, openCascadeWithPeer, pushRrrTurn, discoverPeer } from "../src/peers";

const argv = Bun.argv.slice(2);
const cmd = argv[0];

function usage(): string {
  return `scriptwriter — decentralised scriptwriter node (v0.1.0)

  scriptwriter init [--handle X] [--vibe Y]   Mint a did:key, write .scriptwriter/.
  scriptwriter serve [--port N] [--base URL]  Run the HTTP server.
  scriptwriter pair <peer-base-url>           Discover + knock at a peer's door.
  scriptwriter open <peer-base-url> [text]    Open an RRR cascade with a peer.
  scriptwriter escalate <cascade-id> [text]   Bump depth on a local cascade.
  scriptwriter cascades                       List your cascades.
  scriptwriter rooms                          List local rooms.
  scriptwriter draft <seed>                   Create a local writers' room.
  scriptwriter draw                           Draw a chaos card.
  scriptwriter whoami                         Print your DID + handle.

  scriptwriter --help                         Show this help.
`;
}

function flag(name: string, fallback?: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return argv[idx + 1];
}

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }

async function run() {
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(usage());
    return;
  }

  if (cmd === "init") {
    const path = defaultIdentityPath();
    const existing = loadIdentity(path);
    if (existing) {
      console.log(yellow("·") + ` already initialised at ${path}`);
      console.log(`  did: ${existing.did}`);
      console.log(`  handle: ${existing.handle}`);
      console.log(`  vibe: ${existing.vibe}`);
      console.log("\n  delete .scriptwriter/ to start fresh, or just `scriptwriter serve` to run.");
      return;
    }
    const handle = flag("handle") ?? "anonymous-scriptwriter";
    const vibe = flag("vibe") ?? "tender-chaotic";
    const id = await createIdentity({ handle, vibe });
    saveIdentity(id, path);
    console.log(green("✓") + ` minted did:key + saved to ${path}`);
    console.log(`\n  ${bold("did")}    ${id.did}`);
    console.log(`  ${bold("handle")} ${id.handle}`);
    console.log(`  ${bold("vibe")}   ${id.vibe}`);
    console.log(`\n  next: ${bold("scriptwriter serve")}  — bring your node online`);
    console.log(`        ${bold("scriptwriter pair <peer-url>")}  — find another writer`);
    return;
  }

  if (cmd === "whoami") {
    const id = requireIdentity();
    console.log(`${bold("did")}    ${id.did}`);
    console.log(`${bold("handle")} ${id.handle}`);
    console.log(`${bold("vibe")}   ${id.vibe}`);
    console.log(`${bold("since")}  ${id.createdAt}`);
    return;
  }

  if (cmd === "serve") {
    const identity = requireIdentity();
    const port = Number(flag("port") ?? process.env.SCRIPTWRITER_PORT ?? 7777);
    const baseUrl = flag("base") ?? process.env.SCRIPTWRITER_BASE_URL ?? `http://localhost:${port}`;
    const rrr = new RrrStore();
    const rooms = new RoomStore();
    const app = buildServer({ identity, baseUrl, rrr, rooms });

    Bun.serve({ port, fetch: app.fetch });
    console.log(`
${bold(green("scriptwriter is live."))}

   handle:    ${identity.handle}
   vibe:      ${identity.vibe}
   did:       ${identity.did}
   listening: http://localhost:${port}
   public:    ${baseUrl}

   ${dim("/.well-known/scriptwriter")}    descriptor
   ${dim("POST /knock")}                 first contact
   ${dim("POST /rrr/turn")}              accept signed RRR turn
   ${dim("POST /rooms")}                  create a writers' room
   ${dim("GET  /rooms/:id/stream")}       SSE co-brainstorm

${dim("the substrate keeps the chain, not the score. the loop awaits. 😏")}
`);
    return;
  }

  if (cmd === "pair") {
    const peer = argv[1];
    if (!peer) {
      console.error("usage: scriptwriter pair <peer-base-url>");
      process.exit(2);
    }
    const self = requireIdentity();
    console.log(dim(`· discovering ${peer}/.well-known/scriptwriter …`));
    const desc = await discoverPeer(peer);
    console.log(`  ${green("✓")} found ${bold(desc.handle)} (${desc.id})`);
    console.log(`    vibe: ${desc.vibe} · protocol: ${desc.protocol.version}`);
    console.log(dim(`· knocking …`));
    const reply = await knock(self, peer);
    console.log(`  ${green("✓")} acknowledged: ${reply.acknowledged}`);
    if (reply.peer_greeting) console.log(`    ${dim("→")} ${reply.peer_greeting}`);
    console.log(`\n  next: ${bold(`scriptwriter open ${peer}`)} — start the cascade`);
    return;
  }

  if (cmd === "open") {
    const peer = argv[1];
    if (!peer) {
      console.error("usage: scriptwriter open <peer-base-url> [basis-text]");
      process.exit(2);
    }
    const basisText = argv.slice(2).join(" ") || undefined;
    const self = requireIdentity();
    console.log(dim(`· signing depth-1 turn + pushing to ${peer}/rrr/turn …`));
    const { peer: desc, cascade, turn } = await openCascadeWithPeer(self, peer, { basisText });
    console.log(`  ${green("✓")} cascade ${cascade.id.slice(0, 8)}… opened with ${desc.handle}`);
    console.log(`    depth: ${cascade.depth} · status: ${cascade.status}`);
    console.log(`    basis: "${turn.basisText}"`);
    console.log(`\n  ${dim("ball is in their court — wait for their depth-2 turn.")}`);
    return;
  }

  if (cmd === "escalate") {
    const cascadeId = argv[1];
    if (!cascadeId) {
      console.error("usage: scriptwriter escalate <cascade-id> [basis-text]");
      process.exit(2);
    }
    const basisText = argv.slice(2).join(" ") || undefined;
    const self = requireIdentity();
    // For the CLI escalate path, the local store is empty per-invocation —
    // this command is for the long-running `serve` node. Print guidance.
    console.log(yellow("·") + ` escalate is a server-side action — run it via:\n`);
    console.log(`  curl -X POST http://localhost:7777/rrr/turn -d '{ "cascade_id": "${cascadeId}", "depth": <N+1>, ... }'\n`);
    console.log(dim("  or use the in-process escalate() helper from a node that owns the cascade state."));
    void self; void basisText; void rrrEscalate; void openCascade; void pushRrrTurn;
    return;
  }

  if (cmd === "cascades") {
    console.log(yellow("·") + " cascades are server-side state — query the running node:");
    console.log(`  curl http://localhost:7777/rrr/cascades | jq`);
    return;
  }

  if (cmd === "rooms") {
    console.log(yellow("·") + " rooms are server-side state — query the running node:");
    console.log(`  curl http://localhost:7777/rooms | jq`);
    return;
  }

  if (cmd === "draft") {
    const seed = argv.slice(1).join(" ");
    if (!seed || seed.length < 4) {
      console.error("usage: scriptwriter draft <seed text>");
      process.exit(2);
    }
    console.log(yellow("·") + ` draft is server-side — create via the running node:`);
    console.log(`  curl -X POST http://localhost:7777/rooms -d '{ "seed": ${JSON.stringify(seed)}, "name": "${generateRoomName()}" }'`);
    return;
  }

  if (cmd === "draw") {
    const c = drawCard();
    const banner = `
  ${bold(c.emoji + "  " + c.rarity.toUpperCase())}
  ${dim("─".repeat(50))}
  ${c.prompt}
  ${dim("─".repeat(50))}
  id: ${c.id}
`;
    console.log(banner);
    return;
  }

  console.error(`unknown command: ${cmd}\n\n${usage()}`);
  process.exit(2);
}

run().catch((err) => {
  console.error("✖", String(err));
  process.exit(1);
});
