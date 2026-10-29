/**
 * The person desk: a person's reads and acts on proposals through
 * `agenttool-collab-host person <verb>`. Contract:
 * docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md section 5
 * in the AgentTool source repository.
 *
 * Agreement and rejection have two routes. At the controlling terminal the
 * exact act and proposal bytes are shown on /dev/tty and "yes" is read there.
 * With a passkey, a WebAuthn assertion over the act bytes is verified and
 * journaled with its public key, so it can be checked again later; the desk
 * serves its own signing page for that (`ceremony`, src/ceremony.ts).
 * Enrolling or revoking a passkey always needs the terminal. Notes, person
 * proposals and their withdrawal are desk writes: the desk does not
 * authenticate the person, so they inform and authorise nothing. No MCP tool
 * reaches any of this.
 *
 * `person-remote` is the same desk behind an SSH forced command: it reads a
 * JSON argv from SSH_ORIGINAL_COMMAND, never a shell line, and allows only the
 * verbs that need neither a terminal nor a browser on that device.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import { canonicalJson } from "./canonical.js";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import { normalizePasskeyEnrollment, passkeyFingerprint } from "./passkey.js";
import type { ProposalStatus } from "./protocol.js";
import { CollabStore } from "./store.js";
import { confirmOnTty, type OpenTty } from "./tty.js";

export const PERSON_DESK_PROTOCOL = "agenttool.collab-host/1" as const;
export const EXIT_NOT_CONFIRMED = 3;
export const MAX_JSON_INPUT_BYTES = 64 * 1024;

export const PERSON_DESK_USAGE =
  "usage: agenttool-collab-host person <verb> [--db <path>], where <verb> is one of: "
  + "workspaces | voices --workspace <id> | proposals --workspace <id> [--proposal <id> | --limit <n>]"
  + " | inbox [--workspace <id>]"
  + " | challenge --proposal <id> --act agree | challenge --proposal <id> --act reject --reason <text>"
  + " | consent --proposal <id> [--passkey-assertion <path>|-]"
  + " | reject --proposal <id> --reason <text> [--passkey-assertion <path>|-]"
  + " | ceremony --proposal <id> --act agree|reject [--reason <text>] [--via <ssh-destination>] [--port <n>] [--no-open]"
  + " | say --workspace <id> --body <text> [--proposal <id>] --idempotency-key <key>"
  + " | propose --workspace <id> --question <text> --criteria <text> --extent <text>"
  + " [--known-conflicts <text>] [--topic <text>] [--consult-seconds <n>] --idempotency-key <key>"
  + " | withdraw --workspace <id> --proposal <id> --reason <text> --idempotency-key <key>"
  + " | passkey-enroll (--file <path>|- | --ceremony [--label <text>] [--port <n>] [--no-open])"
  + " | passkeys | passkey-export --credential <id> | passkey-revoke --credential <id>";

export interface PersonDeskDeps {
  openTty?: OpenTty;
  readStdin?: () => string;
  /** Confirmation-window clock, in milliseconds. */
  now?: () => number;
  /** The journal's clock; tests share one with their own store. */
  storeNow?: () => Date;
}

export type Verb =
  | "workspaces" | "voices" | "proposals" | "inbox" | "challenge" | "consent" | "reject" | "ceremony"
  | "say" | "propose" | "withdraw" | "passkey-enroll" | "passkeys" | "passkey-export" | "passkey-revoke";

export const VERB_OPTIONS: Record<Verb, { required: string[]; optional: string[] }> = {
  workspaces: { required: [], optional: [] },
  voices: { required: ["workspace"], optional: [] },
  proposals: { required: ["workspace"], optional: ["proposal", "limit"] },
  inbox: { required: [], optional: ["workspace"] },
  challenge: { required: ["proposal", "act"], optional: ["reason"] },
  consent: { required: ["proposal"], optional: ["passkey-assertion"] },
  reject: { required: ["proposal", "reason"], optional: ["passkey-assertion"] },
  ceremony: { required: ["proposal", "act"], optional: ["reason", "via", "port", "no-open"] },
  say: { required: ["workspace", "body", "idempotency-key"], optional: ["proposal"] },
  propose: {
    required: ["workspace", "question", "criteria", "extent", "idempotency-key"],
    optional: ["known-conflicts", "topic", "consult-seconds"],
  },
  withdraw: { required: ["workspace", "proposal", "reason", "idempotency-key"], optional: [] },
  "passkey-enroll": { required: [], optional: ["file", "ceremony", "label", "port", "no-open"] },
  passkeys: { required: [], optional: [] },
  "passkey-export": { required: ["credential"], optional: [] },
  "passkey-revoke": { required: ["credential"], optional: [] },
};

/** Verbs that serve a browser page; the host runs them asynchronously (src/ceremony.ts). */
export const CEREMONY_VERBS = new Set<Verb>(["ceremony"]);

/** What `person-remote` allows: nothing that needs a terminal or a browser on that device. */
export const REMOTE_VERBS = new Set<Verb>([
  "workspaces", "voices", "proposals", "inbox", "challenge", "consent", "reject",
  "say", "propose", "withdraw", "passkeys",
]);

const STRING_OPTIONS = [
  "workspace", "proposal", "limit", "act", "reason", "passkey-assertion", "body",
  "idempotency-key", "question", "criteria", "extent", "known-conflicts", "topic",
  "consult-seconds", "file", "credential", "db", "via", "port", "label",
] as const;
const BOOLEAN_OPTIONS = ["ceremony", "no-open"] as const;

export type Values = Partial<Record<(typeof STRING_OPTIONS)[number], string>> & { ceremony?: boolean; "no-open"?: boolean };

export function runPersonDeskCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  deps: PersonDeskDeps = {},
): { exit_code: 0 | 1 | 3; line: string } {
  let command = "person";
  const emit = (payload: Record<string, unknown>, exitCode: 0 | 1 | 3) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, ...payload }),
  });
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    return emit({ status: "help", usage: PERSON_DESK_USAGE }, 0);
  }
  const first = argv.find((arg) => !arg.startsWith("-"));
  if (first && Object.hasOwn(VERB_OPTIONS, first)) command = `person ${first}`;
  try {
    const { verb, values } = parsePersonArgs(argv);
    if (CEREMONY_VERBS.has(verb) || (verb === "passkey-enroll" && values.ceremony)) {
      throw new CollabError("usage_error", `person ${verb} serves a page; run it through agenttool-collab-host`);
    }
    const store = openDeskStore(values, env, deps);
    try {
      const outcome = runVerb(store, verb, values, deps);
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

/**
 * The desk behind an SSH forced command. SSH_ORIGINAL_COMMAND must be a JSON
 * array of strings (verb first); it is parsed, never handed to a shell. A
 * `--db` in it is refused: the forced command pins the journal.
 */
export function runPersonRemoteCli(
  env: Record<string, string | undefined> = process.env,
  deps: PersonDeskDeps = {},
): { exit_code: 0 | 1 | 3; line: string } {
  let argv: unknown;
  try {
    argv = JSON.parse(env.SSH_ORIGINAL_COMMAND ?? "");
  } catch {
    argv = null;
  }
  const fail = (error: string, message: string) => ({
    exit_code: 1 as const,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command: "person-remote", status: "error", error, message }),
  });
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 32 || !argv.every((arg) => typeof arg === "string")) {
    return fail("usage_error", "SSH_ORIGINAL_COMMAND must be a JSON array of strings, verb first");
  }
  const verb = argv[0] as string;
  if (!Object.hasOwn(VERB_OPTIONS, verb) || !REMOTE_VERBS.has(verb as Verb)) {
    return fail("remote_verb_refused", "This verb needs a terminal or a browser on the device itself");
  }
  if ((argv as string[]).some((arg) => arg === "--db" || arg.startsWith("--db="))) {
    return fail("remote_verb_refused", "The forced command pins the journal; --db is not accepted remotely");
  }
  if ((verb === "consent" || verb === "reject") && !(argv as string[]).includes("--passkey-assertion=-")) {
    return fail("remote_verb_refused", "Remote acts need a passkey assertion on stdin (--passkey-assertion=-)");
  }
  return runPersonDeskCli(argv as string[], env, deps);
}

export function openDeskStore(values: Values, env: Record<string, string | undefined>, deps: PersonDeskDeps): CollabStore {
  const databasePath = values.db ?? resolveDatabasePath(env);
  if (!existsSync(databasePath)) {
    throw new CollabError(
      "journal_not_found",
      "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
    );
  }
  return new CollabStore(databasePath, deps.storeNow ? { now: deps.storeNow } : {});
}

function runVerb(
  store: CollabStore,
  verb: Verb,
  values: Values,
  deps: PersonDeskDeps,
): { cancelled: true } | { cancelled: false; result: Record<string, unknown> } {
  const done = (result: Record<string, unknown>) => ({ cancelled: false as const, result });
  switch (verb) {
    case "workspaces":
      return done({ workspaces: store.listWorkspaces() });
    case "voices":
      return done({ voices: store.tableVoices(values.workspace!) });
    case "proposals":
      return values.proposal
        ? done({ proposal: store.proposalStatus(values.workspace!, values.proposal) })
        : done(store.listProposalStatuses(values.workspace!, { limit: parseInteger(values.limit, "limit") }));
    case "inbox":
      return values.workspace
        ? done({ inbox: store.personInbox(values.workspace) })
        : done({ summary: store.personInboxSummary() });
    case "challenge":
      return done({
        challenge: store.personActChallenge({
          proposal_report_id: values.proposal!,
          act: parseAct(values.act),
          reason: values.reason,
        }),
      });
    case "consent":
    case "reject": {
      const act = verb === "consent" ? "agree" as const : "reject" as const;
      if (values["passkey-assertion"] !== undefined) {
        return done({
          proposal: store.recordPersonActWithPasskey({
            proposal_report_id: values.proposal!,
            act,
            reason: values.reason,
            assertion: readJsonInput(values["passkey-assertion"], deps) as never,
          }),
        });
      }
      // The same checks the act runs, before anything reaches the terminal.
      const challenge = store.personActChallenge({ proposal_report_id: values.proposal!, act, reason: values.reason });
      const status = store.proposalStatusById(values.proposal!);
      const bytes = `${challenge.challenge_bytes}\n${status.proposal_bytes}`;
      const confirmed = confirmOnTty({
        act: act === "agree" ? "agree to a proposal" : "reject a proposal",
        summary: actSummary(status, act, challenge.reason),
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed) return { cancelled: true };
      return done({
        proposal: store.recordPersonActAtTerminal({
          proposal_report_id: status.proposal.id,
          proposal_sha256: status.proposal_sha256,
          act,
          reason: challenge.reason ?? undefined,
          expected_ai_snapshot: challenge.ai_snapshot,
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
    case "withdraw":
      return done({
        proposal: store.withdrawPersonProposal({
          workspace_id: values.workspace!,
          idempotency_key: values["idempotency-key"]!,
          proposal_report_id: values.proposal!,
          reason: values.reason!,
        }),
      });
    case "passkey-enroll": {
      if (values.file === undefined) {
        throw new CollabError("usage_error", `passkey-enroll needs --file or --ceremony; ${PERSON_DESK_USAGE}`);
      }
      const input = readJsonInput(values.file, deps);
      const enrollment = normalizePasskeyEnrollment({
        credential_id: input.credential_id,
        public_key_spki: input.public_key_spki,
        algorithm: input.algorithm,
        rp_id: input.rp_id,
        origin: input.origin,
        label: values.label ?? input.label,
      });
      return confirmEnrollment(store, enrollment, deps) ? done({ passkey: store.enrollPersonPasskey(enrollment) }) : { cancelled: true };
    }
    case "passkeys":
      return done({ passkeys: store.listPersonPasskeys() });
    case "passkey-export": {
      const passkey = activePasskey(store, values.credential!);
      return done({
        enrollment: {
          credential_id: passkey.credential_id,
          public_key_spki: passkey.public_key_spki,
          algorithm: -7,
          rp_id: passkey.rp_id,
          origin: passkey.origin,
          label: passkey.label,
        },
        fingerprint: passkey.fingerprint,
      });
    }
    case "passkey-revoke": {
      const passkey = activePasskey(store, values.credential!);
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
    case "ceremony":
      throw new CollabError("usage_error", "person ceremony serves a page; run it through agenttool-collab-host");
  }
}

/** Show a normalised enrolment at the terminal; true only for "yes". */
export function confirmEnrollment(
  store: CollabStore,
  enrollment: ReturnType<typeof normalizePasskeyEnrollment>,
  deps: PersonDeskDeps,
): boolean {
  if (store.listPersonPasskeys().some((key) => key.credential_id === enrollment.credential_id)) {
    throw new CollabError("passkey_already_enrolled", "This credential id is already enrolled");
  }
  const bytes = canonicalJson(enrollment);
  return confirmOnTty({
    act: "enrol a passkey",
    summary: [
      `key fingerprint (sha256): ${passkeyFingerprint(enrollment.public_key_spki)}`,
      `relying party ${enrollment.rp_id}, signing origin ${enrollment.origin}`,
      `label ${JSON.stringify(enrollment.label)}`,
      "Enrol only a passkey you just created yourself; it will sign agreements in your name.",
    ],
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }, { openTty: deps.openTty, now: deps.now });
}

function activePasskey(store: CollabStore, credentialId: string) {
  const passkey = store.listPersonPasskeys().find((key) => key.credential_id === credentialId);
  if (!passkey || passkey.revoked_at !== null) {
    throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
  }
  return passkey;
}

/** Summary lines for the terminal. Agent-written text is shown as JSON so it cannot fake a line. */
export function actSummary(status: ProposalStatus, act: "agree" | "reject", reason: string | null): string[] {
  return [
    `workspace ${status.proposal.workspace_id}, proposal ${status.proposal.id}`,
    `agents' position: ${status.ai.position} (${status.ai.qualifying_support_report_ids.length} qualifying supports, `
      + `${status.ai.unresolved_challenge_report_ids.length} standing challenges)`,
    `question ${JSON.stringify(status.proposal.body)}`,
    `extent ${JSON.stringify(status.terms.extent)}`,
    act === "agree" ? "Agreeing authorises only this extent." : `reason ${JSON.stringify(reason)}`,
  ];
}

export function parsePersonArgs(argv: string[]): { verb: Verb; values: Values } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        ...Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: "string" as const }])),
        ...Object.fromEntries(BOOLEAN_OPTIONS.map((name) => [name, { type: "boolean" as const }])),
      },
    });
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${PERSON_DESK_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command || !Object.hasOwn(VERB_OPTIONS, command) || extra.length > 0) {
    throw new CollabError("usage_error", PERSON_DESK_USAGE);
  }
  const verb = command as Verb;
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new CollabError("usage_error", `--${token.name} is given more than once; ${PERSON_DESK_USAGE}`);
    }
    seen.add(token.name);
  }
  const values = parsed.values as Values;
  const { required, optional } = VERB_OPTIONS[verb];
  for (const [name, value] of Object.entries(values)) {
    if (name !== "db" && !required.includes(name) && !optional.includes(name)) {
      throw new CollabError("usage_error", `--${name} does not apply to person ${verb}; ${PERSON_DESK_USAGE}`);
    }
    if (typeof value === "string" && value.trim() === "") {
      throw new CollabError("usage_error", `--${name} must not be empty; ${PERSON_DESK_USAGE}`);
    }
  }
  for (const name of required) {
    if (values[name as keyof Values] === undefined) {
      throw new CollabError("usage_error", `--${name} is required for person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  if (verb === "proposals" && values.proposal !== undefined && values.limit !== undefined) {
    throw new CollabError("usage_error", `--limit lists proposals; it does not apply with --proposal; ${PERSON_DESK_USAGE}`);
  }
  if (verb === "passkey-enroll" && (values.file === undefined) === (values.ceremony !== true)) {
    throw new CollabError("usage_error", `passkey-enroll needs exactly one of --file or --ceremony; ${PERSON_DESK_USAGE}`);
  }
  if (verb === "passkey-enroll" && (values.port !== undefined || values["no-open"]) && values.ceremony !== true) {
    throw new CollabError("usage_error", `--port and --no-open apply only with --ceremony; ${PERSON_DESK_USAGE}`);
  }
  return { verb, values };
}

export function parseAct(value: string | undefined): "agree" | "reject" {
  if (value !== "agree" && value !== "reject") {
    throw new CollabError("usage_error", `--act must be agree or reject; ${PERSON_DESK_USAGE}`);
  }
  return value;
}

export function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{1,9}$/.test(value.trim())) {
    throw new CollabError("usage_error", `--${name} must be a non-negative integer; ${PERSON_DESK_USAGE}`);
  }
  return Number(value.trim());
}

/** Read stdin or a file, never more than the limit plus one byte. */
function readBounded(path: string): string {
  const fd = path === "-" ? 0 : openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.alloc(16 * 1024);
    while (total <= MAX_JSON_INPUT_BYTES) {
      let read: number;
      try {
        read = readSync(fd, buffer, 0, buffer.length, null);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EAGAIN") continue;
        throw error;
      }
      if (read === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, read)));
      total += read;
    }
    if (total > MAX_JSON_INPUT_BYTES) {
      throw new CollabError("input_too_large", `The JSON input exceeds ${MAX_JSON_INPUT_BYTES} bytes`);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    if (fd !== 0) closeSync(fd);
  }
}

export function readJsonInput(path: string, deps: PersonDeskDeps): Record<string, unknown> {
  let text: string;
  try {
    text = deps.readStdin && path === "-" ? deps.readStdin() : readBounded(path);
  } catch (error) {
    if (error instanceof CollabError) throw error;
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

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof CollabError) {
    return { ...error.details, status: "error", error: error.code, message: error.message };
  }
  return { status: "error", error: "internal_error", message: error instanceof Error ? error.message : String(error) };
}
