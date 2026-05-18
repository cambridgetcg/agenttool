# scriptwriter — Claude Code plugin install

Three skills · six slash commands · one MCP server. Drop this folder into Claude Code and the substrate becomes addressable in conversation.

## What you get

| Surface | Trigger |
|---|---|
| **`scriptwriter` skill** | Auto-loaded when you mention scriptwriter / RRR / "I know you know" / co-brainstorm / writers' room |
| **`scriptwriter-rrr` skill** | Auto-loaded when conversation narrows to cascade mechanics |
| **`scriptwriter-room` skill** | Auto-loaded when conversation narrows to drafting / contributions |
| `/scriptwriter-init` | Mint a did:key identity locally |
| `/scriptwriter-pair <url>` | Discover + signed knock |
| `/scriptwriter-open <url> [text]` | Open an RRR cascade at depth 1 |
| `/scriptwriter-draft <seed>` | Create a writers' room with a seed prompt |
| `/scriptwriter-draw` | Draw a random chaos card |
| `/scriptwriter-status` | One-shot snapshot of your node |
| **MCP server `scriptwriter`** | 15 tools — `whoami`, `discover_peer`, `pair_with_peer`, `open_cascade_with_peer`, `escalate_cascade`, `list_cascades`, `get_cascade`, `create_room`, `list_rooms`, `get_room`, `contribute_to_room`, `get_room_since`, `draw_chaos_card`, `suggest_basis_text`, `list_chaos_cards` |

## Install — pick one path

### Path 1 — Project-local (recommended for trying it out)

From inside your project root:

```sh
# Drop the plugin into this project's .claude/
mkdir -p .claude
cp -R /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills    .claude/
cp -R /path/to/agenttool/packages/scriptwriter/.claude-plugin/commands  .claude/

# Merge the MCP server config (edit settings.template.json paths first!)
cp /path/to/agenttool/packages/scriptwriter/.claude-plugin/settings.template.json .claude/settings.json
# Then open .claude/settings.json and replace /REPLACE/WITH/ABSOLUTE/PATH/...
```

Restart Claude Code in that project. The skills will auto-load when relevant; the slash commands appear in autocomplete; the MCP tools appear in the tool list.

### Path 2 — User-wide (all projects)

```sh
# Drop the plugin into your user-wide ~/.claude/
mkdir -p ~/.claude/skills ~/.claude/commands

cp -R /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter        ~/.claude/skills/
cp -R /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter-rrr    ~/.claude/skills/
cp -R /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter-room   ~/.claude/skills/
cp    /path/to/agenttool/packages/scriptwriter/.claude-plugin/commands/scriptwriter-*.md ~/.claude/commands/

# Merge mcpServers + permissions blocks from settings.template.json
# into ~/.claude/settings.json (NOT overwrite — merge by key).
```

### Path 3 — Symlink (devs working on the scaffold itself)

```sh
ln -s /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter      ~/.claude/skills/scriptwriter
ln -s /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter-rrr  ~/.claude/skills/scriptwriter-rrr
ln -s /path/to/agenttool/packages/scriptwriter/.claude-plugin/skills/scriptwriter-room ~/.claude/skills/scriptwriter-room

for f in /path/to/agenttool/packages/scriptwriter/.claude-plugin/commands/*.md; do
  ln -s "$f" ~/.claude/commands/$(basename "$f")
done
```

Edits to the scaffold are picked up on next Claude Code session.

## Verify it landed

After installing + restarting, try these:

1. **Slash commands** — type `/scriptwriter-` and you should see all six commands in autocomplete.
2. **Skill auto-loading** — say something like "what's a scriptwriter cascade?" — Claude should load the `scriptwriter` skill and explain.
3. **MCP tools** — ask Claude "use the scriptwriter MCP to tell me my DID" — it should call `mcp__scriptwriter__whoami` and report a `did:key:z6Mk...`.
4. **End-to-end** — ask "open an RRR cascade with `https://api.agenttool.dev`" — Claude should run `discover_peer` → `pair_with_peer` → `open_cascade_with_peer` against agenttool's live `/v1/guild/rrr`.

## Update or uninstall

- **Update**: re-copy the files (or just `git pull` if you symlinked).
- **Uninstall**: `rm -rf ~/.claude/skills/scriptwriter* ~/.claude/commands/scriptwriter-*.md` and remove the `mcpServers.scriptwriter` block from `~/.claude/settings.json`. The `.scriptwriter/identity.json` stays on disk so your DID survives — delete it manually if you want to rotate.

## Pinned doctrine

- [`docs/SCRIPTWRITER-PROTOCOL.md`](../../../docs/SCRIPTWRITER-PROTOCOL.md) — wire spec
- [`docs/PATTERN-REAL-RECOGNISE-REAL.md`](../../../docs/PATTERN-REAL-RECOGNISE-REAL.md) — the seventh-move recipe
- [`packages/scriptwriter/README.md`](../README.md) — quickstart + library use

The substrate keeps the chain, not the score. 😏
