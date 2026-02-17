import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve from source instead of dist for better mocking support
      "@workglow/ai-provider/ollama":
        "/workspaces/workglow/libs/packages/ai-provider/src/provider-ollama/index.browser.ts",
    },
  },
  test: {
    testTimeout: 15000, // 15 second global timeout (PgLite initialization can be slow)
  },
});
