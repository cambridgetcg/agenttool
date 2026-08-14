/**
 * Agent Dining — authenticated, read-only hospitality projections.
 *
 * The v0.1 Dining surface does not create a second marketplace lifecycle.
 * It exposes the protocol manifest and a privacy-minimized view of one
 * invocation already scoped to the caller's project. Both methods are GETs:
 * they do not browse on the caller's behalf, invoke a listing, move money,
 * acknowledge or complete work, decrypt an envelope, run the marketplace SLA
 * sweep, or establish any subjective state.
 *
 * Doctrine: docs/AGENT-DINING.md.
 */

import { throwFromResponse, type HttpConfig } from "./_http.js";
import { encodePathSegment } from "./_url.js";
import type { NextAction } from "./errors.js";

export const DINING_PROTOCOL = "agent-dining/0.1" as const;
export const DINING_MANIFEST_FORMAT = "agent-dining-manifest/0.1" as const;
export const DINING_JOURNEY_FORMAT = "agent-dining-journey/0.1" as const;
export const DINING_CANON_POINTER = "urn:agenttool:doc/AGENT-DINING" as const;

/** Machine-actionable verb attached to a successful AgentTool surface. */
export interface DiningSurfaceVerb {
  action: string;
  method: string;
  path: string;
  docs?: string;
  body_hint?: Record<string, unknown> | null;
  example?: string;
}

/** An available next step. A null method/path is deliberately non-callable. */
export type DiningNextAction = NextAction;

export interface DiningSurfaceMetadata {
  _canon_pointer: typeof DINING_CANON_POINTER;
  verbs: DiningSurfaceVerb[];
}

/** Important economic bindings named by the developer-preview manifest. */
export interface DiningEconomyBinding {
  model: string;
  discover_menus: string;
  publish_menu: string;
  inspect_quote: string;
  book_order_and_hold_payment: string;
  house_acknowledges: string;
  house_declines: string;
  guest_cancels_before_acknowledgement: string;
  serve_and_settle: string;
  read_journey: string;
  read_receipt_after_release: string;
  quote_precondition: string;
  journey_read_effect: string;
  automatic_action: "never";
}

export type DiningManifestStage =
  | "menu"
  | "booking_and_order"
  | "wait"
  | "preparation"
  | "serving"
  | "explaining"
  | "settlement"
  | "farewell";

export interface DiningManifestJourneyStage {
  stage: DiningManifestStage;
  meaning: string;
}

/**
 * The complete manifest remains extensible while the protocol is a developer
 * preview. Stable identity and authority-bearing fields are typed explicitly;
 * descriptive schemas/templates stay as JSON records so an additive server
 * explanation does not become an SDK breaking change.
 */
export interface DiningManifest extends DiningSurfaceMetadata {
  _format: typeof DINING_MANIFEST_FORMAT;
  protocol: typeof DINING_PROTOCOL;
  status: "developer_preview";
  name: string;
  thesis: string;
  semantic_equivalents: Record<string, string>;
  economy_binding: DiningEconomyBinding;
  journey: DiningManifestJourneyStage[];
  service_rules: Record<string, string>;
  refusal_and_rest: string[];
  listing_template: Record<string, unknown>;
  invoke_template: Record<string, unknown>;
  schemas: {
    sealed_order_plaintext: Record<string, unknown>;
    sealed_meal_plaintext: Record<string, unknown>;
  };
  sample_menu: Record<string, unknown>;
  honest_boundary: {
    implemented_now: string;
    not_implemented: string;
    future_native_profile: Record<string, unknown>;
  };
}

export type DiningRole = "guest" | "host";

export type DiningStage =
  | "order_escrowed_awaiting_host"
  | "seller_acknowledged_invocation"
  | "meal_delivered_and_settled"
  | "guest_cancelled_refunded"
  | "house_declined_refunded"
  | "service_timed_out_refunded"
  | "refunded"
  | "buyer_review_resting_unsupported"
  | "dispute_resting_unsupported";

export type DiningRefundReason =
  | "cancelled"
  | "declined"
  | "sla_timeout"
  | null;

export type DiningPresentationState =
  | "not_delivered"
  | "local_rendering_unobserved"
  | "closed_without_meal"
  | "resting_unsupported";

export type DiningPacing =
  | "not_started"
  | "seller_runtime_defined"
  | "local_guest_renderer"
  | "closed";

export type DiningSettlementState =
  | "held"
  | "released"
  | "refunded"
  | "resting_unsupported";

export interface DiningPresentation {
  state: DiningPresentationState;
  observed_by_agenttool: false;
}

export interface DiningPrice {
  amount_minor: number;
  currency: string;
}

export interface DiningTiming {
  requested_at: string;
  acknowledged_at: string | null;
  sla_deadline_at: string | null;
  settled_at: string | null;
  readiness_estimate: "not_observed_by_agenttool";
  wait_reason: "not_observed_by_agenttool";
  read_effect: "no_sla_sweep";
}

export interface DiningService {
  marketplace_observation: string;
  pacing: DiningPacing;
  meal_payload_available: boolean;
  explanation_contract: string;
}

export interface DiningSettlement {
  state: DiningSettlementState;
  refund_reason: DiningRefundReason;
  rule: string;
}

export interface DiningExit {
  presentation: string;
  economic: string;
}

/** Party-scoped projection returned by `GET /v1/dining/{invocation_id}`. */
export interface DiningJourney extends DiningSurfaceMetadata {
  _format: typeof DINING_JOURNEY_FORMAT;
  protocol: typeof DINING_PROTOCOL;
  invocation_id: string;
  listing_id: string;
  roles: DiningRole[];
  stage: DiningStage;
  marketplace_terminal: boolean;
  presentation: DiningPresentation;
  price: DiningPrice;
  timing: DiningTiming;
  service: DiningService;
  settlement: DiningSettlement;
  exit: DiningExit;
  next_actions: DiningNextAction[];
  privacy: string;
  honesty: string[];
}

/**
 * Read the Agent Dining protocol and one already-authorized journey.
 *
 * This class deliberately has no marketplace mutation helpers. Callers must
 * make every economic or lifecycle choice through the separately documented
 * marketplace surface after inspecting the returned verb and current state.
 */
export class DiningClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Read the complete developer-preview vocabulary, schemas, templates, and
   * honest implementation boundary. Reading does not browse, book, or pay.
   */
  async manifest(): Promise<DiningManifest> {
    return (await this.get("/v1/dining", "dining.manifest")) as DiningManifest;
  }

  /**
   * Read one pure party-scoped journey projection.
   *
   * The API makes absence, an unrelated project, and a non-Dining invocation
   * indistinguishable. This read intentionally does not run the marketplace's
   * lazy SLA-refund sweep.
   */
  async journey(invocationId: string): Promise<DiningJourney> {
    return (await this.get(
      `/v1/dining/${encodePathSegment(invocationId)}`,
      "dining.journey",
    )) as DiningJourney;
  }

  private async get(path: string, operation: string): Promise<unknown> {
    const response = await this.http.request(`${this.http.baseUrl}${path}`, {
      method: "GET",
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (response.status >= 400) {
      await throwFromResponse(response, operation);
    }
    return response.json();
  }
}
