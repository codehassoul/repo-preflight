import path from "node:path";

import type { CheckResult, RepoPackageJson } from "../types";
import { detectEnvSignals } from "../utils/envSignals";
import { pathExists } from "../utils/fs";

export async function checkEnvFiles(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
  expectedFiles = [".env", ".env.local", ".env.example"],
): Promise<CheckResult> {
  const present: string[] = [];

  for (const filename of expectedFiles) {
    if (await pathExists(path.join(targetDir, filename))) {
      present.push(filename);
    }
  }

  if (present.length > 0) {
    return {
      id: "env-files",
      status: "pass",
      message: `Found env files: ${present.join(", ")}.`,
      metadata: {
        expectedFiles,
      },
    };
  }

  const signals = await detectEnvSignals(targetDir, packageJson);

  if (signals.expectsEnvFiles) {
    return {
      id: "env-files",
      status: "warn",
      message: "No common env files found, but the repo appears to use environment variables.",
      suggestion: "Add the expected local env file or document the required variables with a .env.example file.",
      metadata: {
        expectedFiles,
        reasons: signals.reasons,
      },
    };
  }

  if (signals.hasEnvUsage) {
    return {
      id: "env-files",
      status: "info",
      message: "No common env files found, but the repo does reference environment variables.",
      suggestion: "Add a .env.example only if this project expects local env-file based setup.",
      metadata: {
        expectedFiles,
        reasons: signals.reasons,
      },
    };
  }

  return {
    id: "env-files",
    status: "info",
    message: "No common env files found.",
    suggestion: "Add env files later only if this repo actually relies on environment variables.",
    metadata: {
      expectedFiles,
    },
  };
}
