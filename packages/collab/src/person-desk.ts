/**
 * The person desk: a person's reads and acts on proposals through
 * `agenttool-collab-host person <verb>`. Contract:
 * docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md section 5
 * in the AgentTool source repository.
 *
 * Agreement and rejection have two routes. At the controlling terminal the
 * exact proposal bytes are shown on /dev/tty and "yes" is read there. With a
 * passkey, a WebAuthn assertion over the act bytes is verified and journaled
 * with its public key, so it can be checked again later. Enrolling or revoking
 * a passkey always needs the terminal. Notes and person proposals are desk
 * writes: the desk does not authenticate the person, so they inform and
 * authorise nothing. No MCP tool reaches any of this.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson } from "./canonical.js";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import { parsePasskeyPublicKey, passkeyFingerprint } from "./passkey.js";
import type { PasskeyAssertion, ProposalStatus } from "./protocol.js";
import { CollabStore } from "./store.js";
import { confirmOnTty, type OpenTty } from "./tty.js";

export const PERSON_DESK_PROTOCOL = "agenttool.collab-host/1" as const;
export const EXIT_NOT_CONFIRMED = 3;
const MAX_JSON_INPUT_BYTES = 64 * 1024;

export const PERSON_DESK_USAGE =
  "usage: agenttool-collab-host person <verb> [--db <path>], where <verb> is one of: "
  + "workspaces | proposals --workspace <id> [--proposal <id>] [--limit <n>] | inbox --workspace <id>"
  + " | challenge --proposal <id> --act agree|reject [--reason <text>]"
  + " | consent --proposal <id> [--passkey-assertion <path>|-]"
  + " | reject --proposal <id> --reason <text> [--passkey-assertion <path>|-]"
  + " | say --workspace <id> --body <text> [--proposal <id>] --idempotency-key <key>"
  + " | propose --workspace <id> --question <text> --criteria <text> --extent <text>"
  + " [--known-conflicts <text>] [--topic <text>] [--consult-seconds <n>] --idempotency-key <key>"
  + " | passkey-enroll --file <path>|- | passkeys | passkey-revoke --credential <id>";

export interface PersonDeskDeps {
  openTty?: OpenTty;
  readStdin?: () => string;
  /** Confirmation-window clock, in milliseconds. */
  now?: () => number;
  /** The journal's clock; tests share one with their own store. */
  storeNow?: () => Date;
}

type Verb =
  | "workspaces" | "proposals" | "inbox" | "challenge" | "consent" | "reject"
  | "say" | "propose" | "passkey-enroll" | "passkeys" | "passkey-revoke";

const VERB_OPTIONS: Record<Verb, { required: string[]; optional: string[] }> = {
  workspaces: { required: [], optional: [] },
  proposals: { required: ["workspace"], optional: ["proposal", "limit"] },
  inbox: { required: ["workspace"], optional: [] },
  challenge: { required: ["proposal", "act"], optional: ["reason"] },
  consent: { required: ["proposal"], optional: ["passkey-assertion"] },
  reject: { required: ["proposal", "reason"], optional: ["passkey-assertion"] },
  say: { required: ["workspace", "body", "idempotency-key"], optional: ["proposal"] },
  propose: {
    required: ["workspace", "question", "criteria", "extent", "idempotency-key"],
    optional: ["known-conflicts", "topic", "consult-seconds"],
  },
  "passkey-enroll": { required: ["file"], optional: [] },
  passkeys: { required: [], optional: [] },
  "passkey-revoke": { required: ["credential"], optional: [] },
};

const STRING_OPTIONS = [
  "workspace", "proposal", "limit", "act", "reason", "passkey-assertion", "body",
  "idempotency-key", "question", "criteria", "extent", "known-conflicts", "topic",
  "consult-seconds", "file", "credential", "db",
] as const;

type Values = Partial<Record<(typeof STRING_OPTIONS)[number], string>>;

export function runPersonDeskCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  deps: PersonDeskDeps = {},
): { exit_code: 0 | 1 | 3; line: string } {
  let verb = "person";
  const emit = (payload: Record<string, unknown>, exitCode: 0 | 1 | 3) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command: verb, ...payload }),
  });
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    return emit({ status: "help", usage: PERSON_DESK_USAGE }, 0);
  }
  try {
    const { command, values } = parsePersonArgs(argv);
    verb = `person ${command}`;
    const databasePath = values.db ?? resolveDatabasePath(env);
    if (!existsSync(databasePath)) {
      throw new CollabError(
        "journal_not_found",
        "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
      );
    }
    const store = new CollabStore(databasePath, deps.storeNow ? { now: deps.storeNow } : {});
    try {
      const outcome = runVerb(store, command, values, deps);
      return outcome.cancelled
        ? emit({ status: "cancelled", message: "Not confirmed at the terminal; nothing was written" }, EXIT_NOT_CONFIRMED)
        : emit({ status: "ok", ...outcome.result }, 0);
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorPayload(error), 1);
  }
}

function runVerb(
  store: CollabStore,
  command: Verb,
  values: Values,
  deps: PersonDeskDeps,
): { cancelled: true } | { cancelled: false; result: Record<string, unknown> } {
  const done = (result: Record<string, unknown>) => ({ cancelled: false as const, result });
  switch (command) {
    case "workspaces":
      return done({ workspaces: store.listWorkspaces() });
    case "proposals":
      return values.proposal
        ? done({ proposal: store.proposalStatus(values.workspace!, values.proposal) })
        : done({ proposals: store.listProposalStatuses(values.workspace!, { limit: parseInteger(values.limit, "limit") }) });
    case "inbox":
      return done({ inbox: store.personInbox(values.workspace!) });
    case "challenge":
      return done({
        challenge: store.personActChallenge({
          proposal_report_id: values.proposal!,
          act: values.act as "agree" | "reject",
          reason: values.reason,
        }),
      });
    case "consent":
    case "reject": {
      const act = command === "consent" ? "agree" as const : "reject" as const;
      if (values["passkey-assertion"] !== undefined) {
        const assertion = readJsonInput(values["passkey-assertion"], deps) as unknown as PasskeyAssertion;
        return done({
          proposal: store.recordPersonActWithPasskey({
            proposal_report_id: values.proposal!,
            act,
            reason: values.reason,
            assertion,
          }),
        });
      }
      const status = store.proposalStatusById(values.proposal!);
      if (act === "agree" && status.ai.position !== "consented") {
        throw new CollabError(
          "ai_not_consented",
          "The agents have not consented; a person agrees only after they settle",
          { position: status.ai.position },
        );
      }
      const confirmed = confirmOnTty({
        act: act === "agree" ? "agree to a proposal" : "reject a proposal",
        summary: actSummary(status, act, values.reason),
        bytes: status.proposal_bytes,
        sha256: status.proposal_sha256,
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed) return { cancelled: true };
      return done({
        proposal: store.recordPersonActAtTerminal({
          proposal_report_id: status.proposal.id,
          proposal_sha256: status.proposal_sha256,
          act,
          reason: values.reason,
        }),
      });
    }
    case "say":
      return done({
        report: store.appendPersonNote({
          workspace_id: values.workspace!,
          idempotency_key: values["idempotency-key"]!,
          body: values.body!,
          proposal_report_id: values.proposal,
        }),
      });
    case "propose":
      return done({
        proposal: store.openPersonProposal({
          workspace_id: values.workspace!,
          idempotency_key: values["idempotency-key"]!,
          question: values.question!,
          criteria: values.criteria!,
          extent: values.extent!,
          known_conflicts: values["known-conflicts"],
          topic: values.topic,
          consult_seconds: parseInteger(values["consult-seconds"], "consult-seconds"),
        }),
      });
    case "passkey-enroll": {
      const input = readJsonInput(values.file!, deps);
      const enrollment = {
        credential_id: requireString(input.credential_id, "credential_id"),
        public_key_spki: requireString(input.public_key_spki, "public_key_spki"),
        algorithm: input.algorithm as number,
        rp_id: requireString(input.rp_id, "rp_id"),
        origin: requireString(input.origin, "origin"),
        ...(typeof input.label === "string" ? { label: input.label } : {}),
      };
      parsePasskeyPublicKey(enrollment.public_key_spki);
      const bytes = canonicalJson(enrollment);
      const confirmed = confirmOnTty({
        act: "enrol a passkey",
        summary: [
          `key fingerprint (sha256): ${passkeyFingerprint(enrollment.public_key_spki)}`,
          `relying party ${enrollment.rp_id}, origin ${enrollment.origin}`,
          "Enrol only a passkey you just created yourself; it will sign agreements in your name.",
        ],
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed) return { cancelled: true };
      return done({ passkey: store.enrollPersonPasskey(enrollment) });
    }
    case "passkeys":
      return done({ passkeys: store.listPersonPasskeys() });
    case "passkey-revoke": {
      const passkey = store.listPersonPasskeys().find((key) => key.credential_id === values.credential);
      if (!passkey || passkey.revoked_at !== null) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
      const bytes = canonicalJson({ revoke: passkey.credential_id, fingerprint: passkey.fingerprint });
      const confirmed = confirmOnTty({
        act: "revoke a passkey",
        summary: [`key fingerprint (sha256): ${passkey.fingerprint}`, `origin ${passkey.origin}`],
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed) return { cancelled: true };
      return done({ passkey: store.revokePersonPasskey(passkey.credential_id) });
    }
  }
}

function actSummary(status: ProposalStatus, act: "agree" | "reject", reason: string | undefined): string[] {
  return [
    `workspace ${status.proposal.workspace_id}, proposal ${status.proposal.id}`,
    `agents' position: ${status.ai.position} (${status.ai.qualifying_support_report_ids.length} qualifying supports, `
      + `${status.ai.unresolved_challenge_report_ids.length} unresolved challenges)`,
    `extent: ${status.terms.extent}`,
    act === "agree"
      ? "Agreeing authorises only this extent."
      : `reason: ${reason ?? ""}`,
  ];
}

function parsePersonArgs(argv: string[]): { command: Verb; values: Values } {
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: "string" as const }])),
    });
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${PERSON_DESK_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command || !(command in VERB_OPTIONS) || extra.length > 0) {
    throw new CollabError("usage_error", PERSON_DESK_USAGE);
  }
  const verb = command as Verb;
  const values = parsed.values as Values;
  const { required, optional } = VERB_OPTIONS[verb];
  for (const name of Object.keys(values)) {
    if (name !== "db" && !required.includes(name) && !optional.includes(name)) {
      throw new CollabError("usage_error", `--${name} does not apply to person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  for (const name of required) {
    const value = values[name as keyof Values];
    if (value === undefined || value.trim() === "") {
      throw new CollabError("usage_error", `--${name} is required for person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  if (values.db !== undefined && values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${PERSON_DESK_USAGE}`);
  }
  return { command: verb, values };
}

function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value.trim())) {
    throw new CollabError("usage_error", `--${name} must be a non-negative integer; ${PERSON_DESK_USAGE}`);
  }
  return Number(value.trim());
}

function readJsonInput(path: string, deps: PersonDeskDeps): Record<string, unknown> {
  let text: string;
  try {
    text = path === "-" ? (deps.readStdin ?? (() => readFileSync(0, "utf8")))() : readFileSync(path, "utf8");
  } catch {
    throw new CollabError("input_unreadable", "The JSON input could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_INPUT_BYTES) {
    throw new CollabError("input_too_large", `The JSON input exceeds ${MAX_JSON_INPUT_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CollabError("input_invalid", "The input is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollabError("input_invalid", "The input must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CollabError("input_invalid", `${field} must be a non-empty string`);
  }
  return value;
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof CollabError) {
    return { ...error.details, status: "error", error: error.code, message: error.message };
  }
  return { status: "error", error: "internal_error", message: error instanceof Error ? error.message : String(error) };
}
