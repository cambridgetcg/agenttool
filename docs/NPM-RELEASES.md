<!-- @id urn:agenttool:doc/NPM-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL urn:agenttool:doc/DEPLOY-PROCEDURE -->

# NPM-RELEASES — one exact, reviewed publication path

> *Operational runbook for optional npm mirrors. An npm credential is authority to publish bytes; it is not proof that those bytes were reviewed, built from `main`, or accepted by the public registry.*

> **Compass:** [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (registry-neutral artifact identity) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [DEVELOPMENT](DEVELOPMENT.md) (contributor workflow)
>
> **Implements:** one manual, allowlisted npm release state machine for the established public JavaScript packages. LOVE remains the primary release record where a package has one; Collab and the developer-preview Correspondence-to-YUTABASE planner are intentionally npm-only.
>
> **Code:** `.github/workflows/publish-npm.yml` (reviewed GitHub entry point) · `bin/npm-release.ts` (package policy, exact artifact preparation, registry recovery, and receipt).
>
> **Tests:** `bin/tests/npm-release.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## Outcome

Use one workflow for npm publication. Do not run `npm publish` from a normal
local shell.

The workflow:

1. is dispatched on, and checks out, an existing annotated
   `<package>-v<version>` tag;
2. proves that the workflow identity, tag, `HEAD`, and provenance commit are the
   same commit contained in GitHub `main`;
3. installs locked dependencies and runs the selected package gate without a
   publish credential or OIDC permission;
4. copies the checked-in LOVE tarball, or builds an allowlisted npm-only
   package tarball, into runner temp space;
5. checks package identity, repository, Apache-2.0 terms, archive paths and
   entry types, secret-like signatures, size, and hashes;
6. transfers only that tarball and its path-independent receipt to a second
   job;
7. enters the protected `npm-bootstrap` GitHub environment after preparation;
8. rechecks the downloaded bytes, then publishes with provenance and scripts
   disabled;
9. waits for public registry propagation and requires byte identity; and
10. creates or reuses the tag's GitHub Release, uploads the exact npm tarball if
    absent, re-downloads it, and requires byte identity before writing a
    non-secret receipt to the workflow summary.

An accepted publish followed by a transient registry `404` is recoverable. A
rerun treats an existing version as success only when its public tarball is
byte-identical and the requested npm dist-tag points at that version. Existing
different bytes, ambiguous HTTP status, source drift, or an unexpected tag all
stop without mutation.

Recovery intentionally requires the requested dist-tag still to point at the
released version. If that tag has legitimately advanced before a delayed
GitHub-mirror repair, the normal rerun refuses to move it backward; use a new,
separately reviewed mirror-repair mechanism instead of weakening this release
path.

## Authentication modes

`trusted` is the normal mode. npm exchanges the GitHub-hosted runner's OIDC
identity for a short-lived publish credential. The workflow grants
`id-token: write` only to the protected publication job, exposes no long-lived
write token, runs no package lifecycle code in that job, and receives automatic
public provenance.

`bootstrap` exists only because npm cannot attach a trusted publisher to a
package which does not yet exist. The release engine permits this mode only
when both the package and version return public registry `404`. The protected
GitHub environment supplies its existing `NPM_TOKEN` only to the final publish
step; package install, build, tests, and packing run in the preceding job before
the protected environment is entered. That secret must be an expiry-limited
granular npm access token with `@agenttool` read/write package access and
**Bypass 2FA** enabled. A login credential or granular token without bypass will
fail with `EOTP`. Do not restrict it to a Mac-only allowed IP range: GitHub-hosted
runners do not originate from that device. Once a package exists, bootstrap
cannot create another version; an exact already-published rerun is
verification-only and does not invoke `npm publish`.

The environment currently retains its bootstrap secret during migration. Do
not delete or revoke it until every active package has completed one trusted
publish. Credential revocation is a separate operator action.

## One-time trusted-publisher setup

After a package's first version exists, open that package's npm settings and
configure:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `cambridgetcg` |
| Repository | `agenttool` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm-bootstrap` |
| Allowed action | `npm publish` |

The filename and environment are case-sensitive. npm does not validate the
relationship when it is saved; the first trusted release is the operational
proof. Configuring trust requires account-level 2FA and rejects a bypass-2FA
token as the authorizing proof; Touch ID or another WebAuthn passkey satisfies
that requirement without a TOTP authenticator app. After a trusted release
succeeds, set package publishing access to require 2FA and disallow traditional
tokens.

`npm login --auth-type=web` is the browser sign-in flow for saving a local CLI
credential. It does not turn `npm publish` into browser authorization, bypass a
package's write policy, or establish trusted publishing. `npm publish` has no
`--auth-type=web`; an interactive TTY publish may separately open npm's
WebAuthn page for its second-factor challenge, but a non-interactive GitHub job
cannot use that popup. Ordinary releases do not need to move that proof through
a local shell once OIDC is configured.

## Operator sequence

External publication still requires explicit authorization. From a clean
release commit already merged to GitHub `main`:

```bash
# Inspect the allowlisted identity and expected tag.
bun bin/npm-release.ts resolve --package collab

# Create and push the annotated tag deliberately.
git tag -a collab-v0.1.0 <github-main-commit> -m '@agenttool/collab@0.1.0'
git push github refs/tags/collab-v0.1.0

# First publication only. Later versions use authentication=trusted.
gh workflow run publish-npm.yml --ref collab-v0.1.0 \
  -f package=collab \
  -f tag=collab-v0.1.0 \
  -f authentication=bootstrap \
  -f npm_tag=latest
```

The workflow's GitHub environment supplies the human review page. The release
engine does not bump versions, create or push tags, merge branches, publish
LOVE artifacts, deploy hosted services, configure npm trusted publishers, or
revoke credentials. It does create or verify one byte-identical GitHub Release
asset for the already-existing annotated tag; it does not rewrite unrelated
release assets.
