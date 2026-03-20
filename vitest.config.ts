import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve from source instead of dist for better mocking support (path relative to config for CI)
      "@workglow/ai-provider/ollama": path.resolve(
        __dirname,
        "packages/ai-provider/src/provider-ollama/index.browser.ts"
      ),
    },
  },
  envDir: __dirname,
  test: {
    maxConcurrency: 1,
    maxWorkers: 1,
    testTimeout: 15000, // 15 second global timeout (PgLite initialization can be slow)
    retry: 1,
    exclude: [...configDefaults.exclude, "**/*.e2e.test.ts"],
    coverage: {
      provider: "v8", // or 'istanbul'
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [...configDefaults.exclude, "packages/test/**"],
    },
  },
});
