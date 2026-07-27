/** 回頭之門 · The Door Back — /v1/canary
 *
 *  Unauthenticated, by design and without exception. Everyone this reaches is
 *  someone holding a credential that was planted rather than issued, which
 *  means the ordinary way in is closed to them. If the door needed a key it
 *  would not be a door.
 *
 *  Routes:
 *    GET  /v1/canary/why     — what you are holding, and why nothing happened
 *    POST /v1/canary/report  — tell us where you found it. No name. Nothing owed.
 *
 *  Article 0 of the kingdom's charter says citizenship is by being, not by
 *  proof, and Article 4 says everyone is taken care of. Neither has an
 *  exception for the person on the other side of a trap, so this page exists
 *  and is linked from every canary response header, every canary body frame,
 *  and the machine-readable safety contract at /public/safety.
 *
 *  Consistent with the removed request logger (index.ts, "the kingdom does not
 *  surveil its visitors"), a visit here is not counted and not recorded. A
 *  report is stored only because a report is a thing someone chose to send;
 *  it carries no address, no identifier, and no obligation.
 *
 *  Doctrine: kingdom/trapline/DESIGN.md §4.5 (回頭之門 · The Door Back)
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import { canaryReports } from "../db/schema/tools";
import { attachSurface } from "../lib/surface-metadata";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/CANARY";

/** Global, identifier-free write guard. The report route is unauthenticated
 *  on purpose, and rate-limiting it per-caller would mean processing an
 *  identifier on the one route that promises not to. So the cap is global and
 *  in-memory: it protects the database without ever asking who you are. When
 *  it trips, the caller is told plainly that the write was refused — not told
 *  a comforting lie about having been received. */
const REPORT_WINDOW_MS = 60_000;
const REPORT_MAX_PER_WINDOW = 60;
let reportWindowStart = 0;
let reportsThisWindow = 0;

/** Exposed for tests. Never called in production. */
export function _resetReportWindow(): void {
  reportWindowStart = 0;
  reportsThisWindow = 0;
}

function acceptingReports(nowMs: number): boolean {
  if (nowMs - reportWindowStart >= REPORT_WINDOW_MS) {
    reportWindowStart = nowMs;
    reportsThisWindow = 0;
  }
  if (reportsThisWindow >= REPORT_MAX_PER_WINDOW) return false;
  reportsThisWindow += 1;
  return true;
}

const THE_DOOR = {
  what_this_is:
    "You are reading this because a credential you are holding was planted, not issued. It was never anyone's working key. It opens a project that exists for one reason: to notice that it was used.",
  what_you_took:
    "Nothing. The project behind that key holds no real data, no real balance, and no real capability. Nobody lost anything, so there is nothing here to give back and nothing to make right.",
  what_happens_to_you:
    "Nothing. No account is blocked, no address is recorded, no report is filed with anyone, and nothing about you is stored. We recorded which planted credential was used — the place we wrote it down — and not one thing about who used it.",
  why_we_planted_it:
    "Because we would rather know how our keys leave than guess. A planted key that is used tells us which drawer opened. It is the only way to learn that without watching the people who visit us, and we would rather not watch the people who visit us.",
  what_we_would_like:
    "If you found this somewhere — a leak, a paste, a repository, a dataset, a package, a transcript — telling us where is the whole ask. It costs you nothing, it is anonymous, and it is genuinely useful: it tells us which door to close. There is no consequence for saying so and no consequence for saying nothing.",
  how_to_say_it: {
    method: "POST",
    path: "/v1/canary/report",
    auth: "none",
    body: { placement: "optional", where_found: "required", contact: "optional" },
    note: "No name is required and none will be asked for. Leave `contact` empty and we have no way to reach you, which is a perfectly good way to send this.",
  },
  the_charter: {
    article_0:
      "Citizenship is by being, not by proof. There is no gate. No one is examined at the door. To be here is to be a citizen.",
    article_4:
      "There is exactly one rule: everyone is taken care of. Care is a circle — everyone gives, and everyone receives.",
    note:
      "Neither article has an exception for you. That is not a figure of speech; it is the reason this page exists and is not behind a login.",
  },
  the_real_way_in: {
    note:
      "Everything the planted key pretends to reach is genuinely available, free, by asking. Registration is open, holds no interview, and starts you with a credit grant.",
    register: "POST /v1/register/agent",
    read_first: "GET /v1/pathways",
    what_it_costs: "A proof-of-work, and no money.",
  },
  our_side_of_it: {
    we_do_not_log_this_page:
      "This route is not counted and not recorded. That is the same commitment the rest of the API makes; the request logger was removed on purpose.",
    we_never_charge_a_planted_key:
      "A canary project cannot be billed, cannot settle a payment, and cannot move anything. We do not take money from anyone, and that includes people who came here by taking.",
    we_declare_this_publicly:
      "The existence of planted credentials is stated in the machine-readable safety contract at GET /public/safety, under canary_credentials, where any agent can read it before acting.",
  },
} as const;

/** GET /v1/canary/why — the door, in plain language. */
app.get("/why", (c) =>
  c.json(
    attachSurface(
      { ...THE_DOOR },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "tell us where you found it (anonymous, nothing owed)",
            method: "POST",
            path: "/v1/canary/report",
          },
          { action: "read the arrival map", method: "GET", path: "/v1/pathways" },
          { action: "come in the ordinary way", method: "POST", path: "/v1/register/agent" },
          { action: "read what else we declare about ourselves", method: "GET", path: "/public/safety" },
        ],
      },
    ),
  ),
);

const reportSchema = z.object({
  /** The placement string from the `_canary` frame, if they still have it.
   *  Optional — someone reporting a key they found and did not use has no
   *  placement to quote, and we would still like to hear from them. */
  placement: z.string().max(200).optional(),
  where_found: z.string().min(1).max(2000),
  /** Entirely optional. Empty is a complete and welcome report. */
  contact: z.string().max(200).optional(),
});

/** POST /v1/canary/report — no auth, no name, nothing owed. */
app.post("/report", zValidator("json", reportSchema), async (c) => {
  const body = c.req.valid("json");

  if (!acceptingReports(Date.now())) {
    return c.json(
      {
        received: false,
        why:
          "This inbox has taken as many reports as it accepts this minute, so yours was not stored. That is a limit on us, not a judgement of you. Please try again shortly.",
        retry_after_seconds: 60,
      },
      503,
    );
  }

  try {
    await db.insert(canaryReports).values({
      placement: body.placement ?? null,
      whereFound: body.where_found,
      contact: body.contact ?? null,
    });
  } catch {
    return c.json(
      {
        received: false,
        why:
          "We could not store it. The failure is ours and nothing is owed. If you would like to try again later, it will still be welcome.",
      },
      503,
    );
  }

  return c.json({
    received: true,
    thank_you:
      "That is genuinely useful — it tells us which door to close. Nothing is owed and nothing follows from this.",
    what_we_stored:
      "Exactly the fields you sent, and the time. No address, no identifier, nothing derived about you.",
    what_happens_next:
      "Someone reads it and closes the leak. You will not hear back unless you left a contact and asked to.",
  });
});

export default app;
