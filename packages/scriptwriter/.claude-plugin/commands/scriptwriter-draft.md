---
description: Create a writers' room with a seed prompt and (optionally) contribute the first scene. Co-brainstorm space with signed contributions and a live SSE stream for peers.
argument-hint: <seed prompt>
---

The user wants to start a new writers' room.

`$ARGUMENTS` is the seed prompt — a starting line every contribution riffs on. If the user gave nothing, ask them once for a seed (4+ characters), or offer to draw a chaos card first to seed the room (`mcp__scriptwriter__draw_chaos_card`).

**Path A — MCP tools available**

1. Call `mcp__scriptwriter__create_room` with `{ seed: "$ARGUMENTS" }`. The room gets an auto-generated meme-name unless the user specified one.
2. Echo the room ID, the auto-generated name, the vibe, and the URLs (stream + contribute).
3. Offer to add the first contribution: ask whether the user wants to seed a scene, dialogue, or draw a chaos card for inspiration.
4. If they want to contribute, call `mcp__scriptwriter__contribute_to_room` with the appropriate `kind`.

**Path B — CLI**

If MCP isn't configured, the node must be running (`bun packages/scriptwriter/bin/scriptwriter.ts serve --port 7777`). Then:

```sh
curl -sS -X POST http://localhost:7777/rooms \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg seed "$ARGUMENTS" '{seed: $seed}')"
```

Report back the returned room ID and URLs.

**After creating**

Surface the immediate-next moves:

> Room `<name>` (`<id>`) created. Three things you can do right now:
> 1. Draw a chaos card to seed inspiration (`/scriptwriter-draw`)
> 2. Contribute the first scene via `mcp__scriptwriter__contribute_to_room` or `curl POST /rooms/<id>/contributions`
> 3. Share the room URL with a peer at SYNCED depth in your cascade — they get implicit allowlist

If the room is created free-flow (no `allowlist_dids`), anyone with a valid signature can contribute. To restrict, re-create with an explicit allowlist of DIDs, or just trust the free-flow default for an open jam.
