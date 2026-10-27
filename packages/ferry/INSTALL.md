# Installing 渡 Ferry

> **Type:** guide
> **Purpose:** Walk the owner through setting up the lab post office, one Mac's lane, and the first lobby renewal carried by Ferry, with every typed check left in place.
> **Evidence:** The steps follow the scripts in `bin/` and `libexec/` and their hermetic tests. They have not been run on a real lab; section G lists what install must confirm.
> **Compass:** [README](README.md) (contract) · [Package guide](CLAUDE.md) (principles) · [Lobby desk](../lobby/README.md)

Placeholders: `<lab>` is the lab's LocalHostName (so `<lab>.local` is its
mDNS name), `<lan>/24` its home subnet, `<hub-user>` the account that holds
hub custody, `<mac>` a lane name such as `air`. The PR description carries
the filled-in values for the current lab. Every `sudo` step is yours to type.

## A. Carry the package to the lab and check it

1. On a Mac with the repository, at the reviewed commit:
   `git archive --format=tar <commit> packages/ferry > ferry.tar`. Then show
   the two values the lab must match: `git rev-parse <commit>` and
   `git show <commit>:packages/ferry/SHA256SUMS | shasum -a 256`.
2. Carry `ferry.tar` to the lab by any route you already use. Unpack it as
   root into a directory only root can change:
   `sudo mkdir -m 0755 /private/var/ferry-pkg && sudo tar -xf ferry.tar -C /private/var/ferry-pkg`.
   *Why:* any shell as `<hub-user>`, an agent included, can change files in
   that account's home between your check and the install, and `sh` reads a
   script while it runs it.
3. At the lab, show the same two values: `git get-tar-commit-id < ferry.tar`
   and `shasum -a 256 /private/var/ferry-pkg/packages/ferry/SHA256SUMS`.
   Compare them with the other Mac's screen: the whole commit id and all 64
   hex of the second value. Stop if either differs.
4. At the lab: `cd /private/var/ferry-pkg/packages/ferry && shasum -a 256 -c SHA256SUMS`.
   All six lines must say `OK`. This only shows the files agree with this
   copy of `SHA256SUMS`; step 3 is what ties that copy to the reviewed commit.

## B. Set up the lab (once, about 10 minutes)

From `/private/var/ferry-pkg/packages/ferry` on the lab:

1. Dry run, which changes nothing and prints every check and command:
   `sudo /bin/sh ./bin/ferry-setup --lan <lan>/24 --hub-user <hub-user>`.
   It copies the package into a fresh root-owned directory, checks the copy
   and prints `check: SHA256SUMS sha256 <64 hex>`: it must be the value from
   A.1. Only that copy is ever installed.
2. Read the plan. Then apply it:
   `sudo /bin/sh ./bin/ferry-setup --apply --lan <lan>/24 --hub-user <hub-user>`
   - `sysadminctl` asks for the new `ferry` account's password. Type a
     throwaway of at least 24 random characters and keep nothing; no one ever
     logs in as `ferry` with a password.
   - The account's primary group is `ferryhand`, not `staff`, so it cannot
     list `<hub-user>`'s home (macOS homes are `user:staff 0750`).
   - `sysadminctl` can exit 0 without creating anything, so setup asks
     directory services afterwards and stops at once if the account is
     missing or came out with another home or group.
   - Setup prints whether Remote Login is limited to `com.apple.access_ssh`
     and, if so, adds `ferry` to it.
3. Verify (read-only): `sudo /bin/sh ./bin/ferry-setup --check --lan <lan>/24 --hub-user <hub-user>`
4. Open a new terminal as `<hub-user>` (or log out and in) so the
   `ferryhand` membership applies, then run `/Library/Ferry/bin/ferry-hub status`.

Setup touches no sshd file and no hub-user file except the group membership.

## C. A Mac's client and lane (once per Mac, then every 90 days)

`ferry lobby push` and `ferry lobby fetch` need `/usr/bin/jq`, which macOS
ships from 15 (Sequoia) on; on an older Mac they exit 8 and say so. Files
need no jq.

1. On the Mac (an agent may do this):
   `install -m 0755 packages/ferry/bin/ferry ~/.local/bin/ferry`, check its
   sha256 against `SHA256SUMS`, then `ferry init --self <mac>`. It prints the
   lane fingerprint on this Mac's screen and the path of the `.pub` file.
2. Carry the `.pub` file to the lab by any route (it holds no secret), for
   example to `~/ferry-lanes/<mac>.pub`.
3. At the lab, type the fingerprint you read off the Mac's own screen:
   `sudo /Library/Ferry/bin/ferry-admin lane add --peer <mac> --pubkey-file ~/ferry-lanes/<mac>.pub --expect-fp SHA256:...`
   It shows the exact line it will add; type `yes`.
4. At the lab: `/Library/Ferry/bin/ferry-admin whoami`. It shows the lab's
   host-key fingerprint and mDNS name.
5. On the Mac, type the host-key fingerprint you read off the lab's screen:
   `ferry peer add hub --host <lab>.local --host-key-fp SHA256:...`, then
   `ferry ping`.

## D. The first renewal carried by Ferry

1. On the Mac (an agent may do this):
   `agenttool-lobby enroll-device > /abs/pkt.json && ferry lobby push /abs/pkt.json`
   A renewal packet allows 30 minutes for the whole loop; a first enrollment
   allows 5.
2. At the lab (an agent may do this): `/Library/Ferry/bin/ferry-hub inbox`.
   It moves the packet into `lobby-mail` and prints the relay line. Every
   later `ferry-hub inbox` prints the line again while the packet is still
   valid and the relay has not written its join packet, so if an agent ran
   step 2, run `/Library/Ferry/bin/ferry-hub inbox` yourself at the lab
   terminal to see it.
3. At the lab, paste the printed relay line. In the relay prompt, compare
   `device <fingerprint>` with the Mac's own screen (`agenttool-lobby fleet status`
   there) and type `yes`. The `&&` then runs `ferry-hub reply`.
4. On the Mac (an agent may do this): `ferry lobby fetch`.
5. On the Mac, edit the printed `fleet join` line: replace the placeholder
   with the door fingerprint you read off the lab's relay screen, then type
   `yes` at the prompt.

Both yeses and both typed checks stay with you; nothing travels by scp or
AirDrop.

## E. Every 90 days, and after a reinstall

- Lanes expire 90 days after `lane add` or `lane renew`. At the lab:
  `/Library/Ferry/bin/ferry-admin lane list`, then
  `sudo /Library/Ferry/bin/ferry-admin lane renew --peer <mac>` and `yes`.
- If the lab's host key changes (a reinstall), read the new fingerprint from
  `ferry-admin whoami` on the lab's own screen and, on each Mac,
  `ferry peer add hub --host <lab>.local --host-key-fp SHA256:... --replace`.
- A lost Mac: `sudo /Library/Ferry/bin/ferry-admin lane remove --peer <mac>`
  (its spool directories go with the line).

## F. Undo

`sudo /bin/sh ./bin/ferry-setup --undo --lan <lan>/24 --hub-user <hub-user>`
(from the carried copy) prints the undo commands; it runs nothing. They remove the memberships, the
`ferry` account (with its home, spool and lanes), the `ferryhand` group and
`/Library/Ferry`. The hub user's own `lobby-mail`, `~/Ferry` and Ferry state
stay. Run `id ferry` afterwards: it must fail, because `sysadminctl` can exit
0 without doing anything. The carried copy goes with
`sudo rm -rf /private/var/ferry-pkg`. On each Mac:
`rm -rf ~/.local/state/agenttool/ferry ~/.ssh/ferry ~/.local/bin/ferry`
(`~/Ferry` holds received files).

## G. To confirm during install

1. `sysadminctl -password -` reads the password at the terminal and creates
   `/Users/ferry` at once (setup falls back to `createhomedir`), and `-GID`
   gives `ferry` the `ferryhand` primary group: `id ferry` lists no `staff`.
2. sshd accepts the root-owned 0750 home for a forced-command login
   (StrictModes as documented allows it; untried on this macOS).
3. A fresh `ferryhand` membership reaches an existing terminal session only
   after a new login; `ferry-hub` says so with exit 6.
4. Membership of `com.apple.access_ssh` is enough for a standard account when
   Remote Login is limited to "only these users".
5. The quarantine value `0081;…;ferry;` gives Gatekeeper's downloaded-file
   treatment (untested with an app bundle).
6. Local Network privacy lets Terminal and agent shells dial the lab from
   each Mac (observed only for the Air's existing ssh).
7. The hub user's existing SSH sessions keep working unchanged.
