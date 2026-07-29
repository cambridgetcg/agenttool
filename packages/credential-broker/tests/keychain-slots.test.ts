import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashAuditPath } from "../src/audit.js";
import {
  createCredentialHandoffManifest,
  hashCredentialVerificationProfile,
  loadCredentialHandoffManifest,
  makeKeychainSlotRecord,
  materializeManagedReference,
  saveCredentialHandoffManifest,
  selectManifestSlot,
  type CredentialHandoffManifest,
  type KeychainSlotRecord,
} from "../src/keychain-slots.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  path: string;
  manifest: ReturnType<typeof createCredentialHandoffManifest>;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentcred-slots-"));
  roots.push(root);
  await chmod(root, 0o700);
  const path = join(root, "credential.json");
  const manifest = createCredentialHandoffManifest({
    credential: "brightdata/proxy",
    provider: "brightdata",
    purpose: "bounded-proxy",
    environment: "local",
    account: "test-owner",
    auth: { kind: "header", headerName: "x-api-key" },
    verification: {
      operation: "http.fetch",
      origin: "https://api.example.com",
      path: "/v1/whoami",
      targetPathHash: hashAuditPath("/v1/whoami"),
      method: "GET",
      successStatus: 200,
      revokedStatus: 401,
    },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  await saveCredentialHandoffManifest(path, manifest, { create: true });
  return { root, path, manifest };
}

function installBootstrapHistory(
  manifest: CredentialHandoffManifest,
  slot: KeychainSlotRecord,
): void {
  manifest.activeSlot = "a";
  manifest.slots.a = slot;
  manifest.closures = [
    {
      rotationId: randomUUID(),
      outcome: "bootstrapped",
      startedAt: slot.createdAt,
      candidateVerifiedAt: "2026-07-29T12:01:30.000Z",
      closedAt: "2026-07-29T12:02:00.000Z",
      toGenerationId: slot.generationId,
      evidence: [
        {
          kind: "broker-positive",
          at: "2026-07-29T12:01:20.000Z",
          evidenceId: randomUUID(),
          generationId: slot.generationId,
          brokerCredential: "brightdata/candidate",
          verificationProfileHash: hashCredentialVerificationProfile(
            manifest.verification,
          ),
          status: manifest.verification.successStatus,
        },
      ],
    },
  ];
  manifest.revision = 1;
  manifest.updatedAt = "2026-07-29T12:02:00.000Z";
}

describe("owner-only Keychain slot manifests", () => {
  test("round-trips metadata without credential material", async () => {
    const { path } = await fixture();
    const loaded = await loadCredentialHandoffManifest(path);

    expect(loaded.schema).toBe("agentcred-handoff/0.1");
    expect(loaded.activeSlot).toBeNull();
    expect(loaded.slots).toEqual({ a: null, b: null });
    expect(JSON.stringify(loaded)).not.toMatch(/secret|password|token/i);
  });

  test("rejects secret-like unknown fields instead of retaining them", async () => {
    const { path, manifest } = await fixture();
    const sentinel = "agentcred-test-sentinel-never-real";
    await writeFile(
      path,
      JSON.stringify({ ...manifest, value: sentinel }),
      { mode: 0o600 },
    );

    await expect(loadCredentialHandoffManifest(path)).rejects.toThrow(
      "unknown field",
    );
    try {
      await loadCredentialHandoffManifest(path);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });

  test("create-only initialization never overwrites an existing manifest", async () => {
    const { path, manifest } = await fixture();
    const original = await loadCredentialHandoffManifest(path);
    manifest.credential = "agenttool/replacement";

    await expect(
      saveCredentialHandoffManifest(path, manifest, { create: true }),
    ).rejects.toThrow("already exists");
    expect((await loadCredentialHandoffManifest(path)).credential).toBe(
      original.credential,
    );
  });

  test("refuses a symlink and a group-readable manifest", async () => {
    const { root, path } = await fixture();
    const link = join(root, "link.json");
    await symlink(path, link);
    await expect(loadCredentialHandoffManifest(link)).rejects.toThrow();

    await chmod(path, 0o640);
    await expect(loadCredentialHandoffManifest(path)).rejects.toThrow(
      "mode 0600",
    );
  });

  test("selects explicit lifecycle slots and freezes a materialized reference", async () => {
    const { path, manifest } = await fixture();
    const first = makeKeychainSlotRecord({
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const second = makeKeychainSlotRecord({
      now: new Date("2026-07-29T12:03:00.000Z"),
    });
    installBootstrapHistory(manifest, first);
    manifest.slots.b = second;
    manifest.rotation = {
      rotationId: randomUUID(),
      phase: "staged",
      fromSlot: "a",
      toSlot: "b",
      startedAt: "2026-07-29T12:03:00.000Z",
      overlapDeadline: "2026-07-29T13:00:00.000Z",
      evidence: [],
    };
    manifest.revision = 2;
    manifest.updatedAt = "2026-07-29T12:03:00.000Z";
    await saveCredentialHandoffManifest(path, manifest);

    const active = await materializeManagedReference({
      backend: "managed-macos-keychain",
      manifestPath: path,
      selection: "active",
      auth: manifest.auth,
    });
    expect(active.service).toBe(first.service);
    expect(selectManifestSlot(manifest, "candidate").service).toBe(second.service);

    manifest.rotation.phase = "cutover";
    manifest.rotation.candidateVerifiedAt = "2026-07-29T12:03:30.000Z";
    manifest.rotation.cutoverAt = "2026-07-29T12:04:00.000Z";
    manifest.rotation.evidence = [
      {
        kind: "broker-positive",
        at: "2026-07-29T12:03:20.000Z",
        evidenceId: randomUUID(),
        generationId: second.generationId,
        brokerCredential: "brightdata/candidate",
        verificationProfileHash: hashCredentialVerificationProfile(
          manifest.verification,
        ),
        status: manifest.verification.successStatus,
      },
    ];
    manifest.activeSlot = "b";
    manifest.revision = 3;
    manifest.updatedAt = "2026-07-29T12:04:00.000Z";
    await saveCredentialHandoffManifest(path, manifest);

    expect(active.service).toBe(first.service);
    expect(
      (
        await materializeManagedReference({
          backend: "managed-macos-keychain",
          manifestPath: path,
          selection: "active",
          auth: manifest.auth,
        })
      ).service,
    ).toBe(second.service);
    expect(selectManifestSlot(manifest, "previous").service).toBe(first.service);
  });

  test("fails closed when config auth differs from manifest auth", async () => {
    const { path, manifest } = await fixture();
    installBootstrapHistory(
      manifest,
      makeKeychainSlotRecord({
        now: new Date("2026-07-29T12:01:00.000Z"),
      }),
    );
    await saveCredentialHandoffManifest(path, manifest);

    await expect(
      materializeManagedReference({
        backend: "managed-macos-keychain",
        manifestPath: path,
        selection: "active",
        auth: { kind: "bearer" },
      }),
    ).rejects.toThrow("does not match");
  });

  test("rejects a manually populated active slot without lifecycle history", async () => {
    const { path, manifest } = await fixture();
    manifest.activeSlot = "a";
    manifest.slots.a = makeKeychainSlotRecord({
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    manifest.updatedAt = "2026-07-29T12:01:00.000Z";

    await expect(saveCredentialHandoffManifest(path, manifest)).rejects.toThrow(
      "generation history",
    );
  });

  test("reasserts evidence freshness and candidate expiry invariants while parsing", async () => {
    const { path, manifest } = await fixture();
    const first = makeKeychainSlotRecord({
      now: new Date("2026-07-29T12:01:00.000Z"),
    });
    const second = makeKeychainSlotRecord({
      now: new Date("2026-07-29T12:03:00.000Z"),
    });
    installBootstrapHistory(manifest, first);
    manifest.slots.b = second;
    manifest.rotation = {
      rotationId: randomUUID(),
      phase: "verified_new",
      fromSlot: "a",
      toSlot: "b",
      startedAt: "2026-07-29T12:03:00.000Z",
      overlapDeadline: "2026-07-29T13:00:00.000Z",
      candidateVerifiedAt: "2026-07-29T12:10:00.000Z",
      evidence: [
        {
          kind: "broker-positive",
          at: "2026-07-29T12:03:20.000Z",
          evidenceId: randomUUID(),
          generationId: second.generationId,
          brokerCredential: "brightdata/candidate",
          verificationProfileHash: hashCredentialVerificationProfile(
            manifest.verification,
          ),
          status: manifest.verification.successStatus,
        },
      ],
    };
    manifest.revision = 2;
    manifest.updatedAt = "2026-07-29T12:10:00.000Z";
    await expect(saveCredentialHandoffManifest(path, manifest)).rejects.toThrow(
      "outside its verification window",
    );

    manifest.rotation.phase = "staged";
    delete manifest.rotation.candidateVerifiedAt;
    manifest.rotation.evidence = [];
    second.expiresAt = "2026-07-29T12:30:00.000Z";
    manifest.updatedAt = "2026-07-29T12:03:00.000Z";
    await expect(saveCredentialHandoffManifest(path, manifest)).rejects.toThrow(
      "expiry must follow the overlap deadline",
    );
  });

  test("rejects noncanonical managed verification paths", () => {
    for (const path of [
      "/a/../b",
      "/a\\b",
      "/a/%2e/b",
      "/a/%2f/b",
      "/a/%5c/b",
    ]) {
      expect(() =>
        createCredentialHandoffManifest({
          credential: "brightdata/proxy",
          provider: "brightdata",
          purpose: "bounded-proxy",
          environment: "local",
          account: "test-owner",
          auth: { kind: "header", headerName: "x-api-key" },
          verification: {
            operation: "http.fetch",
            origin: "https://api.example.com",
            path,
            targetPathHash: hashAuditPath(path),
            method: "GET",
            successStatus: 200,
            revokedStatus: 401,
          },
        }),
      ).toThrow("canonical");
    }
  });
});
