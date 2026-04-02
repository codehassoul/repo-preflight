import type { CheckResult, RepoPackageJson } from "../types";
import { detectRepoKind } from "../utils/repoKind";

const DOCS_SCRIPT_ALIASES: Partial<Record<"dev" | "build" | "test", string[]>> = {
  dev: ["docs", "docs:dev", "docs-dev", "docs:serve", "docs-serve"],
  build: ["docs:build", "docs-build"],
  test: ["docs:test", "docs-test"],
};

export async function checkScripts(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
  expectedScripts = ["dev", "build", "test"],
): Promise<CheckResult[]> {
  if (!packageJson) {
    return [];
  }

  const scripts = packageJson.scripts ?? {};
  const repoKind = await detectRepoKind(targetDir, packageJson);

  return expectedScripts.map((scriptName) => {
    const hasDirectScript = Boolean(scripts[scriptName]);
    const alias = getScriptAlias(scriptName, scripts, repoKind);

    if (hasDirectScript || alias) {
      return {
        id: `script:${scriptName}`,
        status: "pass",
        message: hasDirectScript ? `Found ${scriptName} script.` : `Found ${scriptName} workflow via ${alias} script.`,
      };
    }

    const status = getMissingScriptStatus(scriptName, repoKind);

    return {
      id: `script:${scriptName}`,
      status,
      message: `Missing ${scriptName} script.`,
      suggestion:
        status === "warn"
          ? `Add a ${scriptName} script to package.json if this repo is expected to support that workflow.`
          : `Add a ${scriptName} script later if this repo grows into that workflow.`,
      metadata: {
        expectedScripts,
        repoKind: repoKind.isLikelyApp ? "app" : repoKind.isLikelyLibrary ? "library" : "simple",
      },
    };
  });
}

function getScriptAlias(
  scriptName: string,
  scripts: Record<string, string>,
  repoKind: Awaited<ReturnType<typeof detectRepoKind>>,
): string | undefined {
  if (!repoKind.isLikelyDocs || repoKind.isWorkspaceOrchestratorRoot) {
    return undefined;
  }

  const aliases = DOCS_SCRIPT_ALIASES[scriptName as "dev" | "build" | "test"] ?? [];
  return aliases.find((alias) => Boolean(scripts[alias]));
}

function getMissingScriptStatus(
  scriptName: string,
  repoKind: Awaited<ReturnType<typeof detectRepoKind>>,
): CheckResult["status"] {
  if (scriptName === "dev") {
    if (repoKind.isWorkspaceOrchestratorRoot) {
      return "info";
    }

    return repoKind.isLikelyApp ? "warn" : "info";
  }

  if (scriptName === "build") {
    return repoKind.hasBuildSignals ? "warn" : "info";
  }

  if (scriptName === "test") {
    return repoKind.hasTestSignals ? "warn" : "info";
  }

  return "info";
}
