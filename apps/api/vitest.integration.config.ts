import { defineConfig } from "vitest/config";

// Nécessite PostgreSQL (npm run db:up) et DATABASE_URL.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
