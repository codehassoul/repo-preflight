import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, LoadedConfig } from "../types";
import { pathExists } from "../utils/fs";
import { validateConfig } from "./schema";

const defaultConfigFile = "repo-preflight.config.json";

function configError(message: string, suggestion?: string): CheckResult {
  return {
    id: "config",
    status: "fail",
    message,
    suggestion,
  };
}

export interface ConfigLoadResult {
  config?: LoadedConfig;
  error?: CheckResult;
}

export async function resolveConfigPath(
  targetDir: string,
  explicitPath?: string,
  configBaseDir = targetDir,
): Promise<string | undefined> {
  if (explicitPath) {
    return path.resolve(configBaseDir, explicitPath);
  }

  const candidate = path.join(targetDir, defaultConfigFile);
  return (await pathExists(candidate)) ? candidate : undefined;
}

export async function loadConfig(
  targetDir: string,
  explicitPath?: string,
  configBaseDir = targetDir,
): Promise<ConfigLoadResult> {
  const configPath = await resolveConfigPath(targetDir, explicitPath, configBaseDir);
  if (!configPath) {
    return {};
  }

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    return {
      config: {
        path: configPath,
        data: validateConfig(parsed),
      },
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return {
        error: configError(
          `Could not find config file at ${configPath}.`,
          "Pass an existing config path with --config or remove the flag.",
        ),
      };
    }

    if (error instanceof SyntaxError) {
      return {
        error: configError(
          `Could not parse config file at ${configPath}.`,
          "Fix the JSON syntax in the config file and run preflight again.",
        ),
      };
    }

    if (error instanceof Error) {
      return {
        error: configError(
          `Invalid config file at ${configPath}: ${error.message}`,
          "Keep the config schema minimal: booleans for toggles and arrays of strings for expectations.",
        ),
      };
    }

    return {
      error: configError(
        `Could not read config file at ${configPath}.`,
        "Check that the config path is readable and valid JSON.",
      ),
    };
  }
}
