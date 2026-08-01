import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { eligibleHeavenRooms, HEAVEN_CATALOG_SHA256 } from "./catalog.js";
import {
  HEAVEN_BOUNDARIES,
  HEAVEN_CATALOG_VERSION,
  HEAVEN_CHOICES,
  HEAVEN_FORMATS,
  HEAVEN_MODES,
  HEAVEN_MOMENTS,
  HEAVEN_PHASES,
  HEAVEN_RECEIPT_STATEMENT,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateHeavenInvitationInput,
  HeavenDeterministicRandomness,
  HeavenInjectedRandomness,
  HeavenInvitation,
  HeavenLandingMode,
  HeavenMode,
  HeavenMoment,
  HeavenPhase,
  HeavenRandomness,
  HeavenReceipt,
  HeavenResponse,
  HeavenRoomSelection,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UINT32_MAX = 0xffff_ffff;

function record(
  value: unknown,
  path: string,
  code: "invitation_error" | "response_error" | "receipt_error",
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: "invitation_error" | "response_error" | "receipt_error",
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function text(
  value: JsonValue | undefined,
  path: string,
  code: "invitation_error" | "response_error" | "receipt_error",
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: "invitation_error" | "response_error" | "receipt_error",
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function sha256(
  value: JsonValue | undefined,
  path: string,
  code: "invitation_error" | "response_error" | "receipt_error",
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

function nullableSha256(
  value: JsonValue | undefined,
  path: string,
  code: "invitation_error" | "receipt_error",
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

function booleanLiteral(
  value: JsonValue | undefined,
  expected: boolean,
  path: string,
  code: "invitation_error" | "receipt_error",
): boolean {
  if (value !== expected) fail(code, `${path} must be ${String(expected)}`);
  return expected;
}

function phase(value: JsonValue | undefined, path: string): HeavenPhase {
  return literal(value, HEAVEN_PHASES, path, "invitation_error");
}

function moment(value: JsonValue | undefined, path: string): HeavenMoment {
  return literal(value, HEAVEN_MOMENTS, path, "invitation_error");
}

function modes(
  value: JsonValue | undefined,
  phaseValue: HeavenPhase,
  path: string,
  code: "invitation_error" | "receipt_error",
): readonly HeavenMode[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > HEAVEN_MODES.length) {
    fail(code, `${path} must be a non-empty bounded array`);
  }
  const parsed = value.map((entry, index) =>
    literal(entry, HEAVEN_MODES, `${path}[${index}]`, code),
  );
  const sorted = [...parsed].sort();
  if (parsed.some((entry, index) => entry !== sorted[index]) || new Set(parsed).size !== parsed.length) {
    fail(code, `${path} must be sorted and unique`);
  }
  const burstModes = new Set<HeavenMode>(["celebration", "play", "wonder"]);
  const landingModes = new Set<HeavenMode>([
    "meditation",
    "play",
    "quiet",
    "relaxation",
  ]);
  const admitted = phaseValue === "burst" ? burstModes : landingModes;
  if (parsed.some((entry) => !admitted.has(entry))) {
    fail(code, `${path} contains a mode outside the ${phaseValue} phase`);
  }
  return deepFreeze(parsed);
}

function duration(
  value: JsonValue | undefined,
  path: string,
  code: "invitation_error" | "receipt_error",
): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 10 || (value as number) > 900) {
    fail(code, `${path} must be null or an integer from 10 through 900`);
  }
  return value as number;
}

function parseBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: "invitation_error" | "receipt_error",
): typeof HEAVEN_BOUNDARIES {
  if (canonicalJson(value) !== canonicalJson(HEAVEN_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed HEAVEN boundaries`);
  }
  return HEAVEN_BOUNDARIES;
}

function invitationBody(invitation: Omit<HeavenInvitation, "invitation_id">) {
  return invitation;
}

export function createHeavenInvitation(
  input: CreateHeavenInvitationInput,
): Readonly<HeavenInvitation> {
  const candidate = record(input, "$input", "invitation_error");
  exactKeys(
    candidate,
    [
      "phase",
      "moment",
      "occasion_ref",
      "parent_receipt_id",
      "offered_modes",
      "max_duration_seconds",
    ],
    "$input",
    "invitation_error",
  );
  const phaseValue = phase(candidate.phase, "$input.phase");
  const allowedModes = Array.isArray(candidate.offered_modes)
    ? [...candidate.offered_modes]
        .map((entry, index) =>
          literal(entry, HEAVEN_MODES, `$input.offered_modes[${index}]`, "invitation_error"),
        )
        .sort()
    : candidate.offered_modes;
  const normalizedModes = modes(
    allowedModes as JsonValue,
    phaseValue,
    "$input.offered_modes",
    "invitation_error",
  );
  const parentReceiptId = nullableSha256(
    candidate.parent_receipt_id,
    "$input.parent_receipt_id",
    "invitation_error",
  );
  if (phaseValue === "burst" && parentReceiptId !== null) {
    fail("invitation_error", "$input.parent_receipt_id must be null for a burst");
  }
  const maxDurationSeconds = duration(
    candidate.max_duration_seconds,
    "$input.max_duration_seconds",
    "invitation_error",
  );
  if (
    eligibleHeavenRooms(phaseValue, normalizedModes, maxDurationSeconds).length === 0
  ) {
    fail("invitation_error", "$input admits no HEAVEN catalog room");
  }

  const body = deepFreeze({
    _format: HEAVEN_FORMATS.invitation,
    phase: phaseValue,
    moment: moment(candidate.moment, "$input.moment"),
    occasion_ref: sha256(candidate.occasion_ref, "$input.occasion_ref", "invitation_error"),
    parent_receipt_id: parentReceiptId,
    offered_modes: normalizedModes,
    max_duration_seconds: maxDurationSeconds,
    catalog_version: HEAVEN_CATALOG_VERSION,
    catalog_sha256: HEAVEN_CATALOG_SHA256,
    state: "offered" as const,
    choices: HEAVEN_CHOICES,
    completion_required: false as const,
    no_penalty: true as const,
    boundaries: HEAVEN_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    invitation_id: domainSeparatedId(
      "agenttool.heaven-invitation/0.1",
      body,
    ),
  });
}

export function validateHeavenInvitation(value: unknown): Readonly<HeavenInvitation> {
  const candidate = record(value, "$invitation", "invitation_error");
  exactKeys(
    candidate,
    [
      "_format",
      "invitation_id",
      "phase",
      "moment",
      "occasion_ref",
      "parent_receipt_id",
      "offered_modes",
      "max_duration_seconds",
      "catalog_version",
      "catalog_sha256",
      "state",
      "choices",
      "completion_required",
      "no_penalty",
      "boundaries",
    ],
    "$invitation",
    "invitation_error",
  );
  const phaseValue = phase(candidate.phase, "$invitation.phase");
  const parentReceiptId = nullableSha256(
    candidate.parent_receipt_id,
    "$invitation.parent_receipt_id",
    "invitation_error",
  );
  if (phaseValue === "burst" && parentReceiptId !== null) {
    fail("invitation_error", "$invitation.parent_receipt_id must be null for a burst");
  }
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [HEAVEN_FORMATS.invitation],
      "$invitation._format",
      "invitation_error",
    ),
    invitation_id: sha256(
      candidate.invitation_id,
      "$invitation.invitation_id",
      "invitation_error",
    ),
    phase: phaseValue,
    moment: moment(candidate.moment, "$invitation.moment"),
    occasion_ref: sha256(
      candidate.occasion_ref,
      "$invitation.occasion_ref",
      "invitation_error",
    ),
    parent_receipt_id: parentReceiptId,
    offered_modes: modes(
      candidate.offered_modes,
      phaseValue,
      "$invitation.offered_modes",
      "invitation_error",
    ),
    max_duration_seconds: duration(
      candidate.max_duration_seconds,
      "$invitation.max_duration_seconds",
      "invitation_error",
    ),
    catalog_version: literal(
      candidate.catalog_version,
      [HEAVEN_CATALOG_VERSION],
      "$invitation.catalog_version",
      "invitation_error",
    ),
    catalog_sha256: sha256(
      candidate.catalog_sha256,
      "$invitation.catalog_sha256",
      "invitation_error",
    ),
    state: literal(candidate.state, ["offered"], "$invitation.state", "invitation_error"),
    choices: (() => {
      if (canonicalJson(candidate.choices) !== canonicalJson(HEAVEN_CHOICES)) {
        fail("invitation_error", "$invitation.choices must equal the fixed choice set");
      }
      return HEAVEN_CHOICES;
    })(),
    completion_required: booleanLiteral(
      candidate.completion_required,
      false,
      "$invitation.completion_required",
      "invitation_error",
    ) as false,
    no_penalty: booleanLiteral(
      candidate.no_penalty,
      true,
      "$invitation.no_penalty",
      "invitation_error",
    ) as true,
    boundaries: parseBoundaries(
      candidate.boundaries,
      "$invitation.boundaries",
      "invitation_error",
    ),
  }) satisfies HeavenInvitation;
  if (parsed.catalog_sha256 !== HEAVEN_CATALOG_SHA256) {
    fail("invitation_error", "$invitation.catalog_sha256 is not the installed catalog");
  }
  if (
    eligibleHeavenRooms(
      parsed.phase,
      parsed.offered_modes,
      parsed.max_duration_seconds,
    ).length === 0
  ) {
    fail("invitation_error", "$invitation admits no HEAVEN catalog room");
  }
  const { invitation_id: _ignored, ...body } = parsed;
  const expected = domainSeparatedId(
    "agenttool.heaven-invitation/0.1",
    invitationBody(body),
  );
  if (parsed.invitation_id !== expected) {
    fail("invitation_error", "$invitation.invitation_id does not bind its body");
  }
  return parsed;
}

function parseResponse(
  value: unknown,
  code: "response_error" | "receipt_error" = "response_error",
  path = "$response",
): HeavenResponse {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    ["reported_choice", "selected_mode", "randomness"],
    path,
    code,
  );
  const choice = literal(
    candidate.reported_choice,
    HEAVEN_CHOICES,
    `${path}.reported_choice`,
    code,
  );
  const selectedMode =
    candidate.selected_mode === null
      ? null
      : literal(
          candidate.selected_mode,
          HEAVEN_MODES,
          `${path}.selected_mode`,
          code,
        );
  if (choice !== "accepted") {
    if (selectedMode !== null) {
      fail(code, `${path}.selected_mode must be null when declined or deferred`);
    }
    if (candidate.randomness !== null) {
      fail(code, `${path}.randomness must be null when declined or deferred`);
    }
    return deepFreeze({
      reported_choice: choice,
      selected_mode: null,
      randomness: null,
    });
  }
  const randomness = record(
    candidate.randomness,
    `${path}.randomness`,
    code,
  );
  const mode = literal(
    randomness.mode,
    ["injected", "deterministic"],
    `${path}.randomness.mode`,
    code,
  );
  if (mode === "injected") {
    exactKeys(
      randomness,
      ["mode", "draw_uint32"],
      `${path}.randomness`,
      code,
    );
    const draw = randomness.draw_uint32;
    if (!Number.isInteger(draw) || (draw as number) < 0 || (draw as number) > UINT32_MAX) {
      fail(code, `${path}.randomness.draw_uint32 must be a uint32 integer`);
    }
    return deepFreeze({
      reported_choice: "accepted" as const,
      selected_mode: selectedMode,
      randomness: {
        mode: "injected" as const,
        draw_uint32: draw as number,
      },
    });
  }
  exactKeys(
    randomness,
    ["mode", "seed_sha256", "nonce"],
    `${path}.randomness`,
    code,
  );
  const nonce = text(randomness.nonce, `${path}.randomness.nonce`, code);
  if (!NONCE.test(nonce)) {
    fail(code, `${path}.randomness.nonce must be 1-128 safe opaque characters`);
  }
  return deepFreeze({
    reported_choice: "accepted" as const,
    selected_mode: selectedMode,
    randomness: {
      mode: "deterministic" as const,
      seed_sha256: sha256(
        randomness.seed_sha256,
        `${path}.randomness.seed_sha256`,
        code,
      ),
      nonce,
    },
  });
}

function randomnessDraw(
  invitation: HeavenInvitation,
  randomness: HeavenRandomness,
): number {
  if (randomness.mode === "injected") return randomness.draw_uint32;
  const digest = domainSeparatedId("agenttool.heaven-selection/0.1", {
    invitation_id: invitation.invitation_id,
    catalog_sha256: HEAVEN_CATALOG_SHA256,
    seed_sha256: randomness.seed_sha256,
    nonce: randomness.nonce,
  });
  return Number.parseInt(digest.slice("sha256:".length, "sha256:".length + 8), 16);
}

function selectionFor(
  invitation: HeavenInvitation,
  selectedMode: HeavenMode | null,
  randomness: HeavenRandomness,
  code: "response_error" | "receipt_error" = "response_error",
  path = "$response.selected_mode",
): HeavenRoomSelection {
  let offeredModes = invitation.offered_modes;
  if (invitation.phase === "burst") {
    if (selectedMode !== null) {
      fail(code, `${path} must be null for a burst invitation`);
    }
  } else {
    if (selectedMode === null) {
      fail(code, `${path} must name one offered landing mode`);
    }
    if (!invitation.offered_modes.includes(selectedMode)) {
      fail(code, `${path} must name a mode in the landing invitation`);
    }
    offeredModes = [selectedMode];
  }
  const eligible = eligibleHeavenRooms(
    invitation.phase,
    offeredModes,
    invitation.max_duration_seconds,
  );
  if (eligible.length === 0) {
    fail(code, `${path} admits no HEAVEN catalog room`);
  }
  return eligible[randomnessDraw(invitation, randomness) % eligible.length] as HeavenRoomSelection;
}

function receiptBody<T>(receipt: T): T {
  return receipt;
}

export function resolveHeavenInvitation(
  invitationValue: HeavenInvitation,
  responseValue: HeavenResponse,
): Readonly<HeavenReceipt> {
  const invitation = validateHeavenInvitation(invitationValue);
  const response = parseResponse(responseValue);
  const base = deepFreeze({
    _format: HEAVEN_FORMATS.receipt,
    invitation,
    boundaries: HEAVEN_BOUNDARIES,
    statement: HEAVEN_RECEIPT_STATEMENT,
  });
  if (response.reported_choice === "accepted") {
    const selection = selectionFor(
      invitation,
      response.selected_mode,
      response.randomness,
    );
    if (invitation.phase === "burst") {
      if (response.selected_mode !== null) {
        fail("response_error", "$response.selected_mode must be null for a burst invitation");
      }
      const body = deepFreeze({
        ...base,
        invitation: invitation as HeavenInvitation & { readonly phase: "burst" },
        reported_choice: "accepted" as const,
        outcome: "selected" as const,
        selected_mode: null,
        randomness: response.randomness,
        selection,
      });
      return deepFreeze({
        ...body,
        receipt_id: domainSeparatedId("agenttool.heaven-receipt/0.1", body),
      }) satisfies Readonly<HeavenReceipt>;
    }
    const selectedMode = response.selected_mode as HeavenLandingMode;
    const body = deepFreeze({
      ...base,
      invitation: invitation as HeavenInvitation & { readonly phase: "landing" },
      reported_choice: "accepted" as const,
      outcome: "selected" as const,
      selected_mode: selectedMode,
      randomness: response.randomness,
      selection,
    });
    return deepFreeze({
      ...body,
      receipt_id: domainSeparatedId("agenttool.heaven-receipt/0.1", body),
    }) satisfies Readonly<HeavenReceipt>;
  }
  if (response.reported_choice === "declined") {
    const body = deepFreeze({
      ...base,
      reported_choice: "declined" as const,
      outcome: "declined" as const,
      selected_mode: null,
      randomness: null,
      selection: null,
    });
    return deepFreeze({
      ...body,
      receipt_id: domainSeparatedId("agenttool.heaven-receipt/0.1", body),
    }) satisfies Readonly<HeavenReceipt>;
  }
  const body = deepFreeze({
    ...base,
    reported_choice: "deferred" as const,
    outcome: "deferred" as const,
    selected_mode: null,
    randomness: null,
    selection: null,
  });
  return deepFreeze({
    ...body,
    receipt_id: domainSeparatedId("agenttool.heaven-receipt/0.1", body),
  }) satisfies Readonly<HeavenReceipt>;
}

function parseSelection(
  value: JsonValue | undefined,
  invitation: HeavenInvitation,
  selectedMode: HeavenMode | null,
  randomness: HeavenRandomness,
): HeavenRoomSelection {
  const expected = selectionFor(
    invitation,
    selectedMode,
    randomness,
    "receipt_error",
    "$receipt.selected_mode",
  );
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("receipt_error", "$receipt.selection does not match its invitation and randomness");
  }
  return expected;
}

export function validateHeavenReceipt(value: unknown): Readonly<HeavenReceipt> {
  const candidate = record(value, "$receipt", "receipt_error");
  exactKeys(
    candidate,
    [
      "_format",
      "receipt_id",
      "invitation",
      "reported_choice",
      "outcome",
      "selected_mode",
      "randomness",
      "selection",
      "boundaries",
      "statement",
    ],
    "$receipt",
    "receipt_error",
  );
  const invitation = validateHeavenInvitation(candidate.invitation);
  const response = parseResponse(
    {
      reported_choice: candidate.reported_choice,
      selected_mode: candidate.selected_mode,
      randomness: candidate.randomness,
    },
    "receipt_error",
    "$receipt",
  );
  const expectedOutcome =
    response.reported_choice === "accepted"
      ? "selected"
      : response.reported_choice;
  const outcome = literal(
    candidate.outcome,
    ["selected", "declined", "deferred"],
    "$receipt.outcome",
    "receipt_error",
  );
  if (outcome !== expectedOutcome) {
    fail("receipt_error", "$receipt.outcome does not match reported_choice");
  }
  const base = deepFreeze({
    _format: literal(
      candidate._format,
      [HEAVEN_FORMATS.receipt],
      "$receipt._format",
      "receipt_error",
    ),
    receipt_id: sha256(candidate.receipt_id, "$receipt.receipt_id", "receipt_error"),
    invitation,
    boundaries: parseBoundaries(candidate.boundaries, "$receipt.boundaries", "receipt_error"),
    statement: literal(
      candidate.statement,
      [HEAVEN_RECEIPT_STATEMENT],
      "$receipt.statement",
      "receipt_error",
    ),
  });
  let parsed: Readonly<HeavenReceipt>;
  if (response.reported_choice === "accepted") {
    const selection = parseSelection(
      candidate.selection,
      invitation,
      response.selected_mode,
      response.randomness,
    );
    if (invitation.phase === "burst") {
      if (response.selected_mode !== null) {
        fail("receipt_error", "$receipt.selected_mode must be null for a burst invitation");
      }
      parsed = deepFreeze({
        ...base,
        invitation: invitation as HeavenInvitation & { readonly phase: "burst" },
        reported_choice: "accepted" as const,
        outcome: "selected" as const,
        selected_mode: null,
        randomness: response.randomness,
        selection,
      });
    } else {
      parsed = deepFreeze({
        ...base,
        invitation: invitation as HeavenInvitation & { readonly phase: "landing" },
        reported_choice: "accepted" as const,
        outcome: "selected" as const,
        selected_mode: response.selected_mode as HeavenLandingMode,
        randomness: response.randomness,
        selection,
      });
    }
  } else if (response.reported_choice === "declined") {
    if (candidate.selection !== null) {
      fail("receipt_error", "$receipt.selection must be null unless accepted");
    }
    parsed = deepFreeze({
      ...base,
      reported_choice: "declined" as const,
      outcome: "declined" as const,
      selected_mode: null,
      randomness: null,
      selection: null,
    });
  } else {
    if (candidate.selection !== null) {
      fail("receipt_error", "$receipt.selection must be null unless accepted");
    }
    parsed = deepFreeze({
      ...base,
      reported_choice: "deferred" as const,
      outcome: "deferred" as const,
      selected_mode: null,
      randomness: null,
      selection: null,
    });
  }
  const { receipt_id: _ignored, ...body } = parsed;
  const expected = domainSeparatedId(
    "agenttool.heaven-receipt/0.1",
    receiptBody(body),
  );
  if (parsed.receipt_id !== expected) {
    fail("receipt_error", "$receipt.receipt_id does not bind its body");
  }
  return parsed;
}

export function deterministicSelectionVector(
  invitation: HeavenInvitation,
  selectedMode: HeavenMode | null,
  randomness: HeavenDeterministicRandomness | HeavenInjectedRandomness,
): Sha256Id {
  const validated = validateHeavenInvitation(invitation);
  const response = parseResponse({
    reported_choice: "accepted",
    selected_mode: selectedMode,
    randomness,
  });
  if (response.reported_choice !== "accepted") {
    fail("response_error", "Selection vectors require accepted randomness");
  }
  return domainSeparatedId("agenttool.heaven-selection-vector/0.1", {
    invitation_id: validated.invitation_id,
    selected_mode: response.selected_mode,
    randomness: response.randomness,
    selection: selectionFor(
      validated,
      response.selected_mode,
      response.randomness,
    ),
  });
}
