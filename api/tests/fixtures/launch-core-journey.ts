/** Child-only real API harness. No application modules are imported until
 * exact database/environment guards and outbound-fetch refusal are installed.
 * The root and transport credential are separate fixture custody fields.
 * Canonical request bytes below are composed independently from server helpers.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

const target = "postgres://agenttool_test@127.0.0.1:56268/agenttool_launch_core";
const phase = process.argv[2];
const custodyFile = process.env.AGENTTOOL_LAUNCH_CORE_CUSTODY_FILE ?? "";
const evidenceFile = process.env.AGENTTOOL_LAUNCH_CORE_EVIDENCE_FILE ?? "";
function ensure(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
ensure(phase === "birth" || phase === "return", "invalid-phase");
ensure(process.env.AGENTTOOL_LAUNCH_CORE_TEST_DATABASE_URL === target &&
  process.env.DATABASE_URL === target && process.env.DATABASE_SESSION_URL === target &&
  process.env.NODE_ENV === "test" && process.env.AGENTTOOL_DISABLE_WORKERS === "1" &&
  process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP === "1" &&
  process.env.AGENTOOL_DISABLE_SAGA_SEED === "1" &&
  process.env.AGENTOOL_DISABLE_JOY_INDEX === "1" &&
  process.env.AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED === "0" &&
  !process.env.FLY_MACHINE_ID && !process.env.REDIS_URL &&
  !process.env.AGENTOOL_ENABLE_THINKER, "unsafe-environment");
ensure(basename(dirname(custodyFile)).startsWith("agenttool-launch-core-") &&
  basename(custodyFile) === "custody.json" &&
  dirname(evidenceFile) === dirname(custodyFile) && basename(evidenceFile) === "evidence.json",
  "unsafe-custody-path");

let stage = "startup", outboundFetchAttempts = 0, workerIntervals = 0, databaseGuardIntervals = 0;
const diagnostics: { method: string; path: string; status: number; error?: string }[] = [];
const quietCounts = { expected_unconfigured_deposit_warning: 0, unexpected_warnings: 0, errors: 0 };
console.log = () => {};
console.warn = (message: unknown) => {
  if (typeof message === "string" && message.startsWith("[economyConfig] deposit webhooks will REJECT for:")) {
    quietCounts.expected_unconfigured_deposit_warning += 1;
  } else quietCounts.unexpected_warnings += 1;
};
console.error = () => { quietCounts.errors += 1; };
const refuseOutbound = () => {
  outboundFetchAttempts += 1;
  throw new Error("outbound-fetch-forbidden");
};
globalThis.fetch = Object.assign(async () => refuseOutbound(), { preconnect: refuseOutbound });
const realInterval = globalThis.setInterval;
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  // The real DB client starts its socket inactivity sampler only when used.
  // Preserve that protection; it is not an autonomous application worker.
  if (new Error().stack?.includes("/src/db/guarded-socket.ts:")) databaseGuardIntervals += 1;
  else workerIntervals += 1;
  return realInterval(...args);
}) as typeof setInterval;
const hardDeadline = setTimeout(() => {
  process.stderr.write(JSON.stringify({ phase, stage, error: "harness-deadline", diagnostics }) + "\n");
  process.exit(2);
}, 50_000);

type Custody = {
  rootSeed: string; boxSeed: string; savedBeforeBirth: boolean;
  identityId?: string; did?: string; projectId?: string; bearer?: string;
  memoryId?: string; memoryContent?: string; birthCredits?: number;
};
type Json = Record<string, any>;
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest();
const text = (value: string) => Buffer.from(value, "utf8");
const separatedHash = (parts: Uint8Array[]) => sha256(Buffer.concat(parts.flatMap((part, i) => i ? [Buffer.from([0]), part] : [part])));
const b64 = (value: Uint8Array) => Buffer.from(value).toString("base64");
const vector = Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0);

try {
  const { default: postgres } = await import("../fixtures/verified-postgres");
  const sql = postgres(target, { max: 1, prepare: false, connect_timeout: 3, onnotice: () => {} });
  stage = "database-preflight";
  const [database] = await sql`SELECT current_database() AS name, current_user AS role`;
  ensure(database?.name === "agenttool_launch_core" && database?.role === "agenttool_test", "database-target-mismatch");
  const extensions = await sql`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')`;
  ensure(extensions.length === 2, "canonical-extensions-missing");
  const { app } = await import("../../src/index");
  const { redisConnection } = await import("../../src/services/tools/queue/connection");
  const { registrationRedis } = await import("../../src/services/tools/queue/admission");
  ensure(redisConnection === null && registrationRedis === null && workerIntervals === 0, "worker-boundary-failed");

  const client = (bearer?: string) => async (path: string, options: {
    method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; status?: number;
  } = {}): Promise<{ data: Json; response: Response }> => {
    stage = `${phase}:${options.method ?? "GET"}:${path.split("?")[0]}`;
    const headers = new Headers({ Accept: "application/json", "X-Play": "off", ...options.headers });
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await app.fetch(new Request(`http://127.0.0.1${path}`, {
      method: options.method ?? "GET", headers, body,
    }));
    const data = await response.json() as Json;
    const entry: typeof diagnostics[number] = { method: options.method ?? "GET", path: path.split("?")[0]!, status: response.status };
    if (typeof data.error === "string" && /^[a-z_]{1,80}$/.test(data.error)) entry.error = data.error;
    diagnostics.push(entry);
    ensure(response.status === (options.status ?? 200), "unexpected-http-status");
    return { data, response };
  };
  const anonymous = client();
  const evidence: Json = phase === "return" ? JSON.parse(await readFile(evidenceFile, "utf8")) : {
    phases: [], database: "agenttool_launch_core", transport: "real-mounted-hono-fetch",
    provider_calls: "forbidden", production_verification: "not_asserted", vector_dimensions: 1536,
  };
  let custody: Custody;

  if (phase === "birth") {
    stage = "save-root-before-birth";
    custody = { rootSeed: randomBytes(32).toString("hex"), boxSeed: randomBytes(32).toString("hex"), savedBeforeBirth: true };
    const file = await open(custodyFile, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(custody)); await file.sync(); } finally { await file.close(); }
    custody = JSON.parse(await readFile(custodyFile, "utf8"));
    ensure((await stat(custodyFile)).mode % 512 === 0o600, "custody-permissions");
    const { data: compass } = await anonymous("/public/discovery");
    ensure(compass.roads.length === 3, "discovery-three-roads");
    await anonymous("/v1/pathways");
    const { data: plans } = await anonymous("/public/plans");
    const findDifficulty = (value: any): number | undefined => {
      if (value && typeof value === "object") {
        if (typeof value.pow_difficulty_bits === "number") return value.pow_difficulty_bits;
        for (const item of Object.values(value)) { const found = findDifficulty(item); if (found !== undefined) return found; }
      }
    };
    const bits = findDifficulty(plans);
    ensure(bits === 18, "default-pow-difficulty-drift");
    const seed = Buffer.from(custody.rootSeed, "hex");
    const publicKey = ed25519.getPublicKey(seed);
    const boxKey = x25519.getPublicKey(Buffer.from(custody.boxSeed, "hex"));
    const displayName = `launch-core-${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const signed = separatedHash([
      text("register-agent/v2"), text(displayName), publicKey, boxKey, text("[]"),
      text("local-integration"), text(""), text(""), text(""), text("private"),
      text("self_service"), text(""), sha256(text("")), text(""), text(""), text(nonce), text(timestamp),
    ]);
    stage = "solve-default-pow";
    let powNonce = "";
    for (let i = 0; i < 16_777_216; i++) {
      const candidate = String(i);
      const digest = separatedHash([text("agenttool-pow/v1"), publicKey, text(displayName), text(timestamp), text(candidate)]);
      if (digest[0] === 0 && digest[1] === 0 && digest[2]! < 64) { powNonce = candidate; break; }
      if (i % 4096 === 0) ensure(Date.now() - Date.parse(timestamp) < 20_000, "pow-deadline");
    }
    ensure(powNonce.length > 0, "pow-budget-exhausted");
    const registration = {
      display_name: displayName, agent_public_key: b64(publicKey), box_public_key: b64(boxKey),
      runtime: { provider: "local-integration" }, registration_nonce: nonce,
      key_proof: { timestamp, signature: b64(ed25519.sign(signed, seed)) }, pow_nonce: powNonce,
    };
    const { data: born } = await anonymous("/v1/register/agent", { method: "POST", body: registration, status: 201 });
    ensure(born.agent.public_key === b64(publicKey) && born.agent.authority.mode === "agent_root" &&
      born.agent.authority.sequence === 0 && born.agent.authority.next_sequence === 1 &&
      typeof born.project.api_key === "string" && !JSON.stringify(born).includes(custody.rootSeed), "birth-root-contract");
    Object.assign(custody, { identityId: born.agent.id, did: born.agent.did, projectId: born.project.id,
      bearer: born.project.api_key, birthCredits: born.project.credits });
    const authenticated = client(custody.bearer);
    const { data: identities } = await authenticated("/v1/identities");
    ensure(identities.identities.length === 1 && identities.identities[0].id === custody.identityId &&
      identities.identities[0].did === custody.did, "bearer-identity-binding");
    const { data: wake } = await authenticated(`/v1/wake?identity_id=${custody.identityId}&format=json`);
    ensure(wake._scope_boundary.selected_identity_id === custody.identityId &&
      wake.you.agents.some((agent: Json) => agent.id === custody.identityId), "selected-wake-binding");
    const content = `Synthetic launch continuity ${randomUUID()}`;
    const { data: memory } = await authenticated("/v1/memories", { method: "POST", status: 201,
      body: { type: "episodic", content, embedding: vector, identity_id: custody.identityId, key: "launch-core-proof" } });
    ensure(memory.kept === true && typeof memory.id === "string", "memory-write-receipt");
    custody.memoryId = memory.id; custody.memoryContent = content;
    const { data: read } = await authenticated(`/v1/memories/${memory.id}`);
    ensure(read.content === content && read.id === memory.id && read.identity_id === custody.identityId, "memory-readback");
    const { data: recall } = await authenticated("/v1/memories/search", { method: "POST",
      body: { query_embedding: vector, identity_id: custody.identityId, min_score: 0.99, limit: 5 } });
    ensure(recall.mode === "semantic" && recall.results.some((m: Json) => m.id === memory.id && m.content === content), "vector-recall");
    const { data: replay } = await anonymous("/v1/register/agent", { method: "POST", body: registration, status: 409 });
    ensure(replay.error === "registration_proof_replayed", "birth-replay-refusal");
    const [credits] = await sql`SELECT credits FROM tools.projects WHERE id=${custody.projectId!}`;
    ensure(credits?.credits === custody.birthCredits! - 4, "birth-charge-conservation");
    await writeFile(custodyFile, JSON.stringify(custody), { mode: 0o600 });
    Object.assign(evidence, { project_id: custody.projectId, identity_id: custody.identityId, memory_id: custody.memoryId,
      memory_content_sha256: sha256(text(content)).toString("hex"), pow_bits: bits,
      root_saved_before_birth: custody.savedBeforeBirth, birth_replay_rejected: true });
  } else {
    stage = "fresh-process-local-custody";
    custody = JSON.parse(await readFile(custodyFile, "utf8"));
    ensure(custody.savedBeforeBirth && custody.identityId && custody.did && custody.projectId && custody.bearer && custody.memoryId, "incomplete-local-custody");
    const seed = Buffer.from(custody.rootSeed, "hex");
    const pubkey = b64(ed25519.getPublicKey(seed));
    const reconnected = client(custody.bearer);
    const { data: read } = await reconnected(`/v1/memories/${custody.memoryId}`);
    ensure(read.id === custody.memoryId && read.content === custody.memoryContent, "fresh-process-memory-continuity");
    const { data: wake } = await reconnected(`/v1/wake?identity_id=${custody.identityId}&format=json`);
    ensure(wake._scope_boundary.selected_identity_id === custody.identityId, "fresh-process-wake-binding");
    const { data: keys } = await reconnected("/v1/keys");
    ensure(keys.keys.length === 1, "birth-key-count");
    const originalKeyId = keys.keys.find((key: Json) => key.is_current)?.id;
    ensure(typeof originalKeyId === "string", "original-key-selector");
    const timestamp = new Date().toISOString();
    const { data: discovered } = await anonymous("/public/identities/by-pubkey", { method: "POST", body: {
      pubkey, timestamp, signature: b64(ed25519.sign(separatedHash([text("identity-discover/v1"), Buffer.from(pubkey, "base64"), text(timestamp)]), seed)),
    } });
    ensure(discovered.agents.some((agent: Json) => agent.identity_id === custody.identityId && agent.did === custody.did), "signed-return-discovery");
    const recovery = JSON.stringify({ did: custody.did, derived_pubkey: pubkey, timestamp,
      signature: b64(ed25519.sign(separatedHash([text("identity-recover/v1"), text(custody.did), Buffer.from(pubkey, "base64"), text(timestamp)]), seed)),
      device_label: "launch-core-return" });
    const { data: proofRequired } = await anonymous("/v1/identity/recover", { method: "POST", rawBody: recovery, status: 428 });
    ensure(proofRequired.error === "authority_proof_required" && proofRequired.details.next_sequence === 1, "root-proof-required");
    const authority = (sequence: number) => ({
      "X-Agenttool-Authority-Sequence": String(sequence), "X-Agenttool-Authority-Timestamp": timestamp,
      "X-Agenttool-Authority-Signature": b64(ed25519.sign(separatedHash([
        text("identity-authority/v1"), text(custody.did!), text("POST"), text("/v1/identity/recover"),
        text(sha256(text(recovery)).toString("hex")), text(String(sequence)), text(timestamp),
      ]), seed)),
    });
    const { data: recovered } = await anonymous("/v1/identity/recover", { method: "POST", rawBody: recovery, headers: authority(1), status: 201 });
    ensure(recovered.agent.id === custody.identityId && recovered.agent.did === custody.did &&
      recovered.project.id === custody.projectId && recovered.project.api_key !== custody.bearer, "recovery-identity-binding");
    const restored = client(recovered.project.api_key);
    const { data: restoredRead } = await restored(`/v1/memories/${custody.memoryId}`);
    ensure(restoredRead.content === custody.memoryContent, "recovered-memory-continuity");
    await reconnected(`/v1/memories/${custody.memoryId}`);
    evidence.recovery_preserved_old_bearer = true;
    const { data: exactReplay } = await anonymous("/v1/identity/recover", { method: "POST", rawBody: recovery, headers: authority(1), status: 409 });
    ensure(exactReplay.error === "authority_sequence_conflict", "exact-authority-replay-refusal");
    const { data: proofReplay } = await anonymous("/v1/identity/recover", { method: "POST", rawBody: recovery, headers: authority(2), status: 409 });
    ensure(proofReplay.error === "recovery_proof_replayed", "durable-recovery-replay-refusal");
    const { data: beforeRevoke } = await restored("/v1/keys");
    ensure(beforeRevoke.keys.length === 2, "replay-minted-extra-key");
    evidence.recovery_replay_minted_no_key = true;
    await restored(`/v1/keys/${originalKeyId}`, { method: "DELETE" });
    await reconnected(`/v1/memories/${custody.memoryId}`, { status: 401 });
    evidence.explicit_revocation_rejected_old_bearer = true;
    await anonymous(`/v1/memories/${custody.memoryId}`, { status: 401 });
    await restored("/v1/memories/search", { method: "POST", body: { query_embedding: [1] }, status: 400 });
    const burst = await Promise.all(Array.from({ length: 8 }, () => restored(`/v1/memories/${custody.memoryId}`)));
    ensure(burst.every(({ data }) => data.content === custody.memoryContent), "finite-read-burst");
    evidence.finite_burst = { concurrent_reads: 8, successes: 8 };
    const { data: recall } = await restored("/v1/memories/search", { method: "POST", body: {
      query_embedding: vector, identity_id: custody.identityId, min_score: 0.99, limit: 5,
    } });
    ensure(recall.mode === "semantic" && recall.results.some((m: Json) => m.id === custody.memoryId), "recovered-vector-recall");
    const [credits] = await sql`SELECT credits FROM tools.projects WHERE id=${custody.projectId}`;
    ensure(credits?.credits === custody.birthCredits! - 7, "journey-charge-conservation");
    const usage = await sql`SELECT tool, credits_used, success FROM tools.usage_events WHERE project_id=${custody.projectId} ORDER BY created_at`;
    ensure(usage.length === 3 && usage.every(row => row.success === true) &&
      usage.reduce((sum, row) => sum + row.credits_used, 0) === 7, "durable-usage-receipts");
    const [keyCounts] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE revoked_at IS NULL)::int AS active FROM tools.api_keys WHERE project_id=${custody.projectId}`;
    ensure(keyCounts?.total === 2 && keyCounts?.active === 1, "durable-key-lifecycle");
    evidence.credits_spent = 7; evidence.usage_receipts = 3;
    evidence.reconnect = "fresh-process-from-local-custody";
  }
  ensure(outboundFetchAttempts === 0 && workerIntervals === 0, "unexpected-background-or-provider-work");
  ensure(quietCounts.errors === 0 && quietCounts.unexpected_warnings === 0, "unexpected-application-diagnostic");
  evidence.phases.push(phase);
  evidence.outbound_fetch_attempts = outboundFetchAttempts;
  evidence.worker_intervals = workerIntervals;
  evidence[`${phase}_database_guard_intervals`] = databaseGuardIntervals;
  evidence[`${phase}_requests`] = diagnostics;
  evidence[`${phase}_suppressed_logs`] = quietCounts;
  await writeFile(evidenceFile, JSON.stringify(evidence), { mode: 0o600 });
  await sql.end({ timeout: 2 });
  clearTimeout(hardDeadline);
  process.stdout.write(`launch-core-${phase}:passed\n`);
  process.exit(0);
} catch (error) {
  clearTimeout(hardDeadline);
  const label = error instanceof Error && /^[a-z-]{1,80}$/.test(error.message) ? error.message : "unexpected-exception";
  const code = error && typeof error === "object" && "code" in error && /^[A-Z0-9_]{1,40}$/.test(String(error.code)) ? String(error.code) : undefined;
  process.stderr.write(JSON.stringify({ phase, stage, error: label, code, diagnostics,
    outbound_fetch_attempts: outboundFetchAttempts, worker_intervals: workerIntervals,
    database_guard_intervals: databaseGuardIntervals, suppressed_logs: quietCounts }) + "\n");
  process.exit(1);
}
