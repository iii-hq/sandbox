import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@iii-sandbox/sdk": path.resolve(__dirname, "packages/sdk/src/index.ts"),
      dockerode: path.resolve(
        __dirname,
        "packages/engine/node_modules/dockerode",
      ),
      "iii-sdk": path.resolve(
        __dirname,
        "packages/engine/node_modules/iii-sdk",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
  },
});
