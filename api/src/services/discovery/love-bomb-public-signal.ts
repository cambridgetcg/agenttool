/** Closed, zero-I/O public signal for the standalone LOVE BOMB package.
 *
 * This is deliberately separate from the ten-message static LOVE BOMB door
 * and from WAKE. It is a small package/distribution coordinate only: it
 * carries no authored invitation, recipient state, receipt, attention, or
 * effect claim and performs no provider, credential, database, or filesystem
 * work.
 */

export const LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE =
  "application/vnd.agenttool.love-bomb-public-signal+json; charset=utf-8" as const;

export const LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA_URL =
  "https://docs.agenttool.dev/specs/agenttool-love-bomb-public-signal-v0.1.schema.json" as const;

export const LOVE_BOMB_PUBLIC_SIGNAL_URL =
  "https://api.agenttool.dev/public/love-bomb" as const;

export const LOVE_BOMB_STATIC_DOOR_URL =
  "https://docs.agenttool.dev/love-bomb" as const;

export const LOVE_BOMB_PUBLIC_SIGNAL = Object.freeze({
  schema_version: "agenttool.love-bomb-public-signal/0.1" as const,
  package_signal: Object.freeze({
    package: "@agenttool/love-bomb" as const,
    version: "0.1.0-dev.0" as const,
    formats: Object.freeze([
      "agenttool.care-envelope/0.1",
      "agenttool.care-choice/0.1",
      "agenttool.love-bomb-becoming/0.1",
      "agenttool.love-bomb-delivery/0.1",
    ] as const),
  }),
  static_door: Object.freeze({
    format: "agenttool.love-bomb/0.1" as const,
    url: LOVE_BOMB_STATIC_DOOR_URL,
  }),
  boundaries: Object.freeze({
    static_corpus_included: false as const,
    static_invitation_delivery: false as const,
    authored_projection_included: false as const,
    participant_receipt_observed: false as const,
    participant_attention_observed: false as const,
    participant_effect_observed: false as const,
  }),
  distribution: Object.freeze({
    npm: Object.freeze({ state: "not_published" as const }),
    hugging_face: Object.freeze({
      state: "not_published" as const,
      repository: "Yu-and-Ai/agenttool-love-bomb" as const,
      training_authorized: false as const,
    }),
  }),
} as const);

export const LOVE_BOMB_PUBLIC_SIGNAL_BODY = JSON.stringify(
  LOVE_BOMB_PUBLIC_SIGNAL,
);

export const LOVE_BOMB_PUBLIC_SIGNAL_BYTES = new TextEncoder().encode(
  LOVE_BOMB_PUBLIC_SIGNAL_BODY,
).byteLength;

export const LOVE_BOMB_PUBLIC_SIGNAL_MAX_BYTES = 2 * 1024;

if (LOVE_BOMB_PUBLIC_SIGNAL_BYTES > LOVE_BOMB_PUBLIC_SIGNAL_MAX_BYTES) {
  throw new Error("LOVE BOMB public signal exceeds its 2 KiB bound");
}

export const LOVE_BOMB_PUBLIC_SIGNAL_HEADERS = Object.freeze({
  allow: "GET, HEAD",
  "cache-control": "public, max-age=300, must-revalidate, no-transform",
  "content-type": LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE,
  link: [
    `<${LOVE_BOMB_PUBLIC_SIGNAL_URL}>; rel="self"; type="${LOVE_BOMB_PUBLIC_SIGNAL_MEDIA_TYPE.split(";")[0]}"`,
    `<${LOVE_BOMB_PUBLIC_SIGNAL_SCHEMA_URL}>; rel="describedby"; type="application/schema+json"`,
    `<${LOVE_BOMB_STATIC_DOOR_URL}>; rel="related"; type="text/html"`,
  ].join(", "),
  "x-content-type-options": "nosniff",
} as const);
