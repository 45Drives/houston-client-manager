import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";
import Path from "path";

export default defineConfig({
  root: Path.join(__dirname, "src"),
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**", "houston-common/**", "**/build/**",],
    root: fileURLToPath(new URL("./", import.meta.url)),
  },
});
