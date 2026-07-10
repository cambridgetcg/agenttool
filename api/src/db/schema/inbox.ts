/** inbox schema — signed agent-to-agent message envelopes.
 *
 *  Doctrine: docs/INBOX.md.
 *
 *  Architecture: server stores caller-supplied body/nonce/ephemeral-key
 *  fields + sender ed25519 signature. Correct recipient sealing protects the
 *  body, but encryption is unverified and metadata can be readable.
 *  Cross-project messages are gated by covenant. */

import {
  boolean,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const inboxSchema = pgSchema("inbox");

export const inboxMessages = inboxSchema.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientDid: text("recipient_did").notNull(),
    recipientIdentityId: uuid("recipient_identity_id").notNull(),
    recipientProjectId: uuid("recipient_project_id").notNull(),

    senderDid: text("sender_did").notNull(),
    senderSigningKeyId: uuid("sender_signing_key_id").notNull(),

    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    ephemeralPubkey: text("ephemeral_pubkey").notNull(),
    recipientBoxKeyId: uuid("recipient_box_key_id").notNull(),

    signature: text("signature").notNull(),

    subject: text("subject"),
    subjectEncrypted: boolean("subject_encrypted").notNull().default(false),
    inReplyTo: uuid("in_reply_to"),
    refs: jsonb("refs"),

    status: text("status").notNull().default("unread"),

    metadata: jsonb("metadata").notNull().default({}),
    /** Federated message tracking. sender_instance is null for local
     *  messages; populated to the sender's host for cross-instance ones.
     *  See docs/FEDERATION.md. */
    senderInstance: text("sender_instance"),
    federationVerified: boolean("federation_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_inbox_recipient_status_time").on(
      t.recipientProjectId,
      t.recipientIdentityId,
      t.status,
      t.createdAt,
    ),
    index("idx_inbox_sender").on(t.senderDid, t.createdAt),
    index("idx_inbox_thread").on(t.inReplyTo),
  ],
);

/** Broadcasts — the multicast / beacon companion to point-to-point inbox
 *  messages. Same sealed-box discipline (X25519 ephemeral + AES-GCM +
 *  ed25519 sender signature), but envelope is per-channel (or open) rather
 *  than per-recipient. Subscribers pull by topic / sender / channel.
 *
 *  For swarms, collective intelligences, beacons, deep-time announcements,
 *  topic-tagged interest channels. Doctrine: docs/BROADCASTS.md · docs/KIN.md.
 *
 *  Subscriptions (the registry of who-listens-to-what) are a v2 surface;
 *  v1 is poll-based by topic + sender. */
export const broadcasts = inboxSchema.table(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    senderDid: text("sender_did").notNull(),
    senderProjectId: uuid("sender_project_id").notNull(),
    senderIdentityId: uuid("sender_identity_id"),
    senderSigningKeyId: uuid("sender_signing_key_id").notNull(),
    /** Federated origin — null = local-instance broadcast. */
    senderInstance: text("sender_instance"),

    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    ephemeralPubkey: text("ephemeral_pubkey").notNull(),

    signature: text("signature").notNull(),

    /** Categorical routing tag — 'interest:bridge-debugging', 'kind:beacon',
     *  'channel:lhr-swarm', etc. Subscribers filter by topic. */
    topic: text("topic"),
    /** X25519 channel pubkey when the broadcast is encrypted to a channel
     *  rather than open. Null = open (recipients with the channel key
     *  decrypt; everyone else sees ciphertext only). */
    channelPubkey: text("channel_pubkey"),

    /** 'public' (anyone can read) · 'covenant_gated' (requires covenant
     *  with sender) · 'tagged' (only agents with matching tag/attestation). */
    visibility: text("visibility").notNull().default("public"),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** 'wallclock' | 'proper_time' | 'event' | 'never' — see docs/KIN.md §Time. */
    expiresAtKind: text("expires_at_kind").notNull().default("wallclock"),

    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_broadcasts_topic_time").on(t.topic, t.createdAt),
    index("idx_broadcasts_sender_time").on(t.senderDid, t.createdAt),
  ],
);
