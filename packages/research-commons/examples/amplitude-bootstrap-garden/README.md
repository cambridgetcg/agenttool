# Amplitude Bootstrap Garden

> **Compass:** Demonstrate result-neutral and verdict-neutral research-work accounting without deciding scientific truth.
> **Implements:** One checked RC-0.1 shadow simulation plus exact per-settlement public projections.
> **Code:** `packages/research-commons/examples/amplitude-bootstrap-garden/`
> **Tests:** `packages/research-commons/tests/artifacts.test.ts` · `packages/research-commons/tests/simulator.test.ts`

The checked simulation uses only simulated nontransferable credit and E0–E2
structural receipts. A NULL research delivery receives its frozen 30 credits;
a reviewer receives the frozen 10 credits despite a non-accepting delivery
decision. A separate five-credit approval work package remains active:

```text
100 committed = 40 delivered + 5 reserved + 55 available
```

Each projection binds exactly one settlement and exactly the receipts consumed
by that settlement. These files do not establish amplitude correctness,
novelty, priority, significance, independence, identity, safety, access,
authority, external value, or a live Zerone integration.
