import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/web-next/**/*.test.ts"],
    environment: "node",
  },
});
