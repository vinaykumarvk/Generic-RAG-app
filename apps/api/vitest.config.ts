import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@puda/api-core": path.resolve(__dirname, "../../packages/api-core/src"),
      "@puda/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
