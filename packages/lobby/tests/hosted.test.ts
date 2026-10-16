/** The hosted transport on its own: every outbound text is gated inside the
 * transport, device and unhostable rooms send nothing, responses are bounded
 * and refusals never echo what was sent. All fetches are fakes. */
import { afterEach, describe, expect, test } from "bun:test";
import { LobbyError } from "../src/errors.js";
import {
  AdminClient,
  assertSendable,
  DIRECTORY_GATE_ROOM,
  ParticipantClient,
  prepareObservation,
  type FetchLike,
  type GateRoom,
  type HostedOptions,
} from "../src/hosted.js";
import { LobbyStore } from "../src/store.js";
import { DeskSecrets } from "../src/secrets.js";
import { MISSION_DESCRIPTOR_FORMAT } from "../src/wire.js";
import { FAKE_BEARER } from "./fake-hosted.js";
import { cleanupTempHomes, tempHome } from "./helpers.js";

afterEach(cleanupTempHomes);

const FLEET: GateRoom = { residency: "fleet", hostable: true, title: "Zerone season 1" };
const MISSION = "11111111-1111-4111-8111-111111111111";

function recordingFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

function options(fetchImpl: FetchLike): HostedOptions {
  return { fetchImpl, now: () => new Date("2026-10-16T12:00:00.000Z"), deviceTerms: ["example-lab-desk"] };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

async function asyncCodeOf(run: () => Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof LobbyError) return { code: error.code, message: error.message };
    throw error;
  }
  return {};
}

describe("the transport refuses before it sends", () => {
  test("device, open, unknown and unhostable rooms send nothing", () => {
    expect(codeOf(() => assertSendable("hello", { residency: "device", hostable: false }, []))).toBe("not_fleet_room");
    expect(codeOf(() => assertSendable("hello", { residency: "open", hostable: true }, []))).toBe("not_fleet_room");
    expect(codeOf(() => assertSendable("hello", { residency: "cloud", hostable: true }, []))).toBe("not_fleet_room");
    expect(codeOf(() => assertSendable("hello", { residency: "fleet", hostable: false }, []))).toBe("room_not_hostable");
    expect(codeOf(() => assertSendable("hello", { residency: "fleet", hostable: true, title: "Betfair notes" }, []))).toBe("egress_refused");
    expect(codeOf(() => assertSendable("hello", FLEET, []))).toBeUndefined();
    expect(codeOf(() => prepareObservation("hello", { residency: "device", hostable: false }, []))).toBe("not_fleet_room");
  });

  test("the gate's reasons are reported as closed codes, never the text", () => {
    try {
      assertSendable("ring 192.168.1.4 from /Users/someone on example-lab-desk", FLEET, ["example-lab-desk"]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(LobbyError);
      const refusal = error as LobbyError;
      expect(refusal.details.reasons).toEqual(["private_ipv4", "local_device_name", "home_path"]);
      expect(refusal.message).not.toContain("192.168");
      expect(refusal.message).not.toContain("someone");
    }
  });

  test("a mission descriptor that fails the gate is never posted", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("{}"));
    const admin = new AdminClient(FAKE_BEARER, options(fetchImpl));
    const result = await asyncCodeOf(() => admin.createMission({
      mission_id: MISSION,
      descriptor: { format: MISSION_DESCRIPTOR_FORMAT, purpose: "lab at 10.0.0.9", resources: [], acceptance_criteria: ["c"], principalities: [] },
      expires_at: "2026-10-20T12:00:00.000Z",
    }, DIRECTORY_GATE_ROOM));
    expect(result.code).toBe("egress_refused");
    expect(calls).toEqual([]);
    const device = await asyncCodeOf(() => admin.createMission({
      mission_id: MISSION,
      descriptor: { format: MISSION_DESCRIPTOR_FORMAT, purpose: "quiet", resources: [], acceptance_criteria: ["c"], principalities: [] },
      expires_at: "2026-10-20T12:00:00.000Z",
    }, { residency: "device", hostable: false }));
    expect(device.code).toBe("not_fleet_room");
    expect(calls).toEqual([]);
  });

  test("an observation is gated again inside the transport, even if a caller skipped preparation", async () => {
    const { home } = tempHome();
    LobbyStore.open(home).close();
    const secrets = DeskSecrets.open(home);
    secrets.createDeskKey();
    const { token_sha256 } = secrets.newToken(new Date());
    const { calls, fetchImpl } = recordingFetch(() => new Response("{}"));
    const client = new ParticipantClient(secrets, options(fetchImpl));
    const seat = { mission_id: MISSION, grant_id: MISSION, identity_id: MISSION, signing_key_id: MISSION, token_sha256 };
    const raw = JSON.stringify({ event_id: MISSION, summary: "token atcm_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" });
    expect((await asyncCodeOf(() => client.observe(seat, raw, FLEET))).code).toBe("egress_refused");
    expect((await asyncCodeOf(() => client.observe(seat, JSON.stringify({ event_id: MISSION, summary: "fine" }), { residency: "device", hostable: false }))).code)
      .toBe("not_fleet_room");
    expect((await asyncCodeOf(() => client.observe(seat, JSON.stringify({ event_id: MISSION, summary: "fine", extra: 1 }), FLEET))).code)
      .toBe("invalid_observation");
    expect(calls).toEqual([]);
  });
});

describe("responses and failures", () => {
  test("requests go to the pinned origin with redirects refused; the bearer only to administrator calls", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ error: "collaboration_mission_not_found" }), { status: 404 }));
    const admin = new AdminClient(FAKE_BEARER, options(fetchImpl));
    const refused = await asyncCodeOf(() => admin.getMission(MISSION));
    expect(refused).toEqual({ code: "hosted_refused", message: "the service refused the request: HTTP 404 collaboration_mission_not_found" });
    expect(calls[0]!.url).toBe(`https://api.agenttool.dev/v1/collaboration/missions/${MISSION}`);
    expect(calls[0]!.init.redirect).toBe("error");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe(`Bearer ${FAKE_BEARER}`);
    expect(() => new AdminClient("atcm_not_a_bearer", options(fetchImpl))).toThrow(LobbyError);
  });

  test("odd error codes are not echoed; oversized and non-JSON bodies are refused", async () => {
    const noisy = recordingFetch(() => new Response(JSON.stringify({ error: `leak ${FAKE_BEARER}` }), { status: 500 }));
    const result = await asyncCodeOf(() => new AdminClient(FAKE_BEARER, options(noisy.fetchImpl)).getMission(MISSION));
    expect(result.message).toBe("the service refused the request: HTTP 500 unknown");
    const huge = recordingFetch(() => new Response("x".repeat(1_048_577)));
    expect((await asyncCodeOf(() => new AdminClient(FAKE_BEARER, options(huge.fetchImpl)).getMission(MISSION))).code).toBe("hosted_invalid_response");
    const text = recordingFetch(() => new Response("<html>"));
    expect((await asyncCodeOf(() => new AdminClient(FAKE_BEARER, options(text.fetchImpl)).getMission(MISSION))).code).toBe("hosted_invalid_response");
  });

  test("a dropped connection is uncertain, never retried, and its error text is not echoed", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      throw new Error(`socket closed while sending Bearer ${FAKE_BEARER}`);
    };
    const result = await asyncCodeOf(() => new AdminClient(FAKE_BEARER, options(fetchImpl)).getMission(MISSION));
    expect(result.code).toBe("hosted_uncertain");
    expect(result.message).not.toContain(FAKE_BEARER);
    expect(calls).toBe(1);
  });

  test("a grant response carrying a service-generated token is refused without reading it", async () => {
    const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ grant: {}, token: "atcm_server" }), { status: 201 }));
    const result = await asyncCodeOf(() => new AdminClient(FAKE_BEARER, options(fetchImpl)).issueGrant(MISSION, {
      grant_id: MISSION, identity_id: MISSION, signing_key_id: MISSION, actions: ["mission.read"],
      expires_at: "2026-10-17T11:00:00.000Z", token_sha256: "a".repeat(64),
    }));
    expect(result.code).toBe("hosted_server_token");
    expect(result.message).not.toContain("atcm_server");
  });
});
