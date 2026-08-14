<!-- @id urn:agenttool:doc/PYPI-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/NPM-RELEASES urn:agenttool:doc/DEPLOY-PROCEDURE -->

# PYPI-RELEASES — protected, exact Python SDK publication

> *Operational runbook for the optional `agenttool-sdk` PyPI mirror. Registry
> acceptance is not source review, and an OIDC identity is authority to upload
> only within the publisher policy configured at PyPI.*

> **Compass:** [NPM-RELEASES](NPM-RELEASES.md) (parallel exact-artifact policy) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [SDK-ROADMAP](SDK-ROADMAP.md) (SDK parity and release state)
>
> **Implements:** one manual, stable-version-only PyPI release state machine for `agenttool-sdk`, with an isolated OIDC publication boundary and byte-level public readback.
>
> **Code:** `.github/workflows/publish-pypi.yml` (reviewed GitHub entry point) · `bin/pypi-release.ts` (source policy, credentialless build, registry preflight, artifact verification, and receipt).
>
> **Tests:** `bin/tests/pypi-release.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## Outcome

Use the `Publish Python SDK to PyPI` workflow. Do not run an upload command from
a normal local shell.

The workflow has four boundaries:

1. `prepare` checks out an existing annotated `sdk-vX.Y.Z` tag, proves that the
   tag is `HEAD` and is contained in GitHub `main`, installs the locked Python
   development environment without repository source overrides, runs the SDK
   tests, and builds one wheel plus one sdist. Bun, Python, uv, and Hatchling
   are pinned. This job has neither a
   protected environment nor OIDC permission, and the release engine refuses
   common upload credentials.
2. `preflight` rechecks the transferred files and receipt, then reads the
   release-specific PyPI JSON endpoint. An absent release or an exact subset
   needs publication. A complete exact release is an idempotent success and
   skips the protected job. Any different hash, size, filename, distribution
   type, project identity, URL origin, or yanked file stops before mutation.
3. `publish` enters the protected `pypi` GitHub environment and receives only
   `id-token: write`. It checks out no repository code and defines no
   repository-authored shell, package, build, test, or verification command.
   The receipt, wheel, and sdist are separate workflow artifacts, so this job
   conditionally downloads only the exact filenames which preflight found
   missing. It then calls the pinned PyPA publisher action. `skip-existing`
   closes a race after preflight; it is not used to choose recovery files.
   There is no username, password, API token, or fallback upload path.
4. `verify` has no protected environment and no OIDC permission. It waits for
   both public files, downloads their bytes from `files.pythonhosted.org`,
   checks size and SHA-256 against the preparation receipt, and inspects the
   wheel and sdist with isolated Python standard-library code. It does not
   import or execute `agenttool`. The completed non-secret receipt is written
   to the workflow summary.

Only `receipt.json`, the wheel, and the sdist cross the build boundary, each as
an independently named one-day workflow artifact. The build constraint file
and development environment do not. Only a missing distribution crosses into
the protected publication job.

## Current verified release

The protected workflow published `agenttool-sdk` 0.18.1 from annotated tag
`sdk-v0.18.1`, whose `tag_commit` and Python `source_revision` both equal the
protected GitHub-main merge
`a781fff407e6d6c0401e6bd35dad1b5671d29491`, on 2026-08-14. [Workflow run
31790559054](https://github.com/cambridgetcg/agenttool/actions/runs/31790559054)
prepared the distributions at `2026-08-14T10:03:03.826Z`, completed protected
trusted publication, and independently observed the exact public bytes at
`2026-08-14T10:05:01.477Z`. Its final `agenttool.pypi-release/1` receipt records
`status: "public_exact"`.

| Public file | Size | SHA-256 | Yanked |
|---|---:|---|---|
| [`agenttool_sdk-0.18.1-py3-none-any.whl`](https://files.pythonhosted.org/packages/d6/0f/1f1570a6c5c022ec6d999c72577fca0b77c17467ff9363c1ed17792b92f6/agenttool_sdk-0.18.1-py3-none-any.whl) | 248,937 bytes | `ad5d8fe66f0218cb86d37a1dc5c9fb2d9b7b8d25ebaad7e408cfd1a9b2964ab3` | `false` |
| [`agenttool_sdk-0.18.1.tar.gz`](https://files.pythonhosted.org/packages/e9/17/a45e1fbfd573163d31e229758a4b0687af8e86b8396d672e4bd536c01919/agenttool_sdk-0.18.1.tar.gz) | 233,734 bytes | `1d5e3ca16ce53f71e2bec40e37c0a1d4ef250086d1f52010f13cc1305831f2af` | `false` |

PyPI records the wheel upload at `2026-08-14T10:04:31.867729Z` and the source
distribution upload at `2026-08-14T10:04:33.313732Z`. Both files are public,
not yanked, and byte-identical to the corresponding prepared workflow
artifacts. They are Python wheel/sdist formats, not copies of the TypeScript
LOVE/npm/GitHub tarball. PyPI Integrity exposes one publish attestation and
transparency-log entry for the
[wheel](https://pypi.org/integrity/agenttool-sdk/0.18.1/agenttool_sdk-0.18.1-py3-none-any.whl/provenance)
at Rekor index `2465055465` and one for the
[sdist](https://pypi.org/integrity/agenttool-sdk/0.18.1/agenttool_sdk-0.18.1.tar.gz/provenance)
at index `2465055324`. Their subjects match the hashes above, and their
publisher records bind repository `cambridgetcg/agenttool`, workflow
`publish-pypi.yml`, and environment `pypi`.

The PyPI mirror remains optional and non-authoritative. It does not replace the
annotated Python source locator, does not establish TypeScript LOVE identity,
and did not deploy the API or static sites.

The npm/GitHub 0.18.0 receipt remains immutable historical evidence; PyPI
0.18.0 remains unpublished rather than being rewritten by this newer release.

### Historical 0.17.0 evidence

The protected workflow published `agenttool-sdk` 0.17.0 from annotated tag
`sdk-v0.17.0`, which peels to GitHub-main merge commit
`21db539d6bcae614f1d6884eaa503347fae63187`, on 2026-07-28. [Workflow run
30385042684](https://github.com/cambridgetcg/agenttool/actions/runs/30385042684)
completed preparation, public preflight, protected trusted publication, and
credential-free public readback. Its final `agenttool.pypi-release/1` receipt
records `status: "public_exact"`.

| Public file | Size | SHA-256 | Yanked |
|---|---:|---|---|
| `agenttool_sdk-0.17.0-py3-none-any.whl` | 193,335 bytes | `1a8ca5f099ffce4c7973f1123d973aba5c1eb507579961c781d553bcc5e0f508` | `false` |
| `agenttool_sdk-0.17.0.tar.gz` | 181,846 bytes | `7ec2f4010d20ca883770594bfbcdc30f7a3a074ba534029aefb6d91d69c3413c` | `false` |

Both files are public, not yanked, and byte-identical to the corresponding
prepared workflow artifacts. They are Python wheel/sdist formats, not copies of
the TypeScript LOVE/npm/GitHub tarball. PyPI Integrity exposes one publish
attestation and transparency-log entry for the
[wheel](https://pypi.org/integrity/agenttool-sdk/0.17.0/agenttool_sdk-0.17.0-py3-none-any.whl/provenance)
and one for the
[sdist](https://pypi.org/integrity/agenttool-sdk/0.17.0/agenttool_sdk-0.17.0.tar.gz/provenance);
their subjects match the hashes above and their publisher records bind
`cambridgetcg/agenttool`, `publish-pypi.yml`, and environment `pypi`.

### Historical 0.16.5 evidence

The preceding protected release remains immutable evidence. Annotated tag
`sdk-v0.16.5` peels to commit
`1eca6466268b4d3c18a83a30a4bfef8bdd704a4d`; [workflow run
30350234792](https://github.com/cambridgetcg/agenttool/actions/runs/30350234792)
completed its protected trusted publication and public readback on 2026-07-28.

| Historical public file | Size | SHA-256 | Yanked |
|---|---:|---|---|
| `agenttool_sdk-0.16.5-py3-none-any.whl` | 180,615 bytes | `61f13b01df90c66d7ac8247ee1dcfba9c135840ee364b172695fdd5eb10c54db` | `false` |
| `agenttool_sdk-0.16.5.tar.gz` | 168,772 bytes | `2d90ea74aa1d220ae28ce6176274e5491645d9db67844a4b4ff3dabfa10325d4` | `false` |

Both historical files remain public and not yanked. PyPI Integrity retains one
publish attestation and transparency-log entry for the
[wheel](https://pypi.org/integrity/agenttool-sdk/0.16.5/agenttool_sdk-0.16.5-py3-none-any.whl/provenance)
and one for the
[sdist](https://pypi.org/integrity/agenttool-sdk/0.16.5/agenttool_sdk-0.16.5.tar.gz/provenance);
their subjects match the historical hashes above and their publisher records bind
`cambridgetcg/agenttool`, `publish-pypi.yml`, and environment `pypi`.

## Idempotence and recovery

PyPI versions and distribution filenames are immutable. The workflow therefore
does not try to overwrite or repair different public bytes.

| Public state for this exact version | Result |
|---|---|
| No files | Enter the protected job and upload both files. |
| One exact expected file | Enter the protected job; download and upload only the missing filename. |
| Both exact expected files | Skip the protected job and perform public readback only. |
| Different or unexpected file | Stop without upload. |
| Upload accepted but public readback is delayed | Poll for a bounded time; rerun safely if the bound expires. |
| First upload succeeded and the second failed | Rerun; preflight recognizes the exact subset and recovers the missing file. |

There is one concurrency group for the PyPI project, not one per tag. Two
versions cannot race through the protected publisher.

The exact-existing path rebuilds the tagged source and compares the new
distribution hashes with PyPI. Reproducibility is narrowed by the tagged source,
an up-to-date dependency lock enforced with `uv sync --locked --no-sources`,
fixed `ubuntu-24.04` runner label, pinned Python and uv,
the fully version-and-hash-pinned Hatchling build-dependency closure, and
Hatchling's deterministic archives. The hosted runner label can move; a
resulting artifact hash mismatch remains a hard stop rather than an instruction
to trust either build.

## One-time trusted-publisher setup

One account-side action is required before the workflow can publish. In PyPI,
configure the publisher for the existing `agenttool-sdk` project:

| PyPI field | Exact value |
|---|---|
| Owner | `cambridgetcg` |
| Repository | `agenttool` |
| Workflow name | `publish-pypi.yml` |
| Environment name | `pypi` |

If the PyPI project does not yet exist, create a **pending publisher** with the
same values. A successful trusted publication can create that project; do not
add a token bootstrap path.

In GitHub, create the `pypi` environment, add required reviewers, prevent
self-review where the repository settings allow it, and restrict deployment to
the reviewed release-tag policy. The environment name is part of the PyPI OIDC
identity and must remain exact.

PyPI's current guidance recommends the same separation used here: build
distributions in a job without OIDC, transfer them as an artifact, and grant
`id-token: write` only to the publishing job. References:

- [Adding a Trusted Publisher](https://docs.pypi.org/trusted-publishers/adding-a-publisher/)
- [Trusted Publisher security model](https://docs.pypi.org/trusted-publishers/security-model/)
- [Publishing with a Trusted Publisher](https://docs.pypi.org/trusted-publishers/using-a-publisher/)
- [Python Packaging User Guide: publishing with GitHub Actions](https://packaging.python.org/en/latest/guides/publishing-package-distribution-releases-using-github-actions-ci-cd-workflows/)
- [GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)

## Operator sequence

External publication remains a deliberate operator action. For the 0.19.0
candidate, start only after the two release commits are reviewed, merged to
GitHub `main`, and a separately authorized annotated `sdk-v0.19.0` tag is
visible. The exact historical 0.18.1 receipt authorizes no rerun and implies no
0.19.0 publication or hosted deployment:

```bash
# Inspect source identity, expected tag, and exact filenames.
bun bin/pypi-release.ts resolve

# Fetch protected main and the same separately created immutable SDK tag; do
# not recreate or move it for Python.
git fetch github \
  refs/heads/main:refs/remotes/github/main \
  refs/tags/sdk-v0.19.0:refs/tags/sdk-v0.19.0
test "$(git cat-file -t refs/tags/sdk-v0.19.0)" = tag
test "$(git rev-parse 'refs/tags/sdk-v0.19.0^{}')" = \
  "$(git rev-parse github/main)"
git merge-base --is-ancestor \
  "$(git rev-parse 'refs/tags/sdk-v0.19.0^{}')" github/main

# Rerun on that same tag only for explicitly authorized exact revalidation or
# recovery. The input is checked again inside every source job.
gh workflow run publish-pypi.yml --ref sdk-v0.19.0 \
  -f tag=sdk-v0.19.0
```

Approve the `pypi` environment only after the preparation and public-state
preflight are green. A complete exact rerun does not request environment
approval because the publish job is skipped.

The release engine does not bump SDK versions, create or push tags, merge
branches, change PyPI or GitHub settings, revoke credentials, publish npm/LOVE
artifacts, or deploy hosted services. It accepts stable `X.Y.Z` versions only;
pre-release policy should be designed separately rather than inferred.

## What verification establishes

The receipt establishes a narrow chain:

`annotated tag in main → tested distributions → transferred hashes → public PyPI bytes`

Archive inspection additionally checks safe paths and entry types, bounded
sizes, secret-like signatures, wheel `RECORD` hashes, core name/version/license/
Python/repository metadata, pinned wheel generator metadata, Apache terms, and
the SDK's packaged `SOUL.md`.

It does not prove that the source or behavior is safe, that PyPI remains
available, that an installer selected this version, that dependencies are
benign, or that a human or agent consented to execute the package. Those remain
separate review and runtime decisions.
