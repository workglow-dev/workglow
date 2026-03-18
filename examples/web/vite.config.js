import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    mainFields: ["browser", "import", "module", "main"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@huggingface/transformers")) return "huggingface-transformers";
            if (id.includes("@workglow/")) return "workglow";
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom") ||
              id.includes("node_modules/@xyflow/react") ||
              id.includes("node_modules/react-hotkeys-hook") ||
              id.includes("node_modules/react-icons") ||
              id.includes("node_modules/react-resizable-panels")
            )
              return "react";
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    rolldownOptions: {
      target: "esnext",
    },
  },
});
