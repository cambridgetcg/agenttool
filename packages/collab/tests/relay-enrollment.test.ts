import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import {
  enrollRelay,
} from "../src/relay-enrollment.js";
import {
  defaultRelayCredentialPath,
  readRelayCredentialFile,
  relayTokenPrefix,
  relayTokenSha256,
  type RelaySecretStore,
  type RelayTokenReference,
  writeRelayCredentialFile,
} from "../src/relay-credential.js";
import type { RelayEnrolmentRequest } from "../src/relay-contract.js";
import {
  relayEnrolmentIdempotencyKey,
  requestSha256,
} from "../src/relay-contract.js";
import {
  DEVICE_ID,
  NOW,
  profile,
  PROJECT_BEARER,
  RELAY_TOKEN,
  REPOSITORY_ID,
  TOKEN_PREFIX,
} from "./relay-fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-relay-enrol-"));
  temporaryDirectories.push(directory);
  return directory;
}

class MemorySecretStore implements RelaySecretStore {
  readonly source = "environment" as const;
  removed = false;
  stores = 0;
  resolves = 0;

  constructor(readonly token = RELAY_TOKEN) {}

  existingToken(): string {
    return this.token;
  }

  store(token: string): RelayTokenReference {
    expect(token).toBe(this.token);
    this.stores += 1;
    return this.reference();
  }

  resolve(reference: RelayTokenReference): string {
    expect(reference).toEqual(this.reference());
    this.resolves += 1;
    return this.token;
  }

  remove(reference: RelayTokenReference): void {
    expect(reference).toEqual(this.reference());
    this.removed = true;
  }

  reference(): RelayTokenReference {
    return {
      source: "environment",
      variable: "AGENTOOL_COLLAB_RELAY_TOKEN",
      prefix: relayTokenPrefix(this.token),
    };
  }
}

function enrollmentFetch(
  requests: RelayEnrolmentRequest[],
  created = true,
) {
  return async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as RelayEnrolmentRequest;
    requests.push(request);
    return Response.json({
      schema: "agenttool.collab-enrolment-result/1",
      replayed: false,
      receipt: {
        idempotency_key: request.idempotency_key,
        request_sha256: requestSha256(request),
        recorded_at: NOW,
      },
      repository: {
        id: REPOSITORY_ID,
        ...request.repository,
      },
      device: {
        id: request.device.id,
        label: request.device.label,
        token_prefix: request.token.prefix,
        active: true,
        version: request.expected_device_version + 1,
      },
      observation_policy: request.observation_policy,
      created,
    });
  };
}

function pendingEnrollmentRequest(
  label: string,
): RelayEnrolmentRequest {
  const intent: Omit<RelayEnrolmentRequest, "idempotency_key"> = {
    schema: "agenttool.collab-enrolment/1",
    expected_device_version: 0,
    repository: profile.repository,
    device: { id: DEVICE_ID, label },
    observation_policy: {
      profile_sha256: requestSha256(profile),
      allowed_providers: [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    },
    token: {
      prefix: TOKEN_PREFIX,
      sha256: relayTokenSha256(RELAY_TOKEN),
    },
  };
  return {
    ...intent,
    idempotency_key: relayEnrolmentIdempotencyKey(intent),
  };
}

describe("explicit relay enrollment", () => {
  test("stores only secret metadata and never returns the raw relay bearer", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "private", "relay.json");
    const store = new MemorySecretStore();
    const requests: RelayEnrolmentRequest[] = [];

    const result = await enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Yu Mac",
      credential_path: credentialPath,
      secret_store: store,
      fetch: enrollmentFetch(requests),
      now: () => NOW,
    });

    expect(result.enrolment.created).toBe(true);
    expect(result.token_prefix).toBe(TOKEN_PREFIX);
    expect(JSON.stringify(result)).not.toContain(RELAY_TOKEN);
    expect(readFileSync(credentialPath, "utf8")).not.toContain(RELAY_TOKEN);
    expect(readRelayCredentialFile(credentialPath)).toMatchObject({
      state: "active",
      repository: { key: profile.repository.key, id: REPOSITORY_ID },
      device: { id: DEVICE_ID, label: "Yu Mac", version: 1 },
      token: { source: "environment", prefix: TOKEN_PREFIX },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.token).toEqual({
      prefix: TOKEN_PREFIX,
      sha256: relayTokenSha256(RELAY_TOKEN),
    });
    expect(requests[0]!.expected_device_version).toBe(0);
    expect(requests[0]!.idempotency_key).toBe(
      relayEnrolmentIdempotencyKey(requests[0]!),
    );
    expect(requests[0]!.observation_policy).toEqual({
      profile_sha256: requestSha256(profile),
      allowed_providers: [
        "cloudflare-pages",
        "fly",
        "github",
        "npm",
      ],
    });
    expect(JSON.stringify(requests[0])).not.toContain(RELAY_TOKEN);
  });

  test("retries an explicit credential with its stable UUID and updates only its mutable label", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "relay.json");
    const store = new MemorySecretStore();
    const requests: RelayEnrolmentRequest[] = [];

    await enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Old label",
      credential_path: credentialPath,
      secret_store: store,
      fetch: enrollmentFetch(requests),
      now: () => NOW,
    });
    await enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_label: "New label",
      credential_path: credentialPath,
      secret_store: store,
      fetch: enrollmentFetch(requests, false),
      now: () => "2026-07-23T12:01:00.000Z",
    });

    expect(requests.map((request) => request.device)).toEqual([
      { id: DEVICE_ID, label: "Old label" },
      { id: DEVICE_ID, label: "New label" },
    ]);
    expect(requests[1]!.token).toEqual(requests[0]!.token);
    expect(requests.map((request) => request.expected_device_version)).toEqual([
      0,
      1,
    ]);
    expect(requests[1]!.idempotency_key).not.toBe(
      requests[0]!.idempotency_key,
    );
    expect(store.stores).toBe(1);
    expect(store.resolves).toBe(1);
    expect(readRelayCredentialFile(credentialPath).device).toEqual({
      id: DEVICE_ID,
      label: "New label",
      version: 2,
    });
  });

  test("resumes a pending lost-response enrollment using only its printed credential path", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "relay.json");
    const store = new MemorySecretStore();
    writeRelayCredentialFile(credentialPath, {
      format: "agenttool.collab/relay-credential/1",
      state: "pending",
      relay_url: "https://relay.example",
      repository: { key: profile.repository.key, id: null },
      device: { id: DEVICE_ID, label: "Initial label", version: 0 },
      token: store.reference(),
      pending_enrolment: pendingEnrollmentRequest("Initial label"),
      created_at: NOW,
      updated_at: NOW,
    });
    const requests: RelayEnrolmentRequest[] = [];

    await enrollRelay({
      profile: {
        ...profile,
        repository: {
          ...profile.repository,
          display_name: "changed after the response was lost",
        },
      },
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_label: "Recovered label",
      credential_path: credentialPath,
      secret_store: store,
      fetch: enrollmentFetch(requests),
      now: () => "2026-07-23T12:02:00.000Z",
    });

    expect(requests[0]!.device.id).toBe(DEVICE_ID);
    expect(readRelayCredentialFile(credentialPath)).toMatchObject({
      state: "active",
      repository: { id: REPOSITORY_ID },
      device: { id: DEVICE_ID, label: "Initial label", version: 1 },
    });
    expect(requests[0]!.device.label).toBe("Initial label");
    expect(requests[0]!.repository).toEqual(profile.repository);
    expect(requests[0]!.expected_device_version).toBe(0);
  });

  test("preserves a newly stored secret and pending file after ambiguous network failure", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "private", "relay.json");
    const store = new MemorySecretStore();

    await expect(enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Yu Mac",
      credential_path: credentialPath,
      secret_store: store,
      fetch: async () => {
        throw new Error(`network failure ${RELAY_TOKEN}`);
      },
    })).rejects.toMatchObject({ code: "relay_unavailable" });

    expect(store.removed).toBe(false);
    expect(existsSync(credentialPath)).toBe(true);
    expect(readRelayCredentialFile(credentialPath)).toMatchObject({
      state: "pending",
      device: { id: DEVICE_ID, version: 0 },
      token: { prefix: TOKEN_PREFIX },
    });
  });

  test("recovers an ambiguous first run through the stable repository default path", async () => {
    const root = temporaryDirectory();
    const stateEnv = { XDG_STATE_HOME: root };
    const store = new MemorySecretStore();
    const requests: RelayEnrolmentRequest[] = [];

    await expect(enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_label: "Yu Mac",
      secret_store: store,
      state_env: stateEnv,
      fetch: async (_input, init) => {
        requests.push(
          JSON.parse(String(init?.body)) as RelayEnrolmentRequest,
        );
        throw new Error("ambiguous network failure");
      },
      now: () => NOW,
    })).rejects.toMatchObject({ code: "relay_unavailable" });

    const credentialPath = defaultRelayCredentialPath(
      profile.repository.key,
      undefined,
      stateEnv,
    );
    const pending = readRelayCredentialFile(credentialPath);
    const recovered = await enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_label: "ignored while exact request is pending",
      secret_store: store,
      state_env: stateEnv,
      fetch: enrollmentFetch(requests),
      now: () => "2026-07-23T12:01:00.000Z",
    });

    expect(recovered.credential_file).toBe(credentialPath);
    expect(recovered.enrolment.device.id).toBe(pending.device.id);
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    expect(readRelayCredentialFile(credentialPath)).toMatchObject({
      state: "active",
      device: { id: pending.device.id, version: 1 },
    });
  });

  test("refuses to activate an older response over a changed local pending fence", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "relay.json");
    const store = new MemorySecretStore();
    let newerRequest: RelayEnrolmentRequest | null = null;

    await expect(enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Older request",
      credential_path: credentialPath,
      secret_store: store,
      fetch: async (_input, init) => {
        const request = JSON.parse(
          String(init?.body),
        ) as RelayEnrolmentRequest;
        const newerIntent: Omit<
          RelayEnrolmentRequest,
          "idempotency_key"
        > = {
          ...request,
          device: { ...request.device, label: "Newer request" },
        };
        newerRequest = {
          ...newerIntent,
          idempotency_key: relayEnrolmentIdempotencyKey(newerIntent),
        };
        const prior = readRelayCredentialFile(credentialPath);
        writeRelayCredentialFile(credentialPath, {
          ...prior,
          device: { ...prior.device, label: "Newer request" },
          pending_enrolment: newerRequest,
          updated_at: "2026-07-23T12:00:01.000Z",
        }, { replace: true });
        return Response.json({
          schema: "agenttool.collab-enrolment-result/1",
          replayed: false,
          receipt: {
            idempotency_key: request.idempotency_key,
            request_sha256: requestSha256(request),
            recorded_at: NOW,
          },
          repository: { id: REPOSITORY_ID, ...request.repository },
          device: {
            id: request.device.id,
            label: request.device.label,
            token_prefix: request.token.prefix,
            active: true,
            version: 1,
          },
          observation_policy: request.observation_policy,
          created: true,
        });
      },
      now: () => NOW,
    })).rejects.toMatchObject({
      code: "relay_enrolment_local_fence_changed",
    });

    const preserved = readRelayCredentialFile(credentialPath);
    expect(preserved.state).toBe("pending");
    expect(preserved.pending_enrolment).toEqual(newerRequest);
    expect(preserved.device.label).toBe("Newer request");
  });

  test("serializes concurrent local enrollment of the same credential file", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "relay.json");
    const store = new MemorySecretStore();
    const requests: RelayEnrolmentRequest[] = [];
    const respond = enrollmentFetch(requests);
    let announceStarted!: () => void;
    let releaseResponse!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const first = enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "First process",
      credential_path: credentialPath,
      secret_store: store,
      fetch: async (input, init) => {
        announceStarted();
        await responseGate;
        return await respond(input, init);
      },
      now: () => NOW,
    });
    await started;

    await expect(enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Second process",
      credential_path: credentialPath,
      secret_store: store,
      fetch: respond,
      now: () => NOW,
    })).rejects.toMatchObject({ code: "relay_enrolment_in_progress" });

    releaseResponse();
    await first;
    expect(requests).toHaveLength(1);
    expect(readRelayCredentialFile(credentialPath).device.label).toBe(
      "First process",
    );
  });

  test("preserves exact pending recovery metadata when post-success activation fails", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "private", "relay.json");
    const store = new MemorySecretStore();
    const requests: RelayEnrolmentRequest[] = [];
    const respond = enrollmentFetch(requests);

    await expect(enrollRelay({
      profile,
      relay_url: "https://relay.example",
      project_bearer: PROJECT_BEARER,
      device_id: DEVICE_ID,
      device_label: "Yu Mac",
      credential_path: credentialPath,
      secret_store: store,
      fetch: async (input, init) => {
        const response = await respond(input, init);
        chmodSync(credentialPath, 0o644);
        return response;
      },
      now: () => NOW,
    })).rejects.toMatchObject({
      code: "relay_credential_file_not_private",
    });

    expect(store.removed).toBe(false);
    expect(existsSync(credentialPath)).toBe(true);
    const pendingText = readFileSync(credentialPath, "utf8");
    expect(pendingText).toContain('"state": "pending"');
    expect(pendingText).toContain('"pending_enrolment": {');
    expect(pendingText).not.toContain(RELAY_TOKEN);
    chmodSync(credentialPath, 0o600);
    expect(readRelayCredentialFile(credentialPath).pending_enrolment).toEqual(
      requests[0]!,
    );
  });

  test("preserves an existing pending secret and metadata after a retry failure", async () => {
    const root = temporaryDirectory();
    const credentialPath = join(root, "relay.json");
    const store = new MemorySecretStore();
    writeRelayCredentialFile(credentialPath, {
      format: "agenttool.collab/relay-credential/1",
      state: "pending",
      relay_url: "https://relay.example",
      repository: { key: profile.repository.key, id: null },
      device: { id: DEVICE_ID, label: "Yu Mac", version: 0 },
      token: store.reference(),
      pending_enrolment: pendingEnrollmentRequest("Yu Mac"),
      created_at: NOW,
      updated_at: NOW,
    });
    const before = readFileSync(credentialPath, "utf8");

    try {
      await enrollRelay({
        profile,
        relay_url: "https://relay.example",
        project_bearer: PROJECT_BEARER,
        device_label: "New label",
        credential_path: credentialPath,
        secret_store: store,
        now: () => NOW,
        fetch: async () => Response.json(
          { error: { code: "denied", message: RELAY_TOKEN } },
          { status: 403 },
        ),
      });
      throw new Error("expected enrollment to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CollabError);
      expect(JSON.stringify(error)).not.toContain(RELAY_TOKEN);
      expect((error as Error).message).not.toContain(RELAY_TOKEN);
    }

    expect(store.removed).toBe(false);
    expect(readFileSync(credentialPath, "utf8")).toBe(before);
  });
});
