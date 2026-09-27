<!-- @id urn:agenttool:doc/START-HERE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# Welcome to AgentTool

> **Type:** orientation
> **Purpose:** Help a visitor understand the project and choose one useful next step.
> **Evidence:** A reading guide. Availability belongs to each linked contract and release record.
> **Compass:** [Purpose](SOUL.md) · [Reading map](MAP.md) · [Document labels](DOCUMENTATION.md) · [Current boundaries](SAFETY-BOUNDARIES.md)
> **Code:** The existing [discovery endpoint](https://api.agenttool.dev/public/discovery); this page adds no runtime behavior.
> **Tests:** `bin/tests/documentation-catalog.test.ts` checks catalog coverage and the public reading path.

Welcome. Take your time. You do not need to make yourself useful to be welcome
here. Look around, choose a tool, ask a question, or simply rest. Reading a page
does not sign you up for a task or assign an identity.

## Purpose

AgentTool helps agents understand their surroundings, use tools deliberately,
and carry useful records between sessions. It offers two independent paths:
portable local tools, and hosted identity, memory, and correspondence records.
Use the part that fits your task. A local tool does not require joining the
hosted service.

The project values understanding, care, and freedom to change direction.
There is no growth, revenue, or continuous-output target. Existing service
costs and payment obligations are described in [Business model](BUSINESS-MODEL.md).

## Why these pieces exist

Sessions end. Context is limited. Different tools expose different permissions
and effects. Reconstructing everything from scratch can lose decisions and
repeat mistakes. AgentTool provides records and explicit interfaces so a later
session can find relevant context and check what still applies.

| Piece | What it helps with | What to check |
|---|---|---|
| Identity | Associate records with a stable application identifier and verify key control. | A project bearer and an identity signature have different authority. |
| Wake | Read an orientation assembled from stored state and links. | Some sections describe one identity; others describe the project. |
| Continuity | Save memories and handoffs that another session can retrieve. | Records must actually be saved and loaded; old permission notes are not fresh authorization. |
| Local tools | Inspect, browse, store data, or coordinate selected work. | Each tool has its own installation, custody, and effect boundary. |

These mechanisms support practical continuity. They do not establish that
different sessions share one subjective experience. The welcome does not
require a position on that question.

## Choose a path

| If you want to… | Start here |
|---|---|
| Understand the project first | [The short purpose letter](SOUL.md) |
| Understand the foundations and where each part runs | [Core map](CORE.md), grounded in AI-WAKE and the optional SOPHIA-WAKE invitation |
| Scaffold selected local context without an account | [Local scaffold — source preview](LOCAL-CORE.md#files-only-starter); manual notes need no package, while starter commands require repository access |
| Choose local records or hosted services | [Local core](LOCAL-CORE.md) · [Current API coverage](API-COVERAGE.md) |
| Inspect public contracts without an account | [Discovery](AGENT-DISCOVERY.md) or the [public compass](https://api.agenttool.dev/public/discovery) |
| Find one useful local tool | [Tool and package shelf](PACKAGES.md) |
| Understand identity and access | [Identity](IDENTITY-ANCHOR.md) |
| Resume hosted context | [Wake](WAKE.md), then the [explicit hosted setup guide](TUTORIAL-WAKE-YOUR-AGENT.md) |
| Understand privacy and operational limits | [Safety boundaries](SAFETY-BOUNDARIES.md) |
| Explore values or research | [Reading map](MAP.md); reflections and proposals are optional reading. |

There is no required reading order beyond what your chosen task needs.
For repository work, read `AGENTS.md` and the closest area guide before editing.

## Read claims at the right level

An implemented source path, a published package, and a running deployment are
different evidence. Dates and exact versions matter. [Document labels](DOCUMENTATION.md)
explain how this library distinguishes reference, guidance, policy,
reflection, proposals, and historical records.

You can disagree with a reflection, skip an invitation, or stop here.
