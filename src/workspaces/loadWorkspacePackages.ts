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

function isNegatedPattern(pattern: string): boolean {
  return pattern.startsWith("!");
}

function normalizePattern(pattern: string): string {
  return isNegatedPattern(pattern) ? pattern.slice(1) : pattern;
}

function segmentToRegex(segment: string): RegExp {
  return new RegExp(`^${segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`);
}

function patternExplicitlyMatchesCandidate(targetDir: string, pattern: string, candidateDir: string): boolean {
  const patternSegments = splitPattern(normalizePattern(pattern));
  const candidateSegments = path.relative(targetDir, candidateDir).split(path.sep).filter(Boolean);

  if (patternSegments.includes("**") || patternSegments.length !== candidateSegments.length) {
    return false;
  }

  return patternSegments.every((segment, index) => {
    if (segment.includes("*")) {
      return segmentToRegex(segment).test(candidateSegments[index]);
    }

    return segment === candidateSegments[index];
  });
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

function hasExplicitWorkspacePattern(targetDir: string, candidateDir: string, matchingPatterns: Map<string, Set<string>>): boolean {
  return Boolean(
    matchingPatterns.get(candidateDir)?.size &&
      [...(matchingPatterns.get(candidateDir) ?? [])].some((pattern) =>
        patternExplicitlyMatchesCandidate(targetDir, pattern, candidateDir),
      ),
  );
}

export async function loadWorkspacePackages(targetDir: string, patterns: string[]): Promise<string[]> {
  const matches = new Set<string>();
  const excludedMatches = new Set<string>();
  const matchingPatterns = new Map<string, Set<string>>();

  for (const pattern of patterns) {
    const normalizedPattern = normalizePattern(pattern);
    const targetMatches = isNegatedPattern(pattern) ? excludedMatches : matches;

    for (const match of await expandSegments(targetDir, splitPattern(normalizedPattern))) {
      if (match !== targetDir && (await pathExists(path.join(match, "package.json")))) {
        const resolvedMatch = path.resolve(match);
        targetMatches.add(resolvedMatch);

        if (!isNegatedPattern(pattern)) {
          const existingPatterns = matchingPatterns.get(resolvedMatch) ?? new Set<string>();
          existingPatterns.add(pattern);
          matchingPatterns.set(resolvedMatch, existingPatterns);
        }
      }
    }
  }

  const candidates = [...matches].filter((candidate) => !excludedMatches.has(candidate)).sort((a, b) => {
    const depthDelta = a.split(path.sep).length - b.split(path.sep).length;
    return depthDelta === 0 ? a.localeCompare(b) : depthDelta;
  });

  const filtered: string[] = [];
  for (const candidate of candidates) {
    const hasExplicitPattern = hasExplicitWorkspacePattern(targetDir, candidate, matchingPatterns);

    if (hasIgnoredWorkspaceSegment(targetDir, candidate) && !hasExplicitPattern) {
      continue;
    }

    if (isNestedWithinWorkspaceRoot(candidate, filtered) && !hasExplicitPattern) {
      continue;
    }

    filtered.push(candidate);
  }

  return filtered.sort((a, b) => a.localeCompare(b));
}
