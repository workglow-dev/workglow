import { createLibConfig } from "../../vite.lib";

export default createLibConfig({
  entry: {
    // Main entry
    "index": "src/index.ts",
    // Provider entries (node/default)
    "anthropic/index": "src/anthropic/index.ts",
    "google-gemini/index": "src/google-gemini/index.ts",
    "hf-transformers/index": "src/hf-transformers/index.ts",
    "provider-llamacpp/index": "src/provider-llamacpp/index.ts",
    "provider-hf-inference/index": "src/provider-hf-inference/index.ts",
    "provider-ollama/index": "src/provider-ollama/index.ts",
    "provider-openai/index": "src/provider-openai/index.ts",
    // Browser-specific entries
    "provider-ollama/index.browser": "src/provider-ollama/index.browser.ts",
    "tf-mediapipe/index": "src/tf-mediapipe/index.ts",
  },
});
