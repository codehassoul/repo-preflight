import path from "node:path";

import type { PackageManagerDetection, PackageManagerName, RepoPackageJson } from "../types";
import { pathExists } from "../utils/fs";

const lockfiles: Record<PackageManagerName, string[]> = {
  npm: ["package-lock.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
};

function parsePackageManagerField(packageManager: string | undefined): PackageManagerName | undefined {
  if (!packageManager) {
    return undefined;
  }

  const [name] = packageManager.split("@");
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") {
    return name;
  }

  return undefined;
}

export async function detectPackageManager(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
  options?: { workspaceRootManager?: PackageManagerName },
): Promise<PackageManagerDetection> {
  const packageManagerField = packageJson?.packageManager;
  const declaredManager = parsePackageManagerField(packageManagerField);

  if (packageManagerField && declaredManager) {
    return {
      manager: declaredManager,
      source: "packageManager",
      result: {
        id: "package-manager",
        status: "pass",
        message: `Detected package manager ${declaredManager} from package.json packageManager.`,
      },
    };
  }

  if (packageManagerField && !declaredManager) {
    return {
      source: "packageManager",
      result: {
        id: "package-manager",
        status: "fail",
        message: `Unsupported packageManager value "${packageManagerField}".`,
        suggestion: "Use npm, pnpm, yarn, or bun in package.json packageManager.",
      },
    };
  }

  const detectedManagers: PackageManagerName[] = [];

  for (const [manager, filenames] of Object.entries(lockfiles) as [PackageManagerName, string[]][]) {
    for (const filename of filenames) {
      if (await pathExists(path.join(targetDir, filename))) {
        detectedManagers.push(manager);
        break;
      }
    }
  }

  if (detectedManagers.length > 1) {
    return {
      source: "lockfile",
      result: {
        id: "package-manager",
        status: "fail",
        message: `Conflicting lockfiles found: ${detectedManagers.join(", ")}.`,
        suggestion: "Remove extra lockfiles so the expected package manager is unambiguous.",
      },
    };
  }

  if (detectedManagers.length === 1) {
    const manager = detectedManagers[0];
    return {
      manager,
      source: "lockfile",
      result: {
        id: "package-manager",
        status: "warn",
        message: `Inferred package manager ${manager} from lockfile.`,
        suggestion: "Add packageManager to package.json to make the expected tool explicit.",
      },
    };
  }

  if (options?.workspaceRootManager) {
    return {
      manager: options.workspaceRootManager,
      source: "workspaceRoot",
      result: {
        id: "package-manager",
        status: "pass",
        message: `Using package manager ${options.workspaceRootManager} from workspace root.`,
      },
    };
  }

  return {
    source: "unknown",
    result: {
      id: "package-manager",
      status: "warn",
      message: "Could not determine the package manager.",
      suggestion: "Add packageManager to package.json or commit the repo lockfile.",
    },
  };
}

export function getExpectedLockfiles(manager: PackageManagerName): string[] {
  return lockfiles[manager];
}
