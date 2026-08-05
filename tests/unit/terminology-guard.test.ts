import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[tj]sx?$/.test(entry.name) ? [path] : [];
  });
}

it("keeps prohibited terminology out of app, components, and lib source", () => {
  const prohibited = ["세액", "납부할 세금", "신고서"];
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    const source = readFileSync(file, "utf8");
    for (const term of prohibited) expect(source, `${file} contains ${term}`).not.toContain(term);
  }
});
