import type { CheckResult, PreflightReport, RepoScanResult, SummaryCounts } from "../types";

const statusLabels = {
  pass: "PASS",
  info: "INFO",
  warn: "WARN",
  fail: "FAIL",
} as const;

function formatSummary(summary: SummaryCounts): string {
  return `${summary.pass} pass, ${summary.info} info, ${summary.warn} warn, ${summary.fail} fail`;
}

function formatResultLines(results: CheckResult[], includeSuggestions: boolean, prefix = ""): string[] {
  const lines: string[] = [];

  for (const result of results) {
    lines.push(`${prefix}${statusLabels[result.status]}  ${result.message}`);

    if (includeSuggestions && result.suggestion) {
      lines.push(`${prefix}      Suggestion: ${result.suggestion}`);
    }
  }

  return lines;
}

function formatSection(section: RepoScanResult, includeSuggestions: boolean): string[] {
  const lines = [`${section.kind === "root" ? "Root" : "Workspace"}: ${section.name}`, `Path: ${section.path}`];
  lines.push(...formatResultLines(section.results, includeSuggestions));
  lines.push(`Verdict: ${section.verdict}`);
  lines.push(`Summary: ${formatSummary(section.summary)}`);
  return lines;
}

function formatWorkspaceRollup(report: PreflightReport): string | undefined {
  if (report.workspaces.length === 0) {
    return undefined;
  }

  const ready = report.workspaces.filter((workspace) => workspace.verdict === "Ready").length;
  const readyWithWarnings = report.workspaces.filter(
    (workspace) => workspace.verdict === "Ready with warnings",
  ).length;
  const notReady = report.workspaces.filter((workspace) => workspace.verdict === "Not ready").length;

  return `Workspace rollup: ${report.workspaces.length} scanned, ${ready} ready, ${readyWithWarnings} ready with warnings, ${notReady} not ready`;
}

export function formatTextReport(report: PreflightReport, options?: { ci?: boolean }): string {
  const ci = options?.ci ?? false;
  const includeSuggestions = !ci;
  const lines: string[] = [];

  if (!ci) {
    lines.push("Repo Preflight");
    lines.push(`Target: ${report.targetDir}`);
    if (report.configPath) {
      lines.push(`Config: ${report.configPath}`);
    }
    if (report.workspaceDetection.isWorkspaceRoot) {
      lines.push(`Workspace root: yes (${report.workspaceDetection.sources.join(", ")})`);
    }
    if (report.workspaceDetection.hints.length > 0) {
      lines.push(`Workspace hints: ${report.workspaceDetection.hints.join(", ")}`);
    }
    lines.push("");
  } else {
    lines.push(`repo-preflight target=${report.targetDir}`);
  }

  lines.push(...formatSection(report.root, includeSuggestions));

  for (const workspace of report.workspaces) {
    lines.push("");
    lines.push(...formatSection(workspace, includeSuggestions));
  }

  lines.push("");
  lines.push(`Verdict: ${report.verdict}`);
  const workspaceRollup = formatWorkspaceRollup(report);
  if (workspaceRollup) {
    lines.push(workspaceRollup);
    lines.push(`Checks: ${formatSummary(report.summary)}`);
  } else {
    lines.push(`Summary: ${formatSummary(report.summary)}`);
  }

  return lines.join("\n");
}
