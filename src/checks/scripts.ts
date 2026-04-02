import type { CheckResult, RepoPackageJson } from "../types";
import { detectRepoKind } from "../utils/repoKind";

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
    if (scripts[scriptName]) {
      return {
        id: `script:${scriptName}`,
        status: "pass",
        message: `Found ${scriptName} script.`,
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
