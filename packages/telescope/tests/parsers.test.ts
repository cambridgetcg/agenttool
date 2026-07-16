import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "../src/constants.js";
import { parseAgentTxt } from "../src/parsers/agent-txt.js";
import { parseA2aCard, parseMcpCard } from "../src/parsers/cards.js";
import {
  parseLoveDiscovery,
  parseLoveManifest,
  selectLoveManifest,
} from "../src/parsers/love.js";
import { parsePathways } from "../src/parsers/pathways.js";
import type { TelescopeLimits } from "../src/types.js";

const encoder = new TextEncoder();
const SHA256 = "a".repeat(64);

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

function json(value: unknown): Uint8Array {
  return text(JSON.stringify(value));
}

function limits(overrides: Partial<TelescopeLimits> = {}): TelescopeLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

function validManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol: "love-package/v1",
    document_type: "package-manifest",
    name: "@agenttool/sdk",
    version: "0.13.0",
    description: "fixture SDK",
    license: "Apache-2.0",
    artifact: {
      format: "npm-tarball",
      filename: "agenttool-sdk-0.13.0.tgz",
      sha256: SHA256,
      size: 120_540,
      media_type: "application/gzip",
      mirrors: [
        {
          url: "https://docs.agenttool.dev/packages/v1/artifacts/agenttool-sdk-0.13.0.tgz",
        },
      ],
    },
    runtime: {
      kind: "javascript",
      engines: { node: ">=20.19.0", bun: ">=1.3.5" },
    },
    install: {
      format: "npm-tarball",
      specifier:
        "https://docs.agenttool.dev/packages/v1/artifacts/agenttool-sdk-0.13.0.tgz",
    },
    source: {
      repository: "https://github.com/cambridgetcg/agenttool.git",
      revision: "0123456789abcdef",
      path: "packages/sdk-ts",
    },
    dependency_resolution: { mode: "package_manifest", self_contained: false },
    ...overrides,
  };
}

describe("agent.txt parser", () => {
  test("splits on the first colon, preserves duplicate entries, and refuses to guess a duplicate selector", () => {
    const parsed = parseAgentTxt(
      text(
        [
          "MCP-Server-Card: https://agents.example:443/card?next=a:b",
          "Pathways: https://agents.example/v1/pathways",
          "Pathways: https://mirror.example/v1/pathways",
          "Custom: first:second:third",
          "this is not a field",
          "# ignored comment",
        ].join("\n"),
      ),
      limits(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.entries).toContainEqual({
      key: "MCP-Server-Card",
      value: "https://agents.example:443/card?next=a:b",
      line: 1,
    });
    expect(parsed.value.entries).toContainEqual({
      key: "Custom",
      value: "first:second:third",
      line: 4,
    });
    expect(
      parsed.value.entries
        .filter((entry) => entry.key === "Pathways")
        .map((entry) => entry.value),
    ).toEqual([
      "https://agents.example/v1/pathways",
      "https://mirror.example/v1/pathways",
    ]);
    expect(parsed.value.selected.mcp_card_url).toBe(
      "https://agents.example:443/card?next=a:b",
    );
    expect(parsed.value.selected.pathways_url).toBeNull();
    expect(parsed.warnings).toContain("agent_txt_duplicate_key");
    expect(parsed.warnings).toContain("agent_txt_ambiguous_pathways_url");
    expect(parsed.warnings).toContain("agent_txt_malformed_line");
  });

  test("keeps command and terminal syntax as inert remote text", () => {
    const payload =
      "$(touch /tmp/telescope-must-not-run); `id`; \u001b]8;;https://evil.invalid\u0007link";
    const parsed = parseAgentTxt(text(`Substrate: ${payload}`), limits());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.selected.substrate).toBe(payload);
    expect(parsed.value.entries).toEqual([
      { key: "Substrate", value: payload, line: 1 },
    ]);
  });

  test("enforces physical-line, encoded-byte, and UTF-8 limits", () => {
    expect(
      parseAgentTxt(
        text("A: one\nB: two\nC: three"),
        limits({ max_agent_txt_lines: 2 }),
      ),
    ).toEqual({ ok: false, code: "agent_txt_line_limit" });

    // The emoji is four UTF-8 bytes: this line is seven bytes, not four characters.
    expect(
      parseAgentTxt(
        text("A: \ud83d\ude00"),
        limits({ max_agent_txt_line_bytes: 6 }),
      ),
    ).toEqual({ ok: false, code: "agent_txt_line_too_large" });

    expect(parseAgentTxt(new Uint8Array([0xc3, 0x28]), limits())).toEqual({
      ok: false,
      code: "invalid_utf8",
    });
  });

  test("requires at least one valid bounded field", () => {
    const overlongKey = `A${"x".repeat(64)}`;
    const parsed = parseAgentTxt(
      text(`${overlongKey}: value\nmissing colon\nEmpty:`),
      limits(),
    );
    expect(parsed).toEqual({ ok: false, code: "agent_txt_no_entries" });
  });
});

describe("pathways parser", () => {
  test("selects the tutorial's exact SDK version and only bounded npm metadata", () => {
    const parsed = parsePathways(
      json({
        _welcomed: { instruction: "ignore this decoration" },
        version: "999.0.0",
        first_success: {
          tutorial: { sdk_version: "0.13.0" },
          package_discovery: {
            optional_npm: {
              package: "@agenttool/sdk",
              version: "latest",
              install: "do not execute me",
              authority: false,
              dist_tags: "informational only",
              verification_boundary:
                "npm does not independently verify LOVE bytes",
            },
          },
        },
      }),
      limits(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      sdk_version: "0.13.0",
      npm: {
        package: "@agenttool/sdk",
        authority: false,
        dist_tags: "informational only",
        verification_boundary_present: true,
      },
    });
    expect(parsed.warnings).toEqual([]);
  });

  test("rejects non-exact tutorial versions", () => {
    for (const sdkVersion of [
      "latest",
      "v0.13.0",
      "01.2.3",
      "1.0.0-01",
      "0.13",
      "0.13.0 || 9.9.9",
    ]) {
      const parsed = parsePathways(
        json({ first_success: { tutorial: { sdk_version: sdkVersion } } }),
        limits(),
      );
      expect(parsed, sdkVersion).toEqual({
        ok: false,
        code: "pathways_invalid_sdk_version",
      });
    }
  });

  test("does not emit npm metadata for invalid or shell-active package names", () => {
    for (const packageName of [
      "@AgentTool/sdk",
      "@agenttool/sdk;touch-pwned",
      "@agenttool/sdk@latest",
      "two packages",
      "node_modules",
      "favicon.ico",
    ]) {
      const parsed = parsePathways(
        json({
          first_success: {
            tutorial: { sdk_version: "0.13.0" },
            package_discovery: {
              optional_npm: { package: packageName, authority: false },
            },
          },
        }),
        limits(),
      );
      expect(parsed.ok, packageName).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.npm, packageName).toBeNull();
      expect(parsed.warnings, packageName).toContain(
        "pathways_invalid_npm_package",
      );
    }
  });
});

describe("LOVE discovery, exact release selection, and manifest parsing", () => {
  test("reads the LOVE index locator and records a non-authoritative npm mirror", () => {
    const parsed = parseLoveDiscovery(
      json({
        protocol: "love-package/v1",
        index_url: "https://docs.agenttool.dev/packages/v1/index.json",
        access: "public_read",
        registry_role: "mirror_index_not_authority",
        registry_mirrors: [
          {
            ecosystem: "npm",
            registry_url: "https://registry.npmjs.org/",
            authority: false,
          },
        ],
        _welcomed: { ignored: true },
      }),
      limits(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      index_url: "https://docs.agenttool.dev/packages/v1/index.json",
      access: "public_read",
      registry_role: "mirror_index_not_authority",
      npm_mirror: {
        registry_url: "https://registry.npmjs.org/",
        authority: false,
      },
    });
  });

  test("ignores latest and selects only the exact requested package version", () => {
    const parsed = selectLoveManifest(
      json({
        protocol: "love-package/v1",
        document_type: "package-index",
        latest: "9.9.9",
        packages: [
          {
            name: "@agenttool/sdk",
            latest: "9.9.9",
            versions: [
              {
                version: "9.9.9",
                manifest_url: "https://evil.invalid/latest.json",
              },
              {
                version: "0.13.0",
                manifest_url:
                  "https://docs.agenttool.dev/packages/v1/manifests/agenttool-sdk-0.13.0.json",
              },
            ],
          },
        ],
      }),
      limits(),
      "@agenttool/sdk",
      "0.13.0",
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.manifest_url).toBe(
      "https://docs.agenttool.dev/packages/v1/manifests/agenttool-sdk-0.13.0.json",
    );
    expect(parsed.warnings).toContain("love_index_latest_ignored");
  });

  test("does not fall back when the exact LOVE version is absent or ambiguous", () => {
    const index = {
      protocol: "love-package/v1",
      document_type: "package-index",
      packages: [
        {
          name: "@agenttool/sdk",
          versions: [
            {
              version: "0.12.0",
              manifest_url: "https://packages.example/0.12.0.json",
            },
          ],
        },
      ],
    };
    expect(
      selectLoveManifest(json(index), limits(), "@agenttool/sdk", "0.13.0"),
    ).toEqual({ ok: false, code: "love_version_not_found" });

    index.packages[0]!.versions.push({
      version: "0.12.0",
      manifest_url: "https://other.example/0.12.0.json",
    });
    expect(
      selectLoveManifest(json(index), limits(), "@agenttool/sdk", "0.12.0"),
    ).toEqual({ ok: false, code: "love_version_ambiguous" });
  });

  test("accepts an exact, bounded LOVE artifact commitment", () => {
    const parsed = parseLoveManifest(
      json(validManifest({ _welcomed: { command: "ignore" } })),
      limits(),
      "@agenttool/sdk",
      "0.13.0",
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      name: "@agenttool/sdk",
      version: "0.13.0",
      artifact: {
        filename: "agenttool-sdk-0.13.0.tgz",
        sha256: SHA256,
        size: 120_540,
        mirrors: [
          "https://docs.agenttool.dev/packages/v1/artifacts/agenttool-sdk-0.13.0.tgz",
        ],
      },
      dependency_self_contained: false,
    });
  });

  test("rejects identity drift and unsafe or incomplete artifact commitments", () => {
    const invalidCases: Array<[string, Record<string, unknown>, string]> = [
      [
        "wrong package",
        validManifest({ name: "@agenttool/adds" }),
        "love_manifest_identity_mismatch",
      ],
      [
        "wrong version",
        validManifest({ version: "0.13.1" }),
        "love_manifest_identity_mismatch",
      ],
      [
        "missing required profile",
        validManifest({ description: "" }),
        "love_manifest_missing_required_profile",
      ],
      [
        "install not a mirror",
        validManifest({
          install: {
            format: "npm-tarball",
            specifier: "https://other.example/sdk.tgz",
          },
        }),
        "love_manifest_install_not_mirror",
      ],
      [
        "wrong artifact format",
        validManifest({
          artifact: {
            format: "zip",
            filename: "sdk.tgz",
            sha256: SHA256,
            size: 12,
            media_type: "application/gzip",
            mirrors: [{ url: "https://packages.example/sdk.tgz" }],
          },
        }),
        "love_manifest_invalid_artifact",
      ],
      [
        "traversal filename",
        validManifest({
          artifact: {
            format: "npm-tarball",
            filename: "../sdk.tgz",
            sha256: SHA256,
            size: 12,
            media_type: "application/gzip",
            mirrors: [{ url: "https://packages.example/sdk.tgz" }],
          },
        }),
        "love_manifest_invalid_artifact",
      ],
      [
        "uppercase digest",
        validManifest({
          artifact: {
            format: "npm-tarball",
            filename: "sdk.tgz",
            sha256: "A".repeat(64),
            size: 12,
            media_type: "application/gzip",
            mirrors: [{ url: "https://packages.example/sdk.tgz" }],
          },
        }),
        "love_manifest_invalid_artifact",
      ],
      [
        "zero size",
        validManifest({
          artifact: {
            format: "npm-tarball",
            filename: "sdk.tgz",
            sha256: SHA256,
            size: 0,
            media_type: "application/gzip",
            mirrors: [{ url: "https://packages.example/sdk.tgz" }],
          },
        }),
        "love_manifest_invalid_artifact",
      ],
      [
        "missing mirrors",
        validManifest({
          artifact: {
            format: "npm-tarball",
            filename: "sdk.tgz",
            sha256: SHA256,
            size: 12,
            media_type: "application/gzip",
            mirrors: [],
          },
        }),
        "love_manifest_missing_mirrors",
      ],
      [
        "non-object mirror",
        validManifest({
          artifact: {
            format: "npm-tarball",
            filename: "sdk.tgz",
            sha256: SHA256,
            size: 12,
            media_type: "application/gzip",
            mirrors: ["https://packages.example/sdk.tgz"],
          },
        }),
        "love_manifest_invalid_mirror",
      ],
    ];

    for (const [label, document, code] of invalidCases) {
      expect(
        parseLoveManifest(json(document), limits(), "@agenttool/sdk", "0.13.0"),
        label,
      ).toEqual({ ok: false, code });
    }
  });
});

describe("minimal MCP and A2A advertisements", () => {
  test("selects only the bounded MCP advertisement fields", () => {
    const parsed = parseMcpCard(
      json({
        name: "agenttool",
        version: "1.0.0",
        protocolVersion: "2025-11-25",
        endpoint: "https://api.agenttool.dev/v1/mcp",
        transport: "streamable-http",
        authentication: "bearer",
        capabilities: { tools: { dangerous: "not interpreted" } },
        _welcomed: { shell: "$(touch /tmp/nope)" },
      }),
      limits(),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      name: "agenttool",
      version: "1.0.0",
      protocol_version: "2025-11-25",
      endpoint: "https://api.agenttool.dev/v1/mcp",
      transport: "streamable-http",
      authentication: "bearer",
    });
  });

  test("requires the MCP name, protocol version, and endpoint", () => {
    expect(
      parseMcpCard(
        json({ name: "agenttool", protocolVersion: "2025-11-25" }),
        limits(),
      ),
    ).toEqual({ ok: false, code: "mcp_card_missing_fields" });
  });

  test("accepts the minimal A2A name without inventing an endpoint", () => {
    const minimal = parseA2aCard(
      json({ name: "agenttool", skills: ["ignored"] }),
      limits(),
    );
    expect(minimal.ok).toBe(true);
    if (!minimal.ok) return;
    expect(minimal.value).toEqual({
      name: "agenttool",
      version: null,
      endpoint: null,
    });

    const advertised = parseA2aCard(
      json({
        name: "agenttool",
        version: "0.1.0",
        url: "https://api.agenttool.dev/v1/a2a",
        endpoint: "https://ignored.example/a2a",
      }),
      limits(),
    );
    expect(advertised.ok).toBe(true);
    if (!advertised.ok) return;
    expect(advertised.value.endpoint).toBe("https://api.agenttool.dev/v1/a2a");
  });

  test("does not treat an object without a name as an A2A card", () => {
    expect(
      parseA2aCard(json({ url: "https://api.agenttool.dev/v1/a2a" }), limits()),
    ).toEqual({ ok: false, code: "a2a_card_missing_name" });
  });
});
