import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: resolve(__dirname, "src"),
  test: {
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "houston-common/**",
      "**/build/**",
      // Integration tests need live servers/shares — run them via `yarn test:int`.
      "**/*.int.test.ts",
    ],
  },
});
