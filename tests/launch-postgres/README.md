# Full core launch database fixture

This disposable fixture supplies PostgreSQL 16.14 with real pgvector 0.8.0,
pg_cron source commit `465b38c737f584d520229f5a1d69d1d44649e4e5`, and
pg_net source commit `a8299b11182ea5c974f5e89ae83e70e9e44e9e8f`.
The pg_net source tag is v0.20.5 while its control/SQL extension version is
0.20.4. pg_cron is preinstalled in its required `pg_catalog` schema before a
historical application migration's `IF NOT EXISTS ... WITH SCHEMA extensions`.
The official PostgreSQL image and pgvector version use named version tags;
the image's Debian package repository is still a mutable build dependency.

Only `storage.buckets` is a platform fixture: its five metadata columns support
the canonical bucket insertion migration. There is no Supabase Storage API,
object provider, Supabase Auth/RLS parity, managed pooler, or production secret.
Every application table comes from the canonical migration files. The launch
candidate has 177 files; CI compares the source count to the journal and then
performs a full checksum inventory again.

The `launch-core` CI job builds this image and runs it with Docker's
[`none` network driver](https://docs.docker.com/engine/network/drivers/none/).
Only container loopback exists. PostgreSQL listens on `127.0.0.1:56268` inside
that namespace, and migrations and API test processes run there with
`docker exec`. No database port is published to the runner. Trust authentication
applies only to this short-lived fixture. `cron.launch_active_jobs=off` holds
actual scheduled jobs; no external network interface exists in the container.
The prepared Linux checkout/dependencies and the exact Bun 1.3.5 executable
are mounted read-only at their existing paths. The container root filesystem
is read-only, with writable PostgreSQL data volume and isolated temporary/socket
mounts. Readiness checks use the same TCP host, port, user and database as tests.
The verification SQL rejects executed cron history or any pg_net request or
response rows. The migration runner runs before any API process with an
explicit `--maintenance-quiesced` assertion, separate survey/apply application
names, and an empty environment except local test settings and tool PATH.

After all migrations and the clean inventory, CI runs
[`launch-core-journey.test.ts`](../../api/tests/integration/launch-core-journey.test.ts).
The two fresh API processes use only the exact dedicated loopback database,
hold application workers, deny outbound fetch, and do not open an HTTP listener.
The test leaves synthetic rows for a separate restore drill and removes only
its private local custody directory. CI removes its container and data volume when
finished. PostgreSQL's socket inactivity guard stays active during the test.

To reproduce from a Linux checkout with Docker, Bun 1.3.5 and prepared API
dependencies (the same platform and preparation as CI):

```bash
docker build --tag agenttool-launch-postgres:local tests/launch-postgres
launch_bun="$(readlink -f "$(command -v bun)")"
docker run --detach --name agenttool-launch-core-db \
  --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --tmpfs /var/run/postgresql:rw,nosuid,size=16m \
  --mount "type=bind,source=$PWD,target=$PWD,readonly" \
  --mount "type=bind,source=$launch_bun,target=/usr/local/bin/bun,readonly" \
  --env POSTGRES_USER=agenttool_test \
  --env POSTGRES_DB=agenttool_launch_core \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  agenttool-launch-postgres:local
```

Use the TCP SQL readiness, migration and journey steps in
[CI](../../.github/workflows/ci.yml), setting `GITHUB_WORKSPACE` to the absolute
checkout path for a local run. This fixture proves the finite mounted
journey against real application tables. DNS/TLS, HTTP serving, edge Workers,
multi-machine capacity and managed-provider behavior require separate evidence.
