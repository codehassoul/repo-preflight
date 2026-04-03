import path from "node:path";

import type { CheckResult, PackageManagerName } from "../types";
import { pathExists } from "../utils/fs";

const yarnInstallMarkers = [".pnp.cjs", ".pnp.js"];

async function detectInstallState(
  targetDir: string,
  packageManager?: PackageManagerName,
): Promise<{ found: boolean; message?: string }> {
  if (await pathExists(path.join(targetDir, "node_modules"))) {
    return {
      found: true,
      message: "Found node_modules.",
    };
  }

  if (packageManager === "yarn") {
    for (const filename of yarnInstallMarkers) {
      if (await pathExists(path.join(targetDir, filename))) {
        return {
          found: true,
          message: `Found ${filename} for Yarn Plug'n'Play.`,
        };
      }
    }
  }

  return {
    found: false,
  };
}

export async function checkDependenciesInstalled(
  targetDir: string,
  options?: { workspaceRootDir?: string; packageManager?: PackageManagerName },
): Promise<CheckResult> {
  const localInstallState = await detectInstallState(targetDir, options?.packageManager);
  if (localInstallState.found) {
    return {
      id: "dependencies",
      status: "pass",
      message: localInstallState.message ?? "Found install state.",
    };
  }

  if (options?.workspaceRootDir) {
    const workspaceRootInstallState = await detectInstallState(
      options.workspaceRootDir,
      options.packageManager,
    );

    if (workspaceRootInstallState.found) {
      return {
        id: "dependencies",
        status: "pass",
        message: `${workspaceRootInstallState.message ?? "Found install state."} Using workspace root install state.`,
      };
    }
  }

  if (options?.workspaceRootDir) {
    return {
      id: "dependencies",
      status: "info",
      message: "Workspace package depends on the workspace root install state, and no root install state was found.",
      suggestion: "Install dependencies at the workspace root before trying to run workspace packages.",
    };
  }

  return {
    id: "dependencies",
    status: "warn",
    message: "No local install state was found.",
    suggestion: "Install dependencies before trying to run the repo.",
  };
}
