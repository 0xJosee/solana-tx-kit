import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/index.ts", "src/**/types.ts"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
    testTimeout: 10_000,
  },
});
