import { BrowserError } from "./errors.js";

export const BROWSER_CAPABILITIES_SCHEMA =
  "agent-browser-capabilities/0.2" as const;

export type BrowserAuthorityPreset = "public" | "local" | "sovereign";
export type EffectiveBrowserAuthority =
  | BrowserAuthorityPreset
  | "legacy_custom";

export interface BrowserCapabilitySet {
  schema: typeof BROWSER_CAPABILITIES_SCHEMA;
  authority: {
    profile: EffectiveBrowserAuthority;
    fixedAt: "process_start";
  };
  network: {
    public: boolean;
    local: boolean;
    reserved: boolean;
    schemes: readonly ["http", "https"];
    urlCredentials: "blocked";
    dnsPreflight: "classify" | "browser";
    connectionAddressPinning: false;
    webSockets: "blocked" | "classified" | "browser";
  };
  runtime: {
    chromiumSandbox: true;
    serviceWorkers: "block" | "allow";
    tlsErrors: "reject";
    profile: "ephemeral" | "dedicated_persistent";
  };
  features: {
    interaction: "enabled";
    screenshots: "enabled";
    persistentProfile: "enabled" | "requires_configuration";
    uploads: "unsupported";
    downloads: "unsupported";
    pageEvaluation: "unsupported";
    credentialInjection: "unsupported";
    shell: "unsupported";
  };
  statement: string;
}

export interface ResolveBrowserCapabilitiesOptions {
  authority?: BrowserAuthorityPreset;
  /** @deprecated Use a named authority preset. Retained for v0.1 compatibility. */
  allowPublicWeb?: boolean;
  /** @deprecated Use a named authority preset. Retained for v0.1 compatibility. */
  allowLocalNetwork?: boolean;
  profileMode?: "ephemeral" | "persistent";
}

const PRESETS = {
  public: {
    public: true,
    local: false,
    reserved: false,
    dnsPreflight: "classify",
    webSockets: "blocked",
    serviceWorkers: "block",
  },
  local: {
    public: true,
    local: true,
    reserved: false,
    dnsPreflight: "classify",
    webSockets: "classified",
    serviceWorkers: "block",
  },
  sovereign: {
    public: true,
    local: true,
    reserved: true,
    dnsPreflight: "browser",
    webSockets: "browser",
    serviceWorkers: "allow",
  },
} as const satisfies Record<
  BrowserAuthorityPreset,
  {
    public: boolean;
    local: boolean;
    reserved: boolean;
    dnsPreflight: "classify" | "browser";
    webSockets: "blocked" | "classified" | "browser";
    serviceWorkers: "block" | "allow";
  }
>;

/**
 * Compile launch-time authority into one inspectable immutable manifest.
 *
 * A named profile and the legacy booleans cannot be mixed: an effective
 * authority must be legible rather than depend on hidden override order.
 */
export function resolveBrowserCapabilities(
  options: ResolveBrowserCapabilitiesOptions = {},
): Readonly<BrowserCapabilitySet> {
  validateOptionalBoolean(options.allowPublicWeb, "allowPublicWeb");
  validateOptionalBoolean(options.allowLocalNetwork, "allowLocalNetwork");
  if (
    options.authority !== undefined
    && (
      options.allowPublicWeb !== undefined
      || options.allowLocalNetwork !== undefined
    )
  ) {
    throw new BrowserError(
      "invalid_options",
      "authority cannot be combined with allowPublicWeb or allowLocalNetwork.",
    );
  }
  if (
    options.authority !== undefined
    && !["public", "local", "sovereign"].includes(options.authority)
  ) {
    throw new BrowserError(
      "invalid_options",
      "authority must be public, local, or sovereign.",
    );
  }
  const profileMode = options.profileMode ?? "ephemeral";
  if (profileMode !== "ephemeral" && profileMode !== "persistent") {
    throw new BrowserError(
      "invalid_options",
      "profileMode must be ephemeral or persistent.",
    );
  }

  const usesLegacy =
    options.allowPublicWeb !== undefined
    || options.allowLocalNetwork !== undefined;
  const profile: EffectiveBrowserAuthority = usesLegacy
    ? "legacy_custom"
    : (options.authority ?? "public");
  const preset = profile === "legacy_custom"
    ? {
        public: options.allowPublicWeb ?? true,
        local: options.allowLocalNetwork ?? false,
        reserved: false,
        dnsPreflight: "classify" as const,
        webSockets: "blocked" as const,
        serviceWorkers: "block" as const,
      }
    : PRESETS[profile];

  return deepFreeze({
    schema: BROWSER_CAPABILITIES_SCHEMA,
    authority: {
      profile,
      fixedAt: "process_start",
    },
    network: {
      public: preset.public,
      local: preset.local,
      reserved: preset.reserved,
      schemes: ["http", "https"] as const,
      urlCredentials: "blocked",
      dnsPreflight: preset.dnsPreflight,
      connectionAddressPinning: false,
      webSockets: preset.webSockets,
    },
    runtime: {
      chromiumSandbox: true,
      serviceWorkers: preset.serviceWorkers,
      tlsErrors: "reject",
      profile:
        profileMode === "persistent"
          ? "dedicated_persistent"
          : "ephemeral",
    },
    features: {
      interaction: "enabled",
      screenshots: "enabled",
      persistentProfile:
        profileMode === "persistent"
          ? "enabled"
          : "requires_configuration",
      uploads: "unsupported",
      downloads: "unsupported",
      pageEvaluation: "unsupported",
      credentialInjection: "unsupported",
      shell: "unsupported",
    },
    statement:
      profile === "sovereign"
        ? "AgentTool passes implemented HTTP(S) and WebSocket destinations to the browser without DNS classification; browser, network, account, and site boundaries still apply."
        : "AgentTool classifies implemented browser destinations before connection; DNS preflight does not pin the address Chromium later uses.",
  });
}

function validateOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new BrowserError("invalid_options", `${name} must be a boolean.`);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
