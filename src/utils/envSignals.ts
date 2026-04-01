import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RepoPackageJson } from "../types";
import { pathExists } from "./fs";

export interface EnvSignalSummary {
  expectsEnvFiles: boolean;
  hasEnvUsage: boolean;
  reasons: string[];
}

const envToolDependencies = ["dotenv", "dotenv-cli", "env-cmd", "cross-env"];
const sourceDirs = ["src", "app", "pages", "lib"];
const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx", ".jsx"]);
const sourceScanLimit = 24;
const fileSizeLimitBytes = 64 * 1024;

function collectDependencyNames(packageJson: RepoPackageJson | undefined): Set<string> {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
}

function hasEnvInScripts(scripts: Record<string, string>): boolean {
  return Object.values(scripts).some((command) =>
    /(dotenv|dotenvx|env-cmd|cross-env|\.env(\.[\w-]+)?)/i.test(command),
  );
}

async function findEnvUsageInSources(targetDir: string): Promise<boolean> {
  const queue = sourceDirs.map((dir) => path.join(targetDir, dir));
  let scannedFiles = 0;

  while (queue.length > 0 && scannedFiles < sourceScanLimit) {
    const currentPath = queue.shift()!;
    let entries;

    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (scannedFiles >= sourceScanLimit) {
        break;
      }

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!sourceExtensions.has(path.extname(entry.name))) {
        continue;
      }

      scannedFiles += 1;

      try {
        const contents = await readFile(entryPath, "utf8");
        if (contents.length > fileSizeLimitBytes) {
          continue;
        }

        if (contents.includes("process.env") || contents.includes("import.meta.env")) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}

export async function detectEnvSignals(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
): Promise<EnvSignalSummary> {
  const strongReasons: string[] = [];
  const usageReasons: string[] = [];
  const scripts = packageJson?.scripts ?? {};
  const dependencyNames = collectDependencyNames(packageJson);

  if (hasEnvInScripts(scripts)) {
    strongReasons.push("package.json scripts reference env tooling");
  }

  if (envToolDependencies.some((name) => dependencyNames.has(name))) {
    strongReasons.push("dependencies include env tooling");
  }

  if (await findEnvUsageInSources(targetDir)) {
    usageReasons.push("source files reference environment variables");
  }

  if (
    (await pathExists(path.join(targetDir, ".env.example"))) &&
    !(await pathExists(path.join(targetDir, ".env"))) &&
    !(await pathExists(path.join(targetDir, ".env.local")))
  ) {
    strongReasons.push(".env.example exists without a local env file");
  }

  return {
    expectsEnvFiles: strongReasons.length > 0,
    hasEnvUsage: strongReasons.length > 0 || usageReasons.length > 0,
    reasons: [...strongReasons, ...usageReasons],
  };
}
