# Public package projection

> **Type:** guide · **Purpose:** explain how allowlisted package source becomes the public `cambridgetcg/agenttool-packages` tree.
> **Evidence:** [`bin/project-public.ts`](../../bin/project-public.ts), [`tools/public-guard.ts`](../../tools/public-guard.ts), and [`bin/tests/project-public.test.ts`](../../bin/tests/project-public.test.ts).

This directory decides what may leave the private repository. Nothing here
publishes anything by itself.

| Path | Projected? | Role |
|---|---|---|
| [`allowlist.json`](allowlist.json) | No | The only paths that may be copied, the globs removed inside them, and any packages held back (none since 2026-10-11). Its SHA-256 is recorded in each projection. Its `export` section (the shared root files and the paths the export withholds) is read only by the export to the public development repository; see [the private namespace guide](../README.md). |
| [`overlay/`](overlay) | Yes, at the public root | Files that exist only in the public tree: README, LICENSE, NOTICE, licensing and security notes, `.gitignore`, `.gitleaksignore`, the public CI, the npm publish workflow, and the guard's allow entries. |
| [`tools/public-guard.ts`](../../tools/public-guard.ts) | Yes, as an overlay entry | The one shared guard. The projection takes it from the source root, not from `overlay/`, so the package mirror and the public development repository run the same file. |
| [`../guard/`](../guard) | **Never** | The relational denylist: terms, blob digests, and their allow entries. Publishing the terms would publish what they protect, so guard output names only rule ids and line hashes. |

Top-level areas such as `private/`, `bin/`, `api/`, `apps/`, and `.github/`
never leave this repository, whatever the allowlist says. The one exception is
`PUBLIC_RELEASE_TOOLS` in [`bin/project-public.ts`](../../bin/project-public.ts):
`bin/npm-release.ts` and `bin/build-love-packages.ts`, each as an exact file
entry, because the public repository's publish workflow runs them. They import
nothing but each other and Node or Bun built-ins. npm releases now run from the
public repository; see [NPM-RELEASES](../../docs/NPM-RELEASES.md#public-release-path-from-2026-10-12)
and `bin/public-release-tag.ts`, which tags a green projection commit.

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
imports differs from the `tools/public-guard.ts` it ships, and refuses an
overlay copy of that file or of the two exception files. Once the source
records the public development repository's root, it refuses a source whose
shared paths differ from the public tip it contains (`--public-sync`, default
`refs/remotes/origin/public-sync`). It never pushes. Pushing to
the public repository is a separate, reviewed step.

## Exceptions

- A gitleaks false positive goes in the root `.gitleaksignore` (the
  projection ships the root copy, as it ships the root guard; there is no
  overlay copy) as a
  `path:rule:line` fingerprint with a `# line_sha256=<hex>` comment directly
  above it: the SHA-256 of the flagged line, which gitleaks findings print.
  The guard hides the file from gitleaks and applies it itself, so a
  fingerprint whose line moved or changed matches nothing and is reported.
- A secret or personal-layer exception goes in the root
  `tools/public-guard-allow.json` (also shipped from the root): path, rule, the SHA-256 of the whole
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
