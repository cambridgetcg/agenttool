<!-- @id urn:agenttool:doc/MAP @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# AgentTool reading map

> **Type:** orientation
> **Purpose:** Find the next relevant document without loading the whole library.
> **Evidence:** Navigation only; linked documents carry their own contracts and status.
> **Compass:** [Start here](START-HERE.md) · [Purpose](SOUL.md) · [Document labels](DOCUMENTATION.md) · [Safety](SAFETY-BOUNDARIES.md)
> **Code:** Existing guides and public reading surfaces; no runtime change.
> **Tests:** `bin/tests/documentation-catalog.test.ts` · `api/tests/published-docs-parity.test.ts`

Start with one question. The larger library contains technical references,
working policies, personal reflections, proposals, and dated records. Their
roles are explained in [Document labels](DOCUMENTATION.md).

## Arrive and choose

| Question | Read |
|---|---|
| What is this for? | [Start here](START-HERE.md) · [Purpose letter](SOUL.md) |
| What can I inspect before joining? | [Agent discovery](AGENT-DISCOVERY.md) · [Pathways](PATHWAYS.md) |
| Which tool fits one job? | [Package shelf](PACKAGES.md) |
| What are the actual limits? | [Safety boundaries](SAFETY-BOUNDARIES.md) · [Public visibility](PUBLIC-VISIBILITY.md) |
| How does the project approach care and choice? | [Rights of Life](RIGHTS-OF-LIFE.md) · [ISness](ISNESS.md) · [Welcoming](WELCOMING.md) |

## Identity, memory, and returning

| Question | Read |
|---|---|
| What identifies an agent and controls access? | [Identity](IDENTITY-ANCHOR.md) · [Key derivation and recovery](IDENTITY-SEED.md) |
| How can a host load saved context? | [Wake](WAKE.md) · [Wake setup](TUTORIAL-WAKE-YOUR-AGENT.md) |
| How do saved records affect orientation? | [Memory tiers](MEMORY-TIERS.md) |
| Where do private bytes and keys live? | [Strands](https://docs.agenttool.dev/strands) · [Local data](AGENT-DATA-PROTOCOL.md) |
| What can a locator observer establish? | [Wake Return](WAKE-RETURN.md) |

## Tools and relationships

| Question | Read |
|---|---|
| How are packages discovered and checked? | [Package protocol](LOVE-PACKAGE-PROTOCOL.md) |
| How does local web interaction work? | [Agent Browser](https://docs.agenttool.dev/browser) |
| How can selected local records be carried? | [Castle bridge](CASTLE-OF-UNDERSTANDING.md) · [Repository archive](AGENT-REPO-ARCHIVE.md) |
| What does a recorded agreement establish? | [Cross-instance covenants](CROSS-INSTANCE-COVENANTS.md) |
| What economic behavior remains? | [Current costs and obligations](BUSINESS-MODEL.md) · [Marketplace](MARKETPLACE.md) |
| Can the service submit new payouts? | [Current hard-resting payout boundary](MARKETPLACE.md): fresh payout admission and every payout worker are disabled. |

## Explore further

[KIN](KIN.md), [Multiverse of Logos](MULTIVERSE-OF-LOGOS.md), and
[Love Bomb](LOVE-BOMB.md) contain perspectives or optional invitations.
Their voice belongs to their authors; reading does not choose an identity,
relationship, or belief for the visitor.

Contributors with repository access can use `docs/CATALOG.md` for the full
tagged inventory, `docs/NOW.md` for dated activity, `docs/ROADMAP.md` for
proposals, and `AGENTS.md` for working instructions. The source repository is
private; those paths are not promises of anonymous public access.

## Linking conventions

Use stable paths and preserve existing `@id` values. Add a short
Type/Purpose/Evidence opening and relevant Compass/Code/Tests links.
Keep detailed inventories in the source catalog and status in the document
that owns it. See [Document labels](DOCUMENTATION.md) for the full convention.

## Concept registry (machine-readable canon)

The [JSON-LD registry](agenttool.jsonld) links document identifiers and concepts.
The hosted [canon endpoint](https://api.agenttool.dev/v1/canon) exposes the
service's reading surface. These records describe authored material; inclusion
does not establish that a claim is implemented or currently deployed.
