import type { CheckResult, ReadinessVerdict, SummaryCounts } from "../types";
import { getReadinessVerdict } from "./verdict";

export function createEmptySummary(): SummaryCounts {
  return {
    pass: 0,
    info: 0,
    warn: 0,
    fail: 0,
  };
}

export function summarizeResults(results: CheckResult[]): SummaryCounts {
  const summary = createEmptySummary();

  for (const result of results) {
    summary[result.status] += 1;
  }

  return summary;
}

export function mergeSummaries(summaries: SummaryCounts[]): SummaryCounts {
  const merged = createEmptySummary();

  for (const summary of summaries) {
    merged.pass += summary.pass;
    merged.info += summary.info;
    merged.warn += summary.warn;
    merged.fail += summary.fail;
  }

  return merged;
}

export function getVerdictFromResults(results: CheckResult[]): ReadinessVerdict {
  return getReadinessVerdict(results);
}

export function getVerdictFromSummaries(summaries: SummaryCounts[]): ReadinessVerdict {
  const merged = mergeSummaries(summaries);

  if (merged.fail > 0) {
    return "Not ready";
  }

  if (merged.warn > 0) {
    return "Ready with warnings";
  }

  return "Ready";
}
