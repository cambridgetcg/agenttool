/**
 * The person desk's own WebAuthn pages: signing an act on a proposal, and
 * enrolling a passkey. Contract:
 * docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md section 5.1
 * in the AgentTool source repository.
 *
 * Why the desk serves them itself: the page that shows the bytes and calls
 * Touch ID decides what the person actually signs, and the operating
 * system's prompt names only "localhost". A page from an application that
 * agents routinely edit could show one proposal and sign another, or enrol a
 * key an agent holds. These pages come from the installed desk bundle, behind
 * a one-time path on a fixed loopback origin, with a per-ceremony nonce CSP.
 * That moves the trust to the desk's installed bytes; it does not make them
 * unwritable by a process running as the same user.
 *
 * `--via <ssh-destination>` signs for another device's table: the challenge
 * comes from, and the assertion goes to, that device's desk through its
 * `person-remote` forced command, which verifies it against its own enrolled
 * passkeys. The page and Touch ID stay on this device.
 */
import { randomBytes } from "node:crypto";
import { CollabError } from "./errors.js";
import { normalizePasskeyEnrollment } from "./passkey.js";
import {
  confirmEnrollment,
  errorPayload,
  openDeskStore,
  parseAct,
  parseInteger,
  parsePersonArgs,
  PERSON_DESK_PROTOCOL,
  EXIT_NOT_CONFIRMED,
  type PersonDeskDeps,
} from "./person-desk.js";
import type { ProposalStatus } from "./protocol.js";
import { openDevTty } from "./tty.js";

export const DEFAULT_CEREMONY_PORT = 17778;
export const CEREMONY_TIMEOUT_MS = 180_000;
const MAX_POST_BYTES = 32 * 1024;
const SSH_DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,200}$/;

export interface CeremonyIo {
  /** Writes one line to stdout as soon as the page is ready. */
  out(line: string): void;
  /** Runs one person-desk verb on another device; tests replace it. */
  remote?: (destination: string, argv: string[], stdin?: string) => Promise<Record<string, unknown>>;
}

type Table = {
  challenge(proposal: string, act: "agree" | "reject", reason: string | undefined): Promise<Challenge>;
  status(challenge: Challenge): Promise<ProposalStatus>;
  record(proposal: string, act: "agree" | "reject", reason: string | null, assertion: unknown): Promise<ProposalStatus>;
  close(): void;
};

type Challenge = {
  workspace_id: string;
  proposal_report_id: string;
  proposal_sha256: string;
  act: "agree" | "reject";
  reason: string | null;
  challenge_bytes: string;
  challenge: string;
  passkeys: Array<{ credential_id: string; origin: string; label: string | null; fingerprint: string }>;
};

export async function runCeremonyCli(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: PersonDeskDeps,
  io: CeremonyIo,
): Promise<{ exit_code: 0 | 1 | 3; line: string }> {
  const first = argv.find((arg) => !arg.startsWith("-")) ?? "";
  const command = `person ${first}`;
  const emit = (payload: Record<string, unknown>, exitCode: 0 | 1 | 3) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, ...payload }),
  });
  try {
    const { verb, values } = parsePersonArgs(argv);
    if (verb === "passkey-enroll" && values.ceremony) {
      return emit(await enrollCeremony(values, env, deps, io, command), 0);
    }
    if (verb !== "ceremony") throw new CollabError("usage_error", "Not a ceremony verb");
    return emit(await signCeremony(values, env, deps, io, command), 0);
  } catch (error) {
    if (error instanceof CollabError && error.code === "not_confirmed") {
      return emit({ status: "cancelled", message: "Not confirmed at the terminal; nothing was written" }, EXIT_NOT_CONFIRMED);
    }
    return emit(errorPayload(error), 1);
  }
}

async function signCeremony(
  values: ReturnType<typeof parsePersonArgs>["values"],
  env: Record<string, string | undefined>,
  deps: PersonDeskDeps,
  io: CeremonyIo,
  command: string,
): Promise<Record<string, unknown>> {
  const act = parseAct(values.act);
  const table = values.via ? remoteTable(values.via, io) : localTable(values, env, deps);
  try {
    const challenge = await table.challenge(values.proposal!, act, values.reason);
    if (challenge.passkeys.length === 0) {
      throw new CollabError("passkey_not_enrolled", "No passkey is enrolled at this table; enrol one first");
    }
    const status = await table.status(challenge);
    // A passkey signs for the origin it was enrolled with, so serve there.
    const origin = values.port ? `http://localhost:${parsePort(values.port)}` : challenge.passkeys[0]!.origin;
    const port = portOf(origin);
    const passkeys = challenge.passkeys.filter((key) => key.origin === origin);
    if (passkeys.length === 0) {
      throw new CollabError("passkey_origin_mismatch", "No enrolled passkey signs for this ceremony origin", { origin });
    }
    const data = {
      kind: "sign",
      table: values.via ?? "this device",
      act,
      reason: challenge.reason,
      question: status.proposal.body,
      extent: status.terms.extent,
      criteria: status.terms.criteria,
      known_conflicts: status.terms.known_conflicts,
      position: status.ai.position,
      proposal_sha256: challenge.proposal_sha256,
      proposal_bytes: status.proposal_bytes,
      challenge_bytes: challenge.challenge_bytes,
      challenge: challenge.challenge,
      rp_id: "localhost",
      credentials: passkeys.map((key) => key.credential_id),
    };
    const result = await serveOnce(port, data, io, command, async (body) => {
      const recorded = await table.record(challenge.proposal_report_id, act, challenge.reason, (body as { assertion?: unknown }).assertion);
      return {
        recorded: true,
        person_state: recorded.person.state,
        may_proceed: recorded.may_proceed,
        proposal_sha256: recorded.proposal_sha256,
      };
    });
    return { status: "ok", ...result };
  } finally {
    table.close();
  }
}

async function enrollCeremony(
  values: ReturnType<typeof parsePersonArgs>["values"],
  env: Record<string, string | undefined>,
  deps: PersonDeskDeps,
  io: CeremonyIo,
  command: string,
): Promise<Record<string, unknown>> {
  // Enrolment is confirmed at the terminal, so refuse before serving anything without one.
  const probe = (deps.openTty ?? (() => openDevTty()))();
  if (probe === null) {
    throw new CollabError("tty_unavailable", "Enrolling a passkey needs a person at the controlling terminal (/dev/tty)");
  }
  probe.close();
  const port = values.port ? parsePort(values.port) : DEFAULT_CEREMONY_PORT;
  const origin = `http://localhost:${port}`;
  const store = openDeskStore(values, env, deps);
  try {
    const challenge = randomBytes(32).toString("base64url");
    const data = {
      kind: "enroll",
      table: "this device",
      challenge,
      user_id: randomBytes(16).toString("base64url"),
      rp_id: "localhost",
      label: values.label ?? "Touch ID",
    };
    const result = await serveOnce(port, data, io, command, async (body) => {
      const input = body as Record<string, unknown>;
      checkCreateClientData(input.client_data_json, challenge, origin);
      const enrollment = normalizePasskeyEnrollment({
        credential_id: input.credential_id,
        public_key_spki: input.public_key_spki,
        algorithm: input.algorithm,
        rp_id: "localhost",
        origin,
        label: values.label ?? "Touch ID",
      });
      if (!confirmEnrollment(store, enrollment, deps)) {
        throw new CollabError("not_confirmed", "Not confirmed at the terminal; nothing was enrolled");
      }
      const passkey = store.enrollPersonPasskey(enrollment);
      return { enrolled: true, fingerprint: passkey.fingerprint, origin: passkey.origin };
    });
    return { status: "ok", ...result };
  } finally {
    store.close();
  }
}

function checkCreateClientData(value: unknown, challenge: string, origin: string): void {
  let clientData: Record<string, unknown> | null = null;
  try {
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,8192}$/.test(value)) {
      clientData = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    }
  } catch {
    clientData = null;
  }
  if (
    !clientData
    || clientData.type !== "webauthn.create"
    || clientData.challenge !== challenge
    || clientData.origin !== origin
    || clientData.crossOrigin === true
  ) {
    throw new CollabError("passkey_assertion_invalid", "The new passkey was not created by this enrolment page");
  }
}

function localTable(
  values: ReturnType<typeof parsePersonArgs>["values"],
  env: Record<string, string | undefined>,
  deps: PersonDeskDeps,
): Table {
  const store = openDeskStore(values, env, deps);
  return {
    async challenge(proposal, act, reason) {
      return store.personActChallenge({ proposal_report_id: proposal, act, reason });
    },
    async status(challenge) {
      return store.proposalStatusById(challenge.proposal_report_id);
    },
    async record(proposal, act, reason, assertion) {
      return store.recordPersonActWithPasskey({
        proposal_report_id: proposal,
        act,
        reason: reason ?? undefined,
        assertion: assertion as never,
      });
    },
    close: () => store.close(),
  };
}

function remoteTable(destination: string, io: CeremonyIo): Table {
  if (!SSH_DESTINATION.test(destination)) {
    throw new CollabError("usage_error", "--via must be an SSH host alias or user@host");
  }
  const call = io.remote ?? sshDesk;
  const receipt = async (argv: string[], stdin?: string) => {
    const result = await call(destination, argv, stdin);
    if (result.status !== "ok") {
      throw new CollabError(
        typeof result.error === "string" ? result.error : "remote_desk_failed",
        typeof result.message === "string" ? result.message : "The other device's desk refused the request",
        { via: destination },
      );
    }
    return result;
  };
  return {
    async challenge(proposal, act, reason) {
      const argv = ["challenge", `--proposal=${proposal}`, `--act=${act}`, ...(reason ? [`--reason=${reason}`] : [])];
      return (await receipt(argv)).challenge as Challenge;
    },
    async status(challenge) {
      const argv = ["proposals", `--workspace=${challenge.workspace_id}`, `--proposal=${challenge.proposal_report_id}`];
      return (await receipt(argv)).proposal as ProposalStatus;
    },
    async record(proposal, act, reason, assertion) {
      const argv = [
        act === "agree" ? "consent" : "reject",
        `--proposal=${proposal}`,
        ...(reason ? [`--reason=${reason}`] : []),
        "--passkey-assertion=-",
      ];
      return (await receipt(argv, JSON.stringify(assertion ?? null))).proposal as ProposalStatus;
    },
    close: () => {},
  };
}

/** One person-desk verb on another device, through its `person-remote` forced command. */
async function sshDesk(destination: string, argv: string[], stdin?: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn(
    ["/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", destination, JSON.stringify(argv)],
    { stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "ignore" },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const text = await new Response(child.stdout).text();
    await child.exited;
    const line = text.trim().split("\n").at(-1) ?? "";
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new CollabError("remote_desk_unreadable", "The other device's desk returned no receipt", { via: destination });
    }
  } finally {
    clearTimeout(timer);
  }
}

function parsePort(value: string): number {
  const port = parseInteger(value, "port")!;
  if (port < 1024 || port > 65535) throw new CollabError("usage_error", "--port must be from 1024 to 65535");
  return port;
}

function portOf(origin: string): number {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || !url.port) {
    throw new CollabError("passkey_origin_mismatch", "Ceremonies serve only from http://localhost:<port>", { origin });
  }
  return Number(url.port);
}

/**
 * Serve one page at a one-time path until it posts once or the ceremony times
 * out. The first stdout line names the page; the caller prints the last.
 */
async function serveOnce(
  port: number,
  data: Record<string, unknown>,
  io: CeremonyIo,
  command: string,
  onPost: (body: unknown) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const token = randomBytes(24).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const origin = `http://localhost:${port}`;
  const path = `/c/${token}`;
  let settle!: (value: { ok: true; result: Record<string, unknown> } | { ok: false; error: unknown }) => void;
  const finished = new Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: unknown }>((resolve) => {
    settle = resolve;
  });
  let used = false;
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; `
      + "img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.headers.get("host") !== `localhost:${port}`) {
          return new Response("Open this page at localhost", { status: 421, headers });
        }
        if (request.method === "GET" && url.pathname === path) {
          return new Response(ceremonyPage(data, nonce), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (request.method === "POST" && url.pathname === `${path}/done`) {
          if (request.headers.get("origin") !== origin || used) {
            return Response.json({ ok: false, error: "ceremony_closed" }, { status: 409, headers });
          }
          used = true;
          try {
            const text = await request.text();
            if (Buffer.byteLength(text) > MAX_POST_BYTES) throw new CollabError("input_too_large", "The page sent too much");
            const result = await onPost(JSON.parse(text));
            settle({ ok: true, result });
            return Response.json({ ok: true, ...result }, { headers });
          } catch (error) {
            settle({ ok: false, error });
            const payload = errorPayload(error);
            return Response.json({ ok: false, error: payload.error, message: payload.message }, { status: 409, headers });
          }
        }
        return new Response("Not found", { status: 404, headers });
      },
    });
  } catch {
    throw new CollabError("ceremony_port_busy", `Another program holds ${origin}; close it or finish its ceremony first`);
  }
  const expiresAt = new Date(Date.now() + CEREMONY_TIMEOUT_MS).toISOString();
  io.out(JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, status: "open", url: `${origin}${path}`, expires_at: expiresAt }));
  const timer = setTimeout(() => settle({ ok: false, error: new CollabError("ceremony_timeout", "The ceremony page was not used in time") }), CEREMONY_TIMEOUT_MS);
  try {
    const outcome = await finished;
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  } finally {
    clearTimeout(timer);
    // Let the page receive its answer before the listener goes away.
    setTimeout(() => server.stop(true), 250);
  }
}

/** The page HTML. Data is embedded as JSON text and rendered with textContent only. */
export function ceremonyPage(data: Record<string, unknown>, nonce: string): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Person desk</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #f6f5f2; --dim: #6b6b70; --card: #ffffff; --line: #dedcd6; --go: #1f7a4a; --stop: #a33a2c; }
@media (prefers-color-scheme: dark) { :root { --fg: #ecebe8; --bg: #141416; --dim: #9a9aa0; --card: #1d1d21; --line: #33333a; --go: #5cc08a; --stop: #ef7b6b; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 1.15rem; margin: 0 0 4px; } .dim { color: var(--dim); font-size: .85rem; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
.label { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); margin-top: 10px; }
.value { white-space: pre-wrap; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, Menlo, monospace; margin: 6px 0 0; }
button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 1px solid currentColor; background: transparent; cursor: pointer; }
button.go { color: var(--go); } button.stop { color: var(--stop); } button[disabled] { opacity: .5; cursor: default; }
#result:empty { display: none; }
</style></head><body><main>
<h1 id="title"></h1><div class="dim" id="sub"></div>
<section id="what"></section>
<section><div class="label">Exact bytes you are signing</div><pre id="act"></pre>
<div class="label">The proposal they name</div><pre id="proposal"></pre></section>
<button id="go"></button>
<section id="result"></section>
<p class="dim">Served by the Collab person desk on this device, for this ceremony only. Touch ID names only "localhost", so act only if you opened this page yourself.</p>
</main>
<script type="application/json" id="data">${json}</script>
<script nonce="${nonce}">
(() => {
  const data = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  const dec = (v) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((v.length + 3) % 4)), (c) => c.charCodeAt(0));
  const enc = (b) => { let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  const field = (label, value) => { if (!value) return; const l = document.createElement("div"); l.className = "label"; l.textContent = label; const v = document.createElement("div"); v.className = "value"; v.textContent = value; $("what").append(l, v); };
  const say = (text) => { $("result").textContent = text; };
  const post = async (body) => {
    const response = await fetch(location.pathname + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return response.json();
  };
  if (data.kind === "sign") {
    $("title").textContent = data.act === "agree" ? "Agree to this proposal" : "Reject this proposal";
    $("sub").textContent = "Table: " + data.table + " · agents' position: " + data.position;
    field("Question", data.question); field("Criteria", data.criteria);
    field("Extent — agreement authorises only this", data.extent); field("Known conflicts", data.known_conflicts);
    if (data.act === "reject") field("Your reason", data.reason);
    $("act").textContent = data.challenge_bytes; $("proposal").textContent = data.proposal_bytes;
    $("go").textContent = data.act === "agree" ? "Touch ID: agree" : "Touch ID: reject";
    $("go").className = data.act === "agree" ? "go" : "stop";
    $("go").onclick = async () => {
      $("go").disabled = true;
      try {
        const c = await navigator.credentials.get({ publicKey: { challenge: dec(data.challenge), rpId: data.rp_id,
          allowCredentials: data.credentials.map((id) => ({ type: "public-key", id: dec(id) })), userVerification: "required", timeout: 120000 } });
        const r = await post({ assertion: { credential_id: enc(c.rawId), authenticator_data: enc(c.response.authenticatorData),
          client_data_json: enc(c.response.clientDataJSON), signature: enc(c.response.signature),
          user_handle: c.response.userHandle ? enc(c.response.userHandle) : null } });
        say(r.ok ? (data.act === "agree" ? "Recorded. Your agreement authorises only the extent above. You can close this page." : "Recorded. You can close this page.")
          : "The desk refused: " + (r.message || r.error));
      } catch (e) { say("Nothing was signed: " + e.message); $("go").disabled = false; }
    };
  } else {
    $("title").textContent = "Enrol a passkey for the person desk";
    $("sub").textContent = "Your terminal will show the new key's fingerprint and ask you to type yes.";
    field("Label", data.label);
    $("act").textContent = "A new ES256 passkey for relying party localhost, created by Touch ID on this device.";
    $("proposal").textContent = "(none)";
    $("go").textContent = "Create with Touch ID"; $("go").className = "go";
    $("go").onclick = async () => {
      $("go").disabled = true;
      try {
        const c = await navigator.credentials.create({ publicKey: { rp: { id: data.rp_id, name: "Collab person desk" },
          user: { id: dec(data.user_id), name: "person", displayName: "Person" }, challenge: dec(data.challenge),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
          attestation: "none", timeout: 120000 } });
        say("Now look at your terminal: compare the fingerprint and type yes.");
        const r = await post({ credential_id: enc(c.rawId), public_key_spki: enc(c.response.getPublicKey()),
          algorithm: c.response.getPublicKeyAlgorithm(), client_data_json: enc(c.response.clientDataJSON) });
        say(r.ok ? "Enrolled. Fingerprint " + r.fingerprint : "Not enrolled: " + (r.message || r.error));
      } catch (e) { say("No passkey was created: " + e.message); $("go").disabled = false; }
    };
  }
})();
</script></body></html>`;
}

