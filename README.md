# repo-preflight

Local-first CLI for checking whether a JavaScript or TypeScript repository is actually ready to work in.

[![npm version](https://img.shields.io/npm/v/repo-preflight.svg)](https://www.npmjs.com/package/repo-preflight)
[![license](https://img.shields.io/github/license/codehassoul/repo-preflight)](https://github.com/codehassoul/repo-preflight/blob/codex/release-polish/LICENSE)
[![CI](https://github.com/codehassoul/repo-preflight/actions/workflows/ci.yml/badge.svg?branch=codex/release-polish)](https://github.com/codehassoul/repo-preflight/actions/workflows/ci.yml)

`repo-preflight` is a local-first CLI for quickly answering a practical question:

> Is this JavaScript or TypeScript repo actually ready to work in?

It scans the target repository, reports the signals that matter most, and ends with a clear verdict:

- `Ready`
- `Ready with warnings`
- `Not ready`

The tool is designed to stay calm on healthy repos, avoid noisy false alarms, and keep every result actionable.

## Highlights

- Fast local scan with no network dependency
- Clear `PASS`, `INFO`, `WARN`, and `FAIL` checks
- Final readiness verdict plus summary counts
- Smarter heuristics for scripts and env files
- Optional workspace scanning for monorepos
- Human-readable text output and machine-friendly JSON output

## Install

```bash
npm install -g repo-preflight
```

Or run it without installing globally:

```bash
npx repo-preflight .
```

## Usage

Scan the current repository:

```bash
repo-preflight .
```

Scan another repository:

```bash
repo-preflight /path/to/repo
```

Scan a workspace root and include workspace packages:

```bash
repo-preflight . --workspaces
```

Emit JSON:

```bash
repo-preflight . --json
```

Show concise CI-friendly output:

```bash
repo-preflight . --ci
```

Use a specific config file:

```bash
repo-preflight . --config ./repo-preflight.config.json
```

## What It Checks

`repo-preflight` currently checks:

- `package.json` presence and readability
- Node version against `engines.node`
- package manager detection
- expected lockfile presence
- dependency install state via `node_modules`
- expected scripts such as `dev`, `build`, and `test`
- common env-file presence when repo signals suggest they matter

## Status Levels

- `PASS`: the expected signal is present and looks good
- `INFO`: useful context that should not make the repo feel unhealthy
- `WARN`: a meaningful issue that is likely worth fixing
- `FAIL`: a strong blocker or invalid setup

`INFO` checks do not affect the exit code.

## Verdict Rules

- any `FAIL` => `Not ready`
- no `FAIL` and at least one `WARN` => `Ready with warnings`
- otherwise => `Ready`

Exit code behavior:

- exit code `1` when any check is `FAIL`
- exit code `0` otherwise

## Smart Heuristics

Missing scripts are not warned blindly:

- missing `dev` is usually more important for app-like repos
- missing `dev` is often only informational for library-like repos
- missing `build` becomes more important when build tooling is present
- missing `test` becomes more important when test tooling is present

Env files are also handled conservatively:

- no warning by default just because `.env` is absent
- warnings appear when stronger signals exist, such as `.env.example`, env tooling, or script references to `.env`

## Monorepo Support

By default, `repo-preflight` scans only the target root. If the repo is a workspace root, you can opt in to workspace package scanning with `--workspaces`.

Workspace detection currently supports:

- `package.json` `workspaces`
- `pnpm-workspace.yaml`

When scanning workspaces, `repo-preflight` keeps the results focused on intended package roots. It honors negated workspace patterns such as `!packages/turbo`, filters accidental nested matches from broad globs inside common non-workspace containers such as `__tests__`, `fixtures`, and `playground` directories, and still preserves explicitly declared workspace paths even when they include names like `examples` or `tests`.

Package manager, lockfile, and install-state checks can still inherit from the workspace root where appropriate.

## Configuration

`repo-preflight` looks for `repo-preflight.config.json` in the target directory unless you pass `--config`.

Example:

```json
{
  "checks": {
    "scripts": true,
    "envFiles": true
  },
  "expectations": {
    "scripts": ["build", "test"],
    "envFiles": [".env.example", ".env.local"]
  },
  "workspaces": {
    "scan": true
  },
  "output": {
    "format": "text"
  }
}
```

Also included in the repo: `repo-preflight.config.example.json`

## Example Output

```text
Repo Preflight
Target: /path/to/repo

Root: my-app
Path: /path/to/repo
PASS  Found package-lock.json for npm.
INFO  Missing dev script.
WARN  node_modules is missing.
Verdict: Ready with warnings
Summary: 1 pass, 1 info, 1 warn, 0 fail
```

## Library API

You can also use the scanner programmatically:

```ts
import { runPreflight } from "repo-preflight";

const report = await runPreflight(process.cwd(), {
  workspaces: true,
  json: false,
});

console.log(report.verdict);
```

## Development

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

## Notes

- Node.js `20+` is required
- the package ships compiled output from `dist/`
- `prepublishOnly` runs the test suite before publish
- published releases are available on npm as `repo-preflight`
