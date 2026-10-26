// Linktjek af sagsvagt.dk uden at belaste serveren: læser alle HTML-sider i repoet (robotten committer de byggede sider)
// og tjekker, at interne links, billeder, scripts og stylesheets peger på en fil, der findes. Eksterne links tjekkes ikke.
//
// Kør: node avis/linktjek.mjs          (viser de døde links grupperet efter mål; afslutter med kode 1, hvis der er nogen)
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, normalize, relative } from "node:path";

const ROD = join(import.meta.dirname, "..");
const SPRING = new Set(["node_modules", "plan", "data", "avis", ".git", ".github", "_deploy"]);
const SITE = /^https?:\/\/(www\.)?sagsvagt\.dk\//;

async function* htmlFiler(mappe) {
  for (const e of await readdir(mappe, { withFileTypes: true })) {
    if (SPRING.has(e.name) || e.name.startsWith(".")) continue;
    // assets/sager/*.html er fragmenter, som Min avis henter ind i en anden side; deres links er relative til den side
    if (e.isDirectory() && relative(ROD, join(mappe, e.name)) === join("assets", "sager")) continue;
    const sti = join(mappe, e.name);
    if (e.isDirectory()) yield* htmlFiler(sti);
    else if (e.name.endsWith(".html")) yield sti;
  }
}
const findes = new Map();
async function fil(sti) {
  if (!findes.has(sti)) findes.set(sti, stat(sti).then((s) => (s.isDirectory() ? stat(join(sti, "index.html")).then(() => true, () => false) : true), () => false));
  return findes.get(sti);
}

const doede = new Map(); let sider = 0, links = 0;
for await (const side of htmlFiler(ROD)) {
  sider++;
  const html = await readFile(side, "utf8");
  for (const [, attr, url] of html.matchAll(/\s(href|src)="([^"#?]*)[^"]*"/g)) {
    if (!url || /^(mailto:|tel:|javascript:|data:)/.test(url) || /\$\{|' ?\+|\+ ?'|\bH\.|\(/.test(url)) continue; // JavaScript-skabeloner i scripts er ikke links
    let maal;
    if (SITE.test(url)) maal = join(ROD, url.replace(SITE, ""));
    else if (/^[a-z]+:\/\//i.test(url) || url.startsWith("//")) continue;
    else if (url.startsWith("/")) maal = join(ROD, url);
    else maal = normalize(join(dirname(side), url));
    if (!maal.startsWith(ROD)) continue;
    links++;
    if (!(await fil(decodeURIComponent(maal)))) {
      const k = relative(ROD, maal) || "/";
      if (!doede.has(k)) doede.set(k, []);
      doede.get(k).push(relative(ROD, side));
    }
  }
}
console.log(`Linktjek: ${sider} sider, ${links} interne links, ${doede.size} døde mål`);
for (const [maal, fra] of [...doede].sort((a, b) => b[1].length - a[1].length).slice(0, 40))
  console.log(`  ${maal}  (${fra.length} sider, fx ${fra[0]})`);
process.exit(doede.size ? 1 : 0);
