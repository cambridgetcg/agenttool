/** Alchemy webhook handler — USDC Transfer events on Base → credit top-up. */

import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, billingEvents } from "../../db/schema";
import { USDC_BASE_CONTRACT, usdcToCredits } from "./wallet";

/** ERC-20 Transfer event topic. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Process an Alchemy webhook payload for USDC transfers.
 * Expects the Alchemy "Address Activity" webhook format.
 */
export async function handleAlchemyWebhook(payload: AlchemyWebhookPayload): Promise<void> {
  for (const log of payload.event?.data?.block?.logs ?? []) {
    // Only process USDC Transfer events
    if (
      log.account?.address?.toLowerCase() !== USDC_BASE_CONTRACT.toLowerCase() ||
      log.topics?.[0] !== TRANSFER_TOPIC
    ) {
      continue;
    }

    // topics[2] = "to" address (padded to 32 bytes)
    const toAddress = "0x" + (log.topics?.[2] ?? "").slice(26);
    const amountHex = log.data ?? "0x0";
    const amountRaw = BigInt(amountHex);
    const credits = usdcToCredits(amountRaw);
    const txHash = log.transaction?.hash;

    if (credits <= 0) continue;

    // Find project with this deposit address
    // NOTE: In production, maintain a deposit_addresses table for O(1) lookup.
    // For MVP, we check a reasonable set by scanning projects that have crypto enabled.
    const allProjects = await db.select().from(projects);

    // Import dynamically to avoid circular deps at module level
    const { getDepositAddress } = await import("./wallet");

    for (const project of allProjects) {
      try {
        const { address } = getDepositAddress(project.id);
        if (address.toLowerCase() === toAddress.toLowerCase()) {
          // Match! Add credits.
          await db
            .update(projects)
            .set({ credits: sql`${projects.credits} + ${credits}` })
            .where(eq(projects.id, project.id));

          await db.insert(billingEvents).values({
            projectId: project.id,
            type: "crypto_payment",
            amountPence: credits * 0.8, // approximate GBP (1 credit ≈ £0.008)
            creditsAdded: credits,
            cryptoTxHash: txHash ?? null,
          });

          console.info(
            `[crypto] Credited ${credits} to project ${project.id} from tx ${txHash}`,
          );
          break;
        }
      } catch {
        // Skip projects without valid HD mnemonic
      }
    }
  }
}

/** Alchemy webhook payload shape (simplified). */
interface AlchemyWebhookPayload {
  webhookId?: string;
  id?: string;
  type?: string;
  event?: {
    data?: {
      block?: {
        logs?: Array<{
          account?: { address?: string };
          topics?: string[];
          data?: string;
          transaction?: { hash?: string };
        }>;
      };
    };
  };
}
