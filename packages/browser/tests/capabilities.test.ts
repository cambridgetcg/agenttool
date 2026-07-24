import { describe, expect, test } from "bun:test";
import {
  BROWSER_CAPABILITIES_SCHEMA,
  resolveBrowserCapabilities,
  type BrowserAuthorityPreset,
} from "../src/capabilities.js";

const expectedNetwork = {
  schemes: ["http", "https"],
  urlCredentials: "blocked",
  connectionAddressPinning: false,
} as const;

describe("browser capabilities", () => {
  test("publishes a public, process-fixed authority profile by default", () => {
    const capabilities = resolveBrowserCapabilities();

    expect(BROWSER_CAPABILITIES_SCHEMA).toBe("agent-browser-capabilities/0.2");
    expect(capabilities).toMatchObject({
      schema: BROWSER_CAPABILITIES_SCHEMA,
      authority: {
        profile: "public",
        fixedAt: "process_start",
      },
      network: {
        ...expectedNetwork,
        public: true,
        local: false,
        reserved: false,
        dnsPreflight: "classify",
        webSockets: "blocked",
      },
      runtime: {
        serviceWorkers: "block",
        profile: "ephemeral",
        chromiumSandbox: true,
        tlsErrors: "reject",
      },
      features: {
        interaction: "enabled",
        screenshots: "enabled",
        persistentProfile: "requires_configuration",
        uploads: "unsupported",
        downloads: "unsupported",
        pageEvaluation: "unsupported",
        credentialInjection: "unsupported",
        shell: "unsupported",
      },
    });
  });

  test.each([
    [
      "public",
      {
        public: true,
        local: false,
        reserved: false,
        dnsPreflight: "classify",
        webSockets: "blocked",
        serviceWorkers: "block",
      },
    ],
    [
      "local",
      {
        public: true,
        local: true,
        reserved: false,
        dnsPreflight: "classify",
        webSockets: "classified",
        serviceWorkers: "block",
      },
    ],
    [
      "sovereign",
      {
        public: true,
        local: true,
        reserved: true,
        dnsPreflight: "browser",
        webSockets: "browser",
        serviceWorkers: "allow",
      },
    ],
  ] satisfies ReadonlyArray<
    readonly [
      BrowserAuthorityPreset,
      {
        public: boolean;
        local: boolean;
        reserved: boolean;
        dnsPreflight: "classify" | "browser";
        webSockets: "blocked" | "classified" | "browser";
        serviceWorkers: "block" | "allow";
      },
    ]
  >)("resolves the %s authority matrix exactly", (authority, expected) => {
    const capabilities = resolveBrowserCapabilities({ authority });

    expect(capabilities.authority).toEqual({
      profile: authority,
      fixedAt: "process_start",
    });
    expect(capabilities.network).toMatchObject({
      ...expectedNetwork,
      public: expected.public,
      local: expected.local,
      reserved: expected.reserved,
      dnsPreflight: expected.dnsPreflight,
      webSockets: expected.webSockets,
    });
    expect(capabilities.runtime.serviceWorkers).toBe(expected.serviceWorkers);
  });

  test("reports legacy booleans exactly without silently widening them", () => {
    const capabilities = resolveBrowserCapabilities({
      allowPublicWeb: false,
      allowLocalNetwork: true,
      profileMode: "persistent",
    });

    expect(capabilities.authority).toEqual({
      profile: "legacy_custom",
      fixedAt: "process_start",
    });
    expect(capabilities.network).toMatchObject({
      ...expectedNetwork,
      public: false,
      local: true,
      reserved: false,
      dnsPreflight: "classify",
      webSockets: "blocked",
    });
    expect(capabilities.runtime).toMatchObject({
      serviceWorkers: "block",
      profile: "dedicated_persistent",
    });
    expect(capabilities.features.persistentProfile).toBe("enabled");
  });

  test("rejects mixing a named authority with legacy authority booleans", () => {
    expect(() =>
      resolveBrowserCapabilities({
        authority: "sovereign",
        allowLocalNetwork: true,
      })
    ).toThrow(/authority.*allowLocalNetwork|allowLocalNetwork.*authority/i);
    expect(() =>
      resolveBrowserCapabilities({
        authority: "public",
        allowPublicWeb: false,
      })
    ).toThrow(/authority.*allowPublicWeb|allowPublicWeb.*authority/i);
  });

  test("returns a deeply frozen declaration, including feature and runtime records", () => {
    const capabilities = resolveBrowserCapabilities({
      authority: "sovereign",
      profileMode: "persistent",
    });

    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities.authority)).toBe(true);
    expect(Object.isFrozen(capabilities.network)).toBe(true);
    expect(Object.isFrozen(capabilities.network.schemes)).toBe(true);
    expect(Object.isFrozen(capabilities.runtime)).toBe(true);
    expect(Object.isFrozen(capabilities.features)).toBe(true);
    expect(capabilities.runtime.profile).toBe("dedicated_persistent");
    expect(capabilities.features).toEqual({
      interaction: "enabled",
      screenshots: "enabled",
      persistentProfile: "enabled",
      uploads: "unsupported",
      downloads: "unsupported",
      pageEvaluation: "unsupported",
      credentialInjection: "unsupported",
      shell: "unsupported",
    });
  });
});
