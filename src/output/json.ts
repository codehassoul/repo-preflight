import type { PreflightReport } from "../types";

export function formatJsonReport(report: PreflightReport): string {
  return JSON.stringify(
    {
      targetPath: report.targetDir,
      configPath: report.configPath ?? null,
      verdict: report.verdict,
      summary: report.summary,
      workspace: {
        isWorkspaceRoot: report.workspaceDetection.isWorkspaceRoot,
        sources: report.workspaceDetection.sources,
        hints: report.workspaceDetection.hints,
      },
      root: {
        name: report.root.name,
        path: report.root.path,
        verdict: report.root.verdict,
        summary: report.root.summary,
        results: report.root.results,
      },
      workspaces: report.workspaces.map((workspace) => ({
        name: workspace.name,
        path: workspace.path,
        verdict: workspace.verdict,
        summary: workspace.summary,
        results: workspace.results,
      })),
      results: [
        ...report.root.results.map((result) => ({
          scope: "root",
          path: report.root.path,
          ...result,
        })),
        ...report.workspaces.flatMap((workspace) =>
          workspace.results.map((result) => ({
            scope: workspace.name,
            path: workspace.path,
            ...result,
          })),
        ),
      ],
    },
    null,
    2,
  );
}
