import { describe, expect, test } from "bun:test";

import {
  auditDnsRecords,
  auditRuleset,
  auditWorkerRoutes,
  auditZoneSettings,
  containsDesired,
  loadManifest,
  runLiveAudit,
  validateManifest,
} from "../cloudflare-zone-audit";

const manifest = loadManifest();

function cloudflare(result: unknown, status = 200): Response {
  return Response.json(
    status >= 200 && status < 300
      ? { success: true, errors: [], result }
      : {
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
          result: null,
        },
    { status },
  );
}

describe("AgentTool Cloudflare desired state", () => {
  test("loads one exact zone with stable non-overlapping rule refs", () => {
    expect(manifest.zone).toBe("agenttool.dev");
    expect(manifest.schema).toBe(
      "agenttool.cloudflare-zone-desired-state/1",
    );
    expect(manifest.zone_settings["0rtt"]).toBe("off");
    expect(manifest.zone_settings.ssl).toBe("strict");
    expect(manifest.zone_settings.browser_cache_ttl).toBe(0);

    const wake = manifest.rulesets.find((rule) =>
      rule.ref === "agenttool_wake_private_cache_bypass_v1"
    );
    expect(wake?.action_parameters).toEqual({ cache: false });
    expect(wake?.expression).toContain('http.host eq "api.agenttool.dev"');
    expect(wake?.expression).toContain('http.host eq "agenttool.dev"');
    expect(wake?.expression).toContain('http.request.uri.path eq "/v1/wake"');
    expect(wake?.expression).toContain(
      'starts_with(http.request.uri.path, "/v1/wake/")',
    );
    expect(wake?.expression).not.toContain("Authorization");
    expect(wake?.must_be_last_enabled).toBe(true);
    expect(
      manifest.rulesets
        .filter((rule) => rule.phase === "http_request_cache_settings")
        .at(-1)?.ref,
    ).toBe("agenttool_wake_private_cache_bypass_v1");

    expect(manifest.dns_records).toContainEqual(
      expect.objectContaining({ name: "api.agenttool.dev", proxied: true }),
    );
    expect(manifest.provider_bypasses.map((entry) => entry.hostname)).toEqual(
      expect.arrayContaining([
        "agenttool-playground.pages.dev",
        "kingdom-canon.axiepro.workers.dev",
        "joke.axiepro.workers.dev",
        "love.axiepro.workers.dev",
        "party-chain.axiepro.workers.dev",
        "natlang.axiepro.workers.dev",
      ]),
    );

    expect(manifest.origin_authentication.status).toContain("design_pending");
    expect(manifest.rate_limiting.status).toContain("deferred");
    expect(JSON.stringify(manifest)).not.toMatch(
      /(?:api[_ -]?token|secret[_ -]?key)["']?\s*:\s*["'][A-Za-z0-9_-]{16}/i,
    );
  });

  test("refuses another zone or duplicate source-managed refs", () => {
    expect(() => validateManifest({ ...manifest, zone: "example.com" }))
      .toThrow("scoped to agenttool.dev");
    expect(() =>
      validateManifest({
        ...manifest,
        rulesets: [manifest.rulesets[0], manifest.rulesets[0]],
      })
    ).toThrow("duplicate rule ref");
    expect(() => validateManifest({
      ...manifest,
      services: [{ hostname: "api.agenttool.dev" }],
    })).toThrow("services[0].owner");
    expect(() => validateManifest({
      ...manifest,
      effective_origin_probe: {
        ...manifest.effective_origin_probe,
        url: "https://example.test/health",
      },
    })).toThrow("exact API HTTPS health");
  });

  test("refuses weakening any load-bearing private or inventory boundary", () => {
    const wake = manifest.rulesets.find((rule) =>
      rule.ref === "agenttool_wake_private_cache_bypass_v1"
    )!;
    const publicRule = manifest.rulesets.find((rule) =>
      rule.ref === "agenttool_public_protocol_cache_v1"
    )!;
    const machine = manifest.rulesets.find((rule) =>
      rule.ref === "agenttool_machine_transport_v1"
    )!;
    const invalidCandidates: unknown[] = [
      { ...manifest, zone_settings: { ...manifest.zone_settings, "0rtt": "on" } },
      { ...manifest, zone_settings: { ...manifest.zone_settings, always_use_https: "off" } },
      { ...manifest, zone_settings: { ...manifest.zone_settings, browser_check: "off" } },
      { ...manifest, zone_settings: { ...manifest.zone_settings, security_level: "essentially_off" } },
      { ...manifest, zone_settings: { ...manifest.zone_settings, tls_1_3: "off" } },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === wake.ref ? { ...rule, must_be_last_enabled: false } : rule
        ),
      },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === wake.ref ? { ...rule, expression: "false" } : rule
        ),
      },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === wake.ref
            ? {
                ...rule,
                expression:
                  '(http.host eq "api.agenttool.dev" and http.request.uri.path eq "/v1/wake")',
              }
            : rule
        ),
      },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === publicRule.ref ? { ...rule, expression: "true" } : rule
        ),
      },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === machine.ref ? { ...rule, expression: "false" } : rule
        ),
      },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === machine.ref
            ? {
                ...rule,
                action_parameters: Object.fromEntries(
                  Object.entries(rule.action_parameters).filter(([key]) =>
                    key !== "security_level"
                  ),
                ),
              }
            : rule
        ),
      },
      { ...manifest, rulesets: [wake, publicRule, machine] },
      {
        ...manifest,
        rulesets: manifest.rulesets.map((rule) =>
          rule.ref === publicRule.ref ? { ...rule, required_permissions: [] } : rule
        ),
      },
      {
        ...manifest,
        dns_records: manifest.dns_records.map((record) => ({ ...record, proxied: false })),
      },
      { ...manifest, dns_records: [...manifest.dns_records, ...manifest.dns_records] },
      {
        ...manifest,
        dns_records: manifest.dns_records.map((record) => ({
          ...record,
          allowed_types: ["A", 7] as unknown as string[],
        })),
      },
      {
        ...manifest,
        effective_origin_probe: {
          ...manifest.effective_origin_probe,
          require_cloudflare_edge: false,
          require_fly_origin: false,
          require_clean_build: false,
        },
      },
      { ...manifest, provider_bypasses: [] },
      { ...manifest, worker_routes: [] },
      {
        ...manifest,
        worker_routes: [
          ...manifest.worker_routes,
          { pattern: "agenttool.dev/*", script: "natlang" },
        ],
      },
      { ...manifest, workers_dev: { ...manifest.workers_dev, scripts: [] } },
      {
        ...manifest,
        workers_dev: { ...manifest.workers_dev, account_subdomain: "other" },
      },
      {
        ...manifest,
        workers_dev: {
          ...manifest.workers_dev,
          scripts: manifest.workers_dev.scripts.map((script) =>
            script.script === "agenttool-proxy"
              ? { ...script, enabled: true, previews_enabled: true }
              : script
          ),
        },
      },
      {
        ...manifest,
        workers_dev: {
          ...manifest.workers_dev,
          scripts: manifest.workers_dev.scripts.map((script) =>
            script.script === "joke"
              ? { ...script, enabled: false, status: "managed" }
              : script
          ),
        },
      },
      { ...manifest, pages_projects: [] },
      { ...manifest, inventory_only_pages_projects: [] },
      {
        ...manifest,
        pages_projects: manifest.pages_projects.map((project) =>
          project.name === "agenttool-dashboard"
            ? { ...project, production_fail_open: true }
            : project
        ),
      },
      {
        ...manifest,
        pages_projects: manifest.pages_projects.map((project) =>
          project.name === "agenttool-docs"
            ? { ...project, preview_fail_open: true }
            : project
        ),
      },
      {
        ...manifest,
        observability: {
          ...manifest.observability,
          body_or_authorization_logging: true,
        },
      },
      {
        ...manifest,
        observability: {
          ...manifest.observability,
          head_sampling_rate: 1,
        },
      },
    ];
    for (const candidate of invalidCandidates) {
      expect(() => validateManifest(candidate)).toThrow();
    }
  });

  test("partial comparison ignores provider metadata but not desired drift", () => {
    expect(containsDesired(
      { cache: false, provider_id: "ignored", nested: { enabled: true, version: 4 } },
      { cache: false, nested: { enabled: true } },
    )).toBe(true);
    expect(containsDesired({ cache: true }, { cache: false })).toBe(false);
  });
});

describe("Cloudflare audit projections", () => {
  test("finds exact settings without requiring provider field parity", () => {
    const findings = auditZoneSettings(
      Object.entries(manifest.zone_settings).map(([id, value]) => ({
        id,
        value,
        editable: true,
        modified_on: null,
      })),
      manifest.zone_settings,
    );
    expect(findings.every((finding) => finding.status === "ok")).toBe(true);

    const drifted = auditZoneSettings(
      [{ id: "0rtt", value: "on" }],
      { "0rtt": "off" },
    );
    expect(drifted[0]).toMatchObject({
      control: "zone_setting:0rtt",
      status: "drift",
      expected: "off",
      actual: { desired_value_matches: false },
    });
    const providerLiteral = "provider-setting-value-never-serialize";
    expect(JSON.stringify(auditZoneSettings(
      [{ id: "0rtt", value: providerLiteral }],
      { "0rtt": "off" },
    ))).not.toContain(providerLiteral);
  });

  test("matches rules by stable ref and preserves unknown rules", () => {
    const desired = manifest.rulesets.filter((rule) =>
      rule.phase === "http_request_cache_settings"
    );
    const provider = {
      rules: [
        {
          ref: "human_owned_rule",
          action: "set_cache_settings",
          expression: "true",
          action_parameters: { cache: true },
          enabled: true,
        },
        ...desired.map((rule) => ({ ...rule, enabled: true })),
      ],
    };
    const findings = auditRuleset(
      "http_request_cache_settings",
      provider,
      manifest.rulesets,
    );
    expect(findings).toHaveLength(desired.length);
    expect(findings.every((finding) => finding.status === "ok")).toBe(true);

    const missing = auditRuleset(
      "http_request_cache_settings",
      { rules: provider.rules.slice(0, 1) },
      manifest.rulesets,
    );
    expect(missing.every((finding) => finding.status === "drift")).toBe(true);

    const laterUnknown = auditRuleset(
      "http_request_cache_settings",
      {
        rules: [
          ...desired.map((rule) => ({ ...rule, enabled: true })),
          {
            ref: "later_human_rule",
            action: "set_cache_settings",
            expression: "true",
            action_parameters: { cache: true },
            enabled: true,
          },
        ],
      },
      manifest.rulesets,
    );
    expect(laterUnknown.find((finding) =>
      finding.control === "ruleset:agenttool_wake_private_cache_bypass_v1"
    )).toMatchObject({
      status: "drift",
      detail: expect.stringContaining("later enabled rule"),
    });

    const secretLiteral = "provider-header-secret-never-serialize";
    const secretDrift = auditRuleset(
      "http_request_cache_settings",
      {
        rules: desired.map((rule) => ({
          ...rule,
          action_parameters: { secret_literal: secretLiteral },
          enabled: true,
        })),
      },
      manifest.rulesets,
    );
    expect(JSON.stringify(secretDrift)).not.toContain(secretLiteral);
  });

  test("checks only DNS shape and proxy posture, never record content", () => {
    const desired = manifest.dns_records[0]!;
    const secretContent = "origin-value-never-serialize";
    const healthy = auditDnsRecords(
      [{
        id: "provider-id-never-serialize",
        name: desired.name,
        type: "CNAME",
        proxied: true,
        content: secretContent,
      }],
      desired,
    );
    expect(healthy.status).toBe("ok");
    expect(JSON.stringify(healthy)).not.toContain(secretContent);
    expect(JSON.stringify(healthy)).not.toContain("provider-id-never-serialize");

    expect(auditDnsRecords(
      [{ name: desired.name, type: "CNAME", proxied: false }],
      desired,
    )).toMatchObject({ status: "drift" });
  });

  test("checks expected Worker ownership without rejecting unrelated routes", () => {
    const findings = auditWorkerRoutes(
      [
        ...manifest.worker_routes,
        { pattern: "unrelated.example/*", script: "unrelated" },
      ],
      manifest.worker_routes,
    );
    expect(findings).toHaveLength(manifest.worker_routes.length);
    expect(findings.every((finding) => finding.status === "ok")).toBe(true);

    const unexpectedManaged = auditWorkerRoutes(
      [
        ...manifest.worker_routes,
        { pattern: "extra.agenttool.dev/*", script: "agenttool-proxy" },
      ],
      manifest.worker_routes,
    );
    expect(unexpectedManaged.at(-1)).toMatchObject({
      control: "worker_routes:unexpected_managed_scope",
      status: "drift",
      actual: { unexpected_route_count: 1 },
    });
  });
});

describe("live audit transport", () => {
  test("uses GET only, emits no identifiers/token, and tolerates intentional deferrals", async () => {
    const token = "test-token-never-serialize";
    const zoneId = "zone-id-never-serialize";
    const accountId = "account-id-never-serialize";
    const calls: Array<{
      host: string;
      url: string;
      method: string;
      authorization: string | null;
    }> = [];
    let appendUnexpectedPageDomain = false;
    const phaseRules = new Map<string, unknown>([
      [
        "http_request_cache_settings",
        {
          rules: manifest.rulesets
            .filter((rule) => rule.phase === "http_request_cache_settings")
            .map((rule) => ({ ...rule, enabled: true })),
        },
      ],
      [
        "http_config_settings",
        {
          rules: manifest.rulesets
            .filter((rule) => rule.phase === "http_config_settings")
            .map((rule) => ({ ...rule, enabled: true })),
        },
      ],
      [manifest.waf.phase, { rules: [{ action: "execute" }] }],
    ]);

    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      const url = new URL(request.url);
      calls.push({
        host: url.hostname,
        url: url.pathname + url.search,
        method: request.method,
        authorization: request.headers.get("Authorization"),
      });

      if (
        url.hostname === "api.agenttool.dev" &&
        url.pathname === "/health"
      ) {
        return Response.json({
          service: "agenttool",
          status: "alive",
          build: { revision: "expected-test-revision", dirty: false },
        }, {
          headers: {
            server: "cloudflare",
            via: "1.1 fly.io",
            "cf-ray": "provider-request-id-never-serialize",
            "fly-request-id": "origin-request-id-never-serialize",
          },
        });
      }
      if (
        url.hostname === "cloudflare-dns.com" ||
        url.hostname === "dns.google"
      ) {
        const type = url.searchParams.get("type");
        return Response.json({
          Status: 0,
          Answer: [{
            type: type === "DS" ? 43 : 48,
            data: "dns-proof-content-never-serialize",
          }],
        });
      }

      if (url.pathname === "/client/v4/zones") {
        expect(url.searchParams.get("name")).toBe("agenttool.dev");
        return cloudflare([{
          id: zoneId,
          name: "agenttool.dev",
          status: "active",
          account: { id: accountId },
        }]);
      }
      if (url.pathname === `/client/v4/zones/${zoneId}/settings`) {
        return cloudflare(
          Object.entries(manifest.zone_settings).map(([id, value]) => ({
            id,
            value,
          })),
        );
      }
      if (url.pathname === `/client/v4/zones/${zoneId}/dnssec`) {
        return cloudflare({ status: "active" });
      }
      if (url.pathname === `/client/v4/zones/${zoneId}/dns_records`) {
        expect(url.searchParams.get("name")).toBe("api.agenttool.dev");
        return cloudflare([{
          id: "dns-id-never-serialize",
          name: "api.agenttool.dev",
          type: "CNAME",
          proxied: true,
          content: "origin-never-serialize",
        }]);
      }
      if (url.pathname === `/client/v4/zones/${zoneId}/workers/routes`) {
        return cloudflare(manifest.worker_routes);
      }
      if (
        url.pathname ===
          `/client/v4/accounts/${accountId}/workers/subdomain`
      ) {
        return cloudflare({ subdomain: manifest.workers_dev.account_subdomain });
      }
      const workerSubdomainPrefix =
        `/client/v4/accounts/${accountId}/workers/scripts/`;
      if (
        url.pathname.startsWith(workerSubdomainPrefix) &&
        url.pathname.endsWith("/subdomain")
      ) {
        const name = decodeURIComponent(
          url.pathname.slice(
            workerSubdomainPrefix.length,
            -"/subdomain".length,
          ),
        );
        const script = manifest.workers_dev.scripts.find((entry) =>
          entry.script === name
        );
        expect(script).toBeDefined();
        return cloudflare({
          enabled: script!.enabled,
          previews_enabled: script!.previews_enabled,
        });
      }
      const pagesPrefix = `/client/v4/accounts/${accountId}/pages/projects/`;
      if (url.pathname.startsWith(pagesPrefix)) {
        const name = decodeURIComponent(url.pathname.slice(pagesPrefix.length));
        const project = [
          ...manifest.pages_projects,
          ...manifest.inventory_only_pages_projects,
        ].find((entry) => entry.name === name);
        expect(project).toBeDefined();
        const managed = manifest.pages_projects.find((entry) =>
          entry.name === name
        );
        return cloudflare({
          production_branch: project!.production_branch,
          subdomain: project!.provider_domain,
          domains: [...(project!.custom_domain === null
            ? [project!.provider_domain]
            : [project!.provider_domain, project!.custom_domain]),
            ...(appendUnexpectedPageDomain ? ["untracked.example.net"] : []),
          ],
          deployment_configs: managed
            ? {
                production: { fail_open: managed.production_fail_open },
                preview: { fail_open: managed.preview_fail_open },
              }
            : {},
        });
      }
      const phasePrefix = `/client/v4/zones/${zoneId}/rulesets/phases/`;
      if (url.pathname.startsWith(phasePrefix) && url.pathname.endsWith("/entrypoint")) {
        const phase = url.pathname
          .slice(phasePrefix.length, -"/entrypoint".length);
        return cloudflare(phaseRules.get(phase) ?? { rules: [] });
      }
      if (
        url.pathname ===
          `/client/v4/accounts/${accountId}/workers/scripts/agenttool-proxy/settings`
      ) {
        return cloudflare({
          observability: {
            enabled: true,
            head_sampling_rate: 0.01,
            logs: {
              enabled: true,
              head_sampling_rate: 0.01,
              persist: true,
              invocation_logs: true,
            },
            traces: { enabled: false, persist: false, head_sampling_rate: 0 },
          },
        });
      }
      throw new Error(`unexpected fake Cloudflare path: ${url.pathname}`);
    }) as typeof fetch;

    const result = await runLiveAudit({
      manifest,
      token,
      fetchImpl: fakeFetch,
    });
    expect(result.provider_writes).toBe(0);
    expect(result.exit_code).toBe(0);
    expect(result.summary.drift).toBe(0);
    expect(result.summary.blocked).toBe(0);
    expect(result.summary.error).toBe(0);
    expect(result.summary.deferred).toBe(2);
    expect(result.summary.inspect).toBe(7);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.filter((call) => call.host === "api.cloudflare.com").every(
      (call) => call.authorization === `Bearer ${token}`,
    )).toBe(true);
    expect(calls.filter((call) => call.host !== "api.cloudflare.com").every(
      (call) => call.authorization === null,
    )).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(zoneId);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain("dns-id-never-serialize");
    expect(serialized).not.toContain("origin-never-serialize");
    expect(serialized).not.toContain("provider-request-id-never-serialize");
    expect(serialized).not.toContain("origin-request-id-never-serialize");
    expect(serialized).not.toContain("dns-proof-content-never-serialize");

    appendUnexpectedPageDomain = true;
    const extraDomainResult = await runLiveAudit({
      manifest,
      token,
      fetchImpl: fakeFetch,
    });
    for (const project of manifest.pages_projects) {
      expect(extraDomainResult.findings.find((finding) =>
        finding.control === `pages:${project.name}`
      )?.status).toBe("drift");
    }
    expect(extraDomainResult.findings.find((finding) =>
      finding.control === "pages_inventory:agenttool-playground"
    )?.status).toBe("drift");
    expect(JSON.stringify(extraDomainResult)).not.toContain("untracked.example.net");
  });

  test("reports the exact read permission boundary without reflecting credentials", async () => {
    const token = "blocked-token-never-serialize";
    const result = await runLiveAudit({
      manifest,
      token,
      fetchImpl: (async () => Response.json({
        success: false,
        errors: [{
          code: 10000,
          message:
            `Rejected Authorization Bearer ${token} for provider-id-never-serialize`,
        }],
        result: null,
      }, { status: 403 })) as unknown as typeof fetch,
    });
    expect(result.exit_code).toBe(2);
    expect(result.findings).toEqual([
      expect.objectContaining({
        control: "zone_lookup",
        status: "blocked",
        required_permissions: ["Zone Read for agenttool.dev"],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("provider-id-never-serialize");
  });

  test("contains thrown transport errors without reflecting their messages", async () => {
    const token = "transport-token-never-serialize";
    const providerLiteral = "provider-zone-id-never-serialize";
    const result = await runLiveAudit({
      manifest,
      token,
      fetchImpl: (async () => {
        throw new Error(`raw ${token} ${providerLiteral}`);
      }) as unknown as typeof fetch,
    });
    expect(result.exit_code).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({ control: "zone_lookup", status: "error" }),
    ]);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(providerLiteral);
  });

  test("rejects empty or unsafe provider identifiers before follow-up reads", async () => {
    for (const [zoneId, accountId] of [
      ["", "account-safe"],
      ["zone-safe", ""],
      ["zone/escape", "account-safe"],
      ["zone-safe", "account?escape"],
    ]) {
      let calls = 0;
      const result = await runLiveAudit({
        manifest,
        token: "identifier-boundary-token",
        fetchImpl: (async () => {
          calls += 1;
          return cloudflare([{
            id: zoneId,
            name: "agenttool.dev",
            status: "active",
            account: { id: accountId },
          }]);
        }) as unknown as typeof fetch,
      });
      expect(calls).toBe(1);
      expect(result.findings).toEqual([
        expect.objectContaining({ control: "zone_lookup", status: "error" }),
      ]);
    }
  });
});
