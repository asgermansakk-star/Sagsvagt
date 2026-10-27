"""Bygger Sagsvagts brugsguide (brugsguide.html + brugsguide.png) ud fra filerne i svg/ og paletten i byg_pakke.py."""
import re
import subprocess
import sys
from pathlib import Path

HER = Path(__file__).parent
sys.path.insert(0, str(HER))
import byg_pakke as P  # noqa: E402  (kører ikke byggeriet; det ligger under __main__)

SVG = HER / "svg"
NAT, KALK = P.NAT, P.KALK
MOEDET_CSS = (f"radial-gradient(80% 100% at 0% 25%, {P.SKIFER} 0%, {P.INDIGO} 25%, {P.BLAEK} 52%, transparent 74%),"
              f"radial-gradient(75% 95% at 100% 100%, {P.RUBIN} 0%, {P.VIN} 25%, {P.BORDEAUX} 52%, transparent 76%), {NAT}")


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def cmyk(h):
    r, g, b = (v / 255 for v in rgb(h))
    k = 1 - max(r, g, b)
    if k >= 1:
        return (0, 0, 0, 100)
    return tuple(round(v * 100) for v in ((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k))


def badge(r):
    return "AAA" if r >= 7 else "AA" if r >= 4.5 else "AA stor tekst" if r >= 3 else "kun grafik"


def inline(navn, h):
    s = (SVG / f"{navn}.svg").read_text("utf-8").strip()
    s = re.sub(r'<title>.*?</title>', '', s)
    return re.sub(r'width="[\d.]+" height="[\d.]+"', f'height="{h}" style="display:block;max-width:100%;height:auto;max-height:{h}px"', s, count=1)


RAEKKER = [("Rød", [("Bordeaux", P.BORDEAUX), ("Vin", P.VIN), ("Rubin", P.RUBIN), ("Rosen", P.ROSEN)]),
           ("Blå", [("Blæk", P.BLAEK), ("Indigo", P.INDIGO), ("Skifer", P.SKIFER), ("Lyng", P.LYNG)]),
           ("Neutral", [("Nat", NAT), ("Grafit", P.GRAFIT), ("Sten", P.STEN), ("Kalk", KALK)])]
palet_html = "".join(
    f'<div class="prow"><b>{navn}</b>' + "".join(
        f'<div class="sw"><div class="c" style="background:{c};color:{KALK if lum(c) < 0.18 else NAT}">{n}</div>'
        f'<code>{c}</code><code>RGB {", ".join(map(str, rgb(c)))}</code><code>CMYK ca. {"/".join(map(str, cmyk(c)))}</code></div>'
        for n, c in row) + "</div>" for navn, row in RAEKKER)

PAR = [("Kalk på Nat", KALK, NAT), ("Nat på Kalk", NAT, KALK), ("Rosen på Nat", P.ROSEN, NAT), ("Lyng på Nat", P.LYNG, NAT),
       ("Vin på Kalk", P.VIN, KALK), ("Indigo på Kalk", P.INDIGO, KALK), ("Rubin på Nat", P.RUBIN, NAT),
       ("Skifer på Nat", P.SKIFER, NAT)]
par_html = "".join(f'<div class="pair" style="background:{bg};color:{fg}"><b>Aa</b><span>{n}<br>'
                   f'<strong>{contrast(fg, bg):.1f}:1 · {badge(contrast(fg, bg))}</strong></span></div>' for n, fg, bg in PAR)

VAR = [("kalk", MOEDET_CSS, "Kalk på Mødet", "Primært udtryk"), ("roedblaa-moerk", NAT, "Rød og blå på Nat", "Rubin + Skifer"),
       ("roedblaa-lys", KALK, "Rød og blå på Kalk", "Vin + Indigo"), ("nat", KALK, "Nat på Kalk", "Én farve på lys"),
       ("sort", KALK, "Sort", "Kun til tryk i én farve")]
var_html = "".join(f'<div><div class="v" style="background:{bg}">{inline("sagsvagt-vandret-" + v, 70)}</div>'
                   f'<div class="cap"><b>{t}</b> · {u}</div></div>' for v, bg, t, u in VAR)

sym = inline("sagsvagt-symbol-roedblaa-lys", 80)
sym_byt = sym.replace(P.VIN, "#TMP").replace(P.INDIGO, P.VIN).replace("#TMP", P.INDIGO)
forkert = [("Byt ikke om på rød og blå", sym_byt),
           ("Kun én af blokkene i farve", sym.replace(P.INDIGO, NAT)),
           ("Stræk eller drej det ikke", f'<div style="transform:rotate(45deg) scaleX(1.3)">{sym}</div>'),
           ("Ingen hvid, ingen andre farver", f'<div style="background:#fff;padding:8px;border-radius:8px;filter:hue-rotate(150deg) saturate(3)">{sym}</div>'),
           ("Ingen skygger eller effekter", f'<div style="filter:drop-shadow(6px 6px 3px rgba(0,0,0,.5))">{sym}</div>'),
           ("Skriv ikke navnet selv", f'<div style="font-family:Georgia;font-style:italic;font-size:28px;color:{NAT}">Sagsvagt</div>')]
forkert_html = "".join(f'<div class="no"><div class="nb">{v}</div><span>✕ {t}</span></div>' for t, v in forkert)

html = f"""<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Sagsvagt brugsguide</title>
<style>
body{{margin:0;background:#D9D3C8;font-family:Montserrat,system-ui,sans-serif;color:{NAT};padding:44px 52px}}
header{{display:flex;justify-content:space-between;align-items:center;background:{MOEDET_CSS};color:{KALK};border-radius:22px;padding:40px 46px;margin-bottom:22px}}
header h1{{margin:0;font-size:36px;letter-spacing:-.02em}} header p{{margin:8px 0 0;opacity:.85;max-width:60ch;font-size:15px;line-height:1.55}}
h2{{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:#5f5a52;margin:26px 0 10px;font-weight:700}}
.card{{background:{KALK};border-radius:18px;padding:20px}}
.g2{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}
.vars{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}}
.v{{border-radius:14px;height:130px;display:grid;place-items:center;padding:0 18px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}}
.cap{{font-size:12px;color:#5f5a52;margin-top:6px}}
.vers{{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:10px}}
.ve{{border-radius:14px;height:170px;display:grid;place-items:center;padding:0 16px}}
.zone{{position:relative;display:inline-block;outline:2px dashed {P.RUBIN}}}
.zone::after{{content:"X";position:absolute;top:4px;left:8px;font-size:12px;color:{P.RUBIN};font-weight:700}}
.prow{{display:grid;grid-template-columns:70px repeat(4,1fr);gap:8px;align-items:start;margin-bottom:8px}} .prow>b{{font-size:13px;padding-top:30px}}
.sw .c{{height:70px;border-radius:10px;padding:8px;display:flex;align-items:end;font-size:12px;font-weight:700;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}}
.sw code{{display:block;font-size:10px;color:#5f5a52;margin-top:3px;font-family:Consolas,monospace}}
.pairs{{display:grid;grid-template-columns:1fr 1fr;gap:6px}}
.pair{{border-radius:10px;padding:8px 12px;display:flex;gap:10px;align-items:center;font-size:11.5px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}} .pair>b{{font-size:24px}}
.grad{{border-radius:14px;height:150px;background:{MOEDET_CSS}}}
pre{{background:{NAT};color:{KALK};border-radius:12px;padding:12px 14px;font-size:11px;line-height:1.5;white-space:pre-wrap;margin:10px 0 0}}
.type .t1{{font-weight:600;font-size:42px;letter-spacing:-.035em;margin:0}} .type .t2{{font-weight:700;font-size:22px;margin:6px 0 0}}
.type .t3{{font-size:14px;line-height:1.55;color:#3d3f46;margin:8px 0 0}}
.nos{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}}
.no{{background:{KALK};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;align-items:center}}
.nb{{height:110px;display:grid;place-items:center}} .no span{{font-size:12px;color:{P.VIN};font-weight:700;text-align:center}}
ul{{margin:6px 0 0;padding-left:18px;font-size:14px;line-height:1.6}}
table{{border-collapse:collapse;font-size:14px;width:100%}} td{{padding:7px 0;border-bottom:1px solid rgba(0,0,0,.08)}} td:last-child{{text-align:right;font-weight:600}}
</style></head><body>
<header><div><h1>Sagsvagt · Brugsguide</h1>
<p>To parter mødes og danner et S: rød og blå blok, der mødes om sagen. Sagsvagt følger med i byråd og udvalg i alle 98 kommuner, uanset farve, og sender dig de sager, der betyder noget for dig.</p></div>
{inline("sagsvagt-symbol-kalk", 150)}</header>

<h2>1 · Farvevarianter</h2>
<div class="vars">{var_html}</div>

<h2>2 · Versioner</h2>
<div class="vers">
  <div><div class="ve" style="background:{MOEDET_CSS}">{inline("sagsvagt-vandret-kalk", 80)}</div><div class="cap"><b>Vandret</b> · primært logo</div></div>
  <div><div class="ve" style="background:{NAT}">{inline("sagsvagt-stablet-roedblaa-moerk", 140)}</div><div class="cap"><b>Stablet</b> · kvadratiske og høje flader</div></div>
  <div><div class="ve" style="background:{KALK}">{inline("sagsvagt-symbol-roedblaa-lys", 120)}</div><div class="cap"><b>Symbol</b> · ikoner, profilbilleder, favicon</div></div>
  <div><div class="ve" style="background:{KALK}">{inline("sagsvagt-ordmaerke-nat", 44)}</div><div class="cap"><b>Ordmærke</b> · når symbolet allerede står tæt på</div></div>
</div>

<div class="g2">
<div><h2>3 · Frizone</h2><div class="card">
  <div style="display:flex;gap:24px;align-items:center"><span class="zone">{inline("sagsvagt-vandret-roedblaa-lys", 90)}</span>
  <ul><li><b>X</b> = ¼ af symbolets højde.</li><li>Mindst <b>1 X</b> fri luft hele vejen rundt.</li><li>Frizonen er bygget ind i filerne.</li></ul></div></div></div>
<div><h2>4 · Minimumsstørrelser</h2><div class="card"><table>
  <tr><td>Vandret logo, skærm</td><td>24 px høj</td></tr><tr><td>Vandret logo, tryk</td><td>25 mm bred</td></tr>
  <tr><td>Stablet logo, skærm</td><td>64 px høj</td></tr><tr><td>Symbol, skærm</td><td>16 px (brug favicon-filen)</td></tr>
  <tr><td>Symbol, tryk</td><td>6 mm høj</td></tr></table></div></div>
</div>

<h2>5 · Farver og kontrast</h2>
<div class="g2"><div class="card">{palet_html}</div>
<div class="card"><div class="pairs">{par_html}</div>
<p class="cap">Rubin og Skifer på Nat er kun til grafik og stor tekst (fx mærket), ikke til brødtekst. CMYK er omregnet og vejledende: få en trykprøve, og vælg evt. Pantone sammen med trykkeriet.</p></div></div>

<div class="g2">
<div><h2>6 · Gradienten "Mødet"</h2><div class="card"><div class="grad"></div>
<pre>background:
  radial-gradient(80% 100% at 0% 25%, {P.SKIFER} 0%, {P.INDIGO} 25%, {P.BLAEK} 52%, transparent 74%),
  radial-gradient(75% 95% at 100% 100%, {P.RUBIN} 0%, {P.VIN} 25%, {P.BORDEAUX} 52%, transparent 76%),
  {NAT};</pre>
<p class="cap">Blå glød fra venstre, rød nede fra højre, og de mødes i Nat. Færdige baggrunde ligger i <b>flader/</b>. Logoet står altid i Kalk på gradienten.</p></div></div>
<div><h2>7 · Typografi og regler</h2><div class="card type">
  <p class="t1">Montserrat SemiBold</p><p class="t2">Overskrifter i Montserrat Bold</p>
  <p class="t3">Brødtekst i Montserrat Regular (gratis, SIL Open Font License). Source Serif 4 kan bruges til længere resuméer.</p>
  <ul><li>Rød og blå bruges <b>ligeværdigt</b>: ingen af dem er "vinderfarven".</li>
  <li>I mærket står rød altid til venstre og blå til højre.</li>
  <li>Ingen hvid: brug Kalk som lys flade.</li></ul></div></div>
</div>

<h2>8 · Forkert brug</h2>
<div class="nos">{forkert_html}</div>
</body></html>"""
(HER / "brugsguide.html").write_text(html, "utf-8")
subprocess.run([sys.executable, f"{P.SKILL}/render_png.py", str(HER / "brugsguide.html"), "-o", str(HER / "brugsguide.png"),
                "--width", "1500", "--height", "2140"], check=True)
print("brugsguide skrevet")
