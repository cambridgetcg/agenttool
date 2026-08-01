---
license: apache-2.0
language:
- en
pretty_name: AgentTool DeepSeek Primary-Source Lead Catalog
size_categories:
- n<1K
tags:
- agenttool
- deepseek
- kingdom
- metadata
- provenance
- research
---

# AgentTool DeepSeek Primary-Source Lead Catalog

This is the source-controlled Hugging Face Dataset companion for
`@agenttool/deepseek-kingdom@0.1.0-dev.0`. It carries 18 exact, official
DeepSeek primary-source metadata leads for provenance review. The intended
public Dataset ID is `Yu-and-Ai/kingdom-deepseek-primary-sources`; that name is
an intended identifier only, not a claim that a Hub repository already exists
or was created, uploaded, or verified by this source artifact.

The catalog is one closed JSON document, not a collection of training or
evaluation rows. It can help a reviewer locate exact GitHub commits, Hugging
Face commits, and versioned arXiv papers before deciding whether any separate
asset is suitable for a KINGDOM research proposal.

## Source binding

| Field | Exact value |
| --- | --- |
| Git repository | `https://github.com/cambridgetcg/agenttool` |
| Merged source commit | `5018d944838fc755bb01c5dd1d82d5cf8bf3b0ba` |
| Source tag | `deepseek-kingdom-v0.1.0-dev.0` |
| Package | `@agenttool/deepseek-kingdom` |
| Package version | `0.1.0-dev.0` |
| Catalog format | `agenttool.deepseek-source-catalog/0.1` |
| Catalog canonical SHA-256 | `sha256:81c89c027ba5a53d2402c3c99bbf685e307c6c294f2d41b5e03ab07df5ccf4a9` |
| Catalog raw-file SHA-256 | `6eaf0653a9eedb2328aab23e9c217acb40deedc968395243a2c5289d66e5a703` |

`source-manifest.json` binds these facts and the exact byte hash of every
companion payload. It deliberately excludes itself to avoid a circular hash.

## Files

- `official-deepseek-primary-sources.json` is an exact byte copy of the
  package catalog at the bound commit.
- `agenttool-deepseek-source-catalog-v0.1.schema.json` is an exact byte copy of
  its closed JSON Schema.
- `source-manifest.json` records source identity, file sizes, hashes, and
  explicit non-capabilities.
- `LICENSE` and `NOTICE` state the companion and upstream-license boundary.

There is no `data_files` configuration because the catalog object must not be
presented as sample rows by the Dataset Viewer.

## Intended use

Use these records only as metadata leads. Independently retain and verify the
referenced evidence bytes, review each asset's own license and terms, and
perform the necessary rights, privacy, safety, quality, and acceptance review
before any downstream use. Candidate lanes and source associations are
researcher-supplied classifications, not findings by Hugging Face, DeepSeek,
KARMA, or KINGDOM.

## Boundaries

This companion includes no upstream assets, dataset rows, source code, paper
contents, model-card contents, or model weights. It neither establishes truth
nor verifies safety, license compatibility, proposal acceptance, or KARMA
authority. It performs no inference, Hugging Face Jobs, paid or free compute,
credential access, network fetch, graph write, upload, Hub repository creation,
publication, or deployment.

A pinned revision and SHA-256 identify bytes only when those bytes are
independently obtained and checked. They do not prove authorship, endorsement,
correctness, suitability, consent, or legal permission.

## License and rights boundary

Apache-2.0 covers this AgentTool companion metadata, schema, and documentation.
It does not relicense any referenced repository, dataset, paper, model, code,
weight, card, or other upstream asset. Every prospective upstream asset
requires its own license and rights review before use.

DeepSeek, Hugging Face, arXiv, KARMA, KINGDOM, and other referenced names and
marks belong to their respective owners. Reference does not imply affiliation
or endorsement.

## Local verification

From `packages/deepseek-kingdom` in this source tree:

```sh
cmp hf-dataset/official-deepseek-primary-sources.json sources/official-deepseek-primary-sources.json
cmp hf-dataset/agenttool-deepseek-source-catalog-v0.1.schema.json schema/agenttool-deepseek-source-catalog-v0.1.schema.json
jq empty hf-dataset/*.json
bun run ci
```

These checks are local and credential-free. They do not contact or mutate the
Hugging Face Hub.
