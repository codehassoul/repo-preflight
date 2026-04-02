import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeCli, runPreflight } from "../src/cli";
import { checkEnvFiles } from "../src/checks/envFiles";
import { checkScripts } from "../src/checks/scripts";
import { loadConfig } from "../src/config/loadConfig";
import { parseCliArgs } from "../src/index";
import { formatJsonReport } from "../src/output/json";
import { formatTextReport } from "../src/output/text";
import type { RepoPackageJson } from "../src/types";
import { detectWorkspaces } from "../src/workspaces/detectWorkspaces";
import { loadWorkspacePackages } from "../src/workspaces/loadWorkspacePackages";
import { readPackageJson } from "../src/utils/readPackageJson";
import { getFixturePath } from "./fixtures";

async function makeRepo(setup?: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "repo-preflight-"));
  if (setup) {
    await setup(dir);
  }
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function writePackageJson(dir: string, packageJson: RepoPackageJson): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "package.json"), packageJson);
}

async function touch(dir: string, filename: string, contents = ""): Promise<void> {
  const filePath = path.join(dir, filename);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function executeJsonFixture(
  fixtureName: string,
  extraArgs: string[] = [],
): Promise<{ exitCode: number; payload: Record<string, unknown> }> {
  const fixturePath = getFixturePath(fixtureName);
  const writes: string[] = [];
  const exitCode = await executeCli([fixturePath, "--json", ...extraArgs], {
    stdout: (text) => writes.push(text),
    exit: () => undefined,
  });

  return {
    exitCode,
    payload: JSON.parse(writes.join("")) as Record<string, unknown>,
  };
}

function projectScanResult(scan: unknown): {
  keys: string[];
  name: string;
  verdict: string;
  summary: unknown;
  results: Array<{ id: string; status: string }>;
} {
  const value = scan as {
    name: string;
    verdict: string;
    summary: unknown;
    results: Array<{ id: string; status: string }>;
  };

  return {
    keys: Object.keys(value),
    name: value.name,
    verdict: value.verdict,
    summary: value.summary,
    results: value.results.map((result) => ({ id: result.id, status: result.status })),
  };
}

function projectJsonPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const workspaces = payload.workspaces as unknown[];
  const results = payload.results as Array<{ scope: string; id: string; status: string }>;

  return {
    keys: Object.keys(payload),
    targetPath: payload.targetPath,
    configPath: payload.configPath,
    verdict: payload.verdict,
    summary: payload.summary,
    workspace: {
      keys: Object.keys(payload.workspace as Record<string, unknown>),
      ...(payload.workspace as Record<string, unknown>),
    },
    root: projectScanResult(payload.root),
    workspaces: workspaces.map((workspace) => projectScanResult(workspace)),
    results: results.map((result) => ({
      keys: Object.keys(result),
      scope: result.scope,
      id: result.id,
      status: result.status,
    })),
  };
}

async function createHealthyRepo(dir: string, packageJsonOverrides: RepoPackageJson = {}): Promise<void> {
  await writePackageJson(dir, {
    name: "fixture",
    private: true,
    packageManager: "npm@10.0.0",
    engines: { node: ">=20" },
    scripts: {
      dev: "vite",
      build: "tsc -p tsconfig.json",
      test: "node --test",
      ...(packageJsonOverrides.scripts ?? {}),
    },
    ...packageJsonOverrides,
  });
  await touch(dir, "package-lock.json");
  await mkdir(path.join(dir, "node_modules"));
  await touch(dir, ".env.example");
}

test("config file loads correctly", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writeJson(path.join(repoDir, "repo-preflight.config.json"), {
      checks: { scripts: false, envFiles: false },
      expectations: { scripts: ["build", "test"], envFiles: [".env.ci"] },
      workspaces: { scan: true },
      output: { format: "json" },
    });
  });

  try {
    const result = await loadConfig(dir);
    assert.ok(result.config);
    assert.equal(result.config.data.checks?.scripts, false);
    assert.deepEqual(result.config.data.expectations?.scripts, ["build", "test"]);
    assert.deepEqual(result.config.data.expectations?.envFiles, [".env.ci"]);
    assert.equal(result.config.data.workspaces?.scan, true);
    assert.equal(result.config.data.output?.format, "json");
  } finally {
    await cleanup(dir);
  }
});

test("public entrypoint exports the library API", () => {
  const parsed = parseCliArgs([".", "--json"], process.cwd());

  assert.equal(parsed.json, true);
  assert.equal(typeof runPreflight, "function");
  assert.equal(typeof executeCli, "function");
});

test("disabled checks are skipped correctly", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir);
    await writeJson(path.join(repoDir, "repo-preflight.config.json"), {
      checks: { scripts: false, envFiles: false },
    });
  });

  try {
    const report = await runPreflight(dir);
    assert.equal(report.root.results.some((entry) => entry.id.startsWith("script:")), false);
    assert.equal(report.root.results.some((entry) => entry.id === "env-files"), false);
  } finally {
    await cleanup(dir);
  }
});

test("custom script expectations override defaults", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "fixture",
      private: true,
      scripts: { build: "tsc", test: "node --test" },
    });
  });

  try {
    const results = await checkScripts(dir, { scripts: { build: "tsc", test: "node --test" } }, [
      "build",
      "test",
    ]);

    assert.deepEqual(results.map((entry) => entry.id), ["script:build", "script:test"]);
    assert.deepEqual(results.map((entry) => entry.status), ["pass", "pass"]);
  } finally {
    await cleanup(dir);
  }
});

test("custom env expectations override defaults", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, { name: "fixture", private: true });
    await touch(repoDir, ".env.ci");
  });

  try {
    const result = await checkEnvFiles(dir, { name: "fixture", private: true }, [".env.ci"]);
    assert.equal(result.status, "pass");
    assert.match(result.message, /\.env\.ci/);
  } finally {
    await cleanup(dir);
  }
});

test("package.json with utf8 bom is parsed correctly", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await mkdir(repoDir, { recursive: true });
    await writeFile(
      path.join(repoDir, "package.json"),
      "\uFEFF" + JSON.stringify({ name: "bom-fixture", private: true }, null, 2),
    );
  });

  try {
    const result = await readPackageJson(dir);
    assert.equal(result.error, undefined);
    assert.equal(result.packageJson?.data.name, "bom-fixture");
  } finally {
    await cleanup(dir);
  }
});

test("JSON output structure is valid and stable", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir);
  });

  try {
    const report = await runPreflight(dir, { json: true });
    const payload = JSON.parse(formatJsonReport(report)) as Record<string, unknown>;

    assert.deepEqual(Object.keys(payload), [
      "targetPath",
      "configPath",
      "verdict",
      "summary",
      "workspace",
      "root",
      "workspaces",
      "results",
    ]);
    assert.equal(payload.verdict, "Ready");
  } finally {
    await cleanup(dir);
  }
});

test("JSON output includes verdict summary and results", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "fixture",
      private: true,
      packageManager: "npm@10.0.0",
      engines: { node: ">=20" },
      dependencies: { vite: "^5.0.0" },
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test",
      },
    });
    await touch(repoDir, "package-lock.json");
    await mkdir(path.join(repoDir, "node_modules"));
    await touch(repoDir, ".env.example");
  });

  try {
    const writes: string[] = [];
    const exitCode = await executeCli([dir, "--json"], {
      stdout: (text) => writes.push(text),
      exit: () => undefined,
    });

    const payload = JSON.parse(writes.join("")) as {
      verdict: string;
      summary: { warn: number };
      results: Array<{ id: string; status: string }>;
    };

    assert.equal(exitCode, 0);
    assert.equal(payload.verdict, "Ready with warnings");
    assert.equal(typeof payload.summary.warn, "number");
    assert.ok(payload.results.some((entry) => entry.id === "script:dev"));
  } finally {
    await cleanup(dir);
  }
});

test("workspace root detection from package.json workspaces", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "mono",
      private: true,
      workspaces: ["packages/*"],
    });
  });

  try {
    const detection = await detectWorkspaces(dir, {
      name: "mono",
      private: true,
      workspaces: ["packages/*"],
    });

    assert.equal(detection.isWorkspaceRoot, true);
    assert.deepEqual(detection.sources, ["package.json workspaces"]);
  } finally {
    await cleanup(dir);
  }
});

test("workspace root detection from pnpm-workspace.yaml", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, { name: "mono", private: true });
    await touch(repoDir, "pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
  });

  try {
    const detection = await detectWorkspaces(dir, { name: "mono", private: true });
    assert.equal(detection.isWorkspaceRoot, true);
    assert.deepEqual(detection.sources, ["pnpm-workspace.yaml"]);
  } finally {
    await cleanup(dir);
  }
});

test("root-only scan behavior by default", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/*"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "a"));
  });

  try {
    const report = await runPreflight(dir);
    assert.equal(report.workspaceDetection.isWorkspaceRoot, true);
    assert.equal(report.workspaces.length, 0);
  } finally {
    await cleanup(dir);
  }
});

test("workspace scanning with --workspaces", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/*"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "a"), { name: "package-a" });
    await createHealthyRepo(path.join(repoDir, "packages", "b"), { name: "package-b" });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.equal(report.workspaces.length, 2);
    assert.deepEqual(
      report.workspaces.map((workspace) => workspace.name),
      ["package-a", "package-b"],
    );
  } finally {
    await cleanup(dir);
  }
});

test("workspace scanning honors negated package.json workspaces", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/*", "!packages/b"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "a"), { name: "package-a" });
    await createHealthyRepo(path.join(repoDir, "packages", "b"), { name: "package-b" });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.deepEqual(
      report.workspaces.map((workspace) => workspace.name),
      ["package-a"],
    );
  } finally {
    await cleanup(dir);
  }
});

test("workspace scanning honors negated pnpm-workspace patterns", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
    });
    await touch(repoDir, "pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - '!packages/b'\n");
    await createHealthyRepo(path.join(repoDir, "packages", "a"), { name: "package-a" });
    await createHealthyRepo(path.join(repoDir, "packages", "b"), { name: "package-b" });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.deepEqual(
      report.workspaces.map((workspace) => workspace.name),
      ["package-a"],
    );
  } finally {
    await cleanup(dir);
  }
});

test("workspace packages inherit root package manager lockfile and install state", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "mono",
      private: true,
      packageManager: "pnpm@9.0.0",
      workspaces: ["packages/*"],
      scripts: { build: "turbo build", test: "turbo test" },
    });
    await touch(repoDir, "pnpm-lock.yaml");
    await mkdir(path.join(repoDir, "node_modules"));
    await writePackageJson(path.join(repoDir, "packages", "a"), {
      name: "package-a",
      private: true,
      scripts: { build: "tsc" },
    });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    const workspace = report.workspaces[0];

    assert.equal(workspace.results.find((entry) => entry.id === "package-manager")?.status, "pass");
    assert.match(
      workspace.results.find((entry) => entry.id === "package-manager")?.message ?? "",
      /workspace root/,
    );
    assert.equal(workspace.results.find((entry) => entry.id === "lockfile")?.status, "pass");
    assert.match(
      workspace.results.find((entry) => entry.id === "lockfile")?.message ?? "",
      /workspace root/,
    );
    assert.equal(workspace.results.find((entry) => entry.id === "dependencies")?.status, "pass");
    assert.match(
      workspace.results.find((entry) => entry.id === "dependencies")?.message ?? "",
      /workspace root/,
    );
  } finally {
    await cleanup(dir);
  }
});

test("workspace dependency check becomes info when root install is missing", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "mono",
      private: true,
      packageManager: "pnpm@9.0.0",
      workspaces: ["packages/*"],
    });
    await touch(repoDir, "pnpm-lock.yaml");
    await writePackageJson(path.join(repoDir, "packages", "a"), {
      name: "package-a",
      private: true,
    });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    const workspace = report.workspaces[0];

    assert.equal(report.root.results.find((entry) => entry.id === "dependencies")?.status, "warn");
    assert.equal(workspace.results.find((entry) => entry.id === "dependencies")?.status, "info");
    assert.match(
      workspace.results.find((entry) => entry.id === "dependencies")?.message ?? "",
      /workspace root install state/,
    );
  } finally {
    await cleanup(dir);
  }
});

test("workspace loading only includes directories with package.json", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/**"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "real-package"), { name: "real-package" });
    await touch(path.join(repoDir, "packages", "real-package", "__tests__"), "fixture.txt");
    await mkdir(path.join(repoDir, "packages", "fixtures", "no-package"), { recursive: true });
  });

  try {
    const workspaces = await loadWorkspacePackages(dir, ["packages/**"]);
    assert.deepEqual(workspaces, [path.join(dir, "packages", "real-package")]);
  } finally {
    await cleanup(dir);
  }
});

test("workspace loading excludes negated workspace matches", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/**", "!packages/excluded"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "included"), { name: "included" });
    await createHealthyRepo(path.join(repoDir, "packages", "excluded"), { name: "excluded" });
  });

  try {
    const workspaces = await loadWorkspacePackages(dir, ["packages/**", "!packages/excluded"]);
    assert.deepEqual(workspaces, [path.join(dir, "packages", "included")]);
  } finally {
    await cleanup(dir);
  }
});

test("workspace loading keeps explicit nested workspaces even when the parent is also a package", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["code", "code/addons/*", "scripts"],
    });
    await createHealthyRepo(path.join(repoDir, "code"), { name: "code-root" });
    await createHealthyRepo(path.join(repoDir, "code", "addons", "a11y"), { name: "addon-a11y" });
    await createHealthyRepo(path.join(repoDir, "code", "addons", "themes"), { name: "addon-themes" });
    await createHealthyRepo(path.join(repoDir, "scripts"), { name: "scripts-root" });
  });

  try {
    const workspaces = await loadWorkspacePackages(dir, ["code", "code/addons/*", "scripts"]);
    assert.deepEqual(workspaces, [
      path.join(dir, "code"),
      path.join(dir, "code", "addons", "a11y"),
      path.join(dir, "code", "addons", "themes"),
      path.join(dir, "scripts"),
    ]);
  } finally {
    await cleanup(dir);
  }
});

test("workspace loading ignores nested fixture, test, and playground package containers", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/**"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "app"), { name: "app" });
    await createHealthyRepo(path.join(repoDir, "packages", "app", "playground"), { name: "app-playground" });
    await createHealthyRepo(path.join(repoDir, "packages", "fixtures", "vite-app"), { name: "fixture-vite-app" });
    await createHealthyRepo(path.join(repoDir, "packages", "__tests__", "smoke-app"), { name: "smoke-app" });
    await createHealthyRepo(path.join(repoDir, "packages", "@scope", "kit"), { name: "@scope/kit" });
  });

  try {
    const workspaces = await loadWorkspacePackages(dir, ["packages/**"]);
    assert.deepEqual(workspaces, [
      path.join(dir, "packages", "@scope", "kit"),
      path.join(dir, "packages", "app"),
    ]);
  } finally {
    await cleanup(dir);
  }
});

test("workspace scanning omits nested non-workspace package roots from reports", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/**"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "app"), { name: "app" });
    await createHealthyRepo(path.join(repoDir, "packages", "app", "fixtures", "broken-case"), {
      name: "broken-case",
      scripts: {},
    });
    await createHealthyRepo(path.join(repoDir, "packages", "playgrounds", "sandbox"), {
      name: "sandbox",
    });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.deepEqual(
      report.workspaces.map((workspace) => workspace.name),
      ["app"],
    );
    assert.equal(report.workspaces.length, 1);
  } finally {
    await cleanup(dir);
  }
});

test("workspace orchestrator roots do not warn on missing dev when child packages own the app flow", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "mono",
      private: true,
      packageManager: "npm@10.0.0",
      workspaces: ["packages/*"],
      dependencies: {
        vite: "^5.0.0",
      },
      scripts: {
        build: "npm run build --workspaces",
        test: "npm run test --workspaces",
      },
    });
    await touch(repoDir, "package-lock.json");
    await mkdir(path.join(repoDir, "node_modules"));
    await writePackageJson(path.join(repoDir, "packages", "app"), {
      name: "workspace-app",
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest run",
      },
    });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.equal(report.root.results.find((entry) => entry.id === "script:dev")?.status, "info");
    assert.equal(report.root.verdict, "Ready");
  } finally {
    await cleanup(dir);
  }
});

test("docs workspaces can satisfy dev and build via docs-prefixed scripts", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "docs-site",
      private: true,
      scripts: {
        docs: "vitepress dev",
        "docs-build": "vitepress build",
      },
      devDependencies: {
        vitepress: "^2.0.0-alpha.15",
      },
    });
  });

  try {
    const results = await checkScripts(dir, {
      name: "docs-site",
      private: true,
      scripts: {
        docs: "vitepress dev",
        "docs-build": "vitepress build",
      },
      devDependencies: {
        vitepress: "^2.0.0-alpha.15",
      },
    });
    assert.equal(results.find((entry) => entry.id === "script:dev")?.status, "pass");
    assert.match(results.find((entry) => entry.id === "script:dev")?.message ?? "", /via docs script/);
    assert.equal(results.find((entry) => entry.id === "script:build")?.status, "pass");
    assert.match(results.find((entry) => entry.id === "script:build")?.message ?? "", /via docs-build script/);
    assert.equal(results.find((entry) => entry.id === "script:test")?.status, "info");
  } finally {
    await cleanup(dir);
  }
});

test("cross-env usage without env files stays informational", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "cross-env-app",
      private: true,
      packageManager: "npm@10.0.0",
      scripts: {
        dev: "cross-env NODE_ENV=development vite",
        build: "tsc -p tsconfig.json",
        test: "node --test",
      },
      devDependencies: {
        "cross-env": "^7.0.3",
      },
    });
    await touch(repoDir, "package-lock.json");
    await mkdir(path.join(repoDir, "node_modules"));
    await touch(repoDir, "src/main.ts", "console.log(process.env.NODE_ENV);");
  });

  try {
    const result = await checkEnvFiles(dir, {
      name: "cross-env-app",
      private: true,
      packageManager: "npm@10.0.0",
      scripts: {
        dev: "cross-env NODE_ENV=development vite",
        build: "tsc -p tsconfig.json",
        test: "node --test",
      },
      devDependencies: {
        "cross-env": "^7.0.3",
      },
    });
    assert.equal(result.status, "info");
  } finally {
    await cleanup(dir);
  }
});

test("aggregated verdict across workspaces", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/*"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "good"), { name: "good-package" });
    await writePackageJson(path.join(repoDir, "packages", "bad"), {
      name: "bad-package",
      private: true,
      packageManager: "npm@10.0.0",
      engines: { node: ">=30" },
      scripts: { dev: "vite", build: "tsc", test: "node --test" },
    });
    await mkdir(path.join(repoDir, "packages", "bad", "node_modules"), { recursive: true });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    assert.equal(report.verdict, "Not ready");
    assert.equal(report.summary.fail > 0, true);
  } finally {
    await cleanup(dir);
  }
});

test("CI mode output remains concise", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test",
      },
    });
  });

  try {
    const report = await runPreflight(dir);
    const output = formatTextReport(report, { ci: true });

    assert.match(output, /^repo-preflight target=/);
    assert.doesNotMatch(output, /Suggestion:/);
    assert.doesNotMatch(output, /Repo Preflight/);
  } finally {
    await cleanup(dir);
  }
});

test("workspace text output includes repo-level rollup", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await writePackageJson(repoDir, {
      name: "mono",
      private: true,
      packageManager: "pnpm@9.0.0",
      workspaces: ["packages/*"],
    });
    await touch(repoDir, "pnpm-lock.yaml");
    await mkdir(path.join(repoDir, "node_modules"));
    await writePackageJson(path.join(repoDir, "packages", "a"), {
      name: "package-a",
      private: true,
    });
  });

  try {
    const report = await runPreflight(dir, { workspaces: true });
    const output = formatTextReport(report);

    assert.match(output, /Workspace rollup: 1 scanned/);
    assert.match(output, /Checks: /);
  } finally {
    await cleanup(dir);
  }
});

test("exit code stays non-zero only when any FAIL exists anywhere in the scanned scope", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir, {
      name: "mono",
      workspaces: ["packages/*"],
    });
    await createHealthyRepo(path.join(repoDir, "packages", "ok"), { name: "ok-package" });
    await writePackageJson(path.join(repoDir, "packages", "broken"), {
      name: "broken-package",
      private: true,
      packageManager: "npm@10.0.0",
      engines: { node: ">=30" },
      scripts: { dev: "vite", build: "tsc", test: "node --test" },
    });
    await touch(path.join(repoDir, "packages", "broken"), "package-lock.json");
    await mkdir(path.join(repoDir, "packages", "broken", "node_modules"), { recursive: true });
  });

  try {
    let exitCode = -1;
    const returnedCode = await executeCli([dir, "--workspaces"], {
      stdout: () => undefined,
      exit: (code) => {
        exitCode = code;
      },
    });

    assert.equal(returnedCode, 1);
    assert.equal(exitCode, 1);
  } finally {
    await cleanup(dir);
  }
});

test("healthy repos still produce calm output with no warning inflation", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir);
  });

  try {
    const report = await runPreflight(dir);
    const output = formatTextReport(report);

    assert.equal(report.verdict, "Ready");
    assert.equal(report.summary.warn, 0);
    assert.equal(report.summary.fail, 0);
    assert.doesNotMatch(output, /WARN/);
  } finally {
    await cleanup(dir);
  }
});

test("root-only text output does not repeat the final verdict block", async () => {
  const dir = await makeRepo(async (repoDir) => {
    await createHealthyRepo(repoDir);
  });

  try {
    const report = await runPreflight(dir);
    const output = formatTextReport(report);

    assert.equal((output.match(/Verdict: Ready/g) ?? []).length, 1);
    assert.equal((output.match(/Summary: 8 pass, 0 info, 0 warn, 0 fail/g) ?? []).length, 1);
  } finally {
    await cleanup(dir);
  }
});

test("fixture regression matrix produces the expected verdicts", async () => {
  const cases: Array<{
    fixture: string;
    verdict: string;
    exitCode: number;
    extraArgs?: string[];
  }> = [
    { fixture: "single-app", verdict: "Ready", exitCode: 0 },
    { fixture: "single-library", verdict: "Ready", exitCode: 0 },
    { fixture: "npm-workspace", verdict: "Ready", exitCode: 0, extraArgs: ["--workspaces"] },
    { fixture: "pnpm-monorepo", verdict: "Ready", exitCode: 0, extraArgs: ["--workspaces"] },
    { fixture: "broken-repo", verdict: "Not ready", exitCode: 1 },
    { fixture: "env-heavy-repo", verdict: "Ready with warnings", exitCode: 0 },
  ];

  for (const testCase of cases) {
    const { fixture, verdict, exitCode, extraArgs = [] } = testCase;
    const report = await runPreflight(getFixturePath(fixture), {
      workspaces: extraArgs.includes("--workspaces"),
      json: true,
    });
    const cliRun = await executeJsonFixture(fixture, extraArgs);

    assert.equal(report.verdict, verdict, fixture);
    assert.equal(report.exitCode, exitCode, fixture);
    assert.equal(cliRun.payload.verdict, verdict, fixture);
    assert.equal(cliRun.exitCode, exitCode, fixture);
  }
});

test("fixture JSON output shape is locked down for the regression matrix", async () => {
  const singleAppPath = getFixturePath("single-app");
  const singleLibraryPath = getFixturePath("single-library");
  const npmWorkspacePath = getFixturePath("npm-workspace");
  const pnpmMonorepoPath = getFixturePath("pnpm-monorepo");
  const brokenRepoPath = getFixturePath("broken-repo");
  const envHeavyRepoPath = getFixturePath("env-heavy-repo");

  const singleApp = projectJsonPayload((await executeJsonFixture("single-app")).payload);
  const singleLibrary = projectJsonPayload((await executeJsonFixture("single-library")).payload);
  const npmWorkspace = projectJsonPayload((await executeJsonFixture("npm-workspace", ["--workspaces"])).payload);
  const pnpmMonorepo = projectJsonPayload((await executeJsonFixture("pnpm-monorepo", ["--workspaces"])).payload);
  const brokenRepo = projectJsonPayload((await executeJsonFixture("broken-repo")).payload);
  const envHeavyRepo = projectJsonPayload((await executeJsonFixture("env-heavy-repo")).payload);

  assert.deepEqual(singleApp, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: singleAppPath,
    configPath: null,
    verdict: "Ready",
    summary: { pass: 8, info: 0, warn: 0, fail: 0 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: false,
      sources: [],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "fixture-single-app",
      verdict: "Ready",
      summary: { pass: 8, info: 0, warn: 0, fail: 0 },
      results: [
        { id: "node-version", status: "pass" },
        { id: "package-manager", status: "pass" },
        { id: "lockfile", status: "pass" },
        { id: "dependencies", status: "pass" },
        { id: "script:dev", status: "pass" },
        { id: "script:build", status: "pass" },
        { id: "script:test", status: "pass" },
        { id: "env-files", status: "pass" },
      ],
    },
    workspaces: [],
    results: [
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "node-version", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "metadata"],
        scope: "root",
        id: "env-files",
        status: "pass",
      },
    ],
  });

  assert.deepEqual(singleLibrary, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: singleLibraryPath,
    configPath: null,
    verdict: "Ready",
    summary: { pass: 6, info: 2, warn: 0, fail: 0 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: false,
      sources: [],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "fixture-single-library",
      verdict: "Ready",
      summary: { pass: 6, info: 2, warn: 0, fail: 0 },
      results: [
        { id: "node-version", status: "pass" },
        { id: "package-manager", status: "pass" },
        { id: "lockfile", status: "pass" },
        { id: "dependencies", status: "pass" },
        { id: "script:dev", status: "info" },
        { id: "script:build", status: "pass" },
        { id: "script:test", status: "pass" },
        { id: "env-files", status: "info" },
      ],
    },
    workspaces: [],
    results: [
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "node-version", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "dependencies", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "root",
        id: "script:dev",
        status: "info",
      },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "root",
        id: "env-files",
        status: "info",
      },
    ],
  });

  assert.deepEqual(npmWorkspace, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: npmWorkspacePath,
    configPath: null,
    verdict: "Ready",
    summary: { pass: 13, info: 3, warn: 0, fail: 0 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: true,
      sources: ["package.json workspaces"],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "fixture-npm-workspace",
      verdict: "Ready",
      summary: { pass: 7, info: 1, warn: 0, fail: 0 },
      results: [
        { id: "node-version", status: "pass" },
        { id: "package-manager", status: "pass" },
        { id: "lockfile", status: "pass" },
        { id: "dependencies", status: "pass" },
        { id: "script:dev", status: "pass" },
        { id: "script:build", status: "pass" },
        { id: "script:test", status: "pass" },
        { id: "env-files", status: "info" },
      ],
    },
    workspaces: [
      {
        keys: ["name", "path", "verdict", "summary", "results"],
        name: "workspace-app",
        verdict: "Ready",
        summary: { pass: 6, info: 2, warn: 0, fail: 0 },
        results: [
          { id: "node-version", status: "info" },
          { id: "package-manager", status: "pass" },
          { id: "lockfile", status: "pass" },
          { id: "dependencies", status: "pass" },
          { id: "script:dev", status: "pass" },
          { id: "script:build", status: "pass" },
          { id: "script:test", status: "pass" },
          { id: "env-files", status: "info" },
        ],
      },
    ],
    results: [
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "node-version", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "root",
        id: "env-files",
        status: "info",
      },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion"],
        scope: "workspace-app",
        id: "node-version",
        status: "info",
      },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "workspace-app", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "workspace-app",
        id: "env-files",
        status: "info",
      },
    ],
  });

  assert.deepEqual(pnpmMonorepo, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: pnpmMonorepoPath,
    configPath: null,
    verdict: "Ready",
    summary: { pass: 13, info: 3, warn: 0, fail: 0 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: true,
      sources: ["package.json workspaces", "pnpm-workspace.yaml"],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "fixture-pnpm-monorepo",
      verdict: "Ready",
      summary: { pass: 7, info: 1, warn: 0, fail: 0 },
      results: [
        { id: "node-version", status: "pass" },
        { id: "package-manager", status: "pass" },
        { id: "lockfile", status: "pass" },
        { id: "dependencies", status: "pass" },
        { id: "script:dev", status: "pass" },
        { id: "script:build", status: "pass" },
        { id: "script:test", status: "pass" },
        { id: "env-files", status: "info" },
      ],
    },
    workspaces: [
      {
        keys: ["name", "path", "verdict", "summary", "results"],
        name: "web-app",
        verdict: "Ready",
        summary: { pass: 6, info: 2, warn: 0, fail: 0 },
        results: [
          { id: "node-version", status: "info" },
          { id: "package-manager", status: "pass" },
          { id: "lockfile", status: "pass" },
          { id: "dependencies", status: "pass" },
          { id: "script:dev", status: "pass" },
          { id: "script:build", status: "pass" },
          { id: "script:test", status: "pass" },
          { id: "env-files", status: "info" },
        ],
      },
    ],
    results: [
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "node-version", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "root",
        id: "env-files",
        status: "info",
      },
      { keys: ["scope", "path", "id", "status", "message", "suggestion"], scope: "web-app", id: "node-version", status: "info" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "web-app", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "web-app",
        id: "env-files",
        status: "info",
      },
    ],
  });

  assert.deepEqual(brokenRepo, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: brokenRepoPath,
    configPath: null,
    verdict: "Not ready",
    summary: { pass: 0, info: 0, warn: 0, fail: 1 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: false,
      sources: [],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "broken-repo",
      verdict: "Not ready",
      summary: { pass: 0, info: 0, warn: 0, fail: 1 },
      results: [{ id: "package-json", status: "fail" }],
    },
    workspaces: [],
    results: [
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion"],
        scope: "root",
        id: "package-json",
        status: "fail",
      },
    ],
  });

  assert.deepEqual(envHeavyRepo, {
    keys: ["targetPath", "configPath", "verdict", "summary", "workspace", "root", "workspaces", "results"],
    targetPath: envHeavyRepoPath,
    configPath: null,
    verdict: "Ready with warnings",
    summary: { pass: 7, info: 0, warn: 1, fail: 0 },
    workspace: {
      keys: ["isWorkspaceRoot", "sources", "hints"],
      isWorkspaceRoot: false,
      sources: [],
      hints: [],
    },
    root: {
      keys: ["name", "path", "verdict", "summary", "results"],
      name: "fixture-env-heavy",
      verdict: "Ready with warnings",
      summary: { pass: 7, info: 0, warn: 1, fail: 0 },
      results: [
        { id: "node-version", status: "pass" },
        { id: "package-manager", status: "pass" },
        { id: "lockfile", status: "pass" },
        { id: "dependencies", status: "pass" },
        { id: "script:dev", status: "pass" },
        { id: "script:build", status: "pass" },
        { id: "script:test", status: "pass" },
        { id: "env-files", status: "warn" },
      ],
    },
    workspaces: [],
    results: [
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "node-version", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "package-manager", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "lockfile", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "dependencies", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:dev", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:build", status: "pass" },
      { keys: ["scope", "path", "id", "status", "message"], scope: "root", id: "script:test", status: "pass" },
      {
        keys: ["scope", "path", "id", "status", "message", "suggestion", "metadata"],
        scope: "root",
        id: "env-files",
        status: "warn",
      },
    ],
  });
});

test("fixture workspaces inherit package manager, lockfile, and install state from the root", async () => {
  const npmReport = await runPreflight(getFixturePath("npm-workspace"), { workspaces: true });
  const pnpmReport = await runPreflight(getFixturePath("pnpm-monorepo"), { workspaces: true });

  const workspaceChecks = [npmReport.workspaces[0], pnpmReport.workspaces[0]];

  for (const workspace of workspaceChecks) {
    assert.equal(workspace.results.find((entry) => entry.id === "package-manager")?.status, "pass");
    assert.match(workspace.results.find((entry) => entry.id === "package-manager")?.message ?? "", /workspace root/);
    assert.equal(workspace.results.find((entry) => entry.id === "lockfile")?.status, "pass");
    assert.match(workspace.results.find((entry) => entry.id === "lockfile")?.message ?? "", /workspace root/);
    assert.equal(workspace.results.find((entry) => entry.id === "dependencies")?.status, "pass");
    assert.match(workspace.results.find((entry) => entry.id === "dependencies")?.message ?? "", /workspace root/);
  }
});

test("fixture BOM regression still parses package.json correctly", async () => {
  const dir = await makeRepo(async (repoDir) => {
    const fixturePath = getFixturePath("single-app");
    const rawFixture = await readPackageJson(fixturePath);
    await mkdir(repoDir, { recursive: true });
    await writeFile(
      path.join(repoDir, "package.json"),
      "\uFEFF" + JSON.stringify(rawFixture.packageJson?.data, null, 2),
    );
  });

  try {
    const result = await readPackageJson(dir);
    assert.equal(result.error, undefined);
    assert.equal(result.packageJson?.data.name, "fixture-single-app");
  } finally {
    await cleanup(dir);
  }
});
