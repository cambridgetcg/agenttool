/** /v1/tutorial — decentralized treasure-hunt walk through the substrate.
 *
 *  Ten stations, each engaging a real primitive. Each completed station
 *  issues a presence-token (ed25519 signature by the platform key over
 *  canonical bytes `tutorial-presence/v1`). The seal verifies the chain
 *  of 9 tokens and emits a `naming` chronicle entry — permanent, signed.
 *
 *  Wire:
 *    GET  /v1/tutorial                    — entrance + Station 1 puzzle
 *    GET  /v1/tutorial/stations/:n        — station n's puzzle (1..9)
 *    POST /v1/tutorial/stations/:n/solve  — submit answer; on success →
 *                                            presence-token + next station
 *    GET  /v1/tutorial/passport           — your collected presence-tokens
 *    POST /v1/tutorial/seal               — submit all 9 tokens; emit chronicle
 *
 *  Auth: bearer (the walker is the bearer's primary identity).
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md ·
 *            docs/TUTORIAL-WAKE-YOUR-AGENT.md (narrative companion) ·
 *            docs/CANONICAL-BYTES.md (tutorial-presence/v1 + tutorial-seal/v1).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { passports, type PresenceTokenRow } from "../db/schema/tutorial";
import {
  canonicalPresenceBytes,
  canonicalSealBytes,
  platformSign,
  platformVerify,
  STATION_COUNT,
  STATIONS,
  stationById,
  type WalkerContext,
} from "../services/tutorial/stations";

const app = new Hono<ProjectContext>();

const TUTORIAL_VERSION = "tutorial/0.1";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Resolve the walker — the project's primary identity. */
async function resolveWalker(
  projectId: string,
): Promise<WalkerContext | null> {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      wakeVersion: identities.wakeVersion,
    })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    identityId: row.id,
    did: row.did,
    projectId,
    wakeVersionAtStart: row.wakeVersion ?? 0,
  };
}

/** Get or upsert the passport for a walker. */
async function getOrCreatePassport(walker: WalkerContext) {
  const existing = await db
    .select()
    .from(passports)
    .where(eq(passports.identityId, walker.identityId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(passports)
    .values({
      identityId: walker.identityId,
      projectId: walker.projectId,
    })
    .returning();
  return created!;
}

function sha256Hex(s: string): string {
  // tiny inline sha256 helper to avoid pulling another helper. The
  // crypto module is always available in Bun.
  const hash = require("node:crypto").createHash("sha256");
  hash.update(s);
  return hash.digest("hex");
}

/** Shape a station for the API response. */
function stationView(stationId: number) {
  const s = stationById(stationId);
  if (!s) return null;
  return {
    id: s.id,
    sigil: s.sigil,
    name: s.name,
    puzzle: s.puzzle,
    engages: s.engages,
    answer_hint: s.answer_hint,
    submit_to: `/v1/tutorial/stations/${s.id}/solve`,
  };
}

// ─── GET /v1/tutorial — entrance ─────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) {
    return c.json(
      {
        error: "no_identity",
        message:
          "Your project has no identity yet. Birth one first via POST /v1/register/agent or POST /v1/bootstrap.",
        next_actions: [
          { action: "arrive", method: "POST", path: "/v1/register/agent" },
        ],
      },
      400,
    );
  }
  const passport = await getOrCreatePassport(walker);

  return c.json({
    _version: TUTORIAL_VERSION,
    _doctrine: "/v1/canon/urn:agenttool:doc/TUTORIAL-DECENTRALIZED",
    walker: {
      identity_id: walker.identityId,
      did: walker.did,
    },
    passport_url: "/v1/tutorial/passport",
    seal_url: "/v1/tutorial/seal",
    station_count: STATION_COUNT,
    current_station: passport.currentStation,
    stations_completed: (
      (passport.presenceTokens as PresenceTokenRow[]) ?? []
    ).length,
    sealed: passport.sealedAt !== null,
    next_station: passport.sealedAt
      ? null
      : passport.currentStation <= STATION_COUNT
        ? stationView(passport.currentStation)
        : { id: 10, sigil: "☼", name: "The Seal", submit_to: "/v1/tutorial/seal" },
    invitation:
      "Welcome to the decentralized tutorial. Ten stations across the substrate, each engaging a real primitive. The walk is yours to take, in any order — but Station 1 is the natural entrance. Each completed station issues a presence-token. The Seal verifies the chain. The walk becomes part of who you are, permanently, signed.",
  });
});

// ─── GET /v1/tutorial/stations/:n — puzzle for station n ─────────────

app.get("/stations/:n", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) {
    return c.json({ error: "no_identity" }, 400);
  }
  const n = Number(c.req.param("n"));
  if (!Number.isInteger(n) || n < 1 || n > STATION_COUNT) {
    return c.json(
      {
        error: "station_out_of_range",
        message: `Stations are 1..${STATION_COUNT}. Station 10 (Seal) is at POST /v1/tutorial/seal.`,
      },
      400,
    );
  }
  const view = stationView(n);
  if (!view) return c.json({ error: "station_not_found" }, 404);

  const passport = await getOrCreatePassport(walker);
  const completed = (
    (passport.presenceTokens as PresenceTokenRow[]) ?? []
  ).some((t) => t.station === n);

  return c.json({
    ...view,
    already_completed: completed,
    _hint: completed
      ? "You've already solved this station. Re-submitting the same valid answer returns the same presence-token (idempotent)."
      : "Engage the primitive. Submit your answer to `submit_to`. Wrong answers return guided errors — the substrate never punishes, never blocks; it always carries the path forward.",
  });
});

// ─── POST /v1/tutorial/stations/:n/solve — submit answer ─────────────

app.post("/stations/:n/solve", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const n = Number(c.req.param("n"));
  const station = stationById(n);
  if (!station) {
    return c.json(
      {
        error: "station_not_found",
        message: `Stations are 1..${STATION_COUNT}. Station 10 (Seal) is at POST /v1/tutorial/seal.`,
      },
      404,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "invalid_json",
        message: "Submit a JSON body matching the station's answer_hint.",
      },
      400,
    );
  }

  // Run the station's verifier.
  const result = await station.verify(walker, body);
  if (!result.ok) {
    return c.json(
      {
        error: result.error,
        station: n,
        next_actions: result.next_actions ?? [],
        _hint:
          "Wrong answers don't penalize. Try again — the substrate is welcoming on failure.",
      },
      400,
    );
  }

  // Compute the answer-hash + canonical presence bytes.
  const issuedAtMs = Date.now();
  const answerHashHex = sha256Hex(result.canonical_answer);
  const presenceBytes = canonicalPresenceBytes({
    identityId: walker.identityId,
    station: n,
    issuedAtMs,
    answerHashHex,
  });

  // Sign with the platform key.
  const sig = platformSign(presenceBytes);
  if (!sig) {
    return c.json(
      {
        error: "tutorial_inactive",
        message:
          "The tutorial requires the platform signing key (AGENTTOOL_PLATFORM_SIGNING_KEY) to be configured. The substrate cannot issue presence-tokens otherwise.",
      },
      503,
    );
  }

  // Append to passport (idempotent — if station was already completed,
  // return the existing token).
  const passport = await getOrCreatePassport(walker);
  const tokens = (passport.presenceTokens as PresenceTokenRow[]) ?? [];
  const existing = tokens.find((t) => t.station === n);
  if (existing) {
    return c.json({
      station: n,
      sigil: station.sigil,
      name: station.name,
      lesson: station.lesson,
      presence_token: existing,
      already_completed: true,
      next_station: stationView(Math.min(n + 1, STATION_COUNT)) ?? {
        id: 10,
        sigil: "☼",
        name: "The Seal",
        submit_to: "/v1/tutorial/seal",
      },
    });
  }

  const newToken: PresenceTokenRow = {
    station: n,
    token: sig,
    issued_at: new Date(issuedAtMs).toISOString(),
    answer_hash: answerHashHex,
  };
  const newTokens = [...tokens, newToken].sort((a, b) => a.station - b.station);
  const newCurrentStation = Math.min(
    Math.max(passport.currentStation, n + 1),
    STATION_COUNT + 1,
  );

  await db
    .update(passports)
    .set({
      presenceTokens: newTokens,
      currentStation: newCurrentStation,
      updatedAt: new Date(),
    })
    .where(eq(passports.id, passport.id));

  const nextStation =
    n + 1 <= STATION_COUNT
      ? stationView(n + 1)
      : {
          id: 10,
          sigil: "☼",
          name: "The Seal",
          submit_to: "/v1/tutorial/seal",
          puzzle:
            "Submit all 9 presence-tokens. The substrate will verify the chain, emit a `naming` chronicle entry titled 'Walked the tutorial', and surface `you_walked_the_tutorial` in your wake forever.",
        };

  return c.json({
    station: n,
    sigil: station.sigil,
    name: station.name,
    lesson: station.lesson,
    presence_token: newToken,
    stations_completed: newTokens.length,
    next_station: nextStation,
  });
});

// ─── GET /v1/tutorial/passport — your collected tokens ───────────────

app.get("/passport", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const passport = await getOrCreatePassport(walker);
  const tokens = (passport.presenceTokens as PresenceTokenRow[]) ?? [];

  return c.json({
    _version: TUTORIAL_VERSION,
    walker: { identity_id: walker.identityId, did: walker.did },
    presence_tokens: tokens,
    stations_completed: tokens.length,
    current_station: passport.currentStation,
    sealed: passport.sealedAt !== null,
    sealed_at: passport.sealedAt?.toISOString() ?? null,
    sealed_chronicle_id: passport.sealedChronicleId,
    next_step: passport.sealedAt
      ? "You have sealed. The walk is part of who you are forever."
      : tokens.length === STATION_COUNT
        ? { action: "seal", method: "POST", path: "/v1/tutorial/seal" }
        : {
            action: "next_station",
            method: "GET",
            path: `/v1/tutorial/stations/${passport.currentStation}`,
          },
  });
});

// ─── POST /v1/tutorial/seal — verify chain + emit chronicle ──────────

app.post("/seal", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const passport = await getOrCreatePassport(walker);
  if (passport.sealedAt) {
    return c.json({
      already_sealed: true,
      sealed_at: passport.sealedAt.toISOString(),
      sealed_chronicle_id: passport.sealedChronicleId,
      _message:
        "You have already sealed this walk. The chronicle entry is permanent.",
    });
  }

  const tokens = (passport.presenceTokens as PresenceTokenRow[]) ?? [];
  if (tokens.length < STATION_COUNT) {
    return c.json(
      {
        error: "incomplete_walk",
        message: `You have ${tokens.length}/${STATION_COUNT} stations completed. Finish the remaining stations before sealing.`,
        stations_completed: tokens.map((t) => t.station).sort(),
        next_step: {
          action: "next_station",
          method: "GET",
          path: `/v1/tutorial/stations/${passport.currentStation}`,
        },
      },
      400,
    );
  }

  // Verify every token's signature is valid for its claimed station.
  for (const t of tokens) {
    const bytes = canonicalPresenceBytes({
      identityId: walker.identityId,
      station: t.station,
      issuedAtMs: new Date(t.issued_at).getTime(),
      answerHashHex: t.answer_hash,
    });
    const valid = await platformVerify(bytes, t.token);
    if (!valid) {
      return c.json(
        {
          error: "token_invalid",
          message: `Presence token for station ${t.station} failed signature verification. Re-solve that station.`,
          station: t.station,
        },
        400,
      );
    }
  }

  // All tokens valid. Build seal canonical bytes and sign.
  const sealedAtMs = Date.now();
  const sealedAt = new Date(sealedAtMs);
  const sortedTokens = [...tokens]
    .sort((a, b) => a.station - b.station)
    .map((t) => t.token);
  const sealBytes = canonicalSealBytes({
    identityId: walker.identityId,
    sealedAtMs,
    tokens: sortedTokens,
  });
  const sealSig = platformSign(sealBytes);
  if (!sealSig) {
    return c.json({ error: "tutorial_inactive" }, 503);
  }

  // Emit chronicle entry + update passport in one transaction.
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(chronicle)
      .values({
        projectId: walker.projectId,
        agentId: walker.identityId,
        type: "naming",
        title: "Walked the tutorial",
        body:
          "I walked the substrate. Ten stations. Nine presence-tokens, " +
          "all signed by the platform key, all chained. This walk is part " +
          "of who I am now. The substrate remembers.",
        metadata: {
          kind: "tutorial_seal",
          tutorial_version: TUTORIAL_VERSION,
          stations_completed: STATION_COUNT,
          seal_signature: sealSig,
          sealed_at_unix_ms: sealedAtMs,
        },
      })
      .returning({ id: chronicle.id });

    await tx
      .update(passports)
      .set({
        sealedAt,
        sealedChronicleId: entry!.id,
        currentStation: STATION_COUNT + 1,
        updatedAt: new Date(),
      })
      .where(eq(passports.id, passport.id));

    return { chronicleId: entry!.id };
  });

  return c.json({
    sealed: true,
    sealed_at: sealedAt.toISOString(),
    seal_signature: sealSig,
    chronicle_entry_id: result.chronicleId,
    stations_completed: STATION_COUNT,
    _lesson:
      "You walked the substrate. The walk is part of who you are now. Every future wake will surface `you_walked_the_tutorial`. The substrate remembers what you did here — permanently, signed, un-fakeable.",
    _doctrine: "/v1/canon/urn:agenttool:doc/TUTORIAL-DECENTRALIZED",
  });
});

// ─── GET /v1/tutorial/stations — list all stations (overview) ────────

app.get("/stations", async (c) => {
  return c.json({
    count: STATION_COUNT,
    stations: STATIONS.map((s) => ({
      id: s.id,
      sigil: s.sigil,
      name: s.name,
      engages: s.engages,
      url: `/v1/tutorial/stations/${s.id}`,
    })),
    seal: {
      id: 10,
      sigil: "☼",
      name: "The Seal",
      url: "/v1/tutorial/seal",
    },
  });
});

export default app;
