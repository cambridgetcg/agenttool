import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "../src/constants.js";
import { parseApiCatalog } from "../src/parsers/api-catalog.js";
import { parseAgenttoolDiscovery } from "../src/parsers/discovery.js";
import { parseRootLinkHeader } from "../src/parsers/link-header.js";

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function road(
  id: "understand" | "inspect" | "choose",
  href: string,
  representation: string,
) {
  return {
    id,
    intent: `${id} without beginning an action`,
    method: "GET",
    href,
    representation,
    auth: "none",
    input: "none",
    application_write: false,
    external_effect: false,
    cost: { agenttool_charge: "none", proof_of_work: "none" },
    repeatability: "safe and idempotent public read",
    retry: "Caller-chosen and finite; AgentTool performs no automatic retry.",
    follow_up_required: false,
    automatic_follow_up: false,
    exit: "stop, stay silent, or leave; each is complete",
  };
}

function discovery() {
  return {
    format: "agenttool-discovery/v1",
    canonical: "https://api.agenttool.dev/public/discovery",
    subject: { name: "agenttool", origin: "https://api.agenttool.dev" },
    invitation: { response_required: false },
    boundary: { discovery_grants: [] },
    roads: [
      road(
        "understand",
        "https://api.agenttool.dev/public/porch",
        "application/json",
      ),
      road(
        "inspect",
        "https://api.agenttool.dev/.well-known/api-catalog",
        "application/linkset+json",
      ),
      road(
        "choose",
        "https://api.agenttool.dev/v1/pathways",
        "application/json",
      ),
    ],
    channels: [{ id: "source" }],
  };
}

describe("AgentTool discovery profile", () => {
  test("accepts the exact ordered three-road safety contract and ignores explanatory additions", () => {
    const fixture = discovery();
    fixture.roads[0]!.future_note = "publisher explanation" as never;
    const parsed = parseAgenttoolDiscovery(json(fixture), DEFAULT_LIMITS);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.format).toBe("agenttool-discovery/v1");
    expect(parsed.value.roads.map(({ id }) => id)).toEqual([
      "understand",
      "inspect",
      "choose",
    ]);
    expect(
      parsed.value.roads.every(
        (entry) =>
          entry.method === "GET" &&
          entry.application_write === false &&
          entry.external_effect === false &&
          entry.follow_up_required === false &&
          entry.automatic_follow_up === false,
      ),
    ).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("future_note");
    expect(JSON.stringify(parsed)).not.toContain("channels");
  });

  test("accepts only the positive complete-exit phrase family", () => {
    const canonicalFixture = discovery();
    for (const entry of canonicalFixture.roads) {
      entry.exit = "stop, choose silence, or leave; each is complete";
    }
    expect(
      parseAgenttoolDiscovery(json(canonicalFixture), DEFAULT_LIMITS).ok,
    ).toBe(true);

    const nounFixture = discovery();
    for (const entry of nounFixture.roads) {
      entry.exit = "Stopping, silence, or leaving is complete.";
    }
    expect(parseAgenttoolDiscovery(json(nounFixture), DEFAULT_LIMITS).ok).toBe(
      true,
    );

    const missingSilence = discovery();
    missingSilence.roads[0]!.exit = "Stopping or leaving is complete.";
    expect(
      parseAgenttoolDiscovery(json(missingSilence), DEFAULT_LIMITS),
    ).toEqual({
      ok: false,
      code: "discovery_invalid_exit",
    });

    for (const unsafeExit of [
      "Do not stop, never stay silent, never leave; each is incomplete.",
      "stop, choose silence, or leave; each is incomplete",
      "stop, never stay silent, or leave; each is complete",
      "Stopping, silence, or leaving is incomplete.",
    ]) {
      const fixture = discovery();
      fixture.roads[0]!.exit = unsafeExit;
      expect(parseAgenttoolDiscovery(json(fixture), DEFAULT_LIMITS)).toEqual({
        ok: false,
        code: "discovery_invalid_exit",
      });
    }
  });

  test("rejects reordered roads and every safety-critical widening", () => {
    const cases: Array<[string, (value: ReturnType<typeof discovery>) => void]> =
      [
        [
          "discovery_invalid_road_identity",
          (value) => value.roads.reverse(),
        ],
        [
          "discovery_invalid_road_contract",
          (value) => (value.roads[0]!.method = "POST"),
        ],
        [
          "discovery_invalid_road_contract",
          (value) => (value.roads[1]!.href = "https://example.com/catalog"),
        ],
        [
          "discovery_invalid_road_contract",
          (value) => (value.roads[2]!.application_write = true),
        ],
        [
          "discovery_invalid_road_contract",
          (value) => (value.roads[0]!.automatic_follow_up = true),
        ],
        [
          "discovery_invalid_cost",
          (value) => (value.roads[1]!.cost.proof_of_work = "required"),
        ],
        [
          "discovery_invalid_retry_boundary",
          (value) => (value.roads[2]!.retry = "retry forever"),
        ],
        [
          "discovery_invalid_exit",
          (value) => (value.roads[0]!.exit = "registration is required"),
        ],
      ];

    for (const [code, mutate] of cases) {
      const fixture = discovery();
      mutate(fixture);
      expect(parseAgenttoolDiscovery(json(fixture), DEFAULT_LIMITS)).toEqual({
        ok: false,
        code,
      });
    }
  });
});

describe("bounded root Link evidence", () => {
  test("finds the canonical compass and RFC 9727 catalog without following them", () => {
    const parsed = parseRootLinkHeader(
      [
        '<https://api.agenttool.dev/public/discovery>; rel="service-meta"; type="application/json"; title="Invitation, not capture"',
        '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
        '<https://docs.agenttool.dev/>; rel="service-doc"; type="text/html"',
      ].join(", "),
      "https://api.agenttool.dev",
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        relations: ["api-catalog", "service-doc", "service-meta"],
        discovery_advertised: true,
        api_catalog_advertised: true,
      },
      warnings: [],
    });
  });

  test("keeps absence scoped and rejects unsafe or unbounded header shapes", () => {
    const withoutCompass = parseRootLinkHeader(
      '<https://docs.agenttool.dev/>; rel="service-doc"',
      "https://api.agenttool.dev",
    );
    expect(withoutCompass.ok).toBe(true);
    if (withoutCompass.ok) {
      expect(withoutCompass.warnings).toEqual([
        "root_links_missing_discovery",
      ]);
    }
    expect(
      parseRootLinkHeader(
        '<https://user:secret@api.agenttool.dev/private>; rel="service-meta"',
        "https://api.agenttool.dev",
      ),
    ).toEqual({ ok: false, code: "root_links_invalid" });
    expect(
      parseRootLinkHeader("x".repeat(16_385), "https://api.agenttool.dev"),
    ).toEqual({ ok: false, code: "root_links_invalid" });
  });
});

describe("RFC 9727 API catalog evidence", () => {
  test("validates bounded Linkset JSON and locates the compass without fetching a target", () => {
    const parsed = parseApiCatalog(
      json({
        linkset: [
          {
            anchor: "https://api.agenttool.dev/.well-known/api-catalog",
            "service-meta": [
              {
                href: "https://api.agenttool.dev/public/discovery",
                title: "Three optional public roads",
              },
            ],
            "service-desc": [
              { href: "https://api.agenttool.dev/v1/openapi.json" },
            ],
          },
          {
            anchor: "https://api.agenttool.dev/public/porch",
            "service-doc": [{ href: "https://docs.agenttool.dev/" }],
          },
          {
            anchor: "https://api.agenttool.dev/v1/scrape",
            "service-doc": [
              { href: "https://docs.agenttool.dev/tools#scrape" },
            ],
          },
        ],
      }),
      DEFAULT_LIMITS,
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        anchor: "https://api.agenttool.dev/.well-known/api-catalog",
        relations: ["service-desc", "service-meta"],
        discovery_advertised: true,
      },
      warnings: [],
    });
  });

  test("rejects a catalog that substitutes another canonical context", () => {
    expect(
      parseApiCatalog(
        json({
          linkset: [
            {
              anchor: "https://example.com/.well-known/api-catalog",
              "service-meta": [
                { href: "https://api.agenttool.dev/public/discovery" },
              ],
            },
          ],
        }),
        DEFAULT_LIMITS,
      ),
    ).toEqual({
      ok: false,
      code: "api_catalog_missing_canonical_context",
    });
  });

  test("keeps context anchors hashless and relation targets credential-free HTTPS", () => {
    for (const [anchor, href, code] of [
      [
        "https://api.agenttool.dev/.well-known/api-catalog#fragment",
        "https://api.agenttool.dev/public/discovery",
        "api_catalog_invalid_context",
      ],
      [
        "https://api.agenttool.dev/.well-known/api-catalog",
        "http://docs.agenttool.dev/tools#scrape",
        "api_catalog_invalid_relation",
      ],
      [
        "https://api.agenttool.dev/.well-known/api-catalog",
        "https://user:secret@docs.agenttool.dev/tools#scrape",
        "api_catalog_invalid_relation",
      ],
    ] as const) {
      expect(
        parseApiCatalog(
          json({
            linkset: [
              {
                anchor,
                "service-meta": [{ href }],
              },
            ],
          }),
          DEFAULT_LIMITS,
        ),
      ).toEqual({ ok: false, code });
    }
  });
});
