import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  outputDir: "../.local/avatar-browser-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5178",
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--autoplay-policy=document-user-activation-required"] },
  },
  webServer: {
    command: "npx vite --config tests/browser/vite.config.mts",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
  },
});
