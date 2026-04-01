import { readFile } from "node:fs/promises";
import path from "node:path";

import type { RepoPackageJson, WorkspaceDetection } from "../types";
import { pathExists } from "../utils/fs";

function getPackageJsonPatterns(packageJson: RepoPackageJson | undefined): string[] {
  const workspaces = packageJson?.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  if (workspaces && Array.isArray(workspaces.packages)) {
    return workspaces.packages;
  }

  return [];
}

async function getPnpmWorkspacePatterns(targetDir: string): Promise<string[]> {
  const pnpmWorkspacePath = path.join(targetDir, "pnpm-workspace.yaml");
  if (!(await pathExists(pnpmWorkspacePath))) {
    return [];
  }

  try {
    const raw = await readFile(pnpmWorkspacePath, "utf8");
    const patterns: string[] = [];
    let inPackagesBlock = false;

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      if (/^packages\s*:/.test(trimmed)) {
        inPackagesBlock = true;
        continue;
      }

      if (inPackagesBlock) {
        const match = trimmed.match(/^-\s*['"]?(.+?)['"]?$/);
        if (match) {
          patterns.push(match[1]);
          continue;
        }

        if (!/^-/.test(trimmed)) {
          inPackagesBlock = false;
        }
      }
    }

    return patterns;
  } catch {
    return [];
  }
}

export async function detectWorkspaces(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
): Promise<WorkspaceDetection> {
  const packageJsonPatterns = getPackageJsonPatterns(packageJson);
  const pnpmPatterns = await getPnpmWorkspacePatterns(targetDir);
  const patternSet = new Set([...packageJsonPatterns, ...pnpmPatterns]);
  const sources: string[] = [];

  if (packageJsonPatterns.length > 0) {
    sources.push("package.json workspaces");
  }

  if (pnpmPatterns.length > 0) {
    sources.push("pnpm-workspace.yaml");
  }

  const hints: string[] = [];
  if (await pathExists(path.join(targetDir, "turbo.json"))) {
    hints.push("turbo");
  }

  if (await pathExists(path.join(targetDir, "nx.json"))) {
    hints.push("nx");
  }

  return {
    isWorkspaceRoot: patternSet.size > 0,
    patterns: [...patternSet],
    sources,
    hints,
  };
}
