import { createLibConfig } from "../../vite.lib";

export default createLibConfig({
  entry: {
    // Core entries
    browser: "src/browser.ts",
    node: "src/node.ts",
    // Provider entries (node/default)
    anthropic: "src/anthropic.ts",
    "google-gemini": "src/google-gemini.ts",
    "hf-transformers": "src/hf-transformers.ts",
    ollama: "src/ollama.ts",
    openai: "src/openai.ts",
    // Provider entries (browser)
    "anthropic.browser": "src/anthropic.browser.ts",
    "google-gemini.browser": "src/google-gemini.browser.ts",
    "hf-transformers.browser": "src/hf-transformers.browser.ts",
    "ollama.browser": "src/ollama.browser.ts",
    "openai.browser": "src/openai.browser.ts",
    // Browser-only
    "tf-mediapipe": "src/tf-mediapipe.ts",
  },
});
