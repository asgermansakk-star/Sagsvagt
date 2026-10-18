// "Forklar sagen enkelt": en kort, letlæst udgave af sagen, som læseren kan folde ud øverst på sagssiden.
// Forklaringerne ligger i avis/forenklet.json (skrevet med AI ud fra kommunens tekst) og vises kun, når sagen
// stadig har samme type (dagsorden/referat) som da forklaringen blev skrevet, så den aldrig er forældet.
// Bygges ind i sagens artikel, så den også kommer med i Min avis' "læs sagen".
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function laesForenklet() {
  try { return JSON.parse(await readFile(join(import.meta.dirname, "forenklet.json"), "utf8")).sager || {}; } catch { return {}; }
}

export function forenkletBoks(s, forenklet, esc) {
  const f = forenklet[s.id];
  if (!f || f.type !== s.type) return "";
  return `<details class="forenklet" open>
          <summary><span class="vis">Forklar sagen enkelt</span><span class="skjul">Skjul den enkle forklaring</span></summary>
          <div class="forenklet-indhold">
            <p class="forenklet-kort">${esc(f.kort)}</p>
            ${f.afsnit.map((a) => `<h3>${esc(a.titel)}</h3><p>${esc(a.tekst)}</p>`).join("\n            ")}
            <p class="forenklet-note">Forklaret enkelt af Sagsvagt med hjælp fra AI ud fra kommunens egen tekst. Læs altid hele sagen herunder eller hos kommunen, før du handler på den.</p>
          </div>
        </details>`;
}
