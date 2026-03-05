import { createLibConfig } from "../../vite.lib";

export default createLibConfig({
  entry: {
    workglow: "src/workglow.ts",
    worker_hft: "src/worker_hft.ts",
    lib: "src/lib.ts",
  },
});
