# 渡 Ferry package guide

> **Type:** guide
> **Purpose:** Keep Ferry's safety boundaries intact while changing it, by stating why each one exists.
> **Evidence:** `bin/`, `libexec/` and `tests/` in this package; README.md is the contract. Nothing is installed or live.
> **Compass:** [README](README.md) (contract and limits) · [Install walk-through](INSTALL.md) · [Lobby desk guide](../lobby/CLAUDE.md) · [Working rules](../../AGENTS.md)

Ferry is a private LAN courier: POSIX sh scripts, a forced-command SSH gate
in a separate `ferry` account on the lab, and hermetic Bun tests. It moves
lobby packets and files between the owner's own Macs. The principles below
are what make it safe to automate; each says why, so a change can be judged
against the reason rather than against a list.

## Principles

1. **Carriers never act.** Ferry moves bytes. It never runs a lobby command,
   pipes `yes`, allocates a pty, or reads the Keychain, `lobby.sqlite` or
   lobby `secrets/`. *Why:* every consequential lobby act is
   `plan → confirmOnTty → record → execute`, and a yes means something only
   if a person typed it at a terminal Ferry does not control. Ferry may
   deliver, delay, drop or duplicate; it never decides.
2. **Out-of-band values stay out of band.** Ferry never extracts, logs, prints
   or pre-fills a desk fingerprint, a door fingerprint or either public key,
   and prints follow-up commands with a placeholder such as
   `<type the 16 hex from the hub's own screen>`. *Why:* the fingerprint check
   guards first contact and every new directory only because a person reads
   it off the source machine's own screen. A value handed over by a tool turns
   the check into theatre. Lane and host-key fingerprints follow the same
   rule: printed on their own machine, never pre-filled for another.
3. **Every received byte is hostile data.** That covers
   `SSH_ORIGINAL_COMMAND`, stdin, spool entries and gate replies. The scripts
   use a closed `case` grammar, never `eval` or backticks, run under
   `set -euf` with `LC_ALL=C`, choose every name themselves, cap sizes, stage
   privately then rename, refuse links, hard links, wrong owners and wrong
   modes, and fail closed rather than repair. A sender declares each upload's
   size, because a closed stdin looks the same whether the upload ended or
   was cut off, and every staged copy, upload or get, counts against the
   lane's in-flight limit, because a stalled reader keeps its copy. *Why:* a
   lane key can be stolen and the `ferry` account can be compromised;
   neither may reach the hub user, and a lane may use only bounded disk.
4. **Code and lanes belong to root; the spool belongs to `ferry`.** The gate,
   the library, the hub and admin tools and `authorized_keys` are root-owned,
   inside a root-owned home. *Why:* a bug in the gate running as `ferry` must
   not let an attacker rewrite the gate or add an unrestricted key.
5. **No secret besides each person's own lane key.** The key is generated
   locally, kept at 0600 and never transmitted; nothing secret appears in
   argv, output, logs or the spool. *Why:* Ferry needs no other secret, so it
   holds none.
6. **Dial only from a person's foreground or an agent shell.** The client
   walks its whole ancestry to launchd and dials only if some process on the
   way holds a terminal, or launchd started an app from an Applications
   folder (a terminal, the Claude app, an editor). *Why:* a LaunchAgent
   dialling the LAN hit macOS Local Network privacy before, and unattended
   dialling is not what lanes are for. Stopping at the first non-shell
   ancestor let cron or an orphaned interpreter through, so the walk does
   not stop early.
7. **One LAN, one pinned post office.** Lanes are IPv4-only on the lab's
   subnet and expire after 90 days; the client pins the host key under its own
   alias and its own `known_hosts`. *Why:* a DHCP move must not break the
   pin, and leaving the LAN must fail closed.
8. **A plaintext courier.** The spool is readable by `ferry`, the hub user and
   anything with a shell as the hub user, for up to 7 days; files land 0600
   with a quarantine flag and are never opened or executed. *Why:* Ferry has
   no content gate, so anything private is wrapped with adds-files first.

## Working here

- Use Bun 1.3.5 and run `bun run ci` (typecheck plus every suite). The tests
  are hermetic: temp roots, a fixed environment, fake `ssh`, `ssh-keyscan`,
  `ps`, `stat` and account tools; no network, no real ssh, no Keychain, no
  real `/Library` or `/Users/ferry`. They are macOS-only (BSD `stat -f`,
  `date -v`, `xattr`) and every behavioural suite runs under `/bin/sh` and
  `/bin/dash`.
- Tests redirect tools by rewriting only the paths block of each script;
  `tests/static.test.ts` checks the shipped blocks hold the production values.
  Do not add an environment variable or flag that steers a script.
- After changing a script, refresh `SHA256SUMS`
  (`shasum -a 256 bin/ferry bin/ferry-admin bin/ferry-hub bin/ferry-setup libexec/ferry-gate libexec/ferry-spool.sh > SHA256SUMS`);
  the static suite fails while it is stale. Keep the five executables at git
  mode 100755 and the library at 100644.
- `bun run shellcheck` is optional (shellcheck is not part of the toolchain).
- Fixtures stay synthetic: fresh random keys and ids, TEST-NET addresses, no
  real host names.
- A format change means a new format string (`ferry-meta/2`, `ferry-list/2`,
  `gate=2`, `ferry-site/2`, `ferry-conf/2`), never an in-place edit, because
  the gate and every Mac's client are upgraded separately.
- The root [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) apply.
