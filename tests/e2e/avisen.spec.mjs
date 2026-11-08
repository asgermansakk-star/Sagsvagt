// Læserens vej gennem avisen: forside, sag, kommune, søgning og en adresse, der ikke findes.
// Kun testserveren må kaldes; alt udefra (kort, statistik) afvises, så testen ikke afhænger af nettet.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }, info) => {
  const fejl = [];
  await page.route((url) => !["127.0.0.1", "localhost"].includes(url.hostname), (r) => r.abort());
  page.on("pageerror", (e) => fejl.push(e.message));
  info.fejl = fejl;
});
test.afterEach(async ({}, info) => {
  expect(info.fejl, "JavaScript-fejl på siden").toEqual([]);
});

test("forsiden er tilmeldingen til Sagsvagt", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Sagsvagt/);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("avisen viser sager, og en sag kan åbnes", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("h1").first()).toBeVisible();
  const link = page.locator('main a[href^="sag/"]').first();
  const titel = (await link.innerText()).trim();
  await link.click();
  await expect(page).toHaveURL(/\/sag\/.+\.html$/);
  await expect(page.locator("h1").first()).toContainText(titel.slice(0, 20));
  // Sidefoden sættes ind af serveren (server-side include)
  await expect(page.locator("footer")).toContainText("Sagsvagt bygger på kommunernes offentlige dagsordener");
});

test("en anden kommunes side har sine egne sager", async ({ page }) => {
  await page.goto("/kommune/aarhus.html");
  await expect(page).toHaveTitle(/Aarhus/);
  await expect(page.locator('a[href*="sag/aarhus-"]').first()).toBeVisible();
});

test("søgning i sagerne giver resultater", async ({ page }) => {
  await page.goto("/soeg.html");
  await page.locator("#q").fill("skole");
  await expect(page.locator("#resultater a").first()).toBeVisible();
  await expect(page.locator("#antal")).toContainText(/\d/);
});

test("en ukendt adresse giver Sagsvagts egen 404-side", async ({ page }) => {
  const svar = await page.goto("/findes-ikke.html");
  expect(svar.status()).toBe(404);
  await expect(page).toHaveTitle(/Siden findes ikke/);
});

test("avisen flyder ikke ud over skærmen", async ({ page }) => {
  await page.goto("/index.html");
  const bred = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(bred).toBeLessThanOrEqual(1);
});
