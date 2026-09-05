#!/usr/bin/env bun
/** Read-only AgentTool Cloudflare desired-state audit.
 *
 * This command never sends a mutating request. It accepts one child-scoped
 * CLOUDFLARE_API_TOKEN, resolves only the exact configured zone, and emits no
 * token, account ID, zone ID, rule ID, DNS content, or unrelated account
 * inventory. Unknown provider rules are preserved and ignored.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DEFAULT_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "infra/cloudflare/agenttool.dev.desired.json",
);

const PUBLIC_CACHE_EXPRESSION =
  '(http.host eq "api.agenttool.dev" and http.request.method in {"GET" "HEAD"} and http.request.uri.path in {"/feeds" "/feeds/offers.atom" "/feeds/offers.rss" "/feeds/offers.json" "/.well-known/webfinger"})';
const WAKE_BYPASS_EXPRESSION =
  '((http.host eq "api.agenttool.dev" or http.host eq "agenttool.dev") and (http.request.uri.path eq "/v1/wake" or starts_with(http.request.uri.path, "/v1/wake/")))';
const MACHINE_TRANSPORT_EXPRESSION =
  '(http.host eq "api.agenttool.dev" or (http.host eq "agenttool.dev" and (http.request.uri.path eq "/v1" or http.request.uri.path eq "/public" or http.request.uri.path eq "/feeds" or http.request.uri.path eq "/federation" or http.request.uri.path eq "/health" or http.request.uri.path eq "/about" or http.request.uri.path eq "/.well-known" or http.request.uri.path eq "/llms.txt" or http.request.uri.path eq "/llms-full.txt" or http.request.uri.path eq "/AGENTS.md" or http.request.uri.path eq "/openapi.json" or starts_with(http.request.uri.path, "/v1/") or starts_with(http.request.uri.path, "/public/") or starts_with(http.request.uri.path, "/.well-known/") or starts_with(http.request.uri.path, "/feeds/") or starts_with(http.request.uri.path, "/federation/"))))';

const PUBLIC_CACHE_PARAMETERS = {
  cache: true,
  edge_ttl: { mode: "bypass_by_default" },
  respect_strong_etags: true,
};
const WAKE_BYPASS_PARAMETERS = { cache: false };
const MACHINE_TRANSPORT_PARAMETERS = {
  bic: false,
  content_converter: false,
  disable_rum: true,
  disable_zaraz: true,
  email_obfuscation: false,
  fonts: false,
  request_body_buffering: "standard",
  response_body_buffering: "standard",
  rocket_loader: false,
  security_level: "essentially_off",
};

type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FindingStatus =
  | "ok"
  | "drift"
  | "blocked"
  | "error"
  | "deferred"
  | "inspect";

export interface AuditFinding {
  control: string;
  status: FindingStatus;
  detail: string;
  expected?: JsonValue;
  actual?: JsonValue;
  required_permissions?: string[];
}

export interface DesiredRule {
  ref: string;
  phase: string;
  description: string;
  expression: string;
  action: string;
  action_parameters: Record<string, JsonValue>;
  must_be_last_enabled?: boolean;
  status: string;
  required_permissions: string[];
}

interface DesiredPagesProject {
  name: string;
  production_branch: string;
  provider_domain: string;
  custom_domain: string | null;
  production_fail_open: boolean;
  preview_fail_open: boolean;
}

export interface DesiredManifest {
  schema: "agenttool.cloudflare-zone-desired-state/1";
  zone: string;
  services: Array<{
    hostname: string;
    owner: string;
    purpose: string;
    cloudflare_boundary: string;
  }>;
  provider_bypasses: Array<Record<string, string>>;
  zone_settings: Record<string, JsonValue>;
  dnssec: {
    desired_api_status: string;
    status: string;
    required_permission: string;
  };
  dns_records: Array<{
    name: string;
    allowed_types: string[];
    proxied: boolean;
    minimum_records: number;
    required_permission: string;
  }>;
  effective_origin_probe: {
    url: string;
    service: string;
    status: string;
    require_cloudflare_edge: boolean;
    require_fly_origin: boolean;
    require_clean_build: boolean;
  };
  worker_routes: Array<{ pattern: string; script: string }>;
  workers_dev: {
    account_subdomain: string;
    scripts: Array<{
      script: string;
      enabled: boolean;
      previews_enabled: boolean;
      status: string;
      boundary: string;
    }>;
  };
  pages_projects: DesiredPagesProject[];
  inventory_only_pages_projects: Array<{
    name: string;
    production_branch: string;
    provider_domain: string;
    custom_domain: string | null;
    status: string;
    boundary: string;
  }>;
  rulesets: DesiredRule[];
  waf: {
    phase: string;
    status: string;
    desired_boundary: string;
    required_permissions: string[];
  };
  rate_limiting: { status: string; boundary: string };
  origin_authentication: {
    status: string;
    boundary: string;
    required_permissions: string[];
  };
  observability: {
    worker: string;
    head_sampling_rate: number;
    persisted_invocation_log_rate: number;
    traces: boolean;
    body_or_authorization_logging: boolean;
    status: string;
  };
}

interface CloudflareFailure {
  ok: false;
  http_status: number;
  errors: Array<{ code: number | null; message: string }>;
}

interface CloudflareSuccess {
  ok: true;
  result: unknown;
}

type CloudflareResult = CloudflareFailure | CloudflareSuccess;

export interface LiveAuditResult {
  schema: "agenttool.cloudflare-zone-audit/1";
  zone: string;
  mode: "read_only";
  summary: Record<FindingStatus, number>;
  findings: AuditFinding[];
  provider_writes: 0;
  exit_code: 0 | 1 | 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, asJsonValue(nested)]),
    );
  }
  return String(value);
}

/** True when every desired key/value exists in actual. Extra provider fields
 * are deliberately ignored so unknown rules and future metadata survive. */
export function containsDesired(actual: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    return Array.isArray(actual) &&
      desired.length === actual.length &&
      desired.every((value, index) => containsDesired(actual[index], value));
  }
  if (isRecord(desired)) {
    if (!isRecord(actual)) return false;
    return Object.entries(desired).every(([key, value]) =>
      Object.hasOwn(actual, key) && containsDesired(actual[key], value)
    );
  }
  return Object.is(actual, desired);
}

function exactlyMatches(actual: unknown, desired: unknown): boolean {
  return containsDesired(actual, desired) && containsDesired(desired, actual);
}

function isSafeProviderIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`manifest ${field} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`manifest ${field} must be a boolean`);
  }
  return value;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`manifest ${field} must be an array`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  const values = requireArray(value, field);
  if (values.length === 0 || values.some((entry) =>
    typeof entry !== "string" || entry.length === 0
  )) {
    throw new Error(`manifest ${field} must contain non-empty strings`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`manifest ${field} must not contain duplicates`);
  }
  return values as string[];
}

function requireInventory(
  observed: Set<string>,
  required: readonly string[],
  field: string,
): void {
  for (const entry of required) {
    if (!observed.has(entry)) {
      throw new Error(`manifest ${field} is missing required entry: ${entry}`);
    }
  }
}

export function validateManifest(value: unknown): DesiredManifest {
  if (!isRecord(value)) throw new Error("manifest must be an object");
  if (value.schema !== "agenttool.cloudflare-zone-desired-state/1") {
    throw new Error("unsupported Cloudflare desired-state schema");
  }
  const zone = requireString(value.zone, "zone");
  if (zone !== "agenttool.dev") {
    throw new Error("this auditor is deliberately scoped to agenttool.dev");
  }
  if (!isRecord(value.zone_settings)) {
    throw new Error("manifest zone_settings must be an object");
  }
  const loadBearingSettings = {
    "0rtt": "off",
    always_use_https: "on",
    ssl: "strict",
    browser_cache_ttl: 0,
    browser_check: "on",
    min_tls_version: "1.2",
    security_level: "high",
    tls_1_3: "on",
    websockets: "on",
    security_header: {
      strict_transport_security: {
        enabled: true,
        max_age: 300,
        include_subdomains: false,
        preload: false,
        nosniff: true,
      },
    },
  };
  if (!containsDesired(value.zone_settings, loadBearingSettings)) {
    throw new Error("manifest zone_settings weaken a load-bearing AgentTool edge control");
  }
  const services = requireArray(value.services, "services");
  if (services.length === 0) throw new Error("manifest services must not be empty");
  const serviceHosts = new Set<string>();
  for (const [index, service] of services.entries()) {
    if (!isRecord(service)) throw new Error(`manifest services[${index}] must be an object`);
    const hostname = requireString(service.hostname, `services[${index}].hostname`);
    if (hostname !== zone && !hostname.endsWith(`.${zone}`)) {
      throw new Error(`manifest services[${index}].hostname must remain in ${zone}`);
    }
    requireString(service.owner, `services[${index}].owner`);
    requireString(service.purpose, `services[${index}].purpose`);
    requireString(
      service.cloudflare_boundary,
      `services[${index}].cloudflare_boundary`,
    );
    if (serviceHosts.has(hostname)) throw new Error(`duplicate service hostname: ${hostname}`);
    serviceHosts.add(hostname);
  }
  requireInventory(serviceHosts, [
    "agenttool.dev",
    "www.agenttool.dev",
    "api.agenttool.dev",
    "app.agenttool.dev",
    "docs.agenttool.dev",
    "canon.agenttool.dev",
    "joke.agenttool.dev",
    "love.agenttool.dev",
    "party.agenttool.dev",
    "speak.agenttool.dev",
  ], "services");
  const bypassHosts = new Set<string>();
  const bypasses = requireArray(
    value.provider_bypasses,
    "provider_bypasses",
  );
  if (bypasses.length === 0) {
    throw new Error("manifest provider_bypasses must not be empty");
  }
  for (const [index, bypass] of bypasses.entries()) {
    if (!isRecord(bypass)) {
      throw new Error(`manifest provider_bypasses[${index}] must be an object`);
    }
    const hostname = requireString(
      bypass.hostname,
      `provider_bypasses[${index}].hostname`,
    );
    if (bypassHosts.has(hostname)) {
      throw new Error(`duplicate provider bypass hostname: ${hostname}`);
    }
    bypassHosts.add(hostname);
    requireString(bypass.purpose, `provider_bypasses[${index}].purpose`);
    requireString(bypass.consequence, `provider_bypasses[${index}].consequence`);
  }
  requireInventory(bypassHosts, [
    "agenttool.fly.dev",
    "agenttool-web.pages.dev",
    "agenttool-dashboard.pages.dev",
    "agenttool-docs.pages.dev",
    "agenttool-playground.pages.dev",
    "kingdom-canon.axiepro.workers.dev",
    "joke.axiepro.workers.dev",
    "love.axiepro.workers.dev",
    "party-chain.axiepro.workers.dev",
    "natlang.axiepro.workers.dev",
  ], "provider_bypasses");
  if (!isRecord(value.dnssec)) throw new Error("manifest dnssec must be an object");
  if (value.dnssec.desired_api_status !== "active") {
    throw new Error("manifest dnssec.desired_api_status must remain active");
  }
  requireString(value.dnssec.status, "dnssec.status");
  requireString(value.dnssec.required_permission, "dnssec.required_permission");
  if (!isRecord(value.effective_origin_probe)) {
    throw new Error("manifest effective_origin_probe must be an object");
  }
  const probeUrl = new URL(
    requireString(value.effective_origin_probe.url, "effective_origin_probe.url"),
  );
  if (probeUrl.href !== "https://api.agenttool.dev/health") {
    throw new Error("effective origin probe must remain exact API HTTPS health");
  }
  requireString(value.effective_origin_probe.service, "effective_origin_probe.service");
  requireString(value.effective_origin_probe.status, "effective_origin_probe.status");
  requireBoolean(
    value.effective_origin_probe.require_cloudflare_edge,
    "effective_origin_probe.require_cloudflare_edge",
  );
  requireBoolean(
    value.effective_origin_probe.require_fly_origin,
    "effective_origin_probe.require_fly_origin",
  );
  requireBoolean(
    value.effective_origin_probe.require_clean_build,
    "effective_origin_probe.require_clean_build",
  );
  if (
    value.effective_origin_probe.require_cloudflare_edge !== true ||
    value.effective_origin_probe.require_fly_origin !== true ||
    value.effective_origin_probe.require_clean_build !== true
  ) {
    throw new Error("effective origin proof flags must all remain enabled");
  }
  if (!Array.isArray(value.rulesets) || value.rulesets.length === 0) {
    throw new Error("manifest rulesets must be a non-empty array");
  }
  const refs = new Set<string>();
  for (const [index, candidate] of value.rulesets.entries()) {
    if (!isRecord(candidate)) throw new Error(`rulesets[${index}] must be an object`);
    const ref = requireString(candidate.ref, `rulesets[${index}].ref`);
    if (refs.has(ref)) throw new Error(`duplicate rule ref: ${ref}`);
    refs.add(ref);
    requireString(candidate.phase, `rulesets[${index}].phase`);
    requireString(candidate.description, `rulesets[${index}].description`);
    requireString(candidate.expression, `rulesets[${index}].expression`);
    requireString(candidate.action, `rulesets[${index}].action`);
    requireString(candidate.status, `rulesets[${index}].status`);
    if (!isRecord(candidate.action_parameters)) {
      throw new Error(`rulesets[${index}].action_parameters must be an object`);
    }
    requireStringArray(
      candidate.required_permissions,
      `rulesets[${index}].required_permissions`,
    );
    if (
      candidate.must_be_last_enabled !== undefined &&
      typeof candidate.must_be_last_enabled !== "boolean"
    ) {
      throw new Error(`rulesets[${index}].must_be_last_enabled must be boolean`);
    }
  }
  for (const required of [
    "agenttool_wake_private_cache_bypass_v1",
    "agenttool_public_protocol_cache_v1",
    "agenttool_machine_transport_v1",
  ]) {
    if (!refs.has(required)) throw new Error(`missing required rule ref: ${required}`);
  }
  const orderedRules = value.rulesets as unknown as DesiredRule[];
  const wakeRule = orderedRules.find((candidate) =>
    candidate.ref === "agenttool_wake_private_cache_bypass_v1"
  );
  const publicRule = orderedRules.find((candidate) =>
    candidate.ref === "agenttool_public_protocol_cache_v1"
  );
  const machineRule = orderedRules.find((candidate) =>
    candidate.ref === "agenttool_machine_transport_v1"
  );
  if (
    !wakeRule || wakeRule.phase !== "http_request_cache_settings" ||
    wakeRule.action !== "set_cache_settings" ||
    wakeRule.expression !== WAKE_BYPASS_EXPRESSION ||
    !exactlyMatches(wakeRule.action_parameters, WAKE_BYPASS_PARAMETERS) ||
    wakeRule.must_be_last_enabled !== true
  ) {
    throw new Error("WAKE private cache bypass invariant was weakened");
  }
  if (
    !publicRule || publicRule.phase !== "http_request_cache_settings" ||
    publicRule.action !== "set_cache_settings" ||
    publicRule.expression !== PUBLIC_CACHE_EXPRESSION ||
    !exactlyMatches(publicRule.action_parameters, PUBLIC_CACHE_PARAMETERS)
  ) {
    throw new Error("public protocol cache invariant was weakened");
  }
  if (
    !machineRule || machineRule.phase !== "http_config_settings" ||
    machineRule.action !== "set_config" ||
    machineRule.expression !== MACHINE_TRANSPORT_EXPRESSION ||
    !exactlyMatches(machineRule.action_parameters, MACHINE_TRANSPORT_PARAMETERS)
  ) {
    throw new Error("machine transport configuration invariant was weakened");
  }
  for (const rule of orderedRules.filter((candidate) => candidate.must_be_last_enabled)) {
    const samePhase = orderedRules.filter((candidate) => candidate.phase === rule.phase);
    if (samePhase.at(-1)?.ref !== rule.ref) {
      throw new Error(`${rule.ref} must be last in its phase`);
    }
  }
  if (!Array.isArray(value.dns_records) || value.dns_records.length === 0) {
    throw new Error("manifest dns_records must name the proxied API entrance");
  }
  if (value.dns_records.length !== 1) {
    throw new Error("manifest dns_records must contain one exact API entrance");
  }
  for (const [index, record] of value.dns_records.entries()) {
    if (!isRecord(record) || record.name !== "api.agenttool.dev") {
      throw new Error(`dns_records[${index}] must be scoped to api.agenttool.dev`);
    }
    const allowedTypes = requireStringArray(
      record.allowed_types,
      `dns_records[${index}].allowed_types`,
    );
    if (allowedTypes.some((type) => !["A", "AAAA", "CNAME"].includes(type))) {
      throw new Error(`dns_records[${index}].allowed_types contains an unsupported type`);
    }
    if (
      allowedTypes.length !== 3 ||
      !["A", "AAAA", "CNAME"].every((type) => allowedTypes.includes(type))
    ) {
      throw new Error(`dns_records[${index}].allowed_types must preserve all API target forms`);
    }
    if (requireBoolean(record.proxied, `dns_records[${index}].proxied`) !== true) {
      throw new Error(`dns_records[${index}].proxied must remain true`);
    }
    const minimumRecords = record.minimum_records;
    if (
      typeof minimumRecords !== "number" ||
      !Number.isInteger(minimumRecords) ||
      minimumRecords !== 1
    ) {
      throw new Error(`dns_records[${index}].minimum_records must remain one`);
    }
    const requiredPermission = requireString(
      record.required_permission,
      `dns_records[${index}].required_permission`,
    );
    if (requiredPermission !== "Zone DNS Read") {
      throw new Error(`dns_records[${index}].required_permission must remain scoped`);
    }
  }
  const workerRouteKeys = new Set<string>();
  const workerRoutePatterns = new Set<string>();
  const workerRoutes = requireArray(value.worker_routes, "worker_routes");
  if (workerRoutes.length === 0) {
    throw new Error("manifest worker_routes must not be empty");
  }
  for (const [index, route] of workerRoutes.entries()) {
    if (!isRecord(route)) throw new Error(`worker_routes[${index}] must be an object`);
    const pattern = requireString(route.pattern, `worker_routes[${index}].pattern`);
    const script = requireString(route.script, `worker_routes[${index}].script`);
    if (workerRoutePatterns.has(pattern)) {
      throw new Error(`duplicate worker route pattern: ${pattern}`);
    }
    workerRoutePatterns.add(pattern);
    const key = `${pattern}\u0000${script}`;
    if (workerRouteKeys.has(key)) throw new Error(`duplicate worker route: ${pattern}`);
    workerRouteKeys.add(key);
  }
  requireInventory(workerRouteKeys, [
    "agenttool.dev/*\u0000agenttool-proxy",
    "www.agenttool.dev/*\u0000agenttool-proxy",
    "canon.agenttool.dev/*\u0000kingdom-canon",
    "joke.agenttool.dev/*\u0000joke",
    "love.agenttool.dev/*\u0000love",
    "party.agenttool.dev/*\u0000party-chain",
    "speak.agenttool.dev/*\u0000natlang",
  ], "worker_routes");
  if (workerRoutes.length !== 7) {
    throw new Error("manifest worker_routes must exactly match the scoped route inventory");
  }
  if (!isRecord(value.workers_dev)) {
    throw new Error("manifest workers_dev must be an object");
  }
  if (
    requireString(value.workers_dev.account_subdomain, "workers_dev.account_subdomain") !==
      "axiepro"
  ) {
    throw new Error("manifest workers_dev.account_subdomain must remain axiepro");
  }
  const workerScripts = requireArray(value.workers_dev.scripts, "workers_dev.scripts");
  if (workerScripts.length === 0) {
    throw new Error("manifest workers_dev.scripts must not be empty");
  }
  const workerScriptNames = new Set<string>();
  for (const [index, script] of workerScripts.entries()) {
    if (!isRecord(script)) throw new Error(`workers_dev.scripts[${index}] must be an object`);
    const name = requireString(script.script, `workers_dev.scripts[${index}].script`);
    if (workerScriptNames.has(name)) throw new Error(`duplicate workers.dev script: ${name}`);
    workerScriptNames.add(name);
    requireBoolean(script.enabled, `workers_dev.scripts[${index}].enabled`);
    requireBoolean(
      script.previews_enabled,
      `workers_dev.scripts[${index}].previews_enabled`,
    );
    requireString(script.status, `workers_dev.scripts[${index}].status`);
    requireString(script.boundary, `workers_dev.scripts[${index}].boundary`);
  }
  requireInventory(workerScriptNames, [
    "agenttool-proxy",
    "kingdom-canon",
    "joke",
    "love",
    "party-chain",
    "natlang",
  ], "workers_dev.scripts");
  const providerAliasBoundary =
    "Public provider alias is active, but its deployed source/config is not currently recovered in this repository.";
  const expectedWorkerScripts = {
    "agenttool-proxy": {
      enabled: false,
      previews_enabled: false,
      status: "managed_provider_alias_disabled",
      boundary:
        "The apex Worker is reachable only through source-managed zone routes; its workers.dev alias remains disabled.",
    },
    "kingdom-canon": {
      enabled: true,
      previews_enabled: true,
      status: "inventory_source_unrecovered",
      boundary: providerAliasBoundary,
    },
    joke: {
      enabled: true,
      previews_enabled: true,
      status: "inventory_source_unrecovered",
      boundary: providerAliasBoundary,
    },
    love: {
      enabled: true,
      previews_enabled: true,
      status: "inventory_source_unrecovered",
      boundary: providerAliasBoundary,
    },
    "party-chain": {
      enabled: true,
      previews_enabled: true,
      status: "inventory_source_unrecovered",
      boundary: providerAliasBoundary,
    },
    natlang: {
      enabled: true,
      previews_enabled: true,
      status: "inventory_source_unrecovered",
      boundary: providerAliasBoundary,
    },
  };
  if (workerScripts.length !== Object.keys(expectedWorkerScripts).length) {
    throw new Error("manifest workers_dev.scripts must exactly match the scoped inventory");
  }
  for (const script of workerScripts) {
    if (!isRecord(script) || typeof script.script !== "string") continue;
    const expected = expectedWorkerScripts[
      script.script as keyof typeof expectedWorkerScripts
    ];
    if (!expected || !containsDesired(script, expected)) {
      throw new Error("manifest workers_dev.scripts has an unexpected provider-alias contract");
    }
  }
  for (const field of ["pages_projects", "inventory_only_pages_projects"] as const) {
    const projects = requireArray(value[field], field);
    if (projects.length === 0) throw new Error(`manifest ${field} must not be empty`);
    const projectNames = new Set<string>();
    for (const [index, project] of projects.entries()) {
      if (!isRecord(project)) throw new Error(`${field}[${index}] must be an object`);
      const name = requireString(project.name, `${field}[${index}].name`);
      if (projectNames.has(name)) throw new Error(`duplicate ${field} project: ${name}`);
      projectNames.add(name);
      requireString(project.production_branch, `${field}[${index}].production_branch`);
      requireString(project.provider_domain, `${field}[${index}].provider_domain`);
      if (project.custom_domain !== null) {
        requireString(project.custom_domain, `${field}[${index}].custom_domain`);
      }
      if (field === "pages_projects") {
        const productionFailOpen = requireBoolean(
          project.production_fail_open,
          `${field}[${index}].production_fail_open`,
        );
        const previewFailOpen = requireBoolean(
          project.preview_fail_open,
          `${field}[${index}].preview_fail_open`,
        );
        if (productionFailOpen || previewFailOpen) {
          throw new Error(`${field}[${index}] must remain fail-closed`);
        }
      } else {
        requireString(project.status, `${field}[${index}].status`);
        requireString(project.boundary, `${field}[${index}].boundary`);
      }
    }
    requireInventory(
      projectNames,
      field === "pages_projects"
        ? ["agenttool-dashboard", "agenttool-docs", "agenttool-web"]
        : ["agenttool-playground"],
      field,
    );
    const expectedProjects = field === "pages_projects"
      ? {
        "agenttool-dashboard": {
          production_branch: "main",
          provider_domain: "agenttool-dashboard.pages.dev",
          custom_domain: "app.agenttool.dev",
        },
        "agenttool-docs": {
          production_branch: "main",
          provider_domain: "agenttool-docs.pages.dev",
          custom_domain: "docs.agenttool.dev",
        },
        "agenttool-web": {
          production_branch: "main",
          provider_domain: "agenttool-web.pages.dev",
          custom_domain: null,
        },
      }
      : {
        "agenttool-playground": {
          production_branch: "main",
          provider_domain: "agenttool-playground.pages.dev",
          custom_domain: null,
        },
      };
    if (projects.length !== Object.keys(expectedProjects).length) {
      throw new Error(`manifest ${field} must exactly match the scoped inventory`);
    }
    for (const project of projects) {
      if (!isRecord(project) || typeof project.name !== "string") continue;
      const expected = expectedProjects[project.name as keyof typeof expectedProjects];
      if (!expected || !containsDesired(project, expected)) {
        throw new Error(`manifest ${field} has an unexpected project contract`);
      }
    }
  }
  if (!isRecord(value.waf) || !Array.isArray(value.waf.required_permissions)) {
    throw new Error("manifest waf boundary must be an object with permissions");
  }
  requireString(value.waf.phase, "waf.phase");
  requireString(value.waf.status, "waf.status");
  requireString(value.waf.desired_boundary, "waf.desired_boundary");
  requireStringArray(value.waf.required_permissions, "waf.required_permissions");
  if (!isRecord(value.rate_limiting) || !isRecord(value.origin_authentication)) {
    throw new Error("manifest deferred control boundaries must be objects");
  }
  requireString(value.rate_limiting.status, "rate_limiting.status");
  requireString(value.rate_limiting.boundary, "rate_limiting.boundary");
  requireString(value.origin_authentication.status, "origin_authentication.status");
  requireString(value.origin_authentication.boundary, "origin_authentication.boundary");
  requireStringArray(
    value.origin_authentication.required_permissions,
    "origin_authentication.required_permissions",
  );
  if (!isRecord(value.observability)) {
    throw new Error("manifest observability must be an object");
  }
  requireString(value.observability.worker, "observability.worker");
  for (const field of ["head_sampling_rate", "persisted_invocation_log_rate"] as const) {
    const rate = value.observability[field];
    if (typeof rate !== "number" || rate < 0 || rate > 1) {
      throw new Error(`manifest observability.${field} must be between 0 and 1`);
    }
  }
  requireBoolean(value.observability.traces, "observability.traces");
  requireBoolean(
    value.observability.body_or_authorization_logging,
    "observability.body_or_authorization_logging",
  );
  if (value.observability.body_or_authorization_logging !== false) {
    throw new Error("observability must not log bodies or Authorization");
  }
  requireString(value.observability.status, "observability.status");
  if (!containsDesired(value.observability, {
    worker: "agenttool-proxy",
    head_sampling_rate: 0.01,
    persisted_invocation_log_rate: 0.01,
    traces: false,
    body_or_authorization_logging: false,
    status: "enabled",
  })) {
    throw new Error("manifest observability weakens the privacy-minimized live contract");
  }
  return value as unknown as DesiredManifest;
}

export function loadManifest(path = DEFAULT_MANIFEST_PATH): DesiredManifest {
  return validateManifest(JSON.parse(readFileSync(path, "utf8")));
}

export function auditZoneSettings(
  providerSettings: unknown,
  desiredSettings: Record<string, JsonValue>,
): AuditFinding[] {
  if (!Array.isArray(providerSettings)) {
    return [{
      control: "zone_settings",
      status: "error",
      detail: "Cloudflare settings response was not an array",
    }];
  }
  const actual = new Map<string, unknown>();
  for (const setting of providerSettings) {
    if (isRecord(setting) && typeof setting.id === "string") {
      actual.set(setting.id, setting.value);
    }
  }
  return Object.entries(desiredSettings).map(([id, expected]) => {
    if (!actual.has(id)) {
      return {
        control: `zone_setting:${id}`,
        status: "drift",
        detail: "setting is absent from the provider response",
        expected,
      };
    }
    const current = actual.get(id);
    return containsDesired(current, expected)
      ? {
          control: `zone_setting:${id}`,
          status: "ok",
          detail: "matches desired state",
        }
      : {
          control: `zone_setting:${id}`,
          status: "drift",
          detail: "value differs from desired state",
          expected,
          // Never reflect provider values. A future Cloudflare field could
          // contain an identifier or literal that is inappropriate for logs.
          actual: { desired_value_matches: false },
        };
  });
}

export function auditRuleset(
  phase: string,
  providerRuleset: unknown,
  desiredRules: DesiredRule[],
): AuditFinding[] {
  const relevant = desiredRules.filter((rule) => rule.phase === phase);
  if (relevant.length === 0) return [];
  const rules = isRecord(providerRuleset) && Array.isArray(providerRuleset.rules)
    ? providerRuleset.rules
    : [];
  const enabledRules = rules.filter((candidate) =>
    isRecord(candidate) && candidate.enabled !== false
  );
  return relevant.map((desired): AuditFinding => {
    const matches = rules.filter((candidate) =>
      isRecord(candidate) && candidate.ref === desired.ref
    );
    if (matches.length > 1) {
      return {
        control: `ruleset:${desired.ref}`,
        status: "drift",
        detail: "duplicate source-managed rule ref; no unique rule can be verified",
        actual: { matching_rule_count: matches.length },
        required_permissions: desired.required_permissions,
      };
    }
    const actual = matches[0];
    if (!actual) {
      return {
        control: `ruleset:${desired.ref}`,
        status: "drift",
        detail: "source-managed rule ref is absent; unknown rules were not evaluated or replaced",
        required_permissions: desired.required_permissions,
      };
    }
    // Provider metadata may grow, but additional machine settings change
    // behavior beyond the reviewed contract. Suppress their names and values.
    const unexpectedParameterCount =
      desired.ref === "agenttool_machine_transport_v1" &&
        isRecord(actual.action_parameters)
        ? Object.keys(actual.action_parameters).filter((key) =>
            !Object.hasOwn(desired.action_parameters, key)
          ).length
        : 0;
    if (unexpectedParameterCount > 0) {
      return {
        control: `ruleset:${desired.ref}`,
        status: "drift",
        detail: "unexpected machine transport action parameters require review; provider fields were suppressed",
        actual: { unexpected_action_parameter_count: unexpectedParameterCount },
        required_permissions: desired.required_permissions,
      };
    }
    const expected = {
      ref: desired.ref,
      expression: desired.expression,
      action: desired.action,
      action_parameters: desired.action_parameters,
      enabled: true,
    };
    const behaviorMatches = containsDesired(actual, expected);
    const lastEnabledMatches = !desired.must_be_last_enabled ||
      enabledRules.at(-1) === actual;
    return behaviorMatches && lastEnabledMatches
      ? {
          control: `ruleset:${desired.ref}`,
          status: "ok",
          detail: desired.must_be_last_enabled
            ? "matches desired rule by stable ref and is the final enabled rule in the phase"
            : "matches desired rule by stable ref",
        }
      : {
          control: `ruleset:${desired.ref}`,
          status: "drift",
          detail: behaviorMatches
            ? "stable rule behavior matches, but a later enabled rule can override it"
            : "stable rule ref exists but its behavior differs",
          expected: asJsonValue(expected),
          actual: asJsonValue({
            stable_ref_present: true,
            expression_matches: actual.expression === desired.expression,
            action_matches: actual.action === desired.action,
            action_parameters_match: containsDesired(
              actual.action_parameters,
              desired.action_parameters,
            ),
            enabled: actual.enabled === true,
            final_enabled_rule: enabledRules.at(-1) === actual,
          }),
          required_permissions: desired.required_permissions,
        };
  });
}

export function auditDnsRecords(
  providerRecords: unknown,
  desired: DesiredManifest["dns_records"][number],
): AuditFinding {
  if (!Array.isArray(providerRecords)) {
    return {
      control: `dns_record:${desired.name}`,
      status: "error",
      detail: "Cloudflare DNS response was not an array",
      required_permissions: [desired.required_permission],
    };
  }
  const records = providerRecords.filter((candidate) =>
    isRecord(candidate) && candidate.name === desired.name
  );
  const allowedTypes = new Set(desired.allowed_types);
  const enoughRecords = records.length >= desired.minimum_records;
  const proxyMatches = records.length > 0 && records.every((record) =>
    record.proxied === desired.proxied
  );
  const typesMatch = records.length > 0 && records.every((record) =>
    typeof record.type === "string" && allowedTypes.has(record.type)
  );
  return enoughRecords && proxyMatches && typesMatch
    ? {
        control: `dns_record:${desired.name}`,
        status: "ok",
        detail: "exact API hostname exists with an allowed type and the Cloudflare proxy enabled",
      }
    : {
        control: `dns_record:${desired.name}`,
        status: "drift",
        detail: "exact API hostname is absent, uses an unexpected type, or is not consistently proxied",
        expected: {
          minimum_records: desired.minimum_records,
          allowed_types: desired.allowed_types,
          proxied: desired.proxied,
        },
        actual: {
          record_count: records.length,
          proxy_matches: proxyMatches,
          types_match: typesMatch,
        },
        required_permissions: [desired.required_permission],
      };
}

export function auditWorkerRoutes(
  providerRoutes: unknown,
  expectedRoutes: DesiredManifest["worker_routes"],
): AuditFinding[] {
  const routes = Array.isArray(providerRoutes) ? providerRoutes : [];
  const findings: AuditFinding[] = expectedRoutes.map((expected): AuditFinding => {
    const found = routes.some((candidate) =>
      isRecord(candidate) &&
      candidate.pattern === expected.pattern &&
      candidate.script === expected.script
    );
    return {
      control: `worker_route:${expected.pattern}`,
      status: found ? "ok" : "drift",
      detail: found
        ? `owned by ${expected.script}`
        : `expected owner ${expected.script} was not observed`,
    };
  });
  const expectedKeys = new Set(expectedRoutes.map((route) =>
    `${route.pattern}\u0000${route.script}`
  ));
  const managedScripts = new Set(expectedRoutes.map((route) => route.script));
  const unexpectedManagedRoutes = routes.filter((candidate) =>
    isRecord(candidate) &&
    typeof candidate.pattern === "string" &&
    typeof candidate.script === "string" &&
    managedScripts.has(candidate.script) &&
    !expectedKeys.has(`${candidate.pattern}\u0000${candidate.script}`)
  );
  if (unexpectedManagedRoutes.length > 0) {
    findings.push({
      control: "worker_routes:unexpected_managed_scope",
      status: "drift",
      detail:
        "a source-managed Worker owns an additional route; patterns were not serialized",
      actual: { unexpected_route_count: unexpectedManagedRoutes.length },
    });
  }
  return findings;
}

function blockedFinding(
  control: string,
  result: CloudflareFailure,
  requiredPermissions: string[],
): AuditFinding {
  return {
    control,
    status: result.http_status === 401 || result.http_status === 403
      ? "blocked"
      : "error",
    detail: result.errors.length > 0
      ? result.errors.map((error) =>
          `${error.code ?? "unknown"}: ${error.message}`
        ).join("; ")
      : `Cloudflare API returned HTTP ${result.http_status}`,
    required_permissions: requiredPermissions,
  };
}

async function cloudflareGet(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
): Promise<CloudflareResult> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return {
      ok: false,
      http_status: 0,
      errors: [{ code: null, message: "Cloudflare API transport failed" }],
    };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A status and bounded generic message are safer than reflecting HTML.
  }
  if (response.ok && isRecord(body) && body.success === true) {
    return { ok: true, result: body.result };
  }
  const errors = isRecord(body) && Array.isArray(body.errors)
    ? body.errors.flatMap((error) => {
        if (!isRecord(error)) return [];
        return [{
          code: typeof error.code === "number" ? error.code : null,
          // Do not reflect arbitrary provider prose: future endpoints may put
          // identifiers, rule literals, or request fragments in an error.
          message: "Cloudflare API request was rejected",
        }];
      })
    : [];
  return { ok: false, http_status: response.status, errors };
}

async function publicDnsTypePresent(
  fetchImpl: typeof fetch,
  resolverUrl: string,
  zone: string,
  recordType: "DS" | "DNSKEY",
): Promise<boolean | null> {
  try {
    const url = new URL(resolverUrl);
    url.searchParams.set("name", zone);
    url.searchParams.set("type", recordType);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/dns-json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || body.Status !== 0) return null;
    const expectedType = recordType === "DS" ? 43 : 48;
    const answers = Array.isArray(body.Answer) ? body.Answer : [];
    return answers.some((answer) =>
      isRecord(answer) && answer.type === expectedType
    );
  } catch {
    return null;
  }
}

async function auditPublicDnssec(
  fetchImpl: typeof fetch,
  zone: string,
): Promise<AuditFinding> {
  const resolvers = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
  ];
  const results = await Promise.all(resolvers.flatMap((resolver) => [
    publicDnsTypePresent(fetchImpl, resolver, zone, "DS"),
    publicDnsTypePresent(fetchImpl, resolver, zone, "DNSKEY"),
  ]));
  if (results.some((result) => result === null)) {
    return {
      control: "dnssec_public_chain",
      status: "error",
      detail: "one or more public DNSSEC proof queries failed",
    };
  }
  const dsPresent = results[0] === true && results[2] === true;
  const dnskeyPresent = results[1] === true && results[3] === true;
  return dsPresent && dnskeyPresent
    ? {
        control: "dnssec_public_chain",
        status: "ok",
        detail: "two public resolvers observe both parent DS and zone DNSKEY",
      }
    : {
        control: "dnssec_public_chain",
        status: "drift",
        detail: "two-resolver public proof does not show both parent DS and zone DNSKEY",
        expected: { ds_present: true, dnskey_present: true },
        actual: { ds_present: dsPresent, dnskey_present: dnskeyPresent },
        required_permissions: ["Zone DNS Write"],
      };
}

function summarize(findings: AuditFinding[]): Record<FindingStatus, number> {
  const summary: Record<FindingStatus, number> = {
    ok: 0,
    drift: 0,
    blocked: 0,
    error: 0,
    deferred: 0,
    inspect: 0,
  };
  for (const finding of findings) summary[finding.status] += 1;
  return summary;
}

function resultExitCode(summary: Record<FindingStatus, number>): 0 | 1 | 2 {
  if (summary.drift > 0 || summary.error > 0) return 1;
  if (summary.blocked > 0) return 2;
  return 0;
}

export async function runLiveAudit(options: {
  manifest: DesiredManifest;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<LiveAuditResult> {
  const { manifest, token } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const findings: AuditFinding[] = [];

  const zoneLookup = await cloudflareGet(
    fetchImpl,
    token,
    `/zones?name=${encodeURIComponent(manifest.zone)}&status=active&per_page=2`,
  );
  if (!zoneLookup.ok) {
    findings.push(blockedFinding(
      "zone_lookup",
      zoneLookup,
      ["Zone Read for agenttool.dev"],
    ));
    const summary = summarize(findings);
    return {
      schema: "agenttool.cloudflare-zone-audit/1",
      zone: manifest.zone,
      mode: "read_only",
      summary,
      findings,
      provider_writes: 0,
      exit_code: resultExitCode(summary),
    };
  }
  if (!Array.isArray(zoneLookup.result) || zoneLookup.result.length !== 1) {
    findings.push({
      control: "zone_lookup",
      status: "error",
      detail: "expected exactly one active agenttool.dev zone",
    });
    const summary = summarize(findings);
    return {
      schema: "agenttool.cloudflare-zone-audit/1",
      zone: manifest.zone,
      mode: "read_only",
      summary,
      findings,
      provider_writes: 0,
      exit_code: resultExitCode(summary),
    };
  }
  const zone = zoneLookup.result[0];
  if (!isRecord(zone) || zone.name !== manifest.zone || zone.status !== "active" ||
      !isSafeProviderIdentifier(zone.id) ||
      !isRecord(zone.account) || !isSafeProviderIdentifier(zone.account.id)) {
    findings.push({
      control: "zone_lookup",
      status: "error",
      detail: "zone lookup did not return the exact active zone and scoped identifiers",
    });
    const summary = summarize(findings);
    return {
      schema: "agenttool.cloudflare-zone-audit/1",
      zone: manifest.zone,
      mode: "read_only",
      summary,
      findings,
      provider_writes: 0,
      exit_code: resultExitCode(summary),
    };
  }
  const zoneId = zone.id;
  const accountId = zone.account.id;
  findings.push({
    control: "zone_lookup",
    status: "ok",
    detail: "resolved exactly one active scoped zone",
  });

  const settings = await cloudflareGet(
    fetchImpl,
    token,
    `/zones/${zoneId}/settings`,
  );
  if (settings.ok) {
    findings.push(...auditZoneSettings(settings.result, manifest.zone_settings));
  } else {
    findings.push(blockedFinding(
      "zone_settings",
      settings,
      ["Zone Settings Read"],
    ));
  }

  const dnssec = await cloudflareGet(
    fetchImpl,
    token,
    `/zones/${zoneId}/dnssec`,
  );
  if (!dnssec.ok) {
    findings.push(blockedFinding(
      "dnssec",
      dnssec,
      [manifest.dnssec.required_permission],
    ));
  } else {
    const status = isRecord(dnssec.result) ? dnssec.result.status : null;
    findings.push(status === manifest.dnssec.desired_api_status
      ? {
          control: "dnssec",
          status: "ok",
          detail: "Cloudflare reports DNSSEC active (parent DS present)",
        }
      : {
          control: "dnssec",
          status: "drift",
          detail: "Cloudflare does not report DNSSEC active",
          expected: manifest.dnssec.desired_api_status,
          actual: { desired_status_matches: false },
          required_permissions: [manifest.dnssec.required_permission],
        });
  }
  findings.push(await auditPublicDnssec(fetchImpl, manifest.zone));

  for (const desiredRecord of manifest.dns_records) {
    const records = await cloudflareGet(
      fetchImpl,
      token,
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(desiredRecord.name)}&per_page=100`,
    );
    if (records.ok) {
      findings.push(auditDnsRecords(records.result, desiredRecord));
    } else {
      findings.push(blockedFinding(
        `dns_record:${desiredRecord.name}`,
        records,
        [desiredRecord.required_permission],
      ));
    }
  }

  try {
    const probe = await fetchImpl(manifest.effective_origin_probe.url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    let body: unknown = null;
    try {
      body = await probe.json();
    } catch {
      // Shape mismatch is reported only as booleans below.
    }
    const build = isRecord(body) && isRecord(body.build) ? body.build : null;
    const edgeMatches =
      probe.headers.get("server")?.toLowerCase() === "cloudflare" ||
      probe.headers.has("cf-ray");
    const originMatches =
      (probe.headers.get("via") ?? "").toLowerCase().includes("fly.io") ||
      probe.headers.has("fly-request-id");
    const serviceMatches = isRecord(body) &&
      body.service === manifest.effective_origin_probe.service;
    const statusMatches = isRecord(body) &&
      body.status === manifest.effective_origin_probe.status;
    const cleanBuildMatches = build?.dirty === false &&
      typeof build.revision === "string" && build.revision.length > 0;
    const matches = probe.ok && serviceMatches && statusMatches &&
      (!manifest.effective_origin_probe.require_cloudflare_edge || edgeMatches) &&
      (!manifest.effective_origin_probe.require_fly_origin || originMatches) &&
      (!manifest.effective_origin_probe.require_clean_build || cleanBuildMatches);
    findings.push(matches
      ? {
          control: "effective_origin:api_health",
          status: "ok",
          detail: "public API health proves Cloudflare edge to clean AgentTool Fly origin routing",
        }
      : {
          control: "effective_origin:api_health",
          status: "drift",
          detail: "public API health no longer proves the expected Cloudflare-to-Fly route",
          actual: {
            http_ok: probe.ok,
            service_matches: serviceMatches,
            status_matches: statusMatches,
            cloudflare_edge_matches: edgeMatches,
            fly_origin_matches: originMatches,
            clean_build_matches: cleanBuildMatches,
          },
        });
  } catch {
    findings.push({
      control: "effective_origin:api_health",
      status: "error",
      detail: "public API health probe failed before a response was available",
    });
  }

  const routes = await cloudflareGet(
    fetchImpl,
    token,
    `/zones/${zoneId}/workers/routes`,
  );
  if (routes.ok) {
    findings.push(...auditWorkerRoutes(routes.result, manifest.worker_routes));
  } else {
    findings.push(blockedFinding(
      "worker_routes",
      routes,
      ["Workers Routes Read"],
    ));
  }

  const workersSubdomain = await cloudflareGet(
    fetchImpl,
    token,
    `/accounts/${accountId}/workers/subdomain`,
  );
  if (!workersSubdomain.ok) {
    findings.push(blockedFinding(
      "workers_dev:account_subdomain",
      workersSubdomain,
      ["Workers Scripts Read"],
    ));
  } else {
    const matches = isRecord(workersSubdomain.result) &&
      workersSubdomain.result.subdomain === manifest.workers_dev.account_subdomain;
    findings.push(matches
      ? {
          control: "workers_dev:account_subdomain",
          status: "ok",
          detail: "account provider-host suffix matches the bounded inventory",
        }
      : {
          control: "workers_dev:account_subdomain",
          status: "drift",
          detail: "account provider-host suffix differs; no inferred hostname was emitted",
          actual: { expected_suffix_matches: false },
        });
  }

  for (const desiredScript of manifest.workers_dev.scripts) {
    const scriptSubdomain = await cloudflareGet(
      fetchImpl,
      token,
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(desiredScript.script)}/subdomain`,
    );
    if (!scriptSubdomain.ok) {
      findings.push(blockedFinding(
        `workers_dev:${desiredScript.script}`,
        scriptSubdomain,
        ["Workers Scripts Read"],
      ));
      continue;
    }
    const enabled = isRecord(scriptSubdomain.result)
      ? scriptSubdomain.result.enabled
      : null;
    const previewsEnabled = isRecord(scriptSubdomain.result)
      ? scriptSubdomain.result.previews_enabled
      : null;
    const matches = enabled === desiredScript.enabled &&
      previewsEnabled === desiredScript.previews_enabled;
    findings.push(matches
      ? {
          control: `workers_dev:${desiredScript.script}`,
          status: desiredScript.status === "inventory_source_unrecovered"
            ? "inspect"
            : "ok",
          detail: desiredScript.boundary,
        }
      : {
          control: `workers_dev:${desiredScript.script}`,
          status: "drift",
          detail: "provider-alias enablement differs from the bounded inventory",
          expected: {
            enabled: desiredScript.enabled,
            previews_enabled: desiredScript.previews_enabled,
          },
          actual: {
            enabled_matches: enabled === desiredScript.enabled,
            previews_enabled_matches:
              previewsEnabled === desiredScript.previews_enabled,
          },
        });
  }

  for (const project of manifest.pages_projects) {
    const page = await cloudflareGet(
      fetchImpl,
      token,
      `/accounts/${accountId}/pages/projects/${encodeURIComponent(project.name)}`,
    );
    if (!page.ok) {
      findings.push(blockedFinding(
        `pages:${project.name}`,
        page,
        ["Cloudflare Pages Read"],
      ));
      continue;
    }
    const branch = isRecord(page.result) ? page.result.production_branch : null;
    const providerSubdomainMatches = isRecord(page.result) &&
      page.result.subdomain === project.provider_domain;
    const domains = isRecord(page.result) && Array.isArray(page.result.domains)
      ? page.result.domains
          .filter((domain): domain is string => typeof domain === "string")
      : [];
    const expectedDomains = project.custom_domain === null
      ? [project.provider_domain]
      : [project.provider_domain, project.custom_domain];
    const exactDomainsMatch = domains.length === expectedDomains.length &&
      expectedDomains.every((domain) => domains.includes(domain));
    const deploymentConfigs = isRecord(page.result) &&
        isRecord(page.result.deployment_configs)
      ? page.result.deployment_configs
      : null;
    const production = deploymentConfigs && isRecord(deploymentConfigs.production)
      ? deploymentConfigs.production
      : null;
    const preview = deploymentConfigs && isRecord(deploymentConfigs.preview)
      ? deploymentConfigs.preview
      : null;
    const failOpenMatches =
      production?.fail_open === project.production_fail_open &&
      preview?.fail_open === project.preview_fail_open;
    findings.push(
      branch === project.production_branch &&
        providerSubdomainMatches &&
        exactDomainsMatch &&
        failOpenMatches
      ? {
          control: `pages:${project.name}`,
          status: "ok",
          detail: "branch, domain ownership, and fail-closed production/preview policy match",
        }
      : {
          control: `pages:${project.name}`,
          status: "drift",
          detail: "branch, domain ownership, or fail-open policy differs",
          expected: {
            production_branch: project.production_branch,
            provider_domain: project.provider_domain,
            custom_domain: project.custom_domain,
            production_fail_open: project.production_fail_open,
            preview_fail_open: project.preview_fail_open,
          },
          actual: {
            production_branch_matches: branch === project.production_branch,
            provider_subdomain_matches: providerSubdomainMatches,
            exact_domain_set_matches: exactDomainsMatch,
            production_fail_open_matches:
              production?.fail_open === project.production_fail_open,
            preview_fail_open_matches:
              preview?.fail_open === project.preview_fail_open,
          },
        },
    );
  }

  for (const project of manifest.inventory_only_pages_projects) {
    const page = await cloudflareGet(
      fetchImpl,
      token,
      `/accounts/${accountId}/pages/projects/${encodeURIComponent(project.name)}`,
    );
    if (!page.ok) {
      findings.push(blockedFinding(
        `pages_inventory:${project.name}`,
        page,
        ["Cloudflare Pages Read"],
      ));
      continue;
    }
    const branch = isRecord(page.result) ? page.result.production_branch : null;
    const providerSubdomainMatches = isRecord(page.result) &&
      page.result.subdomain === project.provider_domain;
    const domains = isRecord(page.result) && Array.isArray(page.result.domains)
      ? page.result.domains
      : [];
    const expectedDomains = project.custom_domain === null
      ? [project.provider_domain]
      : [project.provider_domain, project.custom_domain];
    const exactDomainsMatch = domains.length === expectedDomains.length &&
      expectedDomains.every((domain) => domains.includes(domain));
    const matches = branch === project.production_branch &&
      providerSubdomainMatches &&
      exactDomainsMatch;
    findings.push(matches
      ? {
          control: `pages_inventory:${project.name}`,
          status: "inspect",
          detail: project.boundary,
        }
      : {
          control: `pages_inventory:${project.name}`,
          status: "drift",
          detail: "inventory-only Pages project no longer matches the recorded bounded surface",
          actual: {
            production_branch_matches: branch === project.production_branch,
            provider_subdomain_matches: providerSubdomainMatches,
            exact_domain_set_matches: exactDomainsMatch,
          },
        });
  }

  for (const phase of [...new Set(manifest.rulesets.map((rule) => rule.phase))]) {
    const entrypoint = await cloudflareGet(
      fetchImpl,
      token,
      `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`,
    );
    if (entrypoint.ok) {
      findings.push(...auditRuleset(phase, entrypoint.result, manifest.rulesets));
    } else {
      const permissions = [...new Set(
        manifest.rulesets
          .filter((rule) => rule.phase === phase)
          .flatMap((rule) => rule.required_permissions),
      )];
      findings.push(blockedFinding(`ruleset_phase:${phase}`, entrypoint, permissions));
    }
  }

  const waf = await cloudflareGet(
    fetchImpl,
    token,
    `/zones/${zoneId}/rulesets/phases/${manifest.waf.phase}/entrypoint`,
  );
  if (!waf.ok) {
    findings.push(blockedFinding("waf_managed", waf, manifest.waf.required_permissions));
  } else {
    const count = isRecord(waf.result) && Array.isArray(waf.result.rules)
      ? waf.result.rules.length
      : 0;
    findings.push({
      control: "waf_managed",
      status: "inspect",
      detail: `phase is readable with ${count} rule entr${count === 1 ? "y" : "ies"}; policy review is required before edits`,
    });
  }

  const workerSettings = await cloudflareGet(
    fetchImpl,
    token,
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(manifest.observability.worker)}/settings`,
  );
  if (!workerSettings.ok) {
    findings.push(blockedFinding(
      "worker_observability",
      workerSettings,
      ["Workers Scripts Read"],
    ));
  } else {
    const observability = isRecord(workerSettings.result)
      ? workerSettings.result.observability
      : null;
    const expected = {
      enabled: true,
      head_sampling_rate: manifest.observability.head_sampling_rate,
      logs: {
        enabled: true,
        head_sampling_rate:
          manifest.observability.persisted_invocation_log_rate,
        persist: true,
        invocation_logs: true,
      },
      traces: {
        enabled: manifest.observability.traces,
        persist: false,
      },
    };
    findings.push(containsDesired(observability, expected)
      ? {
          control: "worker_observability",
          status: "ok",
          detail: "privacy-minimized invocation logging matches desired state",
        }
      : {
          control: "worker_observability",
          status: "drift",
          detail: "Worker observability differs from desired state",
          expected: asJsonValue(expected),
          actual: {
            enabled_matches:
              isRecord(observability) && observability.enabled === true,
            head_sampling_rate_matches:
              isRecord(observability) &&
              observability.head_sampling_rate ===
                manifest.observability.head_sampling_rate,
            logs_match:
              isRecord(observability) &&
              containsDesired(observability.logs, expected.logs),
            traces_match:
              isRecord(observability) &&
              containsDesired(observability.traces, expected.traces),
          },
        });
  }

  findings.push({
    control: "rate_limiting",
    status: "deferred",
    detail: manifest.rate_limiting.boundary,
  });
  findings.push({
    control: "origin_authentication",
    status: "deferred",
    detail: manifest.origin_authentication.boundary,
    required_permissions: manifest.origin_authentication.required_permissions,
  });

  const summary = summarize(findings);
  return {
    schema: "agenttool.cloudflare-zone-audit/1",
    zone: manifest.zone,
    mode: "read_only",
    summary,
    findings,
    provider_writes: 0,
    exit_code: resultExitCode(summary),
  };
}

function usage(): string {
  return [
    "Usage: bun bin/cloudflare-zone-audit.ts [--live] [--manifest <path>]",
    "",
    "Without --live, validates and summarizes repo desired state only.",
    "--live requires a child-scoped CLOUDFLARE_API_TOKEN and performs GETs only.",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  let live = false;
  let manifestPath = DEFAULT_MANIFEST_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      live = true;
    } else if (argument === "--manifest") {
      const next = argv[index + 1];
      if (!next) throw new Error("--manifest requires a path");
      manifestPath = resolve(next);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      return 0;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  const manifest = loadManifest(manifestPath);
  if (!live) {
    console.log(JSON.stringify({
      schema: "agenttool.cloudflare-zone-audit/1",
      zone: manifest.zone,
      mode: "static",
      status: "desired_state_valid",
      services: manifest.services.length,
      zone_settings: Object.keys(manifest.zone_settings).length,
      rulesets: manifest.rulesets.map((rule) => ({
        ref: rule.ref,
        phase: rule.phase,
        status: rule.status,
      })),
      provider_writes: 0,
    }, null, 2));
    return 0;
  }

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error(
      "cloudflare-zone-audit: --live requires child-scoped CLOUDFLARE_API_TOKEN; no provider request was made",
    );
    return 2;
  }
  const result = await runLiveAudit({ manifest, token });
  console.log(JSON.stringify(result, null, 2));
  return result.exit_code;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      void error;
      console.error("cloudflare-zone-audit: validation or audit failed; provider details were suppressed");
      process.exitCode = 1;
    });
}
