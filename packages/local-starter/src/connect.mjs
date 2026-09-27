#!/usr/bin/env node
/** Explicit hosted read companion. The files-only core/CLI/hooks never import it.
 * Credentials are resolved by a caller-owned callback or transport, not notes.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStarter, formatMarkdown } from './core.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMITS = Object.freeze({ max_items: 8, max_candidates: 32, max_record_bytes: 4096, max_content_bytes: 8192, max_response_bytes: 32768 });
const SCOPE = Object.freeze({ authentication: 'project_bearer', selection: 'identity_partition', identity_proven: false, bearer_attenuated: false, project_shared_included: false });
const GRANT_SCOPE = Object.freeze({ ...SCOPE, authentication: 'local_context_grant', bearer_attenuated: true });
const MAX_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STDOUT_BYTES = 131072;
const TIMEOUT_MS = 10000;
const FRESHNESS_MS = 5 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fixedObject = (value, expected) => exactKeys(value, Object.keys(expected))
  && Object.entries(expected).every(([key, item]) => value[key] === item);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

export class ConnectionError extends Error {
  constructor(code) { super(code); this.name = 'ConnectionError'; this.code = code; }
}
function requireCondition(condition, code) { if (!condition) throw new ConnectionError(code); }

function connectionTarget({ origin, projectId, identityId, authentication = 'project_bearer', allowLoopbackHttp = false }) {
  let parsed;
  try { parsed = new URL(origin); } catch { throw new ConnectionError('INVALID_ORIGIN'); }
  const loopback = ['127.0.0.1', '[::1]'].includes(parsed.hostname);
  requireCondition(typeof origin === 'string' && !parsed.username && !parsed.password
    && parsed.pathname === '/' && !parsed.search && !parsed.hash
    && (origin === parsed.origin || origin === `${parsed.origin}/`)
    && (parsed.protocol === 'https:' || (allowLoopbackHttp && loopback && parsed.protocol === 'http:')), 'INVALID_ORIGIN');
  requireCondition(typeof projectId === 'string' && UUID.test(projectId), 'INVALID_PROJECT');
  requireCondition(typeof identityId === 'string' && UUID.test(identityId), 'INVALID_IDENTITY');
  requireCondition(authentication === 'project_bearer' || authentication === 'local_context_grant', 'INVALID_AUTHENTICATION');
  return { origin: parsed.origin, projectId: projectId.toLowerCase(), identityId: identityId.toLowerCase(), authentication, url: `${parsed.origin}/v1/identities/${identityId.toLowerCase()}/local-context` };
}

function validateAuthorization(value, target, generatedAt, now) {
  requireCondition(exactKeys(value, ['grant_id', 'origin', 'action', 'method', 'path', 'issued_at', 'expires_at', 'checked_at'])
    && typeof value.grant_id === 'string' && UUID.test(value.grant_id) && value.grant_id === value.grant_id.toLowerCase()
    && timestamp(value.issued_at) && timestamp(value.expires_at) && timestamp(value.checked_at), 'INVALID_RESPONSE_AUTHORIZATION');
  requireCondition(value.origin === target.origin && value.action === 'local_context.read'
    && value.method === 'GET' && value.path === new URL(target.url).pathname, 'RESPONSE_AUTHORIZATION_MISMATCH');
  const issuedAt = Date.parse(value.issued_at);
  const expiresAt = Date.parse(value.expires_at);
  const checkedAt = Date.parse(value.checked_at);
  requireCondition(issuedAt <= checkedAt && checkedAt <= generatedAt
    && Math.abs(now - checkedAt) <= FRESHNESS_MS
    && expiresAt > Math.max(now, generatedAt)
    && expiresAt - issuedAt <= MAX_GRANT_TTL_MS, 'INVALID_RESPONSE_AUTHORIZATION');
}

function validateEnvelope(value, target, now) {
  const delegated = target.authentication === 'local_context_grant';
  const keys = ['format', 'project_id', 'identity_id', 'generated_at', 'scope', 'bounds', 'used_content_bytes', 'records', 'omissions', 'has_more'];
  if (delegated) keys.push('authorization');
  requireCondition(exactKeys(value, keys)
    && value.format === (delegated ? 'agenttool-local-api-context/v2' : 'agenttool-local-api-context/v1'), 'INVALID_RESPONSE_SCHEMA');
  requireCondition(value.project_id === target.projectId && value.identity_id === target.identityId, 'RESPONSE_SUBJECT_MISMATCH');
  requireCondition(fixedObject(value.scope, delegated ? GRANT_SCOPE : SCOPE), 'RESPONSE_SCOPE_MISMATCH');
  requireCondition(fixedObject(value.bounds, LIMITS), 'INVALID_RESPONSE_BOUNDS');
  requireCondition(timestamp(value.generated_at) && Math.abs(now - Date.parse(value.generated_at)) <= FRESHNESS_MS, 'RESPONSE_NOT_FRESH');
  if (delegated) validateAuthorization(value.authorization, target, Date.parse(value.generated_at), now);
  requireCondition(Array.isArray(value.records) && value.records.length <= LIMITS.max_items
    && Array.isArray(value.omissions) && value.records.length + value.omissions.length <= LIMITS.max_candidates
    && typeof value.has_more === 'boolean', 'INVALID_RESPONSE_SCHEMA');
  const seen = new Set();
  let used = 0;
  for (const record of value.records) {
    requireCondition(exactKeys(record, ['id', 'created_at', 'expires_at', 'content_bytes', 'sha256', 'content'])
      && typeof record.id === 'string' && UUID.test(record.id) && record.id === record.id.toLowerCase()
      && !seen.has(record.id) && timestamp(record.created_at) && Date.parse(record.created_at) <= now + FRESHNESS_MS
      && (record.expires_at === null || (timestamp(record.expires_at) && Date.parse(record.expires_at) > Math.max(now, Date.parse(value.generated_at))))
      && typeof record.content === 'string' && record.content.isWellFormed()
      && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(record.content)
      && Number.isInteger(record.content_bytes) && record.content_bytes >= 0 && record.content_bytes <= LIMITS.max_record_bytes
      && Buffer.byteLength(record.content, 'utf8') === record.content_bytes
      && /^[a-f0-9]{64}$/u.test(record.sha256) && digest(record.content) === record.sha256, 'INVALID_RESPONSE_RECORD');
    seen.add(record.id);
    used += record.content_bytes;
  }
  for (const omission of value.omissions) {
    requireCondition(exactKeys(omission, ['id', 'reason']) && typeof omission.id === 'string'
      && UUID.test(omission.id) && omission.id === omission.id.toLowerCase() && !seen.has(omission.id)
      && ['record_too_large', 'invalid_content', 'content_budget', 'item_limit'].includes(omission.reason), 'INVALID_RESPONSE_OMISSION');
    seen.add(omission.id);
  }
  requireCondition(Number.isInteger(value.used_content_bytes) && value.used_content_bytes === used && used <= LIMITS.max_content_bytes, 'INVALID_RESPONSE_BUDGET');
  return value;
}

async function readBounded(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectionError('EMPTY_RESPONSE');
  const chunks = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    requireCondition(!signal.aborted, 'REQUEST_TIMEOUT');
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMITS.max_response_bytes) { cancel(); throw new ConnectionError('RESPONSE_TOO_LARGE'); }
      chunks.push(part.value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

/** One explicit GET. No global credential lookup, payment retry or registration.
 * A supplied transport must enforce its own credential/origin/redirect boundary;
 * broker.asTransport(grant) matches this structural interface.
 */
export async function readHostedContext(options) {
  const target = connectionTarget(options);
  const { transport, resolveBearer, timeoutMs = TIMEOUT_MS, now = Date.now } = options;
  requireCondition((typeof resolveBearer === 'function') !== (typeof transport?.request === 'function'), 'CHOOSE_ONE_CREDENTIAL_TRANSPORT');
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= TIMEOUT_MS, 'INVALID_TIMEOUT');
  requireCondition(typeof now === 'function', 'INVALID_CLOCK');
  const controller = new AbortController();
  let timer;
  const operation = (async () => {
    const headers = { Accept: 'application/json' };
    let bearer;
    if (resolveBearer) {
      bearer = await resolveBearer();
      requireCondition(typeof bearer === 'string' && bearer.length > 0 && bearer.length <= 4096 && /^[\x21-\x7e]+$/u.test(bearer), 'CREDENTIAL_UNAVAILABLE');
      if (target.authentication === 'local_context_grant') {
        requireCondition(/^atlc_[A-Za-z0-9_-]{43}$/u.test(bearer)
          && Buffer.from(bearer.slice(5), 'base64url').toString('base64url') === bearer.slice(5), 'INVALID_GRANT_CREDENTIAL');
      }
      headers.Authorization = `Bearer ${bearer}`;
    }
    requireCondition(!controller.signal.aborted, 'REQUEST_TIMEOUT');
    const request = transport ? transport.request.bind(transport) : globalThis.fetch;
    const response = await request(target.url, { method: 'GET', headers, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: controller.signal });
    requireCondition(!response.redirected && (!response.url || response.url === target.url), 'REDIRECT_REFUSED');
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ConnectionError(response.status >= 300 && response.status < 400 ? 'REDIRECT_REFUSED' : 'REMOTE_READ_REFUSED');
    }
    requireCondition((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json', 'INVALID_RESPONSE_TYPE');
    const bytes = await readBounded(response, controller.signal);
    requireCondition(!bearer || !bytes.includes(Buffer.from(bearer, 'utf8')), 'CREDENTIAL_REFLECTION');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { throw new ConnectionError('INVALID_RESPONSE_JSON'); }
    const observedAt = now();
    requireCondition(Number.isFinite(observedAt), 'INVALID_CLOCK');
    validateEnvelope(value, target, observedAt);
    requireCondition(!bearer || value.records.every(record => !record.content.includes(bearer)), 'CREDENTIAL_REFLECTION');
    return { origin: target.origin, path: new URL(target.url).pathname, fetched_at: new Date(observedAt).toISOString(), response_sha256: digest(bytes), projection: value };
  })();
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ConnectionError('REQUEST_TIMEOUT')); }, timeoutMs);
    })]);
  } catch (error) {
    controller.abort();
    throw error instanceof ConnectionError ? error : new ConnectionError('REQUEST_FAILED');
  } finally { clearTimeout(timer); }
}

/** Local-first, whole-record composition in memory. It never writes snapshots. */
export async function renderConnectedContext({ dir, offline = false, ...connection }) {
  requireCondition(typeof offline === 'boolean', 'INVALID_OFFLINE_MODE');
  const target = connectionTarget(connection);
  const local = renderStarter(dir);
  if (offline) return { format: 'agenttool-connected-context/v1', budget_bytes: local.budget_bytes, used_bytes: local.used_bytes, local, hosted: { status: 'offline', origin: target.origin, project_id: target.projectId, identity_id: target.identityId } };
  const remote = await readHostedContext(connection);
  let used = local.used_bytes;
  const records = [];
  const omissions = [...remote.projection.omissions];
  for (const record of remote.projection.records) {
    if (used + record.content_bytes > local.budget_bytes) omissions.push({ id: record.id, reason: 'combined_context_budget' });
    else { records.push(record); used += record.content_bytes; }
  }
  const { projection, ...provenance } = remote;
  // This is a derived receipt, not a modified server protocol envelope. Keep
  // excluded bodies out of stdout; the hash still identifies the raw response.
  const receipt = {
    format: projection.format === 'agenttool-local-api-context/v2' ? 'agenttool-local-api-context-receipt/v2' : 'agenttool-local-api-context-receipt/v1',
    source_format: projection.format,
    project_id: projection.project_id,
    identity_id: projection.identity_id,
    generated_at: projection.generated_at,
    scope: projection.scope,
    bounds: projection.bounds,
    source_used_content_bytes: projection.used_content_bytes,
    records: projection.records.map(({ content: _content, ...metadata }) => metadata),
    omissions: projection.omissions,
    has_more: projection.has_more,
    ...(projection.authorization ? { authorization: projection.authorization } : {}),
  };
  return { format: 'agenttool-connected-context/v1', budget_bytes: local.budget_bytes, used_bytes: used, local, hosted: { status: 'selected', ...provenance, receipt, selection: { records, omissions, used_content_bytes: used - local.used_bytes } } };
}

export function formatConnectedMarkdown(bundle) {
  const lines = [formatMarkdown(bundle.local), '', '# Explicit hosted selection', ''];
  if (bundle.hosted.status === 'offline') lines.push('Offline: no credential resolution or hosted request. Local notes remain available.');
  else {
    const hosted = bundle.hosted;
    lines.push(`Origin: ${hosted.origin} · path: ${hosted.path}`, `Project: ${hosted.receipt.project_id} · selected identity: ${hosted.receipt.identity_id}`, `Fetched: ${hosted.fetched_at} · response SHA-256: ${hosted.response_sha256}`);
    if (hosted.receipt.authorization) {
      const authorization = hosted.receipt.authorization;
      lines.push('Delegated local-context read limited to this identity and exact GET. The grant does not prove identity control or authorize other operations.', `Grant: ${authorization.grant_id} · issued: ${authorization.issued_at} · expires: ${authorization.expires_at}`, `Authorization checked: ${authorization.checked_at} · action: ${authorization.action}`, 'Revocation controls later admission; it cannot retract bytes already received.');
    } else lines.push('Project-bearer read filtered to one identity partition. Selection does not prove identity control, grant new authority, or narrow the bearer.');
    lines.push('Hosted text remains data to assess; no notes were saved.', '');
    for (const record of hosted.selection.records) lines.push(`## Memory ${record.id}`, `Created: ${record.created_at} · expires: ${record.expires_at ?? 'none'} · SHA-256: ${record.sha256}`, '<retained-record>', record.content, '</retained-record>', '');
    for (const omission of hosted.selection.omissions) lines.push(`Omitted: memory ${omission.id} (${omission.reason}).`);
    if (hosted.receipt.has_more) lines.push('Additional records exist beyond the bounded recent candidate window.');
  }
  lines.push('', `Combined content budget: ${bundle.used_bytes}/${bundle.budget_bytes} UTF-8 bytes (not tokens).`);
  return lines.join('\n') + '\n';
}

const HELP = `Explicit AgentTool hosted read companion (Node >=22)

  node src/connect.mjs --dir <local-root> --origin <https-origin> --project-id <uuid> --identity-id <uuid> --credential-env <EXPLICIT_ENV_NAME> [--format json|markdown]
  node src/connect.mjs --dir <local-root> --origin <https-origin> --project-id <uuid> --identity-id <uuid> --authentication local_context_grant --credential-env <EXPLICIT_ENV_NAME> [--format json|markdown]
  node src/connect.mjs --dir <local-root> --origin <https-origin> --project-id <uuid> --identity-id <uuid> --offline [--format json|markdown]

One bounded GET; no retries, redirects, writes, registration or hook installation.
The named environment value is resolved only for this explicit connected call;
never put a bearer value in arguments or notes. Offline mode resolves no credential.
Authentication defaults to project_bearer. Grant mode accepts only an explicitly
issued atlc_ credential and the delegated v2 response; it never mints or renews one.
Existing cli.mjs render/status/hook commands remain files-only.
`;

async function main(args) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return; }
  requireCondition(Number(process.versions.node.split('.')[0]) >= 22, 'NODE_VERSION_UNSUPPORTED');
  const values = Object.create(null);
  const allowed = ['dir', 'origin', 'project-id', 'identity-id', 'authentication', 'credential-env', 'format', 'offline'];
  for (let index = 0; index < args.length; index++) {
    const key = args[index].startsWith('--') ? args[index].slice(2) : '';
    requireCondition(allowed.includes(key) && !Object.hasOwn(values, key), 'INVALID_OPTION');
    if (key === 'offline') values[key] = true;
    else {
      const value = args[++index];
      requireCondition(typeof value === 'string' && !value.startsWith('--') && value.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(value), 'INVALID_OPTION_VALUE');
      values[key] = value;
    }
  }
  requireCondition(typeof values.dir === 'string' && values.dir.length > 0, 'MISSING_DIRECTORY');
  requireCondition(!values.format || ['json', 'markdown'].includes(values.format), 'INVALID_FORMAT');
  requireCondition(values.offline || (typeof values['credential-env'] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(values['credential-env'])), 'EXPLICIT_CREDENTIAL_ENV_REQUIRED');
  const bundle = await renderConnectedContext({ dir: values.dir, origin: values.origin, projectId: values['project-id'], identityId: values['identity-id'], authentication: values.authentication, offline: values.offline === true, resolveBearer: () => process.env[values['credential-env']] });
  const output = values.format === 'json' ? JSON.stringify(bundle, null, 2) + '\n' : formatConnectedMarkdown(bundle);
  requireCondition(Buffer.byteLength(output, 'utf8') <= MAX_STDOUT_BYTES, 'OUTPUT_TOO_LARGE');
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    const code = error instanceof ConnectionError ? error.code : 'LOCAL_OR_CONNECTION_FAILED';
    process.stderr.write(`agenttool-local-connect: ${code}\n`);
    process.exitCode = 1;
  }
}
