// Performancetest med Lighthouse CI (npm run test:perf). Hver side måles tre gange som mobil med langsom forbindelse
// (Lighthouses standard), og medianen skal klare grænserne nedenfor. Rapporterne gemmes i test-resultater/lighthouse/.
// Grænserne ligger lidt under, hvad siderne fik ved første måling (9/11-2026), så de fanger en forværring, ikke støj.
// LCP svinger omkring 4 s på GitHubs maskiner (simuleret langsom mobil), derfor 5 s.
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const PORT = 4400;
const sag = JSON.parse(readFileSync(join(__dirname, "assets", "sager.json"), "utf8")).sager[0].url;
const sider = ["", "index.html", sag, "kommune/aarhus.html", "soeg.html"];

// Lokalt bruges Playwrights Chromium; i GitHub Actions den Chrome, der følger med maskinen
let chromePath = process.env.CHROME_PATH;
if (!chromePath && !process.env.CI) {
  try { const p = require("@playwright/test").chromium.executablePath(); if (existsSync(p)) chromePath = p; } catch {}
}

const grænser = (cls) => ({
  "categories:performance": ["error", { minScore: 0.8, aggregationMethod: "median-run" }],
  "categories:accessibility": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
  "categories:best-practices": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
  "categories:seo": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
  "largest-contentful-paint": ["error", { maxNumericValue: 5000, aggregationMethod: "median-run" }],
  "cumulative-layout-shift": ["error", { maxNumericValue: cls, aggregationMethod: "median-run" }],
});

module.exports = {
  ci: {
    collect: {
      startServerCommand: `node tests/server.mjs`,
      startServerReadyPattern: "Testserver",
      url: sider.map((s) => `http://127.0.0.1:${PORT}/${s}`),
      numberOfRuns: 3,
      chromePath,
      settings: { chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertMatrix: [
        { matchingUrlPattern: "^(?!.*soeg\\.html)", assertions: grænser(0.1) },
        // Søgesiden flytter sig lidt, når resultaterne kommer (0,12 på GitHub 9/11-2026). Googles grænse for "dårlig" er 0,25.
        { matchingUrlPattern: "soeg\\.html", assertions: grænser(0.25) },
      ],
    },
    upload: { target: "filesystem", outputDir: "test-resultater/lighthouse" },
  },
};
