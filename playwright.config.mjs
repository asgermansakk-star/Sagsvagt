// E2E-test af det byggede site i Chromium (tests/e2e/). Serveren er tests/server.mjs, som efterligner Simply.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4400;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "test-resultater/e2e" }]] : "list",
  outputDir: "test-resultater/e2e-spor",
  use: { baseURL: `http://127.0.0.1:${PORT}/`, trace: "retain-on-failure", locale: "da-DK" },
  projects: [
    { name: "computer", use: { ...devices["Desktop Chrome"] } },
    { name: "mobil", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "node tests/server.mjs", url: `http://127.0.0.1:${PORT}/`, env: { PORT: String(PORT) }, reuseExistingServer: !process.env.CI },
});
