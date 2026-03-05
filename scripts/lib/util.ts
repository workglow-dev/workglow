import { existsSync } from "fs";
import { readFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";

interface PackageJson {
  publishConfig?: {
    access?: string;
  };
}

export async function findWorkspaces(): Promise<string[]> {
  const workspaces: string[] = [];

  // Read workspace dirs from pnpm-workspace.yaml patterns
  const workspaceDirs = ["packages", "examples"];

  for (const dir of workspaceDirs) {
    const dirPath = resolve(dir);
    if (!existsSync(dirPath)) continue;

    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = join(dirPath, entry.name, "package.json");
      if (!existsSync(packageJsonPath)) continue;

      const packageJson = JSON.parse(
        await readFile(packageJsonPath, "utf-8")
      ) as PackageJson;
      if (packageJson.publishConfig?.access === "public") {
        workspaces.push(join(dirPath, entry.name));
      }
    }
  }

  return workspaces;
}
