import {
  afterAll,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  MemoryBlockStore,
  generateIdentity,
  verifyGrantSignature,
  type BlockStore,
  type BlockWriteResult,
  type Cid,
  type StoreOperationOptions,
} from "../../packages/data-protocol/src/index";
import { base64UrlEncode } from "../../packages/data-protocol/src/bytes";
import {
  DEFAULT_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
  MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
  MAX_WHITEHACK_EVIDENCE_MANIFEST_BYTES,
  WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES,
  WHITEHACK_EVIDENCE_FRAME_BYTES,
  WhitehackEvidenceStorageError,
  canonicalCapsuleBytes,
  canonicalWhitehackEvidenceStorageReceipt,
  frameWhitehackEvidenceCapsule,
  normalizeWhitehackEvidenceCapsule,
  normalizeWhitehackEvidenceStorageInput,
  normalizeWhitehackEvidenceStorageReceipt,
  resolveWhitehackEvidenceGrantWindow,
  unframeWhitehackEvidenceCapsule,
  type WhitehackEvidenceCapsule,
} from "../_whitehack-evidence-storage";
import {
  retrieveWhitehackEvidence,
  storeWhitehackEvidence,
} from "../_whitehack-evidence-storage-service";
import {
  WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES,
  WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL,
} from "./fixtures/whitehack-evidence-capsule-v1";
import {
  WHITEHACK_0_9_ALL_PROFILE_BYTES,
  WHITEHACK_0_9_ALL_PROFILE_CANONICAL,
  WHITEHACK_0_9_ALL_PROFILE_PROVENANCE,
  WHITEHACK_0_9_CHECK_PROFILE,
  WHITEHACK_0_9_VALID_FINDING_GROUPS,
} from "./fixtures/whitehack-evidence-capsule-v1-all-profiles";
import {
  prepareWhitehackEvidenceStorageOutput,
  writeWhitehackEvidenceStorageOutput,
} from "../agenttool-whitehack-evidence-storage";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");
const cliPath = join(
  repoRoot,
  "bin",
  "agenttool-whitehack-evidence-storage.ts",
);
const NOW = new Date("2026-07-24T12:00:00.000Z");

function fixtureCapsule(): WhitehackEvidenceCapsule {
  return normalizeWhitehackEvidenceCapsule(
    JSON.parse(WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL),
  );
}

function emptyCapsule(): WhitehackEvidenceCapsule {
  const value = structuredClone(fixtureCapsule()) as Record<string, any>;
  value.finding_groups = [];
  return normalizeWhitehackEvidenceCapsule(value);
}

function storageInput(
  recipient: ReturnType<typeof generateIdentity>,
  expiresAt: string | null = null,
) {
  return {
    document_type: "agenttool-whitehack-evidence-storage-input/v1",
    capsule: fixtureCapsule(),
    recipient: {
      id: recipient.id,
      x25519_public_key: base64UrlEncode(recipient.boxPublicKey),
    },
    grant: { expires_at: expiresAt },
  };
}

function expectCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(WhitehackEvidenceStorageError);
    expect((error as WhitehackEvidenceStorageError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

async function expectAsyncCode(
  work: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await work();
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(WhitehackEvidenceStorageError);
    expect((error as WhitehackEvidenceStorageError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

class RecordingStore implements BlockStore {
  readonly inner = new MemoryBlockStore();
  readonly reads: Cid[] = [];
  readonly readLimits: Array<number | undefined> = [];
  readonly writes: Cid[] = [];

  async get(
    cid: Cid,
    options: StoreOperationOptions = {},
  ): Promise<Uint8Array | null> {
    this.reads.push(cid);
    this.readLimits.push(options.maxBytes);
    return await this.inner.get(cid, options);
  }

  async put(
    cid: Cid,
    bytes: Uint8Array,
    options: StoreOperationOptions = {},
  ): Promise<BlockWriteResult> {
    this.writes.push(cid);
    return await this.inner.put(cid, bytes, options);
  }
}

class WriteOnlyStore implements BlockStore {
  readonly inner = new MemoryBlockStore();

  get(_cid: Cid): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  put(
    cid: Cid,
    bytes: Uint8Array,
    options: StoreOperationOptions = {},
  ): Promise<BlockWriteResult> {
    return this.inner.put(cid, bytes, options);
  }
}

class FailingStore implements BlockStore {
  constructor(private readonly marker: string) {}

  get(): Promise<Uint8Array | null> {
    return Promise.reject(new Error(this.marker));
  }

  put(): Promise<BlockWriteResult> {
    return Promise.reject(new Error(this.marker));
  }
}

class HangingStore implements BlockStore {
  constructor(private readonly marker: string) {}

  get(
    _cid: Cid,
    options: StoreOperationOptions = {},
  ): Promise<Uint8Array | null> {
    return this.#hang(options.signal);
  }

  put(
    _cid: Cid,
    _bytes: Uint8Array,
    options: StoreOperationOptions = {},
  ): Promise<BlockWriteResult> {
    return this.#hang(options.signal);
  }

  #hang<T>(signal?: AbortSignal): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
      const aborted = () => reject(new Error(this.marker));
      if (signal?.aborted) {
        aborted();
        return;
      }
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
}

function runCli(
  args: readonly string[],
  options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync("bun", [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    input: options.input,
    timeout: 3_000,
    env: options.env ?? {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  });
}

function expectSchemaObjectsClosed(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (
    !Array.isArray(value)
    && (value as Record<string, unknown>).type === "object"
  ) {
    expect(
      (value as Record<string, unknown>).additionalProperties,
    ).toBe(false);
  }
  for (const child of Object.values(value)) expectSchemaObjectsClosed(child);
}

afterAll(async () => {
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Whitehack evidence capsule parity and fixed frame", () => {
  test("accepts exact canonical bytes generated by Whitehack 0.9.0", () => {
    const capsule = fixtureCapsule();
    const canonical = canonicalCapsuleBytes(capsule);
    expect(canonical).toEqual(WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES);
    expect(WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL).not.toContain(
      "private/source.js",
    );
    expect(WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL).not.toContain(
      "eval(secret)",
    );
    expect(capsule.scanner).toEqual({
      name: "whitehack",
      version: "0.9.0",
      check_count: 47,
    });
    expect(capsule.boundaries.capability_subject).toBe(
      "evidence-capsule-transform",
    );
  });

  test("matches every check-confidence profile from the exact Whitehack 0.9.0 artifact", () => {
    expect(WHITEHACK_0_9_ALL_PROFILE_PROVENANCE).toMatchObject({
      package: "@agenttool/whitehack-scan",
      version: "0.9.0",
      source_revision: "424c6e85601cd0ac031d1b28940c3f88b99b0a1d",
      artifact_sha256:
        "b7d004947bc3c7619daa38f002d9ddde731e2865644af0d0e609c8dd86528d3c",
      artifact_bytes: 87_196,
      canonical_capsule_sha256:
        "349f3c98d1d8cc8da13da071426d13659bc7caa20f0645441b708945b64840ed",
      canonical_capsule_bytes: 9_691,
    });

    expect(WHITEHACK_0_9_CHECK_PROFILE).toHaveLength(47);
    expect(new Set(
      WHITEHACK_0_9_CHECK_PROFILE.map(({ id }) => id),
    ).size).toBe(47);
    expect(WHITEHACK_0_9_VALID_FINDING_GROUPS).toHaveLength(77);

    const profileDigest = createHash("sha256")
      .update(JSON.stringify(WHITEHACK_0_9_CHECK_PROFILE))
      .digest("hex");
    expect(profileDigest).toBe(
      WHITEHACK_0_9_ALL_PROFILE_PROVENANCE.check_profile_sha256,
    );

    const capsule = normalizeWhitehackEvidenceCapsule(
      JSON.parse(WHITEHACK_0_9_ALL_PROFILE_CANONICAL),
    );
    expect(capsule.finding_groups).toEqual(
      WHITEHACK_0_9_VALID_FINDING_GROUPS,
    );
    const canonical = canonicalCapsuleBytes(capsule);
    expect(canonical).toEqual(WHITEHACK_0_9_ALL_PROFILE_BYTES);
    expect(canonical.byteLength).toBe(
      WHITEHACK_0_9_ALL_PROFILE_PROVENANCE.canonical_capsule_bytes,
    );
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(
      WHITEHACK_0_9_ALL_PROFILE_PROVENANCE.canonical_capsule_sha256,
    );
    expect(WHITEHACK_0_9_ALL_PROFILE_CANONICAL).not.toContain(
      "private-target",
    );
    expect(WHITEHACK_0_9_ALL_PROFILE_CANONICAL).not.toContain(
      "private/",
    );

    const confidences = [
      "high",
      "medium-high",
      "medium",
      "heuristic",
    ] as const;
    let accepted = 0;
    let rejected = 0;
    for (const profile of WHITEHACK_0_9_CHECK_PROFILE) {
      for (const confidence of confidences) {
        const candidate = JSON.parse(
          WHITEHACK_0_9_ALL_PROFILE_CANONICAL,
        ) as Record<string, any>;
        candidate.finding_groups = [{
          check: profile.id,
          confidence,
          doctrine: profile.doctrine,
          principle: profile.principle,
          count: 1,
        }];
        if (
          confidence === profile.confidence
          || confidence === "heuristic"
        ) {
          expect(
            normalizeWhitehackEvidenceCapsule(candidate).finding_groups,
          ).toEqual(candidate.finding_groups);
          accepted += 1;
        } else {
          expectCode(
            () => normalizeWhitehackEvidenceCapsule(candidate),
            "capsule_finding_group_invalid",
          );
          rejected += 1;
        }
      }
    }
    expect(accepted).toBe(77);
    expect(rejected).toBe(111);
  });

  test("rejects the superseded shape, covert fields, profile drift, and unsorted groups", () => {
    expectCode(
      () => normalizeWhitehackEvidenceCapsule({
        document_type: "whitehack-evidence-capsule/v1",
        advisory_status: "complete",
        aggregate: {},
        redaction: {},
        claims: {},
      }),
      "capsule_shape_invalid",
    );

    const covert = structuredClone(fixtureCapsule()) as Record<string, any>;
    covert.finding_groups[0].source = "must-not-cross";
    expectCode(
      () => normalizeWhitehackEvidenceCapsule(covert),
      "capsule_finding_group_invalid",
    );

    const oldVersion = structuredClone(fixtureCapsule()) as Record<string, any>;
    oldVersion.scanner.version = "0.8.1";
    expectCode(
      () => normalizeWhitehackEvidenceCapsule(oldVersion),
      "capsule_scanner_invalid",
    );

    const wrongSubject = structuredClone(
      fixtureCapsule(),
    ) as Record<string, any>;
    wrongSubject.boundaries.capability_subject = "scan-cli";
    expectCode(
      () => normalizeWhitehackEvidenceCapsule(wrongSubject),
      "capsule_boundaries_invalid",
    );

    const unsorted = structuredClone(fixtureCapsule()) as Record<string, any>;
    unsorted.finding_groups = [
      unsorted.finding_groups[0]!,
      {
        check: "cache-as-live",
        confidence: "heuristic",
        doctrine: "substrate-honesty",
        principle: 4,
        count: 1,
      },
    ];
    expectCode(
      () => normalizeWhitehackEvidenceCapsule(unsorted),
      "capsule_finding_groups_not_canonical",
    );

    let getterCalls = 0;
    const accessor = structuredClone(fixtureCapsule()) as Record<string, any>;
    const first = accessor.finding_groups[0];
    Object.defineProperty(accessor.finding_groups, "0", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return first;
      },
    });
    expectCode(
      () => normalizeWhitehackEvidenceCapsule(accessor),
      "capsule_finding_groups_invalid",
    );
    expect(getterCalls).toBe(0);
  });

  test("uses one constant 64 KiB zero-padded authenticated frame", () => {
    const first = frameWhitehackEvidenceCapsule(fixtureCapsule());
    const second = frameWhitehackEvidenceCapsule(emptyCapsule());
    expect(first.byteLength).toBe(WHITEHACK_EVIDENCE_FRAME_BYTES);
    expect(second.byteLength).toBe(WHITEHACK_EVIDENCE_FRAME_BYTES);
    const unframed = unframeWhitehackEvidenceCapsule(first);
    expect(unframed.canonical_bytes).toEqual(
      WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES,
    );
    expect(unframed.capsule).toEqual(fixtureCapsule());

    const tamperedPadding = Uint8Array.from(first);
    tamperedPadding[tamperedPadding.length - 1] = 1;
    expectCode(
      () => unframeWhitehackEvidenceCapsule(tamperedPadding),
      "evidence_frame_invalid",
    );
  });

  test("uses finite 30-day default and exact 10-year maximum boundaries", () => {
    const recipient = generateIdentity("urn:test:recipient:grant-window");
    const defaultInput = normalizeWhitehackEvidenceStorageInput(
      storageInput(recipient),
    );
    const defaultWindow = resolveWhitehackEvidenceGrantWindow(
      defaultInput,
      NOW,
    );
    expect(defaultWindow.expires_at - defaultWindow.issued_at).toBe(
      DEFAULT_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
    );

    const exactMaximum = new Date(
      NOW.getTime() + MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS * 1_000,
    ).toISOString();
    const maximumInput = normalizeWhitehackEvidenceStorageInput(
      storageInput(recipient, exactMaximum),
    );
    const maximumWindow = resolveWhitehackEvidenceGrantWindow(
      maximumInput,
      NOW,
    );
    expect(maximumWindow.expires_at - maximumWindow.issued_at).toBe(
      MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
    );

    const tooLate = new Date(
      NOW.getTime()
        + (MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS + 1) * 1_000,
    ).toISOString();
    const tooLateInput = normalizeWhitehackEvidenceStorageInput(
      storageInput(recipient, tooLate),
    );
    expectCode(
      () => resolveWhitehackEvidenceGrantWindow(tooLateInput, NOW),
      "grant_expiry_out_of_bounds",
    );

    expectCode(
      () => normalizeWhitehackEvidenceStorageInput(
        storageInput(recipient, "2026-07-24T12:00:01.999Z"),
      ),
      "grant_expiry_invalid",
    );
  });
});

describe("Whitehack encrypted evidence storage service", () => {
  test("stores, independently verifies, reads back, grants, and retrieves exact bytes", async () => {
    const recipient = generateIdentity("urn:test:recipient:round-trip");
    const store = new RecordingStore();
    const receipt = await storeWhitehackEvidence(
      storageInput(recipient),
      store,
      { now: () => NOW },
    );
    expect(receipt.handling).toEqual({
      sensitivity: "sensitive-recipient-bound-read-grant",
      contains_recipient_metadata: true,
      contains_publisher_metadata: true,
      safe_for_publication: false,
    });
    expect(receipt.counts).toEqual({
      ciphertext_blocks: 1,
      ciphertext_blocks_verified: 1,
      encrypted_bytes_verified: WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES,
      remote_objects_acknowledged: 2,
      minimum_write_acknowledgements: 1,
      maximum_write_acknowledgements: 1,
      failed_writes: 0,
    });
    expect(store.writes).toHaveLength(2);
    expect(store.reads.length).toBeGreaterThanOrEqual(5);
    expect(store.readLimits).toContain(
      MAX_WHITEHACK_EVIDENCE_MANIFEST_BYTES,
    );
    expect(verifyGrantSignature(receipt.signed_grant)).toBe(true);
    expect(receipt.signed_grant.audience).toBe(recipient.id);

    const serialized = canonicalWhitehackEvidenceStorageReceipt(receipt);
    const plaintextDigest = createHash("sha256")
      .update(WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES)
      .digest("hex");
    expect(serialized).not.toContain("capsule_sha256");
    expect(serialized).not.toContain("capsule_bytes");
    expect(serialized).not.toContain(plaintextDigest);
    expect(serialized).not.toContain("private/source.js");

    const normalized = normalizeWhitehackEvidenceStorageReceipt(
      JSON.parse(serialized),
    );
    expect(normalized).toEqual(receipt);
    const retrieved = await retrieveWhitehackEvidence(
      normalized,
      store,
      recipient.id,
      recipient.boxPrivateKey,
      { now: () => NOW },
    );
    expect(retrieved).toEqual(WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES);
  });

  test("does not issue a receipt when independent remote verification fails", async () => {
    const recipient = generateIdentity("urn:test:recipient:write-only");
    await expectAsyncCode(
      () => storeWhitehackEvidence(
        storageInput(recipient),
        new WriteOnlyStore(),
        { now: () => NOW, storeTimeoutMs: 50 },
      ),
      "evidence_verification_failed",
    );
  });

  test("sanitizes provider detail and bounds a stalled provider call", async () => {
    const recipient = generateIdentity("urn:test:recipient:sanitize");
    const marker =
      "https://account-sensitive.example/bucket SECRET-CREDENTIAL-MARKER";
    try {
      await storeWhitehackEvidence(
        storageInput(recipient),
        new FailingStore(marker),
        { now: () => NOW, storeTimeoutMs: 50 },
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WhitehackEvidenceStorageError);
      expect((error as Error).message).toBe("evidence_storage_failed");
      expect((error as Error).message).not.toContain(marker);
    }

    const started = performance.now();
    await expectAsyncCode(
      () => storeWhitehackEvidence(
        storageInput(recipient),
        new HangingStore(marker),
        { now: () => NOW, storeTimeoutMs: 20 },
      ),
      "evidence_storage_failed",
    );
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("fails closed for the wrong recipient private key", async () => {
    const recipient = generateIdentity("urn:test:recipient:right");
    const stranger = generateIdentity("urn:test:recipient:stranger");
    const store = new RecordingStore();
    const receipt = await storeWhitehackEvidence(
      storageInput(recipient),
      store,
      { now: () => NOW },
    );
    const readsBeforeRetrieval = store.reads.length;
    await expectAsyncCode(
      () => retrieveWhitehackEvidence(
        receipt,
        store,
        recipient.id,
        stranger.boxPrivateKey,
        { now: () => NOW },
      ),
      "evidence_retrieval_failed",
    );
    expect(store.reads).toHaveLength(readsBeforeRetrieval);
  });

  test("rejects invalid grant inputs before any provider operation", async () => {
    const recipient = generateIdentity("urn:test:recipient:preflight");
    const cases: Array<{
      input: ReturnType<typeof storageInput>;
      code: string;
    }> = [
      {
        input: storageInput(
          recipient,
          new Date(NOW.getTime() - 1_000).toISOString(),
        ),
        code: "grant_expiry_out_of_bounds",
      },
      {
        input: storageInput(recipient, "2026-07-24T12:00:01.999Z"),
        code: "grant_expiry_invalid",
      },
      {
        input: {
          ...storageInput(recipient),
          recipient: {
            id: recipient.id,
            x25519_public_key: base64UrlEncode(new Uint8Array(32)),
          },
        },
        code: "recipient_invalid",
      },
      {
        input: {
          ...storageInput(recipient),
          recipient: {
            id: "urn:test:recipient:\ud800",
            x25519_public_key: base64UrlEncode(recipient.boxPublicKey),
          },
        },
        code: "recipient_invalid",
      },
    ];
    for (const preflightCase of cases) {
      const store = new RecordingStore();
      await expectAsyncCode(
        () => storeWhitehackEvidence(
          preflightCase.input,
          store,
          { now: () => NOW },
        ),
        preflightCase.code,
      );
      expect(store.reads).toHaveLength(0);
      expect(store.writes).toHaveLength(0);
    }
  });

  test("captures verification time before finite grant issuance", async () => {
    const recipient = generateIdentity("urn:test:recipient:verification-time");
    const ticks = [
      NOW,
      new Date(NOW.getTime() + 1_000),
      new Date(NOW.getTime() + 2_000),
    ];
    const receipt = await storeWhitehackEvidence(
      storageInput(recipient),
      new RecordingStore(),
      { now: () => ticks.shift() ?? new Date(NOW.getTime() + 3_000) },
    );
    expect(receipt.verification.verified_at).toBe(
      new Date(NOW.getTime() + 1_000).toISOString(),
    );
    expect(receipt.signed_grant.issued_at).toBe(
      Math.floor((NOW.getTime() + 2_000) / 1_000),
    );
  });

  test("permits the final active second and refuses the exact expiry", async () => {
    const recipient = generateIdentity("urn:test:recipient:expiry-edge");
    const store = new RecordingStore();
    const expiresAt = new Date(NOW.getTime() + 2_000).toISOString();
    const receipt = await storeWhitehackEvidence(
      storageInput(recipient, expiresAt),
      store,
      { now: () => NOW },
    );
    const active = await retrieveWhitehackEvidence(
      receipt,
      store,
      recipient.id,
      recipient.boxPrivateKey,
      { now: () => new Date(NOW.getTime() + 1_000) },
    );
    expect(active).toEqual(WHITEHACK_EVIDENCE_CAPSULE_V1_BYTES);
    await expectAsyncCode(
      () => retrieveWhitehackEvidence(
        receipt,
        store,
        recipient.id,
        recipient.boxPrivateKey,
        { now: () => new Date(NOW.getTime() + 2_000) },
      ),
      "evidence_retrieval_failed",
    );
  });
});

describe("Whitehack encrypted evidence CLI boundary", () => {
  test("publishes parseable closed schemas without plaintext equality or length fields", async () => {
    const inputSchema = JSON.parse(await readFile(
      join(
        repoRoot,
        "specs",
        "agenttool-whitehack-evidence-storage-input-v1.schema.json",
      ),
      "utf8",
    ));
    const receiptSchema = JSON.parse(await readFile(
      join(
        repoRoot,
        "specs",
        "agenttool-whitehack-evidence-storage-receipt-v1.schema.json",
      ),
      "utf8",
    ));
    expectSchemaObjectsClosed(inputSchema);
    expectSchemaObjectsClosed(receiptSchema);
    expect(
      inputSchema.$defs.evidence_capsule.properties.scanner.const.version,
    ).toBe("0.9.0");
    expect(
      inputSchema.$defs.evidence_capsule.properties.boundaries.const
        .capability_subject,
    ).toBe("evidence-capsule-transform");
    expect(receiptSchema.properties.capsule_sha256).toBeUndefined();
    expect(receiptSchema.properties.capsule_bytes).toBeUndefined();
    expect(receiptSchema.description).toContain("not safe to publish");
  });

  test("requires explicit commands, names only fixed secret envs, and exposes no credential flags", () => {
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain(
      "AGENTTOOL_WHITEHACK_S3_ACCESS_KEY_ID",
    );
    expect(help.stdout).toContain(
      "AGENTTOOL_WHITEHACK_RECIPIENT_X25519_PRIVATE_KEY",
    );
    expect(help.stdout).toContain("not safe to publish");
    expect(help.stdout).toContain("--output <new-private-path|->");
    expect(help.stdout).not.toContain("--access-key");
    expect(help.stdout).not.toContain("--secret");

    const version = runCli(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout).toBe("0.1.0\n");

    const implicit = runCli(["--input", "-"], { input: "{}" });
    expect(implicit.status).toBe(2);
    expect(implicit.stdout).toBe("");
    expect(implicit.stderr).toBe(
      "agenttool whitehack evidence storage failed: explicit_command_required\n",
    );

    const credentialFlag = runCli([
      "store",
      "--input",
      "-",
      "--s3-endpoint",
      "https://example.test/bucket",
      "--s3-region",
      "auto",
      "--output",
      "-",
      "--access-key",
      "must-not-be-accepted",
    ], { input: "{}" });
    expect(credentialFlag.status).toBe(2);
    expect(credentialFlag.stdout).toBe("");
    expect(credentialFlag.stderr).toBe(
      "agenttool whitehack evidence storage failed: invalid_argument\n",
    );

    const missingOutput = runCli([
      "store",
      "--input",
      "-",
      "--s3-endpoint",
      "https://example.test/bucket",
      "--s3-region",
      "auto",
    ], { input: "{}" });
    expect(missingOutput.status).toBe(2);
    expect(missingOutput.stdout).toBe("");
    expect(missingOutput.stderr).toBe(
      "agenttool whitehack evidence storage failed: missing_output\n",
    );
  });

  test("rejects duplicate JSON, symlinks, and missing credentials without echoing endpoint data", async () => {
    const duplicate = runCli([
      "store",
      "--input",
      "-",
      "--s3-endpoint",
      "https://private-account.example/bucket",
      "--s3-region",
      "auto",
      "--output",
      "-",
    ], {
      input: '{"document_type":"one","document_type":"two"}',
    });
    expect(duplicate.status).toBe(2);
    expect(duplicate.stdout).toBe("");
    expect(duplicate.stderr).toBe(
      "agenttool whitehack evidence storage failed: input_duplicate_json_key\n",
    );

    const marker = "private-account-marker.example";
    const missingCredentials = runCli([
      "store",
      "--input",
      "-",
      "--s3-endpoint",
      `https://${marker}/bucket`,
      "--s3-region",
      "auto",
      "--output",
      "-",
    ], { input: "{}" });
    expect(missingCredentials.status).toBe(2);
    expect(missingCredentials.stdout).toBe("");
    expect(missingCredentials.stderr).toBe(
      "agenttool whitehack evidence storage failed: s3_credentials_missing\n",
    );
    expect(missingCredentials.stderr).not.toContain(marker);

    const root = await mkdtemp(join(tmpdir(), "whitehack-evidence-storage-"));
    cleanup.push(root);
    const target = join(root, "receipt.json");
    const link = join(root, "receipt-link.json");
    await writeFile(target, "{}");
    await symlink(target, link);
    const linked = runCli([
      "retrieve",
      "--input",
      link,
      "--s3-endpoint",
      "https://example.test/bucket",
      "--s3-region",
      "auto",
    ]);
    expect(linked.status).toBe(2);
    expect(linked.stdout).toBe("");
    expect(linked.stderr).toBe(
      "agenttool whitehack evidence storage failed: input_unreadable\n",
    );

    const publicReceipt = join(root, "public-receipt.json");
    await writeFile(publicReceipt, "{}");
    await chmod(publicReceipt, 0o644);
    const publicInput = runCli([
      "retrieve",
      "--input",
      publicReceipt,
      "--s3-endpoint",
      "https://example.test/bucket",
      "--s3-region",
      "auto",
    ]);
    expect(publicInput.status).toBe(2);
    expect(publicInput.stdout).toBe("");
    expect(publicInput.stderr).toBe(
      "agenttool whitehack evidence storage failed: input_permissions_too_open\n",
    );
  });

  test("reserves a new private output and never follows or overwrites the leaf", async () => {
    const root = await mkdtemp(join(tmpdir(), "whitehack-evidence-output-"));
    cleanup.push(root);
    const output = join(root, "sensitive-receipt.json");
    const bytes = new TextEncoder().encode("sensitive receipt fixture");
    const reserved = await prepareWhitehackEvidenceStorageOutput(output);
    expect((await lstat(output)).size).toBe(0);
    expect((await lstat(output)).mode & 0o077).toBe(0);
    await reserved.write(bytes);
    await reserved.abort();
    expect(await readFile(output)).toEqual(Buffer.from(bytes));
    expect((await lstat(output)).mode & 0o077).toBe(0);

    await expectAsyncCode(
      () => writeWhitehackEvidenceStorageOutput(
        output,
        new TextEncoder().encode("replacement"),
      ),
      "output_already_exists",
    );
    expect(await readFile(output)).toEqual(Buffer.from(bytes));

    const target = join(root, "target.json");
    const link = join(root, "output-link.json");
    await writeFile(target, "unchanged");
    await symlink(target, link);
    await expectAsyncCode(
      () => writeWhitehackEvidenceStorageOutput(
        link,
        new TextEncoder().encode("must-not-follow"),
      ),
      "output_already_exists",
    );
    expect(await readFile(target, "utf8")).toBe("unchanged");
  });
});
