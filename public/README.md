# Public package projection

> **Type:** guide · **Purpose:** explain how allowlisted package source becomes the public `cambridgetcg/agenttool-packages` tree.
> **Evidence:** [`bin/project-public.ts`](../bin/project-public.ts), [`overlay/tools/public-guard.ts`](overlay/tools/public-guard.ts), and [`bin/tests/project-public.test.ts`](../bin/tests/project-public.test.ts).

This directory decides what may leave the private repository. Nothing here
publishes anything by itself.

| Path | Projected? | Role |
|---|---|---|
| [`allowlist.json`](allowlist.json) | No | The only paths that may be copied, the globs removed inside them, and any packages held back (none since 2026-10-11). Its SHA-256 is recorded in each projection. |
| [`overlay/`](overlay) | Yes, at the public root | Files that exist only in the public tree: README, LICENSE, NOTICE, licensing and security notes, `.gitignore`, `.gitleaksignore`, the public CI, and the public guard with its allow entries. |
| [`private-guard/`](private-guard) | **Never** | The relational denylist: terms, blob digests, and their allow entries. Publishing the terms would publish what they protect, so guard output names only rule ids and line hashes. |

## Projecting

```sh
bun bin/project-public.ts --source <commit on origin/main> --out-ref refs/public/main
bun bin/project-public.ts --source <commit> --out-repo /path/to/public.git
bun bin/project-public.ts --source <commit> --out-repo /path/to/public.git --no-write
```

With `--no-write` the tool builds, guards, and creates the commit against the
target's current head but writes nothing, so it prints the exact commit a
write would create. Without a target, `--no-write` previews only a root
projection.

The tool reads the allowlist, overlay, and denylist from the source commit's
objects and builds the tree in a temporary index. It writes `PROJECTION.json`
(schema `agenttool.public-projection/1`): the source commit, the allowlist
digest, each projected path's tree or blob id, excluded paths, overlay blob
ids, and the guard versions. The commit's only parent is the current public
head. Its author and committer are `AgentTool projection
<contact@cambridgetcg.com>`, both dated with the source's committer date, so
the same source and head always give the same commit id.

The source must descend from the source recorded in the public head's
`PROJECTION.json`, so a stale source cannot silently roll the public tree
back. `--allow-rewind` permits a deliberate rollback, and the result records
it as `rewound_from`.

Before any ref changes, every layer must pass: projection integrity; the path
layer (allowlist membership, no symlinks, submodules, files over 5 MiB,
credential-shaped names, or binary files without a digest entry); the secret
layer (release-tool signatures, the public doors rules, and gitleaks 8.30.1);
the personal layer; the private relational layer; and the parent/diff rule.
Content layers also read decoded escapes and NFC/NFKC forms of each line.
The public head and every commit behind it must be projection commits that
match their own `PROJECTION.json` (the guard's `--history` check, which the
public CI also runs on every push). The tool refuses to run when the guard it
imports differs from the overlay copy it ships. It never pushes. Pushing to
the public repository is a separate, reviewed step.

## Exceptions

- A gitleaks false positive goes in `overlay/.gitleaksignore` as a
  `path:rule:line` fingerprint with a `# line_sha256=<hex>` comment directly
  above it: the SHA-256 of the flagged line, which gitleaks findings print.
  The guard hides the file from gitleaks and applies it itself, so a
  fingerprint whose line moved or changed matches nothing and is reported.
- A secret or personal-layer exception goes in
  `overlay/tools/public-guard-allow.json`: path, rule, the SHA-256 of the whole
  line (never its text), reason, and approver.
- A binary file (a NUL byte in its first 8000 bytes, which includes UTF-16
  without a byte-order mark) is a `path/binary` finding unless the same file's
  `binaries` list names its path, the SHA-256 of its bytes, a reason, and an
  approver. The finding prints that digest. An allowed binary's printable
  strings are still scanned by every content layer, and BOM-marked UTF-16
  text is scanned as text.
- A relational exception goes in the `allow` list of the private denylist with
  the same fields. Only wire-protocol enum values and the public `Yu-and-Ai`
  Hugging Face handle may be approved by Ai; any other relational exception
  needs Yu's recorded approval.

An allow entry that no longer matches anything fails the guard.
