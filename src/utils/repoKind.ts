import path from "node:path";

import type { RepoPackageJson } from "../types";
import { pathExists } from "./fs";

export interface RepoKindSignals {
  isLikelyLibrary: boolean;
  isLikelyApp: boolean;
  isLikelyDocs: boolean;
  isWorkspaceOrchestratorRoot: boolean;
  hasBuildSignals: boolean;
  hasTestSignals: boolean;
}

const appDependencyNames = [
  "vite",
  "next",
  "react-scripts",
  "@sveltejs/kit",
  "nuxt",
  "parcel",
  "webpack-dev-server",
];

const docsDependencyNames = [
  "vitepress",
  "docusaurus",
  "@docusaurus/core",
  "nextra",
  "docsify-cli",
];

const buildDependencyNames = [
  "typescript",
  "tsup",
  "rollup",
  "vite",
  "webpack",
  "esbuild",
  "@swc/cli",
  "swc",
];

const testDependencyNames = [
  "vitest",
  "jest",
  "mocha",
  "playwright",
  "@playwright/test",
  "@testing-library/react",
  "@testing-library/vue",
  "@testing-library/svelte",
  "@testing-library/dom",
];

const buildConfigNames = [
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "rollup.config.js",
  "rollup.config.ts",
  "webpack.config.js",
  "webpack.config.ts",
];

function collectDependencyNames(packageJson: RepoPackageJson | undefined): Set<string> {
  return new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
}

export async function detectRepoKind(
  targetDir: string,
  packageJson: RepoPackageJson | undefined,
): Promise<RepoKindSignals> {
  const dependencyNames = collectDependencyNames(packageJson);
  const scripts = packageJson?.scripts ?? {};

  const hasLibraryFields = Boolean(
    packageJson?.main || packageJson?.types || packageJson?.module || packageJson?.exports,
  );
  const hasPublishedIdentity = Boolean(packageJson?.name && packageJson?.version && !packageJson?.private);
  const isLikelyLibrary = hasLibraryFields || hasPublishedIdentity;

  const hasAppDependency = appDependencyNames.some((name) => dependencyNames.has(name));
  const hasAppScript = Object.keys(scripts).some((scriptName) =>
    ["dev", "start", "serve", "preview"].includes(scriptName),
  );
  const isLikelyApp = hasAppDependency || hasAppScript;
  const isLikelyDocs =
    docsDependencyNames.some((name) => dependencyNames.has(name)) ||
    Object.keys(scripts).some((scriptName) => scriptName === "docs" || scriptName.startsWith("docs-"));
  const isWorkspaceOrchestratorRoot = Boolean(packageJson?.workspaces) || (await pathExists(path.join(targetDir, "pnpm-workspace.yaml")));

  const hasBuildDependency = buildDependencyNames.some((name) => dependencyNames.has(name));
  const hasBuildConfig = (
    await Promise.all(buildConfigNames.map((filename) => pathExists(path.join(targetDir, filename))))
  ).some(Boolean);
  const hasTypeScriptSource = await pathExists(path.join(targetDir, "src"));
  const hasBuildSignals = hasBuildDependency || hasBuildConfig || hasTypeScriptSource;
  const hasTestSignals = testDependencyNames.some((name) => dependencyNames.has(name));

  return {
    isLikelyLibrary,
    isLikelyApp,
    isLikelyDocs,
    isWorkspaceOrchestratorRoot,
    hasBuildSignals,
    hasTestSignals,
  };
}
