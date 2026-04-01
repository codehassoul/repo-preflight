import path from "node:path";

import type { CheckResult, PackageManagerName } from "../types";
import { pathExists } from "../utils/fs";
import { getExpectedLockfiles } from "./packageManager";

export async function checkLockfile(
  targetDir: string,
  detectedManager: PackageManagerName | undefined,
  options?: { workspaceRootDir?: string },
): Promise<CheckResult> {
  if (!detectedManager) {
    return {
      id: "lockfile",
      status: "warn",
      message: "Skipped lockfile check because the package manager is unclear.",
      suggestion: "Define packageManager in package.json or keep only one lockfile in the repo.",
    };
  }

  const expectedLockfiles = getExpectedLockfiles(detectedManager);

  for (const filename of expectedLockfiles) {
    if (await pathExists(path.join(targetDir, filename))) {
      return {
        id: "lockfile",
        status: "pass",
        message: `Found ${filename} for ${detectedManager}.`,
      };
    }

    if (options?.workspaceRootDir && await pathExists(path.join(options.workspaceRootDir, filename))) {
      return {
        id: "lockfile",
        status: "pass",
        message: `Using ${filename} from workspace root for ${detectedManager}.`,
      };
    }
  }

  return {
    id: "lockfile",
    status: "fail",
    message: `Missing ${expectedLockfiles.join(" or ")} for ${detectedManager}.`,
    suggestion: `Generate and commit the ${detectedManager} lockfile.`,
  };
}
