import { describe, it, expect } from "vitest";

// Component styles must use the design tokens in _variables.scss, so the UI
// stays consistent: one type scale, one palette.
// node:fs is aliased for the Electron renderer build; use the builtin directly.
type FS = typeof import("fs");
type Path = typeof import("path");
const proc = process as unknown as { getBuiltinModule(id: string): unknown };
const fs = proc.getBuiltinModule("fs") as FS;
const path = proc.getBuiltinModule("path") as Path;

const componentsDir = path.resolve(process.cwd(), "src/components");
const sheets: Record<string, string> = {};
for (const entry of fs.readdirSync(componentsDir, { recursive: true }) as string[]) {
  if (entry.endsWith(".scss")) {
    sheets[`src/components/${entry}`] = fs.readFileSync(path.join(componentsDir, entry), "utf8");
  }
}

function violations(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const [file, source] of Object.entries(sheets)) {
    source.split("\n").forEach((line, i) => {
      if (line.includes("data:image")) return; // inline SVG icons carry their own colors
      if (pattern.test(line)) found.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  return found;
}

describe("component styles use design tokens", () => {
  it("found the stylesheets", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(5);
  });

  it("has no raw font sizes (use $font-xs … $font-display)", () => {
    expect(violations(/font-size:\s*[0-9.]+(px|rem|em)\b/)).toEqual([]);
  });

  it("has no raw hex colors (add a token to _variables.scss)", () => {
    expect(violations(/#[0-9a-fA-F]{3,8}\b/)).toEqual([]);
  });
});
