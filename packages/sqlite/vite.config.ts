import { createLibConfig } from "../../vite.lib";

export default createLibConfig({
  entry: {
    browser: "src/browser.ts",
    node: "src/node.ts",
  },
});
