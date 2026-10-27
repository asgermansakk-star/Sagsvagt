// Sagsvagts service worker: gør appen (Min avis installeret på hjemmeskærmen) brugbar uden net.
// Registreres kun fra Min avis. Sider og sager hentes altid fra nettet først og gemmes som reserve;
// layout, skrift og ikoner gemmes og opdateres i baggrunden. /api/ (login og profil) gemmes aldrig.
// Ret VERSION, når listen herunder ændres, så gamle kopier ryddes væk.
const VERSION = "sagsvagt-v5";
const FAST = `${VERSION}-fast`, SIDER = `${VERSION}-sider`;
const GRUNDLAG = [
  "/min/", "/offline.html", "/assets/avis.css", "/assets/fonts/montserrat.css", "/assets/fonts/montserrat-latin.woff2",
  "/favicon.svg", "/icon-192.png", "/apple-touch-icon.png", "/site.webmanifest",
];
const MAKS_SIDER = 80;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(FAST).then((c) => c.addAll(GRUNDLAG)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Kun gode svar gemmes (Simply's robotspærre svarer fx 455, og den side må ikke gemmes)
const gem = async (navn, req, res) => {
  if (!res || !res.ok || res.type !== "basic") return;
  const c = await caches.open(navn);
  await c.put(req, res.clone());
  if (navn === SIDER) { const ks = await c.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - MAKS_SIDER))) await c.delete(k); }
};

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Sider, sagsdata, layout og scripts: nettet først (så ny HTML aldrig møder gammel CSS efter en opdatering),
  // ellers den gemte kopi, ellers en side om, at man er offline
  const layout = /\.(css|js)$/.test(url.pathname);
  if (req.mode === "navigate" || url.pathname.endsWith(".json") || layout) {
    e.respondWith((async () => {
      try { const res = await fetch(req); await gem(layout ? FAST : SIDER, req, res); return res; }
      catch {
        const gemt = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
        if (gemt) return gemt;
        if (req.mode === "navigate") return caches.match("/offline.html");
        if (layout) return new Response("", { status: 503 });
        return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
      }
    })());
    return;
  }

  // Skrift og billeder ændrer sig sjældent: den gemte kopi med det samme, og en ny hentes i baggrunden
  if (/\.(woff2|png|svg|jpg|webp|ico)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const gemt = await caches.match(req);
      const ny = fetch(req).then(async (res) => { await gem(FAST, req, res); return res; }).catch(() => gemt);
      return gemt || ny;
    })());
  }
});

// Push-beskeder (api/_push.php): vis beskeden, og åbn den side, den handler om, når man trykker på den
self.addEventListener("push", (e) => {
  let b = {};
  try { b = e.data ? e.data.json() : {}; } catch { b = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(b.title || "Sagsvagt", {
    body: b.body || "Der er nye sager om det, du følger.",
    icon: "/icon-192.png", badge: "/icon-192.png", tag: b.tag || "sagsvagt", renotify: true,
    data: { url: b.url || "/min/" }, lang: "da",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/min/", self.location.origin).href;
  e.waitUntil((async () => {
    // Er appen allerede åben, bruges det vindue; ellers åbnes et nyt
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
