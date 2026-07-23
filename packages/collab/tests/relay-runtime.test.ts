import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeRelayCredentialFile,
} from "../src/relay-credential.js";
import {
  loadRelayRuntimeFromEnvironment,
} from "../src/relay-runtime.js";
import {
  credential,
  DEVICE_ID,
  enrolmentRequest,
  profile,
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
  const directory = mkdtempSync(join(tmpdir(), "agenttool-relay-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("optional relay runtime", () => {
  test("does nothing unless a relay URL is explicitly configured", () => {
    expect(loadRelayRuntimeFromEnvironment({ env: {} })).toBeUndefined();
  });

  test("loads one exact profile, credential metadata file, and scoped environment token", () => {
    const root = temporaryDirectory();
    const profilePath = join(root, "project.json");
    const credentialPath = join(root, "private", "relay.json");
    writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
    writeRelayCredentialFile(credentialPath, credential.metadata);

    const runtime = loadRelayRuntimeFromEnvironment({
      cwd: root,
      env: {
        AGENTOOL_COLLAB_RELAY_URL: "https://relay.example",
        AGENTOOL_COLLAB_PROJECT_FILE: profilePath,
        AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE: credentialPath,
        AGENTOOL_COLLAB_RELAY_TOKEN: RELAY_TOKEN,
      },
      fetch: async () => Response.json({}),
    });

    expect(runtime?.credential_file).toBe(credentialPath);
    expect(runtime?.profile.profile).toEqual(profile);
    expect(runtime?.client.context()).toEqual({
      relay_url: "https://relay.example",
      repository_id: REPOSITORY_ID,
      repository_key: profile.repository.key,
      device_id: DEVICE_ID,
      project_id: profile.project_id,
      authentication_boundary:
        "scoped_device_bearer_coordinates_participating_clients_but_grants_no_provider_authority",
    });
    expect(JSON.stringify(runtime?.client.context())).not.toContain(
      RELAY_TOKEN,
    );
  });

  test("fails closed on missing metadata, URL mismatch, or token-prefix mismatch", () => {
    expect(() => loadRelayRuntimeFromEnvironment({
      env: { AGENTOOL_COLLAB_RELAY_URL: "https://relay.example" },
    })).toThrowError(expect.objectContaining({
      code: "relay_credential_file_required",
    }));

    const root = temporaryDirectory();
    const profilePath = join(root, "project.json");
    const credentialPath = join(root, "private", "relay.json");
    writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
    writeRelayCredentialFile(credentialPath, credential.metadata);

    const base = {
      AGENTOOL_COLLAB_PROJECT_FILE: profilePath,
      AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE: credentialPath,
      AGENTOOL_COLLAB_RELAY_TOKEN: RELAY_TOKEN,
    };
    expect(() => loadRelayRuntimeFromEnvironment({
      env: {
        ...base,
        AGENTOOL_COLLAB_RELAY_URL: "https://other-relay.example",
      },
    })).toThrowError(expect.objectContaining({
      code: "relay_credential_url_mismatch",
    }));
    expect(() => loadRelayRuntimeFromEnvironment({
      env: {
        ...base,
        AGENTOOL_COLLAB_RELAY_URL: "https://relay.example",
        AGENTOOL_COLLAB_RELAY_TOKEN: `atc_${"B".repeat(43)}`,
      },
    })).toThrowError(expect.objectContaining({
      code: "relay_token_prefix_mismatch",
    }));
  });

  test("rejects pending metadata rather than falling back to local coordination", () => {
    const root = temporaryDirectory();
    const profilePath = join(root, "project.json");
    const credentialPath = join(root, "private", "relay.json");
    writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
    writeRelayCredentialFile(credentialPath, {
      ...credential.metadata,
      state: "pending",
      repository: {
        key: profile.repository.key,
        id: null,
      },
      device: {
        ...credential.metadata.device,
        version: 0,
      },
      token: {
        source: "environment",
        variable: "AGENTOOL_COLLAB_RELAY_TOKEN",
        prefix: TOKEN_PREFIX,
      },
      pending_enrolment: enrolmentRequest,
    });

    expect(() => loadRelayRuntimeFromEnvironment({
      env: {
        AGENTOOL_COLLAB_RELAY_URL: "https://relay.example",
        AGENTOOL_COLLAB_PROJECT_FILE: profilePath,
        AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE: credentialPath,
        AGENTOOL_COLLAB_RELAY_TOKEN: RELAY_TOKEN,
      },
    })).toThrowError(expect.objectContaining({
      code: "relay_enrolment_pending",
    }));
  });
});
