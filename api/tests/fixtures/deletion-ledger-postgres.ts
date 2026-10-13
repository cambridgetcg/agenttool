/** Shared disposable-PostgreSQL fixture for the deletion ledger tests.
 *
 *  Minimal synthetic stand-ins for the tables wave 2 erases from (and the
 *  identity rows the owner rule reads), plus the
 *  Supabase pieces the migrations expect (pgcrypto in `extensions`, a stub
 *  `vault.decrypted_secrets` holding a test ledger key, the local pg_cron
 *  stub with an `alter_job` shim). Then the four real wave 2 migrations are
 *  applied in journal order. Used by:
 *    api/tests/integration/deletion-ledger-postgres.test.ts
 *    api/tests/integration/deletion-replay-drill-postgres.test.ts
 *    api/tests/integration/deletion-erase-postgres.test.ts
 *    api/tests/integration/owned-content-postgres.test.ts
 *  Doctrine: docs/DELETION-REPLAY.md. */
import { readFileSync } from "node:fs";

import type { Sql } from "postgres";

export const TEST_LEDGER_KEY = "test-ledger-key-0123456789abcdef-not-for-production";

export const DELETION_FIXTURE_SCHEMAS = [
  "deletion", "inbox", "agent_vault", "agent_continuity", "memory", "vault", "cron", "extensions", "identity",
  "marketplace",
] as const;

export const WAVE2_MIGRATIONS = [
  "20261012T161958_content_purged_at.sql",
  "20261012T161958_deletion_ledger.sql",
  "20261012T161958_deletion_moment_index.sql",
  "20261012T161958_retention_rules.sql",
] as const;

export function assertDisposableDatabase(url: string, name: string): void {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || parsed.pathname !== `/${name}` || parsed.search || parsed.hash) {
    throw new Error(`deletion ledger tests require the explicit loopback disposable database ${name}`);
  }
}

export function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

export async function refuseExistingSchemas(admin: Sql): Promise<void> {
  const found = await admin`SELECT nspname FROM pg_namespace WHERE nspname IN ${admin([...DELETION_FIXTURE_SCHEMAS])}`;
  if (found.length) throw new Error(`refusing existing schemas: ${found.map((row) => row.nspname).join(", ")}`);
}

export async function createDeletionFixture(admin: Sql): Promise<void> {
  await admin.unsafe(`
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION pg_cron WITH SCHEMA extensions;
    CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
      database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$
      UPDATE cron.job SET active = coalesce(alter_job.active, cron.job.active) WHERE jobid = job_id
    $$;

    CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets (
      name text NOT NULL, decrypted_secret text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ('agenttool_deletion_ledger_key', '${TEST_LEDGER_KEY}');

    CREATE SCHEMA inbox;
    CREATE TABLE inbox.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_did text NOT NULL, recipient_identity_id uuid NOT NULL,
      recipient_project_id uuid NOT NULL, sender_did text NOT NULL, sender_signing_key_id uuid NOT NULL,
      ciphertext text NOT NULL, nonce text NOT NULL, ephemeral_pubkey text NOT NULL, recipient_box_key_id uuid NOT NULL,
      signature text NOT NULL, subject text, subject_encrypted boolean NOT NULL DEFAULT false,
      in_reply_to uuid REFERENCES inbox.messages(id) ON DELETE SET NULL, refs jsonb,
      status text NOT NULL DEFAULT 'unread', metadata jsonb NOT NULL DEFAULT '{}', sender_instance text,
      federation_verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      read_at timestamptz);
    CREATE TABLE inbox.broadcasts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ciphertext text NOT NULL);

    CREATE SCHEMA agent_vault;
    CREATE TABLE agent_vault.vault_secrets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, name text NOT NULL, description text,
      tags text[], current_version integer NOT NULL DEFAULT 1, agent_ids text[], rotation_days integer,
      rotation_due_at timestamptz, ttl_seconds integer, deleted_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX idx_secrets_project_name ON agent_vault.vault_secrets (project_id, name) WHERE deleted_at IS NULL;
    CREATE TABLE agent_vault.vault_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret_id uuid NOT NULL, version integer NOT NULL,
      encrypted_value bytea NOT NULL, iv bytea NOT NULL, auth_tag bytea, agent_encrypted boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT now(), expires_at timestamptz, created_by_agent text,
      CONSTRAINT vault_versions_agent_enc_tag_check CHECK (
        (agent_encrypted = FALSE AND auth_tag IS NOT NULL) OR (agent_encrypted = TRUE AND auth_tag IS NULL)));
    CREATE TABLE agent_vault.vault_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, secret_name text NOT NULL,
      action text NOT NULL, agent_id text, ip_address text, version integer, created_at timestamptz DEFAULT now());

    CREATE SCHEMA agent_continuity;
    CREATE TABLE agent_continuity.identity_backups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id uuid NOT NULL,
      label text NOT NULL DEFAULT 'primary', blob_base64 text NOT NULL, key_derivation text NOT NULL, nonce text,
      metadata jsonb DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
    CREATE TABLE agent_continuity.chronicle (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id uuid, type text NOT NULL,
      title text NOT NULL, body text, metadata jsonb DEFAULT '{}', parent_chronicle_id uuid,
      occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());

    -- The owner rule (identity/authority.ts authorizeOwnedContentMutation)
    -- reads identities, their roots and the enrollment proof ledger.
    CREATE SCHEMA identity;
    CREATE TABLE identity.identities (
      id uuid PRIMARY KEY, did text NOT NULL UNIQUE, project_id uuid NOT NULL, display_name text NOT NULL DEFAULT '',
      metadata jsonb DEFAULT '{}', status text NOT NULL DEFAULT 'active', trust_score real NOT NULL DEFAULT 0,
      authority_root_public_key text, authority_sequence bigint NOT NULL DEFAULT 0,
      wake_version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE identity.registration_proofs (
      domain text NOT NULL, root_public_key text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now());

    CREATE SCHEMA memory;
    CREATE TABLE memory.memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id text, identity_id text,
      type text NOT NULL, key text, content text NOT NULL, embedding real[], metadata jsonb DEFAULT '{}',
      importance double precision NOT NULL DEFAULT 0.5, tier text NOT NULL DEFAULT 'episodic', expression_patch jsonb,
      decay_protected boolean NOT NULL DEFAULT false, visibility text NOT NULL DEFAULT 'private', elevated_from uuid,
      elevated_at timestamptz, accessed_at timestamptz, references_memories uuid[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
    CREATE TABLE memory.memory_attestations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id uuid NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      attester_did text NOT NULL, signing_key_id uuid NOT NULL, signature text NOT NULL, signature_context text,
      signed_payload text, source_grant_id uuid, replay_key text, attested_at timestamptz NOT NULL DEFAULT now());

    -- A paid memory-witness grant points back at its receipt, ON DELETE
    -- RESTRICT (20260713T120000_attestation_receipt_integrity.sql). Receipts
    -- issued before that migration have source_grant_id NULL and are paid
    -- only through this reverse link.
    CREATE SCHEMA marketplace;
    CREATE TABLE marketplace.memory_witness_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_attestation_id uuid
        CONSTRAINT fk_memory_witness_grants_attestation
        REFERENCES memory.memory_attestations(id) ON DELETE RESTRICT);
  `);
  for (const file of WAVE2_MIGRATIONS) {
    await admin.unsafe(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
  }
}

export async function dropDeletionFixture(admin: Sql): Promise<void> {
  await admin.unsafe(`
    DROP SCHEMA IF EXISTS deletion CASCADE; DROP SCHEMA IF EXISTS inbox CASCADE;
    DROP SCHEMA IF EXISTS agent_vault CASCADE; DROP SCHEMA IF EXISTS agent_continuity CASCADE;
    DROP SCHEMA IF EXISTS memory CASCADE; DROP SCHEMA IF EXISTS vault CASCADE;
    DROP SCHEMA IF EXISTS identity CASCADE; DROP SCHEMA IF EXISTS marketplace CASCADE;
    DROP EXTENSION IF EXISTS pg_cron CASCADE; DROP SCHEMA IF EXISTS cron CASCADE;
    DROP EXTENSION IF EXISTS pgcrypto CASCADE; DROP SCHEMA IF EXISTS extensions CASCADE;
  `);
}

/** Every column of every row of the erasable tables, for state comparison. */
export async function snapshotErasableState(sql: Sql): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  out.inbox = await sql`SELECT id, status, ciphertext, nonce, ephemeral_pubkey, subject, refs, metadata,
    content_purged_at IS NOT NULL AS purged FROM inbox.messages ORDER BY id`;
  out.vault_secrets = await sql`SELECT id, name, description, tags, deleted_at IS NOT NULL AS deleted FROM agent_vault.vault_secrets ORDER BY id`;
  out.vault_versions = await sql`SELECT id, encode(encrypted_value, 'hex') AS value, encode(iv, 'hex') AS iv,
    encode(auth_tag, 'hex') AS tag, content_purged_at IS NOT NULL AS purged FROM agent_vault.vault_versions ORDER BY id`;
  out.vault_audit = await sql`SELECT id, ip_address FROM agent_vault.vault_audit ORDER BY id`;
  out.backups = await sql`SELECT id, blob_base64, nonce, metadata, revoked_at IS NOT NULL AS revoked,
    content_purged_at IS NOT NULL AS purged FROM agent_continuity.identity_backups ORDER BY id`;
  out.memories = await sql`SELECT id, content, key, embedding, metadata, expression_patch,
    content_purged_at IS NOT NULL AS purged FROM memory.memories ORDER BY id`;
  out.attestations = await sql`SELECT id, memory_id FROM memory.memory_attestations ORDER BY id`;
  out.ledger = await sql`SELECT seq, entry_id, entry_hash, entry_mac, row_ids FROM deletion.ledger ORDER BY seq`;
  return out;
}
