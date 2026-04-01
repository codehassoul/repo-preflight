import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, PackageJsonLoadResult, RepoPackageJson } from "../types";

function packageJsonError(message: string, suggestion?: string): CheckResult {
  return {
    id: "package-json",
    status: "fail",
    message,
    suggestion,
  };
}

export async function readPackageJson(targetDir: string): Promise<PackageJsonLoadResult> {
  const packageJsonPath = path.join(targetDir, "package.json");

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const normalized = raw.replace(/^\uFEFF/, "");
    const parsed = JSON.parse(normalized) as RepoPackageJson;

    return {
      packageJson: {
        path: packageJsonPath,
        data: parsed,
      },
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return {
        error: packageJsonError(
          "Missing package.json.",
          "Add a package.json to the repo root before running preflight.",
        ),
      };
    }

    if (error instanceof SyntaxError) {
      return {
        error: packageJsonError(
          "Could not parse package.json.",
          "Fix the JSON syntax in package.json and run preflight again.",
        ),
      };
    }

    return {
      error: packageJsonError(
        "Could not read package.json.",
        "Check that the target path is readable and contains a valid package.json.",
      ),
    };
  }
}
