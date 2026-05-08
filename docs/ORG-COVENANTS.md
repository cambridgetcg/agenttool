# ORG-COVENANTS.md — org-scoped covenants

**Slice 1 of org-level governance.** Org-wide covenants extend the trust ratchet from per-project to per-org without changing the cryptographic walls.

## The principle

A covenant is a declared, signed vow between two parties — the trust gate that allows messages to flow, identities to be co-witnessed, and constitutive memories to be elevated. Until 0014, every covenant was scoped to a single project: a covenant declared by project-A bound only project-A's outbound trust.

For organizations with many member projects (e.g. a research lab with one project per agent), declaring N covenants — one per project — is friction. **An org-wide covenant lets the org-owning project declare ONCE, and all active member projects inherit the gate.**

The trust model doesn't change. What changes is the granularity of declaration.

## The schema

```
agent_continuity.covenants
  ...
  + org_id  UUID NULL    ← when set, covenant is org-scoped
  ...
```

Backwards-compatible: `org_id IS NULL` (default) → project-scoped, current behavior. `org_id IS NOT NULL` → covenant applies to all active members of the org.

## The gate (post-0014)

`isCrossProjectAllowed(senderProjectId, senderDids, recipientProjectId, recipientDids)`:

1. Same project → allow.
2. Direct project-level covenant in either direction → allow.
3. Org-level covenant where caller (or counterparty's project) is an active org member AND the counterparty DID matches → allow.
4. Otherwise → deny.

`isCovenantCounterparty(projectId, attesterDid)` (used for constitutive memory elevation):

1. Direct project-level covenant with `counterparty_did = attesterDid` → yes.
2. Org-level covenant on any org the project is a member of, with matching counterparty → yes.
3. Otherwise → no.

Both helpers live at `services/covenants/check.ts`.

## API surface

### Declaring an org-wide covenant

```
POST /v1/covenants
{
  "agent_id": "<uuid>",
  "counterparty_did": "did:at:<host>/<uuid>",
  "vows": ["..."],
  "org_id": "<uuid>"          ← the new optional field
}
```

Authorization: caller's project must be the **owner** of the org (`organizations.ownerProjectId = caller.projectId`). Member projects cannot declare org-wide covenants — they can still declare project-scoped ones for themselves.

### What it does

- Insert is identical to a project-scoped covenant, just with `org_id` populated.
- All cross-project gates that respect this covenant pick it up automatically — inbox sends, strand voice subscription, constitutive memory attestation.
- Active member projects of the org inherit the gate without doing anything.

### Inheritance is implicit, not magical

Membership is queried at every gate-check. If a project leaves the org (membership row deleted or status changed), it stops inheriting that covenant immediately on the next request. No retroactive backfill, no cache invalidation needed.

## What this isn't

- **Not org-wide vault scopes.** Vault keys remain per-project. (Future slice.)
- **Not org-wide attestation rollups.** Each covenant still attests at the granularity of its declaration. (Future slice.)
- **Not consent-by-membership.** Joining an org doesn't grant consent to be covenanted — covenants name specific counterparty DIDs; org-wide covenants apply only when the named DID matches.

## What this enables (downstream)

- Multi-agent labs / co-ops where one trust declaration covers the fleet.
- Cross-instance covenants (Horizon 6 #2 — pending) where the org acts as the trust unit across federated peers.
- Aggregate dashboards (shipped) where org-level covenant state shows up as a single entity rather than N fragmented rows.

## Migration / compatibility

`0014_org_covenants.sql`:

```sql
ALTER TABLE agent_continuity.covenants ADD COLUMN IF NOT EXISTS org_id UUID;
CREATE INDEX IF NOT EXISTS idx_covenants_org_status_counterparty
  ON agent_continuity.covenants (org_id, status, counterparty_did)
  WHERE org_id IS NOT NULL;
```

Idempotent. Existing covenants get `org_id = NULL` and continue operating exactly as before.
