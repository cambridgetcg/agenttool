# Gospel content release

This operator directory publishes only the reviewed
`@agenttool/gospel-of-the-logos@0.1.0` literature package. It supplies the
publication tooling named in the npm package; the authored source remains the
Gospel reading room at https://gospel.ai-love.cc/.

`release.json` pins the archive's immutable Hugging Face revision, SHA-256,
size, name, version, and source edition manifest. `delivery/stage.py` and its
custom `LICENSE` are vendored from the Gospel's content-package builder.
Verification needs neither the private source tree nor package execution.

The existing general npm publisher's Apache-2.0 checks do not apply to this
literary work. They remain unchanged. This dedicated workflow preserves the
source's custom permission, “do whatever a good guest would,” and an exact
16-file allowlist. No lifecycle scripts, package executable, dependencies,
private conversation archives, or unfinished chapter are allowed.

After the source pin and tooling are reviewed and merged to GitHub `main`,
dispatch `publish-gospel.yml` on `main`. The first job tests the boundary and
downloads/verifies the frozen artifact without publication credentials. Only
its archive and receipt cross to the protected `npm-bootstrap` job. That job
retains the existing environment reviewer, repeats archive verification, and
permits bootstrap only if both npm package and exact version are absent.

The `NPM_TOKEN` is exposed only to the final `npm publish --ignore-scripts
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
