import type { CheckResult, ReadinessVerdict } from "../types";
import { summarizeResults } from "./aggregate";

export interface FormattedReport {
  text: string;
  counts: ReturnType<typeof summarizeResults>;
}

const statusLabels = {
  pass: "PASS",
  info: "INFO",
  warn: "WARN",
  fail: "FAIL",
} as const;

export function formatResults(
  targetDir: string,
  results: CheckResult[],
  verdict: ReadinessVerdict,
): FormattedReport {
  const counts = summarizeResults(results);
  const lines = ["Repo Preflight", `Target: ${targetDir}`, ""];

  for (const result of results) {
    lines.push(`${statusLabels[result.status]}  ${result.message}`);

    if (result.suggestion) {
      lines.push(`      Suggestion: ${result.suggestion}`);
    }
  }

  lines.push("");
  lines.push(`Verdict: ${verdict}`);
  lines.push(`Summary: ${counts.pass} pass, ${counts.info} info, ${counts.warn} warn, ${counts.fail} fail`);

  return {
    text: lines.join("\n"),
    counts,
  };
}
