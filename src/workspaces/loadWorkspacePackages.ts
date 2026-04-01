import path from "node:path";

import { pathExists, readDirNames } from "../utils/fs";

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

export async function loadWorkspacePackages(targetDir: string, patterns: string[]): Promise<string[]> {
  const matches = new Set<string>();

  for (const pattern of patterns) {
    for (const match of await expandSegments(targetDir, splitPattern(pattern))) {
      if (match !== targetDir && (await pathExists(path.join(match, "package.json")))) {
        matches.add(path.resolve(match));
      }
    }
  }

  return [...matches].sort((a, b) => a.localeCompare(b));
}
