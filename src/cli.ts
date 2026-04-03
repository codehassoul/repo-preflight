import path from "node:path";

import { checkDependenciesInstalled } from "./checks/dependencies";
import { checkEnvFiles } from "./checks/envFiles";
import { checkLockfile } from "./checks/lockfile";
import { checkNodeVersion } from "./checks/nodeVersion";
import { detectPackageManager } from "./checks/packageManager";
import { checkScripts } from "./checks/scripts";
import { loadConfig } from "./config/loadConfig";
import { resolveScanSettings } from "./config/resolveSettings";
import { formatJsonReport } from "./output/json";
import { formatTextReport } from "./output/text";
import type {
  CheckResult,
  PreflightReport,
  RepoPackageJson,
  RepoScanResult,
  ScanSettings,
  WorkspaceRootContext,
} from "./types";
import { mergeSummaries, summarizeResults, getVerdictFromResults, getVerdictFromSummaries } from "./utils/aggregate";
import { readPackageJson } from "./utils/readPackageJson";
import { detectWorkspaces } from "./workspaces/detectWorkspaces";
import { loadWorkspacePackages } from "./workspaces/loadWorkspacePackages";

export interface ParsedCliArgs {
  targetDir: string;
  showHelp: boolean;
  json: boolean;
  ci: boolean;
  workspaces: boolean;
  configPath?: string;
}

export interface CliRuntime {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  exit?: (code: number) => never | void;
}

function createFailureResult(message: string, suggestion?: string): CheckResult {
  return {
    id: "runtime",
    status: "fail",
    message,
    suggestion,
  };
}

function createRepoScanResult(
  kind: "root" | "workspace",
  repoPath: string,
  packageJson: RepoPackageJson | undefined,
  results: CheckResult[],
): RepoScanResult {
  const summary = summarizeResults(results);

  return {
    kind,
    name: packageJson?.name ?? path.basename(repoPath),
    path: repoPath,
    results,
    summary,
    verdict: getVerdictFromResults(results),
  };
}

async function scanRepo(
  repoPath: string,
  kind: "root" | "workspace",
  settings: ScanSettings,
  workspaceRoot?: WorkspaceRootContext,
): Promise<RepoScanResult> {
  const results: CheckResult[] = [];
  const packageJsonResult = await readPackageJson(repoPath);

  if (packageJsonResult.error) {
    results.push(packageJsonResult.error);
    return createRepoScanResult(kind, repoPath, undefined, results);
  }

  const packageJson = packageJsonResult.packageJson?.data;
  const nodeVersionResult = checkNodeVersion(packageJson);
  if (nodeVersionResult) {
    results.push(nodeVersionResult);
  }

  const packageManagerDetection = await detectPackageManager(repoPath, packageJson, {
    workspaceRootManager: kind === "workspace" ? workspaceRoot?.packageManager : undefined,
  });
  results.push(packageManagerDetection.result);
  results.push(
    await checkLockfile(repoPath, packageManagerDetection.manager, {
      workspaceRootDir: kind === "workspace" ? workspaceRoot?.path : undefined,
    }),
  );
  results.push(
    await checkDependenciesInstalled(repoPath, {
      workspaceRootDir: kind === "workspace" ? workspaceRoot?.path : undefined,
      packageManager: packageManagerDetection.manager,
    }),
  );

  if (settings.checks.scripts) {
    results.push(...(await checkScripts(repoPath, packageJson, settings.expectations.scripts)));
  }

  if (settings.checks.envFiles) {
    results.push(await checkEnvFiles(repoPath, packageJson, settings.expectations.envFiles));
  }

  return createRepoScanResult(kind, repoPath, packageJson, results);
}

function buildFailureReport(
  targetDir: string,
  result: CheckResult,
  configPath?: string,
  outputMode: "text" | "json" = "text",
): PreflightReport {
  const root = createRepoScanResult("root", targetDir, undefined, [result]);
  return {
    targetDir,
    configPath,
    outputMode,
    workspaceDetection: {
      isWorkspaceRoot: false,
      patterns: [],
      sources: [],
      hints: [],
    },
    root,
    workspaces: [],
    summary: root.summary,
    verdict: root.verdict,
    exitCode: 1,
  };
}

function mergeCliSettings(base: ScanSettings, args: ParsedCliArgs): ScanSettings {
  return {
    ...base,
    workspaces: {
      scan: args.workspaces || base.workspaces.scan,
    },
    output: {
      format: args.json ? "json" : base.output.format,
    },
  };
}

export function parseCliArgs(argv: string[], cwd = process.cwd()): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    targetDir: cwd,
    showHelp: false,
    json: false,
    ci: false,
    workspaces: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      parsed.showHelp = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--ci") {
      parsed.ci = true;
      continue;
    }

    if (arg === "--workspaces") {
      parsed.workspaces = true;
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --config.");
      }

      parsed.configPath = nextArg;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    parsed.targetDir = path.resolve(cwd, arg);
  }

  return parsed;
}

export async function runPreflight(
  targetDir: string,
  options?: { configPath?: string; workspaces?: boolean; json?: boolean; configBaseDir?: string },
): Promise<PreflightReport> {
  const resolvedTargetDir = path.resolve(targetDir);
  const configLoad = await loadConfig(
    resolvedTargetDir,
    options?.configPath,
    options?.configBaseDir ?? process.cwd(),
  );
  if (configLoad.error) {
    return buildFailureReport(
      resolvedTargetDir,
      configLoad.error,
      options?.configPath,
      options?.json ? "json" : "text",
    );
  }

  const config = configLoad.config;
  const settings = mergeCliSettings(resolveScanSettings(config?.data), {
    targetDir: resolvedTargetDir,
    showHelp: false,
    json: options?.json ?? false,
    ci: false,
    workspaces: options?.workspaces ?? false,
    configPath: options?.configPath,
  });

  const rootPackageJson = await readPackageJson(resolvedTargetDir);
  const workspaceDetection = await detectWorkspaces(resolvedTargetDir, rootPackageJson.packageJson?.data);
  const rootPackageManagerDetection = await detectPackageManager(
    resolvedTargetDir,
    rootPackageJson.packageJson?.data,
  );
  const root = await scanRepo(resolvedTargetDir, "root", settings);
  const workspaces: RepoScanResult[] = [];
  const workspaceRoot: WorkspaceRootContext = {
    path: resolvedTargetDir,
    packageManager: rootPackageManagerDetection.manager,
  };

  if (settings.workspaces.scan && workspaceDetection.isWorkspaceRoot) {
    const workspaceDirs = await loadWorkspacePackages(resolvedTargetDir, workspaceDetection.patterns);

    for (const workspaceDir of workspaceDirs) {
      workspaces.push(await scanRepo(workspaceDir, "workspace", settings, workspaceRoot));
    }
  }

  const summary = mergeSummaries([root.summary, ...workspaces.map((workspace) => workspace.summary)]);
  const verdict = getVerdictFromSummaries([root.summary, ...workspaces.map((workspace) => workspace.summary)]);

  return {
    targetDir: resolvedTargetDir,
    configPath: config?.path,
    outputMode: settings.output.format,
    workspaceDetection,
    root,
    workspaces,
    summary,
    verdict,
    exitCode: summary.fail > 0 ? 1 : 0,
  };
}

export async function executeCli(argv: string[], runtime: CliRuntime = {}): Promise<number> {
  const cwd = runtime.cwd ?? process.cwd();
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));
  const exit = runtime.exit ?? ((code: number) => process.exit(code));

  try {
    const parsed = parseCliArgs(argv, cwd);

    if (parsed.showHelp) {
      stdout("Usage: repo-preflight [path] [--json] [--ci] [--workspaces] [--config <path>]\n");
      exit(0);
      return 0;
    }

    const report = await runPreflight(parsed.targetDir, {
      configPath: parsed.configPath,
      workspaces: parsed.workspaces,
      json: parsed.json,
      configBaseDir: cwd,
    });

    const output =
      report.outputMode === "json"
        ? formatJsonReport(report)
        : formatTextReport(report, { ci: parsed.ci });

    stdout(`${output}\n`);
    exit(report.exitCode);
    return report.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureReport = buildFailureReport(cwd, createFailureResult(`Unexpected error: ${message}`));
    stderr(`${formatTextReport(failureReport, { ci: true })}\n`);
    exit(1);
    return 1;
  }
}
