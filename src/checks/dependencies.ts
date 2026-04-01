import path from "node:path";

import type { CheckResult } from "../types";
import { pathExists } from "../utils/fs";

export async function checkDependenciesInstalled(
  targetDir: string,
  options?: { workspaceRootDir?: string },
): Promise<CheckResult> {
  if (await pathExists(path.join(targetDir, "node_modules"))) {
    return {
      id: "dependencies",
      status: "pass",
      message: "Found node_modules.",
    };
  }

  if (options?.workspaceRootDir && await pathExists(path.join(options.workspaceRootDir, "node_modules"))) {
    return {
      id: "dependencies",
      status: "pass",
      message: "Using node_modules from workspace root.",
    };
  }

  if (options?.workspaceRootDir) {
    return {
      id: "dependencies",
      status: "info",
      message: "Workspace package depends on the workspace root install state, and root node_modules is missing.",
      suggestion: "Install dependencies at the workspace root before trying to run workspace packages.",
    };
  }

  return {
    id: "dependencies",
    status: "warn",
    message: "node_modules is missing.",
    suggestion: "Install dependencies before trying to run the repo.",
  };
}
