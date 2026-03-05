/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Vite library mode config for building @workglow/* packages.
 */

import { defineConfig, type UserConfig } from "vite";
import dts from "vite-plugin-dts";

export interface LibBuildOptions {
  /** Entry points, e.g. { browser: "src/browser.ts", node: "src/node.ts" } */
  entry: Record<string, string>;
  /** Additional rollup external patterns beyond the default auto-externalize */
  external?: (string | RegExp)[];
  /** Disable vite-plugin-dts (e.g. for watch mode) */
  skipDts?: boolean;
}

/**
 * Creates a Vite config for building a library package.
 *
 * - All non-relative imports are externalized (dependencies, peerDependencies, node builtins)
 * - ESM output with code splitting
 * - Source maps enabled
 * - Type declarations via vite-plugin-dts
 */
export function createLibConfig(options: LibBuildOptions): UserConfig {
  const { entry, external = [], skipDts = false } = options;

  // Skip dts when SKIP_DTS env var is set (e.g. for build-js or watch mode)
  const shouldSkipDts = skipDts || !!process.env.SKIP_DTS;

  return defineConfig({
    plugins: shouldSkipDts
      ? []
      : [
          dts({
            tsconfigPath: "./tsconfig.json",
          }),
        ],
    build: {
      lib: {
        entry,
        formats: ["es"],
      },
      sourcemap: true,
      emptyOutDir: true,
      rollupOptions: {
        external: (id: string) => {
          // Keep relative and absolute imports (the package's own source)
          if (id.startsWith(".") || id.startsWith("/") || id.startsWith("\0")) {
            return false;
          }
          // Check explicit external patterns
          for (const pattern of external) {
            if (typeof pattern === "string" && id === pattern) return true;
            if (pattern instanceof RegExp && pattern.test(id)) return true;
          }
          // Externalize everything else (node builtins, dependencies, peer deps)
          return true;
        },
        output: {
          preserveModules: false,
          // Ensure chunk names don't collide
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  });
}
