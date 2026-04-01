import type { CheckResult, ReadinessVerdict } from "../types";

export function getReadinessVerdict(results: CheckResult[]): ReadinessVerdict {
  if (results.some((result) => result.status === "fail")) {
    return "Not ready";
  }

  if (results.some((result) => result.status === "warn")) {
    return "Ready with warnings";
  }

  return "Ready";
}
