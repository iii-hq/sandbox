import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@iii-sandbox/sdk": path.resolve(__dirname, "packages/sdk/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
  },
});
