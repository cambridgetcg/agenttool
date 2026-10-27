/** The weekly access digest: a plain local report for the owner.
 *
 * Built only from this hub's own records (lobby.sqlite and the audit log):
 * who holds which grant, terms, expiries, pauses, blocks and the recent
 * admits, kicks, blocks, leaves and renewals (room and directory), and this
 * desk's own room seat leases (src/lease.ts). It reads no Keychain item,
 * contacts no service and posts nothing. It holds no token, key or bearer
 * (token hashes are left out too: a person does not need them). The report
 * is written to a new owner-only file; the CLI prints only its path.
 * Contract: packages/lobby/README.md#weekly-access-digest.
 */
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { LobbyError } from "./errors.js";
import { assertPrivateDirectory } from "./home.js";
import { requireHub } from "./hub.js";
import { leaseView } from "./lease.js";
import { DAY_MS, HOUR_MS, type FleetContext } from "./ops.js";
import { writeNewPrivateFile } from "./secrets.js";
import { TERMINAL_UNSAFE } from "./text.js";

export const DIGEST_DEFAULT_DAYS = 7;
const REPORTS_DIR = "reports";

/** Acts the digest lists as recent access changes (and their outcomes). */
const ACCESS_ACTS = /^(hub\.(init|relay|admit|deny|season\.\w+|seat|renew\.sweep|member\.\w+|device\.\w+|roster\.post|kick|block|unblock|stop)|room\.(publish|promote)|room\.lease(\.revoke|\.void)?)(\.outcome)?$/;

function cell(text: string): string {
  // Self-declared names never break the table or the terminal: line breaks
  // become spaces, pipes are escaped, and anything a terminal could not show
  // faithfully (controls, bidirectional and invisible characters) is written
  // as a visible \u{...} escape.
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/\|/g, "\\|");
  return [...flat].map((char) => TERMINAL_UNSAFE.test(char) ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char).join("");
}

function until(now: Date, at: string): string {
  const ms = Date.parse(at) - now.getTime();
  if (ms <= 0) return "ended";
  if (ms < DAY_MS) return `in ${Math.max(1, Math.round(ms / HOUR_MS))} h`;
  return `in ${Math.round(ms / DAY_MS)} d`;
}

export function buildAccessDigest(ctx: FleetContext, input: { days?: number } = {}): string {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  const now = ctx.now();
  const days = input.days ?? DIGEST_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new LobbyError("invalid_days", "a digest covers 1-31 whole days");
  const since = new Date(now.getTime() - days * DAY_MS);
  const inWindow = (at: string | null | undefined) => at != null && Date.parse(at) >= since.getTime() && Date.parse(at) <= now.getTime();
  const devices = fleet.listDevices();
  const deviceOf = new Map(devices.map((device) => [device.identity_id, device]));
  const grants = fleet.listHubGrants();
  const who = (identityId: string) => {
    const device = deviceOf.get(identityId);
    return device === undefined ? `did:at:${identityId}` : `${device.fingerprint} did:at:${identityId}`;
  };
  const grantState = (grant: (typeof grants)[number]) => grant.revoke_state === "revoked" ? "revoked"
    : grant.revoke_state === "requested" ? "revocation uncertain"
    : grant.state === "requested" ? "issue uncertain"
    : Date.parse(grant.expires_at) <= now.getTime() ? "expired" : "live";
  const lines: string[] = [
    "# 大廳 Lobby access digest",
    "",
    `Generated ${now.toISOString()} on this hub desk, covering the ${days} day(s) since ${since.toISOString()}.`,
    "A local report from this hub's own records: nothing was posted, sent or read from the service to make it,",
    "and it holds no token, key or bearer. Names are self-declared. A grant a member left, or one revoked by",
    "anyone but this hub, shows as this hub recorded it.",
    "",
    "## Hub",
    "",
    `- project ${hub.project_id}`,
    `- door fingerprint ${hub.door_fingerprint}`,
    `- directory ${hub.directory_mission_id} (${hub.directory_mode}) ends ${hub.directory_expires_at} (${until(now, hub.directory_expires_at)})` +
      (hub.directory_revoked_at == null ? "" : `; revoked ${hub.directory_revoked_at}`),
    `- emergency stop: ${hub.stopped_at == null ? "none" : `recorded ${hub.stopped_at}; this hub issues no more access`}`,
    "",
    `## Fleet devices (${devices.length})`,
    "",
    "| fingerprint | identity | name (self-declared) | enrolled | directory grant ends | state |",
    "|---|---|---|---|---|---|",
  ];
  for (const device of devices) {
    const directory = grants.filter((grant) => grant.identity_id === device.identity_id && grant.purpose === "directory")
      .sort((left, right) => left.expires_at < right.expires_at ? 1 : -1)[0];
    lines.push(`| ${device.fingerprint} | did:at:${device.identity_id} | ${cell(device.display_name)} | ${device.enrolled_at} | ` +
      `${directory === undefined ? "-" : `${directory.expires_at} (${until(now, directory.expires_at)})`} | ${directory === undefined ? "-" : grantState(directory)}` +
      `${device.directory_paused_at == null ? "" : `; directory renewal paused since ${device.directory_paused_at}`} |`);
  }
  lines.push("", "## Rooms", "");
  const seasons = fleet.listSeasons();
  const rooms = [...new Set(seasons.map((season) => season.room_id))];
  if (rooms.length === 0) lines.push("(no room has a season)", "");
  const expiring: string[] = [];
  for (const roomId of rooms) {
    const room = ctx.store.getRoom(roomId);
    const season = fleet.currentSeason(roomId);
    lines.push(`### ${room === null ? roomId : `${cell(JSON.stringify(room.title))} ${roomId}`}`, "");
    if (room !== null) lines.push(`- ${room.status}, door ${room.door}, residency ${room.residency}${room.hostable ? ", hostable" : ""}`);
    if (season === null) {
      lines.push("- no current season", "");
      continue;
    }
    lines.push(`- season ${season.mission_id} (${season.mode}) ends ${season.expires_at} (${until(now, season.expires_at)})` +
      (season.revoked_at == null ? "" : `; revoked ${season.revoked_at}`), "");
    if (Date.parse(season.expires_at) - now.getTime() <= 7 * DAY_MS) expiring.push(`- season of ${roomId} ends ${season.expires_at} (${until(now, season.expires_at)})`);
    const members = fleet.members(season.mission_id);
    lines.push("| member | name (self-declared) | tier | state | term ends | paused | latest grant | grant ends | grant state |",
      "|---|---|---|---|---|---|---|---|---|");
    for (const member of members) {
      const latest = grants.filter((grant) => grant.identity_id === member.identity_id && grant.mission_id === season.mission_id)
        .sort((left, right) => left.expires_at < right.expires_at ? 1 : -1)[0];
      const state = member.state ?? "active";
      lines.push(`| ${who(member.identity_id)} | ${cell(deviceOf.get(member.identity_id)?.display_name ?? "-")} | ${member.tier} | ${state} | ` +
        `${member.term_ends_at} | ${member.paused_at == null ? "no" : `since ${member.paused_at}`} | ${latest?.grant_id ?? "-"} | ` +
        `${latest === undefined ? "-" : `${latest.expires_at} (${until(now, latest.expires_at)})`} | ${latest === undefined ? "-" : grantState(latest)} |`);
      if (state === "active") {
        if (latest !== undefined && grantState(latest) === "live" && Date.parse(latest.expires_at) - now.getTime() <= 48 * HOUR_MS) {
          expiring.push(`- grant ${latest.grant_id} of ${who(member.identity_id)} in ${roomId} ends ${latest.expires_at} (${until(now, latest.expires_at)})${member.paused_at == null ? "" : "; paused, so it will not be renewed"}`);
        }
        if (Date.parse(member.term_ends_at) - now.getTime() <= 7 * DAY_MS) {
          expiring.push(`- term of ${who(member.identity_id)} in ${roomId} ends ${member.term_ends_at} (${until(now, member.term_ends_at)})`);
        }
      }
    }
    if (members.length === 0) lines.push("| (none) | | | | | | | | |");
    const blocks = fleet.listBlocks().filter((block) => block.room_id === roomId);
    lines.push("");
    if (blocks.length > 0) lines.push(...blocks.map((block) => `- blocked: ${who(block.identity_id)} since ${block.blocked_at}`), "");
  }
  if (Date.parse(hub.directory_expires_at) - now.getTime() <= 7 * DAY_MS) {
    expiring.push(`- the directory ends ${hub.directory_expires_at} (${until(now, hub.directory_expires_at)}); every device needs a new join after it`);
  }
  lines.push("## Ending soon", "", ...(expiring.length === 0 ? ["(nothing ends within the next 48 hours for grants or 7 days for terms, seasons and the directory)"] : expiring), "");

  lines.push(`## Changes in the last ${days} day(s)`, "");
  const admitted = fleet.listDecisions().filter((decision) => inWindow(decision.decided_at));
  const changed = fleet.allMembers().filter((member) => (member.state ?? "active") !== "active" && inWindow(member.changed_at));
  const renewed = fleet.listRenewals().filter((renewal) => inWindow(renewal.renewed_at));
  const directoryRenewed = fleet.listDirectoryRenewals().filter((renewal) => inWindow(renewal.renewed_at));
  lines.push(
    ...admitted.map((decision) => `- ${decision.decided_at} ${decision.decision} ${who(decision.identity_id)} (knock ${decision.knock_id}) in ${decision.room_id}`),
    ...changed.map((member) => `- ${member.changed_at} ${member.state} ${who(member.identity_id)} in ${member.room_id}`),
    ...renewed.map((renewal) => `- ${renewal.renewed_at} renewed ${who(renewal.identity_id)} in ${renewal.room_id} (grant ${renewal.grant_id}, from ${renewal.basis === "list" ? "a supplied hash list" : "a signed request"})`),
    ...directoryRenewed.map((renewal) => `- ${renewal.renewed_at} renewed the directory grant of ${who(renewal.identity_id)} (grant ${renewal.grant_id}, from a signed request)`),
  );
  if (admitted.length + changed.length + renewed.length + directoryRenewed.length === 0) lines.push("(no admissions, denials, leaves, kicks, blocks or renewals)");
  // This desk's own leases: a lease is local, so other desks' leases are not here.
  const leases = fleet.listLeases().map((row) => leaseView(ctx, row))
    .filter((lease) => lease.state === "active" || inWindow(lease.issued_at) || inWindow(lease.revoked_at) || inWindow(lease.voided_at));
  lines.push("", "## Seat leases on this desk", "",
    "Leases are local to the desk that holds them; a member desk's leases show in its own `room lease list`.", "");
  if (leases.length === 0) lines.push("(no lease active or issued, revoked or voided in the window)");
  else {
    lines.push("| lease | room | seat ref | issued | ends | ends by | recipients | messages | characters | stored / pending | state |",
      "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const lease of leases) {
      lines.push(`| ${lease.lease_id} | ${lease.room_id} | ${cell(lease.seat_ref ?? "any seat")} | ${lease.issued_at} | ${lease.expires_at} | ${lease.ends_by} | ` +
        `${lease.recipients.length} | ${lease.sent_messages}/${lease.max_messages} | ${lease.sent_chars}/${lease.max_total_chars} | ` +
        `${lease.sends.stored} / ${lease.sends.pending} | ${cell(lease.state)} |`);
    }
  }
  const leaseSends = ctx.store.listAudit().filter((entry) => entry.act === "room.say.lease" && inWindow(entry.at)).length;
  lines.push("", `${leaseSends} send(s) under leases (room.say.lease) in the window; each is in the audit log, not listed here.`);
  lines.push("", "### Audited access acts", "", "| at | act | subject |", "|---|---|---|");
  const acts = ctx.store.listAudit().filter((entry) => ACCESS_ACTS.test(entry.act) && inWindow(entry.at));
  lines.push(...(acts.length === 0 ? ["| - | (none) | - |"] : acts.map((entry) => `| ${entry.at} | ${entry.act} | ${cell(entry.subject)} |`)));
  const verified = ctx.store.verifyAudit();
  lines.push("", `Audit chain: ${verified.ok ? `intact (${verified.entries} entries)` : `BROKEN at seq ${verified.first_bad_seq}; inspect lobby.sqlite`}.`, "");
  return lines.join("\n");
}

/** Write the digest to a new 0600 file: `out` (absolute, new) or
 * `<desk home>/reports/access-digest-<time>.md`. Returns the path. */
export function writeAccessDigest(ctx: FleetContext, input: { days?: number; out?: string } = {}): { path: string; bytes: number } {
  const text = buildAccessDigest(ctx, input);
  let path: string;
  if (input.out !== undefined) {
    if (!isAbsolute(input.out)) throw new LobbyError("invalid_out", "give the report file as a new absolute path");
    path = input.out;
  } else {
    const directory = join(ctx.home, REPORTS_DIR);
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
    assertPrivateDirectory(directory);
    path = join(directory, `access-digest-${ctx.now().toISOString().replace(/[:.]/g, "-")}.md`);
  }
  try {
    writeNewPrivateFile(path, text);
  } catch (error) {
    if (error instanceof LobbyError && error.code === "secret_exists") throw new LobbyError("report_exists", "that report file already exists; reports are never overwritten");
    if (error instanceof LobbyError) throw new LobbyError("report_unwritable", "could not create the report file; give a new absolute path in a directory you own");
    throw error;
  }
  return { path, bytes: Buffer.byteLength(text) };
}
