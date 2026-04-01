import type { RepoPreflightConfig, ScanSettings } from "../types";

const defaultScripts = ["dev", "build", "test"];
const defaultEnvFiles = [".env", ".env.local", ".env.example"];

export function resolveScanSettings(config?: RepoPreflightConfig): ScanSettings {
  return {
    checks: {
      scripts: config?.checks?.scripts ?? true,
      envFiles: config?.checks?.envFiles ?? true,
    },
    expectations: {
      scripts: config?.expectations?.scripts ?? [...defaultScripts],
      envFiles: config?.expectations?.envFiles ?? [...defaultEnvFiles],
    },
    workspaces: {
      scan: config?.workspaces?.scan ?? false,
    },
    output: {
      format: config?.output?.format ?? "text",
    },
  };
}
