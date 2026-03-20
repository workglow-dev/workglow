import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

const analyze = process.env.ANALYZE === "1";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    analyze &&
      visualizer({
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
        open: false,
        template: "treemap",
        title: "@workglow/web bundle",
      }),
  ].filter(Boolean),
  resolve: {
    mainFields: ["browser", "import", "module", "main"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["tiktoken", "@huggingface/transformers"],
    rolldownOptions: {
      target: "esnext",
    },
  },
});
