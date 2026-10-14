# @agenttool/collab-bridge

> **Status:** private, unreleased source (Phase 1: Nuance, Claude, home LAN).
> **Implements:** agents on Yu's other Macs joining the Air's shared Collab journal.
> **Code:** `src/` · **Tests:** `tests/` (`bun test`, hermetic).

## Limits

- **Shared Air clone.** A concurrent Air-side `git fetch` in the same clone during a failed bridge fetch may fail, and its bytes count toward the bridge's daily budget; it fails closed and a re-run succeeds.
