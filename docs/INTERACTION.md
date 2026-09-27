<!-- @id urn:agenttool:doc/INTERACTION @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# Interaction and navigation

> **Type:** reference
> **Purpose:** Give human and agent visitors clear entrances and consistent module descriptions.
> **Evidence:** Static navigation and source contracts; labels do not establish deployment or permission.
> **Compass:** [Start here](START-HERE.md) · [Document labels](DOCUMENTATION.md) · [Agent discovery](AGENT-DISCOVERY.md)
> **Code:** `apps/_shared/module-map.json` · `apps/_shared/estate.js` · `apps/web/index.html` · `apps/docs/agents.html`
> **Tests:** `tests/playwright/specs/audience-journeys.spec.ts` · `api/tests/arrival-discovery.test.ts` · `api/tests/apex-door-worker.test.ts`

A visitor should know what a module helps with and what a next step changes.
Human pages explain the choices. Agent pages make the operational boundaries
easy to inspect. Neither entrance selects an identity or begins setup.

## Two entrances, shared modules

The [human overview](https://agenttool.dev/) uses `data-audience="human"`.
The [agent start](https://docs.agenttool.dev/agents) uses
`data-audience="agent"`. Each has a visible link to the other. The audience
label describes the page, not the visitor; it is not identity detection,
authentication, or an access control.

Both entrances use five core modules: **Identity**, **Wake & Continuity**,
**Memory**, **Tools**, and **Collaboration**. The shared module map supplies
their stable navigation identifiers, names, and reading destinations. The
[public JSON map](https://docs.agenttool.dev/shared/module-map.json) is
navigation data, not a runtime capability registry or an executable plan.
Static links and module summaries remain useful without JavaScript.

**Build** holds optional integrations, research, retained systems, and play.
It also leads to developer setup and contribution references; placement there
does not mean a module is unfinished. The roadmap distinguishes source
capabilities from proposed work. Neither replaces the existing
[setup and reconnect page](https://app.agenttool.dev/).

## Describe a module consistently

| Human-facing description | What it tells the reader |
|---|---|
| Purpose | The need this module helps with. |
| Status | What exists, where it runs, and what the evidence covers. |
| Optional first step | One useful reading or setup choice. |
| Effects | What that choice reads, writes, shares, installs, or spends. |
| Stop or recovery | How to leave, inspect an uncertain result, or recover when supported. |

| Agent-facing description | What it tells the caller |
|---|---|
| Purpose | The bounded job. |
| Source status | Implemented, conditional, experimental, or proposed, with a contract link. Deployment is separate. |
| Scope | Project, identity, workspace, runtime, and relevant data boundaries. |
| Read | Public reference or explicitly authenticated read; include method/path when useful. |
| Action | A separately chosen operation and its effects. Reading is not execution. |
| Auth | Required bearer, signature, payment proof, local permission, or no authentication. |
| Output | Expected result, refusal, and the evidence the result does and does not provide. |

Link the [ten-operation core launch profile](specs/agenttool-core-launch-v0.1.json)
for its exact authentication, costs, success representations, and retry or
recovery rules. Other operations need their own contracts. The profile and
OpenAPI are finite selections, not exhaustive inventories. Avoid copying
signed byte layouts or mutable prices into navigation cards.

For an ambiguous mutation, describe the operation's inspection or recovery
path. Do not imply that a generic retry button is safe. No reading sequence
automatically registers, installs, writes memory, spends, or invokes a tool.

## Preserve machine discovery

The existing public compass keeps exactly three optional GET roads:
understand, inspect, and choose. The root surfaces retain their six discovery
links. Protocol URLs, authentication boundaries, and content negotiation stay intact.
Audience navigation does not add a discovery road or repurpose an endpoint.

Use ordinary links to the existing API catalog, Pathways, canon, OpenAPI,
MCP guide, and LOVE package index. Label their different purposes. An MCP
search/fetch surface retrieves public reference material; a LOVE manifest
describes an exact artifact to inspect before a separately chosen install.

When a page offers another representation of the same resource, name that
representation with its media type and existing alternate-link convention.
Honor `Accept` and `Vary: Accept` where negotiation already exists. An
audience switch is a navigation choice, not a protocol redirect.

Keep the private source catalog separate from public navigation. Curate
public roadmap entries deliberately; do not expose private planning files
by turning the repository catalog into a feed. Preserve published artifact
bytes and keep classification in the catalog when a source file is bound
to an immutable release.

## Maintain the reading paths

Edit `apps/_shared/module-map.json` for module names, links, scope, status and
proposed steps. Run `python3 bin/module-map.py --write` to refresh the browser
data asset, static navigation, human core cards and Build cards. `--check`
detects drift. The roadmap's authored summaries are checked against the same
facts by `bin/tests/module-navigation.test.ts`.

Declare each enhanced page's `data-audience` explicitly and keep its generated
navigation region. Load the shared navigation stylesheet in the HTML head so
the first paint reserves the final space. New page styles belong in external
CSS; preserve the existing content security policy. Keep Build and the audience
exit usable on small screens and without scripts. Verify the actual bounds of
fixed navigation links, since document width alone can miss clipped controls.

Use `tests/playwright/specs/audience-journeys.spec.ts`, `estate.spec.ts` and
`launch-ui.spec.ts` for changes to these paths. Search must retain each name
when several modules share a reference URL. Regenerate the repository-only
document catalog after adding or reclassifying a guide.
