import { CollabError } from "./errors.js";
import {
  loadProjectProfile,
  PROJECT_PROFILE_ENV,
  type LoadedProjectProfile,
} from "./project-profile.js";
import {
  EnvironmentRelaySecretStore,
  MacOSKeychainRelaySecretStore,
  normalizeRelayUrl,
  readRelayCredentialFile,
  RELAY_CREDENTIAL_FILE_ENV,
  resolveRelayCredential,
} from "./relay-credential.js";
import {
  CollabRelayClient,
  type RelayFetch,
} from "./relay-client.js";

export const RELAY_URL_ENV = "AGENTOOL_COLLAB_RELAY_URL" as const;

export interface LoadedRelayRuntime {
  client: CollabRelayClient;
  profile: LoadedProjectProfile;
  credential_file: string;
}

export function loadRelayRuntimeFromEnvironment(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetch?: RelayFetch;
} = {}): LoadedRelayRuntime | undefined {
  const env = options.env ?? process.env;
  const configuredUrl = env[RELAY_URL_ENV];
  if (!configuredUrl) return undefined;
  const relayUrl = normalizeRelayUrl(configuredUrl);
  const credentialPath = env[RELAY_CREDENTIAL_FILE_ENV];
  if (!credentialPath) {
    throw new CollabError(
      "relay_credential_file_required",
      `${RELAY_CREDENTIAL_FILE_ENV} is required when ${RELAY_URL_ENV} is set`,
    );
  }
  const profile = loadProjectProfile({
    cwd: options.cwd,
    path: env[PROJECT_PROFILE_ENV],
    env,
  });
  const metadata = readRelayCredentialFile(credentialPath);
  if (normalizeRelayUrl(metadata.relay_url) !== relayUrl) {
    throw new CollabError(
      "relay_credential_url_mismatch",
      "Configured relay URL does not match the scoped credential metadata",
    );
  }
  const credential = resolveRelayCredential(metadata, {
    keychain: new MacOSKeychainRelaySecretStore(),
    environment: new EnvironmentRelaySecretStore(env),
  });
  return {
    client: new CollabRelayClient({
      credential,
      profile: profile.profile,
      fetch: options.fetch,
    }),
    profile,
    credential_file: credentialPath,
  };
}
