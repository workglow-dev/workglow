/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const packagesRoot = join(import.meta.dir, "../../../../");
const currentFile = relative(packagesRoot, import.meta.path);

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (entry === "dist" || entry === "node_modules") continue;

    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.endsWith(".ts") && path !== import.meta.path) {
      files.push(path);
    }
  }

  return files;
}

function findComparisonMatches(
  source: string,
  pattern: RegExp
): Array<{ readonly line: number; readonly text: string }> {
  return source
    .split("\n")
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => pattern.test(text));
}

describe("structural comparisons", () => {
  it("uses deepEqual instead of string serialization for equality checks", () => {
    const forbiddenPatterns = [
      /JSON\.stringify\([^)]*\)\s*[!=]==?\s*JSON\.stringify\(/,
      /\bserialize\([^)]*\)\s*[!=]==?\s*\bserialize\(/,
      /expect\s*\(\s*\bserialize\([^)]*\)\s*\)\.to(?:Be|Equal|StrictEqual)\s*\(\s*\bserialize\(/,
    ];

    const matches = collectTypeScriptFiles(packagesRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenPatterns.flatMap((pattern) =>
        findComparisonMatches(source, pattern).map(
          ({ line, text }) => `${relative(packagesRoot, file)}:${line}: ${text.trim()}`
        )
      );
    });

    expect(matches, `Forbidden serialized comparisons:\n${matches.join("\n")}`).toEqual([]);
    expect(currentFile).toBe("test/src/test/util/StructuralComparison.test.ts");
  });
});
