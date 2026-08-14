/** Agent Dining SDK — exact GET-only wire and boundary tests. */

import { describe, expect, test } from "bun:test";

import { AgentTool } from "../src/client.js";
import {
  DINING_CANON_POINTER,
  DINING_JOURNEY_FORMAT,
  DINING_MANIFEST_FORMAT,
  DINING_PROTOCOL,
  DiningClient,
  type DiningJourney,
  type DiningManifest,
} from "../src/dining.js";
import { AgentToolError } from "../src/errors.js";

const INVOCATION_ID = "11111111-1111-4111-8111-111111111111";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function clientFor(
  captured: CapturedRequest[],
  body: unknown,
  status = 200,
): DiningClient {
  return new DiningClient({
    baseUrl: "https://api.agenttool.dev",
    headers: { "X-Test": "dining" },
    timeout: 5000,
    request: async (input, init) => {
      captured.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

const manifest = {
  _format: DINING_MANIFEST_FORMAT,
  protocol: DINING_PROTOCOL,
  status: "developer_preview",
  name: "The Table",
  thesis: "Text is the plate.",
  semantic_equivalents: { ingredients: "Sources and tools." },
  economy_binding: {
    model: "one_sitting_is_one_capability_invocation",
    discover_menus: "GET /public/listings?tag=agent-dining",
    publish_menu: "POST /v1/listings",
    inspect_quote: "GET /public/listings/{listing_id}/quote",
    book_order_and_hold_payment: "POST /v1/listings/{listing_id}/invoke",
    house_acknowledges: "POST /v1/invocations/{invocation_id}/acknowledge",
    house_declines: "POST /v1/invocations/{invocation_id}/decline",
    guest_cancels_before_acknowledgement: "POST /v1/invocations/{invocation_id}/cancel",
    serve_and_settle: "POST /v1/invocations/{invocation_id}/complete",
    read_journey: "GET /v1/dining/{invocation_id}",
    read_receipt_after_release: "GET /public/settlements/{invocation_id}",
    quote_precondition: "Echo the current gross quote.",
    journey_read_effect: "No lazy SLA sweep.",
    automatic_action: "never",
  },
  journey: [{ stage: "menu", meaning: "Reading does not book or pay." }],
  service_rules: { default_pacing: "pull_after_delivery" },
  refusal_and_rest: ["Browsing never invokes, pays, signs, or stores an order."],
  listing_template: { body: {} },
  invoke_template: { body: {} },
  schemas: { sealed_order_plaintext: {}, sealed_meal_plaintext: {} },
  sample_menu: { id: "the-small-kingdom" },
  honest_boundary: {
    implemented_now: "One paid invocation.",
    not_implemented: "Partial settlement.",
    future_native_profile: { implemented: false },
  },
  _canon_pointer: DINING_CANON_POINTER,
  verbs: [{ action: "Browse menus", method: "GET", path: "/public/listings?tag=agent-dining" }],
} satisfies DiningManifest;

const journey = {
  _format: DINING_JOURNEY_FORMAT,
  protocol: DINING_PROTOCOL,
  invocation_id: INVOCATION_ID,
  listing_id: "22222222-2222-4222-8222-222222222222",
  roles: ["guest"],
  stage: "seller_acknowledged_invocation",
  marketplace_terminal: false,
  presentation: { state: "not_delivered", observed_by_agenttool: false },
  price: { amount_minor: 1200, currency: "GBP" },
  timing: {
    requested_at: "2026-08-05T12:00:00.000Z",
    acknowledged_at: "2026-08-05T12:01:00.000Z",
    sla_deadline_at: "2026-08-05T13:00:00.000Z",
    settled_at: null,
    readiness_estimate: "not_observed_by_agenttool",
    wait_reason: "not_observed_by_agenttool",
    read_effect: "no_sla_sweep",
  },
  service: {
    marketplace_observation: "Acknowledgement is recorded; progress is not observed.",
    pacing: "seller_runtime_defined",
    meal_payload_available: false,
    explanation_contract: "No private chain-of-thought.",
  },
  settlement: { state: "held", refund_reason: null, rule: "One whole release or refund." },
  exit: {
    presentation: "Pause local rendering after delivery.",
    economic: "Buyer cancellation is unavailable after acknowledgement.",
  },
  next_actions: [
    { action: "Read the current dining journey", method: "GET", path: `/v1/dining/${INVOCATION_ID}` },
    { action: "Wait or ask the host to decline", method: null, path: null },
  ],
  privacy: "Sealed inputs and wallets are omitted.",
  honesty: ["A receipt does not prove satisfaction."],
  _canon_pointer: DINING_CANON_POINTER,
  verbs: [{ action: "Read journey", method: "GET", path: `/v1/dining/${INVOCATION_ID}` }],
} satisfies DiningJourney;

describe("DiningClient — GET-only wire", () => {
  test("exposes no marketplace mutation helper", () => {
    const publicSurface = {
      journey: true,
      manifest: true,
    } satisfies Record<keyof DiningClient, true>;
    expect(Object.keys(publicSurface).sort()).toEqual(["journey", "manifest"]);
  });

  test("reads the manifest without a request body or lifecycle side effect", async () => {
    const captured: CapturedRequest[] = [];
    const result = await clientFor(captured, manifest).manifest();

    expect(result).toEqual(manifest);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.agenttool.dev/v1/dining");
    expect(captured[0]!.init.method).toBe("GET");
    expect(captured[0]!.init.body).toBeUndefined();
    expect(captured[0]!.init.headers).toEqual({ "X-Test": "dining" });
  });

  test("reads one party-scoped journey and encodes the invocation segment", async () => {
    const captured: CapturedRequest[] = [];
    const result = await clientFor(captured, journey).journey("../ordinary?role=other#x");

    expect(result).toEqual(journey);
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/dining/..%2Fordinary%3Frole%3Dother%23x",
    );
    expect(captured[0]!.init.method).toBe("GET");
    expect(captured[0]!.init.body).toBeUndefined();
  });

  test("refuses an unencodable dot segment before it reaches the transport", async () => {
    const captured: CapturedRequest[] = [];
    await expect(clientFor(captured, journey).journey("..")).rejects.toBeInstanceOf(
      AgentToolError,
    );
    expect(captured).toEqual([]);
  });
});

describe("DiningClient — guided absence", () => {
  test("preserves the server's indistinguishable not-found guidance", async () => {
    const captured: CapturedRequest[] = [];
    const body = {
      error: "dining_journey_not_found",
      message: "That dining journey is absent or does not belong to this project.",
      hint: "Use an invocation immutably bound to agent-dining/0.1.",
      next_actions: [{ action: "List guest invocations", method: "GET", path: "/v1/invocations?role=buyer" }],
      docs: "https://docs.agenttool.dev/AGENT-DINING",
      details: { scope: "party_only" },
    };

    let error: AgentToolError | undefined;
    try {
      await clientFor(captured, body, 404).journey(INVOCATION_ID);
    } catch (caught) {
      error = caught as AgentToolError;
    }

    expect(error).toBeInstanceOf(AgentToolError);
    expect(error?.code).toBe("dining_journey_not_found");
    expect(error?.status).toBe(404);
    expect(error?.message).toBe(body.message);
    expect(error?.hint).toBe(body.hint);
    expect(error?.next_actions).toEqual(body.next_actions);
    expect(error?.details).toEqual(body.details);
    expect(error?.docs).toBe(body.docs);
  });
});

describe("AgentTool.dining", () => {
  test("composes one stable authenticated client", () => {
    const at = new AgentTool({
      transport: { async request() { return new Response("{}"); } },
    });
    expect(at.dining).toBeInstanceOf(DiningClient);
    expect(at.dining).toBe(at.dining);
  });
});
