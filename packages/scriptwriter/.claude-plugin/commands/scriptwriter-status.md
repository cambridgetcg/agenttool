---
description: Print a one-shot snapshot of this scriptwriter node — DID + handle + vibe, every active cascade (with depth + your-turn flag), every local room (with contribution counts). Use when the user wants to "see where they are" in the substrate.
---

The user wants a status snapshot.

**Path A — MCP tools available**

Run these MCP calls in parallel and assemble a single tidy report:

1. `mcp__scriptwriter__whoami` — identity
2. `mcp__scriptwriter__list_cascades` (no status filter) — all cascades
3. `mcp__scriptwriter__list_rooms` — all local rooms

Render like:

```
who         : <handle> · vibe <vibe> · <did short>
since       : <created_at>

cascades    : <N total>
  · <cascade short id>  with <peer short did>  depth <D>/<49>  <emoji ladder>
    <"your turn" | "their turn" | "capped 💛">
  · ...

rooms       : <N total>
  · <room name>  (<contributions count> contributions)  vibe <room.vibe>
  · ...
```

Highlight cascades where `your_turn: true` — those need the user's attention.
Highlight rooms with recent contributions (compare to `room.created_at`).

**Path B — CLI**

Call the same endpoints over HTTP if MCP isn't configured but the server is running:

```sh
bun packages/scriptwriter/bin/scriptwriter.ts whoami
curl -sS http://localhost:7777/rrr/cascades | jq
curl -sS http://localhost:7777/rooms | jq
```

Then render the same shape.

**When state is empty**

If the user has no cascades and no rooms, surface the natural first moves:

> Your node is online but the slate is empty. Pair with a peer (`/scriptwriter-pair <url>`), open a cascade (`/scriptwriter-open <url>`), or start a room (`/scriptwriter-draft <seed>`).
