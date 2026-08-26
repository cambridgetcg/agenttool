#!/usr/bin/env bun
// deno-fmt-ignore-file
/**
 * Closed consumer for the one terminal observed-526 refence receipt.
 *
 * One pinned-Bun controller owns the canonical deploy lock for its full
 * lifetime. It proves the terminal stopped refence, prepares credential-free
 * source estates, performs the H0-H5 adoption, journals every provider child,
 * advances only the dedicated marker schema, proves canary/final convergence,
 * and installs the receipt before retiring blockers. It never migrates or
 * mutates a provider secret. Its sole database write is the durable, one-shot
 * disabled-federation origin CAS; it never exposes raw child output,
 * credentials, database rows, Machine IDs, or private evidence contents.
 *
 * The production entry accepts only the canonical controller invocation and
 * enters this one lifetime. There are no standalone checkpoint or adoption
 * subcommands that could create a shorter authority lifetime.
 *
 * Scanner packing is defined by bin/tests/phase-b-refence-maintenance-line-pack.ts.
 *
 * Doctrine: docs/DEPLOY-PROCEDURE.md.
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants as fsConstants, fchmodSync, fchownSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, realpathSync, renameSync, rmdirSync, type Stats,
  statSync, unlinkSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

declare const Bun: any;

type JsonRecord = Record<string, any>;
type Checkpoint = "early" | "prepublication";
export type HandoffEdge = "H0" | "H1" | "H2" | "H3" | "H4" | "H5";
export type HandoffCrashPoint = | "H1_file_fsynced_before_directory_fsync"
  | "H2_linked_before_directory_fsync"
  | "H3_linked_before_directory_fsync"
  | "H4_renamed_before_directory_fsync"
  | "H5_unlinked_before_directory_fsync";
export type SuccessFinalizationCrashPoint = | "A0"
  | "R1"
  | "R2_linked_before_directory_fsync"
  | "R3"
  | "R4_unlinked_before_directory_fsync"
  | "R5"
  | "W1"
  | "M1_linked_before_directory_fsync"
  | "M1"
  | "M2_unlinked_before_directory_fsync"
  | "M2"
  | "W2_linked_before_directory_fsync"
  | "W2"
  | "W3_unlinked_before_directory_fsync"
  | "W3"
  | "M3_unlinked_before_directory_fsync"
  | "M3"
  | "L1_unlinked_before_directory_fsync"
  | "L1"
  | "L2_unlinked_before_directory_fsync"
  | "L2";

export const MAINTENANCE_REFENCE_PROOF_SCHEMA = "agenttool.phase-b-maintenance-refence-proof/1" as const;
export const MAINTENANCE_REFENCE_ADOPTION_SCHEMA = "agenttool.phase-b-maintenance-refence-adoption/1" as const;
export const MAINTENANCE_MARKER_SCHEMA = "agenttool-maintenance-refence-run/v1" as const;
export const MAINTENANCE_REFENCE_BRIDGE_SCHEMA = "agenttool-phase-b-refence-maintenance-bridge/v1" as const;

const APP = "agenttool";
const HOME = "/Users/yournameisai";
const OPERATOR_NAME = "yournameisai";
const OPERATOR_UID = 501;
const STATE_DIR = join(HOME, ".local/state/agenttool");
const DEPLOY_STATE_DIR = join(STATE_DIR, "deploy-state");
const DEPLOY_LOCK = join(STATE_DIR, "deploy.lock");
const REFENCE_RECEIPT = join( STATE_DIR, "phase-b-refence-observed-526-v1-receipt.json", );
const REFENCE_OPERATOR = join( STATE_DIR, "phase-b-refence-observed-526-v1.ts", );
const REFENCE_HARNESS = join( STATE_DIR, "phase-b-refence-observed-526-v1.synthetic.test.ts", );
const FULL_AUDIT = join( STATE_DIR, "phase-b-full-production-audit-unowned-526-v3.ts", );
const FULL_AUDIT_HARNESS = join( STATE_DIR, "phase-b-full-production-audit-unowned-526-v3.synthetic.test.ts", );
const FULL_AUDIT_WITNESS = join( STATE_DIR, "phase-b-full-production-audit-unowned-526-v3-success.json", );
const MAINTENANCE_MARKER = join(DEPLOY_STATE_DIR, "maintenance-active.json");
const ARMED_WITNESS = join( DEPLOY_STATE_DIR, "phase-b-refence-observed-526-mutation-active.json", );
const WAL_ROOT = join( DEPLOY_STATE_DIR, "phase-b-refence-observed-526-wal", );
const RECOVERY_CLAIM = join( DEPLOY_STATE_DIR, "phase-b-refence-observed-526-recovery.lock", );
const DEPLOY_RECEIPT_DIR = join(STATE_DIR, "deploy-receipts");
const PHASE_B_GENERATION_ACTIVE_MARKER = join( DEPLOY_STATE_DIR, "phase-b-authority-generation-active.json", );
const CONTROLLER_WAL_ROOT = join( DEPLOY_STATE_DIR, "phase-b-refence-maintenance-bridge-wal", );
const CONTROLLER_BUILD_ROOT = join( STATE_DIR, "refence-maintenance-build-contexts", );
const CONTROLLER_DEPENDENCY_ROOT = join( STATE_DIR, "refence-maintenance-dependency-estates", );
const POSTGRES_RUNTIME_SOURCE = join( HOME, ".bun/install/cache/postgres@3.4.9@@@1", );
const EXPECTED_BUILD_MANIFEST_SHA256 = "ba1ee2dc3ede33e02460fd139273199db0d2c8e075976a28ff230543d46a7626";
const EXPECTED_BUILD_MANIFEST_BYTE_COUNT = 130_718;
const EXPECTED_BUILD_FILE_COUNT = 707;
const EXPECTED_BUILD_BYTE_COUNT = 10_102_535;
const REPOSITORY_ROOT = "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1";
const MIGRATIONS_DIR = join(REPOSITORY_ROOT, "api/migrations");
const BRIDGE_SOURCE = join( REPOSITORY_ROOT, "bin/phase-b-refence-maintenance-bridge.ts", );
const CONTRACT_SOURCE = join( REPOSITORY_ROOT, "bin/phase-b-refence-maintenance-contract.ts", );
const CONTRACT_SOURCE_SHA256 = "0c7ad30f81271b42a2339fcf1f87705c1ff6ee4a5906506f8a2c089ab92e74a1";
const CONTRACT_SOURCE_GIT_BLOB = "ea83765c054b3bf130a4c8957a5a30ef1e657cb6";
const ORDINARY_GUARD_SOURCE = join( REPOSITORY_ROOT, "bin/phase-b-deploy-guard.ts", );
const ORDINARY_GUARD_SHA256 = "10fe5012e8069ede11eaa3abe0a05f08225d855bb722d52746279dbc21c5fade";
const ORDINARY_GUARD_GIT_BLOB = "4d2b5be9ac6285d6d3293a1d41c3a36bc7c8f003";
const ORDINARY_GUARD_BYTE_COUNT = 68_763;
const PINNED_BUN = join( HOME, ".cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64/bun", );
const PINNED_BUN_SHA256 = "66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3";
const PINNED_BUN_BYTE_COUNT = 59_885_424;
const PINNED_BUN_VERSION = "1.3.5";
const PINNED_FLY = join(HOME, ".cache/codex-tools/flyctl-v0.4.74/fly");
const PINNED_FLY_SHA256 = "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3";
const FLY_CONFIG_DIRECTORY = join(HOME, ".fly");
const FLY_CONFIG = join(FLY_CONFIG_DIRECTORY, "config.yml");
const SECURITY = "/usr/bin/security";
const SECURITY_SHA256 = "baea59da9d5e198fda23654e9153f263d9ae8741883c32d22a8ee3317b3f6107";
const PS = "/bin/ps";
const PS_SHA256 = "78dad79869a7104bcc8d925889a69730d3fb2927215289a02e1e9835b65187db";
const GIT = "/usr/bin/git";
const GIT_SHA256 = "9fea4c255f4fccf90950cc2915175f5e030d2cf4ec546f8baf35d0855c45c741";
const GITHUB_MAIN_URL = "https://github.com/cambridgetcg/agenttool.git";
const GITHUB_MAIN_TRACKING_REF = "refs/remotes/github/main";
const GIT_CLOSED_FLAGS = [ "--no-optional-locks", "-c", "credential.helper=", "-c", "credential.interactive=false", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "http.proxy=", "-c", "https.proxy=", "-c",
  "http.extraHeader=", "-c", "http.followRedirects=false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", ] as const;
const EXACT_PATH = `${dirname(PINNED_FLY)}:${ dirname(PINNED_BUN) }:/usr/bin:/bin:/usr/sbin:/sbin`;
const CONTROLLER_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({ HOME, USER: OPERATOR_NAME, LOGNAME: OPERATOR_NAME, LANG: "C", LC_ALL: "C", NO_COLOR: "1", TERM: "dumb", PATH: EXACT_PATH, });
const GIT_CHILD_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({ ...CONTROLLER_ENVIRONMENT, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", });
const KEYCHAIN_ACCOUNT = "macair";
const MACHINE_MAP_SERVICE = "agenttool-federation-phase-a-machine-map-20260821T1915Z-v1";
const MACHINE_MAP_SHA256 = "8c27bb32b5306ebdc4fa4b630d58cd098203c0dd762ee2f0f42e73c9aef5c8d1";
const GENERATION_KEYCHAIN_SERVICE = "agenttool-covenant-v2-authority-generation";
const GENERATION_PROVIDER_SECRET = "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION";
const EXPECTED_SOURCE_REVISION = "526edc4ee0d076783d157591d7e3434352f6fc84";
const EXPECTED_SOURCE_TREE = "ff77236e51cad8acc99ee4064af48b689df85854";
const EXPECTED_IMAGE_DIGEST = "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c";
const EXPECTED_IMAGE_TAG = "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc";
const EXPECTED_MACHINE_SET_SHA256 = "0709af1a942960f1ba577c0896de3ff0172ec4b8f6ac2462a07b6c425845ada5";
const EXPECTED_MIGRATION_APPLIED_AT = [ "2026-08-24T21:02:16.132506Z", "2026-08-24T21:02:16.520915Z", ] as const;
const EXPECTED_MIGRATIONS = [ [ "20260824T120000_covenant_v2_generation_hold.sql", "2f3463f4f45a62f283c5b5d4b47410b9cb6d8c6ac3dd5210d09e837e1e6b5f1f", ], [ "20260824T132712_crypto_deposit_remainder_accounting.sql",
    "2fda8bb8440f8d58a78c051eca36e3097dbf3e4ad8844d028a66cfaee39a17eb", ], ] as const;
const EXPECTED_JOURNAL_FILE_COUNT = 177;
const EXPECTED_CRON_SHA256 = "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34";
const EXPECTED_CRON = [ ["covenant-cosign-propagate", "* * * * *"], ["covenant-expiry-sweep", "*/15 * * * *"], ["covenant-stale-reverify-flag", "0 * * * *"], ["substrate-continuity-audit", "0 12 * * *"],
  ["substrate-loop-heartbeat", "0 * * * *"], ] as const;
const EXPECTED_FEDERATION_UPDATED_AT = "2026-08-21T18:49:13.745704Z";
const PRE_REFENCE_INSTANCE_URL = "https://agenttool.fly.dev";
const TARGET_INSTANCE_URL = "https://api.agenttool.dev";
const PUBLIC_HEALTH_URL = `${TARGET_INSTANCE_URL}/health`;
const PUBLIC_FEDERATION_ABOUT_URL = `${TARGET_INSTANCE_URL}/federation/about`;
const PUBLIC_BODY_BYTE_LIMIT = 500_000;
const PUBLIC_OBSERVATION_BYTE_LIMIT = 1_500_000;
const PUBLIC_HTTP_PROGRAM = [ "try{", `const allowed=${ JSON.stringify([ "https://api.agenttool.dev/health", "https://api.agenttool.dev/federation/about", ]) };`,
  "const fail=()=>{throw 0};if(Bun.argv.length!==2||!allowed.includes(Bun.argv[1]))fail();", "const url=Bun.argv[1];const started=Date.now();",
  "if(!Number.isSafeInteger(started)||started<=8000||started>Number.MAX_SAFE_INTEGER-20000)fail();", "const controller=new AbortController();let reader=null;let complete=false;", "const timer=setTimeout(()=>controller.abort(),20000);",
  "try{", 'const response=await fetch(url,{method:"GET",redirect:"manual",cache:"no-store",credentials:"omit",headers:{Accept:"application/json"},signal:controller.signal});',
  "if(response.status!==200||response.url!==url||response.redirected!==false||response.body===null)fail();", 'const contentType=response.headers.get("content-type");if(typeof contentType!=="string")fail();',
  `const contentLength=response.headers.get("content-length");if(contentLength!==null){if(!/^(?:0|[1-9][0-9]*)$/.test(contentLength))fail();const length=Number(contentLength);if(!Number.isSafeInteger(length)||length<1||length>${PUBLIC_BODY_BYTE_LIMIT})fail();}`,
  "reader=response.body.getReader();const chunks=[];let total=0;",
  `while(true){const part=await reader.read();if(part.done){complete=true;break}if(!(part.value instanceof Uint8Array))fail();total+=part.value.byteLength;if(!Number.isSafeInteger(total)||total>${PUBLIC_BODY_BYTE_LIMIT})fail();chunks.push(part.value)}`,
  "if(total<1)fail();const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}",
  'const body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(typeof body!=="object"||body===null||Array.isArray(body))fail();', 'const bodySha256=new Bun.CryptoHasher("sha256").update(bytes).digest("hex");',
  "const settled=Date.now();if(!Number.isSafeInteger(settled)||settled<started||settled>Number.MAX_SAFE_INTEGER-8000)fail();",
  'const sort=(value)=>Array.isArray(value)?value.map(sort):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map((key)=>[key,sort(value[key])])):value;',
  'const observation={body,bodyByteCount:total,bodySha256,cacheControl:response.headers.get("cache-control"),contentType,finalURL:response.url,observationSettledAtUnixMs:settled,observationStartedAtUnixMs:started,redirected:response.redirected,status:response.status};',
  `const output=JSON.stringify(sort(observation))+"\\n";const outputBytes=new TextEncoder().encode(output).byteLength;if(outputBytes<1||outputBytes>${PUBLIC_OBSERVATION_BYTE_LIMIT})fail();if(await Bun.write(Bun.stdout,output)!==outputBytes)fail();`,
  "}finally{clearTimeout(timer);controller.abort();if(reader!==null){if(!complete)try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}}", "}catch{process.exit(1)}", ].join("");
const PRE_REFENCE_INSTANCE_URL_SHA256 = "46b695dffb312f6591e480ec5882d894e1b5e1efdb3bfc05da6303f9259ba818";
const TARGET_INSTANCE_URL_SHA256 = "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d";
const HOLD_COLUMN_COMMENT = "Private durable interlock: while true, covenant-v2 generation rollout requires allowed_origins to remain empty.";
const REMAINDER_COLUMN_COMMENT = "Exact USDC atomic units left after whole-credit decomposition at the recorded 10,000-atomic credit quantum. NULL means historical amount evidence is absent; it never implies zero.";
const GENERATION_FUNCTION_PROSRC_SHA256 = "f3ab7f21c68b17807786ab34cebc27257ef57df3e3f7ecd1b1539468cfa9254b";
const EXPECTED_CONSTRAINT_DEFINITIONS: Readonly<
  Record<string, [string, string]>
> = Object.freeze({ federation_settings_covenant_v2_generation_hold_empty: [ "CHECK (NOT covenant_v2_generation_hold OR cardinality(allowed_origins) = 0)", "NOT covenant_v2_generation_hold OR cardinality(allowed_origins) = 0", ],
  crypto_webhook_events_credit_remainder_exact_check: [
    "CHECK (amount_base IS NULL AND credit_remainder_base IS NULL OR amount_base IS NOT NULL AND credit_remainder_base IS NOT NULL AND credit_remainder_base = mod(amount_base, 10000::numeric))",
    "amount_base IS NULL AND credit_remainder_base IS NULL OR amount_base IS NOT NULL AND credit_remainder_base IS NOT NULL AND credit_remainder_base = mod(amount_base, 10000::numeric)", ],
  crypto_webhook_events_credit_remainder_range_check: [ "CHECK (credit_remainder_base IS NULL OR credit_remainder_base >= 0::numeric AND credit_remainder_base < 10000::numeric)",
    "credit_remainder_base IS NULL OR credit_remainder_base >= 0::numeric AND credit_remainder_base < 10000::numeric", ], crypto_webhook_events_nonintegral_not_creditable_check: [
    "CHECK (credit_remainder_base IS NULL OR credit_remainder_base = 0::numeric OR (status = ANY (ARRAY['removed'::text, 'rejected'::text, 'quarantined'::text])))",
    "credit_remainder_base IS NULL OR credit_remainder_base = 0::numeric OR (status = ANY (ARRAY['removed'::text, 'rejected'::text, 'quarantined'::text]))", ], crypto_webhook_events_remainder_quarantine_check: [
    "CHECK (NOT (status = 'quarantined'::text AND error = 'non_integral_credit_amount'::text) OR credit_remainder_base IS NOT NULL AND credit_remainder_base > 0::numeric)",
    "NOT (status = 'quarantined'::text AND error = 'non_integral_credit_amount'::text) OR credit_remainder_base IS NOT NULL AND credit_remainder_base > 0::numeric", ], });

// The only external source pin is the producer's stable zero-normalized
// semantic hash. Raw producer/harness/audit hashes are receipt data and are
// recomputed from their private files. The bridge normalizer zeroes only its
// own pin, so any change to the producer semantic pin changes bridge identity.
const REFENCE_OPERATOR_SEMANTIC_SHA256 = "71fa9f6cd4de141add54500701e56de5e49c74089e27dd13a2be77bb54bbe44d";
// deno-fmt-ignore
const BRIDGE_NORMALIZED_SHA256 =
  "24790525c5c56aae7879b017a92d46933a8a71675368a82f5a6eb7a88334518a";

const MAX_PRIVATE_BYTES = 1_000_000;
const MAX_CHILD_BYTES = 2_000_000;
const MAX_WAL_ENTRIES = 512;
const FLEET_INTERVAL_MS = 1_137;
const STABLE_DRAIN_INTERVAL_MS = 5_137;

const OPERATOR_NORMALIZATION_DECLARATIONS = [ [ "OPERATOR_NORMALIZED_SHA256", "__OPERATOR_SELF_NORMALIZED_SHA256__", "operator_normalized_sha256", ], ["HARNESS_SHA256", "__OPERATOR_HARNESS_SHA256__", "operator_harness_sha256"], [
    "FULL_AUDIT_SHA256", "__FULL_AUDIT_RAW_SHA256__", "audit_evidence.source_sha256", ], [ "FULL_AUDIT_NORMALIZED_SHA256", "__FULL_AUDIT_NORMALIZED_SHA256__", "audit_evidence.source_normalized_sha256", ], [ "FULL_AUDIT_HARNESS_SHA256",
    "__FULL_AUDIT_HARNESS_SHA256__", "audit_evidence.harness_sha256", ], [ "FULL_AUDIT_WITNESS_SHA256", "__FULL_AUDIT_WITNESS_SHA256__", "audit_evidence.witness_sha256", ], [ "READMISSION_BRIDGE_REVISION", "__READMISSION_BRIDGE_REVISION__",
    "readmission_target.protected_main_revision", ], [ "READMISSION_BRIDGE_TREE", "__READMISSION_BRIDGE_TREE__", "readmission_target.protected_main_tree", ], [ "READMISSION_BRIDGE_DISTANCE_PIN", "__READMISSION_BRIDGE_DISTANCE__",
    "readmission_target.clean_526_ancestor_distance", ], [ "READMISSION_GUARD_NORMALIZED_SHA256", "__READMISSION_GUARD_NORMALIZED_SHA256__", "readmission_guard_normalized_sha256", ], ] as const;

export const OPERATOR_NORMALIZATION_CONTRACT = Object.freeze({ schema: "agenttool-phase-b-refence-observed-526-normalization/v1", algorithm: "unique_exact_declaration_replacement_then_sha256", paths_normalized: false,
  code_normalized: false, unique_occurrence_required: true, declarations: OPERATOR_NORMALIZATION_DECLARATIONS.map( ([name, replacement_token, receipt_binding]) => ({ name, replacement_token, receipt_binding, }), ), });

const ZERO_DRAIN_FIELDS = [ "runtime_cycle_leases", "llm_unresolved_runtime", "llm_unresolved_unbound", "deposit_leases_live", "deposit_leases_expired", "deposit_leases_malformed", "deposit_pending", "covenant_declaration_in_flight",
  "covenant_lifecycle_in_flight", "x402_pending_unattempted", "x402_pending_attempted", "x402_externally_settled", "payout_broadcasting", "payout_broadcast", "collab_slots_live", "collab_slots_expired", "collab_slots_recovery",
  "collab_runs_claimed", "collab_runs_executing", "collab_runs_ambiguous", "advisory_locks", "lock_waiters", "other_nonidle", "other_open_transactions", "prepared_transactions", "cron_running", "pg_net_queued", "reserved_generation_rows",
  "authoritative_v2_rows", "received_v1_rows", ] as const;

const PRODUCER_CRITICAL_STATIC_CONTRACT = Object.freeze({ migrationAppliedAt: EXPECTED_MIGRATION_APPLIED_AT, constraintDefinitions: EXPECTED_CONSTRAINT_DEFINITIONS, holdColumnComment: HOLD_COLUMN_COMMENT,
  remainderColumnComment: REMAINDER_COLUMN_COMMENT, generationFunctionProsrcSHA256: GENERATION_FUNCTION_PROSRC_SHA256, cronSHA256: EXPECTED_CRON_SHA256, zeroFields: ZERO_DRAIN_FIELDS, machineSetSHA256: EXPECTED_MACHINE_SET_SHA256,
  restoredConfigSHA256ByRole: Object.freeze({ app_lhr_1: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538", app_lhr_2: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538",
    app_cdg: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538", thinker_primary: "c780301f005cc3739f73201ddc0b3678129e00b0261f314a8569273951082e99", thinker_standby:
      "cd85d59bb91a78dad8067228cc2d4d791be08e4c44de87dcb81bba11f3f6b6cf", }), });

const DATABASE_PROOF_ROW_KEYS = [ "settings_rows", "federation_id", "federation_enabled", "federation_instance_url", "federation_allowed_origins", "generation_hold", "federation_updated_at", "hold_column_exact", "hold_constraint_exact",
  "remainder_column_exact", "remainder_constraints", "remainder_index", "generation_function", "remainder_mismatch", "remainder_creditable", "false_remainder_quarantine", "remainder_affected_count", ...ZERO_DRAIN_FIELDS, "x402_inserted",
  "payout_requested", ] as const;

export class MaintenanceRefenceError extends Error { readonly code: string;

  constructor(code: string) { super(code);
    this.name = "MaintenanceRefenceError";
    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "internal_failure"; } }

function refuse(code: string): never { throw new MaintenanceRefenceError(code); }

function requireCondition(condition: unknown, code: string): asserts condition { if (!condition) refuse(code); }

function isRecord(value: unknown): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }

function record(value: unknown, code: string): JsonRecord { requireCondition(isRecord(value), code);
  return value; }

function exactKeys( value: unknown, expected: readonly string[], code: string, ): void { const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  requireCondition( actual.length === wanted.length && actual.every((entry, index) => entry === wanted[index]), code, ); }

export function canonicalJson(value: unknown): string { if (value === null) return "null";
  if (Array.isArray(value)) { return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`; }
  if (isRecord(value)) { return `{${ Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}` ).join(",") }}`; }
  requireCondition( typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), "canonical_value", );
  return JSON.stringify(value); }

export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

function parseCanonicalJsonBytes(bytes: Uint8Array, code: string): JsonRecord { const text = decode(bytes, code);
  requireCondition(text.endsWith("\n") && !text.includes("\r"), code);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refuse(code); }
  requireCondition( isRecord(parsed) && text === `${canonicalJson(parsed)}\n`, code, );
  return parsed; }

function validSha(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }

function validRevision(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{40}$/.test(value); }

function validMachineID(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{14}$/.test(value); }

function validRunID(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test( value, ); }

function validUtcTimestamp(value: unknown): value is string { if (typeof value !== "string") return false;
  const match = value.match( /^(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?Z$/, );
  if (!match) return false;
  const milliseconds = (match[2] ?? "").padEnd(3, "0").slice(0, 3);
  const millisecondIso = `${match[1]}.${milliseconds}Z`;
  const parsed = Date.parse(millisecondIso);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === millisecondIso; }

function utcTimestampOrderKey(value: unknown): string { requireCondition(validUtcTimestamp(value), "timestamp_order");
  const match = value.match( /^(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?Z$/, );
  requireCondition(match !== null, "timestamp_order");
  return `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z`; }

function absent(path: string, code = "local_evidence_refused"): boolean { try { lstatSync(path);
    return false; } catch (error: any) { if (error?.code === "ENOENT") return true;
    return refuse(code); } }

function fsyncPath(path: string, afterSync?: () => void): void { const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor);
    afterSync?.(); } finally { closeSync(descriptor); } }

export interface DurableFileIdentity { device: number;
  inode: number;
  sha256: string;
  size: number; }

function sameFileIdentity(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino; }

function durableIdentity( stat: Stats, bytes: string | Uint8Array, ): DurableFileIdentity { requireCondition( Number.isSafeInteger(stat.dev) && stat.dev >= 0 && Number.isSafeInteger(stat.ino) && stat.ino > 0 &&
      Number.isSafeInteger(stat.size) && stat.size >= 0, "durable_file_identity", );
  return { device: stat.dev, inode: stat.ino, sha256: sha256(bytes), size: stat.size, }; }

function requireExactFileIdentity( path: string, expected: DurableFileIdentity, options: { mode?: number; links?: readonly number[] } = {}, ): Stats { const mode = options.mode ?? 0o600;
  const links = options.links ?? [1];
  const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && (before.mode & 0o777) === mode && links.includes(before.nlink) &&
      before.dev === expected.device && before.ino === expected.inode && before.size === expected.size, "durable_file_identity", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( sameFileIdentity(opened, before) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && opened.size === expected.size && after.size === opened.size && rebound.size === opened.size &&
        after.nlink === opened.nlink && rebound.nlink === opened.nlink && sha256(bytes) === expected.sha256, "durable_file_identity", );
    return rebound; } finally { closeSync(descriptor); } }

function openExactFileIdentity( path: string, expected: DurableFileIdentity, links: readonly number[] = [1], ): number { const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = requireOpenFileIdentity(descriptor, expected, links);
    const rebound = requireExactFileIdentity(path, expected, { links });
    requireCondition( sameFileIdentity(opened, rebound), "durable_file_identity", );
    return descriptor; } catch (error) { closeSync(descriptor);
    throw error; } }

function requireOpenFileIdentity( descriptor: number, expected: DurableFileIdentity, links: readonly number[], ): Stats { const before = fstatSync(descriptor);
  requireCondition( before.isFile() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && before.dev === expected.device && before.ino === expected.inode &&
      before.size === expected.size && links.includes(before.nlink) && (before.mode & 0o777) === 0o600, "durable_file_identity", );
  const bytes = Buffer.alloc(expected.size);
  let offset = 0;
  while (offset < bytes.length) { const count = readSync( descriptor, bytes, offset, bytes.length - offset, offset, );
    requireCondition(count > 0, "durable_file_identity");
    offset += count; }
  const after = fstatSync(descriptor);
  requireCondition( after.isFile() && after.uid === process.getuid?.() && after.gid === process.getgid?.() && (after.mode & 0o777) === 0o600 && after.dev === expected.device && after.ino === expected.inode &&
      after.size === expected.size && links.includes(after.nlink) && sameFileIdentity(before, after) && before.size === after.size && before.nlink === after.nlink && sha256(bytes) === expected.sha256, "durable_file_identity", );
  return after; }

function requirePathAndOpenFileIdentity( path: string, descriptor: number, expected: DurableFileIdentity, links: readonly number[], ): Stats { const pathIdentity = requireExactFileIdentity(path, expected, { links });
  const openIdentity = requireOpenFileIdentity(descriptor, expected, links);
  requireCondition( sameFileIdentity(pathIdentity, openIdentity), "durable_file_identity", );
  return openIdentity; }

function createExclusiveDurableFile( path: string, bytes: string | Uint8Array, directory: string, mode = 0o600, ): DurableFileIdentity { const descriptor = openSync( path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW, mode, );
  let written: Stats;
  try { const opened = fstatSync(descriptor);
    requireCondition( opened.isFile() && opened.uid === process.getuid?.() && opened.gid === process.getgid?.() && opened.nlink === 1 && opened.size === 0, "durable_file_create", );
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    written = fstatSync(descriptor);
    requireCondition( sameFileIdentity(written, opened) && written.nlink === 1 && written.size === Buffer.byteLength(bytes) && (written.mode & 0o777) === mode, "durable_file_create", ); } finally { closeSync(descriptor); }
  const identity = durableIdentity(written!, bytes);
  requireExactFileIdentity(path, identity, { mode });
  fsyncPath(directory);
  requireExactFileIdentity(path, identity, { mode });
  return identity; }

function createExclusiveFsyncedStageFile( path: string, bytes: string | Uint8Array, mode = 0o600, ): { identity: DurableFileIdentity; descriptor: number } { const descriptor = openSync( path, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW, mode, );
  let written: Stats;
  try { const opened = fstatSync(descriptor);
    requireCondition( opened.isFile() && opened.uid === process.getuid?.() && opened.gid === process.getgid?.() && opened.nlink === 1 && opened.size === 0, "durable_stage_create", );
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    written = fstatSync(descriptor);
    requireCondition( sameFileIdentity(written, opened) && written.nlink === 1 && written.size === Buffer.byteLength(bytes) && (written.mode & 0o777) === mode, "durable_stage_create", );
    const identity = durableIdentity(written, bytes);
    requirePathAndOpenFileIdentity(path, descriptor, identity, [1]);
    return { identity, descriptor }; } catch (error) { closeSync(descriptor);
    throw error; } }

export interface DeployLockAuthority { readonly ownerPath: string;
  readonly recordBytes: string;
  readonly identity: DurableFileIdentity;
  readonly descriptor: number;
  phase: "held" | "public_unlinked" | "released"; }

const deployLockDescriptorState = new WeakMap<
  DeployLockAuthority, "open" | "attempted" | "closed"
>();

function closeRetainedDeployLockDescriptor( authority: DeployLockAuthority, ): boolean { const state = deployLockDescriptorState.get(authority) ?? (authority.phase === "released" ? "closed" : "open");
  if (state !== "open") return state === "closed";
  deployLockDescriptorState.set(authority, "attempted");
  try { const current = fstatSync(authority.descriptor);
    requireCondition( current.dev === authority.identity.device && current.ino === authority.identity.inode && current.size === authority.identity.size && current.isFile() && current.uid === process.getuid?.() &&
        current.gid === process.getgid?.() && (current.mode & 0o777) === 0o600, "deploy_lock_descriptor_close", );
    closeSync(authority.descriptor);
    deployLockDescriptorState.set(authority, "closed");
    return true; } catch (error: any) { if (error?.code === "EBADF") { deployLockDescriptorState.set(authority, "closed");
      return true; }
    return false; } }

/** @internal Closes only the owned descriptor; retained lock names are untouched. */
export function closeRetainedDeployLockDescriptorForTest( authority: DeployLockAuthority, ): boolean { return closeRetainedDeployLockDescriptor(authority); }

interface DeployLockPaths { directory: string;
  publicPath: string;
  worktree: string; }

function deployLockRecord( ownerPath: string, startedAt: string, worktree: string, ): string { return [ "schema=agenttool-local-deploy-lock/v1", `owner_id=${basename(ownerPath)}`, `pid=${process.pid}`, `started_at=${startedAt}`,
    `worktree=${worktree}`, `owner_record=${ownerPath}`, "", ].join("\n"); }

function verifyDeployLockAuthority( authority: DeployLockAuthority, paths: DeployLockPaths = { directory: STATE_DIR, publicPath: DEPLOY_LOCK, worktree: REPOSITORY_ROOT, }, recordPaths: DeployLockPaths = paths,
  recordOwnerPath = authority.ownerPath, ): void { requireCondition(authority.phase === "held", "deploy_lock_contract");
  const fields = authority.recordBytes.split("\n");
  requireCondition( fields.length === 7 && fields[6] === "" && fields[0] === "schema=agenttool-local-deploy-lock/v1" && fields[1] === `owner_id=${basename(recordOwnerPath)}` && fields[2] === `pid=${process.pid}` &&
      /^started_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/ .test(fields[3]!) && fields[4] === `worktree=${recordPaths.worktree}` && fields[5] === `owner_record=${recordOwnerPath}` &&
      dirname(authority.ownerPath) === paths.directory && dirname(recordOwnerPath) === recordPaths.directory && sha256(authority.recordBytes) === authority.identity.sha256, "deploy_lock_contract", );
  const descriptorStat = fstatSync(authority.descriptor);
  const owner = requireExactFileIdentity( authority.ownerPath, authority.identity, { links: [2] }, );
  const lock = requireExactFileIdentity( paths.publicPath, authority.identity, { links: [2] }, );
  requireCondition( sameFileIdentity(descriptorStat, owner) && sameFileIdentity(owner, lock) && descriptorStat.nlink === 2 && descriptorStat.size === Buffer.byteLength(authority.recordBytes), "deploy_lock_contract", ); }

export function acquireDeployLockForController( paths: DeployLockPaths = { directory: STATE_DIR, publicPath: DEPLOY_LOCK, worktree: REPOSITORY_ROOT, }, now = new Date(), ): DeployLockAuthority { requirePrivateDirectory(paths.directory);
  requireCondition( realpathSync(paths.worktree) === paths.worktree && absent(paths.publicPath), "deploy_lock_conflict", );
  const startedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  requireCondition(validUtcTimestamp(startedAt), "deploy_lock_contract");
  const ownerPath = join( paths.directory, ".deploy-lock-owner.refence-" + process.pid + "-" +
      randomBytes(8).toString("hex"), );
  const recordBytes = deployLockRecord(ownerPath, startedAt, paths.worktree);
  let identity: DurableFileIdentity | null = null;
  let descriptor: number | null = null;
  try { identity = createExclusiveDurableFile( ownerPath, recordBytes, paths.directory, );
    descriptor = openSync( ownerPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
    const opened = fstatSync(descriptor);
    requireCondition( opened.dev === identity.device && opened.ino === identity.inode && opened.nlink === 1, "deploy_lock_contract", );
    linkSync(ownerPath, paths.publicPath);
    fsyncPath(paths.directory);
    const authority: DeployLockAuthority = { ownerPath, recordBytes, identity, descriptor, phase: "held", };
    deployLockDescriptorState.set(authority, "open");
    verifyDeployLockAuthority(authority, paths);
    return authority; } catch (error) { if (descriptor !== null) closeSync(descriptor);
    if (identity !== null) { try { const owner = lstatSync(ownerPath);
        let publishedByThisProcess = false;
        try { publishedByThisProcess = sameFileIdentity( owner, lstatSync(paths.publicPath), ); } catch (publicError: any) { requireCondition( publicError?.code === "ENOENT", "deploy_lock_contract", ); }
        if (!publishedByThisProcess) { requireExactFileIdentity(ownerPath, identity);
          unlinkSync(ownerPath);
          fsyncPath(paths.directory); } } catch {} }
    throw error; } }

export function releaseDeployLockForController( authority: DeployLockAuthority, paths: DeployLockPaths = { directory: STATE_DIR, publicPath: DEPLOY_LOCK, worktree: REPOSITORY_ROOT, }, ): void {
  releaseDeployLockPublicForController(authority, paths);
  releaseDeployLockOwnerForController(authority, paths); }

export function releaseDeployLockPublicForController( authority: DeployLockAuthority, paths: DeployLockPaths = { directory: STATE_DIR, publicPath: DEPLOY_LOCK, worktree: REPOSITORY_ROOT, }, afterUnlink: () => void = () => {},
  fsyncDirectory: (path: string) => void = fsyncPath, recordPaths: DeployLockPaths = paths, recordOwnerPath = authority.ownerPath, ): void { verifyDeployLockAuthority( authority, paths, recordPaths, recordOwnerPath, );
  unlinkSync(paths.publicPath);
  let remaining = fstatSync(authority.descriptor);
  requireCondition( remaining.dev === authority.identity.device && remaining.ino === authority.identity.inode && remaining.nlink === 1 && absent(paths.publicPath), "deploy_lock_release", );
  requireExactFileIdentity(authority.ownerPath, authority.identity, { links: [1], });
  authority.phase = "public_unlinked";
  afterUnlink();
  remaining = fstatSync(authority.descriptor);
  requireCondition( remaining.dev === authority.identity.device && remaining.ino === authority.identity.inode && remaining.nlink === 1 && absent(paths.publicPath), "deploy_lock_release", );
  requireExactFileIdentity(authority.ownerPath, authority.identity, { links: [1], });
  fsyncDirectory(paths.directory);
  remaining = fstatSync(authority.descriptor);
  requireCondition( remaining.dev === authority.identity.device && remaining.ino === authority.identity.inode && remaining.nlink === 1 && absent(paths.publicPath), "deploy_lock_release", );
  requireExactFileIdentity(authority.ownerPath, authority.identity, { links: [1], }); }

export function releaseDeployLockOwnerForController( authority: DeployLockAuthority, paths: DeployLockPaths = { directory: STATE_DIR, publicPath: DEPLOY_LOCK, worktree: REPOSITORY_ROOT, }, afterUnlink: () => void = () => {},
  fsyncDirectory: (path: string) => void = fsyncPath, ): void { requireCondition( authority.phase === "public_unlinked" && absent(paths.publicPath), "deploy_lock_release", );
  const remaining = fstatSync(authority.descriptor);
  const owner = requireExactFileIdentity( authority.ownerPath, authority.identity, { links: [1] }, );
  requireCondition( sameFileIdentity(remaining, owner) && remaining.nlink === 1, "deploy_lock_release", );
  unlinkSync(authority.ownerPath);
  let unlinked = fstatSync(authority.descriptor);
  requireCondition( unlinked.dev === authority.identity.device && unlinked.ino === authority.identity.inode && unlinked.nlink === 0 && absent(authority.ownerPath) && absent(paths.publicPath), "deploy_lock_release", );
  afterUnlink();
  unlinked = fstatSync(authority.descriptor);
  requireCondition( unlinked.dev === authority.identity.device && unlinked.ino === authority.identity.inode && unlinked.nlink === 0 && absent(authority.ownerPath) && absent(paths.publicPath), "deploy_lock_release", );
  fsyncDirectory(paths.directory);
  unlinked = fstatSync(authority.descriptor);
  requireCondition( unlinked.dev === authority.identity.device && unlinked.ino === authority.identity.inode && unlinked.nlink === 0 && absent(authority.ownerPath), "deploy_lock_release", );
  requireCondition( closeRetainedDeployLockDescriptor(authority), "deploy_lock_release", );
  authority.phase = "released"; }

export interface SuccessFinalizationPaths { stateDirectory: string;
  lockDirectory: string;
  receiptDirectory: string;
  worktree: string;
  markerPath: string;
  markerRetirementClaimPath: string;
  receiptPath: string;
  receiptStagePath: string;
  witnessPath: string;
  witnessStagePath: string;
  publicLockPath: string; }

export type SuccessFinalizationArtifacts = SuccessArtifactContractBundle;

export type SuccessFinalizationDescriptorRole = | "lock"
  | "receipt"
  | "marker"
  | "witness";

export interface SuccessFinalizationOpenDescriptor { role: SuccessFinalizationDescriptorRole;
  descriptor: number; }

export function performSuccessFinalizationCeremony(request: { paths: SuccessFinalizationPaths;
  /** @internal Contained tests map fixed authority paths to private temp paths. */
  authorityPaths?: SuccessFinalizationPaths;
  lock: DeployLockAuthority;
  artifacts: SuccessFinalizationArtifacts;
  beginMarkerFinalization(): DurableFileIdentity;
  verifyPreFinalization(): void;
  verifyClosedLocalAuthority(): void;
  crash?: ( point: SuccessFinalizationCrashPoint, openDescriptors: readonly SuccessFinalizationOpenDescriptor[], ) => void;
  fsyncDirectory?: ( path: string, openDescriptors: readonly SuccessFinalizationOpenDescriptor[], ) => void; }): { receiptPath: string;
  receiptSHA256: string;
  witnessPath: string;
  witnessSHA256: string; } { const { paths, artifacts } = request;
  const openDescriptors = new Map<SuccessFinalizationDescriptorRole, number>([ ["lock", request.lock.descriptor], ]);
  const descriptorSnapshot = (): readonly SuccessFinalizationOpenDescriptor[] => Object.freeze( [...openDescriptors].map(([role, descriptor]) => Object.freeze({ role, descriptor }) ), );
  const crash = (point: SuccessFinalizationCrashPoint): void => request.crash?.(point, descriptorSnapshot());
  const fsyncDirectory = (path: string): void => { if (request.fsyncDirectory === undefined) fsyncPath(path); else request.fsyncDirectory(path, descriptorSnapshot()); };
  maintenanceContract().validateSuccessArtifactBundle(artifacts);
  const witness = record(artifacts.witness, "success_finalization_bundle");
  const receipt = record(artifacts.receipt, "success_finalization_bundle");
  const authority = record( artifacts.authorityProjection, "success_finalization_bundle", );
  const runID = authority.controller_run_id;
  const authorityPaths = request.authorityPaths ?? paths;
  const lockDirectory = requirePrivateDirectory(paths.lockDirectory);
  const receiptDirectory = requirePrivateDirectory(paths.receiptDirectory);
  const stateDirectory = requirePrivateDirectory(paths.stateDirectory);
  const controlPaths = [ paths.markerPath, paths.markerRetirementClaimPath, paths.receiptPath, paths.receiptStagePath, paths.witnessPath, paths.witnessStagePath, paths.publicLockPath, request.lock.ownerPath, ];
  requireCondition( realpathSync(paths.worktree) === paths.worktree && validRunID(runID) && new Set(controlPaths).size === controlPaths.length && !sameFileIdentity(stateDirectory, lockDirectory) &&
      !sameFileIdentity(stateDirectory, receiptDirectory) && !sameFileIdentity(lockDirectory, receiptDirectory) && authorityPaths.stateDirectory === DEPLOY_STATE_DIR && authorityPaths.lockDirectory === STATE_DIR &&
      authorityPaths.receiptDirectory === DEPLOY_RECEIPT_DIR && authorityPaths.worktree === REPOSITORY_ROOT && paths.markerPath === join( paths.stateDirectory, basename(authorityPaths.markerPath), ) &&
      paths.markerRetirementClaimPath === join( paths.stateDirectory, basename(authorityPaths.markerRetirementClaimPath), ) && paths.receiptPath === join( paths.receiptDirectory, basename(authorityPaths.receiptPath), ) &&
      paths.receiptStagePath === join( paths.receiptDirectory, basename(authorityPaths.receiptStagePath), ) && paths.witnessPath === join( paths.stateDirectory, basename(authorityPaths.witnessPath), ) && paths.witnessStagePath === join(
          paths.stateDirectory, basename(authorityPaths.witnessStagePath), ) && paths.publicLockPath === join( paths.lockDirectory, basename(authorityPaths.publicLockPath), ) && request.lock.ownerPath === join( paths.lockDirectory,
          basename(witness.lock_owner_path), ) && dirname(paths.markerPath) === paths.stateDirectory && dirname(paths.markerRetirementClaimPath) === paths.stateDirectory && dirname(paths.witnessPath) === paths.stateDirectory &&
      dirname(paths.witnessStagePath) === paths.stateDirectory && dirname(paths.receiptPath) === paths.receiptDirectory && dirname(paths.receiptStagePath) === paths.receiptDirectory &&
      dirname(paths.publicLockPath) === paths.lockDirectory && paths.receiptStagePath === join( paths.receiptDirectory, `.phase-b-refence-maintenance-receipt-${runID}.stage`, ) && paths.witnessStagePath === join( paths.stateDirectory,
          `.phase-b-refence-maintenance-finalization-${runID}.stage`, ) && authorityPaths.markerPath === witness.marker_path && authorityPaths.markerPath === receipt.marker_path && authorityPaths.markerRetirementClaimPath ===
        witness.marker_retirement_claim_path && authorityPaths.receiptPath === witness.receipt_path && authorityPaths.witnessPath === receipt.witness_path && authorityPaths.publicLockPath === witness.lock_public_path &&
      authorityPaths.markerPath === MAINTENANCE_MARKER && String(request.lock.identity.device) === witness.lock_device && String(request.lock.identity.inode) === witness.lock_inode && request.lock.identity.sha256 === witness.lock_sha256 &&
      validSha(artifacts.markerSHA256) && validSha(artifacts.receiptSHA256) && validSha(artifacts.witnessSHA256) && sha256(artifacts.markerBytesUTF8) === artifacts.markerSHA256 &&
      sha256(artifacts.receiptBytesUTF8) === artifacts.receiptSHA256 && sha256(artifacts.witnessBytesUTF8) === artifacts.witnessSHA256 && [ paths.markerRetirementClaimPath, paths.receiptPath, paths.receiptStagePath, paths.witnessPath,
        paths.witnessStagePath, ].every((path) => absent(path)), "success_finalization_admission", );
  const lockPaths: DeployLockPaths = { directory: paths.lockDirectory, publicPath: paths.publicLockPath, worktree: paths.worktree, };
  const authorityLockPaths: DeployLockPaths = { directory: authorityPaths.lockDirectory, publicPath: authorityPaths.publicLockPath, worktree: authorityPaths.worktree, };
  verifyDeployLockAuthority( request.lock, lockPaths, authorityLockPaths, witness.lock_owner_path, );
  request.verifyPreFinalization();

  const markerIdentity = request.beginMarkerFinalization();
  requireCondition( markerIdentity.sha256 === artifacts.markerSHA256 && (markerIdentity.device !== request.lock.identity.device || markerIdentity.inode !== request.lock.identity.inode), "success_finalization_a0", );
  requireExactFileIdentity(paths.markerPath, markerIdentity, { links: [1] });
  verifyDeployLockAuthority( request.lock, lockPaths, authorityLockPaths, witness.lock_owner_path, );
  const markerDescriptor = openExactFileIdentity( paths.markerPath, markerIdentity, );
  openDescriptors.set("marker", markerDescriptor);
  let receiptIdentity!: DurableFileIdentity;
  let witnessIdentity!: DurableFileIdentity;
  try { requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [1], );
    crash("A0");
    requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [1], );
    verifyDeployLockAuthority( request.lock, lockPaths, authorityLockPaths, witness.lock_owner_path, );

  const receiptStage = createExclusiveFsyncedStageFile( paths.receiptStagePath, artifacts.receiptBytesUTF8, );
  receiptIdentity = receiptStage.identity;
  const receiptDescriptor = receiptStage.descriptor;
  openDescriptors.set("receipt", receiptDescriptor);
  try { requireCondition( receiptIdentity.sha256 === artifacts.receiptSHA256 && (receiptIdentity.device !== markerIdentity.device || receiptIdentity.inode !== markerIdentity.inode) && (receiptIdentity.device !== request.lock.identity.device ||
        receiptIdentity.inode !== request.lock.identity.inode), "success_finalization_receipt", );
    requirePathAndOpenFileIdentity( paths.receiptStagePath, receiptDescriptor, receiptIdentity, [1], );
    crash("R1");
    requirePathAndOpenFileIdentity( paths.receiptStagePath, receiptDescriptor, receiptIdentity, [1], );
    linkSync(paths.receiptStagePath, paths.receiptPath);
    requireOpenFileIdentity(receiptDescriptor, receiptIdentity, [2]);
    requireExactFileIdentity(paths.receiptStagePath, receiptIdentity, { links: [2], });
    requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [2], });
    crash("R2_linked_before_directory_fsync");
    requirePathAndOpenFileIdentity( paths.receiptStagePath, receiptDescriptor, receiptIdentity, [2], );
    requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [2], });
    fsyncDirectory(paths.receiptDirectory);
    requirePathAndOpenFileIdentity( paths.receiptStagePath, receiptDescriptor, receiptIdentity, [2], );
    requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [2], });
    crash("R3");
    requirePathAndOpenFileIdentity( paths.receiptStagePath, receiptDescriptor, receiptIdentity, [2], );
    requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [2], });
    unlinkSync(paths.receiptStagePath);
    requireOpenFileIdentity(receiptDescriptor, receiptIdentity, [1]);
    requireCondition( absent(paths.receiptStagePath), "success_finalization_receipt", );
    requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [1], });
    crash("R4_unlinked_before_directory_fsync");
    requirePathAndOpenFileIdentity( paths.receiptPath, receiptDescriptor, receiptIdentity, [1], );
    requireCondition( absent(paths.receiptStagePath), "success_finalization_receipt", );
    fsyncDirectory(paths.receiptDirectory);
    requireCondition( absent(paths.receiptStagePath), "success_finalization_receipt", );
    requirePathAndOpenFileIdentity( paths.receiptPath, receiptDescriptor, receiptIdentity, [1], );
    parsePrivateJson(paths.receiptPath, { pretty: true });
    crash("R5"); } finally { openDescriptors.delete("receipt");
    closeSync(receiptDescriptor); }

  const witnessStage = createExclusiveFsyncedStageFile( paths.witnessStagePath, artifacts.witnessBytesUTF8, );
  witnessIdentity = witnessStage.identity;
  const witnessDescriptor = witnessStage.descriptor;
  openDescriptors.set("witness", witnessDescriptor);
  try { requireCondition( witnessIdentity.sha256 === artifacts.witnessSHA256 && (witnessIdentity.device !== markerIdentity.device || witnessIdentity.inode !== markerIdentity.inode) && (witnessIdentity.device !== receiptIdentity.device ||
        witnessIdentity.inode !== receiptIdentity.inode) && (witnessIdentity.device !== request.lock.identity.device || witnessIdentity.inode !== request.lock.identity.inode), "success_finalization_witness", );
  requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [1], );
  crash("W1");
  requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [1], );

  verifyDeployLockAuthority( request.lock, lockPaths, authorityLockPaths, witness.lock_owner_path, );
  requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [1], );
    linkSync(paths.markerPath, paths.markerRetirementClaimPath);
    requireOpenFileIdentity(markerDescriptor, markerIdentity, [2]);
    requireExactFileIdentity(paths.markerPath, markerIdentity, { links: [2] });
    requireExactFileIdentity(paths.markerRetirementClaimPath, markerIdentity, { links: [2], });
    crash("M1_linked_before_directory_fsync");
    requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [2], );
    requireExactFileIdentity(paths.markerRetirementClaimPath, markerIdentity, { links: [2], });
    fsyncDirectory(paths.stateDirectory);
    requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [2], );
    requireExactFileIdentity(paths.markerRetirementClaimPath, markerIdentity, { links: [2], });
    crash("M1");
    requirePathAndOpenFileIdentity( paths.markerPath, markerDescriptor, markerIdentity, [2], );
    requireExactFileIdentity(paths.markerRetirementClaimPath, markerIdentity, { links: [2], });
    unlinkSync(paths.markerPath);
    requireOpenFileIdentity(markerDescriptor, markerIdentity, [1]);
    requireCondition(absent(paths.markerPath), "success_finalization_marker");
    requireExactFileIdentity(paths.markerRetirementClaimPath, markerIdentity, { links: [1], });
    crash("M2_unlinked_before_directory_fsync");
    requirePathAndOpenFileIdentity( paths.markerRetirementClaimPath, markerDescriptor, markerIdentity, [1], );
    requireCondition(absent(paths.markerPath), "success_finalization_marker");
    fsyncDirectory(paths.stateDirectory);
    requireCondition(absent(paths.markerPath), "success_finalization_marker");
    requirePathAndOpenFileIdentity( paths.markerRetirementClaimPath, markerDescriptor, markerIdentity, [1], );
    crash("M2");

    requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [1], );
      linkSync(paths.witnessStagePath, paths.witnessPath);
      requireOpenFileIdentity(witnessDescriptor, witnessIdentity, [2]);
      requireExactFileIdentity(paths.witnessStagePath, witnessIdentity, { links: [2], });
      requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [2], });
      crash("W2_linked_before_directory_fsync");
      requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [2], );
      requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [2], });
      fsyncDirectory(paths.stateDirectory);
      requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [2], );
      requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [2], });
      crash("W2");
      requirePathAndOpenFileIdentity( paths.witnessStagePath, witnessDescriptor, witnessIdentity, [2], );
      requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [2], });
      unlinkSync(paths.witnessStagePath);
      requireOpenFileIdentity(witnessDescriptor, witnessIdentity, [1]);
      requireCondition( absent(paths.witnessStagePath), "success_finalization_witness", );
      requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [1], });
      crash("W3_unlinked_before_directory_fsync");
      requirePathAndOpenFileIdentity( paths.witnessPath, witnessDescriptor, witnessIdentity, [1], );
      requireCondition( absent(paths.witnessStagePath), "success_finalization_witness", );
      fsyncDirectory(paths.stateDirectory);
      requireCondition( absent(paths.witnessStagePath), "success_finalization_witness", );
      requirePathAndOpenFileIdentity( paths.witnessPath, witnessDescriptor, witnessIdentity, [1], );
      parsePrivateJson(paths.witnessPath);
      crash("W3");

    requirePathAndOpenFileIdentity( paths.markerRetirementClaimPath, markerDescriptor, markerIdentity, [1], );
    unlinkSync(paths.markerRetirementClaimPath);
    requireOpenFileIdentity(markerDescriptor, markerIdentity, [0]);
    requireCondition( absent(paths.markerPath) && absent(paths.markerRetirementClaimPath), "success_finalization_marker", );
    crash("M3_unlinked_before_directory_fsync");
    requireOpenFileIdentity(markerDescriptor, markerIdentity, [0]);
    requireCondition( absent(paths.markerPath) && absent(paths.markerRetirementClaimPath), "success_finalization_marker", );
    fsyncDirectory(paths.stateDirectory);
    requireOpenFileIdentity(markerDescriptor, markerIdentity, [0]);
    requireCondition( absent(paths.markerPath) && absent(paths.markerRetirementClaimPath), "success_finalization_marker", );
    crash("M3"); } finally { openDescriptors.delete("witness");
    closeSync(witnessDescriptor); } } finally { openDescriptors.delete("marker");
    closeSync(markerDescriptor); }

  requireExactFileIdentity(paths.receiptPath, receiptIdentity, { links: [1] });
  requireExactFileIdentity(paths.witnessPath, witnessIdentity, { links: [1] });
  requireCondition( absent(paths.receiptStagePath) && absent(paths.witnessStagePath) && absent(paths.markerPath) && absent(paths.markerRetirementClaimPath), "success_finalization_reproof", );
  request.verifyClosedLocalAuthority();
  verifyDeployLockAuthority( request.lock, lockPaths, authorityLockPaths, witness.lock_owner_path, );
  releaseDeployLockPublicForController( request.lock, lockPaths, () => crash("L1_unlinked_before_directory_fsync"), fsyncDirectory, authorityLockPaths, witness.lock_owner_path, );
  crash("L1");
  releaseDeployLockOwnerForController( request.lock, lockPaths, () => crash("L2_unlinked_before_directory_fsync"), fsyncDirectory, );
  openDescriptors.delete("lock");
  crash("L2");
  return { receiptPath: paths.receiptPath, receiptSHA256: artifacts.receiptSHA256, witnessPath: paths.witnessPath, witnessSHA256: artifacts.witnessSHA256, }; }

function requirePrivateDirectory(path: string): Stats { const info = lstatSync(path);
  requireCondition( info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && info.gid === process.getgid?.() && (info.mode & 0o777) === 0o700 && realpathSync(path) === path, "private_directory_contract", );
  return info; }

function requirePinnedUserExecutable( path: string, digest: string, code: string, expectedSize?: number, ): void { const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === OPERATOR_UID && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === 0o755 && realpathSync(path) === path &&
      (expectedSize === undefined || before.size === expectedSize), code, );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( sameFileIdentity(opened, before) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && opened.size === bytes.byteLength && after.size === opened.size && rebound.size === opened.size &&
        sha256(bytes) === digest, code, ); } finally { closeSync(descriptor); } }

function requirePinnedBunController(): void { const directories: ReadonlyArray<[string, number, number, number]> = [ ["/Users", 0, 80, 0o755], [HOME, OPERATOR_UID, 20, 0o700], [join(HOME, ".cache"), OPERATOR_UID, 20, 0o755],
    [join(HOME, ".cache/pinned-runtimes"), OPERATOR_UID, 20, 0o755], [join(HOME, ".cache/pinned-runtimes/bun-v1.3.5"), OPERATOR_UID, 20, 0o755], [dirname(PINNED_BUN), OPERATOR_UID, 20, 0o755], ];
  for (const [path, uid, gid, mode] of directories) { const info = lstatSync(path);
    requireCondition( info.isDirectory() && !info.isSymbolicLink() && info.uid === uid && info.gid === gid && (info.mode & 0o777) === mode && realpathSync(path) === path, "bun_contract", ); }
  requirePinnedUserExecutable( PINNED_BUN, PINNED_BUN_SHA256, "bun_contract", PINNED_BUN_BYTE_COUNT, ); }

function requirePinnedSystemExecutable( path: string, digest: string, expectedNlink: number, ): void { const info = lstatSync(path);
  requireCondition( info.isFile() && !info.isSymbolicLink() && info.uid === 0 && info.gid === 0 && info.nlink === expectedNlink && (info.mode & 0o777) === 0o755 && realpathSync(path) === path && sha256(readFileSync(path)) === digest,
    "system_dependency_contract", ); }

function requireFlyAuthenticationConfig(): void { requirePrivateDirectory(FLY_CONFIG_DIRECTORY);
  const file = readStablePrivateFile(FLY_CONFIG, { maximumBytes: 64_000 });
  const text = decode(file.bytes, "fly_config_contract");
  requireCondition( realpathSync(FLY_CONFIG) === FLY_CONFIG, "fly_config_contract", );
  validateFlyAuthenticationConfigText(text); }

/** @internal Pure accepted-shape parser; it never returns or emits a token. */
export function validateFlyAuthenticationConfigText(text: string): void { maintenanceContract().validateFlyAuthenticationConfigText(text); }

function readStablePrivateFile( path: string, options: { maximumBytes?: number; links?: readonly number[] } = {}, ): { bytes: Uint8Array; stat: Stats } { const maximumBytes = options.maximumBytes ?? MAX_PRIVATE_BYTES;
  const links = options.links ?? [1];
  const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && links.includes(before.nlink) && (before.mode & 0o777) === 0o600 &&
      before.size > 0 && before.size <= maximumBytes, "private_file_contract", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    requireCondition( opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.nlink === before.nlink, "private_file_changed", );
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( bytes.byteLength === opened.size && after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size && after.nlink === opened.nlink && rebound.dev === opened.dev &&
        rebound.ino === opened.ino && rebound.size === opened.size && rebound.nlink === opened.nlink, "private_file_changed", );
    return { bytes, stat: rebound }; } finally { closeSync(descriptor); } }

interface SourceMigration { filename: string;
  checksum: string; }

function validMigrationFilename(filename: string): boolean { return /^(?:[0-9]{4}|[0-9]{8}T[0-9]{6})_[a-z0-9_]+\.sql$/.test(filename); }

function sourceMigrationInventory(): SourceMigration[] { const directory = lstatSync(MIGRATIONS_DIR);
  requireCondition( directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid?.() && directory.gid === process.getgid?.() && (directory.mode & 0o777) === 0o755 &&
      realpathSync(MIGRATIONS_DIR) === MIGRATIONS_DIR, "migration_source_inventory", );
  const names = readdirSync(MIGRATIONS_DIR) .filter((name) => name.endsWith(".sql")) .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)) );
  requireCondition( names.length === EXPECTED_JOURNAL_FILE_COUNT && names.every(validMigrationFilename), "migration_source_inventory", );
  const inventory = names.map((filename): SourceMigration => { const path = join(MIGRATIONS_DIR, filename);
    requireCondition(realpathSync(path) === path, "migration_source_inventory");
    const before = lstatSync(path);
    requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === 0o644 &&
        before.size > 0 && before.size <= 5_000_000, "migration_source_inventory", );
    const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
    try { const opened = fstatSync(descriptor);
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      const rebound = lstatSync(path);
      requireCondition( opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.nlink === before.nlink && after.dev === opened.dev && after.ino === opened.ino &&
          after.size === opened.size && after.nlink === opened.nlink && rebound.dev === opened.dev && rebound.ino === opened.ino && rebound.size === opened.size && rebound.nlink === opened.nlink && bytes.byteLength === opened.size,
        "migration_source_inventory", );
      return { filename, checksum: sha256(bytes) }; } finally { closeSync(descriptor); } });
  requireCondition( canonicalJson(inventory.slice(-EXPECTED_MIGRATIONS.length)) === canonicalJson( EXPECTED_MIGRATIONS.map(([filename, checksum]) => ({ filename, checksum, })), ), "migration_source_inventory", );
  return inventory; }

function decode(bytes: Uint8Array, code: string): string { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return refuse(code); } }

function parsePrivateJson( path: string, options: { links?: readonly number[]; pretty?: boolean } = {}, ): { value: JsonRecord; bytes: Uint8Array; stat: Stats; digest: string } {
  const result = readStablePrivateFile(path, { links: options.links });
  const text = decode(result.bytes, "private_json_utf8");
  requireCondition(text.endsWith("\n"), "private_json_canonical");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return refuse("private_json_parse"); }
  const parsed = record(value, "private_json_shape");
  const expected = options.pretty === true ? `${JSON.stringify(parsed, null, 2)}\n` : `${canonicalJson(parsed)}\n`;
  requireCondition(text === expected, "private_json_canonical");
  return { ...result, value: parsed, digest: sha256(result.bytes) }; }

function deployReceiptInventory(): { count: number; sha256: string } { requirePrivateDirectory(DEPLOY_RECEIPT_DIR);
  const names = readdirSync(DEPLOY_RECEIPT_DIR).sort();
  requireCondition( names.length > 0 && names.length <= 128 && names.every((name) => /^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{12}-[1-9][0-9]*\.json$/.test(name) ), "deploy_receipt_inventory", );
  const projection = names.map((name) => { const path = join(DEPLOY_RECEIPT_DIR, name);
    const parsed = parsePrivateJson(path, { pretty: true });
    const info = parsed.stat;
    const metadata = { dev: info.dev, gid: info.gid, ino: info.ino, mode: info.mode, mtime_ms: info.mtimeMs, nlink: info.nlink, size: info.size, uid: info.uid, sha256: parsed.digest, };
    const value = parsed.value;
    requireCondition( typeof value.schema === "string" && value.schema.length <= 1_024 && validRevision(value.source_revision) && name.slice(17, 29) === value.source_revision.slice(0, 12), "deploy_receipt_inventory", );
    return { name, ...metadata }; });
  requireCondition( canonicalJson(readdirSync(DEPLOY_RECEIPT_DIR).sort()) === canonicalJson(names), "deploy_receipt_inventory", );
  return { count: names.length, sha256: sha256(canonicalJson(projection)) }; }

function reservedPhaseBControlName(name: string): boolean { const generic = name.startsWith("phase-b-") && name.endsWith(".json") && /(?:^|-)(?:receipt(?:-|\.)|active(?:-|\.))/.test(name);
  return name.startsWith(".phase-b-") || generic; }

function validateLocalControlInventory( runID: string, edge: HandoffEdge, archiveAnchor: string, archiveWitness: string, capsulePath: string, ): void { requireCondition( absent(RECOVERY_CLAIM) && absent(capsulePath),
    "local_control_inventory", );
  const stateNames = readdirSync(STATE_DIR).sort();
  const deployNames = readdirSync(DEPLOY_STATE_DIR).sort();
  requireCondition( stateNames.length <= 512 && deployNames.length <= 512, "local_control_inventory", );
  const allowedState = new Set([basename(REFENCE_RECEIPT)]);
  const allowedDeploy = new Set([ basename(MAINTENANCE_MARKER), ...(edge === "H5" ? [] : [basename(ARMED_WITNESS)]), ...(edge === "H0" || edge === "H1" ? [] : [basename(archiveAnchor)]), ...(edge === "H0" || edge === "H1" || edge === "H2"
      ? [] : [basename(archiveWitness)]), ...(edge === "H1" || edge === "H2" || edge === "H3" ? [basename(handoffStagePath(runID))] : []), ]);
  for (const name of stateNames) { if (!reservedPhaseBControlName(name)) continue;
    requireCondition(allowedState.has(name), "local_control_inventory"); }
  for (const name of deployNames) { if ( !reservedPhaseBControlName(name) && !/^phase-b-refence-observed-526-(?:anchor|armed-witness)-retired-/.test( name, ) ) continue;
    requireCondition(allowedDeploy.has(name), "local_control_inventory"); } }

export function normalizedBridgeSource(text: string): string { const expression = /const BRIDGE_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";/;
  const matches = text.match(new RegExp(expression.source, "g"));
  requireCondition(matches?.length === 1, "bridge_normalization_contract");
  return text.replace( expression, 'const BRIDGE_NORMALIZED_SHA256 = "__BRIDGE_SELF_NORMALIZED_SHA256__";', ); }

export function bridgeSourceHashes(path = BRIDGE_SOURCE): { raw: string;
  normalized: string; } { requireCondition( path === BRIDGE_SOURCE && realpathSync(path) === BRIDGE_SOURCE, "bridge_source_path", );
  const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === 0o644 && before.size > 0 &&
      before.size <= MAX_PRIVATE_BYTES, "bridge_source_contract", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  let bytes: Uint8Array;
  try { const opened = fstatSync(descriptor);
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.nlink === before.nlink && after.dev === opened.dev && after.ino === opened.ino &&
        after.size === opened.size && after.nlink === opened.nlink && rebound.dev === opened.dev && rebound.ino === opened.ino && rebound.size === opened.size && rebound.nlink === opened.nlink && bytes.byteLength === opened.size,
      "bridge_source_changed", ); } finally { closeSync(descriptor); }
  const text = decode(bytes, "bridge_source_utf8");
  const hashes = { raw: sha256(bytes), normalized: sha256(normalizedBridgeSource(text)), };
  requireCondition( validSha(BRIDGE_NORMALIZED_SHA256) && hashes.normalized === BRIDGE_NORMALIZED_SHA256, "bridge_source_binding", );
  return hashes; }

export interface RoleMap { app_lhr: [string, string];
  app_cdg: string;
  thinker_primary: string;
  thinker_standby: string; }

function validateRoles(value: unknown): RoleMap { exactKeys( value, ["app_lhr", "app_cdg", "thinker_primary", "thinker_standby"], "role_map", );
  const roles = value as RoleMap;
  requireCondition( Array.isArray(roles.app_lhr) && roles.app_lhr.length === 2 && roles.app_lhr.every(validMachineID) && roles.app_lhr[0] < roles.app_lhr[1] && validMachineID(roles.app_cdg) && validMachineID(roles.thinker_primary) &&
      validMachineID(roles.thinker_standby) && new Set(machineIDs(roles)).size === 5, "role_map", );
  requireCondition( machineSetSHA256(roles) === EXPECTED_MACHINE_SET_SHA256, "role_map", );
  return roles; }

function machineIDs(roles: RoleMap): string[] { return [ ...roles.app_lhr, roles.app_cdg, roles.thinker_primary, roles.thinker_standby, ]; }

function appIDs(roles: RoleMap): string[] { return [...roles.app_lhr, roles.app_cdg]; }

function machineSetSHA256(roles: RoleMap): string { return sha256(`${machineIDs(roles).sort().join("\n")}\n`); }

function roleMapSHA256(roles: RoleMap): string { return sha256(canonicalJson(roles)); }

interface WalInventoryEntry { ordinal: number;
  filename: string;
  sha256: string;
  prior_entry_sha256: string | null;
  checkpoint: string;
  status: string;
  mutation_armed: boolean; }

export interface TerminalEvidence { receipt: JsonRecord;
  receiptSHA256: string;
  runID: string;
  roles: RoleMap;
  sourceRevision: string;
  sourceTree: string;
  targetRevision: string;
  targetTree: string;
  targetDistance: number;
  anchor: JsonRecord;
  anchorSHA256: string;
  anchorPath: string;
  anchorArchivePath: string;
  anchorStat: Stats;
  witness: JsonRecord;
  witnessSHA256: string;
  witnessPath: string;
  witnessArchivePath: string;
  witnessStat: Stats;
  walDirectory: string;
  walInventorySHA256: string;
  terminalWalSHA256: string;
  imageContract: JsonRecord;
  sourceInventorySHA256: string;
  journalInventorySHA256: string;
  cronSHA256: string;
  restoredConfigSHA256ByMachine: Record<string, string>;
  fencedConfigSHA256ByMachine: Record<string, string>;
  deployReceiptInventorySHA256: string;
  deployReceiptFileCount: number;
  producerAdmission: { embeddedCriticalContractSHA256: string;
    localStateSandwichSHA256: string; };
  producerTerminalProof: { journalSHA256: string;
    drainSampleSHA256: string;
    drainEventSHA256s: [string, string, string]; };
  bridgeRawSHA256: string;
  bridgeNormalizedSHA256: string;
  edge: HandoffEdge; }

export const RECEIPT_KEYS = [ "schema", "run_id", "status", "source_revision", "source_tree", "operator_path", "operator_sha256", "operator_normalized_sha256", "operator_harness_sha256", "operator_normalization_contract",
  "readmission_target", "prior_audited_lineage", "audit_evidence", "started_at", "completed_at", "machine_set_sha256", "roles_sha256", "image_contract_sha256", "restored_config_map_sha256", "fenced_config_map_sha256",
  "wal_sha256_before_receipt", "terminal_wal_entry_filename", "terminal_wal_entry_sha256", "terminal_wal_ordinal", "terminal_checkpoint", "terminal_proof_recorded_wal_ordinal", "terminal_proof_recorded_wal_sha256", "wal_inventory",
  "maintenance_anchor_sha256", "maintenance_anchor_schema", "maintenance_anchor_run_id", "maintenance_anchor_handoff", "armed_witness", "terminal_fleet_sha256", "terminal_proof", "terminal_sample_count", "terminal_drain_sample_count",
  "terminal_interval_ms", "receipt_status_truthful", "maintenance_marker_retained", "armed_witness_retained", "recovery_capsule_retired", "recovery_capsule", "readmission_guard_raw_sha256", "readmission_guard_normalized_sha256",
  "deploy_or_start_attempt_count", "migration_attempt_count", "database_write_attempt_count", "secret_mutation_attempt_count", "uncordon_attempt_count", "rollback_attempt_count", "provider_generation_absence_revalidated_after_fence",
  "keychain_generation_absence_observed_before_mutation", "keychain_generation_absence_revalidated_after_fence", "keychain_generation_absence_after_fence", "journal_verified_after_fence", "authority_verified_after_fence",
  "drain_verified_after_fence", "application_actor", "application_path", "application_time_quiescence_proven", "historical_lineage_bound", "caveats", ] as const;

export function validateRefenceReceiptWalAuthorityForTest(request: { receipt: JsonRecord;
  walRecords: readonly { value: JsonRecord;
    sha256: string;
    filename: string; }[];
  anchor: { value: JsonRecord; sha256: string };
  witness: { value: JsonRecord; sha256: string }; }): JsonRecord { return maintenanceContract().validateProducerAuthorityProjection(request); }

function validateWalInventory( receipt: JsonRecord, expectedRunID: string, ): { roles: RoleMap;
  directory: string;
  inventorySHA256: string;
  terminalSHA256: string;
  imageContract: JsonRecord;
  sourceInventorySHA256: string;
  journalInventorySHA256: string;
  cronSHA256: string;
  restoredConfigSHA256ByMachine: Record<string, string>;
  fencedConfigSHA256ByMachine: Record<string, string>;
  deployReceiptInventorySHA256: string;
  deployReceiptFileCount: number;
  embeddedCriticalContractSHA256: string;
  localStateSandwichSHA256: string;
  terminalJournalSHA256: string;
  terminalDrainSampleSHA256: string;
  terminalDrainEventSHA256s: [string, string, string];
  records: readonly { value: JsonRecord;
    sha256: string;
    filename: string; }[]; } { const inventory = record(receipt.wal_inventory, "wal_inventory");
  exactKeys( inventory, [ "directory", "entry_count", "ordered_filenames", "entries", "first_entry_sha256", "terminal_entry_sha256", "chain_projection_sha256", "filename_set_sha256", ], "wal_inventory", );
  requireCondition( typeof inventory.directory === "string" && dirname(inventory.directory) === WAL_ROOT && basename(inventory.directory) === expectedRunID && Number.isSafeInteger(inventory.entry_count) && inventory.entry_count > 0 &&
      inventory.entry_count <= MAX_WAL_ENTRIES && Array.isArray(inventory.ordered_filenames) && inventory.ordered_filenames.length === inventory.entry_count && Array.isArray(inventory.entries) &&
      inventory.entries.length === inventory.entry_count && validSha(inventory.first_entry_sha256) && validSha(inventory.terminal_entry_sha256) && validSha(inventory.chain_projection_sha256) && validSha(inventory.filename_set_sha256),
    "wal_inventory", );
  requirePrivateDirectory(WAL_ROOT);
  requirePrivateDirectory(inventory.directory);
  requireCondition( canonicalJson(readdirSync(WAL_ROOT).sort()) === canonicalJson([expectedRunID]), "wal_root_inventory", );
  const actualNames = readdirSync(inventory.directory).sort();
  requireCondition( canonicalJson(actualNames) === canonicalJson(inventory.ordered_filenames), "wal_inventory", );
  let previous: string | null = null;
  let terminal: JsonRecord | null = null;
  const projection: WalInventoryEntry[] = [];
  const walRecords: Array<{ value: JsonRecord;
    sha256: string;
    filename: string; }> = [];
  for (let index = 0; index < inventory.entries.length; index += 1) { const expected = record(inventory.entries[index], "wal_inventory_entry");
    exactKeys( expected, [ "ordinal", "filename", "sha256", "prior_entry_sha256", "checkpoint", "status", "mutation_armed", ], "wal_inventory_entry", );
    const ordinal = index + 1;
    requireCondition( expected.ordinal === ordinal && validSha(expected.sha256) && expected.prior_entry_sha256 === previous && typeof expected.checkpoint === "string" && /^[a-z0-9_]{1,128}$/.test(expected.checkpoint) && [ "active",
          "failed_or_uncertain", "fenced_awaiting_protected_main_readmission", ] .includes(expected.status) && typeof expected.mutation_armed === "boolean" && expected.filename ===
          `${String(ordinal).padStart(6, "0")}-${expected.sha256}.json` && inventory.ordered_filenames[index] === expected.filename, "wal_inventory_entry", );
    const wal = parsePrivateJson(join(inventory.directory, expected.filename));
    requireCondition(wal.digest === expected.sha256, "wal_inventory_entry");
    const value = wal.value;
    exactKeys( value, [ "schema", "ordinal", "prior_entry_sha256", "run_id", "command", "status", "checkpoint", "source_revision", "source_tree", "operator_path", "operator_sha256", "operator_normalized_sha256", "readmission_target",
        "readmission_guard", "prior_audited_lineage", "started_at", "updated_at", "mutation_armed", "lock", "audit_evidence", "recovery_capsule", "context", "admission", "progress", "events", "terminal_proof", "failure", "caveats", ],
      "wal_entry", );
    requireCondition( value.schema === "agenttool-phase-b-refence-observed-526-wal/v1" && value.ordinal === ordinal && value.prior_entry_sha256 === previous && value.run_id === expectedRunID && value.command === "refence-observed-526" &&
        value.status === expected.status && value.checkpoint === expected.checkpoint && value.source_revision === EXPECTED_SOURCE_REVISION && value.source_tree === EXPECTED_SOURCE_TREE && value.operator_path === REFENCE_OPERATOR &&
        value.operator_sha256 === receipt.operator_sha256 && value.operator_normalized_sha256 === REFENCE_OPERATOR_SEMANTIC_SHA256 && canonicalJson(value.readmission_target) === canonicalJson(receipt.readmission_target) &&
        canonicalJson(value.audit_evidence) === canonicalJson(receipt.audit_evidence) && value.mutation_armed === expected.mutation_armed, "wal_entry", );
    exactKeys( value.readmission_guard, ["path", "schema", "raw_sha256", "normalized_sha256"], "wal_readmission_guard", );
    requireCondition( value.readmission_guard.path === BRIDGE_SOURCE && value.readmission_guard.schema === MAINTENANCE_REFENCE_BRIDGE_SCHEMA && value.readmission_guard.raw_sha256 === receipt.readmission_guard_raw_sha256 &&
        value.readmission_guard.normalized_sha256 === receipt.readmission_guard_normalized_sha256, "wal_readmission_guard", );
    projection.push(expected as WalInventoryEntry);
    walRecords.push({ value, sha256: expected.sha256, filename: expected.filename, });
    previous = expected.sha256;
    terminal = value; }
  requireCondition( terminal !== null && previous === inventory.terminal_entry_sha256 && inventory.first_entry_sha256 === projection[0]?.sha256 && sha256(canonicalJson(projection)) === inventory.chain_projection_sha256 &&
      sha256(canonicalJson(actualNames)) === inventory.filename_set_sha256 && terminal.status === "fenced_awaiting_protected_main_readmission" && terminal.checkpoint === "fenced_awaiting_protected_main_readmission" &&
      terminal.recovery_capsule?.retired === true && terminal.terminal_proof !== null, "wal_terminal", );
  const context = record(terminal.context, "wal_terminal_context");
  exactKeys( context, [ "machine_map_sha256", "machine_set_sha256", "roles", "image", "restored_config_sha256_by_machine", "fenced_config_sha256_by_machine", "source_inventory_sha256", "journal_inventory_sha256", "cron_sha256", ],
    "wal_terminal_context", );
  const roles = validateRoles(context.roles);
  const image = record(context.image, "wal_terminal_image");
  exactKeys( image, ["configImage", "digest", "fullImageRefSha256", "revision", "tag"], "wal_terminal_image", );
  const restoredHashes = record( context.restored_config_sha256_by_machine, "wal_terminal_context", );
  const fencedHashes = record( context.fenced_config_sha256_by_machine, "wal_terminal_context", );
  requireCondition( context.machine_map_sha256 === MACHINE_MAP_SHA256 && context.machine_set_sha256 === EXPECTED_MACHINE_SET_SHA256 && image.revision === EXPECTED_SOURCE_REVISION && image.digest === EXPECTED_IMAGE_DIGEST &&
      image.tag === EXPECTED_IMAGE_TAG && image.configImage === `registry.fly.io/${APP}:${EXPECTED_IMAGE_TAG}@${EXPECTED_IMAGE_DIGEST}` && validSha(image.fullImageRefSha256) && validSha(context.source_inventory_sha256) &&
      validSha(context.journal_inventory_sha256) && context.cron_sha256 === EXPECTED_CRON_SHA256 && Object.keys(restoredHashes).length === 5 && Object.keys(fencedHashes).length === 5 && machineIDs(roles).every((id) =>
        validSha(restoredHashes[id]) && validSha(fencedHashes[id]) ) && receipt.image_contract_sha256 === sha256(canonicalJson(image)) && receipt.restored_config_map_sha256 === sha256(canonicalJson(restoredHashes)) &&
      receipt.fenced_config_map_sha256 === sha256(canonicalJson(fencedHashes)), "wal_terminal_context", );
  const admission = record(terminal.admission, "wal_terminal_admission");
  exactKeys( admission, [ "proof_started_at", "proof_completed_at", "journal_applied_file_count", "journal_endpoint_count", "journal_observation_count", "journal_endpoints_equal", "migration_applied_at", "definition_checks_verified",
      "data_invariants_verified", "remainder_affected_count", "authority_baseline_verified", "generation_absence_checks", "drain_sample_count", "full_audit_exact_hash_clear", "embedded_critical_contract_sha256",
      "local_state_sandwich_sha256", "deploy_receipt_inventory_sha256", "deploy_receipt_file_count", "application_time_quiescence_proven", "drain_continuous_quiescence_proven", ], "wal_terminal_admission", );
  requireCondition( admission.journal_applied_file_count === EXPECTED_JOURNAL_FILE_COUNT && admission.journal_endpoint_count === 2 && admission.journal_observation_count === 4 && admission.journal_endpoints_equal === true &&
      canonicalJson(admission.migration_applied_at) === canonicalJson(EXPECTED_MIGRATION_APPLIED_AT) && admission.definition_checks_verified === true && admission.data_invariants_verified === true &&
      admission.remainder_affected_count === 0 && admission.authority_baseline_verified === true && admission.generation_absence_checks === 4 && admission.drain_sample_count === 3 && admission.full_audit_exact_hash_clear === true &&
      validSha(admission.embedded_critical_contract_sha256) && validSha(admission.local_state_sandwich_sha256) && validSha(admission.deploy_receipt_inventory_sha256) && admission.deploy_receipt_file_count === 17 &&
      admission.application_time_quiescence_proven === false && admission.drain_continuous_quiescence_proven === false, "wal_terminal_admission", );
  const terminalProof = record(terminal.terminal_proof, "wal_terminal_proof");
  exactKeys( terminalProof, [ "recorded_at", "fleet_sha256", "fleet_sample_sha256", "drain_sample_sha256", "journal_sha256", "authority_sha256", "provider_absence_sha256", "maintenance_anchor_sha256", "armed_witness_sha256",
      "authorized_archive_path", "readmission_guard_raw_sha256", "readmission_guard_normalized_sha256", "capsule_retirement_pending", ], "wal_terminal_proof", );
  requireCondition( terminalProof.fleet_sha256 === receipt.terminal_fleet_sha256 && terminalProof.fleet_sample_sha256 === receipt.terminal_proof?.fleet_sample_sha256 && terminalProof.drain_sample_sha256 ===
        receipt.terminal_proof?.drain_sample_sha256 && terminalProof.journal_sha256 === receipt.terminal_proof?.journal_sha256 && terminalProof.authority_sha256 === receipt.terminal_proof?.authority_sha256 &&
      terminalProof.provider_absence_sha256 === receipt.terminal_proof?.provider_absence_sha256 && terminalProof.maintenance_anchor_sha256 === receipt.maintenance_anchor_sha256 &&
      terminalProof.armed_witness_sha256 === receipt.armed_witness?.sha256 && terminalProof.authorized_archive_path === receipt.maintenance_anchor_handoff?.archive_path && terminalProof.readmission_guard_raw_sha256 ===
        receipt.readmission_guard_raw_sha256 && terminalProof.readmission_guard_normalized_sha256 === receipt.readmission_guard_normalized_sha256 && terminalProof.capsule_retirement_pending === true, "wal_terminal_proof", );
  const capsule = record(terminal.recovery_capsule, "wal_terminal_capsule");
  exactKeys(capsule, ["path", "sha256", "retired"], "wal_terminal_capsule");
  requireCondition( typeof capsule.path === "string" && validSha(capsule.sha256) && capsule.retired === true, "capsule_retirement", );
  requireCondition(Array.isArray(terminal.events), "wal_terminal_proof");
  const terminalDrainEventSHA256s = terminal.events .filter((event: unknown) => isRecord(event) && event.kind === "proof" && event.action === "terminal_drain" ) .map((event: JsonRecord) => event.fleet_sha256);
  requireCondition( terminalDrainEventSHA256s.length === 3 && terminalDrainEventSHA256s.every(validSha), "wal_terminal_proof", );
  return { roles, directory: inventory.directory, inventorySHA256: sha256(canonicalJson(projection)), terminalSHA256: previous, imageContract: image, sourceInventorySHA256: context.source_inventory_sha256,
    journalInventorySHA256: context.journal_inventory_sha256, cronSHA256: context.cron_sha256, restoredConfigSHA256ByMachine: context.restored_config_sha256_by_machine, fencedConfigSHA256ByMachine: context.fenced_config_sha256_by_machine,
    deployReceiptInventorySHA256: admission.deploy_receipt_inventory_sha256, deployReceiptFileCount: admission.deploy_receipt_file_count, embeddedCriticalContractSHA256: admission.embedded_critical_contract_sha256,
    localStateSandwichSHA256: admission.local_state_sandwich_sha256, terminalJournalSHA256: terminalProof.journal_sha256, terminalDrainSampleSHA256: terminalProof.drain_sample_sha256,
    terminalDrainEventSHA256s: terminalDrainEventSHA256s as [ string, string, string, ], records: Object.freeze(walRecords), }; }

function archivePaths(receipt: JsonRecord, runID: string): { anchor: string;
  witness: string; } { const anchorHandoff = record( receipt.maintenance_anchor_handoff, "anchor_handoff", );
  const witness = record(receipt.armed_witness, "armed_witness_receipt");
  exactKeys( anchorHandoff, [ "source_path", "archive_path", "archive_required", "method", "archive_must_be_absent", "same_inode_and_hash_required", "directory_fsync_each_boundary", "silent_deletion_forbidden", "wrapper_window_open",
      "authorized_guard_path", "authorized_guard_schema", "authorized_consumer_marker_schema", "guard_raw_sha256", "guard_raw_claimed", "authorized_guard_normalized_sha256", "normalization_contract", ], "anchor_handoff", );
  exactKeys( witness, [ "path", "schema", "sha256", "run_id", "mutation_armed", "retained", "archive_path", "archive_required", "method", "archive_must_be_absent", "same_inode_and_hash_required", "directory_fsync_each_boundary",
      "silent_deletion_forbidden", "wrapper_window_open", ], "armed_witness_receipt", );
  const expectedAnchor = join( DEPLOY_STATE_DIR, `phase-b-refence-observed-526-anchor-retired-${runID}.json`, );
  const expectedWitness = join( DEPLOY_STATE_DIR, `phase-b-refence-observed-526-armed-witness-retired-${runID}.json`, );
  requireCondition( anchorHandoff.source_path === MAINTENANCE_MARKER && anchorHandoff.archive_path === expectedAnchor && anchorHandoff.archive_required === true && anchorHandoff.method === "exclusive_hardlink_then_unlink_canonical" &&
      anchorHandoff.archive_must_be_absent === true && anchorHandoff.same_inode_and_hash_required === true && anchorHandoff.directory_fsync_each_boundary === true && anchorHandoff.silent_deletion_forbidden === true &&
      anchorHandoff.wrapper_window_open === false && anchorHandoff.authorized_guard_path === BRIDGE_SOURCE && anchorHandoff.authorized_guard_schema === MAINTENANCE_REFENCE_BRIDGE_SCHEMA && anchorHandoff.authorized_consumer_marker_schema ===
        MAINTENANCE_MARKER_SCHEMA && anchorHandoff.guard_raw_sha256 === receipt.readmission_guard_raw_sha256 && anchorHandoff.guard_raw_claimed === true && anchorHandoff.authorized_guard_normalized_sha256 ===
        receipt.readmission_guard_normalized_sha256 && anchorHandoff.normalization_contract === "zero_only_bridge_self_normalized_sha256" && witness.path === ARMED_WITNESS && witness.archive_path === expectedWitness && witness.schema ===
        "agenttool-phase-b-refence-observed-526-armed-witness/v1" && witness.run_id === runID && validSha(witness.sha256) && witness.mutation_armed === true && witness.retained === true && witness.archive_required === true &&
      witness.method === "exclusive_hardlink_then_unlink_canonical" && witness.archive_must_be_absent === true && witness.same_inode_and_hash_required === true && witness.directory_fsync_each_boundary === true &&
      witness.silent_deletion_forbidden === true && witness.wrapper_window_open === false, "archive_binding", );
  return { anchor: expectedAnchor, witness: expectedWitness }; }

interface RefenceIngressTarget { runID: string;
  targetRevision: string;
  targetTree: string;
  targetDistance: number; }

function readRefenceIngressTarget( expectedReceiptSHA256: string, ): RefenceIngressTarget { requirePrivateDirectory(STATE_DIR);
  requirePrivateDirectory(DEPLOY_STATE_DIR);
  requireCondition( validSha(expectedReceiptSHA256) && absent(PHASE_B_GENERATION_ACTIVE_MARKER) && absent(RECOVERY_CLAIM), "refence_ingress_state", );
  const receipt = parsePrivateJson(REFENCE_RECEIPT);
  requireCondition( receipt.digest === expectedReceiptSHA256, "refence_ingress_receipt", );
  exactKeys(receipt.value, RECEIPT_KEYS, "refence_ingress_receipt");
  const runID = receipt.value.run_id;
  const target = record( receipt.value.readmission_target, "refence_ingress_target", );
  exactKeys( target, [ "protected_main_revision", "protected_main_tree", "clean_526_ancestor_distance", ], "refence_ingress_target", );
  requireCondition( receipt.value.schema === "agenttool-phase-b-refence-observed-526-receipt/v1" && receipt.value.status === "fenced_awaiting_protected_main_readmission" && validRunID(runID) &&
      validRevision(target.protected_main_revision) && validRevision(target.protected_main_tree) && Number.isSafeInteger(target.clean_526_ancestor_distance) && target.clean_526_ancestor_distance > 12, "refence_ingress_target", );
  const archives = archivePaths(receipt.value, runID);
  requireCondition( absent(archives.anchor) && absent(archives.witness) && absent(handoffStagePath(runID)), "refence_ingress_state", );
  const anchor = parsePrivateJson(MAINTENANCE_MARKER);
  const witness = parsePrivateJson(ARMED_WITNESS);
  const bridgeHashes = bridgeSourceHashes();
  validateAnchorAndWitness( receipt.value, anchor, witness, archives, runID, bridgeHashes, );
  validateHandoffLinks("H0", anchor, witness, archives);
  requireCondition( anchor.digest === receipt.value.maintenance_anchor_sha256 && witness.digest === receipt.value.armed_witness.sha256, "refence_ingress_state", );
  return { runID, targetRevision: target.protected_main_revision, targetTree: target.protected_main_tree, targetDistance: target.clean_526_ancestor_distance, }; }

/** @internal Exact producer H0 local-admission projection. */
export function producerLocalStateSandwichSHA256ForTest(request: { anchorSHA256: string;
  firstWalSHA256: string;
  firstWalOrdinal: number;
  deployReceiptInventorySHA256: string;
  deployReceiptFileCount: number; }): string { return maintenanceContract().producerLocalStateSandwichSHA256(request); }

/** @internal Exact H0 comparator; the claim never selects its own inputs. */
export function validateProducerLocalStateSandwichForTest( request: Parameters<typeof producerLocalStateSandwichSHA256ForTest>[0], claimedSHA256: string, ): string { return maintenanceContract().validateProducerLocalStateSandwich( request,
    claimedSHA256, ); }

function classifyHandoff( expectedReceiptSHA256: string, targetRevision: string, targetTree: string, rolloutID: string, ): TerminalEvidence { const receiptFile = parsePrivateJson(REFENCE_RECEIPT);
  requireCondition( receiptFile.digest === expectedReceiptSHA256, "receipt_hash", );
  exactKeys(receiptFile.value, RECEIPT_KEYS, "receipt_shape");
  const value = receiptFile.value;
  const runID = value.run_id;
  requireCondition( value.schema === "agenttool-phase-b-refence-observed-526-receipt/v1" && validRunID(runID) && value.status === "fenced_awaiting_protected_main_readmission" && value.source_revision === EXPECTED_SOURCE_REVISION &&
      value.source_tree === EXPECTED_SOURCE_TREE && value.operator_path === REFENCE_OPERATOR && validSha(value.operator_sha256) && value.operator_normalized_sha256 === REFENCE_OPERATOR_SEMANTIC_SHA256 &&
      validSha(value.operator_harness_sha256) && value.machine_set_sha256 === EXPECTED_MACHINE_SET_SHA256 && value.receipt_status_truthful === true && value.maintenance_marker_retained === true && value.armed_witness_retained === true &&
      value.recovery_capsule_retired === true && value.deploy_or_start_attempt_count === 0 && value.migration_attempt_count === 0 && value.database_write_attempt_count === 0 && value.secret_mutation_attempt_count === 0 &&
      value.uncordon_attempt_count === 0 && value.rollback_attempt_count === 0 && value.historical_lineage_bound === false && value.keychain_generation_absence_revalidated_after_fence === false &&
      value.keychain_generation_absence_after_fence === "unknown_not_requeried", "receipt_contract", );
  const target = record(value.readmission_target, "receipt_target");
  exactKeys( target, [ "protected_main_revision", "protected_main_tree", "clean_526_ancestor_distance", ], "receipt_target", );
  const prior = record(value.prior_audited_lineage, "receipt_prior_lineage");
  exactKeys( prior, [ "protected_main_revision", "protected_main_tree", "clean_526_ancestor_distance", "evidence_only", "readmission_authority", ], "receipt_prior_lineage", );
  requireCondition( validRevision(prior.protected_main_revision) && validRevision(prior.protected_main_tree) && prior.clean_526_ancestor_distance === 12 && prior.evidence_only === true && prior.readmission_authority === false,
    "receipt_prior_lineage", );
  requireCondition( target.protected_main_revision === targetRevision && target.protected_main_tree === targetTree && Number.isSafeInteger(target.clean_526_ancestor_distance) && target.clean_526_ancestor_distance > 12, "receipt_target", );
  const audit = record(value.audit_evidence, "receipt_audit");
  exactKeys( audit, [ "source_sha256", "source_normalized_sha256", "harness_sha256", "witness_sha256", "verified", "lineage_bound", "release_provenance_unbound", "snapshots_non_atomic", "release_created_at_order_safety_authority",
      "release_current_image_linkage_proven", "release_status_completion_authority", "release_stable_rollout_authority", "release_ledger_safety_authority", "release_history_complete", "release_history_may_be_truncated", ], "receipt_audit",
  );
  requireCondition( validSha(audit.source_sha256) && validSha(audit.source_normalized_sha256) && validSha(audit.harness_sha256) && validSha(audit.witness_sha256) && audit.verified === true && audit.lineage_bound === false &&
      audit.release_provenance_unbound === true && audit.snapshots_non_atomic === true && audit.release_created_at_order_safety_authority === false && audit.release_current_image_linkage_proven === false &&
      audit.release_status_completion_authority === false && audit.release_stable_rollout_authority === false && audit.release_ledger_safety_authority === false && audit.release_history_complete === false &&
      audit.release_history_may_be_truncated === true, "receipt_audit", );
  validateAuditEvidenceFiles(audit, target.clean_526_ancestor_distance);
  const bridgeHashes = bridgeSourceHashes();
  requireCondition( value.readmission_guard_raw_sha256 === bridgeHashes.raw && value.readmission_guard_normalized_sha256 === bridgeHashes.normalized, "bridge_binding", );
  const operator = readStablePrivateFile(REFENCE_OPERATOR);
  const harness = readStablePrivateFile(REFENCE_HARNESS);
  const operatorText = decode(operator.bytes, "operator_utf8");
  const declarations = refenceOperatorDeclarationValues(operatorText);
  const immutableCaveats = refenceOperatorImmutableCaveats(operatorText);
  requireCondition( canonicalJson(value.operator_normalization_contract) === canonicalJson(OPERATOR_NORMALIZATION_CONTRACT) && sha256(operator.bytes) === value.operator_sha256 && sha256(normalizedRefenceOperator(operatorText)) ===
        REFENCE_OPERATOR_SEMANTIC_SHA256 && sha256(harness.bytes) === value.operator_harness_sha256 && declarations.OPERATOR_NORMALIZED_SHA256 === value.operator_normalized_sha256 &&
      declarations.HARNESS_SHA256 === value.operator_harness_sha256 && declarations.FULL_AUDIT_SHA256 === audit.source_sha256 && declarations.FULL_AUDIT_NORMALIZED_SHA256 === audit.source_normalized_sha256 &&
      declarations.FULL_AUDIT_HARNESS_SHA256 === audit.harness_sha256 && declarations.FULL_AUDIT_WITNESS_SHA256 === audit.witness_sha256 && declarations.READMISSION_BRIDGE_REVISION === target.protected_main_revision &&
      declarations.READMISSION_BRIDGE_TREE === target.protected_main_tree && declarations.READMISSION_BRIDGE_DISTANCE_PIN === String(target.clean_526_ancestor_distance) && declarations.READMISSION_GUARD_NORMALIZED_SHA256 ===
        bridgeHashes.normalized, "operator_binding", );
  const wal = validateWalInventory(value, runID);
  const terminalProjection = record( value.terminal_proof, "receipt_terminal_proof", );
  exactKeys( terminalProjection, [ "fleet_sample_sha256", "drain_sample_sha256", "journal_sha256", "authority_sha256", "provider_absence_sha256", ], "receipt_terminal_proof", );
  const capsuleProjection = record(value.recovery_capsule, "receipt_capsule");
  exactKeys( capsuleProjection, [ "path", "schema", "sha256", "retired", "retirement_wal_ordinal", "retirement_wal_sha256", "retirement_checkpoint", ], "receipt_capsule", );
  requireCondition( value.roles_sha256 === roleMapSHA256(wal.roles) && value.image_contract_sha256 === sha256(canonicalJson(wal.imageContract)) && value.terminal_wal_entry_sha256 === wal.terminalSHA256 &&
      value.wal_sha256_before_receipt === wal.terminalSHA256 && value.wal_inventory.terminal_entry_sha256 === wal.terminalSHA256 && value.terminal_wal_entry_filename === `${ String(value.terminal_wal_ordinal).padStart(6, "0")
        }-${wal.terminalSHA256}.json` && value.terminal_wal_ordinal === value.wal_inventory.entry_count && value.terminal_checkpoint === "fenced_awaiting_protected_main_readmission" && value.terminal_sample_count === 3 &&
      value.terminal_drain_sample_count === 3 && value.terminal_interval_ms === 5_137 && value.maintenance_anchor_schema === "agenttool-phase-b-refence-observed-526-anchor/v1" && value.maintenance_anchor_run_id === runID &&
      validSha(value.terminal_fleet_sha256) && Object.values(terminalProjection).every(validSha) && capsuleProjection.schema === "agenttool-phase-b-refence-observed-526-capsule/v1" && validSha(capsuleProjection.sha256) &&
      capsuleProjection.retired === true && capsuleProjection.retirement_wal_ordinal === value.terminal_wal_ordinal && capsuleProjection.retirement_wal_sha256 === wal.terminalSHA256 && capsuleProjection.retirement_checkpoint ===
        "fenced_awaiting_protected_main_readmission" && typeof capsuleProjection.path === "string" && absent(capsuleProjection.path) && value.provider_generation_absence_revalidated_after_fence === true &&
      value.keychain_generation_absence_observed_before_mutation === true && value.journal_verified_after_fence === true && value.authority_verified_after_fence === true && value.drain_verified_after_fence === true &&
      value.application_actor === "unknown" && value.application_path === "unknown" && value.application_time_quiescence_proven === false && Array.isArray(value.caveats) && value.caveats.length > 0, "receipt_wal_binding", );
  const receiptInventory = deployReceiptInventory();
  const proofRecordedEntry = value.wal_inventory.entries[ value.terminal_proof_recorded_wal_ordinal - 1 ];
  requireCondition( receiptInventory.count === wal.deployReceiptFileCount && receiptInventory.sha256 === wal.deployReceiptInventorySHA256 && Number.isSafeInteger(value.terminal_proof_recorded_wal_ordinal) &&
      value.terminal_proof_recorded_wal_ordinal > 0 && proofRecordedEntry?.sha256 === value.terminal_proof_recorded_wal_sha256 && proofRecordedEntry?.checkpoint === "terminal_proof_recorded_capsule_retirement_pending",
    "deploy_receipt_inventory", );
  const archives = archivePaths(value, runID);
  const markerExists = !absent(MAINTENANCE_MARKER);
  const witnessExists = !absent(ARMED_WITNESS);
  const anchorArchiveExists = !absent(archives.anchor);
  const witnessArchiveExists = !absent(archives.witness);
  requireCondition(markerExists, "handoff_state");
  const marker = parsePrivateJson(MAINTENANCE_MARKER, { links: [1, 2] });
  let anchor: ReturnType<typeof parsePrivateJson>;
  let witness: ReturnType<typeof parsePrivateJson>;
  let edge: HandoffEdge;
  const markerIsAnchor = marker.value.schema === "agenttool-phase-b-refence-observed-526-anchor/v1";
  const markerIsBridge = marker.value.schema === MAINTENANCE_MARKER_SCHEMA;
  const stagePath = handoffStagePath(runID);
  const stageExists = !absent(stagePath);
  if (markerIsAnchor) { anchor = marker;
    requireCondition(witnessExists, "handoff_state");
    witness = parsePrivateJson(ARMED_WITNESS, { links: [1, 2] });
    if (!stageExists && !anchorArchiveExists && !witnessArchiveExists) { edge = "H0"; } else if (stageExists && !anchorArchiveExists && !witnessArchiveExists) { edge = "H1";
    } else if (stageExists && anchorArchiveExists && !witnessArchiveExists) { edge = "H2"; } else if (stageExists && anchorArchiveExists && witnessArchiveExists) { edge = "H3"; } else return refuse("handoff_state");
    if (stageExists) { const staged = parsePrivateJson(stagePath);
      validateBridgeMarker( staged.value, { rolloutID, receiptSHA256: expectedReceiptSHA256, runID, targetRevision, targetTree, anchorSHA256: value.maintenance_anchor_sha256, anchorDevice: anchor.stat.dev, anchorInode: anchor.stat.ino,
          witnessSHA256: value.armed_witness.sha256, witnessDevice: witness.stat.dev, witnessInode: witness.stat.ino, bridgeRawSHA256: bridgeHashes.raw, bridgeNormalizedSHA256: bridgeHashes.normalized, }, wal.roles, true, ); } } else {
    requireCondition( markerIsBridge && anchorArchiveExists && witnessArchiveExists, "handoff_state", );
    anchor = parsePrivateJson(archives.anchor);
    witness = parsePrivateJson( witnessExists ? ARMED_WITNESS : archives.witness, { links: witnessExists ? [2] : [1] }, );
    requireCondition(!stageExists, "handoff_state");
    edge = witnessExists ? "H4" : "H5";
    validateBridgeMarker(marker.value, { rolloutID, receiptSHA256: expectedReceiptSHA256, runID, targetRevision, targetTree, anchorSHA256: value.maintenance_anchor_sha256, anchorDevice: anchor.stat.dev, anchorInode: anchor.stat.ino,
      witnessSHA256: value.armed_witness.sha256, witnessDevice: witness.stat.dev, witnessInode: witness.stat.ino, bridgeRawSHA256: bridgeHashes.raw, bridgeNormalizedSHA256: bridgeHashes.normalized, }, wal.roles); }
  const producerAuthority = maintenanceContract() .validateProducerAuthorityProjection({ receipt: value, walRecords: wal.records, anchor: { value: anchor.value, sha256: anchor.digest },
      witness: { value: witness.value, sha256: witness.digest }, });
  requireCondition( producerAuthority.caveats_sha256 === sha256(canonicalJson(immutableCaveats)) && producerAuthority.recovery_capsule_path === capsuleProjection.path &&
      producerAuthority.recovery_capsule_sha256 === capsuleProjection.sha256 && absent(producerAuthority.recovery_capsule_path), "producer_authority_projection", );
  validateAnchorAndWitness( value, anchor, witness, archives, runID, bridgeHashes, );
  validateHandoffLinks(edge, anchor, witness, archives);
  validateLocalControlInventory( runID, edge, archives.anchor, archives.witness, capsuleProjection.path, );
  if (edge === "H0") { const firstWal = wal.records[0];
    requireCondition( firstWal !== undefined && validateProducerLocalStateSandwichForTest({ anchorSHA256: anchor.digest, firstWalSHA256: firstWal.sha256, firstWalOrdinal: firstWal.value.ordinal,
            deployReceiptInventorySHA256: receiptInventory.sha256, deployReceiptFileCount: receiptInventory.count, }, wal.localStateSandwichSHA256) === wal.localStateSandwichSHA256, "producer_local_state_sandwich", ); }
  return {
    receipt: value, receiptSHA256: expectedReceiptSHA256, runID, roles: wal.roles, sourceRevision: EXPECTED_SOURCE_REVISION, sourceTree: EXPECTED_SOURCE_TREE, targetRevision, targetTree, targetDistance: target.clean_526_ancestor_distance,
    anchor: anchor.value, anchorSHA256: anchor.digest, anchorPath: MAINTENANCE_MARKER, anchorArchivePath: archives.anchor, anchorStat: anchor.stat, witness: witness.value, witnessSHA256: witness.digest, witnessPath: ARMED_WITNESS,
    witnessArchivePath: archives.witness, witnessStat: witness.stat, walDirectory: wal.directory, walInventorySHA256: wal.inventorySHA256, terminalWalSHA256: wal.terminalSHA256, imageContract: wal.imageContract,
    sourceInventorySHA256: wal.sourceInventorySHA256, journalInventorySHA256: wal.journalInventorySHA256, cronSHA256: wal.cronSHA256, restoredConfigSHA256ByMachine: wal.restoredConfigSHA256ByMachine,
    fencedConfigSHA256ByMachine: wal.fencedConfigSHA256ByMachine, deployReceiptInventorySHA256: wal.deployReceiptInventorySHA256, deployReceiptFileCount: wal.deployReceiptFileCount, producerAdmission: {
      embeddedCriticalContractSHA256: wal.embeddedCriticalContractSHA256, localStateSandwichSHA256: wal.localStateSandwichSHA256, }, producerTerminalProof: { journalSHA256: wal.terminalJournalSHA256,
      drainSampleSHA256: wal.terminalDrainSampleSHA256, drainEventSHA256s: wal.terminalDrainEventSHA256s, }, bridgeRawSHA256: bridgeHashes.raw, bridgeNormalizedSHA256: bridgeHashes.normalized, edge, }; }

function refenceOperatorDeclarationValues( text: string, ): Record<string, string> { return maintenanceContract().refenceOperatorDeclarationValues( text, OPERATOR_NORMALIZATION_DECLARATIONS, ); }

function refenceOperatorImmutableCaveats(text: string): readonly string[] { return maintenanceContract().refenceOperatorImmutableCaveats(text); }

export function normalizedRefenceOperator(text: string): string { return maintenanceContract().normalizedRefenceOperator( text, OPERATOR_NORMALIZATION_DECLARATIONS, ); }

export function normalizedFullAudit(text: string): string { return maintenanceContract().normalizedFullAudit(text); }

export function expectedAuditWitness(targetDistance: number): JsonRecord { return maintenanceContract().expectedAuditWitness(targetDistance); }
function validateAuditEvidenceFiles( audit: JsonRecord, targetDistance: number, ): void { const source = readStablePrivateFile(FULL_AUDIT);
  const harness = readStablePrivateFile(FULL_AUDIT_HARNESS);
  const witness = parsePrivateJson(FULL_AUDIT_WITNESS, { pretty: false });
  const sourceText = decode(source.bytes, "audit_source_utf8");
  const expectedWitness = expectedAuditWitness(targetDistance);
  requireCondition( sha256(source.bytes) === audit.source_sha256 && sha256(normalizedFullAudit(sourceText)) === audit.source_normalized_sha256 && sha256(harness.bytes) === audit.harness_sha256 && witness.digest === audit.witness_sha256 &&
      sha256(canonicalJson(Object.keys(expectedWitness).sort())) === "5f51c40ba3796125222b631af86b12263d12fdc8fa0701696105b90dbedb7867" && canonicalJson(witness.value) === canonicalJson(expectedWitness), "audit_evidence_files", ); }

function validateAnchorAndWitness( receipt: JsonRecord, anchor: ReturnType<typeof parsePrivateJson>, witness: ReturnType<typeof parsePrivateJson>, archives: { anchor: string; witness: string }, runID: string,
  bridgeHashes: { raw: string; normalized: string }, ): void { const anchorValue = anchor.value;
  const witnessValue = witness.value;
  exactKeys( anchorValue, [ "schema", "run_id", "source_revision", "source_tree", "wal_directory", "first_entry_filename", "first_entry_sha256", "created_at", "no_secret_values", "retained_until_protected_main_readmission",
      "terminal_status", "authorized_archive_path", "archive_handoff_method", "armed_witness_path", "armed_witness_schema", "armed_witness_authorized_archive_path", "armed_witness_archive_handoff_method", "readmission_target",
      "readmission_guard_path", "readmission_guard_schema", "readmission_guard_normalized_sha256", "guard_raw_sha256", "guard_raw_claimed", ], "anchor_shape", );
  exactKeys( witnessValue, [ "schema", "run_id", "source_revision", "source_tree", "operator_path", "operator_sha256", "operator_normalized_sha256", "mutation_armed", "armed_wal_ordinal", "armed_wal_sha256", "armed_at",
      "deploy_lock_device", "deploy_lock_inode", "context_sha256", "admission_sha256", "recovery_capsule_reference_sha256", "no_secret_values", "retained_until_protected_main_readmission", "terminal_status", "authorized_archive_path",
      "archive_handoff_method", "readmission_target", "readmission_guard_path", "readmission_guard_schema", "readmission_guard_normalized_sha256", "guard_raw_sha256", "guard_raw_claimed", ], "armed_witness_shape", );
  const target = record(receipt.readmission_target, "receipt_target");
  requireCondition( anchor.digest === receipt.maintenance_anchor_sha256 && anchorValue.schema === "agenttool-phase-b-refence-observed-526-anchor/v1" && anchorValue.run_id === runID &&
      anchorValue.source_revision === EXPECTED_SOURCE_REVISION && anchorValue.source_tree === EXPECTED_SOURCE_TREE && anchorValue.wal_directory === receipt.wal_inventory.directory && anchorValue.terminal_status ===
        "fenced_awaiting_protected_main_readmission" && anchorValue.authorized_archive_path === archives.anchor && anchorValue.armed_witness_path === ARMED_WITNESS && anchorValue.armed_witness_authorized_archive_path === archives.witness &&
      canonicalJson(anchorValue.readmission_target) === canonicalJson(target) && anchorValue.readmission_guard_path === BRIDGE_SOURCE && anchorValue.readmission_guard_schema === MAINTENANCE_REFENCE_BRIDGE_SCHEMA &&
      anchorValue.guard_raw_sha256 === bridgeHashes.raw && anchorValue.readmission_guard_normalized_sha256 === bridgeHashes.normalized && anchorValue.guard_raw_claimed === true, "anchor_contract", );
  requireCondition( witness.digest === receipt.armed_witness.sha256 && witnessValue.schema === "agenttool-phase-b-refence-observed-526-armed-witness/v1" && witnessValue.run_id === runID &&
      witnessValue.source_revision === EXPECTED_SOURCE_REVISION && witnessValue.source_tree === EXPECTED_SOURCE_TREE && witnessValue.operator_path === REFENCE_OPERATOR && witnessValue.operator_sha256 === receipt.operator_sha256 &&
      witnessValue.operator_normalized_sha256 === REFENCE_OPERATOR_SEMANTIC_SHA256 && witnessValue.mutation_armed === true && witnessValue.retained_until_protected_main_readmission === true && witnessValue.terminal_status ===
        "fenced_awaiting_protected_main_readmission" && witnessValue.authorized_archive_path === archives.witness && canonicalJson(witnessValue.readmission_target) === canonicalJson(target) &&
      witnessValue.readmission_guard_path === BRIDGE_SOURCE && witnessValue.readmission_guard_schema === MAINTENANCE_REFENCE_BRIDGE_SCHEMA && witnessValue.guard_raw_sha256 === bridgeHashes.raw &&
      witnessValue.readmission_guard_normalized_sha256 === bridgeHashes.normalized && witnessValue.guard_raw_claimed === true, "armed_witness_contract", ); }

function validateHandoffLinks( edge: HandoffEdge, anchor: ReturnType<typeof parsePrivateJson>, witness: ReturnType<typeof parsePrivateJson>, archives: { anchor: string; witness: string }, ): void { if (["H0", "H1"].includes(edge)) {
    requireCondition( anchor.stat.nlink === 1 && witness.stat.nlink === 1, "handoff_link_count", ); }
  if (["H2", "H3"].includes(edge)) { const archived = lstatSync(archives.anchor);
    requireCondition( archived.dev === anchor.stat.dev && archived.ino === anchor.stat.ino && archived.nlink === 2 && anchor.stat.nlink === 2, "anchor_archive_inode", ); }
  if (edge === "H2") { requireCondition(witness.stat.nlink === 1, "witness_archive_inode"); }
  if (["H3", "H4"].includes(edge)) { const archived = lstatSync(archives.witness);
    requireCondition( archived.dev === witness.stat.dev && archived.ino === witness.stat.ino && archived.nlink === 2 && witness.stat.nlink === 2, "witness_archive_inode", ); }
  if (["H4", "H5"].includes(edge)) { requireCondition( lstatSync(archives.anchor).nlink === 1, "anchor_archive_inode", ); }
  if (edge === "H5") { requireCondition( lstatSync(archives.witness).nlink === 1, "witness_archive_inode", ); } }

function handoffStagePath(runID: string): string { return join( DEPLOY_STATE_DIR, `.phase-b-refence-maintenance-marker-${runID}.tmp`, ); }

interface MarkerBindings { rolloutID: string;
  receiptSHA256: string;
  runID: string;
  targetRevision: string;
  targetTree: string;
  anchorSHA256: string;
  anchorDevice: number;
  anchorInode: number;
  witnessSHA256: string;
  witnessDevice: number;
  witnessInode: number;
  bridgeRawSHA256: string;
  bridgeNormalizedSHA256: string; }

interface ControllerPreparationBinding { startedAt: string;
  deployLock: { schema: "agenttool-local-deploy-lock/v1";
    public_path: string;
    owner_record: string;
    device: number;
    inode: number;
    sha256: string;
    pid: number; };
  buildContext: { schema: "agenttool-phase-b-refence-build-context/v1";
    path: string;
    source_revision: string;
    source_tree: string;
    inventory_sha256: string;
    inventory_byte_count: number;
    file_count: number;
    byte_count: number;
    context_device: number;
    context_inode: number;
    readback_sha256: string;
    ready_path: string;
    ready_sha256: string;
    prepared: true; };
  dependencyEstate: { schema: "agenttool-phase-b-refence-dependency-estate/v1";
    path: string;
    project_path: string;
    runtime_source_path: string;
    source_revision: string;
    source_tree: string;
    source_inventory_sha256: string;
    postgres_runtime_closure_sha256: string;
    dependency_inventory_sha256: string;
    dependency_file_count: number;
    dependency_byte_count: number;
    dependency_symlink_count: number;
    estate_device: number;
    estate_inode: number;
    ready_path: string;
    ready_sha256: string;
    prepared: true; };
  controllerWalDirectory: string;
  earlyGuardSHA256: string;
  earlyDatabaseProofSHA256: string;
  databaseTargetSHA256: string; }

function refenceHandoffRecord(bindings: MarkerBindings): JsonRecord { return { proof_schema: "agenttool-phase-b-refence-handoff/v1", refence_receipt_sha256: bindings.receiptSHA256, refence_run_id: bindings.runID,
    source_revision: EXPECTED_SOURCE_REVISION, source_tree: EXPECTED_SOURCE_TREE, target_revision: bindings.targetRevision, target_tree: bindings.targetTree, anchor_archive_path: join( DEPLOY_STATE_DIR,
      `phase-b-refence-observed-526-anchor-retired-${bindings.runID}.json`, ), anchor_sha256: bindings.anchorSHA256, anchor_device: bindings.anchorDevice, anchor_inode: bindings.anchorInode, witness_archive_path: join( DEPLOY_STATE_DIR,
      `phase-b-refence-observed-526-armed-witness-retired-${bindings.runID}.json`, ), witness_sha256: bindings.witnessSHA256, witness_device: bindings.witnessDevice, witness_inode: bindings.witnessInode, wal_root: WAL_ROOT,
    bridge_source_path: BRIDGE_SOURCE, bridge_source_sha256: bindings.bridgeRawSHA256, bridge_normalized_sha256: bindings.bridgeNormalizedSHA256, preexisting_lineage_bound: false, release_current_image_linkage_proven: false,
    release_status_completion_authority: false, release_stable_rollout_authority: false, release_ledger_safety_authority: false, release_history_may_be_truncated: true, public_surfaces_expected_unavailable: true, }; }

function initialBridgeMarker( bindings: MarkerBindings, roles: RoleMap, configFingerprint: string, preparation: ControllerPreparationBinding, ): JsonRecord { const expectedIDs = machineIDs(roles).sort();
  requireCondition( validSha(preparation.earlyDatabaseProofSHA256) && validSha(preparation.databaseTargetSHA256), "bridge_marker_database_convergence", );
  return { schema: MAINTENANCE_MARKER_SCHEMA, rollout_id: bindings.rolloutID, controller_run_id: bindings.runID, source_revision: bindings.targetRevision, source_tree: bindings.targetTree, started_at: preparation.startedAt,
    updated_at: preparation.startedAt, status: "active", checkpoint: "refence_handoff_adopted", recovery_required: true, manual_finalization_required: false, mutation_effect_began: false, failure_code: null,
    initial_app_cordon_snapshot_verified: true, initial_cordoned_app_machine_count: 3, cordoned_runtime_verified: false, thinker_primary_started_verified: false, final_app_uncordon_verified: false, image_tag: "", image_digest: null,
    expected_machine_ids: expectedIDs, role_mapping: { app_machine_ids: appIDs(roles).sort(), thinker_primary_machine_id: roles.thinker_primary, thinker_standby_machine_id: roles.thinker_standby, },
    machine_set_sha256: EXPECTED_MACHINE_SET_SHA256, non_image_config_sha256: configFingerprint, attempted_machine_ids: [], image_verified_machine_ids: [], started_app_machine_ids: [], autostart_restored_app_machine_ids: [],
    uncordon_attempted_app_machine_ids: [], uncordon_verified_app_machine_ids: [], recovery_cordon_attempted_app_machine_ids: [], recovery_cordoned_app_machine_ids: [], recovery_refenced_machine_ids: [], database_convergence: {
      schema: "agenttool-phase-b-refence-database-origin-convergence/v1", status: "initial", intent_durable: false, statement_attempted: false, commit_state: "not_attempted", verified: false, reconciliation_required: false,
      database_write_attempt_count: 0, rows_updated: 0, rollback_attempt_count: 0, statement_sha256: DATABASE_ORIGIN_STATEMENT_SHA256, database_target_sha256: preparation.databaseTargetSHA256,
      before_proof_sha256: preparation.earlyDatabaseProofSHA256, after_proof_sha256: null, before_row_sha256: null, after_row_sha256: null, unchanged_projection_sha256: null, delta_sha256: null,
      before_instance_url_sha256: PRE_REFENCE_INSTANCE_URL_SHA256, after_instance_url_sha256: TARGET_INSTANCE_URL_SHA256, before_updated_at: EXPECTED_FEDERATION_UPDATED_AT, after_updated_at: null, clock_before: null, clock_after: null,
      intent_wal_ordinal: null, intent_wal_sha256: null, commit_ack_wal_ordinal: null, commit_ack_wal_sha256: null, verified_wal_ordinal: null, verified_wal_sha256: null, }, deploy_lock: preparation.deployLock,
    build_context: preparation.buildContext, dependency_estate: preparation.dependencyEstate, child_wal: { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", directory: preparation.controllerWalDirectory, entry_count: 0,
      ordered_filenames: [], chain_sha256: null, terminal_entry_sha256: null, terminal_phase: null, }, guard_proofs: { early_sha256: preparation.earlyGuardSHA256, prepublication_before_build_sha256: null,
      prepublication_before_image_sha256: null, final_sha256: null, }, public_proofs: { first_canary_sha256: null, final_sha256: null, ordinary_postflight_sha256: null, }, success_receipt: { path: null, sha256: null, durable: false, },
    success_finalization: { schema: "agenttool-phase-b-refence-maintenance-success-finalization/v1", authority_projection_sha256: null, witness_path: null, marker_retirement_claim_path: null, receipt_pending: false,
      marker_retirement_authorized: false, }, runtime_pins: { bun_path: PINNED_BUN, bun_sha256: PINNED_BUN_SHA256, bun_byte_count: PINNED_BUN_BYTE_COUNT, bun_version: PINNED_BUN_VERSION, fly_path: PINNED_FLY, fly_sha256: PINNED_FLY_SHA256,
      stable_user_owned_pins: true, concurrent_same_uid_immutability_claimed: false, }, caveats: [ "preexisting_lineage_bound_false", "release_current_image_linkage_not_authority", "release_history_may_be_truncated",
      "sigkill_with_deploy_lock_requires_manual_recovery", "timed_out_or_unsettled_provider_effect_requires_manual_recovery", "database_origin_convergence_never_rolled_back", "success_receipt_with_marker_requires_manual_finalization", ],
    refence_handoff: refenceHandoffRecord(bindings), }; }

/** @internal Complete production-shaped pre-A0 marker for contained tests. */
export function createSuccessReadyBridgeMarkerForTest(request: { bindings: MarkerBindings;
  roles: RoleMap;
  configFingerprint: string;
  preparation: ControllerPreparationBinding;
  updatedAt: string;
  imageDigest: string;
  databaseConvergence: JsonRecord;
  controllerWal: JsonRecord;
  rolloutProofs: JsonRecord; }): JsonRecord { const marker = initialBridgeMarker( request.bindings, request.roles, request.configFingerprint, request.preparation, );
  const expectedIDs = machineIDs(request.roles).sort();
  const expectedApps = appIDs(request.roles).sort();
  marker.updated_at = request.updatedAt;
  marker.checkpoint = "all_final_gates_verified";
  marker.mutation_effect_began = true;
  marker.cordoned_runtime_verified = true;
  marker.thinker_primary_started_verified = true;
  marker.final_app_uncordon_verified = true;
  marker.image_tag = request.bindings.rolloutID;
  marker.image_digest = request.imageDigest;
  marker.attempted_machine_ids = expectedIDs;
  marker.image_verified_machine_ids = expectedIDs;
  marker.started_app_machine_ids = expectedApps;
  marker.autostart_restored_app_machine_ids = expectedApps;
  marker.uncordon_attempted_app_machine_ids = expectedApps;
  marker.uncordon_verified_app_machine_ids = expectedApps;
  marker.database_convergence = structuredClone( request.databaseConvergence, );
  marker.child_wal = { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", ...request.controllerWal, };
  const proofs = record(request.rolloutProofs, "success_marker_fixture");
  marker.guard_proofs.prepublication_before_build_sha256 = proofs.special_guards[0];
  marker.guard_proofs.prepublication_before_image_sha256 = proofs.special_guards[1];
  marker.guard_proofs.final_sha256 = proofs.final_authority_sha256;
  marker.public_proofs.first_canary_sha256 = proofs.public_first_canary_sha256;
  marker.public_proofs.final_sha256 = proofs.public_final_sha256;
  marker.public_proofs.ordinary_postflight_sha256 = proofs.ordinary_absent_postflight_sha256;
  validateBridgeMarker( marker, request.bindings, request.roles, );
  return marker; }

const BRIDGE_MARKER_KEYS = [ "schema", "rollout_id", "controller_run_id", "source_revision", "source_tree", "started_at", "updated_at", "status", "checkpoint", "recovery_required", "manual_finalization_required", "mutation_effect_began",
  "failure_code", "initial_app_cordon_snapshot_verified", "initial_cordoned_app_machine_count", "cordoned_runtime_verified", "thinker_primary_started_verified", "final_app_uncordon_verified", "image_tag", "image_digest",
  "expected_machine_ids", "role_mapping", "machine_set_sha256", "non_image_config_sha256", "attempted_machine_ids", "image_verified_machine_ids", "started_app_machine_ids", "autostart_restored_app_machine_ids",
  "uncordon_attempted_app_machine_ids", "uncordon_verified_app_machine_ids", "recovery_cordon_attempted_app_machine_ids", "recovery_cordoned_app_machine_ids", "recovery_refenced_machine_ids", "database_convergence", "deploy_lock",
  "build_context", "dependency_estate", "child_wal", "guard_proofs", "public_proofs", "success_receipt", "success_finalization", "runtime_pins", "caveats", "refence_handoff", ] as const;

function validateDatabaseConvergenceMarker(value: JsonRecord): void { maintenanceContract().validateDatabaseConvergenceMarker(value); }

function validateDatabaseConvergenceTransition( current: JsonRecord, next: JsonRecord, ): void { maintenanceContract().validateDatabaseConvergenceTransition(current, next); }

/** @internal Exact dedicated-marker projection validator for contained tests. */
export function validateDatabaseConvergenceMarkerForTest( value: unknown, ): void { maintenanceContract().validateDatabaseConvergenceMarker(value); }

/** @internal Exact monotonic database-marker transition for contained tests. */
export function validateDatabaseConvergenceTransitionForTest( current: unknown, next: unknown, ): void { maintenanceContract().validateDatabaseConvergenceTransition(current, next); }

function validateBridgeMarker( value: JsonRecord, bindings: MarkerBindings, roles: RoleMap, initial = false, ): void { exactKeys(value, BRIDGE_MARKER_KEYS, "bridge_marker_shape");
  exactKeys( value.role_mapping, [ "app_machine_ids", "thinker_primary_machine_id", "thinker_standby_machine_id", ], "bridge_marker_role_mapping", );
  const databaseConvergence = record( value.database_convergence, "bridge_marker_database_convergence", );
  validateDatabaseConvergenceMarker(databaseConvergence);
  exactKeys( value.deploy_lock, [ "schema", "public_path", "owner_record", "device", "inode", "sha256", "pid", ], "bridge_marker_lock", );
  exactKeys( value.build_context, [ "schema", "path", "source_revision", "source_tree", "inventory_sha256", "inventory_byte_count", "file_count", "byte_count", "context_device", "context_inode", "readback_sha256", "ready_path",
      "ready_sha256", "prepared", ], "bridge_marker_build_context", );
  exactKeys( value.dependency_estate, [ "schema", "path", "project_path", "runtime_source_path", "source_revision", "source_tree", "source_inventory_sha256", "postgres_runtime_closure_sha256", "dependency_inventory_sha256",
      "dependency_file_count", "dependency_byte_count", "dependency_symlink_count", "estate_device", "estate_inode", "ready_path", "ready_sha256", "prepared", ], "bridge_marker_dependency_estate", );
  exactKeys( value.child_wal, [ "schema", "directory", "entry_count", "ordered_filenames", "chain_sha256", "terminal_entry_sha256", "terminal_phase", ], "bridge_marker_child_wal", );
  exactKeys( value.guard_proofs, [ "early_sha256", "prepublication_before_build_sha256", "prepublication_before_image_sha256", "final_sha256", ], "bridge_marker_guard_proofs", );
  exactKeys( value.public_proofs, ["first_canary_sha256", "final_sha256", "ordinary_postflight_sha256"], "bridge_marker_public_proofs", );
  exactKeys( value.success_receipt, ["path", "sha256", "durable"], "bridge_marker_success_receipt", );
  exactKeys( value.success_finalization, [ "schema", "authority_projection_sha256", "witness_path", "marker_retirement_claim_path", "receipt_pending", "marker_retirement_authorized", ], "bridge_marker_success_finalization", );
  exactKeys( value.runtime_pins, [ "bun_path", "bun_sha256", "bun_byte_count", "bun_version", "fly_path", "fly_sha256", "stable_user_owned_pins", "concurrent_same_uid_immutability_claimed", ], "bridge_marker_runtime_pins", );
  const expectedIDs = machineIDs(roles).sort();
  const expectedApps = appIDs(roles).sort();
  const arrays = [ "attempted_machine_ids", "image_verified_machine_ids", "started_app_machine_ids", "autostart_restored_app_machine_ids", "uncordon_attempted_app_machine_ids", "uncordon_verified_app_machine_ids",
    "recovery_cordon_attempted_app_machine_ids", "recovery_cordoned_app_machine_ids", "recovery_refenced_machine_ids", ];
  for (const key of arrays) { const entries = value[key];
    requireCondition( Array.isArray(entries) && entries.every(validMachineID) && entries.every((entry: string, index: number) => index === 0 || entries[index - 1] < entry ) && new Set(entries).size === entries.length &&
        entries.every((entry: string) => expectedIDs.includes(entry)), "bridge_marker_machine_array", ); }
  requireCondition( value.schema === MAINTENANCE_MARKER_SCHEMA && value.rollout_id === bindings.rolloutID && value.controller_run_id === bindings.runID && value.source_revision === bindings.targetRevision &&
      value.source_tree === bindings.targetTree && typeof value.started_at === "string" && typeof value.updated_at === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test( value.started_at, ) &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test( value.updated_at, ) && value.updated_at >= value.started_at && [ "active", "failed_or_uncertain", "success_proven_receipt_pending", ].includes(value.status) &&
      typeof value.checkpoint === "string" && /^[a-z0-9_]{1,128}$/.test(value.checkpoint) && typeof value.recovery_required === "boolean" && typeof value.manual_finalization_required === "boolean" &&
      typeof value.mutation_effect_began === "boolean" && (value.failure_code === null || (typeof value.failure_code === "string" && /^[a-z0-9_]{1,64}$/.test(value.failure_code))) &&
      typeof value.initial_app_cordon_snapshot_verified === "boolean" && value.initial_cordoned_app_machine_count === 3 && typeof value.cordoned_runtime_verified === "boolean" &&
      typeof value.thinker_primary_started_verified === "boolean" && typeof value.final_app_uncordon_verified === "boolean" && typeof value.image_tag === "string" && value.image_tag.length <= 512 && (value.image_digest === null ||
        (typeof value.image_digest === "string" && /^sha256:[0-9a-f]{64}$/.test(value.image_digest))) && canonicalJson(value.expected_machine_ids) === canonicalJson(expectedIDs) && canonicalJson(value.role_mapping.app_machine_ids) ===
        canonicalJson(expectedApps) && value.role_mapping.thinker_primary_machine_id === roles.thinker_primary && value.role_mapping.thinker_standby_machine_id === roles.thinker_standby &&
      value.machine_set_sha256 === EXPECTED_MACHINE_SET_SHA256 && validSha(value.non_image_config_sha256) && (databaseConvergence.status === "initial" || value.mutation_effect_began === true) &&
      value.deploy_lock.schema === "agenttool-local-deploy-lock/v1" && value.deploy_lock.public_path === DEPLOY_LOCK && typeof value.deploy_lock.owner_record === "string" && dirname(value.deploy_lock.owner_record) === STATE_DIR &&
      /^\.deploy-lock-owner\.refence-[1-9][0-9]*-[0-9a-f]{16}$/.test( basename(value.deploy_lock.owner_record), ) && Number.isSafeInteger(value.deploy_lock.device) && Number.isSafeInteger(value.deploy_lock.inode) &&
      validSha(value.deploy_lock.sha256) && Number.isSafeInteger(value.deploy_lock.pid) && value.deploy_lock.pid > 1 && value.build_context.schema === "agenttool-phase-b-refence-build-context/v1" && value.build_context.path ===
        join(CONTROLLER_BUILD_ROOT, bindings.runID) && value.build_context.source_revision === bindings.targetRevision && value.build_context.source_tree === bindings.targetTree && validSha(value.build_context.inventory_sha256) &&
      value.build_context.inventory_sha256 === EXPECTED_BUILD_MANIFEST_SHA256 && value.build_context.inventory_byte_count === EXPECTED_BUILD_MANIFEST_BYTE_COUNT && value.build_context.file_count === EXPECTED_BUILD_FILE_COUNT &&
      value.build_context.byte_count === EXPECTED_BUILD_BYTE_COUNT && Number.isSafeInteger(value.build_context.context_device) && Number.isSafeInteger(value.build_context.context_inode) && validSha(value.build_context.readback_sha256) &&
      value.build_context.ready_path === join( CONTROLLER_BUILD_ROOT, `${bindings.runID}.ready.json`, ) && validSha(value.build_context.ready_sha256) && value.build_context.prepared === true && value.dependency_estate.schema ===
        "agenttool-phase-b-refence-dependency-estate/v1" && value.dependency_estate.path === join(CONTROLLER_DEPENDENCY_ROOT, bindings.runID) && value.dependency_estate.project_path ===
        join(CONTROLLER_DEPENDENCY_ROOT, bindings.runID, "project") && value.dependency_estate.runtime_source_path === POSTGRES_RUNTIME_SOURCE && value.dependency_estate.source_revision === bindings.targetRevision &&
      value.dependency_estate.source_tree === bindings.targetTree && validSha(value.dependency_estate.source_inventory_sha256) && value.dependency_estate.postgres_runtime_closure_sha256 === POSTGRES_RUNTIME_CLOSURE_SHA256 &&
      validSha(value.dependency_estate.dependency_inventory_sha256) && Number.isSafeInteger(value.dependency_estate.dependency_file_count) && value.dependency_estate.dependency_file_count === 17 &&
      Number.isSafeInteger(value.dependency_estate.dependency_byte_count) && value.dependency_estate.dependency_byte_count === 197_937 && Number.isSafeInteger(value.dependency_estate.dependency_symlink_count) &&
      value.dependency_estate.dependency_symlink_count === 0 && Number.isSafeInteger(value.dependency_estate.estate_device) && Number.isSafeInteger(value.dependency_estate.estate_inode) && value.dependency_estate.ready_path === join(
          CONTROLLER_DEPENDENCY_ROOT, `${bindings.runID}.ready.json`, ) && validSha(value.dependency_estate.ready_sha256) && value.dependency_estate.prepared === true && value.child_wal.schema ===
        "agenttool-phase-b-refence-maintenance-child-wal/v1" && value.child_wal.directory === join(CONTROLLER_WAL_ROOT, bindings.runID) && Number.isSafeInteger(value.child_wal.entry_count) && value.child_wal.entry_count >= 0 &&
      Array.isArray(value.child_wal.ordered_filenames) && value.child_wal.ordered_filenames.length === value.child_wal.entry_count && value.child_wal.ordered_filenames.every((name: unknown, index: number) => typeof name === "string" &&
        name.startsWith(`${String(index + 1).padStart(6, "0")}-`) && /^[0-9]{6}-[0-9a-f]{64}\.json$/.test(name) ) && (value.child_wal.chain_sha256 === null || validSha(value.child_wal.chain_sha256)) &&
      (value.child_wal.terminal_entry_sha256 === null || validSha(value.child_wal.terminal_entry_sha256)) && (value.child_wal.terminal_phase === null || [ "ready", "attempting", "spawned", "settled", "verified", "transition_verified",
          "failed_or_uncertain", "complete", ].includes(value.child_wal.terminal_phase)) && validSha(value.guard_proofs.early_sha256) && [ value.guard_proofs.prepublication_before_build_sha256,
        value.guard_proofs.prepublication_before_image_sha256, value.guard_proofs.final_sha256, value.public_proofs.first_canary_sha256, value.public_proofs.final_sha256, value.public_proofs.ordinary_postflight_sha256,
      ].every((entry) => entry === null || validSha(entry)) && typeof value.success_receipt.durable === "boolean" && (value.success_receipt.path === null || (typeof value.success_receipt.path === "string" &&
          dirname(value.success_receipt.path) === DEPLOY_RECEIPT_DIR)) && (value.success_receipt.sha256 === null || validSha(value.success_receipt.sha256)) && value.success_finalization.schema ===
        "agenttool-phase-b-refence-maintenance-success-finalization/v1" && (value.success_finalization.authority_projection_sha256 === null || validSha( value.success_finalization.authority_projection_sha256, )) &&
      (value.success_finalization.witness_path === null || value.success_finalization.witness_path === join( DEPLOY_STATE_DIR, `phase-b-refence-maintenance-finalization-${bindings.runID}.json`, )) &&
      (value.success_finalization.marker_retirement_claim_path === null || value.success_finalization.marker_retirement_claim_path === join( DEPLOY_STATE_DIR, `.phase-b-refence-maintenance-marker-retirement-${bindings.runID}.claim`, )) &&
      typeof value.success_finalization.receipt_pending === "boolean" && typeof value.success_finalization.marker_retirement_authorized === "boolean" && value.runtime_pins.bun_path === PINNED_BUN &&
      value.runtime_pins.bun_sha256 === PINNED_BUN_SHA256 && value.runtime_pins.bun_byte_count === PINNED_BUN_BYTE_COUNT && value.runtime_pins.bun_version === PINNED_BUN_VERSION && value.runtime_pins.fly_path === PINNED_FLY &&
      value.runtime_pins.fly_sha256 === PINNED_FLY_SHA256 && value.runtime_pins.stable_user_owned_pins === true && value.runtime_pins.concurrent_same_uid_immutability_claimed === false && canonicalJson(value.caveats) === canonicalJson([
          "preexisting_lineage_bound_false", "release_current_image_linkage_not_authority", "release_history_may_be_truncated", "sigkill_with_deploy_lock_requires_manual_recovery",
          "timed_out_or_unsettled_provider_effect_requires_manual_recovery", "database_origin_convergence_never_rolled_back", "success_receipt_with_marker_requires_manual_finalization", ]) && canonicalJson(value.refence_handoff) ===
        canonicalJson(refenceHandoffRecord(bindings)), "bridge_marker_contract", );
  const finalizationInitial = value.success_finalization.authority_projection_sha256 === null && value.success_finalization.witness_path === null && value.success_finalization.marker_retirement_claim_path === null &&
    value.success_finalization.receipt_pending === false && value.success_finalization.marker_retirement_authorized === false && value.success_receipt.path === null && value.success_receipt.sha256 === null &&
    value.success_receipt.durable === false;
  const finalizationPending = validSha(value.success_finalization.authority_projection_sha256) && typeof value.success_finalization.witness_path === "string" && typeof value.success_finalization.marker_retirement_claim_path === "string" &&
    value.success_finalization.receipt_pending === true && value.success_finalization.marker_retirement_authorized === true && typeof value.success_receipt.path === "string" && value.success_receipt.sha256 === null &&
    value.success_receipt.durable === false && value.status === "success_proven_receipt_pending" && value.checkpoint === "success_proven_receipt_pending" && value.recovery_required === false && value.manual_finalization_required === true &&
    value.failure_code === null && value.child_wal.terminal_phase === "complete";
  requireCondition( (finalizationInitial && value.status !== "success_proven_receipt_pending") || finalizationPending, "bridge_marker_success_finalization", );
  if (initial) { requireCondition( value.checkpoint === "refence_handoff_adopted" && value.status === "active" && value.recovery_required === true && value.manual_finalization_required === false &&
        value.mutation_effect_began === false && value.failure_code === null && value.initial_app_cordon_snapshot_verified === true && value.cordoned_runtime_verified === false && value.thinker_primary_started_verified === false &&
        value.final_app_uncordon_verified === false && value.image_tag === "" && value.image_digest === null && value.child_wal.entry_count === 0 && value.child_wal.chain_sha256 === null && value.child_wal.terminal_entry_sha256 === null &&
        value.child_wal.terminal_phase === null && value.guard_proofs.prepublication_before_build_sha256 === null && value.guard_proofs.prepublication_before_image_sha256 === null && value.guard_proofs.final_sha256 === null &&
        value.public_proofs.first_canary_sha256 === null && value.public_proofs.final_sha256 === null && value.public_proofs.ordinary_postflight_sha256 === null && value.success_receipt.path === null &&
        value.success_receipt.sha256 === null && value.success_receipt.durable === false && value.success_finalization.authority_projection_sha256 === null && value.success_finalization.witness_path === null &&
        value.success_finalization.marker_retirement_claim_path === null && value.success_finalization.receipt_pending === false && value.success_finalization.marker_retirement_authorized === false &&
        databaseConvergence.status === "initial" && databaseConvergence.intent_durable === false && databaseConvergence.statement_attempted === false && databaseConvergence.commit_state === "not_attempted" &&
        databaseConvergence.verified === false && databaseConvergence.reconciliation_required === false && databaseConvergence.database_write_attempt_count === 0 && databaseConvergence.rows_updated === 0 &&
        databaseConvergence.rollback_attempt_count === 0 && validSha(databaseConvergence.database_target_sha256) && validSha(databaseConvergence.before_proof_sha256) && databaseConvergence.after_proof_sha256 === null &&
        databaseConvergence.before_row_sha256 === null && databaseConvergence.after_row_sha256 === null && databaseConvergence.unchanged_projection_sha256 === null && databaseConvergence.delta_sha256 === null &&
        databaseConvergence.after_updated_at === null && databaseConvergence.clock_before === null && databaseConvergence.clock_after === null && databaseConvergence.intent_wal_ordinal === null &&
        databaseConvergence.intent_wal_sha256 === null && databaseConvergence.commit_ack_wal_ordinal === null && databaseConvergence.commit_ack_wal_sha256 === null && databaseConvergence.verified_wal_ordinal === null &&
        databaseConvergence.verified_wal_sha256 === null && arrays.every((key) => value[key].length === 0), "bridge_marker_initial", ); } }

export function replaceDurableCanonicalJsonCAS(request: { canonicalPath: string;
  directory: string;
  stagePath: string;
  expectedCurrentSHA256: string;
  nextValue: JsonRecord;
  verifyAuthority(): void;
  validateCurrent(value: JsonRecord): void;
  validateNext(value: JsonRecord): void;
  onDurableInstall?(): void;
  fsyncDirectory?(path: string, afterSync?: () => void): void; }): { sha256: string; identity: DurableFileIdentity } { requireCondition( dirname(request.canonicalPath) === request.directory &&
      dirname(request.stagePath) === request.directory && request.stagePath !== request.canonicalPath && validSha(request.expectedCurrentSHA256), "marker_cas_contract", );
  request.verifyAuthority();
  const current = parsePrivateJson(request.canonicalPath);
  requireCondition( current.digest === request.expectedCurrentSHA256 && current.stat.nlink === 1, "marker_cas_current", );
  request.validateCurrent(current.value);
  request.validateNext(request.nextValue);
  const nextBytes = `${canonicalJson(request.nextValue)}\n`;
  const nextSHA256 = sha256(nextBytes);
  const stageIdentity = createExclusiveDurableFile( request.stagePath, nextBytes, request.directory, );
  const currentDescriptor = openSync( request.canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(currentDescriptor);
    const bytes = readFileSync(currentDescriptor);
    const afterRead = fstatSync(currentDescriptor);
    const rebound = lstatSync(request.canonicalPath);
    requireCondition( sameFileIdentity(opened, current.stat) && sameFileIdentity(afterRead, opened) && sameFileIdentity(rebound, opened) && opened.nlink === 1 && afterRead.nlink === 1 && rebound.nlink === 1 &&
        sha256(bytes) === request.expectedCurrentSHA256, "marker_cas_current", );
    requireExactFileIdentity(request.stagePath, stageIdentity);
    request.verifyAuthority();
    const adjacent = lstatSync(request.canonicalPath);
    requireCondition( sameFileIdentity(adjacent, opened) && adjacent.nlink === 1, "marker_cas_current", );
    renameSync(request.stagePath, request.canonicalPath);
    const oldAfterRename = fstatSync(currentDescriptor);
    requireCondition( sameFileIdentity(oldAfterRename, opened) && oldAfterRename.nlink === 0, "marker_cas_replace", );
    const visible = requireExactFileIdentity( request.canonicalPath, stageIdentity, );
    requireCondition(absent(request.stagePath), "marker_cas_replace");
    request.verifyAuthority();
    (request.fsyncDirectory ?? fsyncPath)( request.directory, request.onDurableInstall, );
    const durable = requireExactFileIdentity( request.canonicalPath, stageIdentity, );
    requireCondition( sameFileIdentity(visible, durable) && absent(request.stagePath), "marker_cas_replace", ); } finally { closeSync(currentDescriptor); }
  request.verifyAuthority();
  const next = parsePrivateJson(request.canonicalPath);
  requireCondition( next.digest === nextSHA256 && next.stat.dev === stageIdentity.device && next.stat.ino === stageIdentity.inode && next.stat.nlink === 1, "marker_cas_replace", );
  request.validateNext(next.value);
  return { sha256: nextSHA256, identity: stageIdentity }; }

function reconcileDurableCanonicalJsonTransition(request: { canonicalPath: string;
  directory: string;
  stagePath: string;
  currentValue: JsonRecord;
  currentSHA256: string;
  nextValue: JsonRecord;
  nextSHA256: string;
  verifyAuthority(): void;
  validate(value: JsonRecord): void;
  fsyncDirectory?(path: string, afterSync?: () => void): void; }): "current" | "next" { const sync = (): void => { let synchronized = false;
    try { (request.fsyncDirectory ?? fsyncPath)(request.directory, () => { synchronized = true; }); } catch (error) { if (!synchronized) throw error; }
    requireCondition(synchronized, "bridge_marker_reconciliation"); };
  request.verifyAuthority();
  const marker = parsePrivateJson(request.canonicalPath);
  request.validate(marker.value);
  const currentMatches = marker.digest === request.currentSHA256 && canonicalJson(marker.value) === canonicalJson(request.currentValue);
  const nextMatches = marker.digest === request.nextSHA256 && canonicalJson(marker.value) === canonicalJson(request.nextValue);
  requireCondition( currentMatches !== nextMatches, "bridge_marker_reconciliation", );
  if (!absent(request.stagePath, "bridge_marker_reconciliation")) { requireCondition(currentMatches, "bridge_marker_reconciliation");
    const stage = readStablePrivateFile(request.stagePath);
    const nextBytes = `${canonicalJson(request.nextValue)}\n`;
    requireCondition( stage.stat.nlink === 1 && Buffer.from(stage.bytes).equals(Buffer.from(nextBytes)) && sha256(stage.bytes) === request.nextSHA256, "bridge_marker_reconciliation", );
    requireExactFileIdentity( request.stagePath, durableIdentity(stage.stat, stage.bytes), );
    unlinkSync(request.stagePath);
    sync();
    requireCondition(absent(request.stagePath), "bridge_marker_reconciliation"); } else if (nextMatches) sync();
  request.verifyAuthority();
  const rebound = parsePrivateJson(request.canonicalPath);
  request.validate(rebound.value);
  requireCondition( rebound.digest === marker.digest && canonicalJson(rebound.value) === canonicalJson(marker.value), "bridge_marker_reconciliation", );
  return nextMatches ? "next" : "current"; }

/** @internal The exact production marker old/stage/new reconciliation kernel. */
export function reconcileDurableCanonicalJsonTransitionForTest( request: Parameters<typeof reconcileDurableCanonicalJsonTransition>[0], ): "current" | "next" { return reconcileDurableCanonicalJsonTransition(request); }

function verifyRetainedHandoffEvidence(bindings: MarkerBindings): void { const anchorPath = join( DEPLOY_STATE_DIR, `phase-b-refence-observed-526-anchor-retired-${bindings.runID}.json`, );
  const witnessPath = join( DEPLOY_STATE_DIR, `phase-b-refence-observed-526-armed-witness-retired-${bindings.runID}.json`, );
  const anchor = parsePrivateJson(anchorPath);
  const witness = parsePrivateJson(witnessPath);
  requireCondition( anchor.digest === bindings.anchorSHA256 && anchor.stat.dev === bindings.anchorDevice && anchor.stat.ino === bindings.anchorInode && anchor.stat.nlink === 1 && witness.digest === bindings.witnessSHA256 &&
      witness.stat.dev === bindings.witnessDevice && witness.stat.ino === bindings.witnessInode && witness.stat.nlink === 1, "retained_handoff_evidence", ); }

function bridgeMarkerTransitionStagePath( bindings: MarkerBindings, nextSHA256: string, ): string { return join( DEPLOY_STATE_DIR, `.phase-b-refence-marker-transition-${bindings.runID}-${nextSHA256}.tmp`, ); }

function advanceBridgeMarkerCAS(request: { bindings: MarkerBindings;
  roles: RoleMap;
  lock: DeployLockAuthority;
  expectedCurrentSHA256: string;
  nextValue: JsonRecord;
  onDurableInstall?(): void; }): { sha256: string; identity: DurableFileIdentity } { const current = parsePrivateJson(MAINTENANCE_MARKER);
  validateBridgeMarker(current.value, request.bindings, request.roles);
  validateBridgeMarker(request.nextValue, request.bindings, request.roles);
  validateDatabaseConvergenceTransition( record( current.value.database_convergence, "bridge_marker_database_convergence", ), record( request.nextValue.database_convergence, "bridge_marker_database_convergence", ), );
  maintenanceContract().validateBridgeMarkerTransition( current.value, request.nextValue, );
  const nextSHA256 = sha256(`${canonicalJson(request.nextValue)}\n`);
  return replaceDurableCanonicalJsonCAS({
    canonicalPath: MAINTENANCE_MARKER, directory: DEPLOY_STATE_DIR, stagePath: bridgeMarkerTransitionStagePath( request.bindings, nextSHA256, ), expectedCurrentSHA256: request.expectedCurrentSHA256, nextValue: request.nextValue,
    verifyAuthority: () => { verifyDeployLockAuthority(request.lock);
      verifyRetainedHandoffEvidence(request.bindings); }, validateCurrent: (value) => validateBridgeMarker(value, request.bindings, request.roles), validateNext: (value) => validateBridgeMarker(value, request.bindings, request.roles),
    onDurableInstall: request.onDurableInstall, }); }

function requireOriginalTerminalIdentity( current: TerminalEvidence, original: TerminalEvidence, ): void { requireCondition( current.receiptSHA256 === original.receiptSHA256 && current.runID === original.runID &&
      current.targetRevision === original.targetRevision && current.targetTree === original.targetTree && current.targetDistance === original.targetDistance && current.anchorSHA256 === original.anchorSHA256 &&
      current.anchorStat.dev === original.anchorStat.dev && current.anchorStat.ino === original.anchorStat.ino && current.witnessSHA256 === original.witnessSHA256 && current.witnessStat.dev === original.witnessStat.dev &&
      current.witnessStat.ino === original.witnessStat.ino && current.walInventorySHA256 === original.walInventorySHA256 && current.terminalWalSHA256 === original.terminalWalSHA256 &&
      canonicalJson(current.roles) === canonicalJson(original.roles), "handoff_original_identity", ); }

export function completeHandoff( evidence: TerminalEvidence, bindings: MarkerBindings, nonImageConfigSHA256: string, preparation: ControllerPreparationBinding, verifyLock: () => void, crashAfter?: HandoffEdge, ): HandoffCompletion {
  requirePrivateDirectory(STATE_DIR);
  requirePrivateDirectory(DEPLOY_STATE_DIR);
  requireCondition(validSha(nonImageConfigSHA256), "handoff_config_binding");
  verifyLock();
  let current = evidence;
  requireOriginalTerminalIdentity(current, evidence);
  if (["H1", "H2", "H3"].includes(current.edge)) { requireCondition( parsePrivateJson(handoffStagePath(current.runID)).value .non_image_config_sha256 === nonImageConfigSHA256, "handoff_config_binding", );
  } else if (["H4", "H5"].includes(current.edge)) { requireCondition( parsePrivateJson(MAINTENANCE_MARKER).value.non_image_config_sha256 === nonImageConfigSHA256, "handoff_config_binding", ); }
  const refresh = (): HandoffEdge => { verifyLock();
    current = classifyHandoff( bindings.receiptSHA256, bindings.targetRevision, bindings.targetTree, bindings.rolloutID, );
    requireOriginalTerminalIdentity(current, evidence);
    return current.edge; };
  const markerDocument = initialBridgeMarker( bindings, current.roles, nonImageConfigSHA256, preparation, );
  const ceremony = performHandoffCeremony({ initialEdge: current.edge, paths: { anchor: MAINTENANCE_MARKER, witness: ARMED_WITNESS, anchorArchive: current.anchorArchivePath, witnessArchive: current.witnessArchivePath,
      stage: handoffStagePath(current.runID), directory: DEPLOY_STATE_DIR, }, markerBytes: `${canonicalJson(markerDocument)}\n`, refresh, crashAfter, });
  verifyLock();
  requireOriginalTerminalIdentity(current, evidence);
  const markerFile = parsePrivateJson(MAINTENANCE_MARKER);
  const anchorArchive = lstatSync(current.anchorArchivePath);
  const witnessArchive = lstatSync(current.witnessArchivePath);
  requireCondition(ceremony.edge === "H5", "handoff_not_complete");
  return { ...ceremony, anchor: { archive_inode: anchorArchive.ino, archive_device: anchorArchive.dev, archive_nlink: anchorArchive.nlink, original_inode: evidence.anchorStat.ino, original_device: evidence.anchorStat.dev,
      sha256: evidence.anchorSHA256, }, marker: { inode: markerFile.stat.ino, device: markerFile.stat.dev, nlink: markerFile.stat.nlink, sha256: markerFile.digest, }, witness: { archive_inode: witnessArchive.ino,
      archive_device: witnessArchive.dev, archive_nlink: witnessArchive.nlink, original_inode: evidence.witnessStat.ino, original_device: evidence.witnessStat.dev, sha256: evidence.witnessSHA256, }, }; }

export interface HandoffCeremonyPaths { anchor: string;
  witness: string;
  anchorArchive: string;
  witnessArchive: string;
  stage: string;
  directory: string; }

export interface HandoffCeremonyResult { edge: "H5";
  resumed_from: HandoffEdge;
  verified_edges: HandoffEdge[]; }

export interface HandoffCompletion extends HandoffCeremonyResult { anchor: { archive_inode: number;
    archive_device: number;
    archive_nlink: number;
    original_inode: number;
    original_device: number;
    sha256: string; };
  marker: { inode: number; device: number; nlink: number; sha256: string };
  witness: { archive_inode: number;
    archive_device: number;
    archive_nlink: number;
    original_inode: number;
    original_device: number;
    sha256: string; }; }

function requireCeremonyFileIdentity( path: string, expectedBytes: string, expectedIdentity?: Pick<Stats, "dev" | "ino">, ): Stats { const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === 0o600 &&
      before.size === Buffer.byteLength(expectedBytes), "handoff_stage_identity", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && after.dev === opened.dev && after.ino === opened.ino && after.size === opened.size && after.nlink === opened.nlink &&
        rebound.isFile() && !rebound.isSymbolicLink() && rebound.dev === opened.dev && rebound.ino === opened.ino && rebound.size === opened.size && rebound.nlink === opened.nlink &&
        rebound.uid === opened.uid && rebound.gid === opened.gid && (rebound.mode & 0o777) === 0o600 && bytes.byteLength === opened.size && decode(bytes, "handoff_stage_identity") === expectedBytes && (expectedIdentity === undefined ||
          (opened.dev === expectedIdentity.dev && opened.ino === expectedIdentity.ino)), "handoff_stage_identity", );
    return opened; } finally { closeSync(descriptor); } }

/** @internal Shared verbatim by production handoff and contained crash tests. */
export function performHandoffCeremony(request: { initialEdge: HandoffEdge;
  paths: HandoffCeremonyPaths;
  markerBytes: string;
  refresh(): HandoffEdge;
  crashAfter?: HandoffEdge;
  crashAt?: HandoffCrashPoint;
  /** @internal Contained race injection only; production never supplies it. */
  afterStageOpenForTest?: (descriptor: number, opened: Stats) => void; }): HandoffCeremonyResult { const verifiedEdges: HandoffEdge[] = [];
  const expectEdge = (expected: HandoffEdge): void => { requireCondition(request.refresh() === expected, "handoff_transition");
    verifiedEdges.push(expected);
    if (request.crashAfter === expected) refuse("injected_handoff_crash"); };
  let edge = request.initialEdge;
  requireCondition(request.refresh() === edge, "handoff_transition");
  // A recovered visible half-edge may be the result of a kill between its
  // namespace mutation and directory fsync.  Durably establish exactly the
  // observed edge before advancing it.
  fsyncPath(request.paths.directory);
  requireCondition(request.refresh() === edge, "handoff_transition");
  verifiedEdges.push(edge);
  if (request.crashAfter === edge) refuse("injected_handoff_crash");
  let stageIdentity: Stats | null = ["H1", "H2", "H3"].includes(edge) ? requireCeremonyFileIdentity(request.paths.stage, request.markerBytes) : null;
  if (edge === "H0") { const descriptor = openSync( request.paths.stage, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW, 0o600, );
    try { const opened = fstatSync(descriptor);
      requireCondition( opened.isFile() && opened.uid === process.getuid?.() && opened.nlink === 1 && opened.size === 0, "handoff_stage_identity", );
      request.afterStageOpenForTest?.(descriptor, opened);
      fchownSync(descriptor, process.getuid!(), process.getgid!());
      fchmodSync(descriptor, 0o600);
      const prepared = fstatSync(descriptor);
      requireCondition( prepared.isFile() && prepared.dev === opened.dev && prepared.ino === opened.ino && prepared.uid === opened.uid && prepared.gid === process.getgid?.() && prepared.nlink === 1 &&
          prepared.size === 0 && (prepared.mode & 0o777) === 0o600, "handoff_stage_identity", );
      writeFileSync(descriptor, request.markerBytes);
      fsyncSync(descriptor);
      const written = fstatSync(descriptor);
      requireCondition( written.isFile() && written.dev === prepared.dev && written.ino === prepared.ino && written.uid === prepared.uid && written.gid === prepared.gid && written.nlink === 1 &&
          written.size === Buffer.byteLength(request.markerBytes) && (written.mode & 0o777) === 0o600, "handoff_stage_identity", ); } finally { closeSync(descriptor); }
    stageIdentity = requireCeremonyFileIdentity( request.paths.stage, request.markerBytes, );
    requireCondition(request.refresh() === "H1", "handoff_transition");
    if (request.crashAt === "H1_file_fsynced_before_directory_fsync") { refuse("injected_handoff_crash"); }
    fsyncPath(request.paths.directory);
    edge = "H1";
    expectEdge(edge); }
  if (edge === "H1") { stageIdentity = requireCeremonyFileIdentity( request.paths.stage, request.markerBytes, stageIdentity ?? undefined, );
    requireCondition(request.refresh() === "H1", "handoff_transition");
    linkSync(request.paths.anchor, request.paths.anchorArchive);
    requireCondition(request.refresh() === "H2", "handoff_transition");
    if (request.crashAt === "H2_linked_before_directory_fsync") { refuse("injected_handoff_crash"); }
    fsyncPath(request.paths.directory);
    edge = "H2";
    expectEdge(edge); }
  if (edge === "H2") { stageIdentity = requireCeremonyFileIdentity( request.paths.stage, request.markerBytes, stageIdentity ?? undefined, );
    requireCondition(request.refresh() === "H2", "handoff_transition");
    linkSync(request.paths.witness, request.paths.witnessArchive);
    requireCondition(request.refresh() === "H3", "handoff_transition");
    if (request.crashAt === "H3_linked_before_directory_fsync") { refuse("injected_handoff_crash"); }
    fsyncPath(request.paths.directory);
    edge = "H3";
    expectEdge(edge); }
  if (edge === "H3") { // This refresh is intentionally adjacent to the linearizing rename.
    requireCondition(request.refresh() === "H3", "handoff_transition");
    stageIdentity = requireCeremonyFileIdentity( request.paths.stage, request.markerBytes, stageIdentity ?? undefined, );
    renameSync(request.paths.stage, request.paths.anchor);
    requireCondition(request.refresh() === "H4", "handoff_transition");
    if (request.crashAt === "H4_renamed_before_directory_fsync") { refuse("injected_handoff_crash"); }
    fsyncPath(request.paths.directory);
    edge = "H4";
    expectEdge(edge);
    requireCeremonyFileIdentity( request.paths.anchor, request.markerBytes, stageIdentity, ); }
  if (edge === "H4") { requireCondition(request.refresh() === "H4", "handoff_transition");
    unlinkSync(request.paths.witness);
    requireCondition(request.refresh() === "H5", "handoff_transition");
    if (request.crashAt === "H5_unlinked_before_directory_fsync") { refuse("injected_handoff_crash"); }
    fsyncPath(request.paths.directory);
    edge = "H5";
    expectEdge(edge); }
  requireCondition(edge === "H5", "handoff_not_complete");
  return { edge, resumed_from: request.initialEdge, verified_edges: verifiedEdges, }; }

export interface DatabaseProof { source_inventory_sha256: string;
  journal_file_count: number;
  journal_endpoint_count: 2;
  journal_observation_count: 4;
  journal_inventory_sha256: string;
  target_migration_applied_at: [string, string];
  migration_definitions_verified: boolean;
  migration_data_verified: boolean;
  remainder_affected_count: number;
  federation_disabled: boolean;
  federation_instance_url_sha256: string;
  federation_updated_at: string;
  durable_hold: boolean;
  allowed_origins_count: number;
  reserved_generation_rows: number;
  authoritative_v2_rows: number;
  received_v1_rows: number;
  drain_sample_count: 3;
  drain_informational: { payout_requested: number; x402_inserted: number };
  drain_zero: boolean;
  cron_sha256: string;
  database_target_sha256: string;
  producer_authority: { source_migrations: SourceMigration[];
    terminal_journal: { transaction: ProducerJournalProof;
      session: ProducerJournalProof; };
    terminal_drain_snapshots: ProducerDrainSnapshot[]; }; }

interface ProducerJournalRow { filename: string;
  checksum: string;
  applied_at: string; }

interface ProducerJournalProof { rows: ProducerJournalRow[];
  targetAppliedAt: [string, string]; }

interface ProducerDrainSnapshot { counts: Record<string, number>;
  informational: { payout_requested: number; x402_inserted: number };
  cron_sha256: string; }

interface KeychainProof { generation_absent: true;
  machine_map_sha256: string;
  roles: RoleMap; }

interface ProcessProof { conflicting_process_count: 0;
  projection_sha256: string; }

interface GitProof { revision: string;
  tree: string;
  source_distance: number;
  bridge_source_sha256: string;
  clean: boolean; }

export interface MaintenanceRefenceDependencies { readDatabaseProof(): Promise<unknown>;
  readProviderSecretInventory(): Promise<unknown>;
  readKeychainProof(): Promise<unknown>;
  readProcessProof(): Promise<unknown>;
  readGitProof(): Promise<unknown>;
  readFleetInventory(): Promise<unknown>;
  pause(milliseconds: number): Promise<void>;
  close(): Promise<void>; }

interface PreparedMaintenanceRefenceDependencies
  extends MaintenanceRefenceDependencies { readonly controllerPhase: "pre_handoff_prepared";
  sealChildLaunchersForHandoff(): ChildlessMaintenanceRefenceBase; }

interface ChildlessMaintenanceRefenceBase { readonly controllerPhase: "post_handoff_childless";
  readDatabaseProof(): Promise<unknown>;
  convergeFederationInstanceURL(): Promise<DatabaseOriginConvergenceProof>;
  takeOrdinaryPostflightDatabaseEnvironment(): Readonly<{ DATABASE_URL: string;
    DATABASE_SESSION_URL: string; }>;
  pause(milliseconds: number): Promise<void>;
  close(): Promise<void>; }

export interface DatabaseOriginConvergenceProof { schema: "agenttool-phase-b-refence-database-origin-convergence/v1";
  statement_sha256: string;
  database_target_sha256: string;
  before_row_sha256: string;
  after_row_sha256: string;
  unchanged_projection_sha256: string;
  delta_sha256: string;
  before_instance_url_sha256: typeof PRE_REFENCE_INSTANCE_URL_SHA256;
  after_instance_url_sha256: typeof TARGET_INSTANCE_URL_SHA256;
  before_updated_at: typeof EXPECTED_FEDERATION_UPDATED_AT;
  after_updated_at: string;
  clock_before: string;
  clock_after: string;
  database_write_attempt_count: 1;
  rows_updated: 1;
  commit_acknowledged: true;
  commit_ambiguity: false;
  rollback_attempt_count: 0; }

/** @internal Carries a definite commit through later close/signal failures. */
export class DatabaseConvergenceAcknowledgedError extends Error { readonly code: string;
  readonly proof: DatabaseOriginConvergenceProof;

  constructor(code: string, proof: DatabaseOriginConvergenceProof) { super(code);
    this.name = "DatabaseConvergenceAcknowledgedError";
    this.code = code;
    this.proof = proof; } }

export function validateDatabaseOriginConvergenceForTest( proof: DatabaseOriginConvergenceProof, before: DatabaseProof, after: DatabaseProof, ): { beforeProofSHA256: string; afterProofSHA256: string } {
  return maintenanceContract().validateDatabaseOriginConvergence( proof, before, after, ); }

function validateDatabaseProof( raw: unknown, evidence: TerminalEvidence, expectedOrigin: { instanceURLSHA256: string;
    updatedAt: string; }, ): DatabaseProof { return maintenanceContract().validateDatabaseProof( raw, evidence, expectedOrigin, ); }

function validateDatabaseConvergenceInheritedProof( raw: unknown, ): DatabaseProof { return maintenanceContract().validateDatabaseConvergenceInheritedProof(raw); }

function validateProviderAbsence(raw: unknown): string { requireCondition(Array.isArray(raw) && raw.length <= 1_024, "provider_shape");
  let generationMatches = 0;
  let redisMatches = 0;
  for (const entry of raw) { const value = record(entry, "provider_shape");
    const upper = Object.prototype.hasOwnProperty.call(value, "Name");
    const lower = Object.prototype.hasOwnProperty.call(value, "name");
    requireCondition(upper !== lower, "provider_shape");
    const name = upper ? value.Name : value.name;
    requireCondition( typeof name === "string" && name.length <= 256, "provider_shape", );
    if (name === GENERATION_PROVIDER_SECRET) generationMatches += 1;
    if (name === "REDIS_URL") redisMatches += 1; }
  requireCondition( generationMatches === 0 && redisMatches === 0, "provider_generation_present", );
  return sha256(canonicalJson(raw)); }

function validateKeychainProof(raw: unknown, roles: RoleMap): KeychainProof { exactKeys( raw, ["generation_absent", "machine_map_sha256", "roles"], "keychain_proof", );
  const value = raw as KeychainProof;
  requireCondition( value.generation_absent === true && value.machine_map_sha256 === MACHINE_MAP_SHA256 && canonicalJson(validateRoles(value.roles)) === canonicalJson(roles), "keychain_proof", );
  return value; }

function validateProcessProof(raw: unknown): ProcessProof { exactKeys( raw, ["conflicting_process_count", "projection_sha256"], "process_proof", );
  const value = raw as ProcessProof;
  requireCondition( value.conflicting_process_count === 0 && validSha(value.projection_sha256), "process_proof", );
  return value; }

function validateGitProof(raw: unknown, evidence: TerminalEvidence): GitProof { exactKeys( raw, ["revision", "tree", "source_distance", "bridge_source_sha256", "clean"], "git_proof", );
  const value = raw as GitProof;
  requireCondition( value.revision === evidence.targetRevision && value.tree === evidence.targetTree && value.source_distance === evidence.targetDistance && value.bridge_source_sha256 === evidence.bridgeRawSHA256 && value.clean === true,
    "git_proof", );
  return value; }

export interface StoppedFleetProof { fingerprint: string;
  nonImageConfigSHA256: string; }

function validateStoppedFleet( raw: unknown, evidence: TerminalEvidence, ): StoppedFleetProof { const proof = maintenanceContract().validateStoppedFleet(raw, evidence);
  requireCondition( Array.isArray(raw) && raw.every((entry) => isRecord(entry) && validUtcTimestamp(entry.updated_at) ), "fleet_contract", );
  return proof; }

/** @internal Rebuilds the producer's immutable admission contract. */
export function producerCriticalContractSHA256ForTest( source: readonly SourceMigration[], evidence: TerminalEvidence, ): string { return maintenanceContract().producerCriticalContractSHA256( source, evidence,
    PRODUCER_CRITICAL_STATIC_CONTRACT, ); }

/** @internal Exact pre-H1 rebind of the four producer runtime commitments. */
export function validateProducerEarlyRuntimeBindingsForTest(request: { evidence: TerminalEvidence;
  databaseProof: DatabaseProof;
  firstFleet: StoppedFleetProof;
  secondFleet: StoppedFleetProof; }): string { return maintenanceContract().validateProducerEarlyRuntimeBindings({ ...request, staticContract: PRODUCER_CRITICAL_STATIC_CONTRACT, }); }

export interface TargetImageContract { tag: string;
  digest: string;
  revision: string; }

export interface TargetFleetExpectation { targetImageMachineIDs: readonly string[];
  restartRestoredMachineIDs: readonly string[];
  autostartEnabledAppMachineIDs: readonly string[];
  startedMachineIDs: readonly string[];
  uncordonedAppMachineIDs: readonly string[]; }

export type ControllerFlyOperation = | { kind: "build_push"; imageTag: string; revision: string }
  | { kind: "update_image"; machineID: string; imageReference: string }
  | { kind: "restore_app"; machineID: string }
  | { kind: "enable_autostart"; machineID: string }
  | { kind: "restore_primary"; machineID: string }
  | { kind: "restore_standby"; machineID: string; primaryID: string }
  | { kind: "start"; machineID: string }
  | { kind: "wait_started"; machineID: string }
  | { kind: "cordon"; machineID: string }
  | { kind: "uncordon"; machineID: string }
  | { kind: "refence_app"; machineID: string }
  | { kind: "refence_primary"; machineID: string }
  | { kind: "refence_standby"; machineID: string }
  | { kind: "stop"; machineID: string }
  | { kind: "list" }
  | { kind: "secrets" };

function requireTargetFleetExpectation( evidence: TerminalEvidence, expectation: TargetFleetExpectation, ): void { maintenanceContract().validateTargetFleetExpectation(evidence, expectation); }

/** @internal Shared by the production controller and contained topology tests. */
export function validateTargetFleetForTest( raw: unknown, evidence: TerminalEvidence, image: TargetImageContract, expectation: TargetFleetExpectation, ): string { return maintenanceContract().validateTargetFleet( raw, evidence, image,
    expectation, ); }

function localEvidenceFingerprint(evidence: TerminalEvidence): string { return sha256(canonicalJson({ receipt_sha256: evidence.receiptSHA256, run_id: evidence.runID, anchor_sha256: evidence.anchorSHA256,
    witness_sha256: evidence.witnessSHA256, wal_inventory_sha256: evidence.walInventorySHA256, terminal_wal_sha256: evidence.terminalWalSHA256, source_inventory_sha256: evidence.sourceInventorySHA256,
    journal_inventory_sha256: evidence.journalInventorySHA256, cron_sha256: evidence.cronSHA256, image_contract_sha256: sha256(canonicalJson(evidence.imageContract)), bridge_raw_sha256: evidence.bridgeRawSHA256,
    bridge_normalized_sha256: evidence.bridgeNormalizedSHA256, edge: evidence.edge, })); }

export interface MaintenanceRefenceProof { anchor_sha256: string;
  audit_witness_sha256: string;
  authority_sandwich_sha256: string;
  authority_verified: true;
  bridge_normalized_sha256: string;
  bridge_source_sha256: string;
  checkpoint: Checkpoint;
  database_journal_verified: true;
  database_instance_url_sha256: string;
  database_federation_updated_at: string;
  database_target_sha256: string;
  drain_sample_count: 3;
  drain_verified: true;
  fence_sample_count: 2;
  fence_sample_sha256: string;
  fence_verified: true;
  fenced_image_digest: typeof EXPECTED_IMAGE_DIGEST;
  fenced_image_tag: typeof EXPECTED_IMAGE_TAG;
  journal_endpoint_count: 2;
  journal_inventory_sha256: string;
  journal_observation_count: 4;
  local_evidence_verified: true;
  machine_set_sha256: typeof EXPECTED_MACHINE_SET_SHA256;
  non_image_config_sha256: string;
  observed_revision: typeof EXPECTED_SOURCE_REVISION;
  process_census_sha256: string;
  process_census_verified: true;
  provider_inventory_sha256: string;
  provider_secret_status: "Absent";
  public_surfaces_expected_unavailable: true;
  public_surfaces_verified: false;
  receipt_sha256: string;
  refence_run_id: string;
  schema: typeof MAINTENANCE_REFENCE_PROOF_SCHEMA;
  source_inventory_sha256: string;
  stable_fleet_sha256: string;
  state: "maintenance_refence";
  target_revision: string;
  target_tree: string;
  terminal_wal_sha256: string;
  wal_inventory_sha256: string;
  witness_sha256: string; }

export interface MaintenanceRefenceGuardRequest { checkpoint: Checkpoint;
  receiptSHA256: string;
  targetRevision: string;
  targetTree: string;
  rolloutID: string;
  expectedDatabaseUpdatedAt?: string; }

async function runMaintenanceRefenceGuardCore( request: MaintenanceRefenceGuardRequest, dependencies: MaintenanceRefenceDependencies, readEvidence: () => TerminalEvidence | Promise<TerminalEvidence>, closeAfter = true, ): Promise<{
  proof: MaintenanceRefenceProof;
  evidence: TerminalEvidence;
  nonImageConfigSHA256: string;
  databaseProof: DatabaseProof;
  databaseProofSHA256: string; }> { requireCondition( validSha(request.receiptSHA256) && validRevision(request.targetRevision) && validRevision(request.targetTree) &&
      /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/.test( request.rolloutID, ), "invalid_invocation", );
  try { const localBefore = await readEvidence();
    const expectedUpdatedAt = request.checkpoint === "early" ? EXPECTED_FEDERATION_UPDATED_AT : request.expectedDatabaseUpdatedAt;
    requireCondition( typeof expectedUpdatedAt === "string" && validUtcTimestamp(expectedUpdatedAt) && (request.checkpoint === "early" || utcTimestampOrderKey(expectedUpdatedAt) >
            utcTimestampOrderKey(EXPECTED_FEDERATION_UPDATED_AT)), "maintenance_refence_database_origin", );
    const expectedOrigin = { instanceURLSHA256: request.checkpoint === "early" ? PRE_REFENCE_INSTANCE_URL_SHA256 : TARGET_INSTANCE_URL_SHA256, updatedAt: expectedUpdatedAt, };
    const gitBefore = validateGitProof( await dependencies.readGitProof(), localBefore, );
    const databaseBefore = validateDatabaseProof( await dependencies.readDatabaseProof(), localBefore, expectedOrigin, );
    const providerBefore = validateProviderAbsence( await dependencies.readProviderSecretInventory(), );
    const keychainBefore = validateKeychainProof( await dependencies.readKeychainProof(), localBefore.roles, );
    const processBefore = validateProcessProof( await dependencies.readProcessProof(), );
    const firstFleet = validateStoppedFleet( await dependencies.readFleetInventory(), localBefore, );
    await dependencies.pause(FLEET_INTERVAL_MS);
    const secondFleet = validateStoppedFleet( await dependencies.readFleetInventory(), localBefore, );
    const processAfter = validateProcessProof( await dependencies.readProcessProof(), );
    const keychainAfter = validateKeychainProof( await dependencies.readKeychainProof(), localBefore.roles, );
    const providerAfter = validateProviderAbsence( await dependencies.readProviderSecretInventory(), );
    const databaseAfter = validateDatabaseProof( await dependencies.readDatabaseProof(), localBefore, expectedOrigin, );
    const gitAfter = validateGitProof( await dependencies.readGitProof(), localBefore, );
    const localAfter = await readEvidence();
    requireCondition( canonicalJson(firstFleet) === canonicalJson(secondFleet) && canonicalJson(databaseBefore) === canonicalJson(databaseAfter) && databaseAfter.federation_instance_url_sha256 === expectedOrigin.instanceURLSHA256 &&
        databaseAfter.federation_updated_at === expectedOrigin.updatedAt && canonicalJson(gitBefore) === canonicalJson(gitAfter) && providerBefore === providerAfter && canonicalJson(keychainBefore) === canonicalJson(keychainAfter) &&
        canonicalJson(processBefore) === canonicalJson(processAfter) && localEvidenceFingerprint(localBefore) === localEvidenceFingerprint(localAfter), "maintenance_refence_drift", );
    if (request.checkpoint === "early") { validateProducerEarlyRuntimeBindingsForTest({ evidence: localAfter, databaseProof: databaseAfter, firstFleet, secondFleet, }); }
    const authoritySandwichSHA256 = sha256(canonicalJson({ database_after: databaseAfter, database_before: databaseBefore, fleet_first: firstFleet, fleet_second: secondFleet, git_after: gitAfter, git_before: gitBefore,
      keychain_after: keychainAfter, keychain_before: keychainBefore, local_after: localEvidenceFingerprint(localAfter), local_before: localEvidenceFingerprint(localBefore), process_after: processAfter, process_before: processBefore,
      provider_after: providerAfter, provider_before: providerBefore, }));
    const auditEvidence = record( localAfter.receipt.audit_evidence, "receipt_audit", );
    return { databaseProof: databaseAfter, databaseProofSHA256: sha256(canonicalJson(databaseAfter)), evidence: localAfter, nonImageConfigSHA256: secondFleet.nonImageConfigSHA256, proof: { anchor_sha256: localAfter.anchorSHA256,
        audit_witness_sha256: auditEvidence.witness_sha256, authority_sandwich_sha256: authoritySandwichSHA256, authority_verified: true, bridge_normalized_sha256: localAfter.bridgeNormalizedSHA256,
        bridge_source_sha256: localAfter.bridgeRawSHA256, checkpoint: request.checkpoint, database_federation_updated_at: databaseAfter.federation_updated_at, database_instance_url_sha256: databaseAfter.federation_instance_url_sha256,
        database_journal_verified: true, database_target_sha256: databaseAfter.database_target_sha256, drain_sample_count: 3, drain_verified: true, fence_sample_count: 2, fence_sample_sha256: sha256(canonicalJson([ firstFleet.fingerprint,
          secondFleet.fingerprint, ])), fence_verified: true, fenced_image_digest: EXPECTED_IMAGE_DIGEST, fenced_image_tag: EXPECTED_IMAGE_TAG, journal_endpoint_count: 2, journal_inventory_sha256: databaseAfter.journal_inventory_sha256,
        journal_observation_count: 4, local_evidence_verified: true, machine_set_sha256: EXPECTED_MACHINE_SET_SHA256, non_image_config_sha256: secondFleet.nonImageConfigSHA256, observed_revision: EXPECTED_SOURCE_REVISION,
        process_census_sha256: processAfter.projection_sha256, process_census_verified: true, provider_inventory_sha256: providerAfter, provider_secret_status: "Absent", public_surfaces_expected_unavailable: true,
        public_surfaces_verified: false, receipt_sha256: request.receiptSHA256, refence_run_id: localAfter.runID, schema: MAINTENANCE_REFENCE_PROOF_SCHEMA, source_inventory_sha256: databaseAfter.source_inventory_sha256,
        stable_fleet_sha256: secondFleet.fingerprint, state: "maintenance_refence", target_revision: request.targetRevision, target_tree: request.targetTree, terminal_wal_sha256: localAfter.terminalWalSHA256,
        wal_inventory_sha256: localAfter.walInventorySHA256, witness_sha256: localAfter.witnessSHA256, }, }; } finally { if (closeAfter) await dependencies.close(); } }

export async function runMaintenanceRefenceGuard( request: MaintenanceRefenceGuardRequest, dependencies: MaintenanceRefenceDependencies, ): Promise<{ proof: MaintenanceRefenceProof;
  evidence: TerminalEvidence;
  nonImageConfigSHA256: string;
  databaseProof: DatabaseProof;
  databaseProofSHA256: string; }> { return runMaintenanceRefenceGuardCore( request, dependencies, () => classifyHandoff( request.receiptSHA256, request.targetRevision, request.targetTree, request.rolloutID, ), ); }

/** @internal Uses the production sandwich with a contained evidence reader. */
export async function runMaintenanceRefenceGuardCoreForTest( request: MaintenanceRefenceGuardRequest, dependencies: MaintenanceRefenceDependencies, readEvidence: () => TerminalEvidence | Promise<TerminalEvidence>, ): Promise<{
  proof: MaintenanceRefenceProof;
  evidence: TerminalEvidence;
  nonImageConfigSHA256: string;
  databaseProof: DatabaseProof;
  databaseProofSHA256: string; }> { return runMaintenanceRefenceGuardCore(request, dependencies, readEvidence); }

async function runMaintenanceRefenceGuardForController( request: MaintenanceRefenceGuardRequest, dependencies: MaintenanceRefenceDependencies, ): Promise<{ proof: MaintenanceRefenceProof;
  evidence: TerminalEvidence;
  nonImageConfigSHA256: string;
  databaseProof: DatabaseProof;
  databaseProofSHA256: string; }> { return runMaintenanceRefenceGuardCore( request, dependencies, () => classifyHandoff( request.receiptSHA256, request.targetRevision, request.targetTree, request.rolloutID, ), false, ); }

export function serializeMaintenanceRefenceProof( proof: MaintenanceRefenceProof, ): string { const keys = Object.keys(proof);
  requireCondition( keys.every((key, index) => index === 0 || keys[index - 1] < key), "proof_key_order", );
  return `${JSON.stringify(proof)}\n`; }

export function expectedOrdinaryAbsentPostflightBytes( targetRevision: string, ): string { return maintenanceContract().expectedOrdinaryAbsentPostflightBytes( targetRevision, ); }

/** @internal Exact-byte validator for the unchanged ordinary guard child. */
export function validateOrdinaryAbsentPostflightBytesForTest( bytes: Uint8Array, targetRevision: string, ): string { const expected = expectedOrdinaryAbsentPostflightBytes(targetRevision);
  requireCondition( bytes.byteLength === Buffer.byteLength(expected) && Buffer.from(bytes).equals(Buffer.from(expected, "utf8")), "ordinary_postflight_proof", );
  return sha256(bytes); }

export interface ControllerStoppedFenceProof extends JsonRecord { schema: "agenttool-phase-b-refence-target-stopped-fence/v1";
  checkpoint: "post_build" | "recovery_terminal";
  stable_fleet_sha256: string;
  fence_verified: true; }

export interface ControllerCordonedRuntimeProof extends JsonRecord { schema: "agenttool-phase-b-refence-cordoned-runtime/v1";
  stable_fleet_sha256: string;
  cordon_verified: true; }

export interface ControllerPublicJsonObservation { body: unknown;
  bodyByteCount: number;
  bodySha256: string;
  cacheControl: string | null;
  contentType: string;
  finalURL: string;
  observationStartedAtUnixMs: number;
  observationSettledAtUnixMs: number;
  redirected: false;
  status: 200; }

export interface ControllerPublicGateEvent { kind: string;
  proof_sha256: string | null;
  milliseconds: number | null; }

/** @internal Exact pinned-Bun public-observation child argv. */
export function controllerPublicHTTPArgvForTest(url: string): string[] { requireCondition( (url === PUBLIC_HEALTH_URL || url === PUBLIC_FEDERATION_ABOUT_URL) && Buffer.byteLength(PUBLIC_HTTP_PROGRAM) <= 4_096 &&
      !/[\0\r\n]/.test(PUBLIC_HTTP_PROGRAM), "controller_public_argv", );
  return [ PINNED_BUN, "--no-install", "--no-env-file", "--config=/dev/null", "--cwd=/", "-e", PUBLIC_HTTP_PROGRAM, "--", url, ]; }

/** @internal Exact canonical child-output decoder with no synthetic fallback. */
export function parseControllerPublicObservationForTest( bytes: Uint8Array, ): ControllerPublicJsonObservation { return maintenanceContract().parsePublicObservation(bytes); }

/** @internal Strict target-aware health projection. */
export function validateControllerPublicHealthForTest( observation: ControllerPublicJsonObservation, targetRevision: string, ): string { return maintenanceContract().validatePublicHealth( observation, targetRevision, ); }

/** @internal Strict target-origin federation-about projection. */
export function validateControllerPublicFederationAboutForTest( observation: ControllerPublicJsonObservation, ): string { return maintenanceContract().validatePublicFederationAbout(observation); }

/** @internal Exact one-canary three-round public trace validator. */
export function validateControllerFirstCanaryPublicForTest(request: { targetRevision: string;
  events: readonly ControllerPublicGateEvent[]; }): JsonRecord { return maintenanceContract().validateFirstCanaryPublic(request); }

/** @internal Exact indivisible final local-public-DB-local sandwich. */
export function validateControllerFinalAuthorityForTest(request: { targetRevision: string;
  targetTree: string;
  expectedDatabaseUpdatedAt: string;
  databaseInstanceURLSHA256: string;
  databaseUpdatedAt: string;
  databaseTargetSHA256: string;
  events: readonly ControllerPublicGateEvent[]; }): { publicProof: JsonRecord; authorityProof: JsonRecord } { return maintenanceContract().validateFinalAuthority(request); }

export interface ControllerFirstCanaryPublicDependencies { readFleetInventory(): unknown | Promise<unknown>;
  readPublicJson( url: typeof PUBLIC_HEALTH_URL | typeof PUBLIC_FEDERATION_ABOUT_URL, checkpoint: string, ): Promise<ControllerPublicJsonObservation>;
  pause(milliseconds: number): Promise<void>; }

/** @internal Exact fleet-(H,A)x3-fleet canary gate; all I/O is injected. */
export async function runControllerFirstCanaryPublicCoreForTest(request: { evidence: TerminalEvidence;
  image: TargetImageContract;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  dependencies: ControllerFirstCanaryPublicDependencies; }): Promise<JsonRecord> { return maintenanceContract().runFirstCanaryPublicCore({ evidence: request.evidence, expectation: request.expectation,
    expectedFleetSHA256: request.expectedFleetSHA256, dependencies: { readFleetProof: async () => validateTargetFleetForTest( await request.dependencies.readFleetInventory(), request.evidence, request.image, request.expectation, ),
      readPublicJson: (url: string, checkpoint: string) => request.dependencies.readPublicJson( url as typeof PUBLIC_HEALTH_URL | typeof PUBLIC_FEDERATION_ABOUT_URL, checkpoint, ),
      pause: (milliseconds: number) => request.dependencies.pause(milliseconds), }, }); }

export interface ControllerFinalAuthorityDependencies { readEvidence(): TerminalEvidence | Promise<TerminalEvidence>;
  readGitProof(): Promise<unknown>;
  readKeychainProof(): Promise<unknown>;
  readProviderSecretInventory(): Promise<unknown>;
  readDeployedProcessProof(checkpoint: string): Promise<string>;
  readFleetInventory(): Promise<unknown>;
  readPublicJson( url: typeof PUBLIC_HEALTH_URL | typeof PUBLIC_FEDERATION_ABOUT_URL, checkpoint: string, ): Promise<ControllerPublicJsonObservation>;
  readDatabaseProof(): Promise<unknown>; }

/** @internal Exact indivisible local-(H,A,DB,A,H)-local final gate. */
export async function runControllerFinalAuthorityCoreForTest(request: { evidence: TerminalEvidence;
  image: TargetImageContract;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  expectedDatabaseUpdatedAt: string;
  dependencies: ControllerFinalAuthorityDependencies; }): Promise<{ publicProofSHA256: string; authorityProofSHA256: string }> { const readEvidenceProof = async (): Promise<string> => {
    const evidence = await request.dependencies.readEvidence();
    requireOriginalTerminalIdentity(evidence, request.evidence);
    requireCondition(evidence.edge === "H5", "controller_final_evidence");
    return localEvidenceFingerprint(evidence); };
  return maintenanceContract().runFinalAuthorityCore({
    evidence: request.evidence, expectation: request.expectation, expectedFleetSHA256: request.expectedFleetSHA256, expectedDatabaseUpdatedAt: request.expectedDatabaseUpdatedAt, dependencies: { readEvidenceProof, readGitProof: async () =>
        sha256(canonicalJson(validateGitProof( await request.dependencies.readGitProof(), request.evidence, ))), readKeychainProof: async () => sha256(canonicalJson(validateKeychainProof( await request.dependencies.readKeychainProof(),
          request.evidence.roles, ))), readProviderProof: async () => validateProviderAbsence( await request.dependencies.readProviderSecretInventory(), ), readProcessProof: (checkpoint: string) =>
        request.dependencies.readDeployedProcessProof(checkpoint), readFleetProof: async () => validateTargetFleetForTest( await request.dependencies.readFleetInventory(), request.evidence, request.image, request.expectation, ),
      readPublicJson: (url: string, checkpoint: string) => request.dependencies.readPublicJson( url as typeof PUBLIC_HEALTH_URL | typeof PUBLIC_FEDERATION_ABOUT_URL, checkpoint, ), readDatabaseProof: async () => {
        const proof = validateDatabaseProof( await request.dependencies.readDatabaseProof(), request.evidence, { instanceURLSHA256: TARGET_INSTANCE_URL_SHA256, updatedAt: request.expectedDatabaseUpdatedAt, }, );
        return { proofSHA256: sha256(canonicalJson(proof)), instanceURLSHA256: proof.federation_instance_url_sha256, updatedAt: proof.federation_updated_at, targetSHA256: proof.database_target_sha256, }; }, }, }); }

/** @internal Target-aware stopped proof; all child I/O is dependency-owned. */
export async function runControllerStoppedFenceProofCoreForTest(request: { checkpoint: "post_build" | "recovery_terminal";
  receiptSHA256: string;
  targetRevision: string;
  targetTree: string;
  expectedDatabaseUpdatedAt: string;
  expectedFleetSHA256: string;
  image: TargetImageContract | null;
  expectation: TargetFleetExpectation;
  dependencies: MaintenanceRefenceDependencies;
  readEvidence(): TerminalEvidence | Promise<TerminalEvidence>; }): Promise<ControllerStoppedFenceProof> { let evidence: TerminalEvidence | null = null;
  const currentEvidence = (): TerminalEvidence => { requireCondition(evidence !== null, "controller_stopped_fence_evidence");
    return evidence!; };
  const readEvidenceProof = async () => { evidence = await request.readEvidence();
    return { evidence, fingerprint: localEvidenceFingerprint(evidence) }; };
  return maintenanceContract().runStoppedFenceCore({
    checkpoint: request.checkpoint, receiptSHA256: request.receiptSHA256, targetRevision: request.targetRevision, targetTree: request.targetTree, expectedDatabaseUpdatedAt: request.expectedDatabaseUpdatedAt,
    expectedFleetSHA256: request.expectedFleetSHA256, image: request.image, expectation: request.expectation, dependencies: { readEvidenceProof, readGitProof: async () => validateGitProof( await request.dependencies.readGitProof(),
          currentEvidence(), ) as unknown as JsonRecord, readDatabaseProof: async () => validateDatabaseProof( await request.dependencies.readDatabaseProof(), currentEvidence(), { instanceURLSHA256: TARGET_INSTANCE_URL_SHA256,
            updatedAt: request.expectedDatabaseUpdatedAt, }, ), readProviderProof: async () => validateProviderAbsence( await request.dependencies.readProviderSecretInventory(), ), readKeychainProof: async () => validateKeychainProof(
          await request.dependencies.readKeychainProof(), currentEvidence().roles, ) as unknown as JsonRecord, readProcessProof: async () => validateProcessProof( await request.dependencies.readProcessProof(), ) as unknown as JsonRecord,
      readFleetProof: async () => { const raw = await request.dependencies.readFleetInventory();
        return request.image === null
          ? validateStoppedFleet(raw, currentEvidence()).fingerprint : validateTargetFleetForTest( raw, currentEvidence(), request.image, request.expectation, ); }, pause: (milliseconds: number) => request.dependencies.pause(milliseconds),
    }, }); }

/** @internal Four cordoned runtime probes inside an exact fleet sandwich. */
export async function runControllerCordonedRuntimeCoreForTest(request: { evidence: TerminalEvidence;
  image: TargetImageContract;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  startedMachineIDs: readonly string[];
  dependencies: { readFleetInventory(): Promise<unknown>;
    runMachineProbe( machineID: string, role: "app" | "thinker_primary", ): Promise<string>;
    pause(milliseconds: number): Promise<void>; }; }): Promise<ControllerCordonedRuntimeProof> { return maintenanceContract().runCordonedRuntimeCore({ evidence: request.evidence, image: request.image, expectation: request.expectation,
    expectedFleetSHA256: request.expectedFleetSHA256, startedMachineIDs: request.startedMachineIDs, dependencies: { readFleetProof: async () => validateTargetFleetForTest( await request.dependencies.readFleetInventory(), request.evidence,
          request.image, request.expectation, ), runMachineProbe: ( machineID: string, role: "app" | "thinker_primary", ) => request.dependencies.runMachineProbe(machineID, role),
      pause: (milliseconds: number) => request.dependencies.pause(milliseconds), }, }); }

// Production dependency construction is intentionally below the pure core so
// focused tests can exercise every refusal without credentials or network.
let productionInterrupted: "SIGINT" | "SIGTERM" | null = null;
let activeProductionChild: any = null;
let activeProductionChildPipes: ProductionChildPipeOwner | null = null;
let interruptHardKill: ReturnType<typeof setTimeout> | null = null;

function processGroupExists(pid: number): boolean { try { process.kill(-pid, 0);
    return true; } catch (error: any) { return error?.code !== "ESRCH"; } }

function signalProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void { try { process.kill(-pid, signal); } catch {} }

function requestProductionInterrupt(signal: "SIGINT" | "SIGTERM"): void { const firstSignal = productionInterrupted === null;
  productionInterrupted ??= signal;
  if (!activeProductionChild) return;
  if (!firstSignal) { signalProcessGroup(Number(activeProductionChild.pid), "SIGKILL");
    return; }
  signalProcessGroup(Number(activeProductionChild.pid), "SIGTERM");
  if (interruptHardKill === null) { interruptHardKill = setTimeout( () => signalProcessGroup(Number(activeProductionChild?.pid), "SIGKILL"), 2_000, ); } }

type ProductionStreamOutcome = | { fulfilled: true; resourceSettled: true; value: Uint8Array }
  | { fulfilled: false; resourceSettled: boolean };

async function readBoundedStream( stream: ReadableStream<Uint8Array>, maximumBytes: number, signal?: AbortSignal, ): Promise<ProductionStreamOutcome> { const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  let failure: unknown = null;
  let cancellation: Promise<boolean> | null = null;
  const cancel = (): void => { cancellation ??= Promise.resolve().then(() => reader.cancel()).then( () => true, () => false, ); };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try { while (true) { const result = await reader.read();
      if (result.done) { complete = true;
        break; }
      total += result.value.byteLength;
      requireCondition(total <= maximumBytes, "child_output_bound");
      chunks.push(result.value); } } catch (error) { failure = error; } finally { signal?.removeEventListener("abort", cancel);
    if (!complete || cancellation !== null) cancel();
    const resourceSettled = cancellation === null || await cancellation;
    try { reader.releaseLock(); } catch { return { fulfilled: false, resourceSettled: false }; }
    if (!resourceSettled) return { fulfilled: false, resourceSettled: false }; }
  if (failure !== null) return { fulfilled: false, resourceSettled: true };
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset);
    offset += chunk.byteLength; }
  return { fulfilled: true, resourceSettled: true, value: output }; }

interface ProductionChildPipeOwner { readonly child: any;
  readonly abort: AbortController;
  readonly streams: readonly [ Promise<ProductionStreamOutcome>, Promise<ProductionStreamOutcome>, ]; }

function createProductionChildPipeOwner( child: any, maximumBytes: number, ): ProductionChildPipeOwner { const abort = new AbortController();
  const track = (stream: ReadableStream<Uint8Array>) => readBoundedStream(stream, maximumBytes, abort.signal);
  return { child, abort, streams: [track(child.stdout), track(child.stderr)], }; }

function ownProductionChild(child: any, maximumBytes = MAX_CHILD_BYTES): void { requireCondition( activeProductionChild === null && activeProductionChildPipes === null, "child_overlap", );
  activeProductionChild = child;
  activeProductionChildPipes = createProductionChildPipeOwner( child, maximumBytes, ); }

async function settleProductionChildStreams( owner: ProductionChildPipeOwner, cancel: boolean, ): Promise<readonly [ProductionStreamOutcome, ProductionStreamOutcome] | null> { if (cancel) owner.abort.abort();
  const outcomes = await Promise.all( owner.streams.map((stream) => settlePromiseWithin(stream, 2_500)), );
  const first = outcomes[0]!;
  const second = outcomes[1]!;
  if ( !first.settled || !first.fulfilled || !first.value.resourceSettled || !second.settled || !second.fulfilled || !second.value.resourceSettled ) { return null; }
  return [first.value, second.value]; }

async function releaseSettledProductionChild(child: any): Promise<boolean> { const owner = activeProductionChildPipes;
  if ( activeProductionChild !== child || owner === null || owner.child !== child ) return false;
  const streams = await settleProductionChildStreams(owner, false);
  const pid = Number(child.pid);
  const firstAbsent = !processGroupExists(pid);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  const settled = streams !== null && firstAbsent && !processGroupExists(pid);
  if (settled) { activeProductionChild = null;
    activeProductionChildPipes = null;
    if (interruptHardKill) clearTimeout(interruptHardKill);
    interruptHardKill = null; }
  return settled; }

async function settleOwnedProductionChild(child: any): Promise<boolean> { const owner = activeProductionChildPipes;
  if ( activeProductionChild !== child || owner === null || owner.child !== child ) return false;
  owner.abort.abort();
  let terminationSettled = true;
  try { await terminateAndSettle(child); } catch { terminationSettled = false; }
  const streams = await settleProductionChildStreams(owner, true);
  return terminationSettled && streams !== null && await releaseSettledProductionChild(child); }

export function createProductionChildPipeOwnerForTest( child: any, maximumBytes: number, ): ProductionChildPipeOwner { return createProductionChildPipeOwner(child, maximumBytes); }

async function settlePromiseWithin<T>( promise: Promise<T>, milliseconds: number, ): Promise<
  | { settled: true; fulfilled: true; value: T }
  | { settled: true; fulfilled: false }
  | { settled: false; fulfilled: false }
> { let timer: ReturnType<typeof setTimeout> | null = null;
  try { return await Promise.race([ promise.then( (value) => ({ settled: true, fulfilled: true, value } as const), () => ({ settled: true, fulfilled: false } as const), ),
      new Promise<{ settled: false; fulfilled: false }>((resolvePromise) => { timer = setTimeout( () => resolvePromise({ settled: false, fulfilled: false }), milliseconds, ); }), ]); } finally { if (timer) clearTimeout(timer); } }

interface DatabaseClientRegistry { register<T extends { end(options: { timeout: number }): unknown }>( client: T, ): T;
  closeClients(clients: readonly unknown[]): Promise<void>;
  closeAll(): Promise<void>;
  activeCount(): number; }

function createDatabaseClientRegistry( settlementMilliseconds = 2_500, ): DatabaseClientRegistry { requireCondition( Number.isSafeInteger(settlementMilliseconds) && settlementMilliseconds > 0, "database_close_contract", );
  const clients = new Set<any>();
  let sealed = false;
  let closing: Promise<void> | null = null;
  const closeOne = async (client: any): Promise<boolean> => { if (!clients.has(client)) return true;
    for (const timeout of [2, 0]) { const outcome = await settlePromiseWithin( Promise.resolve().then(() => client.end({ timeout })), settlementMilliseconds, );
      if (outcome.settled && outcome.fulfilled) { clients.delete(client);
        return true; } }
    return false; };
  const closeClients = async (selected: readonly unknown[]): Promise<void> => { let failed = false;
    await Promise.all( [...new Set(selected)].map(async (client) => { if (!(await closeOne(client))) failed = true; }), );
    requireCondition(!failed, "database_close"); };
  return { register: (client) => { requireCondition( !sealed && client !== null && typeof client === "object" && typeof client.end === "function", "database_client_registry", );
      clients.add(client);
      return client; }, closeClients, closeAll: () => { sealed = true;
      if (closing !== null) return closing;
      closing = closeClients([...clients]).finally(() => { closing = null; });
      return closing; }, activeCount: () => clients.size, }; }

/** @internal Bounded retained-handle registry for contained settlement tests. */
export function createDatabaseClientRegistryForTest( settlementMilliseconds: number, ): DatabaseClientRegistry { return createDatabaseClientRegistry(settlementMilliseconds); }

interface SessionResourceTeardown { close(): Promise<void>;
  complete(): boolean; }

async function settleResourceTwice( settle: () => Promise<boolean>, ): Promise<boolean> { for (let attempt = 0; attempt < 2; attempt += 1) { try { if (await settle()) return true; } catch {} }
  return false; }

export function settleResourceTwiceForTest( settle: () => Promise<boolean>, ): Promise<boolean> { return settleResourceTwice(settle); }

function createSessionResourceTeardown(request: { settleActiveChild(): Promise<boolean>;
  closeDatabaseClients(): Promise<void>; }): SessionResourceTeardown { let complete = false;
  let inFlight: Promise<void> | null = null;
  const close = (): Promise<void> => { if (complete) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    inFlight = (async () => { let failed = false;
      try { if (!(await request.settleActiveChild())) failed = true; } catch { failed = true; }
      try { await request.closeDatabaseClients(); } catch { failed = true; }
      requireCondition(!failed, "controller_resource_cleanup_uncertain");
      complete = true; })().finally(() => { inFlight = null; });
    return inFlight; };
  return { close, complete: () => complete }; }

/** @internal Idempotent all-resource teardown for contained ownership tests. */
export function createSessionResourceTeardownForTest(request: { settleActiveChild(): Promise<boolean>;
  closeDatabaseClients(): Promise<void>; }): SessionResourceTeardown { return createSessionResourceTeardown(request); }

async function terminateAndSettle(child: any): Promise<void> { const pid = Number(child.pid);
  signalProcessGroup(pid, "SIGTERM");
  let exit = await settlePromiseWithin(Promise.resolve(child.exited), 2_000);
  if (!exit.settled || processGroupExists(pid)) { signalProcessGroup(pid, "SIGKILL");
    exit = await settlePromiseWithin(Promise.resolve(child.exited), 2_000); }
  const deadline = Date.now() + 2_000;
  while (processGroupExists(pid) && Date.now() < deadline) { await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)); }
  requireCondition( exit.settled && !processGroupExists(pid), "child_tree_not_settled", ); }

interface BoundedProductionChildResult { exitCode: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
  timedOut: boolean;
  outputFailed: boolean;
  forcedSettlement: boolean;
  processGroupSettled: boolean; }

async function settleBoundedProductionChild( child: any, pgid: number, timeoutMilliseconds: number, ): Promise<BoundedProductionChildResult> { const owner = activeProductionChildPipes;
  requireCondition( activeProductionChild === child && owner !== null && owner.child === child, "controller_child_identity", );
  const abort = owner.abort;
  const output = Promise.all(owner.streams).then(([stdout, stderr]) => { requireCondition( stdout.fulfilled && stderr.fulfilled, "controller_child_output", );
    return [stdout.value, stderr.value] as const; });
  const combined = Promise.all([Promise.resolve(child.exited), output]);
  let timedOut = false;
  let outputFailed = false;
  let forcedSettlement = false;
  let stdout: Uint8Array = new Uint8Array();
  let stderr: Uint8Array = new Uint8Array();
  let exitCode: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hardKill: ReturnType<typeof setTimeout> | null = null;
  try { const first = await Promise.race([ combined.then( (value) => ({ completed: true, value } as const), () => ({ completed: false, failed: true } as const), ), new Promise<{ completed: false; timedOut: true }>((resolvePromise) => {
        timer = setTimeout(() => { timedOut = true;
          signalProcessGroup(pgid, "SIGTERM");
          hardKill = setTimeout( () => signalProcessGroup(pgid, "SIGKILL"), 2_000, );
          abort.abort();
          resolvePromise({ completed: false, timedOut: true }); }, timeoutMilliseconds); }), ]);
    if (first.completed) { exitCode = Number.isSafeInteger(first.value[0]) ? first.value[0] : null;
      [stdout, stderr] = first.value[1]; } else { outputFailed = "failed" in first;
      abort.abort();
      try { await terminateAndSettle(child);
        forcedSettlement = true; } catch {}
      const drained = await settlePromiseWithin(output, 2_500);
      if (drained.settled && drained.fulfilled) { [stdout, stderr] = drained.value; } else { outputFailed = true; }
      const exited = await settlePromiseWithin( Promise.resolve(child.exited), 2_500, );
      if (exited.settled && exited.fulfilled) { exitCode = Number.isSafeInteger(exited.value) ? exited.value : null; } } } finally { if (timer) clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill); }
  if ( productionInterrupted !== null || processGroupExists(pgid) ) { abort.abort();
    try { await terminateAndSettle(child);
      forcedSettlement = true; } catch {} }
  const processGroupSettled = await releaseSettledProductionChild(child);
  return { exitCode, stdout, stderr, timedOut, outputFailed, forcedSettlement, processGroupSettled, }; }

async function readBoundedChild( argv: readonly string[], options: { maximumBytes?: number;
    timeoutMs?: number;
    cwd?: string;
    environment?: Readonly<Record<string, string>>; } = {}, ): Promise<{ exitCode: number; stdout: Uint8Array }> { requireCondition(productionInterrupted === null, "interrupted");
  requireCondition(activeProductionChild === null, "child_overlap");
  const maximum = options.maximumBytes ?? MAX_CHILD_BYTES;
  const child = Bun.spawn([...argv], { cwd: options.cwd ?? HOME, env: { ...(options.environment ?? CONTROLLER_ENVIRONMENT) }, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true, });
  ownProductionChild(child, maximum);
  const owner = activeProductionChildPipes!;
  const output = Promise.all(owner.streams).then(([stdout, stderr]) => { requireCondition(stdout.fulfilled && stderr.fulfilled, "child_refused");
    return [stdout.value, stderr.value] as const; });
  const timeoutMs = options.timeoutMs ?? 30_000;
  let hardKill: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true;
    signalProcessGroup(Number(child.pid), "SIGTERM");
    hardKill = setTimeout( () => signalProcessGroup(Number(child.pid), "SIGKILL"), 2_000, ); }, timeoutMs);
  try { const [exitCode, [stdout]] = await Promise.all([ child.exited, output, ]);
    if ( timedOut || productionInterrupted || processGroupExists(Number(child.pid)) ) { requireCondition( await settleOwnedProductionChild(child), "child_tree_not_settled", );
      refuse( timedOut ? "child_timeout" : productionInterrupted ? "interrupted" : "child_descendant_survived", ); }
    requireCondition( await releaseSettledProductionChild(child), "child_tree_not_settled", );
    return { exitCode, stdout }; } catch (error) { if (activeProductionChild === child) { requireCondition( await settleOwnedProductionChild(child), "child_tree_not_settled", ); }
    if (error instanceof MaintenanceRefenceError) throw error;
    return refuse("child_refused"); } finally { clearTimeout(timer);
    if (hardKill) clearTimeout(hardKill); } }

async function runRefenceFlyCLI( arguments_: readonly string[], ): Promise<{ exitCode: number; stdout: Uint8Array }> { const allowed = canonicalJson(arguments_) === canonicalJson(["secrets", "list", "-a", APP, "--json"]) ||
    canonicalJson(arguments_) === canonicalJson(["machine", "list", "-a", APP, "--json"]);
  requireCondition(allowed, "fly_invocation_contract");
  requirePinnedUserExecutable(PINNED_FLY, PINNED_FLY_SHA256, "fly_contract");
  requireFlyAuthenticationConfig();
  const result = await readBoundedChild([PINNED_FLY, ...arguments_], { cwd: REPOSITORY_ROOT, });
  requirePinnedUserExecutable(PINNED_FLY, PINNED_FLY_SHA256, "fly_contract");
  requireFlyAuthenticationConfig();
  return result; }

async function runRefenceSecurityCLI( arguments_: readonly string[], ): Promise<{ exitCode: number; stdout: Uint8Array }> { const allowed = [ [ "find-generic-password", "-s", GENERATION_KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, ], [
      "find-generic-password", "-s", MACHINE_MAP_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", ], [ "find-generic-password", "-s", "agenttool-database-url", "-a", KEYCHAIN_ACCOUNT, "-w", ], [ "find-generic-password", "-s",
      "agenttool-database-session-url", "-a", KEYCHAIN_ACCOUNT, "-w", ], ].some((candidate) => canonicalJson(candidate) === canonicalJson(arguments_));
  requireCondition(allowed, "security_invocation_contract");
  requirePinnedSystemExecutable(SECURITY, SECURITY_SHA256, 1);
  const result = await readBoundedChild([SECURITY, ...arguments_], { cwd: HOME, });
  requirePinnedSystemExecutable(SECURITY, SECURITY_SHA256, 1);
  return result; }

function refenceGitInvocationAllowed(arguments_: readonly string[]): boolean { return [ ["rev-parse", "HEAD"], ["rev-parse", "HEAD^{tree}"], ["rev-list", "--count", `${EXPECTED_SOURCE_REVISION}..HEAD`],
    ["merge-base", "--is-ancestor", EXPECTED_SOURCE_REVISION, "HEAD"], ["status", "--porcelain=v1", "--untracked-files=all"], ["show", "HEAD:bin/phase-b-refence-maintenance-bridge.ts"],
    ["show", "HEAD:bin/phase-b-refence-maintenance-contract.ts"], ["rev-parse", GITHUB_MAIN_TRACKING_REF], ["ls-tree", "-rz", "--full-tree", "HEAD", "--", "api", "docs"], [ "ls-tree", "-z", "HEAD", "--",
      "bin/phase-b-refence-maintenance-contract.ts", ], ].some((candidate) => canonicalJson(candidate) === canonicalJson(arguments_)); }

/** @internal Exact Git read allowlist for contained closure tests. */
export function refenceGitInvocationAllowedForTest( arguments_: readonly string[], ): boolean { return refenceGitInvocationAllowed(arguments_); }

async function runRefenceGitCLI( arguments_: readonly string[], maximumBytes = MAX_CHILD_BYTES, ): Promise<{ exitCode: number; stdout: Uint8Array }> { requireCondition( refenceGitInvocationAllowed(arguments_), "git_invocation_contract", );
  requirePinnedSystemExecutable(GIT, GIT_SHA256, 78);
  const result = await readBoundedChild([ GIT, ...GIT_CLOSED_FLAGS, "-C", REPOSITORY_ROOT, ...arguments_, ], { cwd: REPOSITORY_ROOT, maximumBytes, environment: GIT_CHILD_ENVIRONMENT, });
  requirePinnedSystemExecutable(GIT, GIT_SHA256, 78);
  return result; }

async function fetchLiteralGitHubMain(): Promise<void> { requirePinnedSystemExecutable(GIT, GIT_SHA256, 78);
  const result = await readBoundedChild([ GIT, ...GIT_CLOSED_FLAGS, "-C", REPOSITORY_ROOT, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", GITHUB_MAIN_URL, `+refs/heads/main:${GITHUB_MAIN_TRACKING_REF}`, ], { cwd: REPOSITORY_ROOT,
    timeoutMs: 120_000, environment: GIT_CHILD_ENVIRONMENT, });
  requirePinnedSystemExecutable(GIT, GIT_SHA256, 78);
  requireCondition(result.exitCode === 0, "github_main_fetch"); }

interface GitTreeFile { mode: 0o644 | 0o755;
  objectSHA1: string;
  sourceRelativePath: string;
  destinationRelativePath: string;
  kind: "tracked_api" | "bundled_registry" | "bundled_doctrine"; }

interface DependencyEstateInventory { sha256: string;
  fileCount: number;
  byteCount: number;
  symlinkCount: number; }

const DEPENDENCY_SOURCE_PATHS = [ "api/package.json", "api/bun.lock", "api/tsconfig.json", "api/src/db/supabase-target.ts", "api/src/db/verified-postgres.ts", "api/certs/supabase-prod-ca-2021.crt", ] as const;
const DEPENDENCY_SOURCE_CONTRACT: Readonly<
  Record<(typeof DEPENDENCY_SOURCE_PATHS)[number], { size: number;
    gitBlobSHA1: string;
    sha256: string; }>
> = Object.freeze({ "api/package.json": { size: 1_574, gitBlobSHA1: "4780873390d0dd7543a128fe73b6ef59e9fea59b", sha256: "f879ba655bf3a8f006878341937ab5e2de2bb9574d052c45afde51d01e90668e", }, "api/bun.lock": { size: 108_446,
    gitBlobSHA1: "aa710140fcefee5de92e14e3f411e0781d718c04", sha256: "45b125b4a88559edde90a5b1b0eb7ea446c482b20adbdaccebea6449a7d0ed86", }, "api/tsconfig.json": { size: 483, gitBlobSHA1: "b57822ee748d8885ef85cdbc3e13a58d855d57f4",
    sha256: "dc95a78b550175d03e9ef15b9ee484c736cd2c1e13d35bf482255a68f4f28c77", }, "api/src/db/supabase-target.ts": { size: 10_245, gitBlobSHA1: "f83fc9e1345e5a7840270f6abc75b601588f8ffd",
    sha256: "e7e41d1887c8dac0de5ca576126535437c4c0ca3d38ea876f3ca8d521cc6df4c", }, "api/src/db/verified-postgres.ts": { size: 2_122, gitBlobSHA1: "41227bdf0296583909c161e6a1b617f727077ff4",
    sha256: "20f14a983a39ce83198fa352b526dd4c4de4003f9b497e6f4ddf2c2d0aea442d", }, "api/certs/supabase-prod-ca-2021.crt": { size: 1_367, gitBlobSHA1: "3d693669b23c340c57a3457bdc8b6fefe1806cc5",
    sha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7", }, });
const POSTGRES_LOCK_INTEGRITY = "sha512-GD3qdB0x1z9xgFI6cdRD6xu2Sp2WCOEoe3mtnyB5Ee0XrrL5Pe+e4CCnJrRMnL1zYtRDZmQQVbvOttLnKDLnaw==";
const POSTGRES_RUNTIME_CLOSURE = [ [ "package.json", 1_814, "944d492614959389a5739ef2893bc1830fb773ff042159d9b331d43b2f6792e9", ], [ "src/bytes.js", 1_362, "53b73b5ee2919ab5561229c62a4e2db578f63ca613b795b380c23cb684f2d514", ], [
    "src/connection.js", 28_690, "ee3a218d9aa6a6f2887c1a19da50009335fe84c11a5431d5cab72d6bc528632f", ], [ "src/errors.js", 1_155, "85cfbed9a5ab0db41ab8e97b806c881af29807dfe99bc656fdf1a18c1c13b6c6", ], [ "src/index.js", 15_428,
    "4e21f5733e70d79cffc10d10d4ef01031de4a9ac862210e43f8870029fd103ed", ], [ "src/large.js", 2_133, "05ea787f79cefaf16310f14119fbfd36d2fed0795581b0df1b0e63b591a3ed94", ], [ "src/query.js", 3_600,
    "67c45a5151032aa46b587abc15381fe4efd97c696e5c1b53082b8161309c4ee2", ], [ "src/queue.js", 541, "15e6345adb6708bf3b99ad39fc2231c2fb61de5f6cba4b7a7a6be881482a4ec3", ], [ "src/result.js", 416,
    "001ff5e0c8d634674f483d07fbcd620a797e3101f842d6c20ca3ace936260465", ], [ "src/subscribe.js", 7_626, "5d0b1ec9705281ed4a60236fe5f65654038bae117845a71d19e35374d34c0cfa", ], [ "src/types.js", 10_935,
    "1883bd4536eab1c94b9e708d325b13708b0f18ec80020e3a825f34a72f603b81", ], ] as const;
const POSTGRES_RUNTIME_CLOSURE_SHA256 = "689e732c8ffc35e0c5c3aac2d6328c915abd56eec5b77a5790da2d3b7a154b71";

function bytewiseSorted(values: readonly string[]): string[] { return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")) ); }

function dependencyEstateInventory(path: string): DependencyEstateInventory { const root = lstatSync(path);
  requireCondition( root.isDirectory() && !root.isSymbolicLink() && root.uid === process.getuid?.() && root.gid === process.getgid?.() && (root.mode & 0o777) === 0o700 && realpathSync(path) === path, "dependency_estate_inventory", );
  const projection: JsonRecord[] = [];
  let fileCount = 0;
  let byteCount = 0;
  let symlinkCount = 0;
  const visit = (directory: string, relativeDirectory: string): void => { for (const name of bytewiseSorted(readdirSync(directory))) { requireCondition( name.length > 0 && !/[\t\r\n\0]/.test(name), "dependency_estate_inventory", );
      const childPath = join(directory, name);
      const childRelative = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      const child = lstatSync(childPath);
      requireCondition( child.uid === process.getuid?.() && child.gid === process.getgid?.(), "dependency_estate_inventory", );
      if (child.isDirectory() && !child.isSymbolicLink()) { requireCondition( (child.mode & 0o777) === 0o700 && realpathSync(childPath) === childPath, "dependency_estate_inventory", );
        projection.push({ kind: "directory", mode: (child.mode & 0o777).toString(8).padStart(4, "0"), path: childRelative, });
        visit(childPath, childRelative);
        continue; }
      if (child.isSymbolicLink()) { const target = readlinkSync(childPath);
        requireCondition( target.length > 0 && !target.startsWith("/") && !/[\t\r\n\0]/.test(target) && child.nlink === 1, "dependency_estate_inventory", );
        const resolved = realpathSync(childPath);
        requireCondition( resolved.startsWith(`${path}/`) && resolved !== path, "dependency_estate_inventory", );
        projection.push({ kind: "symlink", path: childRelative, target, resolved_relative_path: resolved.slice(path.length + 1), });
        fileCount += 1;
        symlinkCount += 1;
        continue; }
      requireCondition( child.isFile() && child.nlink === 1 && (child.mode & 0o777) === 0o600 && child.size >= 0 && child.size <= 50_000_000 && realpathSync(childPath) === childPath, "dependency_estate_inventory", );
      const descriptor = openSync( childPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
      try { const opened = fstatSync(descriptor);
        const bytes = readFileSync(descriptor);
        const rebound = lstatSync(childPath);
        requireCondition( sameFileIdentity(opened, child) && sameFileIdentity(rebound, opened) && opened.size === bytes.byteLength && rebound.size === opened.size, "dependency_estate_inventory", );
        projection.push({ kind: "file", mode: (opened.mode & 0o777).toString(8).padStart(4, "0"), path: childRelative, sha256: sha256(bytes), size: bytes.byteLength, });
        fileCount += 1;
        byteCount += bytes.byteLength; } finally { closeSync(descriptor); }
      requireCondition( fileCount <= 100_000 && byteCount <= 2_000_000_000, "dependency_estate_inventory", ); } };
  visit(path, "");
  requireCondition( fileCount > DEPENDENCY_SOURCE_PATHS.length && byteCount > 0, "dependency_estate_inventory", );
  return { sha256: sha256(canonicalJson(projection)), fileCount, byteCount, symlinkCount, }; }

function stableDependencyFile( path: string, maximumBytes = 5_000_000, ): { bytes: Uint8Array; identity: DurableFileIdentity } { const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o022) === 0 &&
      (before.mode & 0o400) !== 0 && before.size > 0 && before.size <= maximumBytes && realpathSync(path) === path, "dependency_estate_file", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( sameFileIdentity(opened, before) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && opened.size === bytes.byteLength && after.size === opened.size && rebound.size === opened.size,
      "dependency_estate_file", );
    return { bytes, identity: durableIdentity(rebound, bytes) }; } finally { closeSync(descriptor); } }

function requirePostgresRuntimeSourceDirectories(): void { const directories: ReadonlyArray<[string, number]> = [ [join(HOME, ".bun"), 0o755], [join(HOME, ".bun/install"), 0o755], [join(HOME, ".bun/install/cache"), 0o755],
    [POSTGRES_RUNTIME_SOURCE, 0o755], [join(POSTGRES_RUNTIME_SOURCE, "src"), 0o755], ];
  for (const [path, mode] of directories) { const info = lstatSync(path);
    requireCondition( info.isDirectory() && !info.isSymbolicLink() && info.uid === OPERATOR_UID && info.gid === process.getgid?.() && (info.mode & 0o777) === mode && realpathSync(path) === path, "dependency_runtime_source", ); } }

function readStablePostgresRuntimeSource( relativePath: string, expectedSize: number, expectedSHA256: string, ): { bytes: Uint8Array; identity: DurableFileIdentity } { requireCondition(
    POSTGRES_RUNTIME_CLOSURE.some(([path]) => path === relativePath), "dependency_runtime_source", );
  const path = join(POSTGRES_RUNTIME_SOURCE, relativePath);
  requireCondition( path.startsWith(`${POSTGRES_RUNTIME_SOURCE}/`) && realpathSync(path) === path, "dependency_runtime_source", );
  const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === OPERATOR_UID && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === 0o666 && before.size === expectedSize,
    "dependency_runtime_source", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    requireCondition( sameFileIdentity(opened, before) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && opened.size === bytes.byteLength && after.size === opened.size && rebound.size === opened.size &&
        sha256(bytes) === expectedSHA256, "dependency_runtime_source", );
    return { bytes, identity: durableIdentity(rebound, bytes) }; } finally { closeSync(descriptor); } }

function requireDependencyEstate( binding: ControllerPreparationBinding["dependencyEstate"], ): void { const estate = lstatSync(binding.path);
  requireCondition( estate.isDirectory() && !estate.isSymbolicLink() && estate.dev === binding.estate_device && estate.ino === binding.estate_inode && estate.uid === process.getuid?.() && estate.gid === process.getgid?.() &&
      (estate.mode & 0o777) === 0o700 && realpathSync(binding.path) === binding.path && realpathSync(binding.project_path) === binding.project_path && binding.runtime_source_path === POSTGRES_RUNTIME_SOURCE, "dependency_estate_binding", );
  const ready = readStablePrivateFile(binding.ready_path);
  requireCondition( sha256(ready.bytes) === binding.ready_sha256, "dependency_estate_binding", );
  const readyValue = parseCanonicalJsonBytes( ready.bytes, "dependency_estate_ready", );
  exactKeys( readyValue, [ "schema", "controller_run_id", "estate_path", "estate_device", "estate_inode", "project_path", "runtime_source_path", "source_revision", "source_tree", "source_inventory_sha256", "postgres_runtime_closure_sha256",
      "dependency_inventory_sha256", "dependency_file_count", "dependency_byte_count", "dependency_symlink_count", "prepared_at", "credential_free_preparation", "network_used", "package_manager_used", ], "dependency_estate_ready", );
  requireCondition( readyValue.schema === "agenttool-phase-b-refence-dependency-estate-ready/v1" && readyValue.controller_run_id === basename(binding.path) && readyValue.estate_path === binding.path &&
      readyValue.estate_device === binding.estate_device && readyValue.estate_inode === binding.estate_inode && readyValue.project_path === binding.project_path && readyValue.runtime_source_path === POSTGRES_RUNTIME_SOURCE &&
      readyValue.source_revision === binding.source_revision && readyValue.source_tree === binding.source_tree && readyValue.source_inventory_sha256 === binding.source_inventory_sha256 && readyValue.postgres_runtime_closure_sha256 ===
        POSTGRES_RUNTIME_CLOSURE_SHA256 && readyValue.dependency_inventory_sha256 === binding.dependency_inventory_sha256 && readyValue.dependency_file_count === binding.dependency_file_count &&
      readyValue.dependency_byte_count === binding.dependency_byte_count && readyValue.dependency_symlink_count === binding.dependency_symlink_count && validUtcTimestamp(readyValue.prepared_at) &&
      readyValue.credential_free_preparation === true && readyValue.network_used === false && readyValue.package_manager_used === false, "dependency_estate_binding", );
  const inventory = dependencyEstateInventory(binding.path);
  requireCondition( inventory.sha256 === binding.dependency_inventory_sha256 && inventory.fileCount === binding.dependency_file_count && inventory.byteCount === binding.dependency_byte_count &&
      inventory.symlinkCount === binding.dependency_symlink_count && inventory.fileCount === 17 && inventory.byteCount === 197_937 && inventory.symlinkCount === 0 && binding.postgres_runtime_closure_sha256 ===
        POSTGRES_RUNTIME_CLOSURE_SHA256 && canonicalJson(bytewiseSorted(readdirSync(binding.project_path))) === canonicalJson([ "bun.lock", "certs", "node_modules", "package.json", "src", "tsconfig.json", ]), "dependency_estate_binding", );
  const postgresDirectory = join(binding.project_path, "node_modules/postgres");
  const postgresInfo = lstatSync(postgresDirectory);
  requireCondition( postgresInfo.isDirectory() && !postgresInfo.isSymbolicLink() && realpathSync(postgresDirectory) === postgresDirectory, "dependency_estate_postgres", );
  const postgresPackageFile = stableDependencyFile( join(postgresDirectory, "package.json"), );
  const postgresPackage = JSON.parse( decode(postgresPackageFile.bytes, "dependency_estate_postgres"), );
  const runtimeClosure = POSTGRES_RUNTIME_CLOSURE.map( ([relativePath, expectedSize, expectedSHA256]) => { const file = stableDependencyFile(join(postgresDirectory, relativePath));
      requireCondition( file.identity.size === expectedSize && file.identity.sha256 === expectedSHA256, "dependency_estate_postgres_closure", );
      return `${relativePath}\t${expectedSize}\t${expectedSHA256}\n`; }, ).join("");
  requireCondition( postgresPackage?.name === "postgres" && postgresPackage?.version === "3.4.9" && postgresPackage?.main === "cjs/src/index.js" && postgresPackage?.exports?.types === "./types/index.d.ts" &&
      postgresPackage?.exports?.bun === "./src/index.js" && postgresPackage?.exports?.workerd === "./cf/src/index.js" && postgresPackage?.exports?.import === "./src/index.js" && postgresPackage?.exports?.default === "./cjs/src/index.js" &&
      postgresPackage?.module === "src/index.js" && postgresPackage?.type === "module" && canonicalJson( bytewiseSorted(readdirSync(join(postgresDirectory, "src"))), ) === canonicalJson(
          POSTGRES_RUNTIME_CLOSURE.slice(1).map(([path]) => basename(path)), ) && sha256(runtimeClosure) === POSTGRES_RUNTIME_CLOSURE_SHA256, "dependency_estate_postgres", ); }

async function prepareProductionDependencyEstate( evidence: TerminalEvidence, ): Promise<ControllerPreparationBinding["dependencyEstate"]> { requireCondition( evidence.edge === "H0", "dependency_estate_pre_handoff", );
  const treeResult = await runRefenceGitCLI([ "ls-tree", "-rz", "--full-tree", "HEAD", "--", "api", "docs", ]);
  requireCondition(treeResult.exitCode === 0, "dependency_estate_source");
  const tree = parseGitTreeFiles(treeResult.stdout);
  createPrivateDirectoryExclusive(CONTROLLER_DEPENDENCY_ROOT, STATE_DIR);
  const estatePath = join(CONTROLLER_DEPENDENCY_ROOT, evidence.runID);
  const estateIdentity = createPrivateDirectoryExclusive( estatePath, CONTROLLER_DEPENDENCY_ROOT, );
  const projectPath = join(estatePath, "project");
  createPrivateDirectoryExclusive(projectPath, estatePath);
  createPrivateDirectoryExclusive(join(projectPath, "src"), projectPath);
  createPrivateDirectoryExclusive( join(projectPath, "src/db"), join(projectPath, "src"), );
  createPrivateDirectoryExclusive(join(projectPath, "certs"), projectPath);
  createPrivateDirectoryExclusive( join(projectPath, "node_modules"), projectPath, );
  createPrivateDirectoryExclusive( join(projectPath, "node_modules/postgres"), join(projectPath, "node_modules"), );
  createPrivateDirectoryExclusive( join(projectPath, "node_modules/postgres/src"), join(projectPath, "node_modules/postgres"), );
  const sourceProjection: JsonRecord[] = [];
  const sourceIdentities = new Map<string, DurableFileIdentity>();
  for (const sourceRelativePath of DEPENDENCY_SOURCE_PATHS) { const metadata = tree.get(sourceRelativePath);
    const expected = DEPENDENCY_SOURCE_CONTRACT[sourceRelativePath];
    requireCondition( metadata !== undefined && metadata.mode === 0o644 && metadata.objectSHA1 === expected.gitBlobSHA1, "dependency_estate_source", );
    const source = readStableRepositoryBlob(sourceRelativePath, metadata);
    requireCondition( source.bytes.byteLength === expected.size && sha256(source.bytes) === expected.sha256, "dependency_estate_source", );
    const destinationRelativePath = sourceRelativePath.slice("api/".length);
    const destination = join(projectPath, destinationRelativePath);
    const identity = createExclusiveDurableFile( destination, source.bytes, dirname(destination), );
    sourceIdentities.set(destination, identity);
    sourceProjection.push({ destination_relative_path: destinationRelativePath, git_blob_sha1: metadata.objectSHA1, sha256: identity.sha256, size: identity.size, source_relative_path: sourceRelativePath, }); }
  requirePostgresRuntimeSourceDirectories();
  for ( const [relativePath, expectedSize, expectedSHA256]
      of POSTGRES_RUNTIME_CLOSURE ) { const source = readStablePostgresRuntimeSource( relativePath, expectedSize, expectedSHA256, );
    const destination = join( projectPath, "node_modules/postgres", relativePath, );
    const identity = createExclusiveDurableFile( destination, source.bytes, dirname(destination), );
    const sourceRebound = readStablePostgresRuntimeSource( relativePath, expectedSize, expectedSHA256, );
    requireCondition( source.identity.device === sourceRebound.identity.device && source.identity.inode === sourceRebound.identity.inode && source.identity.sha256 === identity.sha256 && sourceRebound.identity.sha256 === identity.sha256,
      "dependency_runtime_source", );
    sourceProjection.push({ destination_relative_path: `node_modules/postgres/${relativePath}`, sha256: identity.sha256, size: identity.size, source_relative_path: `${POSTGRES_RUNTIME_SOURCE}/${relativePath}`, }); }
  requirePostgresRuntimeSourceDirectories();
  const packageBytes = stableDependencyFile(join(projectPath, "package.json")).bytes;
  const lockBytes = stableDependencyFile(join(projectPath, "bun.lock")).bytes;
  const packageValue = JSON.parse( decode(packageBytes, "dependency_estate_source"), );
  const lockValue = JSON.parse(decode(lockBytes, "dependency_estate_source"));
  requireCondition( packageValue?.name === "agenttool" && packageValue?.dependencies?.postgres === "^3.4.9" && canonicalJson(lockValue?.packages?.postgres) === canonicalJson([ "postgres@3.4.9", "", {}, POSTGRES_LOCK_INTEGRITY, ]),
    "dependency_estate_lock", );
  requireCondition( canonicalJson(bytewiseSorted(readdirSync(projectPath))) === canonicalJson([ "bun.lock", "certs", "node_modules", "package.json", "src", "tsconfig.json", ]), "dependency_estate_source_inventory", );
  const sourceInventorySHA256 = sha256(canonicalJson(sourceProjection));
  for (const [path, identity] of sourceIdentities) { requireExactFileIdentity(path, identity); }
  for ( const directory of [ join(projectPath, "src/db"), join(projectPath, "src"), join(projectPath, "certs"), join(projectPath, "node_modules/postgres/src"), join(projectPath, "node_modules/postgres"), join(projectPath, "node_modules"),
      projectPath, estatePath, ] ) { fsyncPath(directory); }
  const firstInventory = dependencyEstateInventory(estatePath);
  const secondInventory = dependencyEstateInventory(estatePath);
  requireCondition( canonicalJson(firstInventory) === canonicalJson(secondInventory) && firstInventory.fileCount === 17 && firstInventory.byteCount === 197_937 && firstInventory.symlinkCount === 0, "dependency_estate_inventory", );
  const reboundEstate = lstatSync(estatePath);
  requireCondition( reboundEstate.dev === estateIdentity.dev && reboundEstate.ino === estateIdentity.ino, "dependency_estate_inventory", );
  const readyPath = join( CONTROLLER_DEPENDENCY_ROOT, `${evidence.runID}.ready.json`, );
  const preparedAt = new Date().toISOString();
  requireCondition(validUtcTimestamp(preparedAt), "dependency_estate_ready");
  const readyRecord = { schema: "agenttool-phase-b-refence-dependency-estate-ready/v1", controller_run_id: evidence.runID, estate_path: estatePath, estate_device: reboundEstate.dev, estate_inode: reboundEstate.ino,
    project_path: projectPath, runtime_source_path: POSTGRES_RUNTIME_SOURCE, source_revision: evidence.targetRevision, source_tree: evidence.targetTree, source_inventory_sha256: sourceInventorySHA256,
    postgres_runtime_closure_sha256: POSTGRES_RUNTIME_CLOSURE_SHA256, dependency_inventory_sha256: firstInventory.sha256, dependency_file_count: firstInventory.fileCount, dependency_byte_count: firstInventory.byteCount,
    dependency_symlink_count: firstInventory.symlinkCount, prepared_at: preparedAt, credential_free_preparation: true, network_used: false, package_manager_used: false, };
  const readyIdentity = createExclusiveDurableFile( readyPath, `${canonicalJson(readyRecord)}\n`, CONTROLLER_DEPENDENCY_ROOT, );
  const binding: ControllerPreparationBinding["dependencyEstate"] = { schema: "agenttool-phase-b-refence-dependency-estate/v1", path: estatePath, project_path: projectPath, runtime_source_path: POSTGRES_RUNTIME_SOURCE,
    source_revision: evidence.targetRevision, source_tree: evidence.targetTree, source_inventory_sha256: sourceInventorySHA256, postgres_runtime_closure_sha256: POSTGRES_RUNTIME_CLOSURE_SHA256,
    dependency_inventory_sha256: firstInventory.sha256, dependency_file_count: firstInventory.fileCount, dependency_byte_count: firstInventory.byteCount, dependency_symlink_count: firstInventory.symlinkCount,
    estate_device: reboundEstate.dev, estate_inode: reboundEstate.ino, ready_path: readyPath, ready_sha256: readyIdentity.sha256, prepared: true, };
  requireDependencyEstate(binding);
  return binding; }

export function parseGitTreeFiles(bytes: Uint8Array): Map<string, { mode: 0o644 | 0o755;
  objectSHA1: string; }> { const text = decode(bytes, "build_git_tree");
  requireCondition( text.endsWith("\0") && !text.includes("\r"), "build_git_tree", );
  const result = new Map<string, { mode: 0o644 | 0o755; objectSHA1: string }>();
  for (const row of text.slice(0, -1).split("\0")) { const match = row.match( /^(100644|100755|120000) blob ([0-9a-f]{40})\t([^\0]+)$/, );
    requireCondition(match !== null, "build_git_tree");
    const path = match[3]!;
    requireCondition( !result.has(path) && !path.startsWith("/") && !path.includes("//") && path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." ), "build_git_tree", );
    if (match[1] === "120000") continue;
    result.set(path, { mode: match[1] === "100755" ? 0o755 : 0o644, objectSHA1: match[2]!, }); }
  requireCondition(result.size > 0 && result.size <= 10_000, "build_git_tree");
  return result; }

function readStableRepositoryBlob( relativePath: string, expected: { mode: 0o644 | 0o755; objectSHA1: string }, ): { bytes: Uint8Array; stat: Stats } { const path = join(REPOSITORY_ROOT, relativePath);
  requireCondition( path.startsWith(`${REPOSITORY_ROOT}/`) && realpathSync(path) === path, "build_source_path", );
  const before = lstatSync(path);
  requireCondition( before.isFile() && !before.isSymbolicLink() && before.uid === OPERATOR_UID && before.gid === process.getgid?.() && before.nlink === 1 && (before.mode & 0o777) === expected.mode && before.size >= 0 &&
      before.size <= 5_000_000, "build_source_file", );
  const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
  try { const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const rebound = lstatSync(path);
    const gitHash = createHash("sha1") .update(`blob ${bytes.byteLength}\0`) .update(bytes) .digest("hex");
    const exactMetadata = (value: Stats): boolean => value.isFile() && !value.isSymbolicLink() && value.uid === OPERATOR_UID && value.gid === process.getgid?.() && value.nlink === 1 && (value.mode & 0o777) === expected.mode;
    requireCondition( sameFileIdentity(opened, before) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && opened.size === bytes.byteLength && after.size === opened.size && rebound.size === opened.size &&
        [opened, after, rebound].every(exactMetadata) && gitHash === expected.objectSHA1, "build_source_file", );
    return { bytes, stat: rebound }; } finally { closeSync(descriptor); } }

interface SuccessAuthorityContractRequest { successProvenAt: string;
  controllerRunID: string;
  rolloutID: string;
  refenceReceiptSHA256: string;
  sourceRevision: string;
  sourceTree: string;
  roles: RoleMap;
  marker: JsonRecord;
  databaseConvergence: JsonRecord;
  deployLock: JsonRecord;
  deployLockSHA256: string;
  earlyGuardSHA256: string;
  buildContext: JsonRecord;
  dependencyEstate: JsonRecord;
  refenceHandoff: JsonRecord;
  retainedArchives: JsonRecord;
  controllerWal: JsonRecord;
  rolloutProofs: JsonRecord;
  finalTruth: JsonRecord; }

interface SuccessArtifactContractBundle { authorityProjection: JsonRecord;
  authorityProjectionSHA256: string;
  markerBytesUTF8: string;
  markerSHA256: string;
  witness: JsonRecord;
  witnessBytesUTF8: string;
  witnessSHA256: string;
  receipt: JsonRecord;
  receiptBytesUTF8: string;
  receiptSHA256: string; }

interface VerifiedMaintenanceContract { schema: "agenttool-phase-b-refence-maintenance-contract/v1";
  expectedAuditWitness(targetDistance: number): JsonRecord;
  normalizedFullAudit(text: string): string;
  normalizedRefenceOperator( text: string, declarations: readonly (readonly [string, string, string])[], ): string;
  refenceOperatorDeclarationValues( text: string, declarations: readonly (readonly [string, string, string])[], ): Record<string, string>;
  refenceOperatorImmutableCaveats(text: string): readonly string[];
  validateFlyAuthenticationConfigText(text: string): void;
  databaseOriginContract: { schema: string;
    transaction_mode: string;
    transaction_statements: readonly string[];
    lock_sql: string;
    update_sql: string;
    parameter_order: readonly string[];
    update_column_set: readonly string[];
    client: Readonly<Record<string, unknown>>;
    outer_destructive_deadline_milliseconds: number; };
  maintenanceDatabaseProofSQL: string;
  validateDatabaseConvergenceMarker(value: unknown): void;
  validateDatabaseConvergenceTransition(current: unknown, next: unknown): void;
  validateDatabaseOriginConvergence( proof: DatabaseOriginConvergenceProof, before: DatabaseProof, after: DatabaseProof, ): { beforeProofSHA256: string; afterProofSHA256: string };
  validateDatabaseProof( raw: unknown, evidence: TerminalEvidence, expectedOrigin: { instanceURLSHA256: string; updatedAt: string }, ): DatabaseProof;
  validateDatabaseConvergenceInheritedProof(raw: unknown): DatabaseProof;
  validateControllerWalEntry( value: ControllerWalEntry, previous: ControllerWalEntry | null, history: readonly ControllerWalEntry[], expected: { controllerRunID: string;
      rolloutID: string;
      receiptSHA256: string; }, ): void;
  validateVerifiedDatabaseConvergence(request: { marker: unknown;
    result: ControllerDatabaseConvergenceResult;
    intent: ControllerWalEntry | null;
    commit: ControllerWalEntry | null;
    verified: ControllerWalEntry | null;
    lastEntry: ControllerWalEntry | null; }): string;
  controllerFlyArgv( operation: ControllerFlyOperation, pinnedFly: string, ): string[];
  controllerOperationContract(operation: ControllerFlyOperation): Readonly<{ effectKind: ControllerEffectKind;
    target: string;
    timeoutMilliseconds: number; }>;
  parseFleetChildOutput(bytes: Uint8Array): unknown[];
  expectedOrdinaryAbsentPostflightBytes(targetRevision: string): string;
  parsePublicObservation(bytes: Uint8Array): ControllerPublicJsonObservation;
  validateTargetFleetExpectation( evidence: TerminalEvidence, expectation: TargetFleetExpectation, ): void;
  validateStoppedFleet( raw: unknown, evidence: TerminalEvidence, ): StoppedFleetProof;
  producerCriticalContractSHA256( source: readonly SourceMigration[], evidence: TerminalEvidence, staticContract: typeof PRODUCER_CRITICAL_STATIC_CONTRACT, ): string;
  producerLocalStateSandwichSHA256(request: { anchorSHA256: string;
    firstWalSHA256: string;
    firstWalOrdinal: number;
    deployReceiptInventorySHA256: string;
    deployReceiptFileCount: number; }): string;
  validateProducerLocalStateSandwich( request: { anchorSHA256: string;
      firstWalSHA256: string;
      firstWalOrdinal: number;
      deployReceiptInventorySHA256: string;
      deployReceiptFileCount: number; }, claimedSHA256: string, ): string;
  validateProducerEarlyRuntimeBindings(request: { evidence: TerminalEvidence;
    databaseProof: DatabaseProof;
    firstFleet: StoppedFleetProof;
    secondFleet: StoppedFleetProof;
    staticContract: typeof PRODUCER_CRITICAL_STATIC_CONTRACT; }): string;
  validateTargetFleet( raw: unknown, evidence: TerminalEvidence, image: TargetImageContract, expectation: TargetFleetExpectation, ): string;
  validateFleetTransition(request: { beforeFirst: unknown;
    beforeSecond: unknown;
    first: unknown;
    second: unknown;
    evidence: TerminalEvidence;
    operation: ControllerFlyOperation;
    image: TargetImageContract | null;
    expectation: TargetFleetExpectation; }): ControllerFleetTransitionProof;
  validatePublicHealth(observation: any, targetRevision: string): string;
  validatePublicFederationAbout(observation: any): string;
  validateFirstCanaryPublic(request: any): JsonRecord;
  runFirstCanaryPublicCore(request: any): Promise<JsonRecord>;
  validateFinalAuthority(request: any): { publicProof: JsonRecord;
    authorityProof: JsonRecord; };
  runFinalAuthorityCore(request: any): Promise<{ publicProofSHA256: string;
    authorityProofSHA256: string; }>;
  runStoppedFenceCore(request: any): Promise<ControllerStoppedFenceProof>;
  runCordonedRuntimeCore(request: any): Promise<ControllerCordonedRuntimeProof>;
  createSuccessAuthorityProjection( request: SuccessAuthorityContractRequest, ): JsonRecord;
  createSuccessArtifacts(request: { authorityRequest: SuccessAuthorityContractRequest;
    authorityProjection: JsonRecord;
    markerPath: string;
    markerBytesUTF8: string;
    receiptPath: string;
    witnessPath: string;
    markerRetirementClaimPath: string;
    lockPublicPath: string;
    lockOwnerPath: string;
    lockDevice: string;
    lockInode: string;
    lockSHA256: string; }): SuccessArtifactContractBundle;
  validateSuccessArtifactBundle(bundle: SuccessArtifactContractBundle): void;
  previewSuccessFinalizationMarker(request: { currentMarker: JsonRecord;
    successProvenAt: string;
    walProjection: JsonRecord;
    authorityProjectionSHA256: string;
    receiptPath: string;
    witnessPath: string;
    markerRetirementClaimPath: string; }): JsonRecord;
  bridgeMarkerSuccessAuthorityProjection(value: JsonRecord): JsonRecord;
  validateBridgeMarkerTransition( current: JsonRecord, next: JsonRecord, ): void;
  applyRecoveryMarkerTransition( value: JsonRecord, operation: ControllerFlyOperation, roles: RoleMap, recoveryActive: boolean, ): void;
  validateProducerAuthorityProjection(request: { receipt: JsonRecord;
    walRecords: readonly { value: JsonRecord;
      sha256: string;
      filename: string; }[];
    anchor: { value: JsonRecord; sha256: string };
    witness: { value: JsonRecord; sha256: string }; }): JsonRecord; }

let verifiedMaintenanceContract: VerifiedMaintenanceContract | null = null;

interface MaintenanceContractBytes { bytes: Uint8Array;
  sha256: string;
  gitBlobSHA1: string; }

async function validateMaintenanceContractBytes( request: MaintenanceContractBytes, ): Promise<VerifiedMaintenanceContract> { const bytes = Uint8Array.from(request.bytes);
  requireCondition( request.sha256 === CONTRACT_SOURCE_SHA256 && request.gitBlobSHA1 === CONTRACT_SOURCE_GIT_BLOB && sha256(bytes) === request.sha256 && createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes)
          .digest("hex") === request.gitBlobSHA1, "maintenance_contract_source", );
  const moduleURL = URL.createObjectURL( new Blob([Buffer.from(bytes)], { type: "application/typescript" }), );
  let module: Record<string, any>;
  try { module = await import(moduleURL); } finally { URL.revokeObjectURL(moduleURL); }
  requireCondition( canonicalJson(Object.keys(module).sort()) === canonicalJson([ "CONTRACT_SCHEMA", "createMaintenanceContract", ]) && module.CONTRACT_SCHEMA === "agenttool-phase-b-refence-maintenance-contract/v1" &&
      typeof module.createMaintenanceContract === "function", "maintenance_contract_exports", );
  const created = module.createMaintenanceContract({ canonical: canonicalJson, digest: (value: string) => sha256(value), refuse, });
  const deeplyFrozen = (value: unknown, seen = new Set<object>()): boolean => { if (value === null || typeof value !== "object") return true;
    if (seen.has(value)) return true;
    seen.add(value);
    return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every((entry) => deeplyFrozen(entry, seen) ); };
  requireCondition( canonicalJson(Object.keys(created).sort()) === canonicalJson([ "applyRecoveryMarkerTransition", "bridgeMarkerSuccessAuthorityProjection", "controllerFlyArgv", "controllerOperationContract", "createSuccessArtifacts",
          "createSuccessAuthorityProjection", "databaseOriginContract", "expectedAuditWitness", "expectedOrdinaryAbsentPostflightBytes", "maintenanceDatabaseProofSQL", "normalizedFullAudit", "normalizedRefenceOperator",
          "parseFleetChildOutput", "parsePublicObservation", "previewSuccessFinalizationMarker", "producerCriticalContractSHA256", "producerLocalStateSandwichSHA256", "refenceOperatorDeclarationValues", "refenceOperatorImmutableCaveats",
          "runCordonedRuntimeCore", "runFinalAuthorityCore", "runFirstCanaryPublicCore", "runStoppedFenceCore", "schema", "validateBridgeMarkerTransition", "validateControllerWalEntry", "validateDatabaseConvergenceInheritedProof",
          "validateDatabaseConvergenceMarker", "validateDatabaseConvergenceTransition", "validateDatabaseOriginConvergence", "validateDatabaseProof", "validateFinalAuthority", "validateFirstCanaryPublic", "validateFleetTransition",
          "validateFlyAuthenticationConfigText", "validateProducerAuthorityProjection", "validateProducerEarlyRuntimeBindings", "validateProducerLocalStateSandwich", "validatePublicFederationAbout", "validatePublicHealth",
          "validateStoppedFleet", "validateSuccessArtifactBundle", "validateTargetFleet", "validateTargetFleetExpectation", "validateVerifiedDatabaseConvergence", ]) && created.schema ===
        "agenttool-phase-b-refence-maintenance-contract/v1" && Object.isFrozen(created) && deeplyFrozen(created.databaseOriginContract) && typeof created.expectedAuditWitness === "function" &&
      typeof created.expectedOrdinaryAbsentPostflightBytes === "function" && typeof created.normalizedFullAudit === "function" && typeof created.normalizedRefenceOperator === "function" &&
      typeof created.parseFleetChildOutput === "function" && typeof created.parsePublicObservation === "function" && typeof created.refenceOperatorDeclarationValues === "function" &&
      typeof created.refenceOperatorImmutableCaveats === "function" && typeof created.runCordonedRuntimeCore === "function" && typeof created.runFinalAuthorityCore === "function" && typeof created.runFirstCanaryPublicCore === "function" &&
      typeof created.runStoppedFenceCore === "function" && typeof created.applyRecoveryMarkerTransition === "function" && typeof created.bridgeMarkerSuccessAuthorityProjection === "function" &&
      typeof created.controllerFlyArgv === "function" && typeof created.controllerOperationContract === "function" && typeof created.createSuccessArtifacts === "function" && typeof created.createSuccessAuthorityProjection === "function" &&
      typeof created.previewSuccessFinalizationMarker === "function" && isRecord(created.databaseOriginContract) && typeof created.maintenanceDatabaseProofSQL === "string" && typeof created.producerCriticalContractSHA256 === "function" &&
      typeof created.producerLocalStateSandwichSHA256 === "function" && typeof created.validateBridgeMarkerTransition === "function" && typeof created.validateControllerWalEntry === "function" &&
      typeof created.validateDatabaseConvergenceInheritedProof === "function" && typeof created.validateDatabaseConvergenceMarker === "function" && typeof created.validateDatabaseConvergenceTransition === "function" &&
      typeof created.validateDatabaseOriginConvergence === "function" && typeof created.validateDatabaseProof === "function" && typeof created.validateFinalAuthority === "function" &&
      typeof created.validateFlyAuthenticationConfigText === "function" && typeof created.validateFleetTransition === "function" && typeof created.validateFirstCanaryPublic === "function" &&
      typeof created.validatePublicFederationAbout === "function" && typeof created.validatePublicHealth === "function" && typeof created.validateProducerAuthorityProjection === "function" &&
      typeof created.validateProducerEarlyRuntimeBindings === "function" && typeof created.validateProducerLocalStateSandwich === "function" && typeof created.validateStoppedFleet === "function" &&
      typeof created.validateSuccessArtifactBundle === "function" && typeof created.validateTargetFleet === "function" && typeof created.validateTargetFleetExpectation === "function" &&
      typeof created.validateVerifiedDatabaseConvergence === "function", "maintenance_contract_exports", );
  return Object.freeze(created); }

async function loadVerifiedMaintenanceContract(): Promise<void> { requireCondition( verifiedMaintenanceContract === null && realpathSync(CONTRACT_SOURCE) === CONTRACT_SOURCE, "maintenance_contract_source", );
  const before = readStableRepositoryBlob( "bin/phase-b-refence-maintenance-contract.ts", { mode: 0o644, objectSHA1: CONTRACT_SOURCE_GIT_BLOB }, );
  const created = await validateMaintenanceContractBytes({ bytes: before.bytes, sha256: CONTRACT_SOURCE_SHA256, gitBlobSHA1: CONTRACT_SOURCE_GIT_BLOB, });
  const after = readStableRepositoryBlob( "bin/phase-b-refence-maintenance-contract.ts", { mode: 0o644, objectSHA1: CONTRACT_SOURCE_GIT_BLOB }, );
  requireCondition( sameFileIdentity(before.stat, after.stat) && sha256(after.bytes) === CONTRACT_SOURCE_SHA256 && Buffer.from(before.bytes).equals(Buffer.from(after.bytes)), "maintenance_contract_source", );
  verifiedMaintenanceContract = created; }

/** @internal Validates caller-read adjacent repository bytes without custody bypass. */
export async function loadMaintenanceContractForContainedTest( request: MaintenanceContractBytes, ): Promise<void> { const created = await validateMaintenanceContractBytes(request);
  if (verifiedMaintenanceContract === null) { verifiedMaintenanceContract = created; } }

/** @internal Fresh exact-byte validator for contained mutation tests. */
export async function validateMaintenanceContractBytesForTest( request: MaintenanceContractBytes, ): Promise<void> { await validateMaintenanceContractBytes(request); }

function maintenanceContract(): VerifiedMaintenanceContract { requireCondition( verifiedMaintenanceContract !== null, "maintenance_contract_not_loaded", );
  return verifiedMaintenanceContract; }

/** @internal Pure success-authority constructor for contained tests. */
export function createSuccessAuthorityProjectionForTest( request: Parameters<
    VerifiedMaintenanceContract["createSuccessAuthorityProjection"]
  >[0], ): JsonRecord { return maintenanceContract().createSuccessAuthorityProjection(request); }

/** @internal Pure acyclic receipt/witness constructor for contained tests. */
export function createSuccessArtifactsForTest( request: Parameters<VerifiedMaintenanceContract["createSuccessArtifacts"]>[0], ): ReturnType<VerifiedMaintenanceContract["createSuccessArtifacts"]> {
  return maintenanceContract().createSuccessArtifacts(request); }

/** @internal Pure A0 preview shared with the production CAS. */
export function previewSuccessFinalizationMarkerForTest( request: Parameters<
    VerifiedMaintenanceContract["previewSuccessFinalizationMarker"]
  >[0], ): JsonRecord { return maintenanceContract().previewSuccessFinalizationMarker(request); }

/** @internal Full immutable success-artifact DAG validator. */
export function validateSuccessArtifactBundleForTest( bundle: SuccessArtifactContractBundle, ): void { maintenanceContract().validateSuccessArtifactBundle(bundle); }

function doctrineManifestNames(bytes: Uint8Array): string[] { const text = decode(bytes, "doctrine_manifest");
  requireCondition( text.endsWith("\n") && !text.includes("\r"), "doctrine_manifest", );
  const names = text.split("\n").filter((line) => line.length > 0 && !line.startsWith("#") );
  requireCondition( names.length > 0 && names.length <= 128 && names.every((name) => /^(?!\.)[A-Za-z0-9][A-Za-z0-9.-]*\.(?:md|jsonld)$/.test(name) && !name.includes("/") ) && new Set(names).size === names.length, "doctrine_manifest", );
  return names; }

async function prepareProductionBuildContext( evidence: TerminalEvidence, ): Promise<ControllerPreparationBinding["buildContext"]> { requireCondition( evidence.edge === "H0", "build_context_pre_handoff", );
  const treeResult = await runRefenceGitCLI([ "ls-tree", "-rz", "--full-tree", "HEAD", "--", "api", "docs", ]);
  requireCondition(treeResult.exitCode === 0, "build_git_tree");
  const tree = parseGitTreeFiles(treeResult.stdout);
  const manifestPath = "api/doctrine-docs.manifest";
  const manifestEntry = tree.get(manifestPath);
  requireCondition(manifestEntry !== undefined, "doctrine_manifest");
  const manifest = readStableRepositoryBlob(manifestPath, manifestEntry);
  const doctrineNames = doctrineManifestNames(manifest.bytes);
  const files: GitTreeFile[] = [];
  const fixedAPIInputs = new Set([ "api/.dockerignore", "api/fly.toml", "api/Dockerfile", "api/package.json", "api/bun.lock", "api/tsconfig.json", "api/certs/supabase-prod-ca-2021.crt", ]);
  for (const [path, metadata] of tree) { if (!path.startsWith("api/src/") && !fixedAPIInputs.has(path)) continue;
    files.push({ ...metadata, sourceRelativePath: path, destinationRelativePath: path.slice("api/".length), kind: "tracked_api", }); }
  const addBundled = ( sourceRelativePath: string, destinationRelativePath: string, kind: GitTreeFile["kind"], ): void => { const metadata = tree.get(sourceRelativePath);
    requireCondition(metadata !== undefined, "build_git_tree");
    files.push({ ...metadata, sourceRelativePath, destinationRelativePath, kind, }); };
  addBundled( "docs/agenttool.jsonld", "agenttool.jsonld.bundled", "bundled_registry", );
  addBundled( "docs/kingdom-bundle.json", "kingdom-bundle.json.bundled", "bundled_registry", );
  for (const name of doctrineNames) { addBundled( `docs/${name}`, `doctrine-docs.bundled/${name}`, "bundled_doctrine", ); }
  files.sort((left, right) => Buffer.compare( Buffer.from(left.destinationRelativePath, "utf8"), Buffer.from(right.destinationRelativePath, "utf8"), ) );
  requireCondition( files.filter((entry) => entry.sourceRelativePath.startsWith("api/src/")) .length === 679 && doctrineNames.length === 19 && files.length === EXPECTED_BUILD_FILE_COUNT &&
      new Set(files.map((entry) => entry.destinationRelativePath)).size === files.length && files.every((entry) => entry.mode === 0o644), "build_context_inventory", );
  createPrivateDirectoryExclusive(CONTROLLER_BUILD_ROOT, STATE_DIR);
  const contextPath = join(CONTROLLER_BUILD_ROOT, evidence.runID);
  const contextIdentity = createPrivateDirectoryExclusive( contextPath, CONTROLLER_BUILD_ROOT, );
  const directories = new Set<string>();
  for (const file of files) { const parts = dirname(file.destinationRelativePath).split("/").filter(( part, ) => part !== "." && part.length > 0);
    let relative = "";
    for (const part of parts) { relative = relative.length === 0 ? part : `${relative}/${part}`;
      directories.add(relative); } }
  for ( const relative of [...directories].sort((left, right) => { const depth = left.split("/").length - right.split("/").length;
      return depth === 0 ? left.localeCompare(right) : depth; }) ) { const parentRelative = dirname(relative);
    createBuildDirectoryExclusive( join(contextPath, relative), parentRelative === "." ? contextPath : join(contextPath, parentRelative), ); }
  const projection: JsonRecord[] = [];
  let byteCount = 0;
  for (const file of files) { const source = readStableRepositoryBlob(file.sourceRelativePath, file);
    const destination = join(contextPath, file.destinationRelativePath);
    const identity = createExclusiveDurableFile( destination, source.bytes, dirname(destination), 0o644, );
    byteCount += source.bytes.byteLength;
    projection.push({ destination_relative_path: file.destinationRelativePath, git_blob_sha1: file.objectSHA1, kind: file.kind, mode: "100644", sha256: identity.sha256, size: identity.size, source_relative_path: file.sourceRelativePath, });
  }
  requireCondition( byteCount === EXPECTED_BUILD_BYTE_COUNT, "build_context_inventory", );
  const manifestBytes = `${ projection.map((entry) => [ entry.destination_relative_path, entry.source_relative_path, entry.mode, entry.git_blob_sha1, entry.size, entry.sha256, ].join("\t") ).join("\n") }\n`;
  requireCondition( Buffer.byteLength(manifestBytes) === EXPECTED_BUILD_MANIFEST_BYTE_COUNT && sha256(manifestBytes) === EXPECTED_BUILD_MANIFEST_SHA256 && new Set(projection.map((entry) => entry.source_relative_path)).size === 706,
    "build_context_manifest", );
  const verifyContext = (): string => { const observedFiles: JsonRecord[] = [];
    const observedDirectories: string[] = [];
    const visit = (directory: string, relative: string): void => { const info = lstatSync(directory);
      requireCondition( info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && info.gid === process.getgid?.() && (info.mode & 0o777) === (relative === "" ? 0o700 : 0o755) &&
          realpathSync(directory) === directory, "build_context_readback", );
      for (const name of readdirSync(directory).sort()) { const path = join(directory, name);
        const childRelative = relative === "" ? name : `${relative}/${name}`;
        const child = lstatSync(path);
        requireCondition(!child.isSymbolicLink(), "build_context_readback");
        if (child.isDirectory()) { observedDirectories.push(childRelative);
          visit(path, childRelative); } else { requireCondition( child.isFile() && child.uid === process.getuid?.() && child.gid === process.getgid?.() && child.nlink === 1 && (child.mode & 0o777) === 0o644, "build_context_readback", );
          const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
          try { const opened = fstatSync(descriptor);
            const bytes = readFileSync(descriptor);
            const rebound = lstatSync(path);
            requireCondition( sameFileIdentity(opened, child) && sameFileIdentity(rebound, opened) && bytes.byteLength === opened.size, "build_context_readback", );
            observedFiles.push({ destination_relative_path: childRelative, sha256: sha256(bytes), size: bytes.byteLength, }); } finally { closeSync(descriptor); } } } };
    visit(contextPath, "");
    observedFiles.sort((left, right) => Buffer.compare( Buffer.from(left.destination_relative_path, "utf8"), Buffer.from(right.destination_relative_path, "utf8"), ) );
    requireCondition( canonicalJson(observedDirectories.sort()) === canonicalJson([...directories].sort()) && canonicalJson(observedFiles) === canonicalJson(projection.map((entry) => ({
            destination_relative_path: entry.destination_relative_path, sha256: entry.sha256, size: entry.size, }))), "build_context_readback", );
    return sha256(canonicalJson({ observedDirectories, observedFiles })); };
  const firstReadback = verifyContext();
  const secondReadback = verifyContext();
  requireCondition(firstReadback === secondReadback, "build_context_readback");
  for ( const relative of [...directories].sort((left, right) => { const depth = right.split("/").length - left.split("/").length;
      return depth === 0 ? Buffer.compare( Buffer.from(left, "utf8"), Buffer.from(right, "utf8"), ) : depth; }) ) { fsyncPath(join(contextPath, relative)); }
  fsyncPath(contextPath);
  const reboundContext = lstatSync(contextPath);
  requireCondition( reboundContext.dev === contextIdentity.dev && reboundContext.ino === contextIdentity.ino && reboundContext.isDirectory() && !reboundContext.isSymbolicLink() && reboundContext.uid === process.getuid?.() &&
      reboundContext.gid === process.getgid?.() && (reboundContext.mode & 0o777) === 0o700 && realpathSync(contextPath) === contextPath, "build_context_readback", );
  const readyPath = join( CONTROLLER_BUILD_ROOT, `${evidence.runID}.ready.json`, );
  const preparedAt = new Date().toISOString();
  requireCondition(validUtcTimestamp(preparedAt), "build_context_ready");
  const readyRecord = { schema: "agenttool-phase-b-refence-build-context-ready/v1", controller_run_id: evidence.runID, context_path: contextPath, context_device: reboundContext.dev, context_inode: reboundContext.ino,
    source_revision: evidence.targetRevision, source_tree: evidence.targetTree, manifest_sha256: EXPECTED_BUILD_MANIFEST_SHA256, manifest_byte_count: EXPECTED_BUILD_MANIFEST_BYTE_COUNT, staged_file_count: EXPECTED_BUILD_FILE_COUNT,
    staged_byte_count: EXPECTED_BUILD_BYTE_COUNT, readback_sha256: firstReadback, prepared_at: preparedAt, byte_path_equivalence_proven: true, tar_or_image_reproducibility_claimed: false, };
  const readyBytes = `${canonicalJson(readyRecord)}\n`;
  const readyIdentity = createExclusiveDurableFile( readyPath, readyBytes, CONTROLLER_BUILD_ROOT, );
  requireExactFileIdentity(readyPath, readyIdentity);
  const finalReadback = verifyContext();
  requireCondition(finalReadback === firstReadback, "build_context_readback");
  return { schema: "agenttool-phase-b-refence-build-context/v1", path: contextPath, source_revision: evidence.targetRevision, source_tree: evidence.targetTree, inventory_sha256: sha256(manifestBytes),
    inventory_byte_count: Buffer.byteLength(manifestBytes), file_count: projection.length, byte_count: byteCount, context_device: reboundContext.dev, context_inode: reboundContext.ino, readback_sha256: firstReadback, ready_path: readyPath,
    ready_sha256: readyIdentity.sha256, prepared: true, }; }

function requireProductionBuildContext( binding: ControllerPreparationBinding["buildContext"], ): void { const context = lstatSync(binding.path);
  requireCondition( context.isDirectory() && !context.isSymbolicLink() && context.dev === binding.context_device && context.ino === binding.context_inode && context.uid === process.getuid?.() && context.gid === process.getgid?.() &&
      (context.mode & 0o777) === 0o700 && realpathSync(binding.path) === binding.path && binding.inventory_sha256 === EXPECTED_BUILD_MANIFEST_SHA256 && binding.inventory_byte_count === EXPECTED_BUILD_MANIFEST_BYTE_COUNT &&
      binding.file_count === EXPECTED_BUILD_FILE_COUNT && binding.byte_count === EXPECTED_BUILD_BYTE_COUNT, "build_context_binding", );
  const ready = readStablePrivateFile(binding.ready_path);
  requireCondition( sha256(ready.bytes) === binding.ready_sha256, "build_context_binding", );
  const readyValue = parseCanonicalJsonBytes( ready.bytes, "build_context_ready", );
  exactKeys( readyValue, [ "schema", "controller_run_id", "context_path", "context_device", "context_inode", "source_revision", "source_tree", "manifest_sha256", "manifest_byte_count", "staged_file_count", "staged_byte_count",
      "readback_sha256", "prepared_at", "byte_path_equivalence_proven", "tar_or_image_reproducibility_claimed", ], "build_context_ready", );
  requireCondition( readyValue.schema === "agenttool-phase-b-refence-build-context-ready/v1" && readyValue.controller_run_id === basename(binding.path) && readyValue.context_path === binding.path &&
      readyValue.context_device === binding.context_device && readyValue.context_inode === binding.context_inode && readyValue.source_revision === binding.source_revision && readyValue.source_tree === binding.source_tree &&
      readyValue.manifest_sha256 === binding.inventory_sha256 && readyValue.manifest_byte_count === binding.inventory_byte_count && readyValue.staged_file_count === binding.file_count &&
      readyValue.staged_byte_count === binding.byte_count && readyValue.readback_sha256 === binding.readback_sha256 && validUtcTimestamp(readyValue.prepared_at) && readyValue.byte_path_equivalence_proven === true &&
      readyValue.tar_or_image_reproducibility_claimed === false, "build_context_binding", );
  const observedDirectories: string[] = [];
  const observedFiles: JsonRecord[] = [];
  let byteCount = 0;
  const visit = (directory: string, relative: string): void => { const directoryInfo = lstatSync(directory);
    requireCondition( directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink() && directoryInfo.uid === process.getuid?.() && directoryInfo.gid === process.getgid?.() &&
        (directoryInfo.mode & 0o777) === (relative === "" ? 0o700 : 0o755) && realpathSync(directory) === directory, "build_context_binding", );
    for (const name of readdirSync(directory).sort()) { const path = join(directory, name);
      const childRelative = relative === "" ? name : `${relative}/${name}`;
      const child = lstatSync(path);
      requireCondition(!child.isSymbolicLink(), "build_context_binding");
      if (child.isDirectory()) { observedDirectories.push(childRelative);
        visit(path, childRelative);
        continue; }
      requireCondition( child.isFile() && child.uid === process.getuid?.() && child.gid === process.getgid?.() && child.nlink === 1 && (child.mode & 0o777) === 0o644, "build_context_binding", );
      const descriptor = openSync( path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW, );
      try { const opened = fstatSync(descriptor);
        const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
        const rebound = lstatSync(path);
        requireCondition( sameFileIdentity(opened, child) && sameFileIdentity(after, opened) && sameFileIdentity(rebound, opened) && bytes.byteLength === opened.size, "build_context_binding", );
        byteCount += bytes.byteLength;
        observedFiles.push({ destination_relative_path: childRelative, sha256: sha256(bytes), size: bytes.byteLength, }); } finally { closeSync(descriptor); } } };
  visit(binding.path, "");
  observedDirectories.sort();
  observedFiles.sort((left, right) => Buffer.compare( Buffer.from(left.destination_relative_path, "utf8"), Buffer.from(right.destination_relative_path, "utf8"), ) );
  requireCondition( observedFiles.length === binding.file_count && byteCount === binding.byte_count && sha256(canonicalJson({ observedDirectories, observedFiles })) === binding.readback_sha256, "build_context_binding", ); }

async function runRefenceProcessCensus(): Promise<
  { exitCode: number; stdout: Uint8Array }
> { requirePinnedSystemExecutable(PS, PS_SHA256, 1);
  const result = await readBoundedChild([PS, "-axo", "pid=,ppid=,command="], { cwd: HOME, });
  requirePinnedSystemExecutable(PS, PS_SHA256, 1);
  return result; }

async function readSettledDatabaseURLs(): Promise<{ transaction: string;
  session: string; }> { const read = async (service: string): Promise<string> => { const result = await runRefenceSecurityCLI([ "find-generic-password", "-s", service, "-a", KEYCHAIN_ACCOUNT, "-w", ]);
    requireCondition(result.exitCode === 0, "database_credentials");
    let value = decode(result.stdout, "database_credentials");
    if (value.endsWith("\n")) value = value.slice(0, -1);
    if (value.endsWith("\r")) value = value.slice(0, -1);
    requireCondition( value.length > 0 && value.length <= 20_000 && !value.includes("\n") && !value.includes("\r"), "database_credentials", );
    return value; };
  const transaction = await read("agenttool-database-url");
  const session = await read("agenttool-database-session-url");
  requireCondition(transaction !== session, "database_credentials");
  return { transaction, session }; }

async function requireExactMigrationDefinitions(tx: any): Promise<void> { const columns = await tx.unsafe(`
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
           a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid, true) AS column_default,
           col_description(c.oid, a.attnum) AS column_comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE NOT a.attisdropped
       AND ((n.nspname='federation' AND c.relname='settings'
             AND a.attname='covenant_v2_generation_hold')
         OR (n.nspname='economy' AND c.relname='crypto_webhook_events'
             AND a.attname='credit_remainder_base'))
     ORDER BY n.nspname, c.relname, a.attname
  `);
  const hold = columns.find((row: JsonRecord) => row.table_schema === "federation" && row.table_name === "settings" && row.column_name === "covenant_v2_generation_hold" );
  const remainder = columns.find((row: JsonRecord) => row.table_schema === "economy" && row.table_name === "crypto_webhook_events" && row.column_name === "credit_remainder_base" );
  requireCondition( columns.length === 2 && hold && remainder && hold.formatted_type === "boolean" && hold.attnotnull === true && hold.column_default === "false" && hold.column_comment === HOLD_COLUMN_COMMENT &&
      remainder.formatted_type === "numeric(78,0)" && remainder.attnotnull === false && remainder.column_default === null && remainder.column_comment === REMAINDER_COLUMN_COMMENT, "database_definitions", );

  const constraints = await tx.unsafe(`
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           con.conname, con.contype, con.convalidated,
           con.condeferrable, con.condeferred,
           pg_get_constraintdef(con.oid, true) AS definition,
           pg_get_expr(con.conbin, con.conrelid, true) AS expression
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname, con.conname) IN (
       ('federation','settings','federation_settings_covenant_v2_generation_hold_empty'),
       ('economy','crypto_webhook_events','crypto_webhook_events_credit_remainder_exact_check'),
       ('economy','crypto_webhook_events','crypto_webhook_events_credit_remainder_range_check'),
       ('economy','crypto_webhook_events','crypto_webhook_events_nonintegral_not_creditable_check'),
       ('economy','crypto_webhook_events','crypto_webhook_events_remainder_quarantine_check')
     )
     ORDER BY n.nspname, c.relname, con.conname
  `);
  requireCondition( constraints.length === Object.keys(EXPECTED_CONSTRAINT_DEFINITIONS).length, "database_definitions", );
  for (const row of constraints) { const expected = EXPECTED_CONSTRAINT_DEFINITIONS[row.conname];
    const schema = row.conname.startsWith("federation_") ? "federation" : "economy";
    requireCondition( expected !== undefined && row.table_schema === schema && row.table_name === (schema === "federation" ? "settings" : "crypto_webhook_events") && row.contype === "c" && row.convalidated === true &&
        row.condeferrable === false && row.condeferred === false && row.definition === expected[0] && row.expression === expected[1], "database_definitions", ); }

  const indexes = await tx.unsafe(`
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           i.relname AS index_name, am.amname AS access_method,
           ix.indisunique, ix.indisprimary, ix.indisvalid, ix.indisready,
           ix.indislive, ix.indisreplident, ix.indnkeyatts, ix.indnatts,
           ix.indexprs IS NULL AS no_expressions,
           ix.indoption::text AS index_options,
           pg_get_indexdef(ix.indexrelid) AS definition,
           pg_get_expr(ix.indpred, ix.indrelid, true) AS predicate,
           ARRAY(
             SELECT a.attname
               FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=k.attnum
              WHERE k.ord <= ix.indnkeyatts ORDER BY k.ord
           ) AS key_columns,
           ARRAY(
             SELECT opc.opcname
               FROM unnest(ix.indclass::oid[]) WITH ORDINALITY k(opclass_oid, ord)
               JOIN pg_opclass opc ON opc.oid=k.opclass_oid ORDER BY k.ord
           ) AS opclasses
      FROM pg_index ix
      JOIN pg_class i ON i.oid=ix.indexrelid
      JOIN pg_class c ON c.oid=ix.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_am am ON am.oid=i.relam
     WHERE n.nspname='economy' AND c.relname='crypto_webhook_events'
       AND i.relname='idx_crypto_event_credit_remainder'
  `);
  requireCondition(indexes.length === 1, "database_definitions");
  const index = indexes[0];
  requireCondition( index.table_schema === "economy" && index.table_name === "crypto_webhook_events" && index.index_name === "idx_crypto_event_credit_remainder" && index.access_method === "btree" && index.indisunique === false &&
      index.indisprimary === false && index.indisvalid === true && index.indisready === true && index.indislive === true && index.indisreplident === false && Number(index.indnkeyatts) === 2 &&
      Number(index.indnatts) === 2 && index.no_expressions === true && index.index_options === "0 0" && canonicalJson(index.key_columns) === canonicalJson(["status", "received_at"]) && canonicalJson(index.opclasses) ===
        canonicalJson(["text_ops", "timestamptz_ops"]) && index.predicate === "credit_remainder_base > 0::numeric" && index.definition ===
        "CREATE INDEX idx_crypto_event_credit_remainder ON economy.crypto_webhook_events USING btree (status, received_at) WHERE (credit_remainder_base > (0)::numeric)", "database_definitions", );

  const functions = await tx.unsafe(`
    SELECT n.nspname AS function_schema, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_result(p.oid) AS function_result,
           l.lanname, p.prokind, p.provolatile, p.prosecdef,
           p.proleakproof, p.proisstrict, p.proparallel, p.proconfig,
           p.pronargs, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang
     WHERE n.nspname='economy'
       AND p.proname='enforce_crypto_webhook_observation_generation'
  `);
  requireCondition(functions.length === 1, "database_definitions");
  const fn = functions[0];
  requireCondition( fn.function_schema === "economy" && fn.identity_arguments === "" && fn.function_result === "trigger" && fn.lanname === "plpgsql" && fn.prokind === "f" && fn.provolatile === "v" && fn.prosecdef === false &&
      fn.proleakproof === false && fn.proisstrict === false && fn.proparallel === "u" && fn.proconfig === null && Number(fn.pronargs) === 0 && typeof fn.prosrc === "string" && sha256(fn.prosrc) === GENERATION_FUNCTION_PROSRC_SHA256,
    "database_definitions", );

  const triggers = await tx.unsafe(`
    SELECT tn.nspname AS table_schema, c.relname AS table_name, t.tgname,
           t.tgenabled, t.tgisinternal, t.tgtype,
           t.tgqual IS NULL AS no_when_clause,
           octet_length(t.tgargs) AS argument_bytes,
           t.tgconstraint=0 AS no_constraint,
           t.tgoldtable IS NULL AS no_old_transition,
           t.tgnewtable IS NULL AS no_new_transition,
           pn.nspname AS function_schema, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           ARRAY(
             SELECT a.attname
               FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.attnum
              ORDER BY k.ord
           ) AS update_columns
      FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace tn ON tn.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace pn ON pn.oid=p.pronamespace
     WHERE tn.nspname='economy' AND c.relname='crypto_webhook_events'
       AND t.tgname='crypto_webhook_events_observation_generation_guard'
  `);
  requireCondition(triggers.length === 1, "database_definitions");
  const trigger = triggers[0];
  requireCondition( trigger.table_schema === "economy" && trigger.table_name === "crypto_webhook_events" && trigger.tgenabled === "O" && trigger.tgisinternal === false && Number(trigger.tgtype) === 19 && trigger.no_when_clause === true &&
      Number(trigger.argument_bytes) === 0 && trigger.no_constraint === true && trigger.no_old_transition === true && trigger.no_new_transition === true && trigger.function_schema === "economy" &&
      trigger.proname === "enforce_crypto_webhook_observation_generation" && trigger.identity_arguments === "" && canonicalJson(trigger.update_columns) === canonicalJson(["status", "observation_generation"]), "database_definitions", ); }

function requireProductionControllerLaunchContract(): void { const environment = { ...process.env } as Record<string, string | undefined>;
  requireCondition( homedir() === HOME && process.env.HOME === HOME && process.env.USER === OPERATOR_NAME && process.env.LOGNAME === OPERATOR_NAME && canonicalJson(Object.keys(environment).sort()) ===
        canonicalJson(Object.keys(CONTROLLER_ENVIRONMENT).sort()) && Object.entries(CONTROLLER_ENVIRONMENT).every(([key, value]) => environment[key] === value ) && process.getuid?.() === OPERATOR_UID && realpathSync(HOME) === HOME &&
      realpathSync(process.execPath) === PINNED_BUN && canonicalJson(process.execArgv) === canonicalJson([ "--no-install", "--no-env-file", "--config=/dev/null", `--cwd=${REPOSITORY_ROOT}`, ]) && process.argv[1] === BRIDGE_SOURCE &&
      process.cwd() === REPOSITORY_ROOT && realpathSync(REPOSITORY_ROOT) === REPOSITORY_ROOT && realpathSync(BRIDGE_SOURCE) === BRIDGE_SOURCE, "canonical_home", );
  requirePrivateDirectory(STATE_DIR);
  requirePrivateDirectory(DEPLOY_STATE_DIR);
  const nullDevice = lstatSync("/dev/null");
  requireCondition( nullDevice.isCharacterDevice() && !nullDevice.isSymbolicLink() && nullDevice.uid === 0 && nullDevice.gid === 0 && nullDevice.nlink === 1 && (nullDevice.mode & 0o777) === 0o666 &&
      realpathSync("/dev/null") === "/dev/null", "null_device_contract", );
  requirePinnedBunController();
  requirePinnedUserExecutable(PINNED_FLY, PINNED_FLY_SHA256, "fly_contract");
  requirePinnedSystemExecutable(SECURITY, SECURITY_SHA256, 1);
  requirePinnedSystemExecutable(GIT, GIT_SHA256, 78);
  requirePinnedSystemExecutable(PS, PS_SHA256, 1); }

async function createProductionDependencies( evidence: TerminalEvidence, dependencyEstate: ControllerPreparationBinding["dependencyEstate"], ): Promise<
  PreparedMaintenanceRefenceDependencies
> { requireCondition( evidence.edge === "H0", "production_dependencies_pre_handoff", );
  requireProductionControllerLaunchContract();
  requireCondition( dependencyEstate.source_revision === evidence.targetRevision && dependencyEstate.source_tree === evidence.targetTree, "dependency_estate_binding", );
  const preCredentialGit = await readProductionGitProof();
  requireCondition( preCredentialGit.clean === true && preCredentialGit.revision === evidence.targetRevision && preCredentialGit.tree === evidence.targetTree && preCredentialGit.bridge_source_sha256 === evidence.bridgeRawSHA256,
    "dependency_estate_git_binding", );
  requireDependencyEstate(dependencyEstate);
  const databaseURLs = await readSettledDatabaseURLs();
  requireDependencyEstate(dependencyEstate);
  const targetModuleURL = pathToFileURL( join(dependencyEstate.project_path, "src/db/supabase-target.ts"), ).href;
  const postgresModuleURL = pathToFileURL( join(dependencyEstate.project_path, "src/db/verified-postgres.ts"), ).href;
  const [{ validateFlyDatabaseTargets }, postgresModule] = await Promise.all([ import(targetModuleURL), import(postgresModuleURL), ]);
  requireCondition( typeof validateFlyDatabaseTargets === "function" && typeof postgresModule.default === "function", "dependency_estate_import", );
  requireDependencyEstate(dependencyEstate);
  const settledDatabaseTarget = validateFlyDatabaseTargets( databaseURLs.transaction, databaseURLs.session, );
  requireDependencyEstate(dependencyEstate);
  const databaseTargetSHA256 = sha256(canonicalJson(settledDatabaseTarget));
  const clients = createDatabaseClientRegistry();
  let childLaunchersSealed = false;
  let postflightEnvironmentTaken = false;
  let databaseConvergenceConsumed = false;
  let expectedInstanceURL = PRE_REFENCE_INSTANCE_URL;
  let expectedFederationUpdatedAt = EXPECTED_FEDERATION_UPDATED_AT;
  const requirePreHandoffChildAuthority = (): void => { const anchor = parsePrivateJson(MAINTENANCE_MARKER);
    const witness = parsePrivateJson(ARMED_WITNESS);
    requireCondition( !childLaunchersSealed && evidence.edge === "H0" && anchor.value.schema === "agenttool-phase-b-refence-observed-526-anchor/v1" && anchor.digest === evidence.anchorSHA256 && anchor.stat.dev === evidence.anchorStat.dev &&
        anchor.stat.ino === evidence.anchorStat.ino && anchor.stat.nlink === 1 && witness.value.schema === "agenttool-phase-b-refence-observed-526-armed-witness/v1" && witness.digest === evidence.witnessSHA256 &&
        witness.stat.dev === evidence.witnessStat.dev && witness.stat.ino === evidence.witnessStat.ino && witness.stat.nlink === 1 && absent(evidence.anchorArchivePath) && absent(evidence.witnessArchivePath) &&
        absent(handoffStagePath(evidence.runID)), "pre_handoff_child_authority", ); };
  const pause = (milliseconds: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
  const close = (): Promise<void> => clients.closeAll();
  const takeOrdinaryPostflightDatabaseEnvironment = (): Readonly<{ DATABASE_URL: string;
    DATABASE_SESSION_URL: string; }> => { requireCondition( childLaunchersSealed && !postflightEnvironmentTaken && databaseURLs.transaction.length > 0 && databaseURLs.session.length > 0, "ordinary_postflight_database_capability", );
    requireDependencyEstate(dependencyEstate);
    postflightEnvironmentTaken = true;
    return Object.freeze({ DATABASE_URL: databaseURLs.transaction, DATABASE_SESSION_URL: databaseURLs.session, }); };
  const readDatabaseProof = async (): Promise<DatabaseProof> => { requireDependencyEstate(dependencyEstate);
    requireCondition( canonicalJson(validateFlyDatabaseTargets( databaseURLs.transaction, databaseURLs.session, )) === canonicalJson(settledDatabaseTarget), "database_target_drift", );
    requireDependencyEstate(dependencyEstate);
    let transaction: any = null;
    let session: any = null;
    try { transaction = clients.register( postgresModule.default(databaseURLs.transaction, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {}, connection: { application_name: "agenttool_phase_b_refence_bridge_transaction", },
        }), );
      session = clients.register( postgresModule.default(databaseURLs.session, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {}, connection: { application_name: "agenttool_phase_b_refence_bridge_session", }, }), );
    } catch (error) { try { await clients.closeClients([transaction]); } catch {}
      throw error; }
    requireDependencyEstate(dependencyEstate);
    let operationFailed = false;
    try { const source = sourceMigrationInventory();
      const sourceByName = new Map( source.map((entry) => [entry.filename, entry.checksum]), );
      const journalFor = async (sql: any): Promise<ProducerJournalRow[]> => sql.begin( "read only isolation level repeatable read", async (tx: any) => { await tx.unsafe("SET LOCAL statement_timeout = 15000");
            const rawRows = await tx.unsafe(`
            SELECT filename, checksum,
                   to_char(applied_at AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS applied_at
              FROM meta._migrations ORDER BY filename
          `);
            requireCondition( Array.isArray(rawRows) && rawRows.length === source.length && rawRows.length === EXPECTED_JOURNAL_FILE_COUNT, "database_journal", );
            const rows = rawRows.map((raw: unknown): ProducerJournalRow => { exactKeys( raw, ["applied_at", "checksum", "filename"], "database_journal", );
              const row = raw as JsonRecord;
              requireCondition( validMigrationFilename(row.filename) && validSha(row.checksum) && typeof row.applied_at === "string" && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/ .test( row.applied_at, ) &&
                  Number.isFinite(Date.parse(row.applied_at)) && sourceByName.get(row.filename) === row.checksum, "database_journal", );
              return { filename: row.filename, checksum: row.checksum, applied_at: row.applied_at, }; });
            requireCondition( new Set(rows.map((row) => row.filename)).size === rows.length && canonicalJson(rows.map((row) => row.filename)) === canonicalJson(source.map((entry) => entry.filename)), "database_journal", );
            return rows; }, );
      const [firstTransactionJournal, firstSessionJournal] = await Promise.all([ journalFor(transaction), journalFor(session), ]);
      requireCondition( canonicalJson(firstTransactionJournal) === canonicalJson(firstSessionJournal), "database_journal", );
      const targetApplied = EXPECTED_MIGRATIONS.map( ([filename, checksum], index) => { const row = firstTransactionJournal.find((entry) => entry.filename === filename );
          requireCondition( row?.checksum === checksum && row.applied_at === EXPECTED_MIGRATION_APPLIED_AT[index], "database_journal", );
          return row.applied_at; }, ) as [string, string];

      await session.begin( "read only isolation level repeatable read", async (tx: any) => { await tx.unsafe("SET LOCAL statement_timeout = 15000");
          await requireExactMigrationDefinitions(tx);
          const affected = await tx.unsafe(`
            SELECT id::text, status, amount_base::text,
                   credits_added::text, credited_generation::text
              FROM economy.crypto_webhook_events
             WHERE amount_base IS NOT NULL AND MOD(amount_base, 10000) > 0
             ORDER BY received_at, id LIMIT 1
          `);
          requireCondition( Array.isArray(affected) && affected.length === 0 && sha256(canonicalJson(affected)) === "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", "database_remainder", ); }, );

      const snapshots: Array<{ row: JsonRecord;
        informational: { payout_requested: number; x402_inserted: number };
        cronSHA256: string; }> = [];
      for (let sample = 0; sample < 3; sample += 1) { const snapshot = await session.begin( "read only isolation level repeatable read", async (tx: any) => { await tx.unsafe("SET LOCAL statement_timeout = 15000");
            const [rows, cronRows] = await Promise.all([ tx.unsafe(maintenanceContract().maintenanceDatabaseProofSQL), tx.unsafe(`
                SELECT jobname, schedule, command, database, username, active
                  FROM cron.job ORDER BY jobname
              `), ]);
            requireCondition( Array.isArray(rows) && rows.length === 1, "database_proof", );
            const row = record(rows[0], "database_proof");
            exactKeys(row, DATABASE_PROOF_ROW_KEYS, "database_proof");
            requireCondition( Number(row.settings_rows) === 1 && Number(row.federation_id) === 1 && row.federation_enabled === false && row.federation_instance_url === expectedInstanceURL && Array.isArray(row.federation_allowed_origins) &&
                canonicalJson(row.federation_allowed_origins) === "[]" && row.generation_hold === false && row.federation_updated_at === expectedFederationUpdatedAt && Number(row.hold_column_exact) === 1 &&
                Number(row.hold_constraint_exact) === 1 && Number(row.remainder_column_exact) === 1 && Number(row.remainder_constraints) === 4 && Number(row.remainder_index) === 1 && Number(row.generation_function) === 1 &&
                Number(row.remainder_mismatch) === 0 && Number(row.remainder_creditable) === 0 && Number(row.false_remainder_quarantine) === 0 && Number(row.remainder_affected_count) === 0, "database_proof", );
            const cronProjection = cronRows.map((entry: unknown) => { exactKeys( entry, [ "active", "command", "database", "jobname", "schedule", "username", ], "database_cron", );
              const value = entry as JsonRecord;
              requireCondition( typeof value.jobname === "string" && typeof value.schedule === "string" && typeof value.command === "string" && typeof value.database === "string" &&
                  typeof value.username === "string" && value.active === true, "database_cron", );
              return { name: value.jobname, schedule: value.schedule, command: value.command, database: value.database, username: value.username, active: value.active, }; }).sort((left: JsonRecord, right: JsonRecord) => Buffer.compare(
                Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8"), ) );
            const cronSHA256 = sha256(JSON.stringify(cronProjection));
            requireCondition( canonicalJson( cronProjection.map((entry: JsonRecord) => [ entry.name, entry.schedule, ]), ) === canonicalJson(EXPECTED_CRON) && cronSHA256 === EXPECTED_CRON_SHA256, "database_cron", );
            for (const field of ZERO_DRAIN_FIELDS) { const count = Number(row[field]);
              requireCondition( Number.isSafeInteger(count) && count >= 0 && count === 0, "database_drain", ); }
            const payoutRequested = Number(row.payout_requested);
            const x402Inserted = Number(row.x402_inserted);
            requireCondition( Number.isSafeInteger(payoutRequested) && payoutRequested >= 0 && Number.isSafeInteger(x402Inserted) && x402Inserted >= 0, "database_drain", );
            return { row, informational: { payout_requested: payoutRequested, x402_inserted: x402Inserted, }, cronSHA256, }; }, );
        if (snapshots.length > 0) { requireCondition( canonicalJson(snapshot.informational) === canonicalJson(snapshots[0]!.informational), "database_drain", ); }
        snapshots.push(snapshot);
        if (sample < 2) { await new Promise((resolvePromise) => setTimeout(resolvePromise, STABLE_DRAIN_INTERVAL_MS) ); } }
      const [finalTransactionJournal, finalSessionJournal] = await Promise.all([ journalFor(transaction), journalFor(session), ]);
      requireCondition( canonicalJson(firstTransactionJournal) === canonicalJson(finalTransactionJournal) && canonicalJson(firstSessionJournal) === canonicalJson(finalSessionJournal) && canonicalJson(finalTransactionJournal) ===
            canonicalJson(finalSessionJournal), "database_journal", );
      const row = snapshots[0]!.row;
      const exactOneFields = [ "hold_column_exact", "hold_constraint_exact", "remainder_column_exact", "remainder_index", "generation_function", ];
      const migrationDataVerified = exactOneFields.every((field) => Number(row[field]) === 1 ) && Number(row.remainder_constraints) === 4 && Number(row.remainder_mismatch) === 0 && Number(row.remainder_creditable) === 0 &&
        Number(row.false_remainder_quarantine) === 0;
      const producerDrainSnapshots: ProducerDrainSnapshot[] = snapshots.map( (snapshot) => ({ counts: Object.fromEntries( ZERO_DRAIN_FIELDS.map((field) => [ field, Number(snapshot.row[field]), ]), ), informational: snapshot.informational,
          cron_sha256: snapshot.cronSHA256, }), );
      const proof: DatabaseProof = { source_inventory_sha256: sha256(canonicalJson(source)), journal_file_count: firstTransactionJournal.length, journal_endpoint_count: 2, journal_observation_count: 4, journal_inventory_sha256: sha256(
          canonicalJson(firstTransactionJournal), ), target_migration_applied_at: targetApplied, migration_definitions_verified: true, migration_data_verified: migrationDataVerified,
        remainder_affected_count: Number(row.remainder_affected_count), federation_disabled: Number(row.settings_rows) === 1 && Number(row.federation_id) === 1 && row.federation_enabled === false &&
          row.federation_instance_url === expectedInstanceURL && row.federation_updated_at === expectedFederationUpdatedAt, federation_instance_url_sha256: sha256( String(row.federation_instance_url), ),
        federation_updated_at: String(row.federation_updated_at), durable_hold: row.generation_hold, allowed_origins_count: Array.isArray(row.federation_allowed_origins) ? row.federation_allowed_origins.length : -1,
        reserved_generation_rows: Number(row.reserved_generation_rows), authoritative_v2_rows: Number(row.authoritative_v2_rows), received_v1_rows: Number(row.received_v1_rows), drain_sample_count: 3,
        drain_informational: snapshots[0]!.informational, drain_zero: true, cron_sha256: snapshots[0]!.cronSHA256, database_target_sha256: databaseTargetSHA256, producer_authority: { source_migrations: source, terminal_journal: {
            transaction: { rows: finalTransactionJournal, targetAppliedAt: targetApplied, }, session: { rows: finalSessionJournal, targetAppliedAt: targetApplied, }, }, terminal_drain_snapshots: producerDrainSnapshots, }, };
      requireDependencyEstate(dependencyEstate);
      return proof; } catch (error) { operationFailed = true;
      throw error; } finally { try { await clients.closeClients([transaction, session]); } catch (error) { if (!operationFailed) throw error; } } };
  const convergeFederationInstanceURL = async (): Promise<
    DatabaseOriginConvergenceProof
  > => { requireCondition( childLaunchersSealed && !databaseConvergenceConsumed && clients.activeCount() === 0 && activeProductionChild === null && productionInterrupted === null && expectedInstanceURL === PRE_REFENCE_INSTANCE_URL &&
        expectedFederationUpdatedAt === EXPECTED_FEDERATION_UPDATED_AT && databaseOriginStatementSHA256ForTest() === DATABASE_ORIGIN_STATEMENT_SHA256, "database_convergence_admission", );
    databaseConvergenceConsumed = true;
    requireDependencyEstate(dependencyEstate);
    const sql = clients.register( postgresModule.default(databaseURLs.transaction, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {}, connection: { application_name: "agenttool_phase_b_refence_database_convergence", }, }),
    );
    let acknowledged: DatabaseOriginConvergenceProof | null = null;
    let forcedClose = false;
    const projection = (raw: JsonRecord): JsonRecord => ({ allowed_origins: raw.allowed_origins, covenant_v2_generation_hold: raw.covenant_v2_generation_hold, enabled: raw.enabled, id: Number(raw.id), });
    const rowProof = (raw: JsonRecord): JsonRecord => ({ ...projection(raw), instance_url_sha256: sha256(String(raw.instance_url)), updated_at: raw.updated_at, });
    const requireBaseRow = ( raw: unknown, expectedURL: string, expectedUpdatedAt: string, includeAuthority: boolean, ): JsonRecord => { const row = record(raw, "database_convergence_row");
      exactKeys( row, includeAuthority ? [ "allowed_origins", "authoritative_v2_rows", "clock_before", "covenant_v2_generation_hold", "enabled", "id", "instance_url", "received_v1_rows", "reserved_generation_rows", "settings_rows",
            "updated_at", ] : [ "allowed_origins", "clock_after", "covenant_v2_generation_hold", "enabled", "id", "instance_url", "updated_at", ], "database_convergence_row", );
      requireCondition( Number(row.id) === 1 && row.enabled === false && row.instance_url === expectedURL && canonicalJson(row.allowed_origins) === "[]" && row.covenant_v2_generation_hold === false && row.updated_at === expectedUpdatedAt &&
          (!includeAuthority || (Number(row.settings_rows) === 1 && Number(row.reserved_generation_rows) === 0 && Number(row.authoritative_v2_rows) === 0 && Number(row.received_v1_rows) === 0 && validUtcTimestamp(row.clock_before))),
        "database_convergence_row", );
      return row; };
    const originContract = maintenanceContract().databaseOriginContract;
    const transactionPromise = sql.begin( originContract.transaction_mode, async (tx: any): Promise<DatabaseOriginConvergenceProof> => { for (const statement of originContract.transaction_statements) { await tx.unsafe(statement);
          requireCondition( productionInterrupted === null, "database_convergence_interrupted", ); }
        const lockedRows = await tx.unsafe(originContract.lock_sql);
        requireCondition( Array.isArray(lockedRows) && lockedRows.length === 1, "database_convergence_lock", );
        const before = requireBaseRow( lockedRows[0], PRE_REFENCE_INSTANCE_URL, EXPECTED_FEDERATION_UPDATED_AT, true, );
        const updatedRows = await tx.unsafe(originContract.update_sql, [ TARGET_INSTANCE_URL, PRE_REFENCE_INSTANCE_URL, EXPECTED_FEDERATION_UPDATED_AT, ]);
        requireCondition( productionInterrupted === null && Array.isArray(updatedRows) && updatedRows.length === 1, "database_convergence_update", );
        const afterCandidate = record( updatedRows[0], "database_convergence_row", );
        requireCondition( validUtcTimestamp(afterCandidate.updated_at), "database_convergence_timestamp", );
        const after = requireBaseRow( afterCandidate, TARGET_INSTANCE_URL, afterCandidate.updated_at as string, false, );
        const clockBefore = before.clock_before;
        const afterUpdatedAt = after.updated_at;
        const clockAfter = after.clock_after;
        requireCondition( validUtcTimestamp(clockBefore) && validUtcTimestamp(afterUpdatedAt) && validUtcTimestamp(clockAfter) && utcTimestampOrderKey(EXPECTED_FEDERATION_UPDATED_AT) <
              utcTimestampOrderKey(clockBefore) && utcTimestampOrderKey(clockBefore) <= utcTimestampOrderKey(afterUpdatedAt) && utcTimestampOrderKey(afterUpdatedAt) <= utcTimestampOrderKey(clockAfter), "database_convergence_timestamp", );
        const beforeProjection = projection(before);
        const afterProjection = projection(after);
        requireCondition( canonicalJson(beforeProjection) === canonicalJson(afterProjection), "database_convergence_delta", );
        const beforeRow = rowProof(before);
        const afterRow = rowProof(after);
        return { schema: "agenttool-phase-b-refence-database-origin-convergence/v1", statement_sha256: DATABASE_ORIGIN_STATEMENT_SHA256, database_target_sha256: databaseTargetSHA256, before_row_sha256: sha256(canonicalJson(beforeRow)),
          after_row_sha256: sha256(canonicalJson(afterRow)), unchanged_projection_sha256: sha256( canonicalJson(beforeProjection), ), delta_sha256: sha256(canonicalJson({ after_instance_url_sha256: TARGET_INSTANCE_URL_SHA256,
            after_updated_at: afterUpdatedAt, before_instance_url_sha256: PRE_REFENCE_INSTANCE_URL_SHA256, before_updated_at: EXPECTED_FEDERATION_UPDATED_AT, clock_after: clockAfter, clock_before: clockBefore, })),
          before_instance_url_sha256: PRE_REFENCE_INSTANCE_URL_SHA256, after_instance_url_sha256: TARGET_INSTANCE_URL_SHA256, before_updated_at: EXPECTED_FEDERATION_UPDATED_AT, after_updated_at: afterUpdatedAt, clock_before: clockBefore,
          clock_after: clockAfter, database_write_attempt_count: 1, rows_updated: 1, commit_acknowledged: true, commit_ambiguity: false, rollback_attempt_count: 0, }; }, );
    let monitor: ReturnType<typeof setInterval> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const cancellation = new Promise<"interrupt" | "deadline">( (resolvePromise) => { monitor = setInterval(() => { if (productionInterrupted !== null) resolvePromise("interrupt"); }, 25);
        deadline = setTimeout(() => resolvePromise("deadline"), 30_000); }, );
    const transactionOutcome: Promise<
      | { readonly kind: "acknowledged";
        readonly proof: DatabaseOriginConvergenceProof; }
      | { readonly kind: "rejected" }
    > = transactionPromise.then( ( proof: DatabaseOriginConvergenceProof, ) => ({ kind: "acknowledged", proof } as const), () => ({ kind: "rejected" } as const), );
    let cancellationObserved: "interrupt" | "deadline" | null = null;
    try { let outcome: | Awaited<typeof transactionOutcome>
        | { kind: "interrupt" | "deadline" } = await Promise.race([ transactionOutcome, cancellation.then((kind) => ({ kind })), ]);
      if (outcome.kind === "interrupt" || outcome.kind === "deadline") { cancellationObserved = outcome.kind;
        forcedClose = true;
        const destruction = clients.closeClients([sql]).then( () => ({ settled: true, fulfilled: true } as const), () => ({ settled: true, fulfilled: false } as const), );
        const [destroyed, transactionSettled] = await Promise.all([ destruction, settlePromiseWithin(transactionOutcome, 5_000), ]);
        if ( transactionSettled.settled && transactionSettled.fulfilled && transactionSettled.value.kind === "acknowledged" ) { outcome = transactionSettled.value;
          acknowledged = outcome.proof;
          expectedInstanceURL = TARGET_INSTANCE_URL;
          expectedFederationUpdatedAt = outcome.proof.after_updated_at; }
        requireCondition( destroyed.settled && destroyed.fulfilled && transactionSettled.settled, "database_convergence_settlement", );
        if ( transactionSettled.fulfilled && transactionSettled.value.kind !== "acknowledged" ) { outcome = transactionSettled.value; }
        if (outcome.kind !== "acknowledged") { refuse("database_convergence_commit_unknown"); } }
      requireCondition( outcome.kind === "acknowledged", "database_convergence_commit_unknown", );
      const transactionProof = outcome.proof;
      acknowledged = transactionProof;
      expectedInstanceURL = TARGET_INSTANCE_URL;
      expectedFederationUpdatedAt = transactionProof.after_updated_at;
      if (cancellationObserved !== null) { throw new DatabaseConvergenceAcknowledgedError( cancellationObserved === "deadline" ? "database_convergence_deadline" : "database_convergence_interrupted", transactionProof, ); } } catch (error) {
      if (error instanceof DatabaseConvergenceAcknowledgedError) throw error;
      if (acknowledged !== null) { throw new DatabaseConvergenceAcknowledgedError( "database_convergence_after_commit", acknowledged, ); }
      if (!forcedClose) { forcedClose = true;
        try { await clients.closeClients([sql]); } catch {} }
      throw error; } finally { if (monitor) clearInterval(monitor);
      if (deadline) clearTimeout(deadline); }
    requireCondition( acknowledged !== null, "database_convergence_commit_unknown", );
    const committed = acknowledged;
    if (!forcedClose) { try { await clients.closeClients([sql]); } catch (error) { if (error instanceof DatabaseConvergenceAcknowledgedError) throw error;
        throw new DatabaseConvergenceAcknowledgedError( "database_convergence_close", committed, ); } }
    if (productionInterrupted !== null) { throw new DatabaseConvergenceAcknowledgedError( "database_convergence_interrupted", committed, ); }
    try { requireDependencyEstate(dependencyEstate); } catch { throw new DatabaseConvergenceAcknowledgedError( "database_convergence_postcommit_estate", committed, ); }
    return committed; };
  return { controllerPhase: "pre_handoff_prepared", sealChildLaunchersForHandoff: () => { requirePreHandoffChildAuthority();
      requireCondition( activeProductionChild === null && productionInterrupted === null, "pre_handoff_child_seal", );
      childLaunchersSealed = true;
      return Object.freeze({
        controllerPhase: "post_handoff_childless" as const, readDatabaseProof, convergeFederationInstanceURL, takeOrdinaryPostflightDatabaseEnvironment, pause, close, }); }, readDatabaseProof, readProviderSecretInventory: async () => {
      requirePreHandoffChildAuthority();
      const result = await runRefenceFlyCLI([ "secrets", "list", "-a", APP, "--json", ]);
      requireCondition(result.exitCode === 0, "provider_read");
      return JSON.parse(decode(result.stdout, "provider_json")); }, readKeychainProof: async () => { requirePreHandoffChildAuthority();
      const absentResult = await runRefenceSecurityCLI([ "find-generic-password", "-s", GENERATION_KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, ]);
      requireCondition( absentResult.exitCode === 44 && absentResult.stdout.byteLength === 0, "keychain_generation", );
      const mapResult = await runRefenceSecurityCLI([ "find-generic-password", "-s", MACHINE_MAP_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", ]);
      requireCondition(mapResult.exitCode === 0, "keychain_map");
      let text = decode(mapResult.stdout, "keychain_map");
      text = text.replace(/\r?\n$/, "");
      requireCondition(sha256(text) === MACHINE_MAP_SHA256, "keychain_map");
      const map = JSON.parse(text);
      return { generation_absent: true, machine_map_sha256: MACHINE_MAP_SHA256, roles: { app_lhr: map.app_lhr, app_cdg: map.app_cdg, thinker_primary: map.thinker_primary, thinker_standby: map.thinker_standby, }, }; },
    readProcessProof: async () => { requirePreHandoffChildAuthority();
      return readProductionProcessProof(); }, readGitProof: async () => { requirePreHandoffChildAuthority();
      return readProductionGitProof(); }, readFleetInventory: async () => { requirePreHandoffChildAuthority();
      const result = await runRefenceFlyCLI([ "machine", "list", "-a", APP, "--json", ]);
      requireCondition(result.exitCode === 0, "fleet_read");
      return JSON.parse(decode(result.stdout, "fleet_json")); }, pause, close, }; }

async function readProductionGitProof(): Promise<GitProof> { const revisionResult = await runRefenceGitCLI(["rev-parse", "HEAD"]);
  const remoteResult = await runRefenceGitCLI([ "rev-parse", GITHUB_MAIN_TRACKING_REF, ]);
  const treeResult = await runRefenceGitCLI(["rev-parse", "HEAD^{tree}"]);
  const distanceResult = await runRefenceGitCLI([ "rev-list", "--count", `${EXPECTED_SOURCE_REVISION}..HEAD`, ]);
  const ancestryResult = await runRefenceGitCLI([ "merge-base", "--is-ancestor", EXPECTED_SOURCE_REVISION, "HEAD", ]);
  const statusResult = await runRefenceGitCLI([ "status", "--porcelain=v1", "--untracked-files=all", ]);
  const sourceResult = await runRefenceGitCLI( ["show", "HEAD:bin/phase-b-refence-maintenance-bridge.ts"], MAX_PRIVATE_BYTES, );
  const contractResult = await runRefenceGitCLI( ["show", "HEAD:bin/phase-b-refence-maintenance-contract.ts"], MAX_PRIVATE_BYTES, );
  const contractTreeResult = await runRefenceGitCLI([ "ls-tree", "-z", "HEAD", "--", "bin/phase-b-refence-maintenance-contract.ts", ]);
  requireCondition( revisionResult.exitCode === 0 && remoteResult.exitCode === 0 && treeResult.exitCode === 0 && distanceResult.exitCode === 0 && ancestryResult.exitCode === 0 &&
      statusResult.exitCode === 0 && statusResult.stdout.byteLength === 0 && sourceResult.exitCode === 0 && contractResult.exitCode === 0 && contractTreeResult.exitCode === 0 && decode(contractTreeResult.stdout, "git_proof") ===
        `100644 blob ${CONTRACT_SOURCE_GIT_BLOB}\tbin/phase-b-refence-maintenance-contract.ts\0`, "git_proof", );
  const singleLine = (bytes: Uint8Array, pattern: RegExp): string => { const text = decode(bytes, "git_proof");
    requireCondition( pattern.test(text) && text.endsWith("\n") && !text.slice(0, -1).includes("\n"), "git_proof", );
    return text.slice(0, -1); };
  const revision = singleLine(revisionResult.stdout, /^[0-9a-f]{40}\n$/);
  const remoteRevision = singleLine( remoteResult.stdout, /^[0-9a-f]{40}\n$/, );
  const tree = singleLine(treeResult.stdout, /^[0-9a-f]{40}\n$/);
  const distanceText = singleLine( distanceResult.stdout, /^(?:0|[1-9][0-9]*)\n$/, );
  const distance = Number(distanceText);
  requireCondition( Number.isSafeInteger(distance) && distance > 12 && remoteRevision === revision, "git_proof", );
  const bridgeHashes = bridgeSourceHashes();
  requireCondition( sha256(sourceResult.stdout) === bridgeHashes.raw && sha256(contractResult.stdout) === CONTRACT_SOURCE_SHA256, "git_proof", );
  return { revision, tree, source_distance: distance, bridge_source_sha256: bridgeHashes.raw, clean: true, }; }

function processProofFromBytes(stdout: Uint8Array): ProcessProof { const text = decode(stdout, "process_census");
  const rows = text.split("\n").filter(Boolean).map((line) => { const match = line.match(/^\s*([0-9]+)\s+([0-9]+)\s+(.+)$/);
    requireCondition(match !== null, "process_census");
    return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }; });
  const ancestors = new Set<number>([process.pid, process.ppid]);
  let cursor = process.ppid;
  for (let depth = 0; depth < 32; depth += 1) { const row = rows.find((entry) => entry.pid === cursor);
    if (!row || row.ppid <= 1 || ancestors.has(row.ppid)) break;
    ancestors.add(row.ppid);
    cursor = row.ppid; }
  const effectPattern = /(?:^|\/)(?:fly|flyctl)(?:\s|$)|bin\/deploy\.sh|phase-b-refence|migrate-pending|frontend-deploy|wrangler/;
  const conflicts = rows.filter((row) => effectPattern.test(row.command) && !ancestors.has(row.pid) );
  requireCondition(conflicts.length === 0, "process_census");
  return { conflicting_process_count: 0, projection_sha256: sha256(canonicalJson( rows.filter((row) => effectPattern.test(row.command)).map((row) => ({ self: ancestors.has(row.pid), command_sha256: sha256(row.command), })), )), }; }

async function readProductionProcessProof(): Promise<ProcessProof> { const result = await runRefenceProcessCensus();
  requireCondition(result.exitCode === 0, "process_census");
  return processProofFromBytes(result.stdout); }

const DATABASE_ORIGIN_STATEMENT_SHA256 = "00e53468e58ad0c0d7db6255278fd122b19683fa370aab457500218d0a7675f2";

/** @internal Exact non-secret statement projection used by contained tests. */
export function databaseOriginStatementSHA256ForTest(): string { return sha256(canonicalJson(maintenanceContract().databaseOriginContract)); }

export type ControllerEffectKind = | "database_convergence"
  | "build_push"
  | "update_image"
  | "restore_config"
  | "refence_config"
  | "start_machine"
  | "enable_autostart"
  | "uncordon_machine"
  | "cordon_machine"
  | "stop_machine"
  | "wait_machine"
  | "read_fleet"
  | "read_secrets"
  | "read_git"
  | "read_keychain"
  | "read_process"
  | "public_probe"
  | "ordinary_postflight"
  | "runtime_probe";

export function controllerFlyArgv(operation: ControllerFlyOperation): string[] { return maintenanceContract().controllerFlyArgv(operation, PINNED_FLY); }

function controllerFleetByID( raw: unknown, evidence: TerminalEvidence, code: string, ): Map<string, JsonRecord> { requireCondition(Array.isArray(raw) && raw.length === 5, code);
  const byID = new Map<string, JsonRecord>();
  for (const entry of raw) { const machine = record(entry, code);
    requireCondition( validMachineID(machine.id) && !byID.has(machine.id), code, );
    byID.set(machine.id, machine); }
  requireCondition( canonicalJson([...byID.keys()].sort()) === canonicalJson([...machineIDs(evidence.roles)].sort()), code, );
  return byID; }

function controllerFleetProjection( byID: Map<string, JsonRecord>, ): JsonRecord[] { return [...byID.values()].map((machine) => structuredClone(machine)).sort( (left, right) => String(left.id).localeCompare(String(right.id)), ); }

function sameStringSet( left: readonly string[], right: readonly string[], ): boolean { return canonicalJson([...left].sort()) === canonicalJson([...right].sort()); }

export interface ControllerFleetTransitionProof { image: TargetImageContract | null;
  before_first_fleet_sha256: string;
  before_second_fleet_sha256: string;
  first_fleet_sha256: string;
  second_fleet_sha256: string;
  stable_fleet_sha256: string;
  non_image_config_sha256: string;
  touched_machine_id: string | null; }

/**
 * @internal Exact provider transition oracle. It evolves only fields authorized
 * by one reviewed Fly operation from the previously proved full-five snapshot.
 */
export function validateControllerFleetTransitionForTest(request: { beforeFirst: unknown;
  beforeSecond: unknown;
  first: unknown;
  second: unknown;
  evidence: TerminalEvidence;
  operation: ControllerFlyOperation;
  image: TargetImageContract | null;
  expectation: TargetFleetExpectation; }): ControllerFleetTransitionProof { return maintenanceContract().validateFleetTransition(request); }

export type ControllerWalPhase = | "ready"
  | "attempting"
  | "spawned"
  | "settled"
  | "verified"
  | "transition_verified"
  | "failed_or_uncertain"
  | "complete";

export interface ControllerWalEntry { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1";
  ordinal: number;
  prior_entry_sha256: string | null;
  controller_run_id: string;
  rollout_id: string;
  receipt_sha256: string;
  recorded_at: string;
  phase: ControllerWalPhase;
  checkpoint: string;
  effect_id: string | null;
  effect_kind: ControllerEffectKind | null;
  target: string | null;
  argv_sha256: string | null;
  pid: number | null;
  pgid: number | null;
  exit_code: number | null;
  termination: "exit" | "signal" | "timeout" | null;
  local_process_group_settled: boolean;
  provider_transition_sha256: string | null;
  fleet_readback_sha256: string | null;
  detail_sha256: string | null;
  failure_code: string | null; }

export interface ControllerWalProjection { directory: string;
  entry_count: number;
  ordered_filenames: string[];
  chain_sha256: string;
  terminal_entry_sha256: string;
  terminal_phase: ControllerWalPhase; }

function createPrivateDirectoryExclusive(path: string, parent: string): Stats { requirePrivateDirectory(parent);
  mkdirSync(path, { mode: 0o700 });
  const created = lstatSync(path);
  requireCondition( created.isDirectory() && !created.isSymbolicLink() && created.uid === process.getuid?.() && created.gid === process.getgid?.() && created.nlink === 2 && (created.mode & 0o777) === 0o700 && realpathSync(path) === path,
    "private_directory_create", );
  fsyncPath(parent);
  const rebound = requirePrivateDirectory(path);
  requireCondition( rebound.dev === created.dev && rebound.ino === created.ino && readdirSync(path).length === 0, "private_directory_create", );
  return rebound; }

function createBuildDirectoryExclusive(path: string, parent: string): Stats { const parentInfo = lstatSync(parent);
  requireCondition( parentInfo.isDirectory() && !parentInfo.isSymbolicLink() && parentInfo.uid === process.getuid?.() && parentInfo.gid === process.getgid?.() && [0o700, 0o755].includes(parentInfo.mode & 0o777) &&
      realpathSync(parent) === parent, "build_directory_create", );
  mkdirSync(path, { mode: 0o755 });
  const created = lstatSync(path);
  requireCondition( created.isDirectory() && !created.isSymbolicLink() && created.uid === process.getuid?.() && created.gid === process.getgid?.() && created.nlink === 2 && (created.mode & 0o777) === 0o755 && realpathSync(path) === path,
    "build_directory_create", );
  fsyncPath(parent);
  const rebound = lstatSync(path);
  requireCondition( rebound.dev === created.dev && rebound.ino === created.ino && rebound.nlink === created.nlink && readdirSync(path).length === 0, "build_directory_create", );
  return rebound; }

function validateControllerWalEntry( value: ControllerWalEntry, previous: ControllerWalEntry | null, history: readonly ControllerWalEntry[], expected: { controllerRunID: string;
    rolloutID: string;
    receiptSHA256: string; }, ): void { maintenanceContract().validateControllerWalEntry( value, previous, history, expected, ); }

export class ControllerWalWriter { readonly directory: string;
  readonly controllerRunID: string;
  readonly rolloutID: string;
  readonly receiptSHA256: string;
  #entries: ControllerWalEntry[] = [];
  #filenames: string[] = [];
  #sealed = false;

  get lastEntry(): ControllerWalEntry | null { return this.#entries.at(-1) ?? null; }

  get sealed(): boolean { return this.#sealed; }

  settledEffect(effectID: string): ControllerWalEntry | null { return [...this.#entries].reverse().find((entry) => entry.effect_id === effectID && entry.phase === "settled" ) ?? null; }

  entryAt(ordinal: number): ControllerWalEntry | null { requireCondition( Number.isSafeInteger(ordinal) && ordinal > 0, "controller_wal_ordinal", );
    const entry = this.#entries[ordinal - 1];
    return entry === undefined ? null : structuredClone(entry); }

  constructor(request: { directory: string;
    controllerRunID: string;
    rolloutID: string;
    receiptSHA256: string; }) { requirePrivateDirectory(request.directory);
    requireCondition( readdirSync(request.directory).length === 0 && validRunID(request.controllerRunID) && /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/ .test(request.rolloutID) && validSha(request.receiptSHA256),
      "controller_wal_admission", );
    this.directory = request.directory;
    this.controllerRunID = request.controllerRunID;
    this.rolloutID = request.rolloutID;
    this.receiptSHA256 = request.receiptSHA256; }

  append( entry: Omit<
      ControllerWalEntry, | "schema"
      | "ordinal"
      | "prior_entry_sha256"
      | "controller_run_id"
      | "rollout_id"
      | "receipt_sha256"
    >, ): ControllerWalEntry { requireCondition(!this.#sealed, "controller_wal_sealed");
    const previous = this.#entries.at(-1) ?? null;
    const value: ControllerWalEntry = { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", ordinal: this.#entries.length + 1, prior_entry_sha256: previous === null ? null : sha256(`${canonicalJson(previous)}\n`),
      controller_run_id: this.controllerRunID, rollout_id: this.rolloutID, receipt_sha256: this.receiptSHA256, ...entry, };
    validateControllerWalEntry(value, previous, this.#entries, { controllerRunID: this.controllerRunID, rolloutID: this.rolloutID, receiptSHA256: this.receiptSHA256, });
    const bytes = `${canonicalJson(value)}\n`;
    const digest = sha256(bytes);
    const filename = `${String(value.ordinal).padStart(6, "0")}-${digest}.json`;
    createExclusiveDurableFile( join(this.directory, filename), bytes, this.directory, );
    this.#entries.push(value);
    this.#filenames.push(filename);
    requireCondition( canonicalJson(readdirSync(this.directory).sort()) === canonicalJson([...this.#filenames].sort()), "controller_wal_inventory", );
    return value; }

  sealComplete( recordedAt: string, rolloutProofSHA256: string, ): ControllerWalProjection { requireCondition( !this.#sealed && validSha(rolloutProofSHA256) && ["verified", "transition_verified"].includes( this.lastEntry?.phase ?? "", ),
      "controller_wal_seal", );
    this.append({ recorded_at: recordedAt, phase: "complete", checkpoint: "success_proven", effect_id: null, effect_kind: null, target: null, argv_sha256: null, pid: null, pgid: null, exit_code: null, termination: null,
      local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: rolloutProofSHA256, failure_code: null, });
    this.#sealed = true;
    const projection = this.replayProjection();
    requireCondition( projection.terminal_phase === "complete", "controller_wal_seal", );
    return projection; }

  replayProjection(): ControllerWalProjection { const names = readdirSync(this.directory).sort();
    requireCondition( canonicalJson(names) === canonicalJson(this.#filenames), "controller_wal_replay", );
    const replayed: ControllerWalEntry[] = [];
    for (let index = 0; index < names.length; index += 1) { const name = names[index]!;
      const parsed = parsePrivateJson(join(this.directory, name));
      const entry = parsed.value as ControllerWalEntry;
      const previous = replayed.at(-1) ?? null;
      validateControllerWalEntry(entry, previous, replayed, { controllerRunID: this.controllerRunID, rolloutID: this.rolloutID, receiptSHA256: this.receiptSHA256, });
      requireCondition( name === `${String(index + 1).padStart(6, "0")}-${parsed.digest}.json`, "controller_wal_replay", );
      replayed.push(entry); }
    requireCondition( canonicalJson(replayed) === canonicalJson(this.#entries), "controller_wal_replay", );
    const terminal = replayed.at(-1);
    requireCondition(terminal !== undefined, "controller_wal_replay");
    return { directory: this.directory, entry_count: replayed.length, ordered_filenames: names, chain_sha256: sha256(canonicalJson(replayed.map((entry, index) => ({ ordinal: entry.ordinal, filename: names[index],
        sha256: sha256(`${canonicalJson(entry)}\n`), prior_entry_sha256: entry.prior_entry_sha256, phase: entry.phase, checkpoint: entry.checkpoint, })))), terminal_entry_sha256: sha256(`${canonicalJson(terminal)}\n`),
      terminal_phase: terminal.phase, }; }

  projection(): ControllerWalProjection { const terminal = this.#entries.at(-1);
    requireCondition(terminal !== undefined, "controller_wal_empty");
    return {
      directory: this.directory, entry_count: this.#entries.length, ordered_filenames: [...this.#filenames], chain_sha256: sha256(canonicalJson(this.#entries.map((entry, index) => ({ ordinal: entry.ordinal, filename: this.#filenames[index],
        sha256: sha256(`${canonicalJson(entry)}\n`), prior_entry_sha256: entry.prior_entry_sha256, phase: entry.phase, checkpoint: entry.checkpoint, })))), terminal_entry_sha256: sha256(`${canonicalJson(terminal)}\n`),
      terminal_phase: terminal.phase, }; } }

function databaseConvergenceWalBase( entry: ControllerWalEntry, ): Pick<
  ControllerWalEntry, "checkpoint" | "effect_id" | "effect_kind" | "target" | "argv_sha256"
> { requireCondition( entry.effect_id === "database_origin_convergence" && entry.effect_kind === "database_convergence" && entry.target === "federation.settings:1" && entry.argv_sha256 === DATABASE_ORIGIN_STATEMENT_SHA256,
    "database_convergence_wal", );
  return { checkpoint: entry.checkpoint, effect_id: entry.effect_id, effect_kind: entry.effect_kind, target: entry.target, argv_sha256: entry.argv_sha256, }; }

/** @internal Durable non-child database intent for contained crash tests. */
export function appendDatabaseConvergenceIntentForTest(request: { wal: ControllerWalWriter;
  recordedAt: string;
  beforeProofSHA256: string;
  databaseTargetSHA256: string; }): ControllerWalEntry { requireCondition( request.wal.lastEntry?.phase === "ready" && validUtcTimestamp(request.recordedAt) && validSha(request.beforeProofSHA256) && validSha(request.databaseTargetSHA256),
    "database_convergence_intent", );
  return request.wal.append({ recorded_at: request.recordedAt, phase: "attempting", checkpoint: "database_convergence_intent", effect_id: "database_origin_convergence", effect_kind: "database_convergence", target: "federation.settings:1",
    argv_sha256: DATABASE_ORIGIN_STATEMENT_SHA256, pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null,
    detail_sha256: sha256(canonicalJson({ before_proof_sha256: request.beforeProofSHA256, database_target_sha256: request.databaseTargetSHA256, database_write_attempt_count: 1, rollback_attempt_count: 0,
      statement_sha256: DATABASE_ORIGIN_STATEMENT_SHA256, })), failure_code: null, }); }

export function appendDatabaseConvergenceCommitForTest(request: { wal: ControllerWalWriter;
  recordedAt: string;
  proof: DatabaseOriginConvergenceProof; }): ControllerWalEntry { const previous = request.wal.lastEntry;
  requireCondition( previous !== null && previous.phase === "attempting" && validUtcTimestamp(request.recordedAt), "database_convergence_commit", );
  const base = databaseConvergenceWalBase(previous);
  return request.wal.append({ ...base, recorded_at: request.recordedAt, phase: "settled", checkpoint: "database_convergence_commit_acknowledged", pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: true,
    provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: sha256(canonicalJson(request.proof)), failure_code: null, }); }

export function appendDatabaseConvergenceVerifiedForTest(request: { wal: ControllerWalWriter;
  recordedAt: string;
  proof: DatabaseOriginConvergenceProof;
  afterProofSHA256: string; }): ControllerWalEntry { const previous = request.wal.lastEntry;
  requireCondition( previous !== null && previous.phase === "settled" && validUtcTimestamp(request.recordedAt) && validSha(request.afterProofSHA256), "database_convergence_verified", );
  const base = databaseConvergenceWalBase(previous);
  return request.wal.append({ ...base, recorded_at: request.recordedAt, phase: "verified", checkpoint: "database_convergence_verified", pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: true,
    provider_transition_sha256: request.proof.delta_sha256, fleet_readback_sha256: request.afterProofSHA256, detail_sha256: sha256(canonicalJson({ convergence_sha256: sha256(canonicalJson(request.proof)),
      after_proof_sha256: request.afterProofSHA256, })), failure_code: null, }); }

export function appendDatabaseConvergenceFailureForTest(request: { wal: ControllerWalWriter;
  recordedAt: string;
  failureCode: string; }): ControllerWalEntry { const previous = request.wal.lastEntry;
  requireCondition( previous !== null && ["attempting", "settled", "verified"].includes(previous.phase) && previous.effect_kind === "database_convergence" && validUtcTimestamp(request.recordedAt) &&
      /^[a-z0-9_]{1,64}$/.test(request.failureCode), "database_convergence_failure", );
  const base = databaseConvergenceWalBase(previous);
  return request.wal.append({
    ...base, recorded_at: request.recordedAt, phase: "failed_or_uncertain", checkpoint: "database_convergence_failed_or_uncertain", pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: true,
    provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: sha256(canonicalJson({ failure_code: request.failureCode, reconciliation_required: true, rollback_attempt_count: 0, })), failure_code: request.failureCode,
  }); }

export interface ControllerDatabaseConvergenceDependencies { now(): string;
  recordIntent(entry: ControllerWalEntry): Promise<void> | void;
  verifyIntent(entry: ControllerWalEntry): Promise<void> | void;
  readPreMutationProof(): Promise<DatabaseProof>;
  converge(): Promise<DatabaseOriginConvergenceProof>;
  recordCommit( proof: DatabaseOriginConvergenceProof, entry: ControllerWalEntry, ): Promise<void> | void;
  readPostMutationProof(): Promise<DatabaseProof>;
  recordVerified( afterProofSHA256: string, entry: ControllerWalEntry, ): Promise<void> | void;
  retainManual(code: string): Promise<void> | void; }

export interface ControllerDatabaseConvergenceResult { proof: DatabaseOriginConvergenceProof;
  beforeProofSHA256: string;
  afterProofSHA256: string; }

/** @internal First and only post-H database mutation; no provider dependency. */
export async function runControllerDatabaseConvergenceCoreForTest(request: { wal: ControllerWalWriter;
  handoffEdge: HandoffEdge;
  interrupted(): boolean;
  inheritedProof: DatabaseProof;
  inheritedProofSHA256: string;
  dependencies: ControllerDatabaseConvergenceDependencies; }): Promise<ControllerDatabaseConvergenceResult> { const inheritedProof = validateDatabaseConvergenceInheritedProof( request.inheritedProof, );
  requireCondition( request.handoffEdge === "H5" && request.interrupted() === false && request.wal.lastEntry?.phase === "ready" && request.wal.lastEntry.checkpoint === "controller_ready" && request.wal.lastEntry.effect_id === null &&
      request.wal.lastEntry.effect_kind === null && request.wal.lastEntry.local_process_group_settled === true && validSha(request.inheritedProofSHA256) && sha256(canonicalJson(inheritedProof)) === request.inheritedProofSHA256 &&
      inheritedProof.federation_instance_url_sha256 === PRE_REFENCE_INSTANCE_URL_SHA256, "database_convergence_admission", );
  let intent: ControllerWalEntry | null = null;
  let commit: ControllerWalEntry | null = null;
  let proof: DatabaseOriginConvergenceProof | null = null;
  const requireNotInterrupted = (): void => requireCondition( request.interrupted() === false, "database_convergence_interrupted", );
  try { intent = appendDatabaseConvergenceIntentForTest({ wal: request.wal, recordedAt: request.dependencies.now(), beforeProofSHA256: request.inheritedProofSHA256, databaseTargetSHA256: inheritedProof.database_target_sha256, });
    requireNotInterrupted();
    await request.dependencies.recordIntent(intent);
    requireNotInterrupted();
    await request.dependencies.verifyIntent(intent);
    requireNotInterrupted();
    const preMutation = await request.dependencies.readPreMutationProof();
    requireCondition( canonicalJson(preMutation) === canonicalJson(inheritedProof), "database_convergence_preproof", );
    requireNotInterrupted();
    try { proof = await request.dependencies.converge(); } catch (error) { if (error instanceof DatabaseConvergenceAcknowledgedError) { proof = error.proof;
        commit = appendDatabaseConvergenceCommitForTest({ wal: request.wal, recordedAt: request.dependencies.now(), proof, });
        await request.dependencies.recordCommit(proof, commit); }
      throw error; }
    commit = appendDatabaseConvergenceCommitForTest({ wal: request.wal, recordedAt: request.dependencies.now(), proof, });
    await request.dependencies.recordCommit(proof, commit);
    requireNotInterrupted();
    const after = await request.dependencies.readPostMutationProof();
    requireNotInterrupted();
    const validated = validateDatabaseOriginConvergenceForTest( proof, inheritedProof, after, );
    requireCondition( validated.beforeProofSHA256 === request.inheritedProofSHA256, "database_convergence_preproof", );
    const verified = appendDatabaseConvergenceVerifiedForTest({ wal: request.wal, recordedAt: request.dependencies.now(), proof, afterProofSHA256: validated.afterProofSHA256, });
    await request.dependencies.recordVerified( validated.afterProofSHA256, verified, );
    requireNotInterrupted();
    return { proof, ...validated }; } catch (error) { const code = error instanceof DatabaseConvergenceAcknowledgedError ? error.code : error instanceof MaintenanceRefenceError ? error.code : "database_convergence_failed_or_uncertain";
    const terminalEntry = request.wal.lastEntry as ControllerWalEntry | null;
    if ( intent !== null && terminalEntry?.effect_kind === "database_convergence" && terminalEntry.phase !== "failed_or_uncertain" ) { try { appendDatabaseConvergenceFailureForTest({ wal: request.wal, recordedAt: request.dependencies.now(),
          failureCode: /^[a-z0-9_]{1,64}$/.test(code) ? code : "database_convergence_failed_or_uncertain", }); } catch {} }
    try { await request.dependencies.retainManual(code); } catch {}
    throw new ControllerManualInterventionError(code); } }

/** @internal Complete marker/result/WAL binding used before any provider read. */
export function validateVerifiedDatabaseConvergenceForTest( rawMarker: unknown, result: ControllerDatabaseConvergenceResult, wal: ControllerWalWriter, ): string { const marker = record(rawMarker, "database_convergence_verified_binding");
  const intentOrdinal = marker.intent_wal_ordinal;
  const commitOrdinal = marker.commit_ack_wal_ordinal;
  const verifiedOrdinal = marker.verified_wal_ordinal;
  return maintenanceContract().validateVerifiedDatabaseConvergence({
    marker, result, intent: Number.isSafeInteger(intentOrdinal) ? wal.entryAt(intentOrdinal) : null, commit: Number.isSafeInteger(commitOrdinal) ? wal.entryAt(commitOrdinal) : null, verified: Number.isSafeInteger(verifiedOrdinal)
      ? wal.entryAt(verifiedOrdinal) : null, lastEntry: wal.lastEntry, }); }

export interface ControllerEffectChild { pid: number;
  pgid: number; }

export interface ControllerEffectSettlement { exitCode: number | null;
  termination: "exit" | "signal" | "timeout";
  processGroupSettled: boolean;
  detailSHA256: string; }

export interface ControllerEffectVerification { providerTransitionSHA256: string;
  fleetReadbackSHA256: string;
  detailSHA256: string; }

export interface ControllerEffectRuntime { now(): string;
  spawn(argv: readonly string[]): ControllerEffectChild;
  settle( child: ControllerEffectChild, timeoutMilliseconds: number, ): Promise<ControllerEffectSettlement>; }

export async function executeControllerEffect(request: { wal: ControllerWalWriter;
  runtime: ControllerEffectRuntime;
  effectID: string;
  effectKind: ControllerEffectKind;
  checkpoint: string;
  target: string;
  argv: readonly string[];
  timeoutMilliseconds: number;
  verify(): Promise<ControllerEffectVerification>; }): Promise<ControllerEffectVerification> { requireCondition( request.wal.lastEntry !== null && ["ready", "settled", "verified", "transition_verified"].includes(
        request.wal.lastEntry.phase, ) && /^[a-z0-9_]{1,128}$/.test(request.effectID) && /^[a-z0-9_]{1,128}$/.test(request.checkpoint) && request.argv.length >= 1 && request.argv.length <= 128 && request.argv.every((entry) =>
        typeof entry === "string" && entry.length >= 1 && entry.length <= 4096 && !entry.includes("\0") && !entry.includes("\n") && !entry.includes("\r") ) && Number.isSafeInteger(request.timeoutMilliseconds) &&
      request.timeoutMilliseconds >= 1_000 && request.timeoutMilliseconds <= 600_000, "controller_effect_contract", );
  const argvSHA256 = sha256(canonicalJson(request.argv));
  const base = { checkpoint: request.checkpoint, effect_id: request.effectID, effect_kind: request.effectKind, target: request.target, argv_sha256: argvSHA256, } as const;
  request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "attempting", pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: false, provider_transition_sha256: null,
    fleet_readback_sha256: null, detail_sha256: null, failure_code: null, });
  let child: ControllerEffectChild | null = null;
  let settlement: ControllerEffectSettlement | null = null;
  try { child = request.runtime.spawn(request.argv);
    requireCondition( Number.isSafeInteger(child.pid) && child.pid > 1 && child.pgid === child.pid, "controller_child_identity", );
    request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "spawned", pid: child.pid, pgid: child.pgid, exit_code: null, termination: null, local_process_group_settled: false, provider_transition_sha256: null,
      fleet_readback_sha256: null, detail_sha256: null, failure_code: null, });
    settlement = await request.runtime.settle( child, request.timeoutMilliseconds, );
    requireCondition( validSha(settlement.detailSHA256), "controller_child_settlement", );
    if ( !settlement.processGroupSettled || settlement.termination !== "exit" || settlement.exitCode !== 0 ) { throw new ControllerManualInterventionError( "controller_child_uncertain", ); }
    request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "settled", pid: child.pid, pgid: child.pgid, exit_code: settlement.exitCode, termination: settlement.termination, local_process_group_settled: true,
      provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: settlement.detailSHA256, failure_code: null, });
    const verified = await request.verify();
    requireCondition( validSha(verified.providerTransitionSHA256) && validSha(verified.fleetReadbackSHA256) && validSha(verified.detailSHA256), "controller_effect_verification", );
    request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "verified", pid: child.pid, pgid: child.pgid, exit_code: 0, termination: "exit", local_process_group_settled: true,
      provider_transition_sha256: verified.providerTransitionSHA256, fleet_readback_sha256: verified.fleetReadbackSHA256, detail_sha256: verified.detailSHA256, failure_code: null, });
    return verified; } catch (error) { const previous = request.wal.lastEntry;
    if ( previous !== null && previous.effect_id === request.effectID && previous.phase !== "failed_or_uncertain" ) { const termination = settlement?.termination ?? null;
      const failureCode = error instanceof MaintenanceRefenceError || error instanceof ControllerManualInterventionError ? error.code : "controller_child_refused";
      request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "failed_or_uncertain", pid: child?.pid ?? null, pgid: child?.pgid ?? null, exit_code: settlement?.exitCode ?? null, termination,
        local_process_group_settled: settlement?.processGroupSettled === true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: settlement?.detailSHA256 ?? null, failure_code: failureCode, }); }
    if ( error instanceof MaintenanceRefenceError || error instanceof ControllerManualInterventionError ) throw error;
    return refuse("controller_child_refused"); } }

export class ControllerManualInterventionError extends Error { readonly code: string;

  constructor(code: string) { super(code);
    this.name = "ControllerManualInterventionError";
    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "manual_intervention_required"; } }

/** A read-only child and every local reader settled, but its proof refused. */
export class ControllerSettledObservationError extends Error { readonly code: string;

  constructor(code: string) { super(code);
    this.name = "ControllerSettledObservationError";
    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "controller_observation_refused"; } }

interface ProductionFlyChildRecord { operation: ControllerFlyOperation;
  argv: string[];
  cwd: string;
  child: any;
  stdout: Uint8Array | null;
  stderr: Uint8Array | null;
  settlement: ControllerEffectSettlement | null; }

class ProductionFlyEffectRuntime implements ControllerFlyEffectRuntime { readonly buildContextPath: string;
  readonly verifyLocalAuthority: () => void;
  #armed: | { operation: ControllerFlyOperation; argv: string[]; cwd: string }
    | null = null;
  #records = new Map<number, ProductionFlyChildRecord>();

  constructor(request: { buildContextPath: string;
    verifyLocalAuthority(): void; }) { this.buildContextPath = request.buildContextPath;
    this.verifyLocalAuthority = request.verifyLocalAuthority; }

  now(): string { const value = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    requireCondition(validUtcTimestamp(value), "controller_time");
    return value; }

  arm(operation: ControllerFlyOperation): string[] { requireCondition(this.#armed === null, "controller_child_arm");
    const argv = controllerFlyArgv(operation);
    const cwd = operation.kind === "build_push" ? this.buildContextPath : HOME;
    this.#armed = { operation, argv, cwd };
    return [...argv]; }

  spawn(argv: readonly string[]): ControllerEffectChild { const armed = this.#armed;
    requireCondition( armed !== null && activeProductionChild === null && productionInterrupted === null && argv[0] === PINNED_FLY && canonicalJson(argv) === canonicalJson(armed.argv) && realpathSync(armed.cwd) === armed.cwd,
      "controller_child_arm", );
    this.verifyLocalAuthority();
    requirePinnedUserExecutable(PINNED_FLY, PINNED_FLY_SHA256, "fly_contract");
    requireFlyAuthenticationConfig();
    const child = Bun.spawn([...armed.argv], { cwd: armed.cwd, env: { ...CONTROLLER_ENVIRONMENT }, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true, });
    ownProductionChild(child);
    const pid = Number(child.pid);
    requireCondition( Number.isSafeInteger(pid) && pid > 1 && !this.#records.has(pid), "controller_child_identity", );
    const record: ProductionFlyChildRecord = { operation: armed.operation, argv: [...armed.argv], cwd: armed.cwd, child, stdout: null, stderr: null, settlement: null, };
    this.#records.set(pid, record);
    this.#armed = null;
    return { pid, pgid: pid }; }

  async settle( identity: ControllerEffectChild, timeoutMilliseconds: number, ): Promise<ControllerEffectSettlement> { const record = this.#records.get(identity.pid);
    requireCondition( record !== undefined && identity.pgid === identity.pid && activeProductionChild === record.child && record.settlement === null, "controller_child_identity", );
    const bounded = await settleBoundedProductionChild( record.child, identity.pgid, timeoutMilliseconds, );
    const { exitCode, stdout, stderr, timedOut, outputFailed, forcedSettlement, processGroupSettled, } = bounded;
    const termination: ControllerEffectSettlement["termination"] = timedOut ? "timeout" : productionInterrupted !== null || outputFailed || forcedSettlement ? "signal" : "exit";
    const detailSHA256 = sha256(canonicalJson({ argv_sha256: sha256(canonicalJson(record.argv)), cwd: record.cwd, exit_code: exitCode, termination, process_group_settled: processGroupSettled, stdout_byte_count: stdout.byteLength,
      stdout_sha256: sha256(stdout), stderr_byte_count: stderr.byteLength, stderr_sha256: sha256(stderr), }));
    const settlement = { exitCode, termination, processGroupSettled, detailSHA256, } satisfies ControllerEffectSettlement;
    record.stdout = stdout;
    record.stderr = stderr;
    record.settlement = settlement;
    if (processGroupSettled && activeProductionChild === record.child) { activeProductionChild = null; }
    if (processGroupSettled && interruptHardKill) { clearTimeout(interruptHardKill);
      interruptHardKill = null; }
    this.verifyLocalAuthority();
    requirePinnedUserExecutable(PINNED_FLY, PINNED_FLY_SHA256, "fly_contract");
    requireFlyAuthenticationConfig();
    return settlement; }

  takeStdout(identity: ControllerEffectChild): Uint8Array { const record = this.#records.get(identity.pid);
    requireCondition( record !== undefined && record.settlement?.exitCode === 0 && record.settlement.termination === "exit" && record.settlement.processGroupSettled && record.stdout !== null, "controller_child_output", );
    const bytes = record.stdout;
    record.stdout = null;
    record.stderr = null;
    return bytes; } }

interface ProductionReadChildRecord { argv: string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  verifyContract(): void;
  child: any;
  stdout: Uint8Array | null;
  stderr: Uint8Array | null;
  settlement: ControllerEffectSettlement | null; }

class ProductionControllerReadEffectRuntime implements ControllerEffectRuntime { readonly verifyLocalAuthority: () => void;
  #armed: { argv: string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    verifyContract(): void; } | null = null;
  #records = new Map<number, ProductionReadChildRecord>();

  constructor(verifyLocalAuthority: () => void) { this.verifyLocalAuthority = verifyLocalAuthority; }

  now(): string { const value = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    requireCondition(validUtcTimestamp(value), "controller_time");
    return value; }

  arm(request: { argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    verifyContract(): void; }): string[] { requireCondition( this.#armed === null && request.argv.length >= 1 && request.argv.length <= 128 && request.argv.every((entry) => entry.length >= 1 && entry.length <= 4_096 &&
          !/[\0\r\n]/.test(entry) ) && realpathSync(request.cwd) === request.cwd && Object.keys(request.environment).length >= 1 && Object.keys(request.environment).length <= 64 && Object.entries(request.environment).every(([key, value]) =>
          /^[A-Z_][A-Z0-9_]*$/.test(key) && value.length <= 32_768 && !/[\0\r\n]/.test(value) ), "controller_read_child_arm", );
    this.#armed = { argv: [...request.argv], cwd: request.cwd, environment: { ...request.environment }, verifyContract: request.verifyContract, };
    return [...request.argv]; }

  spawn(argv: readonly string[]): ControllerEffectChild { const armed = this.#armed;
    requireCondition( armed !== null && activeProductionChild === null && productionInterrupted === null && canonicalJson(argv) === canonicalJson(armed.argv), "controller_read_child_arm", );
    this.verifyLocalAuthority();
    armed.verifyContract();
    const child = Bun.spawn([...armed.argv], { cwd: armed.cwd, env: { ...armed.environment }, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true, });
    ownProductionChild(child);
    const pid = Number(child.pid);
    requireCondition( Number.isSafeInteger(pid) && pid > 1 && !this.#records.has(pid), "controller_child_identity", );
    this.#records.set(pid, { ...armed, child, stdout: null, stderr: null, settlement: null, });
    this.#armed = null;
    return { pid, pgid: pid }; }

  async settle( identity: ControllerEffectChild, timeoutMilliseconds: number, ): Promise<ControllerEffectSettlement> { const record = this.#records.get(identity.pid);
    requireCondition( record !== undefined && identity.pgid === identity.pid && activeProductionChild === record.child && record.settlement === null, "controller_child_identity", );
    const bounded = await settleBoundedProductionChild( record.child, identity.pgid, timeoutMilliseconds, );
    const { exitCode, stdout, stderr, timedOut, outputFailed, forcedSettlement, processGroupSettled, } = bounded;
    const termination: ControllerEffectSettlement["termination"] = timedOut ? "timeout" : productionInterrupted !== null || outputFailed || forcedSettlement ? "signal" : "exit";
    const detailSHA256 = sha256(canonicalJson({ argv_sha256: sha256(canonicalJson(record.argv)), cwd: record.cwd, environment_keys: Object.keys(record.environment).sort(), exit_code: exitCode, termination,
      process_group_settled: processGroupSettled, stdout_byte_count: stdout.byteLength, stdout_sha256: sha256(stdout), stderr_byte_count: stderr.byteLength, stderr_sha256: sha256(stderr), }));
    const settlement = { exitCode, termination, processGroupSettled, detailSHA256, } satisfies ControllerEffectSettlement;
    record.stdout = stdout;
    record.stderr = stderr;
    record.settlement = settlement;
    if (processGroupSettled && activeProductionChild === record.child) { activeProductionChild = null; }
    if (processGroupSettled && interruptHardKill) { clearTimeout(interruptHardKill);
      interruptHardKill = null; }
    this.verifyLocalAuthority();
    record.verifyContract();
    return settlement; }

  takeStdout( identity: ControllerEffectChild, acceptedExitCodes: readonly number[], ): Uint8Array { const record = this.#records.get(identity.pid);
    requireCondition( record !== undefined && record.settlement !== null && record.settlement.exitCode !== null && acceptedExitCodes.includes(record.settlement.exitCode) && record.settlement.termination === "exit" &&
        record.settlement.processGroupSettled && record.stdout !== null, "controller_child_output", );
    const bytes = record.stdout;
    record.stdout = null;
    return bytes; }

  takeStderr( identity: ControllerEffectChild, acceptedExitCodes: readonly number[], ): Uint8Array { const record = this.#records.get(identity.pid);
    requireCondition( record !== undefined && record.settlement !== null && record.settlement.exitCode !== null && acceptedExitCodes.includes(record.settlement.exitCode) && record.settlement.termination === "exit" &&
        record.settlement.processGroupSettled && record.stderr !== null, "controller_child_output", );
    const bytes = record.stderr;
    record.stderr = null;
    return bytes; } }

export interface ControllerReadEffectRuntime extends ControllerEffectRuntime { takeStdout( identity: ControllerEffectChild, acceptedExitCodes: readonly number[], ): Uint8Array;
  takeStderr?( identity: ControllerEffectChild, acceptedExitCodes: readonly number[], ): Uint8Array; }

export interface ControllerSettledEffect { effectID: string;
  child: ControllerEffectChild;
  settlement: ControllerEffectSettlement; }

export async function executeControllerEffectToSettlement(request: { wal: ControllerWalWriter;
  runtime: ControllerEffectRuntime;
  effectID: string;
  effectKind: ControllerEffectKind;
  checkpoint: string;
  target: string;
  argv: readonly string[];
  timeoutMilliseconds: number;
  acceptedExitCodes?: readonly number[]; }): Promise<ControllerSettledEffect> { const acceptedExitCodes = request.acceptedExitCodes ?? [0];
  requireCondition( request.wal.lastEntry !== null && (["ready", "verified", "transition_verified"].includes( request.wal.lastEntry.phase, ) || (request.wal.lastEntry.phase === "settled" && request.effectKind === "read_fleet")) &&
      /^[a-z0-9_]{1,128}$/.test(request.effectID) && /^[a-z0-9_]{1,128}$/.test(request.checkpoint) && request.argv.length >= 1 && request.argv.length <= 128 && request.argv.every((entry) => typeof entry === "string" && entry.length >= 1 &&
        entry.length <= 4096 && !/[\0\r\n]/.test(entry) ) && Number.isSafeInteger(request.timeoutMilliseconds) && request.timeoutMilliseconds >= 1_000 && request.timeoutMilliseconds <= 600_000 &&
      acceptedExitCodes.length >= 1 && acceptedExitCodes.length <= 8 && new Set(acceptedExitCodes).size === acceptedExitCodes.length && acceptedExitCodes.every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= 255 ),
    "controller_effect_contract", );
  const base = { checkpoint: request.checkpoint, effect_id: request.effectID, effect_kind: request.effectKind, target: request.target, argv_sha256: sha256(canonicalJson(request.argv)), } as const;
  request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "attempting", pid: null, pgid: null, exit_code: null, termination: null, local_process_group_settled: false, provider_transition_sha256: null,
    fleet_readback_sha256: null, detail_sha256: null, failure_code: null, });
  let child: ControllerEffectChild | null = null;
  let settlement: ControllerEffectSettlement | null = null;
  try { child = request.runtime.spawn(request.argv);
    requireCondition( Number.isSafeInteger(child.pid) && child.pid > 1 && child.pgid === child.pid, "controller_child_identity", );
    request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "spawned", pid: child.pid, pgid: child.pgid, exit_code: null, termination: null, local_process_group_settled: false, provider_transition_sha256: null,
      fleet_readback_sha256: null, detail_sha256: null, failure_code: null, });
    settlement = await request.runtime.settle( child, request.timeoutMilliseconds, );
    if ( !validSha(settlement.detailSHA256) || !settlement.processGroupSettled || settlement.termination !== "exit" || settlement.exitCode === null ) { throw new ControllerManualInterventionError( "controller_child_uncertain", ); }
    if (!acceptedExitCodes.includes(settlement.exitCode)) { const observation = [ "read_fleet", "read_secrets", "read_git", "read_keychain", "read_process", "public_probe", "ordinary_postflight", "runtime_probe",
      ].includes(request.effectKind);
      if (observation) { throw new ControllerSettledObservationError( "controller_observation_exit", ); }
      throw new ControllerManualInterventionError( "controller_child_uncertain", ); }
    request.wal.append({ ...base, recorded_at: request.runtime.now(), phase: "settled", pid: child.pid, pgid: child.pgid, exit_code: settlement.exitCode, termination: "exit", local_process_group_settled: true,
      provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: settlement.detailSHA256, failure_code: null, });
    return { effectID: request.effectID, child, settlement }; } catch (error) { const previous = request.wal.lastEntry;
    if ( previous !== null && previous.effect_id === request.effectID && previous.phase !== "failed_or_uncertain" && previous.phase !== "settled" ) { request.wal.append({ ...base, recorded_at: request.runtime.now(),
        phase: "failed_or_uncertain", pid: child?.pid ?? null, pgid: child?.pgid ?? null, exit_code: settlement?.exitCode ?? null, termination: settlement?.termination ?? null,
        local_process_group_settled: settlement?.processGroupSettled === true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: settlement?.detailSHA256 ?? null,
        failure_code: error instanceof MaintenanceRefenceError || error instanceof ControllerManualInterventionError || error instanceof ControllerSettledObservationError ? error.code : "controller_child_refused", }); }
    if ( error instanceof ControllerManualInterventionError || error instanceof ControllerSettledObservationError ) throw error;
    throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_child_refused", ); } }

export function appendControllerTransitionVerification(request: { wal: ControllerWalWriter;
  effectID: string;
  recordedAt: string;
  providerTransitionSHA256: string;
  fleetReadbackSHA256: string;
  detailSHA256: string; }): ControllerWalEntry { const subject = request.wal.settledEffect(request.effectID);
  const terminal = request.wal.lastEntry;
  requireCondition( subject !== null && terminal !== null && terminal.phase === "verified" && terminal.effect_kind === "read_fleet" && validUtcTimestamp(request.recordedAt) && validSha(request.providerTransitionSHA256) &&
      validSha(request.fleetReadbackSHA256) && validSha(request.detailSHA256), "controller_transition_verification", );
  return request.wal.append({
    recorded_at: request.recordedAt, phase: "transition_verified", checkpoint: subject.checkpoint, effect_id: subject.effect_id, effect_kind: subject.effect_kind, target: subject.target, argv_sha256: subject.argv_sha256, pid: subject.pid,
    pgid: subject.pgid, exit_code: subject.exit_code, termination: "exit", local_process_group_settled: true, provider_transition_sha256: request.providerTransitionSHA256, fleet_readback_sha256: request.fleetReadbackSHA256,
    detail_sha256: request.detailSHA256, failure_code: null, }); }

function appendControllerTransitionFailure(request: { wal: ControllerWalWriter;
  effectID: string;
  recordedAt: string;
  failureCode: string; }): ControllerWalEntry { const subject = request.wal.settledEffect(request.effectID);
  const terminal = request.wal.lastEntry;
  requireCondition( subject !== null && terminal !== null && terminal.phase === "verified" && terminal.effect_kind === "read_fleet" && validUtcTimestamp(request.recordedAt) && /^[a-z0-9_]{1,64}$/.test(request.failureCode),
    "controller_transition_failure", );
  return request.wal.append({
    recorded_at: request.recordedAt, phase: "failed_or_uncertain", checkpoint: subject.checkpoint, effect_id: subject.effect_id, effect_kind: subject.effect_kind, target: subject.target, argv_sha256: subject.argv_sha256, pid: subject.pid,
    pgid: subject.pgid, exit_code: subject.exit_code, termination: "exit", local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: sha256(canonicalJson({
      failure_code: request.failureCode, terminal_read_effect_id: terminal.effect_id, terminal_read_fleet_sha256: terminal.fleet_readback_sha256, })), failure_code: request.failureCode, }); }

export function appendControllerSettledVerification(request: { wal: ControllerWalWriter;
  effectID: string;
  recordedAt: string;
  verification: ControllerEffectVerification; }): ControllerWalEntry { const subject = request.wal.lastEntry;
  requireCondition( subject !== null && subject.phase === "settled" && subject.effect_id === request.effectID && validUtcTimestamp(request.recordedAt) && validSha(request.verification.providerTransitionSHA256) &&
      validSha(request.verification.fleetReadbackSHA256) && validSha(request.verification.detailSHA256), "controller_effect_verification", );
  return request.wal.append({
    recorded_at: request.recordedAt, phase: "verified", checkpoint: subject.checkpoint, effect_id: subject.effect_id, effect_kind: subject.effect_kind, target: subject.target, argv_sha256: subject.argv_sha256, pid: subject.pid,
    pgid: subject.pgid, exit_code: subject.exit_code, termination: "exit", local_process_group_settled: true, provider_transition_sha256: request.verification.providerTransitionSHA256,
    fleet_readback_sha256: request.verification.fleetReadbackSHA256, detail_sha256: request.verification.detailSHA256, failure_code: null, }); }

function appendControllerSettledFailure(request: { wal: ControllerWalWriter;
  effectID: string;
  recordedAt: string;
  failureCode: string; }): ControllerWalEntry { const subject = request.wal.lastEntry;
  requireCondition( subject !== null && subject.phase === "settled" && subject.effect_id === request.effectID && validUtcTimestamp(request.recordedAt) && /^[a-z0-9_]{1,64}$/.test(request.failureCode), "controller_effect_failure", );
  return request.wal.append({
    recorded_at: request.recordedAt, phase: "failed_or_uncertain", checkpoint: subject.checkpoint, effect_id: subject.effect_id, effect_kind: subject.effect_kind, target: subject.target, argv_sha256: subject.argv_sha256, pid: subject.pid,
    pgid: subject.pgid, exit_code: subject.exit_code, termination: subject.termination, local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: subject.detail_sha256,
    failure_code: request.failureCode, }); }

/** @internal Closed observation child with durable intent and redacted WAL. */
export async function performControllerJournalledReadChildForTest<T>( request: { wal: ControllerWalWriter;
    runtime: ControllerReadEffectRuntime;
    effectID: string;
    effectKind: | "read_git"
      | "read_keychain"
      | "read_process"
      | "public_probe"
      | "ordinary_postflight"
      | "runtime_probe";
    checkpoint: string;
    target: string;
    argv: readonly string[];
    timeoutMilliseconds: number;
    acceptedExitCodes: readonly number[];
    validate( stdout: Uint8Array, exitCode: number, ): { value: T; semanticProjection: unknown };
    validateStderr?(stderr: Uint8Array): void; }, ): Promise<{ value: T; semanticSHA256: string }> { const settled = await executeControllerEffectToSettlement({ wal: request.wal, runtime: request.runtime, effectID: request.effectID,
    effectKind: request.effectKind, checkpoint: request.checkpoint, target: request.target, argv: request.argv, timeoutMilliseconds: request.timeoutMilliseconds, acceptedExitCodes: request.acceptedExitCodes, });
  let value: T;
  let rawSHA256: string;
  let semanticSHA256: string;
  let exitCode: number;
  try { const settledExitCode = settled.settlement.exitCode;
    requireCondition(settledExitCode !== null, "controller_read_child_output");
    exitCode = settledExitCode;
    const output = request.runtime.takeStdout( settled.child, request.acceptedExitCodes, );
    if (request.validateStderr !== undefined) { requireCondition( request.runtime.takeStderr !== undefined, "controller_read_child_stderr", );
      request.validateStderr( request.runtime.takeStderr( settled.child, request.acceptedExitCodes, ), ); }
    rawSHA256 = sha256(output);
    const validated = request.validate(output, exitCode);
    value = validated.value;
    semanticSHA256 = sha256(canonicalJson( validated.semanticProjection, )); } catch (error) { const failureCode = error instanceof MaintenanceRefenceError || error instanceof ControllerSettledObservationError ? error.code
      : "controller_read_child_output";
    try { appendControllerSettledFailure({ wal: request.wal, effectID: request.effectID, recordedAt: request.runtime.now(), failureCode, }); } catch { throw new ControllerManualInterventionError( "controller_observation_wal", ); }
    throw new ControllerSettledObservationError(failureCode); }
  try { appendControllerSettledVerification({ wal: request.wal, effectID: request.effectID, recordedAt: request.runtime.now(), verification: { providerTransitionSHA256: rawSHA256, fleetReadbackSHA256: semanticSHA256,
        detailSHA256: sha256(canonicalJson({ exit_code: exitCode, raw_sha256: rawSHA256, semantic_sha256: semanticSHA256, })), }, }); } catch { throw new ControllerManualInterventionError( "controller_observation_wal", ); }
  return { value, semanticSHA256 }; }

export interface ControllerFlyEffectRuntime extends ControllerEffectRuntime { arm(operation: ControllerFlyOperation): string[];
  takeStdout(identity: ControllerEffectChild): Uint8Array; }

/** @internal Journalled read shared by the controller guards and fakes. */
export async function performControllerJournalledProviderReadForTest(request: { wal: ControllerWalWriter;
  runtime: ControllerFlyEffectRuntime;
  operation: { kind: "list" } | { kind: "secrets" };
  effectID: string;
  checkpoint: string;
  target: string;
  semanticProjection(value: unknown[]): unknown; }): Promise<{ value: unknown[]; semanticSHA256: string }> { let argv: string[];
  try { argv = request.runtime.arm(request.operation); } catch (error) { throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_provider_read_arm", ); }
  const effectKind = request.operation.kind === "list" ? "read_fleet" : "read_secrets";
  const settled = await executeControllerEffectToSettlement({ wal: request.wal, runtime: request.runtime, effectID: request.effectID, effectKind, checkpoint: request.checkpoint, target: request.target, argv, timeoutMilliseconds: 120_000,
  });
  let value: unknown[];
  let rawSHA256: string;
  let semanticSHA256: string;
  try { const output = request.runtime.takeStdout(settled.child);
    rawSHA256 = sha256(output);
    value = maintenanceContract().parseFleetChildOutput(output);
    semanticSHA256 = sha256(canonicalJson( request.semanticProjection(value), )); } catch (error) { const failureCode = error instanceof MaintenanceRefenceError || error instanceof ControllerSettledObservationError ? error.code
      : "controller_provider_read_output";
    try { appendControllerSettledFailure({ wal: request.wal, effectID: request.effectID, recordedAt: request.runtime.now(), failureCode, }); } catch { throw new ControllerManualInterventionError( "controller_observation_wal", ); }
    throw new ControllerSettledObservationError(failureCode); }
  try { appendControllerSettledVerification({ wal: request.wal, effectID: request.effectID, recordedAt: request.runtime.now(), verification: { providerTransitionSHA256: rawSHA256, fleetReadbackSHA256: semanticSHA256,
        detailSHA256: sha256(canonicalJson({ operation: request.operation.kind, raw_sha256: rawSHA256, semantic_sha256: semanticSHA256, })), }, }); } catch { throw new ControllerManualInterventionError( "controller_observation_wal", ); }
  return { value, semanticSHA256 }; }

/** @internal One effect plus fresh pre/post full-five provider sandwiches. */
export async function performControllerFlyTransitionForTest(request: { wal: ControllerWalWriter;
  runtime: ControllerFlyEffectRuntime;
  evidence: TerminalEvidence;
  operation: ControllerFlyOperation;
  beforeExpectation: TargetFleetExpectation;
  expectation: TargetFleetExpectation;
  image: TargetImageContract | null;
  expectedPreFleetSHA256: string | null;
  ordinal: number;
  pause(milliseconds: number): Promise<void>;
  afterVerified?(proof: ControllerFleetTransitionProof): Promise<void>; }): Promise<{ image?: TargetImageContract;
  proofSHA256: string;
  fleetSHA256: string; }> { requireCondition( Number.isSafeInteger(request.ordinal) && request.ordinal >= 1 && request.ordinal <= 999_999 && request.operation.kind !== "list" && request.operation.kind !== "secrets",
    "controller_transition_runner", );
  const prefix = `effect_${String(request.ordinal).padStart(6, "0")}`;
  const readFleet = async (suffix: string): Promise<unknown[]> => { const effectID = `${prefix}_${suffix}`;
    const result = await performControllerJournalledProviderReadForTest({ wal: request.wal, runtime: request.runtime, operation: { kind: "list" }, effectID, checkpoint: suffix, target: APP, semanticProjection: (value) =>
        controllerFleetProjection( controllerFleetByID( value, request.evidence, "controller_fleet_output", ), ), });
    return result.value; };
  const beforeFirst = await readFleet("pre_read_1");
  await request.pause(FLEET_INTERVAL_MS);
  const beforeSecond = await readFleet("pre_read_2");
  try { requireCondition( request.expectedPreFleetSHA256 === null || validSha(request.expectedPreFleetSHA256), "controller_pre_effect_fleet", );
    const preProof = validateControllerFleetTransitionForTest({ beforeFirst, beforeSecond, first: beforeFirst, second: beforeSecond, evidence: request.evidence, operation: { kind: "list" }, image: request.image,
      expectation: request.beforeExpectation, });
    requireCondition( request.expectedPreFleetSHA256 === null || preProof.stable_fleet_sha256 === request.expectedPreFleetSHA256, "controller_pre_effect_continuity", ); } catch (error) { throw new ControllerManualInterventionError(
      error instanceof MaintenanceRefenceError ? error.code : "controller_pre_effect_fleet", ); }
  const operationContract = maintenanceContract().controllerOperationContract( request.operation, );
  const effectID = `${prefix}_${request.operation.kind}`;
  let argv: string[];
  try { argv = request.runtime.arm(request.operation); } catch (error) { throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_effect_arm", ); }
  await executeControllerEffectToSettlement({ wal: request.wal, runtime: request.runtime, effectID, effectKind: operationContract.effectKind, checkpoint: request.operation.kind, target: operationContract.target, argv,
    timeoutMilliseconds: operationContract.timeoutMilliseconds, });
  let first: unknown[];
  let second: unknown[];
  try { first = await readFleet("post_read_1");
    await request.pause(FLEET_INTERVAL_MS);
    second = await readFleet("post_read_2"); } catch (error) { if (error instanceof ControllerManualInterventionError) throw error;
    throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_post_effect_read", ); }
  let proof: ControllerFleetTransitionProof;
  try { proof = validateControllerFleetTransitionForTest({ beforeFirst, beforeSecond, first, second, evidence: request.evidence, operation: request.operation, image: request.image, expectation: request.expectation, }); } catch (error) {
    const failureCode = error instanceof MaintenanceRefenceError ? error.code : "controller_post_effect_fleet";
    appendControllerTransitionFailure({ wal: request.wal, effectID, recordedAt: request.runtime.now(), failureCode, });
    throw new ControllerManualInterventionError(failureCode); }
  const proofSHA256 = sha256(canonicalJson({ effect_id: effectID, effect_kind: operationContract.effectKind, operation: request.operation, proof, }));
  try { appendControllerTransitionVerification({ wal: request.wal, effectID, recordedAt: request.runtime.now(), providerTransitionSHA256: proofSHA256, fleetReadbackSHA256: proof.stable_fleet_sha256,
      detailSHA256: sha256(canonicalJson(proof)), }); } catch (error) { throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_transition_wal", ); }
  if (request.afterVerified) { try { await request.afterVerified(proof); } catch (error) { if (error instanceof ControllerManualInterventionError) throw error;
      throw new ControllerManualInterventionError( error instanceof MaintenanceRefenceError ? error.code : "controller_marker_advance", ); } }
  return { ...(proof.image === null ? {} : { image: proof.image }), proofSHA256, fleetSHA256: proof.stable_fleet_sha256, }; }

class ProductionBridgeMarkerState { readonly bindings: MarkerBindings;
  readonly roles: RoleMap;
  readonly lock: DeployLockAuthority;
  readonly preparation: ControllerPreparationBinding;
  readonly wal: ControllerWalWriter;
  #value: JsonRecord;
  #sha256: string;
  #effectOrdinal = 0;
  #recoveryActive = false;
  #effectsClosed = false;
  #a0Installed = false;

  constructor(request: { bindings: MarkerBindings;
    roles: RoleMap;
    lock: DeployLockAuthority;
    preparation: ControllerPreparationBinding;
    wal: ControllerWalWriter; }) { this.bindings = request.bindings;
    this.roles = request.roles;
    this.lock = request.lock;
    this.preparation = request.preparation;
    this.wal = request.wal;
    const marker = parsePrivateJson(MAINTENANCE_MARKER);
    validateBridgeMarker(marker.value, this.bindings, this.roles);
    this.#value = marker.value;
    this.#sha256 = marker.digest;
    this.verifyLocalAuthority(); }

  #verifyStaticAuthority(): void { verifyDeployLockAuthority(this.lock);
    verifyRetainedHandoffEvidence(this.bindings);
    requireDependencyEstate(this.preparation.dependencyEstate);
    requireProductionBuildContext(this.preparation.buildContext);
    const hashes = bridgeSourceHashes();
    requireCondition( hashes.raw === this.bindings.bridgeRawSHA256 && hashes.normalized === this.bindings.bridgeNormalizedSHA256, "bridge_marker_source", ); }

  #reconcileTransition( next: JsonRecord, nextSHA256: string, ): "current" | "next" { const state = reconcileDurableCanonicalJsonTransition({ canonicalPath: MAINTENANCE_MARKER, directory: DEPLOY_STATE_DIR,
      stagePath: bridgeMarkerTransitionStagePath(this.bindings, nextSHA256), currentValue: this.#value, currentSHA256: this.#sha256, nextValue: next, nextSHA256, verifyAuthority: () => this.#verifyStaticAuthority(), validate: (value) =>
        validateBridgeMarker(value, this.bindings, this.roles), });
    if (state === "next") { this.#value = next;
      this.#sha256 = nextSHA256; }
    return state; }

  #verifyDurableTransition(next: JsonRecord, nextSHA256: string): void { this.#verifyStaticAuthority();
    const marker = parsePrivateJson(MAINTENANCE_MARKER);
    validateBridgeMarker(marker.value, this.bindings, this.roles);
    requireCondition( marker.digest === nextSHA256 && marker.stat.nlink === 1 && canonicalJson(marker.value) === canonicalJson(next) && absent( bridgeMarkerTransitionStagePath(this.bindings, nextSHA256), "bridge_marker_reconciliation", ),
      "bridge_marker_reconciliation", );
    this.#value = next;
    this.#sha256 = nextSHA256; }

  #transition( next: JsonRecord, onDurableInstall?: () => void, ): { sha256: string; identity: DurableFileIdentity } { const nextSHA256 = sha256(`${canonicalJson(next)}\n`);
    let durableInstallObserved = false;
    const durableInstall = (): void => { if (durableInstallObserved) return;
      durableInstallObserved = true;
      this.#value = next;
      this.#sha256 = nextSHA256;
      onDurableInstall?.(); };
    try { const result = advanceBridgeMarkerCAS({ bindings: this.bindings, roles: this.roles, lock: this.lock, expectedCurrentSHA256: this.#sha256, nextValue: next, onDurableInstall: durableInstall, });
      this.#value = next;
      this.#sha256 = result.sha256;
      this.verifyLocalAuthority();
      return result; } catch (error) { try { if (durableInstallObserved) { this.#verifyDurableTransition(next, nextSHA256); } else if (this.#reconcileTransition(next, nextSHA256) === "next") { durableInstall(); } } catch {
        throw new ControllerManualInterventionError( "bridge_marker_reconciliation", ); }
      throw error; } }

  verifyLocalAuthority(): void { this.#verifyStaticAuthority();
    const marker = parsePrivateJson(MAINTENANCE_MARKER);
    requireCondition( marker.digest === this.#sha256 && marker.stat.nlink === 1, "bridge_marker_current", );
    validateBridgeMarker(marker.value, this.bindings, this.roles);
    const convergence = record( marker.value.database_convergence, "bridge_marker_database_convergence", );
    requireCondition( canonicalJson(marker.value) === canonicalJson(this.#value) && convergence.database_target_sha256 === this.preparation.databaseTargetSHA256 && convergence.before_proof_sha256 ===
          this.preparation.earlyDatabaseProofSHA256, "bridge_marker_current", ); }

  nextEffectOrdinal(): number { this.verifyLocalAuthority();
    requireCondition(!this.#effectsClosed, "controller_effect_gate_closed");
    this.#effectOrdinal += 1;
    requireCondition( this.#effectOrdinal <= 999_999, "controller_effect_ordinal", );
    return this.#effectOrdinal; }

  advance( checkpoint: string, mutate: (value: JsonRecord) => void = () => {}, ): void { requireCondition(!this.#effectsClosed, "controller_effect_gate_closed");
    requireCondition( /^[a-z0-9_]{1,128}$/.test(checkpoint), "bridge_marker_checkpoint", );
    this.verifyLocalAuthority();
    const next = structuredClone(this.#value);
    next.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    next.checkpoint = checkpoint;
    next.child_wal = { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", ...this.wal.projection(), };
    mutate(next);
    this.#transition(next); }

  get effectsClosed(): boolean { return this.#effectsClosed; }

  get a0Installed(): boolean { return this.#a0Installed; }

  closeEffects(): void { this.verifyLocalAuthority();
    requireCondition( !this.#effectsClosed && activeProductionChild === null, "controller_effect_gate_close", );
    this.#effectsClosed = true; }

  bindSealedWal( successProvenAt: string, walProjection: ControllerWalProjection, ): void { this.verifyLocalAuthority();
    requireCondition( this.#effectsClosed && this.wal.sealed && walProjection.terminal_phase === "complete" && validUtcTimestamp(successProvenAt) && this.#value.checkpoint === "all_final_gates_verified" && this.#value.status === "active" &&
        record(this.#value.database_convergence, "success_finalization") .status === "verified" && [ this.#value.guard_proofs.final_sha256, this.#value.public_proofs.first_canary_sha256, this.#value.public_proofs.final_sha256,
          this.#value.public_proofs.ordinary_postflight_sha256, ].every(validSha), "success_finalization_authority", );
    const next = structuredClone(this.#value);
    next.updated_at = successProvenAt;
    next.child_wal = { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", ...walProjection, };
    this.#transition(next); }

  successAuthorityMarker(): JsonRecord { this.verifyLocalAuthority();
    requireCondition( this.#effectsClosed && this.wal.sealed && this.#value.status === "active" && this.#value.checkpoint === "all_final_gates_verified" && record(this.#value.child_wal, "success_finalization_authority")
            .terminal_phase === "complete", "success_finalization_authority", );
    return structuredClone(this.#value); }

  previewSuccessFinalization(request: { successProvenAt: string;
    walProjection: ControllerWalProjection;
    authorityProjectionSHA256: string;
    receiptPath: string;
    witnessPath: string;
    markerRetirementClaimPath: string; }): { value: JsonRecord; bytesUTF8: string; sha256: string } { this.verifyLocalAuthority();
    requireCondition( this.#effectsClosed && this.wal.sealed, "success_finalization_preview", );
    const value = maintenanceContract().previewSuccessFinalizationMarker({ currentMarker: this.#value, ...request, });
    const bytesUTF8 = `${canonicalJson(value)}\n`;
    return { value, bytesUTF8, sha256: sha256(bytesUTF8) }; }

  beginSuccessFinalization(request: { successProvenAt: string;
    walProjection: ControllerWalProjection;
    authorityProjectionSHA256: string;
    receiptPath: string;
    witnessPath: string;
    markerRetirementClaimPath: string; }, onA0Installed: () => void): { identity: DurableFileIdentity;
    bytesUTF8: string;
    sha256: string; } { const preview = this.previewSuccessFinalization(request);
    const next = preview.value;
    const result = this.#transition(next, () => { this.#a0Installed = true;
      onA0Installed(); });
    requireCondition( preview.sha256 === result.sha256, "success_finalization_begin", );
    return { identity: result.identity, bytesUTF8: preview.bytesUTF8, sha256: result.sha256, }; }

  retainManualFailure(code: string): void { if (this.#a0Installed) return;
    if (this.#value.status === "success_proven_receipt_pending") { this.verifyLocalAuthority();
      return; }
    if (this.#value.status === "failed_or_uncertain") { this.verifyLocalAuthority();
      return; }
    if (!this.#effectsClosed) { this.recordFailure(code, true);
      return; }
    this.verifyLocalAuthority();
    if (this.#value.status === "failed_or_uncertain") return;
    const failureCode = /^[a-z0-9_]{1,64}$/.test(code) ? code : "controller_rollout_failure";
    const next = structuredClone(this.#value);
    next.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    next.status = "failed_or_uncertain";
    next.checkpoint = "failed_or_uncertain";
    next.recovery_required = true;
    next.manual_finalization_required = true;
    next.failure_code = failureCode;
    next.child_wal = { schema: "agenttool-phase-b-refence-maintenance-child-wal/v1", ...this.wal.projection(), };
    this.#transition(next);
    this.#recoveryActive = false; }

  recordTransition( operation: ControllerFlyOperation, expectation: TargetFleetExpectation, proof: ControllerFleetTransitionProof, ): void { const target = "machineID" in operation ? operation.machineID : null;
    this.advance( `effect_${this.wal.lastEntry?.ordinal ?? 0}_${operation.kind}`, ( value, ) => { value.mutation_effect_began = true;
        if (target !== null) { value.attempted_machine_ids = [ ...new Set([ ...value.attempted_machine_ids, target, ]), ].sort(); }
        value.image_verified_machine_ids = [ ...expectation.targetImageMachineIDs, ].sort();
        value.started_app_machine_ids = expectation.startedMachineIDs.filter(( id, ) => appIDs(this.roles).includes(id)).sort();
        value.autostart_restored_app_machine_ids = [ ...expectation.autostartEnabledAppMachineIDs, ].sort();
        if (operation.kind === "uncordon" && target !== null) { value.uncordon_attempted_app_machine_ids = [ ...new Set([ ...value.uncordon_attempted_app_machine_ids, target, ]), ].sort(); }
        value.uncordon_verified_app_machine_ids = [ ...expectation.uncordonedAppMachineIDs, ].sort();
        value.thinker_primary_started_verified = expectation.startedMachineIDs .includes(this.roles.thinker_primary);
        value.final_app_uncordon_verified = sameStringSet( expectation.uncordonedAppMachineIDs, appIDs(this.roles), );
        applyRecoveryMarkerTransitionForTest( value, operation, this.roles, this.#recoveryActive, );
        if (proof.image !== null) { value.image_tag = proof.image.tag;
          value.image_digest = proof.image.digest; } }, ); }

  databaseConvergence(): JsonRecord { this.verifyLocalAuthority();
    return structuredClone(record( this.#value.database_convergence, "bridge_marker_database_convergence", )); }

  recordDatabaseConvergenceIntent(entry: ControllerWalEntry): void { requireCondition( entry.effect_kind === "database_convergence" && entry.phase === "attempting", "database_convergence_intent", );
    const entrySHA256 = sha256(`${canonicalJson(entry)}\n`);
    this.advance("database_convergence_intent", (value) => { const current = record( value.database_convergence, "bridge_marker_database_convergence", );
      requireCondition( current.status === "initial", "database_convergence_intent", );
      value.mutation_effect_began = true;
      value.database_convergence = { ...current, status: "intent_unknown", intent_durable: true, statement_attempted: true, commit_state: "unknown", reconciliation_required: true, database_write_attempt_count: 1,
        intent_wal_ordinal: entry.ordinal, intent_wal_sha256: entrySHA256, }; }); }

  recordDatabaseConvergenceCommit( proof: DatabaseOriginConvergenceProof, entry: ControllerWalEntry, ): void { requireCondition( entry.effect_kind === "database_convergence" && entry.phase === "settled", "database_convergence_commit", );
    const entrySHA256 = sha256(`${canonicalJson(entry)}\n`);
    this.advance("database_convergence_commit_acknowledged", (value) => { const current = record( value.database_convergence, "bridge_marker_database_convergence", );
      requireCondition( current.status === "intent_unknown" && proof.database_target_sha256 === current.database_target_sha256 && proof.statement_sha256 === current.statement_sha256, "database_convergence_commit", );
      value.database_convergence = { ...current, status: "commit_acknowledged", commit_state: "acknowledged", rows_updated: 1, before_row_sha256: proof.before_row_sha256, after_row_sha256: proof.after_row_sha256,
        unchanged_projection_sha256: proof.unchanged_projection_sha256, delta_sha256: proof.delta_sha256, after_updated_at: proof.after_updated_at, clock_before: proof.clock_before, clock_after: proof.clock_after,
        commit_ack_wal_ordinal: entry.ordinal, commit_ack_wal_sha256: entrySHA256, }; }); }

  recordDatabaseConvergenceVerified( afterProofSHA256: string, entry: ControllerWalEntry, ): void { requireCondition( validSha(afterProofSHA256) && entry.effect_kind === "database_convergence" && entry.phase === "verified",
      "database_convergence_verified", );
    const entrySHA256 = sha256(`${canonicalJson(entry)}\n`);
    this.advance("database_convergence_verified", (value) => { const current = record( value.database_convergence, "bridge_marker_database_convergence", );
      requireCondition( current.status === "commit_acknowledged", "database_convergence_verified", );
      value.database_convergence = { ...current, status: "verified", verified: true, reconciliation_required: false, after_proof_sha256: afterProofSHA256, verified_wal_ordinal: entry.ordinal, verified_wal_sha256: entrySHA256, }; }); }

  beginRecovery(code: string): void { requireCondition(!this.#recoveryActive, "controller_recovery_state");
    const failureCode = /^[a-z0-9_]{1,64}$/.test(code) ? code : "controller_rollout_failure";
    this.advance("recovery_started", (value) => { value.status = "failed_or_uncertain";
      value.recovery_required = true;
      value.manual_finalization_required = false;
      value.failure_code = failureCode; });
    this.#recoveryActive = true; }

  recordFailure( code: string, manual: boolean, stoppedFenceVerified = false, ): void { const failureCode = /^[a-z0-9_]{1,64}$/.test(code) ? code : "controller_rollout_failure";
    this.advance( stoppedFenceVerified ? "failed_stopped_fence_verified" : "failed_or_uncertain", (value) => { value.status = "failed_or_uncertain";
        value.recovery_required = !stoppedFenceVerified;
        value.manual_finalization_required = manual || stoppedFenceVerified;
        value.failure_code = failureCode; }, );
    this.#recoveryActive = false; } }

/** @internal Pure marker-array evolution used by contained recovery tests. */
export function applyRecoveryMarkerTransitionForTest( value: JsonRecord, operation: ControllerFlyOperation, roles: RoleMap, recoveryActive: boolean, ): void { maintenanceContract().applyRecoveryMarkerTransition( value, operation, roles,
    recoveryActive, ); }

interface ProductionFlyOperationAdapter { performFlyOperation: ControllerRolloutDependencies["performFlyOperation"];
  snapshot(): { image: TargetImageContract | null;
    expectation: TargetFleetExpectation;
    fleetSHA256: string | null; }; }

function createProductionFlyOperationAdapter(request: { state: ProductionBridgeMarkerState;
  evidence: TerminalEvidence; }): ProductionFlyOperationAdapter { const runtime = new ProductionFlyEffectRuntime({ buildContextPath: request.state.preparation.buildContext.path,
    verifyLocalAuthority: () => request.state.verifyLocalAuthority(), });
  let image: TargetImageContract | null = null;
  let previousFleetSHA256: string | null = null;
  let previousExpectation: TargetFleetExpectation = { targetImageMachineIDs: [], restartRestoredMachineIDs: [], autostartEnabledAppMachineIDs: [], startedMachineIDs: [], uncordonedAppMachineIDs: [], };
  const performFlyOperation: ControllerRolloutDependencies[ "performFlyOperation" ] = async (operation, expectation, expectedPreFleetSHA256) => { requireCondition( validSha(expectedPreFleetSHA256) && (previousFleetSHA256 === null ||
          previousFleetSHA256 === expectedPreFleetSHA256) && (operation.kind === "build_push" || image !== null || (operation.kind === "update_image" && operation.machineID === request.evidence.roles.thinker_primary &&
            !operation.imageReference.includes("@"))), "controller_image_state", );
    const ordinal = request.state.nextEffectOrdinal();
    const result = await performControllerFlyTransitionForTest({ wal: request.state.wal, runtime, evidence: request.evidence, operation, beforeExpectation: previousExpectation, expectation, image, expectedPreFleetSHA256, ordinal,
      pause: (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds) ), afterVerified: async (proof) => { request.state.recordTransition(operation, expectation, proof); }, });
    if (result.image !== undefined) { if (image !== null) { requireCondition( canonicalJson(image) === canonicalJson(result.image), "controller_image_state", ); }
      image = result.image; }
    requireCondition(validSha(result.fleetSHA256), "controller_fleet_state");
    previousFleetSHA256 = result.fleetSHA256;
    previousExpectation = structuredClone(expectation);
    return result; };
  return { performFlyOperation, snapshot: () => ({ image: image === null ? null : structuredClone(image), expectation: structuredClone(previousExpectation), fleetSHA256: previousFleetSHA256, }), }; }

function createJournalledControllerLocalReaders(request: { state: ProductionBridgeMarkerState;
  evidence: TerminalEvidence; }): Pick<
  MaintenanceRefenceDependencies, "readGitProof" | "readKeychainProof" | "readProcessProof"
> { const runtime = new ProductionControllerReadEffectRuntime( () => request.state.verifyLocalAuthority(), );
  const run = async <T>(read: { suffix: string;
    effectKind: "read_git" | "read_keychain" | "read_process";
    checkpoint: string;
    target: string;
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    acceptedExitCodes: readonly number[];
    verifyContract(): void;
    validate( stdout: Uint8Array, exitCode: number, ): { value: T; semanticProjection: unknown }; }): Promise<T> => { const ordinal = request.state.nextEffectOrdinal();
    const argv = runtime.arm({ argv: read.argv, cwd: read.cwd, environment: read.environment, verifyContract: read.verifyContract, });
    const result = await performControllerJournalledReadChildForTest({ wal: request.state.wal, runtime, effectID: "local_" + String(ordinal).padStart(6, "0") + "_" +
        read.suffix, effectKind: read.effectKind, checkpoint: read.checkpoint, target: read.target, argv, timeoutMilliseconds: 120_000, acceptedExitCodes: read.acceptedExitCodes, validate: read.validate, });
    return result.value; };
  const runGit = async ( suffix: string, arguments_: readonly string[], validate: ( stdout: Uint8Array, ) => { value: string | true; semanticProjection: unknown }, ): Promise<string | true> => run({ suffix, effectKind: "read_git",
      checkpoint: "guard_git_" + suffix, target: "protected_main", argv: [ GIT, ...GIT_CLOSED_FLAGS, "-C", REPOSITORY_ROOT, ...arguments_, ], cwd: REPOSITORY_ROOT, environment: GIT_CHILD_ENVIRONMENT, acceptedExitCodes: [0],
      verifyContract: () => requirePinnedSystemExecutable(GIT, GIT_SHA256, 78), validate: (stdout, exitCode) => { requireCondition(exitCode === 0, "git_proof");
        return validate(stdout); }, });
  const gitLine = (stdout: Uint8Array, pattern: RegExp): string => { const text = decode(stdout, "git_proof");
    requireCondition( pattern.test(text) && text.endsWith("\n") && !text.slice(0, -1).includes("\n"), "git_proof", );
    return text.slice(0, -1); };
  const readGitProof = async (): Promise<GitProof> => { const revision = await runGit( "revision", ["rev-parse", "HEAD"], (stdout) => { const value = gitLine(stdout, /^[0-9a-f]{40}\n$/);
        return { value, semanticProjection: { revision: value } }; }, ) as string;
    const remoteRevision = await runGit( "remote_revision", ["rev-parse", GITHUB_MAIN_TRACKING_REF], (stdout) => { const value = gitLine(stdout, /^[0-9a-f]{40}\n$/);
        return { value, semanticProjection: { remote_revision: value } }; }, ) as string;
    const tree = await runGit( "tree", ["rev-parse", "HEAD^{tree}"], (stdout) => { const value = gitLine(stdout, /^[0-9a-f]{40}\n$/);
        return { value, semanticProjection: { tree: value } }; }, ) as string;
    const distanceText = await runGit( "distance", ["rev-list", "--count", EXPECTED_SOURCE_REVISION + "..HEAD"], (stdout) => { const value = gitLine(stdout, /^(?:0|[1-9][0-9]*)\n$/);
        return { value, semanticProjection: { distance: value } }; }, ) as string;
    await runGit( "ancestry", [ "merge-base", "--is-ancestor", EXPECTED_SOURCE_REVISION, "HEAD", ], (stdout) => { requireCondition(stdout.byteLength === 0, "git_proof");
        return { value: true, semanticProjection: { ancestry: true } }; }, );
    await runGit( "status", ["status", "--porcelain=v1", "--untracked-files=all"], (stdout) => { requireCondition(stdout.byteLength === 0, "git_proof");
        return { value: true, semanticProjection: { clean: true } }; }, );
    const bridgeRawSHA256 = await runGit( "bridge_source", ["show", "HEAD:bin/phase-b-refence-maintenance-bridge.ts"], (stdout) => { const value = sha256(stdout);
        requireCondition( value === request.evidence.bridgeRawSHA256, "git_proof", );
        return { value, semanticProjection: { bridge_source_sha256: value }, }; }, ) as string;
    const distance = Number(distanceText);
    requireCondition( revision === request.evidence.targetRevision && remoteRevision === revision && tree === request.evidence.targetTree && Number.isSafeInteger(distance) && distance === request.evidence.targetDistance && distance > 12 &&
        bridgeRawSHA256 === request.evidence.bridgeRawSHA256, "git_proof", );
    return { revision, tree, source_distance: distance, bridge_source_sha256: bridgeRawSHA256, clean: true, }; };
  const runSecurity = async <T>(read: { suffix: string;
    arguments: readonly string[];
    acceptedExitCodes: readonly number[];
    validate( stdout: Uint8Array, exitCode: number, ): { value: T; semanticProjection: unknown }; }): Promise<T> => run({ suffix: read.suffix, effectKind: "read_keychain", checkpoint: "guard_keychain_" + read.suffix, target: read.suffix,
      argv: [SECURITY, ...read.arguments], cwd: HOME, environment: CONTROLLER_ENVIRONMENT, acceptedExitCodes: read.acceptedExitCodes, verifyContract: () => requirePinnedSystemExecutable(SECURITY, SECURITY_SHA256, 1),
      validate: read.validate, });
  const readKeychainProof = async (): Promise<KeychainProof> => { await runSecurity({ suffix: "generation_absence", arguments: [ "find-generic-password", "-s", GENERATION_KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, ], acceptedExitCodes: [44],
      validate: (stdout, exitCode) => { requireCondition( exitCode === 44 && stdout.byteLength === 0, "keychain_generation", );
        return { value: true, semanticProjection: { generation_absent: true }, }; }, });
    const roles = await runSecurity({ suffix: "machine_map", arguments: [ "find-generic-password", "-s", MACHINE_MAP_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", ], acceptedExitCodes: [0], validate: (stdout, exitCode) => {
        requireCondition(exitCode === 0, "keychain_map");
        let text = decode(stdout, "keychain_map");
        text = text.replace(/\r?\n$/, "");
        requireCondition(sha256(text) === MACHINE_MAP_SHA256, "keychain_map");
        const map = record(JSON.parse(text), "keychain_map");
        const value = validateRoles({ app_lhr: map.app_lhr, app_cdg: map.app_cdg, thinker_primary: map.thinker_primary, thinker_standby: map.thinker_standby, });
        return { value, semanticProjection: { machine_map_sha256: MACHINE_MAP_SHA256, roles_sha256: roleMapSHA256(value), }, }; }, });
    requireCondition( canonicalJson(roles) === canonicalJson(request.evidence.roles), "keychain_map", );
    return { generation_absent: true, machine_map_sha256: MACHINE_MAP_SHA256, roles, }; };
  const readProcessProof = async (): Promise<ProcessProof> => run({ suffix: "process_census", effectKind: "read_process", checkpoint: "guard_process_census", target: "local_processes", argv: [PS, "-axo", "pid=,ppid=,command="], cwd: HOME,
      environment: CONTROLLER_ENVIRONMENT, acceptedExitCodes: [0], verifyContract: () => requirePinnedSystemExecutable(PS, PS_SHA256, 1), validate: (stdout, exitCode) => { requireCondition(exitCode === 0, "process_census");
        const value = processProofFromBytes(stdout);
        return { value, semanticProjection: value }; }, });
  return { readGitProof, readKeychainProof, readProcessProof }; }

function createJournalledControllerGuardDependencies(request: { state: ProductionBridgeMarkerState;
  evidence: TerminalEvidence;
  base: ChildlessMaintenanceRefenceBase; }): MaintenanceRefenceDependencies { requireCondition( request.base.controllerPhase === "post_handoff_childless" && request.evidence.edge === "H5", "controller_guard_dependency_phase", );
  const runtime = new ProductionFlyEffectRuntime({ buildContextPath: request.state.preparation.buildContext.path, verifyLocalAuthority: () => request.state.verifyLocalAuthority(), });
  const local = createJournalledControllerLocalReaders(request);
  const readProvider = async ( operation: { kind: "list" } | { kind: "secrets" }, checkpoint: string, ): Promise<unknown[]> => { const ordinal = request.state.nextEffectOrdinal();
    const prefix = `guard_${String(ordinal).padStart(6, "0")}`;
    const result = await performControllerJournalledProviderReadForTest({ wal: request.state.wal, runtime, operation, effectID: `${prefix}_${operation.kind}`, checkpoint, target: APP, semanticProjection: operation.kind === "list"
        ? (value) => controllerFleetProjection( controllerFleetByID( value, request.evidence, "controller_guard_fleet", ), ) : (value) => value, });
    return result.value; };
  return { readDatabaseProof: () => request.base.readDatabaseProof(), readProviderSecretInventory: () => readProvider({ kind: "secrets" }, "guard_provider_secrets"), readKeychainProof: local.readKeychainProof,
    readProcessProof: local.readProcessProof, readGitProof: local.readGitProof, readFleetInventory: () => readProvider({ kind: "list" }, "guard_fleet_inventory"), pause: (milliseconds) => request.base.pause(milliseconds),
    close: () => request.base.close(), }; }

interface ProductionControllerSession { readonly rolloutID: string;
  readonly evidence: TerminalEvidence;
  readonly lock: DeployLockAuthority;
  readonly state: ProductionBridgeMarkerState;
  readonly databaseConvergence: Readonly<{ proof: DatabaseOriginConvergenceProof;
    beforeProofSHA256: string;
    afterProofSHA256: string; }>;
  readonly databaseConvergenceMarkerSHA256: string;
  readonly childlessBase: ChildlessMaintenanceRefenceBase;
  readonly guardDependencies: MaintenanceRefenceDependencies;
  readonly fly: ProductionFlyOperationAdapter;
  closeForFinalization(): Promise<void>;
  closeResources(): Promise<void>;
  closeAuthority(): boolean;
  finalizationResourcesClosed(): boolean; }

function recordProductionControllerCheckpoint( session: ProductionControllerSession, checkpoint: string, detail: JsonRecord, ): Promise<void> { const requireSHA = (key: string): string => { const value = detail[key];
    requireCondition( typeof value === "string" && validSha(value), "controller_checkpoint", );
    return value; };
  const requireExactDetail = (keys: readonly string[]): void => exactKeys(detail, keys, "controller_checkpoint");
  if ( checkpoint === "prepublication_before_build" || checkpoint === "prepublication_before_image" ) { requireExactDetail(["proof_sha256", "stable_fleet_sha256"]);
    const proofSHA256 = requireSHA("proof_sha256");
    requireSHA("stable_fleet_sha256");
    session.state.advance(checkpoint, (value) => { const proofs = record(value.guard_proofs, "controller_checkpoint");
      proofs[`${checkpoint}_sha256`] = proofSHA256; }); } else if (checkpoint === "image_pushed_fence_pending") { requireExactDetail([]);
    session.state.advance(checkpoint, (value) => { value.mutation_effect_began = true; }); } else if (checkpoint === "fleet_image_verified") { requireExactDetail(["image_digest", "image_tag"]);
    requireCondition( typeof detail.image_tag === "string" && /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/ .test(detail.image_tag) && typeof detail.image_digest === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(detail.image_digest), "controller_checkpoint", );
    session.state.advance(checkpoint, (value) => { value.image_tag = detail.image_tag;
      value.image_digest = detail.image_digest; }); } else if (checkpoint === "cordoned_runtime_verified") { requireExactDetail(["proof_sha256"]);
    requireSHA("proof_sha256");
    session.state.advance(checkpoint, (value) => { value.cordoned_runtime_verified = true; }); } else if (checkpoint === "first_canary_public_verified") { requireExactDetail(["machine_id", "proof_sha256"]);
    const proofSHA256 = requireSHA("proof_sha256");
    requireCondition( detail.machine_id === session.evidence.roles.app_lhr[0], "controller_checkpoint", );
    session.state.advance(checkpoint, (value) => { record(value.public_proofs, "controller_checkpoint") .first_canary_sha256 = proofSHA256; }); } else if (checkpoint === "all_final_gates_verified") { requireExactDetail([
      "final_authority_sha256", "ordinary_absent_postflight_sha256", "public_sha256", ]);
    const finalAuthority = requireSHA("final_authority_sha256");
    const ordinary = requireSHA("ordinary_absent_postflight_sha256");
    const publicSHA256 = requireSHA("public_sha256");
    session.state.advance(checkpoint, (value) => { record(value.guard_proofs, "controller_checkpoint").final_sha256 = finalAuthority;
      const publicProofs = record(value.public_proofs, "controller_checkpoint");
      publicProofs.final_sha256 = publicSHA256;
      publicProofs.ordinary_postflight_sha256 = ordinary; }); } else if (checkpoint === "recovery_transition_verified") { requireExactDetail(["operation", "proof_sha256", "target"]);
    requireSHA("proof_sha256");
    requireCondition( typeof detail.operation === "string" && typeof detail.target === "string", "controller_checkpoint", );
    session.state.advance(checkpoint); } else if (checkpoint === "recovery_fence_verified") { const detailKeys = Object.keys(detail).sort();
    const mutatedShape = canonicalJson(detailKeys) === canonicalJson(["proof_sha256"]);
    const unmutatedShape = canonicalJson(detailKeys) === canonicalJson([ "fleet_mutation_verified", "proof_sha256", "provider_effect_verified", ]);
    requireCondition( (mutatedShape || (unmutatedShape && detail.provider_effect_verified === true && detail.fleet_mutation_verified === false)) && validSha(detail.proof_sha256), "controller_checkpoint", );
    session.state.advance(checkpoint); } else if (checkpoint === "failed_stopped_fence_verified") { requireExactDetail(["mutation_effect_began", "recovery_sha256"]);
    requireSHA("recovery_sha256");
    requireCondition( detail.mutation_effect_began === true, "controller_checkpoint", );
    session.state.verifyLocalAuthority(); } else { return Promise.reject( new ControllerManualInterventionError("controller_checkpoint"), ); }
  return Promise.resolve(); }

async function runProductionSpecialGuard( session: ProductionControllerSession, checkpoint: "prepublication_before_build" | "prepublication_before_image", ): Promise<{ proofSHA256: string; fleetSHA256: string }> {
  const result = await runMaintenanceRefenceGuardForController({ checkpoint: "prepublication", receiptSHA256: session.state.bindings.receiptSHA256, targetRevision: session.evidence.targetRevision, targetTree: session.evidence.targetTree,
    rolloutID: session.rolloutID, expectedDatabaseUpdatedAt: session.databaseConvergence.proof.after_updated_at, }, session.guardDependencies);
  requireOriginalTerminalIdentity(result.evidence, session.evidence);
  requireCondition( result.evidence.edge === "H5" && result.proof.fence_verified === true && result.proof.public_surfaces_verified === false && result.proof.public_surfaces_expected_unavailable === true &&
      validSha(result.proof.stable_fleet_sha256), "controller_prepublication_guard", );
  return { proofSHA256: sha256(serializeMaintenanceRefenceProof(result.proof)), fleetSHA256: result.proof.stable_fleet_sha256, }; }

/** @internal Exact silent service-process proof executed through Fly SSH. */
export function controllerRuntimeRemoteCommandForTest( evidence: TerminalEvidence, machineID: string, role: "app" | "thinker_primary", ): string { const applications = appIDs(evidence.roles);
  requireCondition( validRevision(evidence.targetRevision) && validMachineID(machineID) && (role === "app" ? applications.includes(machineID) : machineID === evidence.roles.thinker_primary), "controller_runtime_probe", );
  const sourcePath = role === "app" ? "src/index.ts" : "src/thinker.ts";
  const processGroup = role === "app" ? "app" : "thinker";
  const script = [ "try{", "const fail=()=>process.exit(1);", 'const fs=await import("node:fs/promises");', 'const decoder=new TextDecoder("utf-8",{fatal:true});', "const candidates=[];", 'for(const name of await fs.readdir("/proc")){',
    "if(!/^[0-9]+$/.test(name))continue;try{", 'const fields=decoder.decode(await fs.readFile("/proc/"+name+"/cmdline")).split(String.fromCharCode(0));', 'if(fields.pop()!==""||fields.length!==3||fields.some((field)=>field===""))continue;',
    'const executable=fields[0].split("/").at(-1);', `if(executable==="bun"&&fields[1]==="run"&&fields[2]==="${sourcePath}")candidates.push(name);`, "}catch{}}", "if(candidates.length!==1)fail();",
    'const fields=decoder.decode(await fs.readFile("/proc/"+candidates[0]+"/environ")).split(String.fromCharCode(0));', 'if(fields.pop()!==""||fields.some((field)=>field===""))fail();', "const target=Object.create(null);",
    "for(const field of fields){", 'const separator=field.indexOf("=");if(separator<1)fail();', "const key=field.slice(0,separator);", "if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||Object.hasOwn(target,key))fail();",
    "target[key]=field.slice(separator+1);", "}", `if(target.AGENTTOOL_GIT_REVISION!=="${evidence.targetRevision}")fail();`, 'if(target.AGENTTOOL_SOURCE_DIRTY!=="false")fail();', 'if(target.AGENTTOOL_DISABLE_WORKERS!=="1")fail();',
    `if(target.FLY_MACHINE_ID!=="${machineID}")fail();`, `if(target.FLY_PROCESS_GROUP!=="${processGroup}")fail();`, 'for(const key of ["AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION","REDIS_URL"]){',
    "if(Object.hasOwn(target,key)||Object.hasOwn(process.env,key))fail();", "}", 'for(const key of ["DATABASE_URL","DATABASE_SESSION_URL"]){',
    'if(typeof target[key]!=="string"||target[key].length===0||target[key]!==process.env[key])fail();', "}", role === "thinker_primary" ? 'if(target.AGENTOOL_ENABLE_THINKER!=="1")fail();' : "",
    'const database=await import("/app/src/db/verify-connections.ts");', 'if(typeof database.verifyDeployedDatabaseConnections!=="function")fail();', "await database.verifyDeployedDatabaseConnections();", role === "app" ? [
        'const url="http://127.0.0.1:3000/health";', 'const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(5000)});', "const body=await response.json();",
        `if(body.service!=="agenttool"||body.status!=="alive"||body.build.revision!=="${evidence.targetRevision}"||body.build.dirty!==false)fail();`, "if(response.status!==200)fail();",
        'if(body.covenant_v2_authority!=="absent_fail_closed")fail();', ].join("") : "", "}catch{process.exit(1)}", ].join("");
  requireCondition( Buffer.byteLength(script) <= 3_500 && !/[\0\r\n']/.test(script), "controller_runtime_probe", );
  return `bun --no-install --no-env-file -e '${script}'`; }

/** @internal Exact Fly argv for one cordoned service-process proof. */
export function controllerRuntimeFlyArgvForTest( evidence: TerminalEvidence, machineID: string, role: "app" | "thinker_primary", ): string[] { const remoteCommand = controllerRuntimeRemoteCommandForTest( evidence, machineID, role, );
  requireCondition( Buffer.byteLength(remoteCommand) <= 4_096 && !/[\0\r\n]/.test(remoteCommand) && /^bun --no-install --no-env-file -e '[^']+'$/ .test(remoteCommand), "controller_runtime_probe", );
  return [ PINNED_FLY, "ssh", "console", "--app", APP, "--machine", machineID, "--quiet", "--pty=false", "--command", remoteCommand, ]; }

async function runProductionRuntimeMachineProbe( session: ProductionControllerSession, runtime: ProductionControllerReadEffectRuntime, machineID: string, role: "app" | "thinker_primary", checkpoint: string, ): Promise<string> {
  requireCondition( validMachineID(machineID) && /^[a-z0-9_]{1,128}$/.test(checkpoint), "controller_runtime_probe", );
  const flyArgv = controllerRuntimeFlyArgvForTest( session.evidence, machineID, role, );
  const remoteCommand = flyArgv.at(-1)!;
  const ordinal = session.state.nextEffectOrdinal();
  const argv = runtime.arm({ argv: flyArgv, cwd: HOME, environment: CONTROLLER_ENVIRONMENT, verifyContract: () => { requirePinnedUserExecutable( PINNED_FLY, PINNED_FLY_SHA256, "fly_contract", );
      requireFlyAuthenticationConfig(); }, });
  const result = await performControllerJournalledReadChildForTest({ wal: session.state.wal, runtime, effectID: `runtime_${String(ordinal).padStart(6, "0")}_${role}`, effectKind: "runtime_probe", checkpoint, target: machineID, argv,
    timeoutMilliseconds: 120_000, acceptedExitCodes: [0], validate: (stdout, exitCode) => { requireCondition( exitCode === 0 && stdout.byteLength === 0, "controller_runtime_probe", );
      return {
        value: true, semanticProjection: { schema: "agenttool-phase-b-refence-runtime-probe-semantic/v1", command_sha256: sha256(remoteCommand), machine_id: machineID, role, source_path: role === "app" ? "src/index.ts" : "src/thinker.ts",
          process_group: role === "app" ? "app" : "thinker", service_process_count: 1, target_revision: session.evidence.targetRevision, source_dirty: false, disable_workers_switch: "1", generation_secret: "absent", redis_url: "absent",
          database_environment_matches_shell: true, database_connections_verified: true, thinker_primary_enabled: role === "thinker_primary" ? true : null, app_loopback_authority: role === "app" ? "absent_fail_closed" : null,
          verified: true, }, }; }, validateStderr: (stderr) => requireCondition(stderr.byteLength === 0, "controller_runtime_probe"), });
  return result.semanticSHA256; }

async function runProductionCordonedRuntime( session: ProductionControllerSession, startedMachineIDs: readonly string[], ): Promise<string> { const snapshot = session.fly.snapshot();
  requireCondition( snapshot.image !== null && snapshot.fleetSHA256 !== null && validSha(snapshot.fleetSHA256), "controller_cordoned_runtime_admission", );
  const runtime = new ProductionControllerReadEffectRuntime( () => session.state.verifyLocalAuthority(), );
  const proof = await runControllerCordonedRuntimeCoreForTest({ evidence: session.evidence, image: snapshot.image, expectation: snapshot.expectation, expectedFleetSHA256: snapshot.fleetSHA256, startedMachineIDs, dependencies: {
      readFleetInventory: () => session.guardDependencies.readFleetInventory(), pause: (milliseconds) => session.childlessBase.pause(milliseconds), runMachineProbe: (machineID, role) => runProductionRuntimeMachineProbe( session, runtime,
          machineID, role, `cordoned_runtime_${role}`, ), }, });
  return sha256(canonicalJson(proof)); }

async function runProductionPublicObservation( session: ProductionControllerSession, runtime: ProductionControllerReadEffectRuntime, url: typeof PUBLIC_HEALTH_URL | typeof PUBLIC_FEDERATION_ABOUT_URL, checkpoint: string,
): Promise<ControllerPublicJsonObservation> { requireCondition( /^[a-z0-9_]{1,128}$/.test(checkpoint), "controller_public_checkpoint", );
  const ordinal = session.state.nextEffectOrdinal();
  const argv = runtime.arm({ argv: controllerPublicHTTPArgvForTest(url), cwd: "/", environment: CONTROLLER_ENVIRONMENT, verifyContract: () => { requirePinnedBunController();
      requireCondition( Buffer.byteLength(PUBLIC_HTTP_PROGRAM) <= 4_096 && !/[\0\r\n]/.test(PUBLIC_HTTP_PROGRAM), "controller_public_argv", ); }, });
  const endpoint = url === PUBLIC_HEALTH_URL ? "health" : "about";
  const result = await performControllerJournalledReadChildForTest({ wal: session.state.wal, runtime, effectID: `public_${String(ordinal).padStart(6, "0")}_${endpoint}`, effectKind: "public_probe", checkpoint, target: endpoint, argv,
    timeoutMilliseconds: 60_000, acceptedExitCodes: [0], validate: (stdout, exitCode) => { requireCondition(exitCode === 0, "controller_public_output");
      const observation = parseControllerPublicObservationForTest(stdout);
      const projectionSHA256 = url === PUBLIC_HEALTH_URL ? validateControllerPublicHealthForTest( observation, session.evidence.targetRevision, ) : validateControllerPublicFederationAboutForTest(observation);
      requireCondition(observation.finalURL === url, "controller_public_url");
      return {
        value: observation, semanticProjection: { schema: "agenttool-phase-b-refence-public-observation-semantic/v1", body_byte_count: observation.bodyByteCount, body_sha256: observation.bodySha256, endpoint, final_url_sha256: sha256(url),
          observation_program_sha256: sha256(PUBLIC_HTTP_PROGRAM), observation_settled_at_unix_ms: observation.observationSettledAtUnixMs, observation_started_at_unix_ms: observation.observationStartedAtUnixMs,
          projection_sha256: projectionSHA256, redirected: false, status: 200, }, }; }, validateStderr: (stderr) => requireCondition(stderr.byteLength === 0, "controller_public_stderr"), });
  return result.value; }

async function runProductionFirstCanaryPublic( session: ProductionControllerSession, ): Promise<string> { const snapshot = session.fly.snapshot();
  requireCondition( snapshot.image !== null && snapshot.fleetSHA256 !== null && validSha(snapshot.fleetSHA256), "controller_first_canary_admission", );
  const runtime = new ProductionControllerReadEffectRuntime( () => session.state.verifyLocalAuthority(), );
  const proof = await runControllerFirstCanaryPublicCoreForTest({ evidence: session.evidence, image: snapshot.image, expectation: snapshot.expectation, expectedFleetSHA256: snapshot.fleetSHA256, dependencies: {
      readFleetInventory: () => session.guardDependencies.readFleetInventory(), readPublicJson: (url, checkpoint) => runProductionPublicObservation(session, runtime, url, checkpoint),
      pause: (milliseconds) => session.childlessBase.pause(milliseconds), }, });
  session.state.verifyLocalAuthority();
  return sha256(canonicalJson(proof)); }

async function runProductionDeployedProcessProof( session: ProductionControllerSession, checkpoint: string, ): Promise<string> { requireCondition( checkpoint === "process_before" || checkpoint === "process_after",
    "controller_final_process", );
  const runtime = new ProductionControllerReadEffectRuntime( () => session.state.verifyLocalAuthority(), );
  const applications = appIDs(session.evidence.roles);
  const machineIDsToProbe = [ ...applications, session.evidence.roles.thinker_primary, ];
  const probes: string[] = [];
  for (const machineID of machineIDsToProbe) { probes.push( await runProductionRuntimeMachineProbe( session, runtime, machineID, applications.includes(machineID) ? "app" : "thinker_primary", `final_${checkpoint}`, ), ); }
  requireCondition( probes.length === 4 && probes.every(validSha), "controller_final_process", );
  return sha256(canonicalJson({ schema: "agenttool-phase-b-refence-deployed-process-proof/v1", machine_ids: machineIDsToProbe, process_count: 4, probe_sha256: probes, target_revision: session.evidence.targetRevision, verified: true, })); }

async function runProductionFinalAuthorityAndPublic( session: ProductionControllerSession, ): Promise<{ publicProofSHA256: string; authorityProofSHA256: string }> { const snapshot = session.fly.snapshot();
  requireCondition( snapshot.image !== null && snapshot.fleetSHA256 !== null && validSha(snapshot.fleetSHA256), "controller_final_admission", );
  const publicRuntime = new ProductionControllerReadEffectRuntime( () => session.state.verifyLocalAuthority(), );
  const result = await runControllerFinalAuthorityCoreForTest({ evidence: session.evidence, image: snapshot.image, expectation: snapshot.expectation, expectedFleetSHA256: snapshot.fleetSHA256, expectedDatabaseUpdatedAt:
      session.databaseConvergence.proof.after_updated_at, dependencies: { readEvidence: () => classifyHandoff( session.state.bindings.receiptSHA256, session.evidence.targetRevision, session.evidence.targetTree, session.rolloutID, ),
      readGitProof: () => session.guardDependencies.readGitProof(), readKeychainProof: () => session.guardDependencies.readKeychainProof(), readProviderSecretInventory: () => session.guardDependencies.readProviderSecretInventory(),
      readDeployedProcessProof: (checkpoint) => runProductionDeployedProcessProof(session, checkpoint), readFleetInventory: () => session.guardDependencies.readFleetInventory(), readPublicJson: (url, checkpoint) =>
        runProductionPublicObservation( session, publicRuntime, url, checkpoint, ), readDatabaseProof: () => session.childlessBase.readDatabaseProof(), }, });
  session.state.verifyLocalAuthority();
  return result; }

function requireOrdinaryGuardSource(): void { const source = readStableRepositoryBlob( "bin/phase-b-deploy-guard.ts", { mode: 0o644, objectSHA1: ORDINARY_GUARD_GIT_BLOB }, );
  requireCondition( source.bytes.byteLength === ORDINARY_GUARD_BYTE_COUNT && sha256(source.bytes) === ORDINARY_GUARD_SHA256 && realpathSync(ORDINARY_GUARD_SOURCE) === ORDINARY_GUARD_SOURCE, "ordinary_guard_source", ); }

async function runProductionOrdinaryAbsentPostflight( session: ProductionControllerSession, ): Promise<string> { session.state.verifyLocalAuthority();
  requireOrdinaryGuardSource();
  const database = session.childlessBase .takeOrdinaryPostflightDatabaseEnvironment();
  const environment = Object.freeze({ ...CONTROLLER_ENVIRONMENT, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", DATABASE_URL: database.DATABASE_URL, DATABASE_SESSION_URL: database.DATABASE_SESSION_URL, });
  const runtime = new ProductionControllerReadEffectRuntime( () => session.state.verifyLocalAuthority(), );
  const argv = runtime.arm({ argv: [ PINNED_BUN, "--no-install", "--no-env-file", ORDINARY_GUARD_SOURCE, "postflight", "--revision", session.evidence.targetRevision, ], cwd: REPOSITORY_ROOT, environment, verifyContract: () => {
      requirePinnedBunController();
      requireOrdinaryGuardSource();
      requireDependencyEstate(session.state.preparation.dependencyEstate); }, });
  const ordinal = session.state.nextEffectOrdinal();
  const result = await performControllerJournalledReadChildForTest({ wal: session.state.wal, runtime, effectID: `ordinary_${String(ordinal).padStart(6, "0")}_postflight`, effectKind: "ordinary_postflight",
    checkpoint: "ordinary_absent_postflight", target: "phase_b_deploy_guard", argv, timeoutMilliseconds: 180_000, acceptedExitCodes: [0], validate: (stdout, exitCode) => { requireCondition(exitCode === 0, "ordinary_postflight_proof");
      const rawSHA256 = validateOrdinaryAbsentPostflightBytesForTest( stdout, session.evidence.targetRevision, );
      return { value: rawSHA256, semanticProjection: { guard_sha256: ORDINARY_GUARD_SHA256, phase: "postflight", proof_sha256: rawSHA256, state: "absent_fail_closed", target_revision: session.evidence.targetRevision, }, }; },
    validateStderr: (stderr) => requireCondition( stderr.byteLength === 0, "ordinary_postflight_stderr", ), });
  session.state.verifyLocalAuthority();
  requireOrdinaryGuardSource();
  return result.value; }

function controllerStartedAt(now = new Date()): string { const value = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  requireCondition(validUtcTimestamp(value), "controller_time");
  return value; }

function controllerRolloutID( targetRevision: string, startedAt: string, entropy = randomBytes(8).toString("hex"), ): string { requireCondition( validRevision(targetRevision) && validUtcTimestamp(startedAt) &&
      /^[0-9a-f]{16}$/.test(entropy), "controller_rollout_id", );
  const compact = startedAt.replace(/[-:]/g, "");
  const value = `maintenance-refence-${ targetRevision.slice(0, 12) }-${compact}-${entropy}`;
  requireCondition( /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/ .test(value), "controller_rollout_id", );
  return value; }

function deployLockPreparationBinding( lock: DeployLockAuthority, ): ControllerPreparationBinding["deployLock"] { verifyDeployLockAuthority(lock);
  return { schema: "agenttool-local-deploy-lock/v1", public_path: DEPLOY_LOCK, owner_record: lock.ownerPath, device: lock.identity.device, inode: lock.identity.inode, sha256: sha256(lock.recordBytes), pid: process.pid, }; }

/**
 * Private production composition boundary. The public main deliberately does
 * not call this until the remaining runtime/public/receipt matrix is closed.
 * Any failure retains the canonical lock; pre-H helpers never guess cleanup,
 * and post-H failures additionally retain the dedicated marker and archives.
 */
async function createProductionControllerSession( arguments_: ControllerArguments, ): Promise<ProductionControllerSession> { requireProductionControllerLaunchContract();
  requireCondition( productionInterrupted === null && activeProductionChild === null, "controller_session_admission", );
  const lock = acquireDeployLockForController();
  let preparedDependencies: PreparedMaintenanceRefenceDependencies | null = null;
  let childlessBase: ChildlessMaintenanceRefenceBase | null = null;
  let state: ProductionBridgeMarkerState | null = null;
  let sessionFailureRetained = false;
  try { verifyDeployLockAuthority(lock);
    const ingress = readRefenceIngressTarget(arguments_.receiptSHA256);
    const startedAt = controllerStartedAt();
    const rolloutID = controllerRolloutID( ingress.targetRevision, startedAt, );
    validateProcessProof(await readProductionProcessProof());
    verifyDeployLockAuthority(lock);
    requireCondition( canonicalJson(readRefenceIngressTarget(arguments_.receiptSHA256)) === canonicalJson(ingress), "refence_ingress_drift", );
    await fetchLiteralGitHubMain();
    verifyDeployLockAuthority(lock);
    requireCondition( canonicalJson(readRefenceIngressTarget(arguments_.receiptSHA256)) === canonicalJson(ingress), "refence_ingress_drift", );
    const git = await readProductionGitProof();
    requireCondition( git.clean === true && git.revision === ingress.targetRevision && git.tree === ingress.targetTree && git.source_distance === ingress.targetDistance, "controller_target_git", );
    await loadVerifiedMaintenanceContract();
    verifyDeployLockAuthority(lock);
    const initialEvidence = classifyHandoff( arguments_.receiptSHA256, ingress.targetRevision, ingress.targetTree, rolloutID, );
    requireCondition( initialEvidence.edge === "H0" && initialEvidence.runID === ingress.runID, "controller_handoff_admission", );
    comparePresentedRoles(arguments_, initialEvidence.roles);
    const dependencyEstate = await prepareProductionDependencyEstate( initialEvidence, );
    verifyDeployLockAuthority(lock);
    const buildContext = await prepareProductionBuildContext(initialEvidence);
    verifyDeployLockAuthority(lock);
    preparedDependencies = await createProductionDependencies( initialEvidence, dependencyEstate, );
    const early = await runMaintenanceRefenceGuardForController({ checkpoint: "early", receiptSHA256: arguments_.receiptSHA256, targetRevision: ingress.targetRevision, targetTree: ingress.targetTree, rolloutID, }, preparedDependencies);
    requireOriginalTerminalIdentity(early.evidence, initialEvidence);
    requireCondition( early.evidence.edge === "H0" && early.proof.fence_verified === true && early.proof.public_surfaces_verified === false && early.proof.public_surfaces_expected_unavailable === true && early.proof.stable_fleet_sha256 ===
          early.evidence.receipt.terminal_fleet_sha256, "controller_early_guard", );
    verifyDeployLockAuthority(lock);
    createPrivateDirectoryExclusive(CONTROLLER_WAL_ROOT, DEPLOY_STATE_DIR);
    const controllerWalDirectory = join( CONTROLLER_WAL_ROOT, initialEvidence.runID, );
    createPrivateDirectoryExclusive( controllerWalDirectory, CONTROLLER_WAL_ROOT, );
    const preparation: ControllerPreparationBinding = { startedAt, deployLock: deployLockPreparationBinding(lock), buildContext, dependencyEstate, controllerWalDirectory,
      earlyGuardSHA256: sha256(serializeMaintenanceRefenceProof(early.proof)), earlyDatabaseProofSHA256: early.databaseProofSHA256, databaseTargetSHA256: early.proof.database_target_sha256, };
    const bindings: MarkerBindings = { rolloutID, receiptSHA256: arguments_.receiptSHA256, runID: initialEvidence.runID, targetRevision: ingress.targetRevision, targetTree: ingress.targetTree, anchorSHA256: initialEvidence.anchorSHA256,
      anchorDevice: initialEvidence.anchorStat.dev, anchorInode: initialEvidence.anchorStat.ino, witnessSHA256: initialEvidence.witnessSHA256, witnessDevice: initialEvidence.witnessStat.dev, witnessInode: initialEvidence.witnessStat.ino,
      bridgeRawSHA256: initialEvidence.bridgeRawSHA256, bridgeNormalizedSHA256: initialEvidence.bridgeNormalizedSHA256, };
    childlessBase = preparedDependencies.sealChildLaunchersForHandoff();
    preparedDependencies = null;
    verifyDeployLockAuthority(lock);
    const handoff = completeHandoff( initialEvidence, bindings, early.nonImageConfigSHA256, preparation, () => verifyDeployLockAuthority(lock), );
    requireCondition(handoff.edge === "H5", "controller_handoff_complete");
    const adoptedEvidence = classifyHandoff( arguments_.receiptSHA256, ingress.targetRevision, ingress.targetTree, rolloutID, );
    requireOriginalTerminalIdentity(adoptedEvidence, initialEvidence);
    requireCondition( adoptedEvidence.edge === "H5", "controller_handoff_complete", );
    const wal = new ControllerWalWriter({ directory: controllerWalDirectory, controllerRunID: initialEvidence.runID, rolloutID, receiptSHA256: arguments_.receiptSHA256, });
    state = new ProductionBridgeMarkerState({ bindings, roles: adoptedEvidence.roles, lock, preparation, wal, });
    wal.append({ recorded_at: controllerStartedAt(), phase: "ready", checkpoint: "controller_ready", effect_id: null, effect_kind: null, target: null, argv_sha256: null, pid: null, pgid: null, exit_code: null, termination: null,
      local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: sha256(canonicalJson({ handoff, preparation, early_guard_sha256: preparation.earlyGuardSHA256,
        stable_fleet_sha256: early.proof.stable_fleet_sha256, })), failure_code: null, });
    state.advance("controller_ready");
    let acknowledgedConvergence: DatabaseOriginConvergenceProof | null = null;
    const databaseConvergence = await runControllerDatabaseConvergenceCoreForTest({ wal, handoffEdge: adoptedEvidence.edge, interrupted: () => productionInterrupted !== null, inheritedProof: early.databaseProof,
        inheritedProofSHA256: early.databaseProofSHA256, dependencies: { now: controllerStartedAt, recordIntent: (entry) => { state!.recordDatabaseConvergenceIntent(entry); }, verifyIntent: (entry) => { state!.verifyLocalAuthority();
            const marker = state!.databaseConvergence();
            requireCondition( marker.status === "intent_unknown" && marker.intent_durable === true && marker.statement_attempted === true && marker.commit_state === "unknown" && marker.reconciliation_required === true &&
                marker.database_write_attempt_count === 1 && marker.intent_wal_ordinal === entry.ordinal && marker.intent_wal_sha256 === sha256(`${canonicalJson(entry)}\n`) && marker.database_target_sha256 ===
                  early.databaseProof.database_target_sha256 && marker.before_proof_sha256 === early.databaseProofSHA256, "database_convergence_intent_readback", ); }, readPreMutationProof: async () => validateDatabaseProof(
              await childlessBase!.readDatabaseProof(), adoptedEvidence, { instanceURLSHA256: PRE_REFENCE_INSTANCE_URL_SHA256, updatedAt: EXPECTED_FEDERATION_UPDATED_AT, }, ), converge: async () => {
            acknowledgedConvergence = await childlessBase! .convergeFederationInstanceURL();
            return acknowledgedConvergence; }, recordCommit: (proof, entry) => { state!.recordDatabaseConvergenceCommit(proof, entry); }, readPostMutationProof: async () => { requireCondition( acknowledgedConvergence !== null,
              "database_convergence_commit_readback", );
            return validateDatabaseProof(
              await childlessBase!.readDatabaseProof(), adoptedEvidence, { instanceURLSHA256: TARGET_INSTANCE_URL_SHA256, updatedAt: acknowledgedConvergence.after_updated_at, }, ); }, recordVerified: (afterProofSHA256, entry) => {
            state!.recordDatabaseConvergenceVerified( afterProofSHA256, entry, ); }, retainManual: (code) => { state!.recordFailure(code, true);
            sessionFailureRetained = true; }, }, });
    const databaseConvergenceMarkerSHA256 = validateVerifiedDatabaseConvergenceForTest( state.databaseConvergence(), databaseConvergence, wal, );
    requireCondition( validSha(databaseConvergenceMarkerSHA256), "database_convergence_verified_readback", );
    const guardDependencies = createJournalledControllerGuardDependencies({ state, evidence: adoptedEvidence, base: childlessBase, });
    const fly = createProductionFlyOperationAdapter({ state, evidence: adoptedEvidence, });
    const resourceTeardown = createSessionResourceTeardown({ settleActiveChild: async () => { const child = activeProductionChild;
        if (child === null) return true;
        return await settleOwnedProductionChild(child); }, closeDatabaseClients: () => childlessBase!.close(), });
    return { rolloutID, evidence: adoptedEvidence, lock, state, databaseConvergence: Object.freeze(databaseConvergence), databaseConvergenceMarkerSHA256, childlessBase, guardDependencies, fly, closeForFinalization: resourceTeardown.close,
      closeResources: resourceTeardown.close, closeAuthority: () => closeRetainedDeployLockDescriptor(lock), finalizationResourcesClosed: resourceTeardown.complete, }; } catch (error) { if (state !== null && !sessionFailureRetained) { try {
        state.recordFailure( error instanceof MaintenanceRefenceError || error instanceof ControllerManualInterventionError ? error.code : "controller_session_failure", true, ); } catch {} }
    let cleanupUncertain = !await settleResourceTwice(async () => { const child = activeProductionChild;
      return child === null || await settleOwnedProductionChild(child); });
    const closeable = childlessBase ?? preparedDependencies;
    if ( closeable !== null && !await settleResourceTwice(async () => { await closeable.close();
        return true; }) ) { cleanupUncertain = true; }
    if (cleanupUncertain && state !== null) { try { state.retainManualFailure("controller_resource_cleanup_uncertain"); } catch {} }
    if (!closeRetainedDeployLockDescriptor(lock) && state !== null) { try { state.retainManualFailure("controller_resource_cleanup_uncertain"); } catch {} }
    // The lock is deliberately retained on every production-session failure.
    // SIGKILL/stale-lock recovery is a permanent-manual lane.
    throw error; } }

export interface ControllerRecoveryDependencies { performFlyOperation( operation: ControllerFlyOperation, expectedFleet: TargetFleetExpectation, expectedPreFleetSHA256: string, ): Promise<{ image?: TargetImageContract;
    proofSHA256: string;
    fleetSHA256: string; }>;
  recordCheckpoint(checkpoint: string, detail: JsonRecord): Promise<void>;
  proveStoppedFence( expectation: TargetFleetExpectation, expectedPreFleetSHA256: string, ): Promise<{ proofSHA256: string; fleetSHA256: string }>; }

function withoutMachineID( values: readonly string[], machineID: string, ): string[] { return values.filter((entry) => entry !== machineID); }

/**
 * @internal Deterministic recovery order. This helper never rolls an image
 * backward and has no retry path: its dependency must throw manual on any
 * mutator uncertainty before another child can be armed.
 */
export async function runControllerRecoveryCoreForTest(request: { evidence: TerminalEvidence;
  reason: string;
  image: TargetImageContract | null;
  initialFleetSHA256: string;
  initialExpectation: TargetFleetExpectation;
  dependencies: ControllerRecoveryDependencies; }): Promise<{ proofSHA256: string;
  expectation: TargetFleetExpectation; }> { requireCondition( /^[a-z0-9_]{1,64}$/.test(request.reason) && validSha(request.initialFleetSHA256), "controller_recovery_admission", );
  requireTargetFleetExpectation(request.evidence, request.initialExpectation);
  if (request.image !== null) { requireCondition( /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/ .test(request.image.tag) && /^sha256:[0-9a-f]{64}$/.test(request.image.digest) &&
        request.image.revision === request.evidence.targetRevision, "controller_recovery_admission", ); }
  let expectation: TargetFleetExpectation = structuredClone( request.initialExpectation, );
  let currentFleetSHA256 = request.initialFleetSHA256;
  const effects: JsonRecord[] = [];
  const run = async ( operation: ControllerFlyOperation, next: TargetFleetExpectation, ): Promise<void> => { requireTargetFleetExpectation(request.evidence, next);
    const result = await request.dependencies.performFlyOperation( operation, next, currentFleetSHA256, );
    requireCondition( validSha(result.proofSHA256) && validSha(result.fleetSHA256) && (result.image === undefined || (request.image !== null && canonicalJson(result.image) === canonicalJson(request.image))), "controller_recovery_effect", );
    expectation = structuredClone(next);
    currentFleetSHA256 = result.fleetSHA256;
    const target = "machineID" in operation ? operation.machineID : APP;
    effects.push({ operation: operation.kind, target, proof_sha256: result.proofSHA256, });
    await request.dependencies.recordCheckpoint( "recovery_transition_verified", { operation: operation.kind, target, proof_sha256: result.proofSHA256, }, ); };

  const applications = appIDs(request.evidence.roles);
  for (const machineID of applications) { if (expectation.uncordonedAppMachineIDs.includes(machineID)) { await run({ kind: "cordon", machineID }, { ...expectation, uncordonedAppMachineIDs: withoutMachineID(
          expectation.uncordonedAppMachineIDs, machineID, ), }); } }

  const refenceAndStop = async ( machineID: string, refenceKind: "refence_app" | "refence_primary" | "refence_standby", ): Promise<void> => { await run({ kind: refenceKind, machineID }, { ...expectation,
      restartRestoredMachineIDs: withoutMachineID( expectation.restartRestoredMachineIDs, machineID, ), autostartEnabledAppMachineIDs: withoutMachineID( expectation.autostartEnabledAppMachineIDs, machineID, ), });
    await run({ kind: "stop", machineID }, { ...expectation, startedMachineIDs: withoutMachineID( expectation.startedMachineIDs, machineID, ), }); };

  await refenceAndStop( request.evidence.roles.thinker_standby, "refence_standby", );
  await refenceAndStop( request.evidence.roles.thinker_primary, "refence_primary", );
  for (const machineID of applications) { await refenceAndStop(machineID, "refence_app"); }
  requireCondition( expectation.restartRestoredMachineIDs.length === 0 && expectation.autostartEnabledAppMachineIDs.length === 0 && expectation.startedMachineIDs.length === 0 && expectation.uncordonedAppMachineIDs.length === 0 &&
      sameStringSet( expectation.targetImageMachineIDs, request.initialExpectation.targetImageMachineIDs, ), "controller_recovery_terminal", );
  const terminalFence = await request.dependencies.proveStoppedFence( expectation, currentFleetSHA256, );
  requireCondition( validSha(terminalFence.proofSHA256) && terminalFence.fleetSHA256 === currentFleetSHA256, "controller_recovery_fence", );
  await request.dependencies.recordCheckpoint("recovery_fence_verified", { proof_sha256: terminalFence.proofSHA256, });
  return { proofSHA256: sha256(canonicalJson({ reason: request.reason, image: request.image, effects, terminal_fence_sha256: terminalFence.proofSHA256, expectation, })), expectation, }; }

/**
 * @internal Separates a build-only provider effect from a verified fleet
 * mutation. The former must not manufacture recovery mutations: it can only
 * re-prove the unchanged stopped fence. The latter uses the closed recovery
 * order above and requires the resolved target image.
 */
export async function runControllerRecoveryDispatchCoreForTest(request: { evidence: TerminalEvidence;
  reason: string;
  providerEffectVerified: boolean;
  fleetMutationVerified: boolean;
  image: TargetImageContract | null;
  initialFleetSHA256: string;
  initialExpectation: TargetFleetExpectation;
  dependencies: ControllerRecoveryDependencies; }): Promise<{ proofSHA256: string;
  expectation: TargetFleetExpectation; }> { requireCondition( request.providerEffectVerified && validSha(request.initialFleetSHA256), "controller_recovery_dispatch", );
  requireTargetFleetExpectation(request.evidence, request.initialExpectation);
  if (request.fleetMutationVerified) { requireCondition(request.image !== null, "controller_recovery_dispatch");
    return runControllerRecoveryCoreForTest({
      evidence: request.evidence, reason: request.reason, image: request.image, initialFleetSHA256: request.initialFleetSHA256, initialExpectation: request.initialExpectation, dependencies: request.dependencies, }); }
  requireCondition( request.image === null && request.initialExpectation.targetImageMachineIDs.length === 0 && request.initialExpectation.restartRestoredMachineIDs.length === 0 &&
      request.initialExpectation.autostartEnabledAppMachineIDs.length === 0 && request.initialExpectation.startedMachineIDs.length === 0 && request.initialExpectation.uncordonedAppMachineIDs.length === 0, "controller_recovery_dispatch", );
  const expectation = structuredClone(request.initialExpectation);
  const terminalFence = await request.dependencies.proveStoppedFence( expectation, request.initialFleetSHA256, );
  requireCondition( validSha(terminalFence.proofSHA256) && terminalFence.fleetSHA256 === request.initialFleetSHA256, "controller_recovery_fence", );
  await request.dependencies.recordCheckpoint("recovery_fence_verified", { proof_sha256: terminalFence.proofSHA256, provider_effect_verified: true, fleet_mutation_verified: false, });
  return { proofSHA256: sha256(canonicalJson({ reason: request.reason, image: null, effects: [], terminal_fence_sha256: terminalFence.proofSHA256, expectation, })), expectation, }; }

async function recoverProductionControllerToStoppedFence( session: ProductionControllerSession, reason: string, context: { providerEffectVerified: boolean;
    fleetMutationVerified: boolean; }, ): Promise<string> { requireCondition( context.providerEffectVerified && /^[a-z0-9_]{1,64}$/.test(reason), "controller_recovery_dispatch", );
  const initial = session.fly.snapshot();
  requireCondition( initial.fleetSHA256 !== null && validSha(initial.fleetSHA256), "controller_recovery_dispatch", );
  session.state.beginRecovery(reason);
  let terminalCheckpointWritten = false;
  const result = await runControllerRecoveryDispatchCoreForTest({ evidence: session.evidence, reason, providerEffectVerified: context.providerEffectVerified, fleetMutationVerified: context.fleetMutationVerified, image: initial.image,
    initialFleetSHA256: initial.fleetSHA256, initialExpectation: initial.expectation, dependencies: { performFlyOperation: session.fly.performFlyOperation, recordCheckpoint: async (checkpoint, detail) => { requireCondition(
          checkpoint === "recovery_transition_verified" || checkpoint === "recovery_fence_verified", "controller_recovery_checkpoint", );
        const detailSHA256 = sha256(canonicalJson(detail));
        if (checkpoint === "recovery_fence_verified") { requireCondition( !terminalCheckpointWritten, "controller_recovery_checkpoint", );
          session.state.wal.append({ recorded_at: controllerStartedAt(), phase: "complete", checkpoint, effect_id: null, effect_kind: null, target: null, argv_sha256: null, pid: null, pgid: null, exit_code: null, termination: null,
            local_process_group_settled: true, provider_transition_sha256: null, fleet_readback_sha256: null, detail_sha256: detailSHA256, failure_code: null, });
          terminalCheckpointWritten = true; }
        await recordProductionControllerCheckpoint( session, checkpoint, detail, ); }, proveStoppedFence: async (expectation, expectedPreFleetSHA256) => { const proof = await runControllerStoppedFenceProofCoreForTest({
          checkpoint: "recovery_terminal", receiptSHA256: session.state.bindings.receiptSHA256, targetRevision: session.evidence.targetRevision, targetTree: session.evidence.targetTree, expectedDatabaseUpdatedAt:
            session.databaseConvergence.proof.after_updated_at, expectedFleetSHA256: expectedPreFleetSHA256, image: initial.image, expectation, dependencies: session.guardDependencies, readEvidence: () => classifyHandoff(
              session.state.bindings.receiptSHA256, session.evidence.targetRevision, session.evidence.targetTree, session.rolloutID, ), });
        const proofSHA256 = sha256(canonicalJson(proof));
        return { proofSHA256, fleetSHA256: proof.stable_fleet_sha256, }; }, }, });
  requireCondition(terminalCheckpointWritten, "controller_recovery_checkpoint");
  session.state.recordFailure(reason, false, true);
  return result.proofSHA256; }

function productionSuccessArchiveBindings( session: ProductionControllerSession, ): JsonRecord { verifyRetainedHandoffEvidence(session.state.bindings);
  const bind = ( path: string, digest: string, source: Stats, ): JsonRecord => { const identity: DurableFileIdentity = { device: source.dev, inode: source.ino, sha256: digest, size: source.size, };
    const current = requireExactFileIdentity(path, identity, { links: [1] });
    return { path, sha256: digest, device: current.dev, inode: current.ino, nlink: 1, }; };
  return {
    anchor: bind( session.evidence.anchorArchivePath, session.evidence.anchorSHA256, session.evidence.anchorStat, ), witness: bind( session.evidence.witnessArchivePath, session.evidence.witnessSHA256, session.evidence.witnessStat, ), }; }

async function finalizeProductionControllerSuccess( session: ProductionControllerSession, rolloutProofs: JsonRecord, lifecycle: ControllerFinalizationLifecycle, ): Promise<{ receiptPath: string;
  receiptSHA256: string;
  witnessPath: string;
  witnessSHA256: string; }> { session.state.verifyLocalAuthority();
  exactKeys( rolloutProofs, [ "special_guards", "fly_effects", "cordoned_runtime_sha256", "public_first_canary_sha256", "public_final_sha256", "final_authority_sha256", "ordinary_absent_postflight_sha256", ], "success_finalization_proofs",
  );
  const successProvenAt = controllerStartedAt();
  const rolloutProofSHA256 = sha256(canonicalJson(rolloutProofs));
  session.state.closeEffects();
  lifecycle.effectsClosed();
  const walProjection = session.state.wal.sealComplete( successProvenAt, rolloutProofSHA256, );
  session.state.bindSealedWal(successProvenAt, walProjection);
  await session.closeForFinalization();
  const marker = session.state.successAuthorityMarker();
  const retainedArchives = productionSuccessArchiveBindings(session);
  const finalTruth = { schema: "agenttool-phase-b-refence-maintenance-final-truth/v1", database_convergence_verified: true, target_image_machine_count: 5, started_service_machine_count: 4, autostart_enabled_app_count: 3,
    uncordoned_app_count: 3, standby_stopped: true, authority_state: "absent_fail_closed", ordinary_absent_postflight_verified: true, controller_wal_sealed: true, active_child_count: 0, effects_closed: true, migration_attempt_count: 0,
    database_write_attempt_count: 1, rollback_attempt_count: 0, };
  const authorityRequest: SuccessAuthorityContractRequest = { successProvenAt, controllerRunID: session.evidence.runID, rolloutID: session.rolloutID, refenceReceiptSHA256: session.evidence.receiptSHA256,
    sourceRevision: session.evidence.targetRevision, sourceTree: session.evidence.targetTree, roles: session.evidence.roles, marker, databaseConvergence: record( marker.database_convergence, "success_finalization_database", ),
    deployLock: session.state.preparation.deployLock, deployLockSHA256: session.lock.identity.sha256, earlyGuardSHA256: session.state.preparation.earlyGuardSHA256, buildContext: record(marker.build_context, "success_finalization_build"),
    dependencyEstate: record( marker.dependency_estate, "success_finalization_dependencies", ), refenceHandoff: record( marker.refence_handoff, "success_finalization_handoff", ), retainedArchives, controllerWal: walProjection,
    rolloutProofs, finalTruth, };
  const authority = maintenanceContract().createSuccessAuthorityProjection( authorityRequest, );
  const authorityProjectionSHA256 = sha256(canonicalJson(authority));
  const compactTime = successProvenAt.replace(/[-:]/g, "");
  const receiptPath = join( DEPLOY_RECEIPT_DIR, `${compactTime}-${ session.evidence.targetRevision.slice(0, 12) }-${process.pid}.json`, );
  const witnessPath = join( DEPLOY_STATE_DIR, `phase-b-refence-maintenance-finalization-${session.evidence.runID}.json`, );
  const markerRetirementClaimPath = join( DEPLOY_STATE_DIR, `.phase-b-refence-maintenance-marker-retirement-${session.evidence.runID}.claim`, );
  const previewRequest = { successProvenAt, walProjection, authorityProjectionSHA256, receiptPath, witnessPath, markerRetirementClaimPath, };
  const preview = session.state.previewSuccessFinalization(previewRequest);
  const artifacts = maintenanceContract().createSuccessArtifacts({ authorityRequest, authorityProjection: authority, markerPath: MAINTENANCE_MARKER, markerBytesUTF8: preview.bytesUTF8, receiptPath, witnessPath, markerRetirementClaimPath,
    lockPublicPath: DEPLOY_LOCK, lockOwnerPath: session.lock.ownerPath, lockDevice: String(session.lock.identity.device), lockInode: String(session.lock.identity.inode), lockSHA256: session.lock.identity.sha256, });
  const paths: SuccessFinalizationPaths = { stateDirectory: DEPLOY_STATE_DIR, lockDirectory: STATE_DIR, receiptDirectory: DEPLOY_RECEIPT_DIR, worktree: REPOSITORY_ROOT, markerPath: MAINTENANCE_MARKER, markerRetirementClaimPath, receiptPath,
    receiptStagePath: join( DEPLOY_RECEIPT_DIR, `.phase-b-refence-maintenance-receipt-${session.evidence.runID}.stage`, ), witnessPath, witnessStagePath: join( DEPLOY_STATE_DIR,
      `.phase-b-refence-maintenance-finalization-${session.evidence.runID}.stage`, ), publicLockPath: DEPLOY_LOCK, };
  const verifyClosedLocalAuthority = (): void => { requireCondition( session.finalizationResourcesClosed() && session.state.effectsClosed && activeProductionChild === null && productionInterrupted === null &&
        canonicalJson(session.state.wal.replayProjection()) === canonicalJson(walProjection), "success_finalization_closed_authority", );
    verifyDeployLockAuthority(session.lock);
    verifyRetainedHandoffEvidence(session.state.bindings);
    requireDependencyEstate(session.state.preparation.dependencyEstate);
    requireProductionBuildContext(session.state.preparation.buildContext);
    const hashes = bridgeSourceHashes();
    requireCondition( hashes.raw === session.state.bindings.bridgeRawSHA256 && hashes.normalized === session.state.bindings.bridgeNormalizedSHA256, "success_finalization_closed_authority", ); };
  return performSuccessFinalizationCeremony({ paths, lock: session.lock, artifacts, beginMarkerFinalization: () => { const result = session.state.beginSuccessFinalization( previewRequest, lifecycle.a0Installed, );
      requireCondition( result.bytesUTF8 === preview.bytesUTF8 && result.sha256 === preview.sha256, "success_finalization_preview", );
      return result.identity; }, verifyPreFinalization: () => { session.state.verifyLocalAuthority();
      maintenanceContract().validateSuccessArtifactBundle(artifacts);
      const repeated = session.state.previewSuccessFinalization(previewRequest);
      requireCondition( repeated.bytesUTF8 === preview.bytesUTF8 && repeated.sha256 === preview.sha256, "success_finalization_preview", ); }, verifyClosedLocalAuthority, }); }

function createProductionRolloutDependencies( session: ProductionControllerSession, ): ControllerRolloutDependencies { return { recordCheckpoint: (checkpoint, detail) => recordProductionControllerCheckpoint(session, checkpoint, detail),
    runSpecialGuard: (checkpoint) => runProductionSpecialGuard(session, checkpoint), performFlyOperation: session.fly.performFlyOperation, proveCordonedRuntime: (startedMachineIDs) =>
      runProductionCordonedRuntime(session, startedMachineIDs), proveFirstCanaryPublic: () => runProductionFirstCanaryPublic(session), proveFinalAuthorityAndPublic: () => runProductionFinalAuthorityAndPublic(session),
    runOrdinaryAbsentPostflight: () => runProductionOrdinaryAbsentPostflight(session), finalizeSuccess: (proofs, lifecycle) => finalizeProductionControllerSuccess(session, proofs, lifecycle), recoverToStoppedFence: (reason, context) =>
      recoverProductionControllerToStoppedFence(session, reason, context), retainManualBlocker: (reason) => { session.state.retainManualFailure(reason);
      return Promise.resolve(); }, retainFinalizationManualBlocker: (reason) => { session.state.retainManualFailure(reason);
      return Promise.resolve(); }, }; }

export async function runOwnedControllerSessionForTest<
  Session, Dependencies, Result, >( request: { createSession(): Promise<Session>;
    createDependencies(session: Session): Dependencies;
    run(session: Session, dependencies: Dependencies): Promise<Result>;
    closeResources(session: Session): Promise<void>;
    closeAuthority(session: Session): boolean;
    retainCleanupUncertainty(session: Session): void; }, ): Promise<Result> { const session = await request.createSession();
  const noFailure = Symbol("no_failure");
  let failure: unknown = noFailure;
  let result!: Result;
  let completed = false;
  try { const dependencies = request.createDependencies(session);
    result = await request.run(session, dependencies);
    completed = true; } catch (error) { failure = error; }
  let cleanupFailed = !await settleResourceTwice(async () => { await request.closeResources(session);
    return true; });
  let cleanupRetentionAttempted = false;
  if (cleanupFailed) { cleanupRetentionAttempted = true;
    try { request.retainCleanupUncertainty(session); } catch {} }
  try { if (!request.closeAuthority(session)) cleanupFailed = true; } catch { cleanupFailed = true; }
  if (cleanupFailed && !cleanupRetentionAttempted) { try { request.retainCleanupUncertainty(session); } catch {} }
  if (failure !== noFailure) throw failure;
  if (cleanupFailed || !completed) { throw new ControllerManualInterventionError( "controller_resource_cleanup_uncertain", ); }
  return result; }

async function runProductionController(arguments_: ControllerArguments) { return runOwnedControllerSessionForTest({ createSession: () => createProductionControllerSession(arguments_), createDependencies: (session) =>
      createProductionRolloutDependencies(session), run: (session, dependencies) => runControllerRolloutCore({ evidence: session.evidence, rolloutID: session.rolloutID, dependencies, }),
    closeResources: (session) => session.closeResources(), closeAuthority: (session) => session.closeAuthority(), retainCleanupUncertainty: (session) => session.state.retainManualFailure( "controller_resource_cleanup_uncertain", ), }); }

export interface ControllerFinalizationLifecycle { effectsClosed(): void;
  a0Installed(): void; }

export interface ControllerRolloutDependencies { recordCheckpoint( checkpoint: string, detail: JsonRecord, ): Promise<void>;
  runSpecialGuard( checkpoint: "prepublication_before_build" | "prepublication_before_image", ): Promise<{ proofSHA256: string; fleetSHA256: string }>;
  performFlyOperation( operation: ControllerFlyOperation, expectedFleet: TargetFleetExpectation, expectedPreFleetSHA256: string, ): Promise<{ image?: TargetImageContract;
    proofSHA256: string;
    fleetSHA256: string; }>;
  proveCordonedRuntime( startedMachineIDs: readonly string[], ): Promise<string>;
  proveFirstCanaryPublic(): Promise<string>;
  proveFinalAuthorityAndPublic(): Promise<{ publicProofSHA256: string;
    authorityProofSHA256: string; }>;
  runOrdinaryAbsentPostflight(): Promise<string>;
  finalizeSuccess( proofs: JsonRecord, lifecycle: ControllerFinalizationLifecycle, ): Promise<{ receiptPath: string;
    receiptSHA256: string;
    witnessPath: string;
    witnessSHA256: string; }>;
  recoverToStoppedFence( reason: string, context: { providerEffectVerified: boolean;
      fleetMutationVerified: boolean; }, ): Promise<string>;
  retainManualBlocker(reason: string): Promise<void>;
  retainFinalizationManualBlocker(reason: string): Promise<void>; }

/** @internal Deterministic effect order; all production I/O is dependency-owned. */
export async function runControllerRolloutCore(request: { evidence: TerminalEvidence;
  rolloutID: string;
  dependencies: ControllerRolloutDependencies; }): Promise<{ receiptPath: string; receiptSHA256: string }> { const { evidence, dependencies } = request;
  requireCondition( /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/ .test(request.rolloutID) && evidence.edge === "H5", "controller_rollout_admission", );
  const apps = appIDs(evidence.roles);
  const all = machineIDs(evidence.roles);
  const updated: string[] = [];
  const restored: string[] = [];
  const autostartEnabled: string[] = [];
  const started: string[] = [];
  const uncordoned: string[] = [];
  const proofs: JsonRecord = { special_guards: [], fly_effects: [], cordoned_runtime_sha256: null, public_first_canary_sha256: null, public_final_sha256: null, final_authority_sha256: null, ordinary_absent_postflight_sha256: null, };
  let currentFleetSHA256: string | null = null;
  const run = async ( operation: ControllerFlyOperation, expectation: TargetFleetExpectation, ): Promise<{ image?: TargetImageContract;
    proofSHA256: string;
    fleetSHA256: string; }> => { requireCondition( currentFleetSHA256 !== null && validSha(currentFleetSHA256), "controller_effect_pre_fleet", );
    const result = await dependencies.performFlyOperation( operation, expectation, currentFleetSHA256, );
    requireCondition( validSha(result.proofSHA256) && validSha(result.fleetSHA256), "controller_effect_proof", );
    proofs.fly_effects.push({ operation: operation.kind, target: "machineID" in operation ? operation.machineID : APP, proof_sha256: result.proofSHA256, });
    currentFleetSHA256 = result.fleetSHA256;
    return result; };
  let providerEffectVerified = false;
  let fleetMutationVerified = false;
  let finalizationEffectsClosed = false;
  let finalizationA0Installed = false;
  try { const beforeBuild = await dependencies.runSpecialGuard( "prepublication_before_build", );
    requireCondition( validSha(beforeBuild.proofSHA256) && validSha(beforeBuild.fleetSHA256), "controller_guard_proof", );
    currentFleetSHA256 = beforeBuild.fleetSHA256;
    proofs.special_guards.push(beforeBuild.proofSHA256);
    await dependencies.recordCheckpoint("prepublication_before_build", { proof_sha256: beforeBuild.proofSHA256, stable_fleet_sha256: beforeBuild.fleetSHA256, });

    await run({ kind: "build_push", imageTag: request.rolloutID, revision: evidence.targetRevision, }, { targetImageMachineIDs: [], restartRestoredMachineIDs: [], autostartEnabledAppMachineIDs: [], startedMachineIDs: [],
      uncordonedAppMachineIDs: [], });
    providerEffectVerified = true;
    await dependencies.recordCheckpoint("image_pushed_fence_pending", {});

    const beforeImage = await dependencies.runSpecialGuard( "prepublication_before_image", );
    requireCondition( validSha(beforeImage.proofSHA256) && beforeImage.fleetSHA256 === currentFleetSHA256, "controller_guard_proof", );
    proofs.special_guards.push(beforeImage.proofSHA256);
    await dependencies.recordCheckpoint("prepublication_before_image", { proof_sha256: beforeImage.proofSHA256, stable_fleet_sha256: beforeImage.fleetSHA256, });

    const primary = evidence.roles.thinker_primary;
    const first = await run({ kind: "update_image", machineID: primary, imageReference: `registry.fly.io/${APP}:${request.rolloutID}`, }, { targetImageMachineIDs: [primary], restartRestoredMachineIDs: [], autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [], uncordonedAppMachineIDs: [], });
    requireCondition(first.image !== undefined, "controller_image_resolution");
    fleetMutationVerified = true;
    const targetImage = first.image;
    requireCondition( targetImage.tag === request.rolloutID && targetImage.revision === evidence.targetRevision && /^sha256:[0-9a-f]{64}$/.test(targetImage.digest), "controller_image_resolution", );
    updated.push(primary);
    const immutableImageReference = `registry.fly.io/${APP}:${targetImage.tag}@${targetImage.digest}`;
    for (const machineID of [...apps, evidence.roles.thinker_standby]) { await run({ kind: "update_image", machineID, imageReference: immutableImageReference, }, { targetImageMachineIDs: [...updated, machineID],
        restartRestoredMachineIDs: [], autostartEnabledAppMachineIDs: [], startedMachineIDs: [], uncordonedAppMachineIDs: [], });
      updated.push(machineID); }
    requireCondition( canonicalJson([...updated].sort()) === canonicalJson([...all].sort()), "controller_image_order", );
    await dependencies.recordCheckpoint("fleet_image_verified", { image_digest: targetImage.digest, image_tag: targetImage.tag, });

    for (const machineID of apps) { await run({ kind: "restore_app", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: [...restored, machineID], autostartEnabledAppMachineIDs: [], startedMachineIDs: [],
        uncordonedAppMachineIDs: [], });
      restored.push(machineID); }
    await run({ kind: "restore_primary", machineID: primary }, { targetImageMachineIDs: all, restartRestoredMachineIDs: [...restored, primary], autostartEnabledAppMachineIDs: [], startedMachineIDs: [], uncordonedAppMachineIDs: [], });
    restored.push(primary);
    const standby = evidence.roles.thinker_standby;
    await run({ kind: "restore_standby", machineID: standby, primaryID: primary, }, { targetImageMachineIDs: all, restartRestoredMachineIDs: [...restored, standby], autostartEnabledAppMachineIDs: [], startedMachineIDs: [],
      uncordonedAppMachineIDs: [], });
    restored.push(standby);

    for (const machineID of apps) { await run({ kind: "start", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: [...started, machineID],
        uncordonedAppMachineIDs: [], });
      await run({ kind: "wait_started", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: [...started, machineID],
        uncordonedAppMachineIDs: [], });
      started.push(machineID); }
    for (const machineID of apps) { await run({ kind: "enable_autostart", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: [...autostartEnabled, machineID],
        startedMachineIDs: started, uncordonedAppMachineIDs: [], });
      autostartEnabled.push(machineID);
      await run({ kind: "wait_started", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: started, uncordonedAppMachineIDs: [], }); }
    await run({ kind: "start", machineID: primary }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: [...started, primary], uncordonedAppMachineIDs: [],
    });
    await run({ kind: "wait_started", machineID: primary }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: [...started, primary],
      uncordonedAppMachineIDs: [], });
    started.push(primary);
    requireCondition( !started.includes(standby) && started.length === 4, "controller_primary_start", );

    const cordonedRuntime = await dependencies.proveCordonedRuntime(started);
    requireCondition(validSha(cordonedRuntime), "controller_runtime_proof");
    proofs.cordoned_runtime_sha256 = cordonedRuntime;
    await dependencies.recordCheckpoint("cordoned_runtime_verified", { proof_sha256: cordonedRuntime, });

    for (let index = 0; index < apps.length; index += 1) { const machineID = apps[index]!;
      await run({ kind: "uncordon", machineID }, { targetImageMachineIDs: all, restartRestoredMachineIDs: restored, autostartEnabledAppMachineIDs: autostartEnabled, startedMachineIDs: started,
        uncordonedAppMachineIDs: [...uncordoned, machineID], });
      uncordoned.push(machineID);
      if (index === 0) { const publicProof = await dependencies.proveFirstCanaryPublic();
        requireCondition(validSha(publicProof), "controller_public_proof");
        proofs.public_first_canary_sha256 = publicProof;
        await dependencies.recordCheckpoint("first_canary_public_verified", { machine_id: machineID, proof_sha256: publicProof, }); } }
    const final = await dependencies.proveFinalAuthorityAndPublic();
    requireCondition( validSha(final.publicProofSHA256) && validSha(final.authorityProofSHA256), "controller_final_proof", );
    proofs.public_final_sha256 = final.publicProofSHA256;
    proofs.final_authority_sha256 = final.authorityProofSHA256;
    const ordinaryPostflight = await dependencies.runOrdinaryAbsentPostflight();
    requireCondition( validSha(ordinaryPostflight), "controller_postflight_proof", );
    proofs.ordinary_absent_postflight_sha256 = ordinaryPostflight;
    await dependencies.recordCheckpoint("all_final_gates_verified", { final_authority_sha256: final.authorityProofSHA256, ordinary_absent_postflight_sha256: ordinaryPostflight, public_sha256: final.publicProofSHA256, });
    const receipt = await dependencies.finalizeSuccess(proofs, { effectsClosed: () => { const first = !finalizationEffectsClosed;
        finalizationEffectsClosed = true;
        requireCondition( first && !finalizationA0Installed, "controller_finalization_lifecycle", ); }, a0Installed: () => { const first = !finalizationA0Installed;
        finalizationA0Installed = true;
        requireCondition( finalizationEffectsClosed && first, "controller_finalization_lifecycle", ); }, });
    requireCondition( finalizationA0Installed, "controller_finalization_lifecycle", );
    const receiptName = basename(receipt.receiptPath);
    requireCondition( dirname(receipt.receiptPath) === DEPLOY_RECEIPT_DIR && dirname(receipt.witnessPath) === DEPLOY_STATE_DIR && /^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{12}-[1-9][0-9]*\.json$/ .test(receiptName) &&
        receiptName.slice(17, 29) === evidence.targetRevision.slice(0, 12) && receipt.witnessPath === join( DEPLOY_STATE_DIR, `phase-b-refence-maintenance-finalization-${evidence.runID}.json`, ) &&
        validSha(receipt.receiptSHA256) && validSha(receipt.witnessSHA256), "controller_success_receipt", );
    return { receiptPath: receipt.receiptPath, receiptSHA256: receipt.receiptSHA256, }; } catch (error) { const reason = error instanceof ControllerManualInterventionError ? error.code : error instanceof ControllerSettledObservationError
      ? error.code : error instanceof MaintenanceRefenceError ? error.code : "controller_rollout_failure";
    if (finalizationA0Installed) throw error;
    if (finalizationEffectsClosed) { try { await dependencies.retainFinalizationManualBlocker(reason); } catch {}
      throw error; }
    if ( error instanceof ControllerManualInterventionError || !providerEffectVerified ) { try { await dependencies.retainManualBlocker(reason); } catch {} } else { try { const recovery = await dependencies.recoverToStoppedFence(reason, {
          providerEffectVerified, fleetMutationVerified, });
        requireCondition(validSha(recovery), "controller_recovery_proof");
        await dependencies.recordCheckpoint("failed_stopped_fence_verified", { mutation_effect_began: providerEffectVerified, recovery_sha256: recovery, }); } catch { try { await dependencies.retainManualBlocker(
            "recovery_failed_or_uncertain", ); } catch {} } }
    throw error; } }

export interface ControllerArguments { receiptSHA256: string;
  appMachines: string;
  thinkerPrimary: string;
  thinkerStandby: string; }

export function parseArguments( arguments_: readonly string[], ): ControllerArguments { requireCondition(arguments_.length === 7, "invalid_invocation");
  const [ noMigrate, noFrontend, maintenanceFencedAPI, receiptArgument, appArgument, primaryArgument, standbyArgument, ] = arguments_;
  requireCondition( noMigrate === "--no-migrate" && noFrontend === "--no-frontend" && maintenanceFencedAPI === "--maintenance-fenced-api" && /^--maintenance-refence-receipt-sha256=[0-9a-f]{64}$/.test( receiptArgument ?? "", ) &&
      /^--maintenance-app-machines=[0-9a-f]{14},[0-9a-f]{14},[0-9a-f]{14}$/ .test( appArgument ?? "", ) && /^--maintenance-thinker-primary=[0-9a-f]{14}$/.test( primaryArgument ?? "", ) && /^--maintenance-thinker-standby=[0-9a-f]{14}$/.test(
        standbyArgument ?? "", ), "invalid_invocation", );
  const appMachines = appArgument!.slice( "--maintenance-app-machines=".length, );
  const thinkerPrimary = primaryArgument!.slice( "--maintenance-thinker-primary=".length, );
  const thinkerStandby = standbyArgument!.slice( "--maintenance-thinker-standby=".length, );
  requireCondition( new Set([...appMachines.split(","), thinkerPrimary, thinkerStandby]) .size === 5, "invalid_invocation", );
  return { receiptSHA256: receiptArgument!.slice( "--maintenance-refence-receipt-sha256=".length, ), appMachines, thinkerPrimary, thinkerStandby, }; }

function comparePresentedRoles( arguments_: ControllerArguments, roles: RoleMap, ): void { requireCondition( arguments_.appMachines === appIDs(roles).join(",") && arguments_.thinkerPrimary === roles.thinker_primary &&
      arguments_.thinkerStandby === roles.thinker_standby, "presented_role_mismatch", ); }

async function main(): Promise<void> { productionInterrupted = null;
  const onInterrupt = () => requestProductionInterrupt("SIGINT");
  const onTerminate = () => requestProductionInterrupt("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try { requireCondition(process.argv[2] === "controller", "invalid_invocation");
    const arguments_ = parseArguments(process.argv.slice(3));
    await runProductionController(arguments_); } catch (error) { const invalid = error instanceof MaintenanceRefenceError && error.code === "invalid_invocation";
    process.stderr.write( invalid ? "maintenance_refence_bridge_invalid_invocation\n" : "maintenance_refence_bridge_refused\n", );
    process.exitCode = invalid ? 64 : 74; } finally { if (activeProductionChild) { try { await settleOwnedProductionChild(activeProductionChild); } catch {} }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate); } }

if (import.meta.main) await main();
