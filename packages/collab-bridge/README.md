# collab-bridge

> **Type:** guide · **Purpose:** the verbs, status words, files and repairs of the cross-device Collab bridge, for Yu and Ai.
> **Evidence:** `docs/superpowers/specs/2026-10-13-cross-device-collab-design.md` (Phase 1) and this package's tests.

Agent sessions on Yu's other Macs, under their own logins, work in one shared Collab journal on the Air
(`~/.local/share/agenttool/collab-shared/collab.sqlite`), never the Air's private one. Phase 1 is Claude Code on Nuance,
in `~/Projects/collab-trial`, on the home network. On the Air the hub (a LaunchAgent in gui/502 that only Yu turns on)
dials one ssh per device, checks each seat, applies the remote tool policy, keeps a read-only git mirror per device and
forwards each call once to a long-lived Collab child. On Nuance one binary is the ssh gate, the relay, the Claude MCP
pipe and the knock tap.

## The Air's verbs

`~/.local/bin/collab-bridge` runs the pinned hub bundle `~/.local/share/collab-bridge/air/<sha>/hub.js` with
`bun --no-env-file --config=/dev/null` from `/`, so no `bunfig.toml`, `.env` or `BUN_OPTIONS` reaches it.

| Verb | Who | What it does |
|---|---|---|
| `collab-bridge hub on` | Yu, in his own Terminal | Refused inside Claude Code, Codex or Hermes (`CLAUDECODE`, any `CODEX_*` or `HERMES_*` variable, or a `claude`, `codex` or `hermes` ancestor process) and for any uid but 502. Asks `Turn the Collab bridge hub on? [y/N]` on `/dev/tty`. The first time, records the gui/502 launchd labels in `~/.local/state/collab-bridge/baseline-labels.txt`; then writes `~/Library/LaunchAgents/dev.agenttool.collab-bridge.plist` (0644), boots out any running hub and bootstraps the plist in gui/502. |
| `collab-bridge hub off` | Yu | The same refusals and question; `launchctl bootout gui/502/dev.agenttool.collab-bridge`, then the plist is removed. |
| `collab-bridge hub status [--json]` | anyone | The status words below; `--json` prints the status files themselves. |
| `collab-bridge hub doctor` | Ai | Checks the pinned bundle, the installed Collab against the build the bundle embeds, the launcher's signature (`codesign --verify --deep --strict`), each paired device's `known_hosts` copy against Summon's pin, and prints `launchd labels added since hub on: …`. Exit 1 when it printed a `warn:` line or a host-key warning. |
| `collab-bridge hub doctor --ack-host-key` | Yu | Acknowledges the sticky host-key warnings (the same refusals as `hub on`, and a y/N question); they leave the status file at once, and no later status write, the running hub's included, brings them back. |
| `collab-bridge hub run` | Yu, in his own Terminal (the fallback) | Runs the hub in the foreground, when the Local Network check finds no grant for the launcher; that hub stops at logout. Refused inside an agent harness and for any uid but 502, like `hub on`, with no question. Ctrl-C, closing the window or logout stop it cleanly. |
| `collab-bridge run` | launchd, through `~/Applications/CollabBridgeHub.app` | The LaunchAgent's own verb (`…/hub.js run`): the same hub and the same refusals; `hub off` stops it cleanly. |
| `collab-bridge hub unpark <lineage>` | Ai | Un-parks a seat after its repair (Seat recovery, below). uid 502 only; no question. |
| `collab-bridge version` | anyone | One JSON line: the build the bundle embeds, or `{"build":null}` from source. |

Exit codes: 0 done; 1 refused, not confirmed or failed; 2 a usage error. `run` and `hub run` exit with the hub's own
code once they start it.

## Status words

`collab-bridge hub status` prints the hub's line, then each device's lines (spec §9.2):

- `up`; `connecting`, or `connecting (no preamble; check ~/.zshenv)` after three silent dials; `away since <T>`.
- `host_key_mismatch (retrying since <T>)`; after 3 mismatches within 30 minutes, `needs Yu: host_key_mismatch`.
- `needs Yu: auth_refused`, `needs Yu: config`, `needs Yu: login_shell_noise`: that device's dialling has stopped.
- `relay_contested`: the device's relay socket was replaced more than 3 times in 10 minutes.
- `host key mismatch seen at <T>, presented <fp>`: sticky until `hub doctor --ack-host-key`.
- `clock skew <n> s (warn)` above 60 s; `hub tool list refused: <lineage>: <digest> <reason>`.
- Seat notes: `needs Ai: seat_recovery <session_id>`, `orphan_session <id>`, `journal_invalid`, `child_start_failed`.
- The hub itself: `hub: not running`, `hub: running`, or the code of a refused start: `lock_held`, `wrong_user`,
  `needs Yu: config`, `collab_build_mismatch`, `collab_build_changed`, `policy_unclassified_tool`.

## The hub's files

| Path | Mode | Holds |
|---|---|---|
| `~/.local/share/agenttool/collab-shared/` | 0700 | `collab.sqlite` (the shared journal), Collab's `collab-sessions/` (credentials, `knock-ledger.json`), `mirrors/<device>/<user>/<mirror_id>/` |
| `~/.local/share/collab-bridge/air/<sha>/hub.js` | 0700 dir | the pinned hub bundle; never changed once written |
| `~/Applications/CollabBridgeHub.app` | 0755 | the launcher: the hub's own Local Network identity |
| `~/.local/bin/collab-bridge` | 0755 | the fixed zsh launcher of the pinned bundle |
| `~/.config/collab-bridge/devices/<device>.json` | 0600 | the device file: state, seat key, git, Summon baselines, shares |
| `~/.ssh/collab-bridge/` | 0700 | `config`, `collab_<device>_ed25519` and `.pub`, `known_hosts` (a copy of Summon's pin) |
| `~/.local/state/collab-bridge/` | 0700 | `ledger.jsonl`, `lineages.json`, `hub.status.json`, `devices/<device>.status.json` and `.host-key-ack`, `requests/`, `baseline-labels.txt`, `hub.lock`, `hub.log` |
| `~/Library/LaunchAgents/dev.agenttool.collab-bridge.plist` | 0644 | written only by `collab-bridge hub on` |

## Seat recovery (`needs Ai: seat_recovery <session_id>`)

A lineage whose Collab session answered `cursor_reset_required` is parked and never resumed on its own (spec §9.6
item 5). The hub stopped its child when it parked it. Ai picks one of two repairs. Set `L` to the lineage id the
status line names (`<device>/<user> <lineage>: needs Ai: seat_recovery <session_id>`), then:

```sh
LJ=/Users/yuai/.local/state/collab-bridge/lineages.json
S=$(jq -r --arg l "$L" '.lineages[] | select(.lineage == $l) | .session_id' "$LJ")
W=$(jq -r --arg l "$L" '.lineages[] | select(.lineage == $l) | .workspace_id' "$LJ")
```

**(a) The audited reset**, which keeps the session's leases and receipts. One manual Collab child, the hub's way, with
`AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY=1`. Its first answer names the persisted cursor and the expected cursor version;
the reset then moves the cursor there (or to another valid anchor, chosen after checking §9.8 when the journal itself is
in doubt):

```sh
R=$(mktemp -d)
collab_repair() {
  { jq -nc '{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"ai-seat-repair",version:"1"}}}'
    jq -nc '{jsonrpc:"2.0",method:"notifications/initialized"}'
    cat "$R/call.json"; sleep 5; } |
  (cd / && /usr/bin/env -i HOME=/Users/yuai PATH=/opt/homebrew/bin:/usr/bin:/bin \
    AGENTOOL_COLLAB_DB=/Users/yuai/.local/share/agenttool/collab-shared/collab.sqlite \
    AGENTOOL_COLLAB_SESSION_FILE="/Users/yuai/.local/share/agenttool/collab-shared/collab-sessions/$S.json" \
    AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY=1 \
    /Users/yuai/.bun/bin/bun --no-env-file --config=/dev/null /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js) |
  jq -c 'select(.id == 2) | .result.structuredContent'
}
jq -nc --arg w "$W" '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"collab_next",arguments:{workspace_id:$w}}}' > "$R/call.json"
collab_repair | tee "$R/need.json"
# expect {"error":"cursor_recovery_required", …, "persisted_cursor":{…}, "expected_cursor_version":<n>}
jq -c --arg w "$W" --arg k "seat-repair-$S-$(date -u +%Y%m%dT%H%M%SZ)" '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"collab_cursor_reset",arguments:{workspace_id:$w,idempotency_key:$k,target:.persisted_cursor,expected_cursor_version:.expected_cursor_version,reason:"seat recovery after cursor_reset_required"}}}' "$R/need.json" > "$R/call.json"
collab_repair
# expect {"session":{…}} and no "error"
rm -rf "$R"
collab-bridge hub unpark "$L"
```

**(b) An exit**, when the session should end instead. Without `--release-leases` first: Collab refuses while a lease is
live, so live claims are never dropped by accident; add `--release-leases` only after deciding to drop them. After an
end, outcomes left unknown under the old session cannot be replayed, so the agent checks with `collab_task_list` or
`collab_report_list`.

```sh
cd / && /usr/bin/env -i HOME=/Users/yuai PATH=/opt/homebrew/bin:/usr/bin:/bin \
  /Users/yuai/.bun/bin/bun --no-env-file --config=/dev/null /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-host.js \
  end --session-file "/Users/yuai/.local/share/agenttool/collab-shared/collab-sessions/$S.json" --reason "cursor recovery" \
  --db /Users/yuai/.local/share/agenttool/collab-shared/collab.sqlite
collab-bridge hub unpark "$L"
```

After (b) the lineage is `ended`: its next `collab_session_start` begins a new session, and its other calls answer
`seat_session_ended`. Either way `hub unpark` writes `~/.local/state/collab-bridge/requests/unpark-<lineage>.json`,
which the running hub applies at its next reload (or its next start), refused while a child of that lineage still runs.

## Limits

- **Shared Air clone.** A concurrent Air-side `git fetch` in the same clone during a failed bridge fetch may fail, and its bytes count toward the bridge's daily budget; it fails closed and a re-run succeeds.
