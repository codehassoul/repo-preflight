import path from "node:path";

import { pathExists, readDirNames } from "../utils/fs";

const IGNORED_WORKSPACE_SEGMENTS = new Set([
  "__test__",
  "__tests__",
  "example",
  "examples",
  "fixture",
  "fixtures",
  "playground",
  "playgrounds",
  "test",
  "tests",
]);

function splitPattern(pattern: string): string[] {
  return pattern.split("/").filter(Boolean);
}

async function expandSegments(baseDir: string, segments: string[]): Promise<string[]> {
  if (segments.length === 0) {
    return [baseDir];
  }

  const [segment, ...rest] = segments;

  if (segment === "**") {
    const matches = await expandSegments(baseDir, rest);
    const childDirs = await readDirNames(baseDir);

    for (const childDir of childDirs) {
      matches.push(...(await expandSegments(path.join(baseDir, childDir), segments)));
    }

    return matches;
  }

  if (segment.includes("*")) {
    const regex = new RegExp(`^${segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`);
    const childDirs = await readDirNames(baseDir);
    const matches: string[] = [];

    for (const childDir of childDirs) {
      if (regex.test(childDir)) {
        matches.push(...(await expandSegments(path.join(baseDir, childDir), rest)));
      }
    }

    return matches;
  }

  return expandSegments(path.join(baseDir, segment), rest);
}

function hasIgnoredWorkspaceSegment(targetDir: string, candidateDir: string): boolean {
  const relativeSegments = path.relative(targetDir, candidateDir).split(path.sep).filter(Boolean);
  return relativeSegments.some((segment) => IGNORED_WORKSPACE_SEGMENTS.has(segment.toLowerCase()));
}

function isNestedWithinWorkspaceRoot(candidateDir: string, acceptedDirs: string[]): boolean {
  return acceptedDirs.some((acceptedDir) => {
    const relativePath = path.relative(acceptedDir, candidateDir);
    return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
  });
}

export async function loadWorkspacePackages(targetDir: string, patterns: string[]): Promise<string[]> {
  const matches = new Set<string>();

  for (const pattern of patterns) {
    for (const match of await expandSegments(targetDir, splitPattern(pattern))) {
      if (match !== targetDir && (await pathExists(path.join(match, "package.json")))) {
        matches.add(path.resolve(match));
      }
    }
  }

  const candidates = [...matches].sort((a, b) => {
    const depthDelta = a.split(path.sep).length - b.split(path.sep).length;
    return depthDelta === 0 ? a.localeCompare(b) : depthDelta;
  });

  const filtered: string[] = [];
  for (const candidate of candidates) {
    if (hasIgnoredWorkspaceSegment(targetDir, candidate)) {
      continue;
    }

    if (isNestedWithinWorkspaceRoot(candidate, filtered)) {
      continue;
    }

    filtered.push(candidate);
  }

  return filtered.sort((a, b) => a.localeCompare(b));
}
