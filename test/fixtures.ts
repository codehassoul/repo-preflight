import path from "node:path";

export function getFixturePath(name: string): string {
  return path.join(process.cwd(), "test", "fixtures", name);
}
