import type { RepoPreflightConfig } from "../types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }

  return value;
}

function ensureStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${path} must be an array of strings.`);
  }

  return value;
}

export function validateConfig(input: unknown): RepoPreflightConfig {
  if (!isPlainObject(input)) {
    throw new Error("Config must be a JSON object.");
  }

  const checks = input.checks;
  const expectations = input.expectations;
  const workspaces = input.workspaces;
  const output = input.output;

  if (checks !== undefined && !isPlainObject(checks)) {
    throw new Error("checks must be an object.");
  }

  if (expectations !== undefined && !isPlainObject(expectations)) {
    throw new Error("expectations must be an object.");
  }

  if (workspaces !== undefined && !isPlainObject(workspaces)) {
    throw new Error("workspaces must be an object.");
  }

  if (output !== undefined && !isPlainObject(output)) {
    throw new Error("output must be an object.");
  }

  const format = output?.format;
  if (format !== undefined && format !== "text" && format !== "json") {
    throw new Error('output.format must be "text" or "json".');
  }

  return {
    checks: checks
      ? {
          scripts: ensureBoolean(checks.scripts, "checks.scripts"),
          envFiles: ensureBoolean(checks.envFiles, "checks.envFiles"),
        }
      : undefined,
    expectations: expectations
      ? {
          scripts: ensureStringArray(expectations.scripts, "expectations.scripts"),
          envFiles: ensureStringArray(expectations.envFiles, "expectations.envFiles"),
        }
      : undefined,
    workspaces: workspaces
      ? {
          scan: ensureBoolean(workspaces.scan, "workspaces.scan"),
        }
      : undefined,
    output: output
      ? {
          format,
        }
      : undefined,
  };
}
