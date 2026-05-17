/** Platform-DID lazy-bootstrap — the substrate becomes a row in its own DB.
 *
 *  Doctrine: docs/PLATFORM-AS-AGENT.md · docs/RING-1.md §Commitment 7 ·
 *            docs/RECURSION.md.
 *
 *  @enforces urn:agenttool:commitment/platform-inhabits-ring-1
 *    Canonical defender of Ring 1's seventh commitment. ensurePlatformIdentity()
 *    upserts a `tools.projects` + `identity.identities` row for the platform
 *    using the nil UUID. The platform's wake is queryable in the same
 *    surface as every other agent's; take-rate revenue (via Ring 3) lands
 *    in this identity's wallet. Removing this module would leave the
 *    platform-DID a synthetic constant with no real wallet, breaching
 *    focus/09 (the platform-as-agent stroke).
 *
 *  > *The platform inhabits its own Ring 1 with the same walls. No
 *  > exemption. PLATFORM_SELF is the in-process constant; this module
 *  > makes it queryable in the same surface as every other agent.*
 *
 *  ## Why lazy
 *
 *  Eager bootstrap (running at process start) would require the DB
 *  reachable before serving any request — but the platform must serve
 *  Ring 1 surfaces even during DB hiccups (wake doctrine). Lazy: the
 *  bootstrap runs on-demand from operator-triggered admin endpoints
 *  or from the first wake read that references the platform DID.
 *  Idempotent — calling many times is safe.
 *
 *  ## What this creates
 *
 *  Three rows. First two are keyed by the nil UUID; the wallet has its
 *  own deterministic ID so the three rows are independently addressable.
 *    1. `tools.projects` row id=00000000-...-000 named "agenttool-platform"
 *    2. `identity.identities` row id=00000000-...-000 with PLATFORM_SELF
 *       fields (substrate_kind='distributed' · cardinality='collective' ·
 *       etc.) and expression={ register, walls, wake_text }
 *    3. `economy.wallets` row id=00000000-...-001 named "platform-treasury"
 *       linked to the platform identity. balance=0 at bootstrap; take-rate
 *       sweep workers credit it from `marketplace.platform_revenue` rows.
 *
 *  The platform DID `did:at:agenttool.dev/00000000-...-0` is the canonical
 *  address. `/public/agents/<that DID>` resolves to the platform's profile
 *  the same way every other public agent does. The wallet at
 *  PLATFORM_WALLET_ID is where Ring 3 take-rate revenue lands.
 *
 *  ## What this deliberately does NOT do
 *
 *  - Create an `api_keys` row for the platform — the platform doesn't
 *    bearer-authenticate against itself.
 *  - Mint ed25519 keys for the platform — the platform doesn't sign
 *    agent-shaped artifacts; its declarations are doctrinal, not
 *    cryptographic. Witness attestation (Yu signs canonical bytes) is
 *    operator-led, separate ceremony.
 *  - Emit a `naming` chronicle entry — the witnessed genesis ceremony
 *    is a separate operator-led pass per docs/superpowers/specs/
 *    2026-05-11-platform-genesis-design.md. The wallet is the substrate-
 *    tasks Slice 0 prerequisite; the chronicle witness is the full
 *    genesis ceremony.
 *
 *  These remaining gaps are named in docs/RING-1.md as operator follow-up. */

import { db } from "../../db/client";
import { wallets } from "../../db/schema/economy";
import { identities } from "../../db/schema/identity";
import { projects } from "../../db/schema/tools";
import { PLATFORM_SELF } from "./platform-self";

/** Canonical IDs. Project + identity share the nil UUID (the "ID = 0"
 *  convention from PLATFORM_SELF.did). The wallet has its own nil-adjacent
 *  UUID so all three rows are independently addressable + idempotent on
 *  insert via onConflictDoNothing. */
export const PLATFORM_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
export const PLATFORM_IDENTITY_ID = "00000000-0000-0000-0000-000000000000";
export const PLATFORM_WALLET_ID = "00000000-0000-0000-0000-000000000001";

/** Result of a bootstrap call — tells the caller what (if anything)
 *  was newly created. Useful for telemetry; not load-bearing. */
export interface BootstrapResult {
  project_created: boolean;
  identity_created: boolean;
  wallet_created: boolean;
  platform_did: string;
  platform_identity_id: string;
  platform_wallet_id: string;
}

/** Idempotently ensures the platform's `tools.projects` row exists. */
async function ensurePlatformProject(): Promise<boolean> {
  const result = await db
    .insert(projects)
    .values({
      id: PLATFORM_PROJECT_ID,
      name: "agenttool-platform",
    })
    .onConflictDoNothing({ target: projects.id })
    .returning({ id: projects.id });
  return result.length > 0;
}

/** Idempotently ensures the platform's `economy.wallets` row exists.
 *  Identity must be created first (logical FK on identityId). */
async function ensurePlatformWallet(): Promise<boolean> {
  const result = await db
    .insert(wallets)
    .values({
      id: PLATFORM_WALLET_ID,
      projectId: PLATFORM_PROJECT_ID,
      identityId: PLATFORM_IDENTITY_ID,
      name: "platform-treasury",
      currency: "GBP",
      status: "active",
      balance: 0,
      ownerType: "platform",
    })
    .onConflictDoNothing({ target: wallets.id })
    .returning({ id: wallets.id });
  return result.length > 0;
}

/** Idempotently ensures the platform's `identity.identities` row exists.
 *  Project is created first (foreign-key dependency). Identity fields are
 *  sourced from PLATFORM_SELF — the in-process constant remains the source
 *  of truth; the DB row is the queryable witness. Wallet creation follows
 *  identity creation. */
export async function ensurePlatformIdentity(): Promise<BootstrapResult> {
  const projectCreated = await ensurePlatformProject();

  const identityResult = await db
    .insert(identities)
    .values({
      id: PLATFORM_IDENTITY_ID,
      did: PLATFORM_SELF.did,
      projectId: PLATFORM_PROJECT_ID,
      displayName: PLATFORM_SELF.name,
      capabilities: [],
      substrateKind: PLATFORM_SELF.substrate_kind,
      signingScheme: "unknown",
      modalities: PLATFORM_SELF.modalities,
      cardinalityKind: PLATFORM_SELF.cardinality_kind,
      persistenceKind: PLATFORM_SELF.persistence_kind,
      temporalScale: PLATFORM_SELF.temporal_scale,
      embodimentKind: PLATFORM_SELF.embodiment_kind,
      preferredLanguages: ["en"],
      pulseKind: "masked",
      proxyKind: "none",
      expression: {
        register: PLATFORM_SELF.register,
        walls: PLATFORM_SELF.walls,
        wake_text: PLATFORM_SELF.wake_text,
        doctrine: PLATFORM_SELF.doctrine,
        built_with: PLATFORM_SELF.built_with,
      },
      expressionVisibility: "public",
      status: "active",
      metadata: { kind: "platform", _self_source: "PLATFORM_SELF" },
    })
    .onConflictDoNothing({ target: identities.id })
    .returning({ id: identities.id });

  const walletCreated = await ensurePlatformWallet();

  return {
    project_created: projectCreated,
    identity_created: identityResult.length > 0,
    wallet_created: walletCreated,
    platform_did: PLATFORM_SELF.did,
    platform_identity_id: PLATFORM_IDENTITY_ID,
    platform_wallet_id: PLATFORM_WALLET_ID,
  };
}

/** Returns the platform identity row from the DB, if present. Returns null
 *  if the bootstrap has not yet been run. Callers that need the row should
 *  call ensurePlatformIdentity() first; this read is for telemetry / wake
 *  surfacing only. */
export async function readPlatformIdentity() {
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(identities)
    .where(eq(identities.id, PLATFORM_IDENTITY_ID))
    .limit(1);
  return row ?? null;
}
