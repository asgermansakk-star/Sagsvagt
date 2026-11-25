// Spørgeskemaet til dem, der har brugt Sagsvagt i over en måned (spoergeskema.html). Linket i mailen har id og t; uden dem
// viser siden kun en besked. Svarene sendes til api/spoergeskema.php, som kun gemmer de valg, der står i api/_spoergeskema.php,
// så navnene på valgene her skal passe med SPOERG dér.
const HONNING = `<div aria-hidden="true" style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden"><label>Lad dette felt være tomt <input name="sv_felt" type="text" tabindex="-1" autocomplete="off" value=""></label></div>`;

const et = (navn, valg) => valg.map(([v, t]) => `<label class="tjek"><input type="radio" name="${navn}" value="${v}"> ${t}</label>`).join("\n        ");
const flere = (navn, valg) => valg.map(([v, t]) => `<label class="tjek"><input type="checkbox" name="${navn}" value="${v}"> ${t}</label>`).join("\n        ");
const skala = (navn, fra, til) => Array.from({ length: til - fra + 1 }, (_, i) => fra + i)
  .map((n) => `<label><input type="radio" name="${navn}" value="${n}"><span>${n}</span></label>`).join("");

export function spoergeskemaIndhold() {
  return `<div class="wrap smal">
  <article class="foto-side spoerg-side">
    <h1 class="hl">Hvad synes du om Sagsvagt?</h1>
    <p id="sp-intro">Du har brugt Sagsvagt i over en måned. Fortæl os, hvad der virker, og hvad der mangler. Det tager ca. 3 minutter, og du kan springe alle spørgsmål over.</p>
    <p class="besked fejl" id="sp-ingen" hidden>Linket mangler. Brug linket i mailen fra Sagsvagt, så vi ved, at svaret kommer fra en læser.</p>
    <form id="sp-form" class="foto-form spoerg-form" novalidate>${HONNING}
      <fieldset><legend>1. Hvad bruger du Sagsvagt til? <span class="lille">Vælg gerne flere</span></legend>
        ${flere("brug", [["mandagsmail", "Mandagsmailen"], ["minavis", "Min avis"], ["forside", "Forsiden og sagerne på sagsvagt.dk"], ["soeg", "Søgningen"], ["kort", "Kortet eller mødekalenderen"], ["push", "Beskeder på telefonen"], ["andet", "Andet"]])}
      </fieldset>
      <fieldset><legend>2. Hvor tit læser du mandagsmailen?</legend>
        ${et("hyppighed", [["hver_uge", "Hver uge"], ["par_gange", "Et par gange om måneden"], ["sjaeldent", "Sjældnere"], ["aldrig", "Aldrig, eller jeg får den ikke"]])}
      </fieldset>
      <fieldset><legend>3. Hvor godt rammer sagerne det, du interesserer dig for?</legend>
        <div class="skala">${skala("rammer", 1, 5)}</div>
        <p class="skala-ender lille"><span>1 = slet ikke</span><span>5 = helt præcist</span></p>
      </fieldset>
      <fieldset><legend>4. Har Sagsvagt hjulpet dig med noget konkret?</legend>
        ${et("hjulpet", [["ja", "Ja"], ["nej", "Nej"], ["ved_ikke", "Ved ikke"]])}
        <div class="felt"><label for="sp-hjulpet">Hvis ja: hvad? Fx at du nåede en høring, skrev til en politiker eller mødte op</label><textarea id="sp-hjulpet" name="hjulpet_tekst" rows="2" maxlength="1000"></textarea></div>
      </fieldset>
      <fieldset><legend>5. Hvor sandsynligt er det, at du vil anbefale Sagsvagt til en ven eller kollega?</legend>
        <div class="skala elleve">${skala("anbefal", 0, 10)}</div>
        <p class="skala-ender lille"><span>0 = slet ikke</span><span>10 = helt sikkert</span></p>
      </fieldset>
      <fieldset><legend>6. Hvad mangler du mest, eller hvad ville du ændre?</legend>
        <div class="felt"><label class="skjult" for="sp-mangler">Hvad mangler du mest</label><textarea id="sp-mangler" name="mangler" rows="4" maxlength="2000"></textarea></div>
      </fieldset>
      <fieldset><legend>7. Hvad passer bedst på dig?</legend>
        ${et("rolle", [["borger", "Borger"], ["politiker", "Lokalpolitiker"], ["journalist", "Journalist"], ["forening", "Aktiv i en forening eller organisation"], ["kommune", "Ansat i en kommune"], ["erhverv", "Bruger det i mit arbejde i en virksomhed"], ["andet", "Andet"]])}
      </fieldset>
      <fieldset><legend>8. Hvis Sagsvagt kostede penge, hvad ville du højst betale om måneden for det, du bruger i dag?</legend>
        ${et("betale", [["nej", "Intet, så ville jeg stoppe"], ["under_30", "Under 30 kr."], ["30_59", "30-59 kr."], ["60_99", "60-99 kr."], ["100_plus", "100 kr. eller mere"]])}
      </fieldset>
      <fieldset><legend>9. Må vi skrive til dig om dine svar?</legend>
        <label class="tjek"><input type="checkbox" name="kontakt" value="1"> Ja, I må gerne skrive til mig på den e-mail, mailen kom til.</label>
      </fieldset>
      <button class="btn" type="submit">Send mine svar</button>
      <p class="lille" id="sp-svar" role="status" aria-live="polite"></p>
    </form>
    <p class="lille">Svarene gemmes hos Sagsvagt og bruges kun til at gøre avisen bedre. Sletter du din konto, beholder vi svarene uden din e-mail. Læs mere i <a href="privatliv.html">privatlivspolitikken</a>.</p>
  </article>
</div>
<script>(function(){var q=new URLSearchParams(location.search),id=q.get("id"),t=q.get("t"),f=document.getElementById("sp-form"),s=document.getElementById("sp-svar");
if(!id||!t){f.hidden=true;document.getElementById("sp-ingen").hidden=false;return;}
f.addEventListener("submit",function(e){e.preventDefault();var d={};
new FormData(f).forEach(function(v,k){if(k==="sv_felt"||k==="brug")return;d[k]=k==="kontakt"?true:v;});
d.brug=Array.prototype.map.call(f.querySelectorAll("input[name=brug]:checked"),function(x){return x.value;});
var b=f.querySelector("button[type=submit]");b.disabled=true;s.className="lille";s.textContent="Sender …";
fetch("api/spoergeskema.php",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Sagsvagt":"api"},body:JSON.stringify({id:id,t:t,svar:d,sv_felt:f.elements.sv_felt.value})})
.then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok)throw new Error(j.fejl||"Det gik ikke. Prøv igen.");return j;});})
.then(function(){f.hidden=true;document.getElementById("sp-intro").textContent="Tak for dine svar! Vil du ændre noget, kan du bruge linket i mailen igen, så erstatter de nye svar de gamle.";
document.getElementById("sp-intro").className="besked ok";window.scrollTo(0,0);})
.catch(function(e){s.className="besked fejl";s.textContent=e.message;}).finally(function(){b.disabled=false;});});})();</script>`;
}
