// Lille webserver til E2E- og performancetestene. Serverer repoet, som Simply gør: vagt.html er forsiden,
// server-side includes (<!--#include virtual="/del/…" -->) sættes ind i .html, 404.html ved ukendte adresser, og
// tekstfiler komprimeres med brotli. PHP køres ikke her; api/ testes i tests/integration/.
// Kør: node tests/server.mjs   (PORT=4400 som standard)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const ROD = join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT || 4400);
const FORSIDER = ["vagt.html", "index.html"]; // DirectoryIndex i .htaccess
const TYPER = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".ics": "text/calendar; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4", ".pdf": "application/pdf",
};
const TEKST = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

const findes = (sti) => stat(sti).then((s) => s, () => null);
async function find(sti) {
  const s = await findes(sti);
  if (s?.isFile()) return sti;
  if (s?.isDirectory()) for (const f of FORSIDER) if ((await findes(join(sti, f)))?.isFile()) return join(sti, f);
  return null;
}
const SSI = /<!--#include virtual="([^"]+)" -->/g;
async function medIncludes(html) {
  const dele = await Promise.all([...html.matchAll(SSI)].map((m) => readFile(join(ROD, normalize(m[1])), "utf8").catch(() => "")));
  let i = 0;
  return html.replace(SSI, () => dele[i++]);
}

createServer(async (req, res) => {
  try {
    const sti = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    let fil = sti.split("/").some((d) => d.startsWith(".")) ? null : await find(join(ROD, sti));
    let kode = 200;
    if (!fil || extname(fil) === ".php") { fil = join(ROD, "404.html"); kode = 404; }
    const type = TYPER[extname(fil).toLowerCase()] || "application/octet-stream";
    let krop = await readFile(fil);
    if (type.startsWith("text/html")) krop = Buffer.from(await medIncludes(krop.toString("utf8")));
    const hoved = { "Content-Type": type, "Cache-Control": "no-cache" };
    const kan = String(req.headers["accept-encoding"] || "");
    if (TEKST.test(type) && krop.length > 1024) {
      if (/\bbr\b/.test(kan)) { krop = brotliCompressSync(krop, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }); hoved["Content-Encoding"] = "br"; }
      else if (/\bgzip\b/.test(kan)) { krop = gzipSync(krop); hoved["Content-Encoding"] = "gzip"; }
    }
    res.writeHead(kode, { ...hoved, "Content-Length": krop.length });
    res.end(req.method === "HEAD" ? undefined : krop);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Testserver: http://127.0.0.1:${PORT}/`));
