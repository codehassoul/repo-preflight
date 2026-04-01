export type CheckStatus = "pass" | "info" | "warn" | "fail";

export type ReadinessVerdict = "Ready" | "Ready with warnings" | "Not ready";

export type OutputMode = "text" | "json";

export interface CheckResult {
  id: string;
  status: CheckStatus;
  message: string;
  suggestion?: string;
  metadata?: Record<string, string | number | boolean | string[] | undefined>;
}

export interface RepoPackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  main?: string;
  types?: string;
  module?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  packageManager?: string;
  engines?: {
    node?: string;
  };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface LoadedPackageJson {
  path: string;
  data: RepoPackageJson;
}

export interface PackageJsonLoadResult {
  packageJson?: LoadedPackageJson;
  error?: CheckResult;
}

export interface PackageManagerDetection {
  manager?: PackageManagerName;
  source: "packageManager" | "lockfile" | "workspaceRoot" | "unknown";
  result: CheckResult;
}

export interface SummaryCounts {
  pass: number;
  info: number;
  warn: number;
  fail: number;
}

export interface CheckToggles {
  scripts?: boolean;
  envFiles?: boolean;
}

export interface CheckExpectations {
  scripts?: string[];
  envFiles?: string[];
}

export interface WorkspaceConfig {
  scan?: boolean;
}

export interface OutputConfig {
  format?: OutputMode;
}

export interface RepoPreflightConfig {
  checks?: CheckToggles;
  expectations?: CheckExpectations;
  workspaces?: WorkspaceConfig;
  output?: OutputConfig;
}

export interface LoadedConfig {
  path: string;
  data: RepoPreflightConfig;
}

export interface ScanSettings {
  checks: {
    scripts: boolean;
    envFiles: boolean;
  };
  expectations: {
    scripts: string[];
    envFiles: string[];
  };
  workspaces: {
    scan: boolean;
  };
  output: {
    format: OutputMode;
  };
}

export interface WorkspaceDetection {
  isWorkspaceRoot: boolean;
  patterns: string[];
  sources: string[];
  hints: string[];
}

export interface RepoScanResult {
  kind: "root" | "workspace";
  name: string;
  path: string;
  results: CheckResult[];
  summary: SummaryCounts;
  verdict: ReadinessVerdict;
}

export interface WorkspaceRootContext {
  path: string;
  packageManager?: PackageManagerName;
}

export interface PreflightReport {
  targetDir: string;
  configPath?: string;
  outputMode?: OutputMode;
  workspaceDetection: WorkspaceDetection;
  root: RepoScanResult;
  workspaces: RepoScanResult[];
  summary: SummaryCounts;
  verdict: ReadinessVerdict;
  exitCode: number;
}
