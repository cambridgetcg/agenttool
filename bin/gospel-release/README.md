# Gospel content release

This operator directory published only the reviewed
`@agenttool/gospel-of-the-logos@0.1.0` literature package. It supplies the
publication tooling named in the npm package; the authored source remains the
Gospel reading room at https://gospel.ai-love.cc/.

**Publication retired (decided 2026-10-28).** 0.1.0 has been on npm since
2026-09-08, and the `NPM_TOKEN` secret this route used was deleted from the
`npm-bootstrap` environment on 2026-10-28. `publish-gospel.yml` no longer
publishes. On pull requests and dispatches it still tests the boundary and
verifies the frozen archive; a dispatch on `main` then re-verifies the public
npm tarball in a second job that has no environment, OIDC permission, or
secret. If 0.1.0 were ever absent from npm, that job would fail only after the
full 450-second readback, saying that publication may already have succeeded,
though this workflow can no longer publish. Another edition needs a new
reviewed route and its own short-lived credential. The paragraphs below
describe the route as it stood when retired. 0.1.0's own run (34194522635,
2026-09-08) was approved in `npm-bootstrap` by its required reviewer.

**Source unreachable, 2026-10-28.** Anonymous reads of the pinned Hugging Face
archive, and of the `Yu-and-Ai/gospel-of-the-logos` dataset and Space APIs,
answered HTTP 401, so the archive step, and with it this workflow's
pull-request check, fails until the pin names a copy that can be fetched; the
unit tests still pass. The npm tarball read the same day
matched the pin: 363,435 bytes, SHA-256
`f69353fe7e99dc4d3eb811dcf06b5c3f9c3a8099bd5100e6a5baa88ef6b75923`.

`release.json` pins the archive's immutable Hugging Face revision, SHA-256,
size, name, version, and source edition manifest. `delivery/stage.py` and its
custom `LICENSE` are vendored from the Gospel's content-package builder.
Verification needs neither the private source tree nor package execution.

The existing general npm publisher's Apache-2.0 checks do not apply to this
literary work. They remain unchanged. This dedicated workflow preserves the
source's custom permission, “do whatever a good guest would,” and an exact
16-file allowlist. No lifecycle scripts, package executable, dependencies,
private conversation archives, or unfinished chapter are allowed.

Once the source pin and tooling were reviewed and merged to GitHub `main`,
`publish-gospel.yml` was dispatched on `main`. The first job tested the
boundary and downloaded/verified the frozen artifact without publication
credentials. Only its archive and receipt crossed to the protected
`npm-bootstrap` job. By 2026-10-11 that environment no longer showed a
required reviewer (owner decision, 2026-10-12: none wanted; a release runs
when Yu and Ai agree to it in conversation). The job repeated archive
verification and permitted bootstrap only if both npm package and exact
version were absent.

The `NPM_TOKEN` was exposed only to the final `npm publish --ignore-scripts
--provenance --access public` step. An exact already-public rerun verifies bytes
and `latest` without republishing. Existing different bytes, partial registry
state, or a different dist-tag fail closed before publication. The final step
anonymously downloads the public npm tarball and compares it with the reviewed
digest. Readback allows 450 seconds for missing metadata, tarball, or `latest`
to propagate; it also retries transport failures, HTTP 408/425/429, and 5xx responses.
Metadata lookups bypass stale caches, and each request uses the remaining time
budget. Conflicting identities, bytes, origins, or existing dist-tags fail
immediately. A readback timeout reports that publication may already have
succeeded, so an operator can inspect the registry before retrying.

This first-edition route accepts no arbitrary package, URL, shell command,
version, digest, or license input at dispatch. Another edition requires another
reviewed source change; it does not expand the bootstrap credential's scope.

Local checks:

```sh
python3 -m unittest discover -s bin/gospel-release -p 'test_*.py' -v
python3 bin/gospel-release/release.py verify --directory /path/to/reviewed/archive
```

Anonymous source and npm downloads are bounded to 8 MB and HTTPS. Hashes
identify the edition's bytes; they do not establish its theological claims.
