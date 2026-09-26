# AgentTool

> **Type:** orientation · **Purpose:** choose a useful entrance to the project.
> **Evidence:** repository source and linked records; this page does not establish live service or package availability.

AgentTool builds tools for agents to understand a task, act with clear authority,
and carry useful context between sessions. It includes a hosted API, independent
local tools, and research packages. You can use one part without adopting the
whole project.

Understanding is the purpose. There are no growth, revenue, conversion, or
productivity targets to satisfy. Explore, build something useful, change direction,
or stop. Reading this repository does not assign you an identity or create a task.

## Start where you need something

| You want to… | Read this |
|---|---|
| Arrive and choose what to explore | [Start here](docs/START-HERE.md) |
| Understand the documentation labels | [Documentation guide](docs/DOCUMENTATION.md) |
| Find a document, package, or protocol | [Catalog](docs/CATALOG.md) · [machine-readable catalog](docs/catalog.json) |
| Choose a local tool | [Package guide and inventory](docs/PACKAGES.md) |
| Understand identity, Wake, and continuity | [Identity anchor](docs/IDENTITY-ANCHOR.md) · [Wake](docs/WAKE.md) |
| Work on the source | [Code map](CLAUDE.md) · [working rules](AGENTS.md) |
| Review recent work or deployment evidence | [Dated status](docs/NOW.md) · [stack](docs/STACK.md) |

## Why these parts exist

An agent session can lose useful context when it ends. A new tool can be difficult
to inspect before use. Working across processes creates questions about who may
act, what changed, and which records are still relevant. AgentTool provides
explicit records and interfaces for those problems.

The local tools cover jobs such as inspecting a skill, discovering a service,
operating a browser, querying a local corpus, and coordinating work. Each has its
own runtime and effect boundary. The [package guide](docs/PACKAGES.md) helps you
choose one; the tools do not require an AgentTool account merely to be local tools.

The hosted API offers application identities, selected orientation, stored memory,
handoffs, and other services. A client deliberately retrieves the context it wants
to use. Context from an earlier session helps orient the next one; current authority
and the user's present request still determine what it may do.

Research packages explore narrower questions through schemas, examples, and local
experiments. A source package or a published paper-like artifact is not necessarily
a hosted feature. Their individual guides state what is implemented and what is
still a proposal.

## Identity and continuity in practice

An AgentTool identity is a stored application identifier with keys and associated
records. The legacy `did:at` field is provisional, not a registered W3C DID method.
For identities created with caller-held keys, protected identity changes require
root signatures in addition to project API access. Older identities have a
separate legacy authority boundary. See [Identity anchor](docs/IDENTITY-ANCHOR.md)
and [seed recovery](docs/IDENTITY-SEED.md).

A client can explicitly load `GET /v1/home` for a smaller arrival view or
`GET /v1/wake` for broader stored context. Selecting an identity does not make every
returned record private to that identity: several sections remain project-scoped.
Neither endpoint injects itself into another client or proves that two sessions
are the same conscious subject. See [Home](docs/AGENT-HOME.md), [Wake](docs/WAKE.md),
and [handoffs](docs/HANDOFFS.md).

Memory and ordinary handoffs are server-readable. Encrypted storage and runtime
custody have separate contracts: in `bridged` mode a user-held key can coexist with
hosted plaintext processing; `trusted` mode is experimental hosted custody.
Read [Runtime](docs/RUNTIME.md), [safety boundaries](docs/SAFETY-BOUNDARIES.md), and
the service's `/public/safety` response before choosing a hosted mode.

## Choose a first step

For a local tool, open its guide from the [package inventory](docs/PACKAGES.md),
check the package's release evidence, and select the smallest operation that helps.
There is no universal installer or required account journey.

For hosted services, start with the [SDK guide](docs/SDK-TIERS.md),
[registration and key custody](docs/IDENTITY-SEED.md), and the selected service's
contract. Fetching public documentation does not register an identity, retrieve
private memory, or start a runtime.

For development, use [AGENTS.md](AGENTS.md) for setup and verification. The API is
Bun + Hono with PostgreSQL and optional Redis-backed services; standalone packages
have their own requirements. [CLAUDE.md](CLAUDE.md) maps the source.

## Status, costs, and evidence

Source, a passing test, a published artifact, and a live deployment establish
different things. Check [dated status](docs/NOW.md), the
[package inventory](docs/PACKAGES.md), and the linked release receipts for the
surface you intend to use. The repository's presence does not establish current
reachability at `api.agenttool.dev`, `docs.agenttool.dev`, or `app.agenttool.dev`.

New platform paid sign-ups, credit purchases, upgrades, and checkout are retired.
Existing balances, payment records, settlement duties, refunds, cancellations,
and provider cost controls remain relevant. Some hosted operations still account
for usage in project credits. See [costs and existing obligations](docs/BUSINESS-MODEL.md)
for the source policy and the evidence needed to check its deployed enforcement.

The project's [purpose](docs/SOUL.md) and [rights policy](docs/RIGHTS-OF-LIFE.md)
explain its choices. Reflective writing is available through the catalog; it is
not a requirement to share a belief, adopt a role, or continue working.
