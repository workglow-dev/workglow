import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    mainFields: ["browser", "import", "module", "main"],
  },
  esbuild: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          "huggingface-transformers": ["@huggingface/transformers"],
          workglow: [
            "@workglow/ai",
            "@workglow/ai-provider",
            "@workglow/job-queue",
            "@workglow/storage",
            "@workglow/task-graph",
            "@workglow/debug",
            "@workglow/dataset",
            "@workglow/tasks",
            "@workglow/util",
            "@workglow/sqlite",
          ],
          react: [
            "react",
            "react-dom",
            "@xyflow/react",
            "react-hotkeys-hook",
            "react-icons",
            "react-resizable-panels",
          ],
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
});
