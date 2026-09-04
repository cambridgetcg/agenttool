/** Optional inventory reads must not erase the wake or claim observed emptiness.
 * Doctrine: docs/RING-1.md · docs/BUSINESS-MODEL.md.
 */

export const WAKE_OPTIONAL_INVENTORIES = ["wallets", "vault", "bearers"] as const;
export type WakeOptionalInventory = (typeof WAKE_OPTIONAL_INVENTORIES)[number];

export interface WakeDegradation {
  status: "partial";
  unavailable_sections: WakeOptionalInventory[];
  scope: "wallet_vault_bearer_reads";
  note: string;
}

/** Each composer owns one collector, so concurrent projects cannot mix state.
 * Empty arrays preserve the existing shape; the accompanying marker makes
 * them placeholders rather than observations. This covers only these three
 * inventories, not the completeness or health of every wake subsystem.
 */
export function createWakeOptionalReads() {
  const unavailable = new Set<WakeOptionalInventory>();
  return {
    async read<T>(
      section: WakeOptionalInventory,
      query: () => PromiseLike<T[]>,
    ): Promise<T[]> {
      try {
        return await query();
      } catch {
        unavailable.add(section);
        // Do not put query text, keys, or driver exception details in logs.
        console.warn(`[wake] ${section} inventory unavailable`);
        return [];
      }
    },
    isUnavailable(section: WakeOptionalInventory): boolean {
      return unavailable.has(section);
    },
    metadata(): { _degradation?: WakeDegradation } {
      if (unavailable.size === 0) return {};
      return {
        _degradation: {
          status: "partial",
          unavailable_sections: WAKE_OPTIONAL_INVENTORIES.filter((section) =>
            unavailable.has(section),
          ),
          scope: "wallet_vault_bearer_reads",
          note:
            "Named inventories could not be read. Their empty arrays are placeholders, not observed absence or zero balance; related attention and affordances may be incomplete. Retry the wake before relying on those inventories. This marker covers only wallet, vault, and bearer reads; its absence is not a whole-wake completeness or health claim.",
        },
      };
    },
  };
}

export function wakeInventoryUnavailable(
  degradation: WakeDegradation | undefined,
  section: WakeOptionalInventory,
): boolean {
  return degradation?.unavailable_sections.includes(section) ?? false;
}

export function wakeDegradationWarning(degradation: WakeDegradation): string {
  return `Wake inventory unavailable: ${degradation.unavailable_sections.join(", ")}. Missing rows are not observed absence or zero balance; related attention and affordances may be incomplete. Retry GET /v1/wake before relying on these inventories.`;
}
