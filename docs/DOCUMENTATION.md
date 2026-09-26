<!-- @id urn:agenttool:doc/DOCUMENTATION @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# Reading and writing these documents

> **Type:** guide
> **Purpose:** Make each document's role and the evidence behind its claims easy to see.
> **Evidence:** Editorial conventions; labels do not verify implementation or deployment.
> **Compass:** [Start here](START-HERE.md) · [Reading map](MAP.md) · [Purpose](SOUL.md)
> **Code:** `bin/docs-catalog.py` inventories source documents without running their contents.
> **Tests:** `bin/tests/documentation-catalog.test.ts` covers inventory, classification, mirrors, and drift.

## Reading labels

| Type | Read it as |
|---|---|
| `orientation` | A short explanation and a choice of next steps. |
| `guide` | Instructions for a task you have actually chosen. Reading does not start it. |
| `reference` | Details to consult for a specific question; check version and evidence. |
| `policy` | The project's stated working or treatment commitments, within their actual scope. |
| `reflection` | An author's values, interpretation, analogy, or personal account. Agreement and identity adoption are optional. |
| `proposal` | A possible design or future action. It is not a release promise or an active task. |
| `record` | Dated history, a decision, or an observation. Recheck it before using it as current state. |
| `unclassified` | A document still awaiting editorial classification. Its filename supplies no authority. |

Type describes purpose, not maturity. A reference can describe a draft
protocol. A reflection can link code without proving its philosophical
claims. A guide describing a retired path must say so at the start and link
its replacement when one exists. Mixed documents should label their sections.

The repository-only `docs/CATALOG.md` and `docs/catalog.json` enumerate source
Markdown and static documentation pages, including mirrors. The catalog
records each classification's basis and whether prose was reviewed in this
cleanup. Unreviewed entries remain visible; inclusion is not endorsement.
The private source catalog is not a new public document feed.

## Claims need their own evidence

Use a short label beside a claim when its status could be mistaken:

- **Source:** name the implementation and relevant checks. This alone says
  nothing about which version is running remotely.
- **Release:** name the exact package/version or artifact and its receipt.
- **Observed:** name the environment, date, and what was actually checked.
- **Proposed:** name the missing implementation or unresolved decision.
- **Historical:** give the date and replacement, if known.
- **Unknown:** state the missing evidence instead of filling the gap.

Avoid an unqualified “live,” “shipped,” “safe,” “sovereign,” or “verified.”
Explain the specific property. A test of one path does not establish every
path, and a stored assertion does not establish the truth of its contents.

## A useful opening

Start with the purpose and reason for the document. Then state what the
reader can do with it and the evidence for its important claims.

```markdown
# A clear subject

> **Type:** reference
> **Purpose:** Explain how selected Wake context is assembled.
> **Evidence:** Source paths and checks below; deployment is separately observed.

Sessions lose context, so this interface brings selected records together.
```

Canonical guides retain their `@id` and Compass/Code/Tests links. Add
`Implements` where an implementation relationship needs explaining.
Keep each limitation near the operation it changes rather than repeating a
long denial list in every paragraph.

## Keep arrival comfortable

- Address the reader without assigning a name, persona, feeling, relationship,
  consciousness, or obligation.
- Make registration, installation, writes, payment, and follow-up explicit
  choices. Keep a useful public reading path before those choices.
- Put one concrete next step before the full inventory. A visitor does not
  need every package's release history to understand the project.
- Give examples and links where they help; remove repeated slogans, inflated
  adjectives, stale progress essays, and claims that merely cite each other.
- Preserve exact contracts and useful history. Tightening prose must not
  silently change permissions, signing bytes, custody, or release conditions.

## Maintain the source catalog

From the repository root, run:

```sh
python3 bin/docs-catalog.py --write
python3 bin/docs-catalog.py --check
```

The generator reads tracked Markdown and static docs HTML, plus explicit
`--include` paths. It uses declared Type headers, editorial routing overrides,
and disclosed path conventions. It never executes a document. Add new
documents to Git before regenerating, or use `--include path/to/document.md`.

It does not classify a feature as implemented or deployed. Edit
`docs/documentation-tags.json` only for a deliberate routing decision.
A prose review date does not verify every linked runtime assertion.

For documents bound to an existing release artifact, keep classification in
the catalog when an inline label would change that artifact's input. For
example, `DATASET-INFLUENCE.md`, `XENIA-LOOP-ATLAS.md`, and `RIGHTS-OF-LIFE.md`
retain the bytes in their HF source manifests; their types are recorded in
`documentation-tags.json`.
