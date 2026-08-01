# Skills WAKE continuity adapter guidance

This package is a private, pure adapter between two reviewed contracts. Keep it
thin: validate one exact `agenttool-skills-yutabase-plan/v0.1`, minimize it to a
reference-only Skills thread, then use the public AFTERGLOW API. Do not copy
AFTERGLOW capsule, predecessor, lens, disposition, canonical-ID, or WAKE logic.

The source plan must be snapshotted from own plain data properties without
invoking accessors, rebuilt through `planSkillsInspection`, and compared in
full. Claims participate in validation but never in the thread identity. Keep
project ID, claimant, recorded time, claim sources, and skill names out of the
thread. Validate the explicit `reported` / `redacted_alias` name-provenance lane
when rebuilding the source plan; it is bound by the accepted plan's selection
digest and snapshot refs but is not copied into the thread. A digest is a
reference, not proof of minimization, truth, authorship,
safety, currentness, consent, or identity.

The posture mapping is frozen together:

- `available -> carry`
- `resting -> park`
- `refused -> release`
- `withdrawn -> withdraw`

Rest has no timer or auto-resume. Refusal needs no reason and has no penalty.
Withdrawal affects future active projection but does not erase prior evidence.
Do not infer an inner state or choice authorship from any posture.

Eight Quiet Stars is display only. It accepts at most eight explicit refs from
the verified thread, sorts them, and fills fixed compass positions. It must not
select, rank, randomize, interpret Nen, recommend, persist, deliver, call a
model/network/database, or enter HEAVEN. `skip` and zero stars remain complete.

Keep the package private with exactly the two local runtime dependencies. Do
not add publish configuration, root release wiring, a CLI, install hooks,
hosted routes, persistence, API calls, or another YUTABASE deck/word/UUID.

Run `bun run ci` before reporting completion. Re-run it after either local
dependency changes. Publication, deployment, and external messages require
separate authorization and are not implied by green tests.
