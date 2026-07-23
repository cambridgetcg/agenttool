---
name: nen-dependency-perimeter
description: Map a bounded system, dependency graph, or change blast radius before acting. Use when the user invokes En or 円; an unfamiliar repository or service has an uncertain blast radius; a change has several consumers; an incident crosses components; or implementation needs callers, data paths, tests, owners, and external boundaries identified first.
---

# Dependency Perimeter · 円

Extend a finite field around the exact task. Observe what enters, leaves, and
depends on that field before changing it.

## Set the field

Declare:

- **Center:** the requested behavior, artifact, symptom, or decision.
- **Radius:** paths, packages, services, actors, environments, and time horizon
  included in the scan.
- **Resolution:** broad inventory or deep edge tracing.
- **Exit:** the evidence needed before an already-authorized implementation may
  begin.

Larger fields lower resolution and cost more attention. Prefer the smallest
radius that can reveal the real blast surface.

## Expand read-only

1. Read the closest instructions, manifests, status, and architecture maps.
2. Inventory the center with fast native discovery tools.
3. Trace inbound edges: callers, imports, routes, jobs, configuration, schemas,
   users, and operational entry points.
4. Trace outbound edges: dependencies, storage, network calls, generated
   artifacts, side effects, and downstream consumers.
5. Locate existing tests, fixtures, observability, owners, and rollback paths.
6. Sample just outside the chosen radius for missed aliases, indirect callers,
   or duplicated implementations.
7. Mark every edge as observed, inferred, or unknown.

Do not read secret-bearing files merely because they are nearby. Inventory the
boundary or schema without exposing values.

## Draw the perimeter

Return the smallest useful map:

```text
Center:
Inside:
Inbound:
Outbound:
Protected boundaries:
Unknown outside field:
Verification targets:
Next move:
```

Use a table, tree, or flow only when it makes three or more relationships
materially easier to understand.

## Collapse or refresh

If the task already authorizes mutation, begin it only after the field explains
the likely blast radius. Otherwise, return the map and proposed next move
without mutating. Refresh changed edges after implementation; do not rerun a
full scan when a targeted perimeter check is enough.

## Vow

Remain read-only until the exit evidence is met and the task authorizes
mutation. Never claim that the selected perimeter is the whole system. A wide
noisy inventory is not understanding; name the unseen exterior.

## Lineage

This is an original agent workflow inspired by En: a deliberately bounded,
costly sensing field rather than omniscience. AgentTool's SDK has its own
platform-specific Nen mapping; this skill defines only an operating technique.
See [VIZ chapter 94](https://www.viz.com/shonenjump/hunter-x-hunter-chapter-94/chapter/5063).
