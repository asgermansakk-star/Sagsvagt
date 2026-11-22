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

test("forsiden har Dagens sag og seks sager, og flyder ikke ud over skærmen", async ({ page }) => {
  await page.goto("/");
  // Delene sættes ind af serveren (del/forside-*.html, avis/forside.mjs)
  await expect(page.locator(".collage .foto")).toBeVisible();
  await expect(page.locator("#dagens-h a")).toHaveAttribute("href", /^\/sag\//);
  await expect(page.locator(".sagkort")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.locator("#fk").fill("Aarhus");
  await page.locator("#find-kommune button").click();
  await expect(page).toHaveURL(/kommune\/aarhus\.html$/);
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

test("sagssiden på papir: overskrift, billede, datomærkat og flere sager, uden at flyde ud over skærmen", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator('main a[href^="sag/"]').first().click();
  const hoved = page.locator("main > .wrap > .article > article > header");
  await expect(hoved.locator("h1")).toBeVisible();
  await expect(hoved.locator("figure img").first()).toBeVisible();
  await expect(hoved.locator(".status")).toBeVisible();
  await expect(page.locator(".side .mini").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
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

test("tilmeldingen åbner som dialog fra forsidens knap", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#tilmeld #form")).toBeHidden();
  await page.locator('a[href$="#tilmeld"]').first().click();
  await expect(page.locator("#tilmeld #form")).toBeVisible();
  // Første trin er fornavnet
  await expect(page.locator("#tilmeld #fornavn")).toBeVisible();
});
