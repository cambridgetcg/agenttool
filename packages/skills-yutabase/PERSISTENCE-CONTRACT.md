# Skills YUTABASE persistence contract

`planSkillsInspection()` produces rebuildable intentions, not a database
transaction. The current Correspondence YUTABASE projector is deliberately
hard-wired to a different book, namespace, deck set, lexicon, and SQL schema;
it must not be widened implicitly to apply this plan.

A future private sidecar or deliberately versioned shared projector must:

1. retain or fetch the exact upstream inspection report outside YUTABASE;
2. validate it against the pinned `@agenttool/skills` report schema;
3. recompute and compare the caller-supplied report and skill digests;
4. preserve the inspector revision as caller-supplied and unverified unless it
   independently proves the exact inspector artifact-to-revision association;
5. create the minimized input as inert JSON-shaped data, without accessors,
   proxies, bodies, paths, prose, identities, or requirement names;
6. preserve `reported` and `redacted_alias` name lanes without recovering or
   substituting concealed names;
7. call this pure planner and transactionally apply its intentions;
8. refuse conflicting existing content rather than overwrite or downgrade it;
9. record projector/version provenance and make failed runs retryable; and
10. keep source reports private unless a separate export and privacy review
   authorizes otherwise.

Apply one complete plan in one transaction. For each card, compare only its
address and typed fields, not the incoming claim header: insert an absent card;
make identical fields a no-op that retains the first accepted claim; and
quarantine any same-address/different-fields attempt without an `UPDATE` or
resurrection. For each thread, compare its ID, word, and endpoints: insert an
absent thread, retain the first claim on an exact replay, and quarantine a
same-ID/different-relation attempt. A quarantine fails the whole input
transaction.

`recorded_at`, claimant, and claim sources are intention metadata, not card or
thread identity. Replaying at another time, under another claimant, or through
a different minimized selection can legitimately give an existing skill card
a different incoming claim while keeping the same address and fields. Retain
the first accepted claim header or record later attempts in a separate receipt
lane; do not manufacture a conflicting snapshot.

Successful schema validation or digest comparison does not authenticate a
publisher, interpret a skill, establish safety or truth, grant permission or
consent, authorize action, or create a score/rank/XP/dignity effect. Changed
skill bytes create a new skill snapshot; a changed minimized selection creates
a new inspection snapshot while reusing any unchanged skill snapshots. A
changed caller-supplied inspector revision also creates a new inspection
snapshot because that caller-supplied value is external to the report bytes;
its shape does not prove Git existence or artifact association. A changed name
kind also changes selection and skill identity. After first external retention,
a profile, allowlist, field, deck, word, selection-digest framing, or identity
change requires a new planner profile and UUID namespace.
