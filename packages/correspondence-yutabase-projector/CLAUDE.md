# Correspondence → YUTABASE projector

This package is a private, local-development executor. It is not publishable,
not an API service, and not a YUTABASE Core migration.

- Keep `@agenttool/correspondence-yutabase` pure. Persistence belongs here.
- Refuse non-loopback source and target endpoints without an override.
- `install` may use a local administrator to create the one NOLOGIN
  `agenttool_yutabase_projector` capability role and package-owned schema.
  `run-once` and `status` must use a separate LOGIN role that is a direct
  member of that capability role.
- Refuse a runtime login that is privileged, owns protected objects, inherits
  unexpected effective rights, or can mutate YUTABASE registry/lexicon state,
  sever threads, truncate tables, or rewrite immutable projection evidence.
- Never persist or log bearer tokens, database URLs, signatures, public keys,
  event bodies, summaries, paths, branches, handoffs, or artifact locators.
- Correspondence remains authoritative. This projection is rebuildable and
  has no permission or automatic-action effect.
- Verify the closed wire record, content address, and Ed25519 signature before
  planning or writing semantic state.
- Apply one record per transaction. Semantic writes, the applied-event receipt,
  and the checkpoint advance are atomic.
- Exact replays are no-ops. Reference cards may upgrade to metadata and never
  downgrade. All other card differences and all relation identity/semantic
  differences quarantine the source scope.
- Never use `ON CONFLICT DO UPDATE` for cards or `yu.threads`.
- Quarantines contain only stable codes and fingerprints, never raw errors or
  source records.
- Do not add this package to release, deploy, API migration, or worker surfaces.
