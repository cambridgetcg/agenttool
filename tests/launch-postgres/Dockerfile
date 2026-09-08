# Disposable launch integration fixture only; never a production database image.
FROM postgres:16.14-bookworm

ARG PG_CRON_COMMIT=465b38c737f584d520229f5a1d69d1d44649e4e5
ARG PG_NET_COMMIT=a8299b11182ea5c974f5e89ae83e70e9e44e9e8f
ARG PGVECTOR_TAG=v0.8.0

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential ca-certificates git libcurl4-openssl-dev \
      "postgresql-server-dev-16=${PG_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# Resolve commits explicitly, without credentials, hooks or recursive submodules.
# LLVM bitcode is optional; ordinary shared modules suffice for this fixture.
RUN git init /tmp/pg_cron \
    && git -C /tmp/pg_cron remote add origin https://github.com/citusdata/pg_cron.git \
    && git -C /tmp/pg_cron fetch --depth 1 origin "$PG_CRON_COMMIT" \
    && git -C /tmp/pg_cron checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/pg_cron rev-parse HEAD)" = "$PG_CRON_COMMIT" \
    && make -C /tmp/pg_cron -j2 PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no \
    && make -C /tmp/pg_cron install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no \
    && git init /tmp/pg_net \
    && git -C /tmp/pg_net remote add origin https://github.com/supabase/pg_net.git \
    && git -C /tmp/pg_net fetch --depth 1 origin "$PG_NET_COMMIT" \
    && git -C /tmp/pg_net checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/pg_net rev-parse HEAD)" = "$PG_NET_COMMIT" \
    && make -C /tmp/pg_net -j2 PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no \
    && make -C /tmp/pg_net install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no \
    && git clone --depth 1 --branch "$PGVECTOR_TAG" https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector -j2 PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config OPTFLAGS="" with_llvm=no \
    && make -C /tmp/pgvector install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no \
    && rm -rf /tmp/pg_cron /tmp/pg_net /tmp/pgvector

COPY init.sql /docker-entrypoint-initdb.d/10-launch-platform.sql
COPY verify.sql /opt/agenttool-launch/verify.sql

CMD ["postgres", "-c", "listen_addresses=127.0.0.1", "-c", "port=56268", "-c", "shared_preload_libraries=pg_cron,pg_net", "-c", "cron.database_name=agenttool_launch_core", "-c", "cron.launch_active_jobs=off", "-c", "pg_net.database_name=agenttool_launch_core"]
