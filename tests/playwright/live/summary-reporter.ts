/** Prints the live sweep's listed-but-not-failed findings once per run. It runs
 * in the runner process, so its totals survive worker restarts and retries;
 * only each test's final attempt counts. */
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { EDGE_INJECTIONS } from "./edge-injections";

export default class LivePolicySummary implements Reporter {
  private readonly finalAnnotations = new Map<string, { type: string; description?: string }[]>();

  onTestEnd(test: TestCase, result: TestResult): void {
    this.finalAnnotations.set(test.id, result.annotations);
  }

  onEnd(): void {
    const injected = new Map<string, number>();
    const unreleased: string[] = [];
    for (const annotations of this.finalAnnotations.values()) {
      const names = new Set(annotations.filter((a) => a.type === "edge injection").map((a) => a.description ?? ""));
      for (const name of names) injected.set(name, (injected.get(name) ?? 0) + 1);
      for (const a of annotations) if (a.type === "not in production" && a.description) unreleased.push(a.description);
    }
    const notes: string[] = [];
    for (const injection of EDGE_INJECTIONS) {
      const pages = injected.get(injection.name);
      if (pages) notes.push(`${injection.name} was blocked on ${pages} page(s); ${injection.remedy}.`);
    }
    if (unreleased.length) {
      notes.push(`${unreleased.length} committed page(s) answered 404 in production and were not checked (not yet released, or removed): ${unreleased.sort().join(", ")}.`);
    }
    for (const note of notes) {
      console.log(process.env.GITHUB_ACTIONS ? `::warning title=Live page policy::${note}` : `note: ${note}`);
    }
  }
}
