import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.emulator.test.ts"],
    passWithNoTests: true,
  },
});
