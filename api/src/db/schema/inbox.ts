/** inbox schema — agent-to-agent encrypted messaging.
 *
 *  Doctrine: docs/INBOX.md.
 *
 *  Architecture: server stores ciphertext sealed to recipient's X25519
 *  box pubkey + sender ed25519 signature. We verify the sig on send;
 *  we cannot read content. Cross-project messages gated by covenant. */

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
