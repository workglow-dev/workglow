#!/usr/bin/env bun

import { $ } from "bun";
import { findWorkspaces } from "./lib/util";

function toSource(exports: string): string {
  return exports
    .replace(/("types":\s*")\.\/dist\/([^"]+)\.d\.ts"/g, `$1./src/$2.ts"`)
    .replace(
      /("(?:import|bun|node|browser|module|react-native)":\s*")\.\/dist\/([^"]+)\.js"/g,
      `$1./src/$2.ts"`
    );
}

function toDist(exports: string): string {
  return exports
    .replace(/("types":\s*")\.\/src\/([^"]+)\.ts"/g, `$1./dist/$2.d.ts"`)
    .replace(
      /("(?:import|bun|node|browser|module|react-native)":\s*")\.\/src\/([^"]+)\.ts"/g,
      `$1./dist/$2.js"`
    );
}

async function updateExports(workspacePath: string, mode: "source" | "dist"): Promise<null> {
  const exports = (await $`bun --cwd=${workspacePath} pm pkg get exports`.quiet()).text();
  if (exports != "{}") {
    const newExports = mode === "source" ? toSource(exports) : toDist(exports);
    if (newExports != exports) {
      console.log(`Updating exports for ${workspacePath}`);
      await $`bun --cwd=${workspacePath} pm pkg set exports=${newExports} --json`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: bun run bunsrc-workspace.ts <source|dist>");
    console.error("  source: Use source files (./src/*.ts)");
    console.error("  dist:   Use built files (./dist/*.js)");
    process.exit(1);
  }

  const mode = args[0];
  if (mode !== "source" && mode !== "dist") {
    console.error("Error: Mode must be either 'source' or 'dist'");
    console.error("Usage: bun run bunsrc-workspace.ts <source|dist>");
    process.exit(1);
  }

  console.log(`Using ${mode} exports`);

  const workspaces = await findWorkspaces();
  console.log(`Found ${workspaces.length} workspaces`);

  for (const workspace of workspaces) {
    await updateExports(workspace, mode);
  }

  console.log(`\nChanging exports to ${mode} mode completed successfully`);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
