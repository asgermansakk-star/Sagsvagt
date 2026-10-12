// Hvem skaffede den nye tilmeldte? Efter tilmeldingen får alle deres eget link, sagsvagt.dk/?fra=ven-xxxxxx,
// hvor xxxxxx er de første 6 tegn af SHA-256 af e-mailen (se visHenvisning i vagt.html).
// Står der fx "ven-c0be4c" som kilde, så find personen sådan her:
//   node avis/henvis-kode.mjs c0be4c en@mail.dk to@mail.dk ...   (tjekker de givne adresser)
//   node avis/henvis-kode.mjs en@mail.dk                          (viser koden for en adresse)
import { createHash } from "node:crypto";

const kode = (email) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 6);
const [forste, ...resten] = process.argv.slice(2);
if (!forste) { console.log("Brug: node avis/henvis-kode.mjs <kode> <e-mails...>  eller  node avis/henvis-kode.mjs <e-mail>"); process.exit(1); }
if (forste.includes("@")) for (const e of [forste, ...resten]) console.log(`${e}  ven-${kode(e)}`);
else {
  const fund = resten.filter((e) => kode(e) === forste.replace(/^ven-/, ""));
  console.log(fund.length ? `ven-${forste.replace(/^ven-/, "")} er ${fund.join(", ")}` : "Ingen af adresserne passer til koden.");
}
