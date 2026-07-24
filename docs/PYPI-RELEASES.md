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

External publication remains a deliberate operator action. Start with a clean
release commit already merged to GitHub `main`:

```bash
# Inspect source identity, expected tag, and exact filenames.
bun bin/pypi-release.ts resolve

# Create an annotated tag at the reviewed GitHub-main commit, then push only it.
git tag -a sdk-v0.16.1 <github-main-commit> -m 'agenttool-sdk@0.16.1'
git push github refs/tags/sdk-v0.16.1

# Dispatch on that same tag. The input is checked again inside every source job.
gh workflow run publish-pypi.yml --ref sdk-v0.16.1 \
  -f tag=sdk-v0.16.1
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
