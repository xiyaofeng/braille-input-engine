import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/core/**/*.ts"],
      thresholds: {
        branches: 90,
        perFile: true,
      },
    },
  },
});
