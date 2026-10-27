/** Directory rollover (schema version 5): `hub directory successor`.
 *
 * The directory is a mission of at most 30 days. Before it ends, the hub
 * creates the next one, whose charter names the same pinned door and the
 * directory before it (`directoryDescriptor` with a predecessor), takes the
 * hub desk's seat there, posts a door-signed `directory_successor` notice in
 * the old directory and reposts each room's latest card, byte for byte, in
 * the new one. One confirmation at /dev/tty covers it all; the door key signs
 * before the prompt so the prompt shows the exact bytes.
 *
 * Desks then move on their own next `fleet renew` (src/directory-renewal.ts):
 * the request names the successor, the sweep issues the first grant there,
 * and the pickup checks the notice against the pinned door key and the
 * successor's charter before it moves the desk. The door pin never changes.
 * While the two overlap the hub keeps a chain (`hub_directories`: current,
 * and previous until it ends): door documents may go to both, knocks and
 * requests are read from both, and `hub stop` revokes every directory.
 *
 * Creation follows `hub init` and `hub season open`: a pending record first,
 * an uncertain create is never retried (run the command again with no
 * `--days` to resume with the same id and bytes), and a definite refusal
 * forgets the record. A failure after the successor exists leaves it recorded
 * and unannounced; the next run finishes (seat, notice, cards). Once the
 * notice is recorded it is never re-signed: an unsent post stays in the
 * outbox for `outbox retry`. Contract: packages/lobby/README.md#directory-rollover.
 */
import { LobbyError } from "./errors.js";
import type { DeskRow, HubDirectoryRow, HubRow } from "./fleet-store.js";
import { DIRECTORY_GATE_ROOM, assertSendable, mayHaveTakenEffect, type MissionView, type ParticipantSeat } from "./hosted.js";
import {
  adminClient,
  directoryDescriptor,
  doorKey,
  doorOf,
  executeSeatIssue,
  planSeatIssue,
  requireHubDesk,
  requireLiveHub,
  seatRecord,
  type SeatIssue,
} from "./hub.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  DAY_MS,
  deviceTerms,
  gateOfRoom,
  HOUR_MS,
  hubLiveDirectories,
  liveSeat,
  preparePost,
  queuePost,
  requireFleetRoom,
  requireKeychain,
  requireSeat,
  sendPost,
  type FleetContext,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import { openDocument, sealDocument, type DirectorySuccessorBody, type FleetCard } from "./signed.js";
import type { ActPreview } from "./store.js";
import { missionDigest, newUuid, validateMissionDescriptor, wireCanonicalJson, type MissionDescriptor } from "./wire.js";

const POST_MARGIN_MS = 5 * 60_000;

export interface SuccessorPlan {
  preview: ActPreview;
  /** `create`: a new successor; `resume`: a creation asked for but never
   * confirmed, asked for again with the same id and bytes; `finish`: created,
   * not yet announced (the seat, the notice and the cards). */
  mode: "create" | "resume" | "finish";
  from: { mission_id: string; mission_digest: string; expires_at: string };
  mission: { mission_id: string; mission_digest: string; expires_at: string; descriptor: MissionDescriptor };
  /** The hub desk's seat in the successor; null when it already holds one. */
  seat: SeatIssue | null;
  notice: DirectorySuccessorBody;
  notice_post: PreparedPost;
  notice_seat: ParticipantSeat;
  /** Each room's latest card, the exact recorded bytes, for the successor
   * (posted with the hub desk's seat there, known only once it is taken). */
  cards: Array<{ room_id: string; card_seq: number; post: PreparedPost }>;
  /** Rooms whose card is not reposted, and why. */
  cards_skipped: Array<{ room_id: string; reason: string }>;
}

/** The successor recorded for the current directory and not announced yet. */
function openSuccessor(ctx: FleetContext, hub: HubRow): HubDirectoryRow | null {
  return ctx.store.fleet.hubDirectories().find((row) => (row.state === "pending" || row.state === "successor")
    && row.predecessor_mission_id === hub.directory_mission_id) ?? null;
}

/** The charter recorded for a successor, checked against its digest. */
function recordedDescriptor(row: HubDirectoryRow): MissionDescriptor {
  const descriptor = validateMissionDescriptor(JSON.parse(row.descriptor));
  if (missionDigest(descriptor) !== row.mission_digest) {
    throw new LobbyError("successor_record_changed", "the recorded successor's charter no longer matches its digest");
  }
  return descriptor;
}

/** Each fleet room's latest card whose season is still live, as recorded
 * (the exact door-signed bytes, never re-signed), framed for `missionId`. */
function cardReposts(ctx: FleetContext, missionId: string, now: Date): Pick<SuccessorPlan, "cards" | "cards_skipped"> {
  const fleet = ctx.store.fleet;
  const cards: SuccessorPlan["cards"] = [];
  const skipped: SuccessorPlan["cards_skipped"] = [];
  const rooms = [...new Set(fleet.listSeasons().map((season) => season.room_id))].sort();
  for (const roomId of rooms) {
    const latest = fleet.latestCard(roomId);
    if (latest === null) continue;
    const card = openDocument(latest.summary)?.body as FleetCard | undefined;
    const season = fleet.currentSeason(roomId);
    if (card === undefined || season === null || season.revoked_at != null || Date.parse(season.expires_at) <= now.getTime()
      || Date.parse(card.season.expires_at) <= now.getTime()) {
      skipped.push({ room_id: roomId, reason: "season_ended" });
      continue;
    }
    let room;
    try {
      room = requireFleetRoom(ctx, roomId);
    } catch {
      skipped.push({ room_id: roomId, reason: "room_not_fleet" });
      continue;
    }
    cards.push({ room_id: roomId, card_seq: latest.card_seq, post: preparePost(ctx, "card", missionId, latest.summary, gateOfRoom(room)) });
  }
  return { cards, cards_skipped: skipped };
}

/** `hub directory successor [--days 1-30]`: create (or resume, or finish)
 * the next directory and announce it. */
export async function planDirectorySuccessor(ctx: FleetContext, input: { days?: number }): Promise<SuccessorPlan> {
  const hub = requireLiveHub(ctx);
  const desk = requireHubDesk(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  if (!fleet.v5) throw new LobbyError("state_not_upgraded", "this desk state has no version-5 directory chain tables yet");
  const now = ctx.now();
  const previous = hubLiveDirectories(ctx, hub, now).find((directory) => directory.role === "previous");
  if (previous !== undefined) {
    throw new LobbyError("overlap_open",
      `the previous directory ${previous.mission_id} is still live until ${previous.expires_at}; the next successor waits until it ends. ` +
      "An announcement post without a receipt is in the outbox (outbox list, outbox retry)");
  }
  const open = openSuccessor(ctx, hub);
  if (open !== null && input.days !== undefined) {
    throw open.state === "pending"
      ? new LobbyError("successor_resume_only",
        `successor directory ${open.mission_id} was asked for but never confirmed; run hub directory successor with no --days to resume it with the same id and bytes`)
      : new LobbyError("successor_exists",
        `successor directory ${open.mission_id} exists and is not announced yet; run hub directory successor with no --days to finish announcing it`);
  }
  if (Date.parse(hub.directory_expires_at) <= now.getTime() + HOUR_MS) {
    throw new LobbyError("directory_ending",
      `the directory ends at ${hub.directory_expires_at}, within the hour: too late for a successor. Start again with hub init, and every device joins again`);
  }
  const from = { mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest, expires_at: hub.directory_expires_at };
  let mode: SuccessorPlan["mode"];
  let mission: SuccessorPlan["mission"];
  if (open !== null) {
    mode = open.state === "pending" ? "resume" : "finish";
    mission = { mission_id: open.mission_id, mission_digest: open.mission_digest, expires_at: open.expires_at, descriptor: recordedDescriptor(open) };
  } else {
    mode = "create";
    const days = input.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new LobbyError("invalid_days", "a directory lasts 1-30 whole days");
    const expiresAt = new Date(now.getTime() + days * DAY_MS - CLOCK_MARGIN_MS).toISOString();
    if (Date.parse(expiresAt) <= Date.parse(from.expires_at)) {
      throw new LobbyError("successor_too_short",
        `a successor ending ${expiresAt} would not outlast the current directory (it ends ${from.expires_at}); give more --days`);
    }
    const descriptor = directoryDescriptor(doorOf(hub), { mission_id: from.mission_id, mission_digest: from.mission_digest });
    mission = { mission_id: newUuid(), mission_digest: missionDigest(descriptor), expires_at: expiresAt, descriptor };
  }
  if (Date.parse(mission.expires_at) <= now.getTime() + HOUR_MS) {
    throw new LobbyError("successor_ending", `the recorded successor ends at ${mission.expires_at}, within the hour`);
  }
  assertSendable(wireCanonicalJson(mission.descriptor), DIRECTORY_GATE_ROOM, deviceTerms(ctx));
  const noticeSeat = requireSeat(ctx, from.mission_id, "mission.observe", POST_MARGIN_MS, "; run hub seat directory").seat;
  // A seat the hub desk already holds in a successor being finished is reused.
  const seat = mode === "finish" && liveSeat(ctx, mission.mission_id, "mission.observe", POST_MARGIN_MS) !== null
    ? null : planSeatIssue(ctx, desk, mission, "directory", null);
  const notice: DirectorySuccessorBody = {
    from_mission_id: from.mission_id,
    from_mission_digest: from.mission_digest,
    from_expires_at: from.expires_at,
    to_mission_id: mission.mission_id,
    to_mission_digest: mission.mission_digest,
    to_expires_at: mission.expires_at,
    issued_at: now.toISOString(),
  };
  const summary = sealDocument("directory_successor", notice, { privateKey: await doorKey(ctx, hub), fingerprint: hub.door_fingerprint }).summary;
  const noticePost = preparePost(ctx, "directory_successor", from.mission_id, summary, DIRECTORY_GATE_ROOM);
  const { cards, cards_skipped: cardsSkipped } = cardReposts(ctx, mission.mission_id, now);
  const verb = mode === "create" ? "create" : mode === "resume"
    ? "resume creating (same id and bytes; the first request was never confirmed)" : "finish announcing (created already)";
  const preview = actPreview("hub.directory.successor", from.mission_id, now.toISOString(), [
    `${verb} successor directory mission ${mission.mission_id} until ${mission.expires_at}`,
    `charter digest ${mission.mission_digest}: it names the door ${hub.door_fingerprint} and its predecessor ${from.mission_id} (${from.mission_digest})`,
    `the current directory ${from.mission_id} ends ${from.expires_at}`,
    seat === null ? "this hub desk already holds a seat in the successor" : `this hub desk takes a seat there: grant ${seat.issue.grant_id} until ${seat.issue.expires_at}`,
    `door-signed directory_successor notice posted to the current directory ${from.mission_id} (exact bytes below)`,
    `repost ${cards.length} room card(s) to the successor, byte for byte: ${cards.map((card) => `${card.room_id} #${card.card_seq}`).join(", ") || "none"}`,
    ...cardsSkipped.map((item) => `  not reposted: ${item.room_id} (${item.reason})`),
    `from now on, new joins and relays, cards, knocks and directory renewals go to ${mission.mission_id}; ${from.mission_id} stays readable until ${from.expires_at}, ` +
      "and each desk moves there with its next fleet renew pickups (the door pin is unchanged)",
  ], {
    mode,
    from,
    successor: { ...mission },
    hub_seat: seat === null ? null : seatRecord(seat),
    notice: { mission_id: noticePost.mission_id, event_id: noticePost.event_id, summary },
    cards: cards.map((card) => ({ room_id: card.room_id, card_seq: card.card_seq, mission_id: card.post.mission_id, event_id: card.post.event_id, summary: card.post.summary })),
    cards_skipped: cardsSkipped,
  });
  return { preview, mode, from, mission, seat, notice, notice_post: noticePost, notice_seat: noticeSeat, cards, cards_skipped: cardsSkipped };
}

export interface SuccessorOutcome {
  mission_id: string;
  mission_digest: string;
  expires_at: string;
  seat_expires_at: string | null;
  posts: PostOutcome[];
}

const RESUME = "run hub directory successor again (no --days) to resume with the same id and bytes";

export async function executeDirectorySuccessor(ctx: FleetContext, plan: SuccessorPlan): Promise<SuccessorOutcome> {
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  const missionId = plan.mission.mission_id;
  // 1. Checked again (another terminal may have stopped the hub or moved its
  // directory while the prompt was open), and the successor recorded before
  // anything is sent.
  const hub = fleet.transaction(() => {
    const live = requireLiveHub(ctx);
    if (live.directory_mission_id !== plan.from.mission_id) {
      throw new LobbyError("announce_changed", "the hub's directory changed while the prompt was open; nothing was recorded or sent");
    }
    const row = fleet.hubDirectory(missionId);
    const open = openSuccessor(ctx, live);
    if (plan.mode === "create") {
      if (row !== null || open !== null) {
        throw new LobbyError("announce_changed", "another successor was recorded while the prompt was open; nothing was sent. Run hub directory successor again");
      }
      fleet.addHubDirectory({
        mission_id: missionId,
        mission_digest: plan.mission.mission_digest,
        descriptor: wireCanonicalJson(plan.mission.descriptor),
        expires_at: plan.mission.expires_at,
        predecessor_mission_id: plan.from.mission_id,
        mode: "created",
        state: "pending",
        notice_event_id: null,
        announced_at: null,
        revoked_at: null,
        recorded_at: at,
      });
    } else if (row?.state !== (plan.mode === "resume" ? "pending" : "successor")) {
      throw new LobbyError("announce_changed", "the successor's record changed while the prompt was open; nothing was sent. Run hub directory successor again");
    }
    return live;
  });
  const admin = await adminClient(ctx, hub);
  // 2. Create it (never retried; an uncertain outcome resumes with the same bytes).
  if (plan.mode !== "finish") {
    const request = { mission_id: missionId, descriptor: plan.mission.descriptor, expires_at: plan.mission.expires_at };
    let view: MissionView;
    try {
      view = await admin.createMission(request, DIRECTORY_GATE_ROOM);
    } catch (error) {
      if (error instanceof LobbyError && error.details.error === "collaboration_mission_conflict") {
        // The same id already exists: it counts only if it is exactly this successor.
        view = await admin.getMission(missionId);
        if (view.mission_digest !== plan.mission.mission_digest || view.expires_at !== plan.mission.expires_at) {
          fleet.dropPendingHubDirectory(missionId);
          throw new LobbyError("successor_conflict", "a different mission already holds the successor's id; nothing was announced. Run hub directory successor again");
        }
      } else if (mayHaveTakenEffect(error)) {
        const detail = error instanceof LobbyError ? `${error.code}: ${error.message}` : "the request failed unexpectedly";
        throw new LobbyError("successor_uncertain",
          `${detail}. Successor directory ${missionId} may or may not exist; nothing was retried or announced. ${RESUME}`);
      } else {
        // A definite refusal: the service did not create it.
        fleet.dropPendingHubDirectory(missionId);
        throw error;
      }
    }
    if (view.project_id !== hub.project_id) {
      fleet.dropPendingHubDirectory(missionId);
      throw new LobbyError("project_mismatch",
        `successor mission ${view.mission_id} was created in project ${view.project_id}, not this hub's ${hub.project_id}: the Keychain bearer is for another project. Nothing was announced`);
    }
    fleet.markHubDirectoryCreated(missionId);
  }
  // 3. The hub desk's seat in the successor. A failure leaves the successor
  // recorded and unannounced; the next run finishes.
  let seatExpires: string | null = null;
  const desk: DeskRow = requireHubDesk(ctx);
  if (plan.seat !== null) {
    try {
      seatExpires = await executeSeatIssue(ctx, admin, desk, plan.seat);
    } catch (error) {
      if (!(error instanceof LobbyError)) throw error;
      throw new LobbyError(error.code,
        `${error.message}. Successor directory ${missionId} is created and recorded, and nothing was announced; run hub directory successor again to finish`,
        error.details);
    }
  }
  const successorSeat = requireSeat(ctx, missionId, "mission.observe", 0,
    ". Nothing was announced; run hub directory successor again to finish").seat;
  // 4. Announce: in one transaction, checked again, the chain and both
  // pointers move and every post is saved before the first send.
  fleet.transaction(() => {
    const live = requireLiveHub(ctx);
    const row = fleet.hubDirectory(missionId);
    if (live.directory_mission_id !== plan.from.mission_id || row?.state !== "successor" || row.notice_event_id !== null) {
      throw new LobbyError("announce_changed", "the hub's directory chain changed while this act ran; nothing was announced. Run hub directory successor again");
    }
    if (fleet.hubDirectory(plan.from.mission_id) === null) {
      // A chain that does not record the current directory yet (it predates version 5 in some way): record it now.
      fleet.addHubDirectory({
        mission_id: live.directory_mission_id, mission_digest: live.directory_digest, descriptor: live.directory_descriptor,
        expires_at: live.directory_expires_at, predecessor_mission_id: null, mode: live.directory_mode, state: "previous",
        notice_event_id: null, announced_at: null, revoked_at: live.directory_revoked_at ?? null, recorded_at: at,
      });
    }
    fleet.announceHubSuccessor({ from_mission_id: plan.from.mission_id, to: row, notice_event_id: plan.notice_post.event_id, at });
    // The hub's own desk moves with it (the hub desk renews through the sweep, never by fleet renew).
    fleet.moveDeskDirectory({
      mission_id: missionId, mission_digest: plan.mission.mission_digest, expires_at: plan.mission.expires_at,
      predecessor_mission_id: plan.from.mission_id, how: "successor", at,
    });
    queuePost(ctx, plan.notice_post, plan.notice_seat);
    for (const card of plan.cards) queuePost(ctx, card.post, successorSeat);
  });
  // 5. Each post is sent once; an uncertain one stays in the outbox.
  const posts: PostOutcome[] = [await sendPost(ctx, plan.notice_post, plan.notice_seat)];
  for (const card of plan.cards) posts.push(await sendPost(ctx, card.post, successorSeat));
  ctx.store.recordAct(actPreview("hub.directory.successor.outcome", plan.from.mission_id, ctx.now().toISOString(), [], {
    successor: missionId,
    seat_expires_at: seatExpires,
    posts: posts.map((post) => ({ mission_id: post.mission_id, kind: post.kind, event_id: post.event_id, status: post.status })),
  }));
  return { mission_id: missionId, mission_digest: plan.mission.mission_digest, expires_at: plan.mission.expires_at, seat_expires_at: seatExpires, posts };
}
