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

## Unpair a device

`collab-bridge unpair <device>` is Yu's: the same refusals and y/N question as `hub off`
(`Unpair nuance? Its link, seat key and remote sessions end now. [y/N]`). It works with the device away, because
nothing in it dials the device (spec §9.10). In order:

1. The device file goes `unpaired` and loses its seat key; a running hub closes the link, stops that device's
   children and refuses its attaches at its next reload.
2. The device's pending reviews are listed, and none is decided: an Air session reviews each, accepting only while the
   mirror is still at the completed commit, else requesting changes.
3. Every remote session of the device (each lineage's, and each active session whose role starts
   `remote(<device>/<user>;` in that device's mirror) is ended with
   `agenttool-collab-host end --session-file <credential> --reason "device unpaired" --release-leases --db <shared journal>`.
   A session whose credential file is gone cannot be ended from the Air; it is reported, never skipped.
4. The hub ledger is archived as `~/.local/state/collab-bridge/ledger.<UTC stamp>.jsonl` (0600), and the device's
   `Host collab-<device>` block and its `collab_<device>_ed25519` key pair are removed from `~/.ssh/collab-bridge/`.
5. Revocation stays incomplete until the ` collab-air` line is removed on the device, or the key expires. On the
   device, in Terminal:

```sh
sed -i '' '/ collab-air$/d' ~/.ssh/authorized_keys
```

It exits 0 when every step completed, and 1 when it listed items for Ai (a session it could not end, a workspace it
could not read).

## Rollback on the Air

Each step stands alone, and none needs sudo (spec §10.6). Yu runs the first two; the rest is Ai's.

```sh
collab-bridge unpair nuance
collab-bridge hub off
cd /Users/yuai/Projects/collab-trial && claude mcp remove -s local agenttool-collab
mkdir -p -m 700 /Users/yuai/.cache/agenttool/collab-bridge-archive
cp -p /Users/yuai/.local/state/collab-bridge/ledger*.jsonl /Users/yuai/.local/state/collab-bridge/hub.log /Users/yuai/.cache/agenttool/collab-bridge-archive/
rm -rf /Users/yuai/.local/state/collab-bridge
rm -rf /Users/yuai/.ssh/collab-bridge /Users/yuai/.config/collab-bridge /Users/yuai/.local/share/collab-bridge
rm -f /Users/yuai/.local/bin/collab-bridge
rm -rf /Users/yuai/Applications/CollabBridgeHub.app /Users/yuai/collab-bridge-*-bundle-*
```

The mirrors go last, and only after every session that used them has ended and their pending reviews are resolved.
Keeping the bridge refs first is optional (the `bundle create` line):

```sh
C=/Users/yuai/Projects/collab-trial
for m in $(git -C "$C" worktree list --porcelain | sed -n 's#^worktree \(/Users/yuai/.local/share/agenttool/collab-shared/mirrors/.*\)#\1#p'); do
  git -C "$C" worktree unlock "$m"; git -C "$C" worktree remove "$m"
done
git -C "$C" bundle create /Users/yuai/.cache/agenttool/collab-bridge-archive/collab-refs.bundle --glob=refs/collab
git -C "$C" for-each-ref --format='delete %(refname)' refs/collab/ | git -C "$C" update-ref --stdin
git -C "$C" worktree prune
```

The mirrors' root paths stay in the append-only shared journal; `~/.local/share/agenttool/collab-shared/` can be
archived whole. The Air's private journal is never touched.

## Nuance: install and rollback

Yu runs the installer at Nuance, in Terminal, as himself, after adding the printed allowlist entry and AirDropping the
bundle (spec §10.3):

```
bash ~/Downloads/collab-bridge-nuance-bundle-<expiry>-<build>/collab-install.sh
```

It never runs anything inside the bundle folder: it copies `collab-bridge` to a fresh temporary folder, checks that
copy's sha256, removes the quarantine mark and runs only the copy. It checks everything before it writes anything but
the trial clone: macOS on Apple Silicon, not root, and the user the bundle was prepared for; Summon installed, with its
keys-only record, its password-off drop-in and its ` summon-air` key line; the bundle's checksums; the key not expired
and the bundle not older than what is installed; a silent `~/.zshenv`; a git with the lazy-fetch guard; `claude` on the
Terminal's PATH, a native install that answers `--version` with only the system's folders on PATH (an npm-installed
`claude`, which needs Node on PATH, is refused before anything is written); each shared folder inside an `access: edit`
folder of Summon's allowlist, and never a citizen's folder or a folder in Desktop, Documents, Downloads or iCloud Drive.
Then, in this order: the trial clone (only when the folder is not there yet), the program and `INSTALLED`, the seat key
and `shares.json`, the state folders and the seeded tool list, and the one ` collab-air` key line. Last come two
questions per shared folder: the Collab tools (`claude mcp add-json -s local agenttool-collab-hub …` and
`attribution.commit` in `.claude/settings.local.json`) and the knock line (the UserPromptSubmit tap). The questions need
a terminal: run without one, it stops at the start with `✗ Not confirmed`, having written nothing. It ends `Done`, or
with a line starting `✗`. It asks for no password and never changes sshd, Summon's files or allowlist, or any user-level
setting.

**Rollback at Nuance** (spec §10.6). Each step stands alone; this order keeps every later step possible:

1. Remove the key line first: `sed -i '' '/ collab-air$/d' ~/.ssh/authorized_keys` (only that line ends
   ` collab-air`; Summon's ` summon-air` line stays).
2. In each shared folder, unwire Claude: `cd ~/Projects/collab-trial && claude mcp remove -s local agenttool-collab-hub`.
3. Remove exactly the tap entry and `attribution.commit`, never by restoring the backup:
   `~/.local/share/collab-bridge/collab-bridge install unsettings --folder ~/Projects/collab-trial`.
4. Delete `~/.local/share/collab-bridge`, `~/.config/collab-bridge` and `~/.local/state/collab-bridge`.
5. If you want, remove the `~/Projects/collab-trial` entry from `~/.config/summon/allowlist.yaml`. The trial folder
   itself, its `.claude/settings.local.json.collab-bridge-backup` (made only when that file existed before) and the
   two lines the installer added to its `.git/info/exclude` stay until you delete them.

Summon's own rollback deletes its drop-in and may turn Remote Login off. Skip those two steps while
`grep -c ' collab-air$' ~/.ssh/authorized_keys` is not 0, that is, until step 1 above is done.

## Pairing a device (Ai, on the Air)

`scripts/prepare-pairing.ts` makes everything a device needs, under the Air's home, run from Terminal with cwd `/` (spec
§10.2 step 1). It refuses a worktree with uncommitted changes, because the binary it ships must be a reviewed commit's:

```sh
cd / && /Users/yuai/.bun/bin/bun --no-env-file --config=/dev/null \
  /Users/yuai/Projects/.worktrees/agenttool-collab-bridge/packages/collab-bridge/scripts/prepare-pairing.ts \
  --device nuance --user macair --share /Users/macair/Projects/collab-trial=/Users/yuai/Projects/collab-trial \
  --trailer "Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>"
```

In this order: `~/Projects/collab-trial` when it is not there (a repository on `main` with one commit: `README.md`, which
holds the rules for Air sessions there, and `notes/.gitkeep`; the commit's message ends with the trailer, and it is the
shared base on both Macs; an existing repository is kept as it is); `~/.ssh/collab-bridge/collab_nuance_ed25519` once, with the comment `collab-air`;
one Nuance binary; the seat tool list, from a probe of the installed Collab on a throwaway journal; the AirDrop folder
`~/collab-bridge-nuance-bundle-<expiry>-<build>/` (0700: `collab-install.sh`, `collab-bridge`, `MANIFEST.txt`,
`tools.json`, `collab-trial.bundle`); and `~/.config/collab-bridge/devices/nuance.json` in state `prepared`. It prints the
bundle, the key's expiry (the pairing date plus 90 days), the two lines Yu adds under `folders:` in Nuance's
`~/.config/summon/allowlist.yaml`, and the line Yu runs there.

Every value that goes into the installer is checked before anything is written: a share path the gate's form cannot
carry (one with `'`, `!`, `\` or a control character, one that is not absolute and normalised, or one longer than 1019
bytes) is refused, and Phase 1 shares one folder. Older bundle
folders are listed with the command that removes them, never removed. Preparing again, to renew the key, writes the
device file as `prepared` again: a running hub drops the device's link and stops its children, and dials it again only
once it is pinned again and the hub has restarted.
