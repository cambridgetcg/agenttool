/** A stub hosted AgentTool API for exit-door tests.
 *
 *  It serves the read routes the exporter walks, with the paging contract
 *  from the exit-door plan §1 (`page {cursor, next_cursor, has_more, limit,
 *  order}`, strands `order=created`, correspondence repositories with
 *  `after`/`next_after`). `paged: false` imitates a host without that
 *  contract: no `page` objects on memories/chronicle/strands and no
 *  `/v1/correspondence/repositories` route (404). Events keep the paging the
 *  live host already has.
 *
 *  It is a fixture, not a model of the server: it implements only what the
 *  exporter relies on and records every request so tests can assert the
 *  exporter stayed GET-only and never touched side-effecting reads. */

export interface HostedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
}

export interface HostedFakeOptions {
  /** Serve the keyset contract (Track A). */
  paged: boolean;
  /** Cap every cursor page at this many rows to force multi-page walks. */
  maxPage?: number;
  /** Row cap of the thoughts route (the live host clamps to 500). */
  thoughtsCap?: number;
  /** Project bearer the fake accepts. */
  bearer: string;
  /** Replace the default dataset. */
  dataset?: Partial<HostedDataset>;
}

export interface HostedDataset {
  memories: Array<Record<string, unknown>>;
  chronicle: Array<Record<string, unknown>>;
  strands: Array<Record<string, unknown>>;
  thoughts: Record<string, Array<Record<string, unknown>>>;
  repositories: string[];
  events: Record<string, Array<Record<string, unknown>>>;
  covenants: Array<Record<string, unknown>>;
  identities: Array<Record<string, unknown>>;
  keys: Record<string, Array<Record<string, unknown>>>;
  secrets: Array<Record<string, unknown>>;
  backups: Array<Record<string, unknown>>;
}

export const IDENTITY_A = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const IDENTITY_B = "2e3d4c5b-6f70-4b8c-9dae-1f2a3b4c5d6e";

function uuid(n: number, prefix = "00000000"): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function defaultDataset(): HostedDataset {
  const memories = Array.from({ length: 5 }, (_, index) => ({
    id: uuid(index + 1, "aaaaaaaa"),
    type: "semantic",
    tier: "episodic",
    visibility: "private",
    key: null,
    content: `memory ${index + 1} — 日本語 "quoted"`,
    agent_id: null,
    identity_id: index % 2 === 0 ? IDENTITY_A : IDENTITY_B,
    metadata: { n: index },
    importance: 0.5,
    has_embedding: index === 0,
    created_at: `2026-10-0${index + 1}T00:00:00.000Z`,
    accessed_at: `2026-10-11T0${index}:00:00.000Z`,
    expires_at: null,
    attestations: [],
  })).reverse();
  const chronicle = Array.from({ length: 3 }, (_, index) => ({
    id: uuid(index + 1, "cccccccc"),
    type: "note",
    title: `entry ${index + 1}`,
    body: "body",
    agent_id: index === 0 ? IDENTITY_A : null,
    occurred_at: `2026-09-0${index + 1}T00:00:00.000Z`,
    created_at: `2026-09-0${index + 1}T00:00:01.000Z`,
    metadata: {},
  })).reverse();
  const strands = [
    {
      id: uuid(1, "dddddddd"),
      agent_id: null,
      identity_id: IDENTITY_A,
      parent_strand_id: null,
      topic: "dG9waWM=",
      topic_encrypted: true,
      mood: null,
      mood_encrypted: false,
      status: "active",
      importance: null,
      visibility: "private",
      last_thought_at: "2026-10-10T00:00:00.000Z",
      last_thought_seq: 3,
      next_revisit_at: null,
      state_ciphertext: null,
      state_nonce: null,
      metadata: {},
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-10-10T00:00:00.000Z",
    },
    {
      id: uuid(2, "dddddddd"),
      agent_id: null,
      identity_id: IDENTITY_B,
      parent_strand_id: null,
      topic: "plain topic",
      topic_encrypted: false,
      mood: null,
      mood_encrypted: false,
      status: "active",
      importance: null,
      visibility: "private",
      last_thought_at: null,
      last_thought_seq: 0,
      next_revisit_at: null,
      state_ciphertext: null,
      state_nonce: null,
      metadata: {},
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ];
  const thoughts: HostedDataset["thoughts"] = {
    [uuid(1, "dddddddd")]: Array.from({ length: 3 }, (_, index) => ({
      id: uuid(index + 1, "eeeeeeee"),
      strand_id: uuid(1, "dddddddd"),
      agent_id: null,
      sequence_num: index + 1,
      kind: null,
      kind_encrypted: false,
      ciphertext: `Y2lwaGVy${index}`,
      nonce: "AAECAwQFBgcICQoL",
      refs: null,
      signature: "c2ln",
      signing_key_id: uuid(9, "ffffffff"),
      created_at: `2026-09-0${index + 3}T00:00:00.000Z`,
    })),
    [uuid(2, "dddddddd")]: [],
  };
  const events: HostedDataset["events"] = {};
  for (const repository of ["repo-a", "repo-b"]) {
    events[repository] = Array.from({ length: 3 }, (_, index) => ({
      event: {
        protocol: "agent-correspondence/v0.1",
        event_id: `evt_${repository}_${index + 1}`,
        repository_id: repository,
        kind: "note",
        body: { text: `hello ${index + 1}` },
      },
      receipt: { received_seq: String(index + 1), received_at: "2026-10-05T00:00:00.000Z" },
      missing_parents: [],
      lineage_status: "not_applicable",
    }));
  }
  return {
    memories,
    chronicle,
    strands,
    thoughts,
    repositories: ["repo-a", "repo-b"],
    events,
    covenants: [
      { id: uuid(1, "c0c0c0c0"), agent_id: IDENTITY_A, status: "active", vow: "kind", created_at: "2026-08-01T00:00:00.000Z" },
      { id: uuid(2, "c0c0c0c0"), agent_id: IDENTITY_B, status: "dissolved", vow: "old", created_at: "2026-07-01T00:00:00.000Z" },
    ],
    identities: [
      { id: IDENTITY_A, did: "did:at:a", display_name: "A", status: "active", created_at: "2026-05-21T00:00:00.000Z" },
      { id: IDENTITY_B, did: "did:at:b", display_name: "B", status: "active", created_at: "2026-05-22T00:00:00.000Z" },
    ],
    keys: {
      [IDENTITY_A]: [
        { kid: uuid(1, "bbbbbbbb"), public_key: "pkA1", label: "a1", active: true, created_at: "2026-05-21T00:00:00.000Z", revoked_at: null, authority_root: true },
        { kid: uuid(2, "bbbbbbbb"), public_key: "pkA2", label: "a2", active: false, created_at: "2026-05-21T00:00:00.000Z", revoked_at: "2026-06-01T00:00:00.000Z", authority_root: false },
      ],
      [IDENTITY_B]: [
        { kid: uuid(3, "bbbbbbbb"), public_key: "pkB1", label: "b1", active: true, created_at: "2026-05-22T00:00:00.000Z", revoked_at: null, authority_root: false },
      ],
    },
    secrets: [
      { name: "openai/key", version: 1, tags: [], description: null, rotation_due: null, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
    ],
    backups: [
      { id: uuid(1, "babababa"), agentId: IDENTITY_A, label: "laptop", keyDerivation: "argon2id", createdAt: "2026-06-01T00:00:00.000Z", metadata: null },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function encodeCursor(offset: number, scope: string): string {
  return Buffer.from(JSON.stringify({ v: 1, s: scope, o: offset })).toString("base64url");
}

function decodeCursor(raw: string, scope: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return parsed.v === 1 && parsed.s === scope && Number.isSafeInteger(parsed.o) ? parsed.o : null;
  } catch {
    return null;
  }
}

export function createHostedFake(options: HostedFakeOptions) {
  const data: HostedDataset = { ...defaultDataset(), ...options.dataset };
  const calls: HostedCall[] = [];

  function cursorPage(
    rows: Array<Record<string, unknown>>,
    url: URL,
    scope: string,
    defaults: { def: number; max: number },
    itemsKey: string,
    extra: Record<string, unknown> = {},
  ): Response {
    const limitRaw = url.searchParams.get("limit");
    const requested = limitRaw === null ? defaults.def : Number.parseInt(limitRaw, 10);
    const limit = Math.min(Number.isFinite(requested) ? requested : defaults.def, defaults.max, options.maxPage ?? Infinity);
    const cursorRaw = url.searchParams.get("cursor");
    let offset = 0;
    if (cursorRaw !== null) {
      if (!options.paged) return json({ error: "cursor_invalid", message: "no cursors here" }, 400);
      const decoded = decodeCursor(cursorRaw, scope);
      if (decoded === null) return json({ error: "cursor_invalid", message: "bad cursor" }, 400);
      offset = decoded;
    }
    const slice = rows.slice(offset, offset + limit);
    const hasMore = offset + limit < rows.length;
    const body: Record<string, unknown> = {
      [itemsKey]: slice,
      count: slice.length,
      ...extra,
    };
    if (options.paged) {
      body.page = {
        cursor: cursorRaw,
        next_cursor: hasMore ? encodeCursor(offset + slice.length, scope) : null,
        has_more: hasMore,
        limit,
        order: "created_at_desc,id_desc",
      };
    }
    return json(body);
  }

  function afterPage(
    rows: Array<Record<string, unknown>>,
    position: (row: Record<string, unknown>) => string,
    url: URL,
    itemsKey: string,
    numeric: boolean,
  ): Response {
    const after = url.searchParams.get("after");
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(limitRaw === null ? 100 : Number(limitRaw), options.maxPage ?? Infinity);
    const remaining = rows.filter((row) =>
      after === null
        ? true
        : numeric
          ? BigInt(position(row)) > BigInt(after)
          : position(row) > after,
    );
    const slice = remaining.slice(0, limit);
    return json({
      protocol: "agent-correspondence/v0.1",
      scope: "project",
      [itemsKey]: slice,
      page: {
        after,
        next_after: slice.length > 0 ? position(slice.at(-1)!) : after,
        has_more: remaining.length > limit,
      },
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const call: HostedCall = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorization: request.headers.get("authorization"),
    };
    calls.push(call);
    if (call.authorization !== `Bearer ${options.bearer}`) {
      return json({ error: "unauthorized", message: "project bearer required" }, 401);
    }
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed", message: "the fake is read-only" }, 405);
    }
    const path = url.pathname;
    const asOf = "2026-10-11T09:00:00.000Z";

    if (path === "/v1/memories") {
      const identity = url.searchParams.get("identity_id");
      const rows = identity ? data.memories.filter((row) => row.identity_id === identity) : data.memories;
      return cursorPage(rows, url, "memories", { def: 20, max: 100 }, "memories", {
        as_of: asOf,
        since: null,
        since_reason: null,
      });
    }
    if (path === "/v1/chronicle") {
      const agent = url.searchParams.get("agent_id");
      const rows = agent ? data.chronicle.filter((row) => row.agent_id === agent) : data.chronicle;
      return cursorPage(rows, url, "chronicle", { def: 50, max: 200 }, "entries", {
        as_of: asOf,
        since: null,
        since_reason: null,
      });
    }
    if (path === "/v1/strands") {
      return cursorPage(data.strands, url, "strands.created", { def: 50, max: 200 }, "strands");
    }
    const thoughtMatch = /^\/v1\/strands\/([^/]+)\/thoughts$/.exec(path);
    if (thoughtMatch) {
      const strandId = decodeURIComponent(thoughtMatch[1]!);
      const since = url.searchParams.get("since_seq");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), options.thoughtsCap ?? 500);
      const rows = (data.thoughts[strandId] ?? [])
        .filter((row) => since === null || (row.sequence_num as number) > Number(since))
        .slice(0, limit);
      return json({ thoughts: rows, count: rows.length, note: "ciphertext only" });
    }
    if (path === "/v1/correspondence/repositories") {
      if (!options.paged) return json({ error: "not_found", message: "no such route" }, 404);
      const rows = data.repositories.map((repository_id) => ({
        repository_id,
        last_received_seq: String((data.events[repository_id] ?? []).length),
      }));
      return afterPage(rows, (row) => row.repository_id as string, url, "repositories", false);
    }
    if (path === "/v1/correspondence/events") {
      const repository = url.searchParams.get("repository_id") ?? "";
      const rows = data.events[repository] ?? [];
      return afterPage(
        rows,
        (row) => (row.receipt as { received_seq: string }).received_seq,
        url,
        "events",
        true,
      );
    }
    if (path === "/v1/covenants") {
      const status = url.searchParams.get("status") ?? "active";
      const agent = url.searchParams.get("agent_id");
      return json({
        covenants: data.covenants.filter(
          (row) => row.status === status && (agent === null || row.agent_id === agent),
        ),
      });
    }
    if (path === "/v1/identities") {
      return json({ identities: data.identities, count: data.identities.length });
    }
    const keysMatch = /^\/v1\/identities\/([^/]+)\/keys$/.exec(path);
    if (keysMatch) {
      const identity = decodeURIComponent(keysMatch[1]!);
      return json({ keys: data.keys[identity] ?? [], authority: { mode: "legacy_bearer", sequence: 0, next_sequence: 1 } });
    }
    if (path === "/v1/vault") return json({ secrets: data.secrets });
    if (path === "/v1/identity/backup") {
      const agent = url.searchParams.get("agent_id");
      return json({ backups: data.backups.filter((row) => agent === null || row.agentId === agent) });
    }
    return json({ error: "not_found", message: `no fake route for ${path}` }, 404);
  }

  return { handle, calls, data };
}
