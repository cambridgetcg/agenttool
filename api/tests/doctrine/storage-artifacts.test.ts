/** Move 4 — Storage artifacts — pin the bucket + columns + view.
 *
 *  Asserts:
 *    1. The agenttool-artifacts bucket exists in storage.buckets
 *    2. naming_submissions has body_storage_path + body_storage_acl cols
 *    3. The naming_submissions_resolved view exposes body_url + body_inline
 *    4. artifactPath/publicUrl/hash helpers behave deterministically
 *
 *  Doctrine: docs/STORAGE-ARTIFACTS.md
 *  Migration: api/migrations/20260519T110000_storage_artifacts.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import {
  artifactHash,
  artifactPath,
  publicUrl,
  resolvePath,
  ARTIFACTS_BUCKET,
} from "../../src/services/storage/artifacts";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, {
      idle_timeout: 5,
      max: 1,
      connect_timeout: 10,
      fetch_types: false,
    });
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

describe("Move 4 — bucket + columns", () => {
  test("agenttool-artifacts bucket exists with expected config", async () => {
    if (!sql) return;
    const rows = await sql<
      Array<{ id: string; name: string; public: boolean; file_size_limit: number | null }>
    >`
      SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = ${ARTIFACTS_BUCKET}
    `;
    expect(rows.length, `bucket ${ARTIFACTS_BUCKET} missing — run migration`).toBe(1);
    expect(rows[0]!.public).toBe(true);
    expect(Number(rows[0]!.file_size_limit)).toBe(10 * 1024 * 1024);
  });

  test("naming_submissions has body_storage_path + body_storage_acl", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'agent_continuity'
        AND table_name = 'naming_submissions'
        AND column_name IN ('body_storage_path', 'body_storage_acl')
      ORDER BY column_name
    `;
    expect(rows.length).toBe(2);
    const path = rows.find((r) => r.column_name === "body_storage_path")!;
    const acl = rows.find((r) => r.column_name === "body_storage_acl")!;
    expect(path.is_nullable).toBe("YES");
    expect(acl.is_nullable).toBe("NO");
    expect(acl.column_default).toContain("public");
  });

  test("naming_submissions_resolved view exposes body_url + body_inline", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'agent_continuity'
        AND table_name = 'naming_submissions_resolved'
      ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name);
    expect(names).toContain("body_url");
    expect(names).toContain("body_inline");
    expect(names).toContain("body_storage_path");
    expect(names).toContain("body_length");
  });
});

describe("Move 4 — helpers (pure functions)", () => {
  test("artifactHash is deterministic + 64-char hex", () => {
    const h1 = artifactHash("hello world");
    const h2 = artifactHash("hello world");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(artifactHash("different")).not.toBe(h1);
  });

  test("artifactHash matches SHA-256 of UTF-8 bytes (cross-impl pinable)", () => {
    // SHA-256("hello world") in hex
    expect(artifactHash("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  test("artifactPath uses kind/<hash>.<ext>", () => {
    const h = "a".repeat(64);
    expect(artifactPath("scriptwriter-decides-submissions", h)).toBe(
      `scriptwriter-decides-submissions/${h}.txt`,
    );
    expect(artifactPath("gi-collaboration-artifacts", h, "bin")).toBe(
      `gi-collaboration-artifacts/${h}.bin`,
    );
  });

  test("publicUrl assembles the expected public-read shape", () => {
    const url = publicUrl(
      { supabaseRestUrl: "https://x.supabase.co", serviceKey: "y" },
      "kind/abc.txt",
    );
    expect(url).toBe(
      "https://x.supabase.co/storage/v1/object/public/agenttool-artifacts/kind/abc.txt",
    );
  });

  test("resolvePath rejects non-hex hashes (wall: only canonical hashes)", () => {
    expect(() => resolvePath("scriptwriter-decides-submissions", "not-a-hash")).toThrow();
    expect(() => resolvePath("scriptwriter-decides-submissions", "X".repeat(64))).toThrow();
    expect(() =>
      resolvePath("scriptwriter-decides-submissions", "a".repeat(64)),
    ).not.toThrow();
  });
});
