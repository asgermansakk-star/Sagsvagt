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
  // Pilen ved "Læs hele sagen" bliver på linjen og inden for kanten, også på små telefoner
  await page.setViewportSize({ width: 375, height: 800 });
  expect((await page.locator(".hel-sag summary").boundingBox()).height).toBeLessThanOrEqual(80);
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

// Radaren lå 22/11-2026 oven på bundmenuen på telefonen. Testbrugeren er opdigtet, og kortet svarer ikke.
test("radaren i Min avis ligger under bundmenuen på telefonen", async ({ page }, info) => {
  test.skip(info.project.name !== "mobil", "bundmenuen findes kun på telefonen");
  const profil = { navn: "Test", emner: ["trafik", "klima"], ord: [], bydel: "", gemte: [], velkommen: true, adresse: { tekst: "Testvej 1", lat: 55.63, lon: 12.579, bydel: "", radius: 2000 } };
  await page.route("**/api/mig.php*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ email: "test@example.com", profil, admin: false }) }));
  await page.goto("/min/#sager");
  const skaerm = page.locator(".radar-skaerm");
  await expect(skaerm).toBeVisible();
  // Rul, så midten af radaren er bag bundmenuen
  await skaerm.evaluate((e) => scrollTo(0, e.getBoundingClientRect().top + scrollY + e.clientHeight / 2 - innerHeight + 40));
  const daekket = await page.evaluate(() => {
    const n = document.querySelector("#min-nav").getBoundingClientRect(), ramt = [];
    for (let x = 6; x < n.width - 6; x += 12) for (let y = n.top + 4; y < Math.min(n.bottom, innerHeight) - 4; y += 12) {
      const e = document.elementFromPoint(x, y);
      if (!e?.closest("#min-nav")) ramt.push(e?.className?.baseVal ?? e?.className ?? "intet");
    }
    return ramt;
  });
  expect(daekket).toEqual([]);
});

// Samtykket til mails (22/11-2026): ét valgfrit flueben, der aldrig er sat på forhånd, og ingen kobling til Sæt Dagsordenen
for (const ja of [true, false]) test(`tilmeldingen sender samtykket, når fluebenet ${ja ? "er sat" : "ikke er sat"}`, async ({ page }) => {
  let sendt;
  await page.route("**/api/tilmeld.php", (r) => { sendt = r.request().postDataJSON(); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, bekraeft: true }) }); });
  await page.goto("/#tilmeld");
  const form = page.locator("#tilmeld #form"), knap = form.locator(".send"), naeste = () => knap.click();
  await form.locator("#fornavn").fill("Test"); await form.locator("#efternavn").fill("Testesen"); await naeste();
  await expect(form.locator("#email")).toBeFocused(); await form.locator("#email").fill("test@example.test"); await naeste();
  await expect(form.locator("#kommuner")).toBeFocused(); await form.locator("#kommuner").fill("København"); await naeste();
  await expect(form.locator("#emner")).toBeFocused(); await naeste();
  await expect(form.locator("#rolle")).toBeFocused(); await naeste();
  await expect(form.locator("#adgangskode")).toBeFocused(); await form.locator("#adgangskode").fill("en-lang-testkode"); await naeste();
  const felt = form.locator("#samtykke");
  await expect(felt).toBeFocused(); await expect(felt).not.toBeChecked();
  await expect(form).not.toContainText("Sæt Dagsordenen");
  expect(await form.locator(".flueben").evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  if (ja) await felt.check();
  await expect(knap).toHaveText("Skriv mig op"); await knap.click();
  await expect(page.locator(".done h3")).toHaveText("Tjek din mail.");
  expect(sendt.samtykke).toBe(ja); expect(sendt.medlem).toBeUndefined();
  await expect(page.locator(".done-tekst")).toContainText(ja ? "hver mandag" : "ikke sagt ja til mandagsmailen");
});

test("mails slås til og fra under Tilpas i Min avis", async ({ page }) => {
  const kald = [];
  const profil = { navn: "Test", emner: ["trafik"], ord: [], bydel: "", gemte: [], velkommen: true };
  await page.route("**/api/mig.php*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ email: "test@example.test", profil, admin: false, mails: { mandag: true, andre: false } }) }));
  await page.route("**/api/samtykke.php", (r) => { const d = r.request().postDataJSON(); kald.push(d); return kald.length > 1 ? r.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : r.fulfill({ contentType: "application/json", body: JSON.stringify({ mails: d }) }); });
  await page.goto("/min/");
  await page.locator("#tilpas").click();
  const mandag = page.locator("#p-mandag"), andre = page.locator("#p-andre"), svar = page.locator("#p-mails-svar");
  await expect(mandag).toBeChecked(); await expect(andre).not.toBeChecked();
  await andre.check(); await expect(svar).toHaveText("Gemt.");
  expect(kald[0]).toEqual({ mandag: true, andre: true });
  // Svarer serveren ikke, står valget, som det var
  await mandag.click(); await expect(svar).toContainText("ikke gemt"); await expect(mandag).toBeChecked();
});
