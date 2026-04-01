import semver from "semver";

import type { CheckResult, RepoPackageJson } from "../types";

export function checkNodeVersion(
  packageJson: RepoPackageJson | undefined,
  currentNodeVersion = process.version,
): CheckResult | undefined {
  if (!packageJson) {
    return undefined;
  }

  const requiredRange = packageJson.engines?.node;

  if (!requiredRange) {
    return {
      id: "node-version",
      status: "info",
      message: `No engines.node requirement defined. Current runtime is ${currentNodeVersion}.`,
      suggestion: "Add engines.node to package.json so the expected runtime is explicit.",
    };
  }

  if (!semver.validRange(requiredRange)) {
    return {
      id: "node-version",
      status: "fail",
      message: `Invalid engines.node range "${requiredRange}".`,
      suggestion: "Use a valid semver range in package.json engines.node.",
    };
  }

  const normalizedVersion = semver.coerce(currentNodeVersion)?.version;
  const isCompatible = normalizedVersion ? semver.satisfies(normalizedVersion, requiredRange) : false;

  if (isCompatible) {
    return {
      id: "node-version",
      status: "pass",
      message: `Node ${currentNodeVersion} satisfies engines.node ${requiredRange}.`,
    };
  }

  return {
    id: "node-version",
    status: "fail",
    message: `Node ${currentNodeVersion} does not satisfy engines.node ${requiredRange}.`,
    suggestion: `Switch to a Node version that matches ${requiredRange}.`,
  };
}
