# 渡 Ferry: a LAN post office for the owner's Macs

> **Type:** reference
> **Purpose:** Describe Ferry: restricted forced-command SSH lanes from each Mac into one post office in a separate `ferry` account on the lab, carrying lobby packets device↔hub and ordinary files between any two Macs.
> **Evidence:** Source and hermetic tests in this package (`bun run ci`, under `/bin/sh` and `/bin/dash`, macOS only). Nothing here is installed, live, or exercised against a real sshd, a real account or the real lobby.
> **Compass:** [Package guide](CLAUDE.md) (principles and why) · [Install walk-through](INSTALL.md) · [Lobby desk](../lobby/README.md) (the packets Ferry carries) · [Package inventory](../../docs/PACKAGES.md)
> **Implements:** Tier B (the LAN courier) of the 2026-10-27 lobby carrier design, slice S1 with the generic files of S4. The design document is kept outside this repository; this README restates what is built.
> **Code:** `bin/ferry` (client) · `bin/ferry-hub` (lab, hub user) · `bin/ferry-admin` (lab, lanes) · `bin/ferry-setup` (lab, once) · `libexec/ferry-gate` (sshd forced command) · `libexec/ferry-spool.sh` (shared library)
> **Tests:** `tests/{grammar,lobby-lane,files,spool-safety,limits,out-of-band,client-ssh,admin,setup,static}.test.ts` with `tests/{helpers,packets}.ts`

Ferry carries bytes between the owner's own Macs on one home LAN, so that
lobby enrollment and renewal packets, and ordinary files, stop travelling by
scp or AirDrop. It is a **star**: every Mac has one lane to a post office on
the always-on lab Mac, and one lane gives that Mac both push and pull. No Mac
other than the lab runs sshd for Ferry.

Ferry is a courier and never an actor. Every consequential lobby act stays
`plan → confirm on /dev/tty → record → execute` inside the lobby CLI, typed by
a person. Ferry prints the next command with a placeholder where an
out-of-band value belongs; it never fills one in.

## Trust model in short

The reasons are in [CLAUDE.md](CLAUDE.md); the shape is:

- **Carriers never act.** No Ferry script runs a lobby command, pipes `yes`,
  allocates a pty, or reads the Keychain, `lobby.sqlite` or lobby `secrets/`.
- **Out-of-band values stay out of band.** No output, log, meta or file name
  holds a packet's desk fingerprint, door fingerprint or either public key
  (`tests/out-of-band.test.ts` searches all of them).
- **Every received byte is hostile.** `SSH_ORIGINAL_COMMAND` is matched
  against a closed grammar; names are chosen by the post office; every spool
  file is stat-checked and only a private copy is ever read.
- **Code and lanes belong to root; the spool belongs to `ferry`.** A bug in
  the gate running as `ferry` cannot rewrite the gate or plant a lane.
- **A plaintext courier.** The spool is readable by `ferry`, by the hub user
  and by anything with a shell as the hub user, for up to 7 days. Wrap
  anything private with adds-files before sending.

## Components

| Piece | Runs on | As | Does |
|---|---|---|---|
| `bin/ferry` | every Mac | the person (never root) | `init`, `whoami`, `peer add hub`, `ping`, `lobby push`, `lobby fetch`, `send`, `list`, `fetch`, `ack` over one ssh lane |
| `libexec/ferry-gate` | lab | `ferry` (sshd forced command) | the post office: `ping`, `put lobby`, `put file`, `list`, `get`, `ack` |
| `libexec/ferry-spool.sh` | lab | sourced by the three lab tools | grammar, stat checks, staging, quotas, publish, take, prune, lock, log |
| `bin/ferry-hub` | lab | the hub user | `status`, `inbox`, `reply`, and files as the local peer `lab` |
| `bin/ferry-admin` | lab | root via sudo (`list`/`whoami` need no root) | the only writer of `/Users/ferry/.ssh/authorized_keys` |
| `bin/ferry-setup` | lab, once | root via sudo, from the carried package | creates the account (primary group `ferryhand`, not `staff`), group, directories and code from a root-owned checked copy of the package; dry run by default |

Installed on the lab: `/Library/Ferry/{libexec/ferry-gate,libexec/ferry-spool.sh,bin/ferry-hub,bin/ferry-admin,site.conf,SHA256SUMS}`,
all `root:wheel`. Each script has one paths block between
`# --- ferry:paths (tests rewrite only this block) ---` and
`# --- end ferry:paths ---` holding absolute tool paths and the install root;
site values live in the root-owned `/Library/Ferry/site.conf`, which the
scripts parse and never source. Installed scripts stay byte-identical to the
repository, so `SHA256SUMS` compares cleanly.

### Lanes

One `authorized_keys` line per Mac, written only by `ferry-admin`:

```text
restrict,from="<lan_cidr>",expiry-time="<YYYYMMDDHHMMSS>Z",command="/Library/Ferry/libexec/ferry-gate --peer <P>" ssh-ed25519 <base64> ferry-lane:<P>
```

`restrict` turns off the pty, every forwarding and the user rc. `from=` takes
IPv4 CIDR only, so the client forces IPv4. Lanes expire after 90 days.

### Spool layout (lab)

| Path | Owner:group | Mode |
|---|---|---|
| `/Users/ferry` (home) | root:ferryhand | 0750 |
| `/Users/ferry/.ssh`, `authorized_keys` (+ `.prev`) | root:wheel | 0755 / 0644 |
| `/Users/ferry/stage` (the gate's private staging) | ferry:ferryhand | 0700 |
| `/Users/ferry/log`, `gate.log` (+ `.1`–`.4`) | ferry:ferryhand | 2750 / 0640 |
| `/Users/ferry/spool`, `spool/lobby`, `spool/lobby/{in,out}`, `spool/files` | ferry:ferryhand | 2770 |
| `spool/lobby/in/<peer>/` (packets from the peer) | ferry:ferryhand | 2770 |
| `spool/lobby/out/<peer>/` (join packets for the peer) | ferry:ferryhand | 2770 |
| `spool/files/<peer>/` (files for the peer; `files/lab` for the hub user) | ferry:ferryhand | 2770 |
| `~hub/.local/state/agenttool/ferry-hub/{stage,hub.log}` | hub user | 0700 / 0600 |
| `~hub/agenttool/state/lobby-mail/{in,out}/<peer>/` | hub user | 0700, files 0600 |
| `~hub/Ferry/inbox/<from>/` | hub user | 0700, files 0600 + quarantine |

Each identity stages in its own 0700 directory on the same volume and then
renames into the spool, so the spool never contains a partial file. The
`ferry` account can rename anything inside the spool, so every write or
delete there by the hub user or by root (`ferry-admin`, `ferry-setup`) first
enters the directory, checks that its real path has no link in it, and then
names only `./<entry>`; a link swapped in afterwards cannot steer the write
elsewhere. Root never runs `install -d` inside the spool, because it follows
links.

## Wire protocol

The gate accepts `--peer <peer>` (from the root-owned line) or
`--self-check`. `SSH_ORIGINAL_COMMAND` must be 1–160 characters of
`[a-zA-Z0-9._ -]`, split on single spaces with no doubled, leading or
trailing space, and exactly one of:

| Command | stdin | stdout on success |
|---|---|---|
| `ping` | ignored | `ok ping gate=2 peer=<peer>` |
| `put lobby <size>` | an `agenttool-lobby-enrollment-packet/v1` packet (enroll or renew) | `ok put <id> <size> <sha256>` |
| `put file <to> <name> <size>` | the file bytes | `ok put <id> <size> <sha256>` |
| `list` | ignored | `ferry-list/1`, `item <id> <kind> <from> <size> <sha256>[ <name>]` lines, `end <n>` |
| `get <id>` | ignored | the body bytes only |
| `ack <id>` | ignored | `ok ack <id>` |

`<size>` is the byte count the sender is about to send (a decimal number,
1 to the limit, no leading zero). The gate publishes only when stdin ends at
exactly that count and refuses with 4 otherwise. *Why:* a Ctrl-C or a dropped
connection closes the gate's stdin as if the upload had ended, and without a
declared size a cut-off file would be published, hashed and later fetched
as "sha256 ok". The longest command, `put file` with a 16-character peer, a
100-character name and an 8-digit size, is 135 characters. `gate=2` is the
version with declared sizes; the client checks it on `ping` and names a
mismatch.

A lane lists, gets and acks only `lobby/out/<peer>` and `files/<peer>`, and
writes only `lobby/in/<peer>` or another peer's `files/<to>` (`<to>` may be
`lab`). Join packets travel hub → device only, through `ferry-hub reply`.

`list` reads each meta and stats its body but copies no body. `get` copies
the body into the gate's private stage, checks its size and sha256 there and
serves only that copy. Each copy counts against the lane's in-flight limit,
together with its uploads, because a reader that stops reading keeps its
copy staged until the connection closes.

The gate never echoes received data: no command text, no bad name, no packet
text. Every call writes one log line of counts and ids; `gate.log` rolls at
1 MiB and keeps four older generations (`.1` is the newest). The log belongs
to the `ferry` account, so it is a record, not tamper-evident evidence: a
lane that makes some 60,000 cheap calls pushes its older lines out.

```text
<UTC ISO> <gate|hub> peer=<peer> op=<op> code=<n> id=<id|-> to=<peer|-> bytes=<n|-> items=<n|->
```

### Names

| Thing | Grammar |
|---|---|
| peer | 2–16 of `[a-z0-9-]`, first `[a-z]`, no trailing `-`, no `--`; `hub ferry all none` are reserved, and the local peer (`lab`) has no lane |
| id | `YYYYMMDDTHHMMSSZ-hhhhhhhh` (UTC time and 8 random lowercase hex) |
| file name | 1–100 of `[A-Za-z0-9._-]`, first alphanumeric, no `..`, not ending `.part`, `.meta` or `.body` |

### Items and meta

An item is `<id>.body` (the bytes as sent) and `<id>.meta`, both `0640` and
group `ferryhand`, published body first and removed meta first. The meta is
ASCII with exact lines in this order:

```text
ferry-meta/1
kind=lobby-enroll|lobby-join|file
from=<peer|hub>
to=<peer|hub>
size=<decimal bytes>
sha256=<64 lowercase hex>
name=<file name>            (only when kind=file)
```

A list shows an item only when its meta parses and agrees with its
directory, and its body is a regular file with one link and the right owner,
group, mode and size. A get, the hub's `inbox` and its `fetch` also check the
sha256 on their private copy before using a byte; an item that fails stays
in the spool until it is acked or pruned. Lobby packets
must be fatal-UTF-8, hold only LF, printable ASCII and UTF-8 high bytes, open
with `{` and `  "format": "<format>",`, close with `}`, and pass a `jq` exact
key-set check. That is a carrier filter: the lobby still parses and verifies
every packet itself.

## Limits and exit codes

| Limit | Value | Where |
|---|---|---|
| lobby packet | 65,536 bytes (the lobby CLI's own cap) | contract constant |
| file | 16 MiB | contract constant |
| command | 160 characters | contract constant |
| lobby packets waiting per lane | 4 | `site.conf` `lobby_queue` |
| files waiting per sender | 32 items, 128 MiB | `file_queue_items`, `file_queue_bytes` |
| whole spool | 1 GiB | `spool_max_bytes` |
| free-disk floor (puts and gets refuse below it; `ack` still drains) | 20 GiB | `floor_kib` |
| transfers in flight per lane (uploads and gets together) | 2 | contract constant |
| retention | 7 days unacked; strays and stage leftovers after 60 minutes | `retain_days`, contract constant |

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | refused: wrong account, lane not provisioned, local peer as a lane, lock busy |
| 2 | usage or grammar |
| 3 | not found (id, recipient) |
| 4 | invalid content (size, declared size not matched, UTF-8, control bytes, format, file name, empty) |
| 5 | full (lane quota, in-flight limit, spool cap, disk floor) |
| 6 | spool or site unsafe (owner, mode, link, missing directory, volume, bad site.conf) |
| 7 | client: unreachable or refused by sshd |
| 8 | client: will not dial (no terminal or app above it, root, not initialised, nothing pinned, bad ferry.conf, no `/usr/bin/jq` for a lobby packet) |
| 9 | client: the bytes did not arrive intact; nothing landed, nothing acked |

`ferry-admin` uses 0, 1, 2, 3 (not confirmed or no terminal) and 6.

## Output contracts

The client dials one exact ssh argv: `-F /dev/null`, the lane key with
`IdentitiesOnly`, `BatchMode`, the post office pinned under
`HostKeyAlias=ferry-hub` in Ferry's own `known_hosts` with
`StrictHostKeyChecking=yes`, every forwarding off, `AddressFamily=inet`, and
`-n` for everything except `put` (`tests/client-ssh.test.ts` holds it). It
dials the pinned host name first and the cached IPv4 only when the first
attempt failed before connecting. Remote stderr is shown filtered to
printable ASCII.

Before it dials, the client walks its process ancestry up to launchd with
`ps -o ppid=,tty=,comm=`. It dials only when some process on the way holds a
controlling terminal, or the process launchd started is an app sitting
directly in `/Applications`, `/System/Applications` (or either one's
`Utilities`) or `~/Applications`: a terminal, the Claude app, an editor.
cron, `at`, LaunchAgents and interpreters orphaned to launchd have neither,
whatever runs between them and `ferry`, and a `ferry` whose own parent is
launchd is refused. This guards against unattended dialling by accident; it
is not a sandbox against the person's own code.

`ferry lobby fetch` prints, for each join packet:

```text
received join packet <id> (<size> bytes, sha256 ok)
saved: <abs path>
next, at this terminal (type the door fingerprint yourself, reading it off the hub's own screen):
  <lobby_command> fleet join --packet-file <abs path> --door-fingerprint <type the 16 hex from the hub's own screen>
```

`ferry-hub inbox` takes new packets into `lobby-mail`, then prints, for each
packet there that is still valid and has no join packet beside it yet
(taken now or by an earlier `inbox`, which an agent may have run):

```text
<peer>  <id>  <kind>  <size> bytes  valid until <HH:MM>Z (<n> min left)
saved: <lobby-mail>/in/<peer>/<id>.json
next, at this terminal (the prompt shows the desk fingerprint: compare it with <peer>'s own screen):
  <lobby-fleet> hub relay --packet-file <...>/in/<peer>/<id>.json > <...>/out/<peer>/<id>.join.json && /Library/Ferry/bin/ferry-hub reply <peer> <...>/out/<peer>/<id>.join.json
```

A declined or headless relay exits 3, so `reply` never runs; `reply` also
refuses an empty file. Lane and host-key fingerprints are printed only on
their own machine (`ferry whoami`, `ferry-admin whoami`), and the commands
that consume them carry a placeholder.

## What Ferry never does

- run, wrap or answer any lobby command, or allocate a pty;
- read the Keychain, `lobby.sqlite`, lobby `secrets/` or any key but the
  person's own lane key (generated locally, 0600, never sent);
- print, log or pre-fill a desk or door fingerprint or a packet's public key;
- open, execute or interpret a carried file (files land 0600 with a
  quarantine flag);
- dial from launchd, as root, over IPv6 or off the pinned host key;
- change sshd's configuration or any hub-user file except a group membership.

## Not built here

- Tier A of the carrier design: in-band `directory_renew`, `fleet renew`, the
  renew-sweep branch and stored-pin renewal joins (S2); lobby-tend
  notifications (S3). Nothing in `packages/lobby` changes.
- Live installs on the Studio and the mini, direct pair lanes, the iPhone,
  anything off the LAN.
- Moving hub custody to its own account, the rollover runbook and
  `directory_successor`.
- A `Match User ferry` sshd drop-in (publickey only, and `ClientAliveInterval`
  so a session whose Mac has gone away ends and its staged copy goes; a
  connected reader that stops reading is bounded by the in-flight limit, not
  by time); it waits for a reviewed `sshd -T` before/after diff on the lab,
  because a mistake there would break every SSH session to it.
- A gate log the `ferry` account cannot rewrite or flush (for example one
  written by the hub user from a summary), and per-lane rate limits.
- Any daemon, LaunchAgent, cron or poll; any encryption inside Ferry; any
  automatic relay, join or `yes`.
