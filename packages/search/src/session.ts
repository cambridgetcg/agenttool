import {
  inspectTarget,
  normalizeTarget,
  type TelescopeReport,
} from "@agenttool/telescope";
import type { BrowserConsequencePlan } from "@agenttool/browser";
import telescopeReportJsonSchema from "@agenttool/telescope/report.schema.json" with {
  type: "json",
};
import { fromJsonSchema } from "@modelcontextprotocol/server";
import {
  SEARCH_INSPECTION_SCHEMA,
} from "./constants.js";
import { SearchError } from "./errors.js";
import type {
  SearchInspection,
  SearchOptions,
  SearchResponse,
  SearchInput,
  InspectSearchResultInput,
  OpenSearchResultInput,
} from "./types.js";

export interface SearchEngineLike {
  search(
    input: SearchInput,
    options?: SearchOptions,
  ): Promise<SearchResponse>;
  resolveResult(
    sessionId: string,
    resultId: string,
  ): {
    targetUrl: string;
    inspectUrl: string;
    expiresAt: string;
  };
}

export interface SearchBrowser<
  OpenResult = unknown,
  PlanResult = Readonly<BrowserConsequencePlan>,
> {
  open(url: string): Promise<OpenResult>;
  plan?(action: { kind: "navigate"; url: string }): PlanResult;
}

export type InspectSearchOrigin = (
  origin: string,
  options?: SearchOptions,
) => Promise<TelescopeReport>;

export interface SearchSessionOptions {
  inspect?: InspectSearchOrigin;
  now?: () => Date;
}

/**
 * Explicit composition boundary between search, Telescope inspection and
 * Browser planning/navigation. Search never invokes any follow-up. Inspection,
 * planning, and opening require a caller-selected, session-scoped opaque result.
 */
export class SearchSession<
  OpenResult = unknown,
  PlanResult = Readonly<BrowserConsequencePlan>,
> {
  private readonly inspectOrigin: InspectSearchOrigin;
  private readonly now: () => Date;
  private inspectionActive = false;

  constructor(
    readonly engine: SearchEngineLike,
    private readonly browser: SearchBrowser<OpenResult, PlanResult>,
    options: SearchSessionOptions = {},
  ) {
    this.inspectOrigin =
      options.inspect
      ?? (async (origin, inspectOptions) =>
        await inspectTarget(
          origin,
          inspectOptions?.signal
            ? { signal: inspectOptions.signal }
            : {},
        ));
    this.now = options.now ?? (() => new Date());
  }

  async search(
    input: SearchInput,
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    return await this.engine.search(input, options);
  }

  async inspect(
    input: InspectSearchResultInput,
    options: SearchOptions = {},
  ): Promise<SearchInspection> {
    validateOpaqueResultInput(input);
    const resolved = this.engine.resolveResult(
      input.session_id,
      input.result_id,
    );
    const origin = publicHttpsOrigin(resolved.inspectUrl);
    if (this.inspectionActive) {
      throw new SearchError(
        "inspection_unavailable",
        "Another search inspection is already active.",
      );
    }
    this.inspectionActive = true;
    let report: TelescopeReport;
    try {
      report = await normalizeTelescopeReport(
        await this.inspectOrigin(origin, options),
        origin,
      );
    } catch {
      throw new SearchError(
        "inspection_unavailable",
        "The selected result could not be inspected.",
      );
    } finally {
      this.inspectionActive = false;
    }
    return {
      schema: SEARCH_INSPECTION_SCHEMA,
      session_id: input.session_id,
      result_id: input.result_id,
      inspected_at: this.now().toISOString(),
      inspector: "@agenttool/telescope",
      origin,
      report,
      untrusted: true,
      trust: "untrusted",
      authority: "none",
      automatic_action: "never",
    };
  }

  async openResult(input: OpenSearchResultInput): Promise<OpenResult> {
    validateOpaqueResultInput(input);
    const resolved = this.engine.resolveResult(
      input.session_id,
      input.result_id,
    );
    try {
      // Deliberately one attempt. AgentBrowser remains the navigation-policy
      // choke point and any uncertain failure is surfaced to the caller.
      return await this.browser.open(resolved.targetUrl);
    } catch {
      throw new SearchError(
        "browser_open_failed",
        "Opening the selected search result was attempted once and did not complete.",
      );
    }
  }

  planResult(input: OpenSearchResultInput): PlanResult {
    validateOpaqueResultInput(input);
    const resolved = this.engine.resolveResult(
      input.session_id,
      input.result_id,
    );
    if (typeof this.browser.plan !== "function") {
      throw new SearchError(
        "browser_plan_failed",
        "This Browser session does not expose consequence planning.",
      );
    }
    try {
      return this.browser.plan({
        kind: "navigate",
        url: resolved.targetUrl,
      });
    } catch {
      throw new SearchError(
        "browser_plan_failed",
        "The selected search result could not be planned under Browser policy.",
      );
    }
  }
}

const MAX_TELESCOPE_REPORT_BYTES = 4 * 1_024 * 1_024;
const telescopeReportSchema = fromJsonSchema<TelescopeReport>(
  telescopeReportJsonSchema,
);

async function normalizeTelescopeReport(
  value: TelescopeReport,
  expectedOrigin: string,
): Promise<TelescopeReport> {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("report_not_json");
  }
  if (
    encoded === undefined
    || Buffer.byteLength(encoded, "utf8") > MAX_TELESCOPE_REPORT_BYTES
  ) {
    throw new Error("report_not_json");
  }
  const normalized = JSON.parse(encoded) as unknown;
  const validation = await telescopeReportSchema["~standard"].validate(
    normalized,
  );
  if ("issues" in validation) {
    throw new Error("report_not_telescope");
  }
  const report = validation.value;
  let canonicalSubject;
  try {
    canonicalSubject = normalizeTarget(report.subject.origin);
  } catch {
    throw new Error("report_subject_invalid");
  }
  if (
    report.subject.origin !== expectedOrigin
    || canonicalSubject.origin !== expectedOrigin
    || report.subject.hostname !== canonicalSubject.hostname
  ) {
    throw new Error("report_subject_mismatch");
  }
  return report;
}

function validateOpaqueResultInput(
  input: InspectSearchResultInput | OpenSearchResultInput,
): void {
  if (
    !input
    || typeof input !== "object"
    || typeof input.session_id !== "string"
    || input.session_id.length === 0
    || input.session_id.length > 200
    || typeof input.result_id !== "string"
    || input.result_id.length === 0
    || input.result_id.length > 200
  ) {
    throw new SearchError(
      "invalid_request",
      "session_id and result_id must be non-empty strings of at most 200 characters.",
    );
  }
}

function publicHttpsOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SearchError(
      "inspection_unavailable",
      "The selected result has no inspectable public HTTPS origin.",
    );
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || (url.port !== "" && url.port !== "443")
  ) {
    throw new SearchError(
      "inspection_unavailable",
      "The selected result has no inspectable public HTTPS origin.",
    );
  }
  try {
    return normalizeTarget(url.origin).origin;
  } catch {
    throw new SearchError(
      "inspection_unavailable",
      "The selected result has no inspectable public HTTPS origin.",
    );
  }
}
