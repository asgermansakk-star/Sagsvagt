"""Bygger Sagsvagts logopakke: S'et (40°, Fyldigere) i paletten 'Vin og blæk'.

Idé: to parter mødes og danner et S – rød og blå blok, der mødes om sagen.
Primært udtryk: mærket i Kalk på gradienten 'Mødet'. Ingen hvid i paletten.

Kør:  C:/Users/Asger/miniforge3/python.exe byg_pakke.py   (derefter byg_guide.py)
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HER = Path(__file__).parent
KONCEPT = HER.parent / "koncepter"
sys.path.insert(0, str(KONCEPT / "runde19"))
from ordmaerke import ordmaerke  # noqa: E402

PY = sys.executable
SKILL = "C:/Users/Asger/.claude/skills/logo-design/scripts"

# Geometrien for Håndslaget (runde 16) uden at bygge dens board
_src = KONCEPT / "runde16" / "byg_haandslaget.py"
_ns = {"__file__": str(_src)}
exec(_src.read_text("utf-8").split("V = {")[0], _ns)
variant = _ns["variant"]

# ---------------------------------------------------------------- palet
NAT, GRAFIT, STEN, KALK = "#0E0F14", "#2A2B33", "#8D8A86", "#E6DFD3"
BORDEAUX, VIN, RUBIN, ROSEN = "#3E0E14", "#8A2430", "#B04A50", "#DCA9A5"
BLAEK, INDIGO, SKIFER, LYNG = "#0C1430", "#28377A", "#5D6BA8", "#B7BBD8"
SORT = "#000000"

# Farvevarianter: (venstre/røde blad, højre/blå blad, tekst)
VARIANTER = {
    "kalk": (KALK, KALK, KALK),               # på gradient og mørke flader (primær)
    "nat": (NAT, NAT, NAT),                   # på lyse flader
    "roedblaa-moerk": (RUBIN, SKIFER, KALK),  # tofarvet på Nat
    "roedblaa-lys": (VIN, INDIGO, NAT),       # tofarvet på Kalk
    "sort": (SORT, SORT, SORT),               # én farve til tryk, stempel, gravering
}

# ---------------------------------------------------------------- mærket
fitted = variant(dot=0, rotate=-40, h=27)              # 40°, Fyldigere
hole = next(o for o, r in fitted if r == "hul")
A = next(o for o, r in fitted if r == "a")
B = next(o for o, r in fitted if r == "b")


def _cx(p):
    q = p.points()
    return sum(v[0] for v in q) / len(q)


VENSTRE, HOEJRE = (A, B) if _cx(A) < _cx(B) else (B, A)  # rød blok til venstre, blå til højre
pts = [p for s in (A, B) for p in s.points()]
MX0, MY0 = min(p[0] for p in pts), min(p[1] for p in pts)
MX1, MY1 = max(p[0] for p in pts), max(p[1] for p in pts)
MW, MH = MX1 - MX0, MY1 - MY0


def mark_group(cv, ch, x, y, h):
    """Mærket med øverste venstre hjørne af dets udstrækning i (x, y) og højden h. cv = venstre blad, ch = højre."""
    t = f'translate({x:.2f} {y:.2f}) scale({h / MH:.5f}) translate({-MX0:.2f} {-MY0:.2f})'
    if cv == ch:
        return f'<path fill="{cv}" fill-rule="evenodd" transform="{t}" d="{VENSTRE.d()} {hole.d()} {HOEJRE.d()} {hole.d()}"/>'
    return (f'<path fill="{cv}" fill-rule="evenodd" transform="{t}" d="{VENSTRE.d()} {hole.d()}"/>'
            f'<path fill="{ch}" fill-rule="evenodd" transform="{t}" d="{HOEJRE.d()} {hole.d()}"/>')


def doc(w, h, body, title="Sagsvagt", defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w:.0f}" height="{h:.0f}" '
            f'role="img"><title>{title}</title>{defs}{body}</svg>\n')


# ---------------------------------------------------------------- ordmærket
WD, WW, CAP, XH, UPM = ordmaerke()


def word(color, x, baseline, cap_px):
    s = cap_px / CAP
    return f'<path fill="{color}" transform="translate({x:.2f} {baseline:.2f}) scale({s:.5f})" d="{WD}"/>', WW * s


# Systemets enhed: X = 1/4 af mærkets højde. Afstande og frizoner er multipla af X.
H = 200.0
X = H / 4
MWH = MW * H / MH  # mærkets bredde ved højden H


def symbol_body(v):
    cv, ch, _ = VARIANTER[v]
    return MWH + 2 * X, H + 2 * X, mark_group(cv, ch, X, X, H)


def vandret_body(v):
    """Mærket = 2 × versalhøjden; afstand mærke–navn = 1,5 X; versalerne centreret på mærket."""
    cv, ch, ct = VARIANTER[v]
    cap = H / 2
    x_text = X + MWH + 1.5 * X
    g, tw = word(ct, x_text, X + H / 2 + cap / 2, cap)
    return x_text + tw + X, H + 2 * X, mark_group(cv, ch, X, X, H) + g


def stablet_body(v):
    """Navnets bredde = 1,9 × mærkets højde; luft mellem mærke og navn = 1 X."""
    cv, ch, ct = VARIANTER[v]
    cap = 1.9 * H / (WW / CAP)
    tw = WW * cap / CAP
    w = max(tw, MWH) + 2 * X
    y_text = X + H + X + cap
    g, _ = word(ct, (w - tw) / 2, y_text, cap)
    return w, y_text + X, mark_group(cv, ch, (w - MWH) / 2, X, H) + g


def ordmaerke_body(v):
    ct = VARIANTER[v][2]
    cap = 100.0
    g, tw = word(ct, X / 2, X / 2 + cap, cap)
    return tw + X, cap + 0.30 * cap + X, g  # plads til underlængden i "g"


VERSIONER = {"symbol": symbol_body, "vandret": vandret_body, "stablet": stablet_body, "ordmaerke": ordmaerke_body}


# ---------------------------------------------------------------- gradienten 'Mødet'
def moedet_defs(w, h, uid="m"):
    """Gradienten 'Mødet': blå glød fra venstre, rød glød nede fra højre, på Nat. Svarer til CSS:
      radial-gradient(80% 100% at 0% 25%, Skifer 0%, Indigo 25%, Blæk 52%, transparent 74%),
      radial-gradient(75% 95% at 100% 100%, Rubin 0%, Vin 25%, Bordeaux 52%, transparent 76%), Nat
    """
    def rg(gid, cxp, cyp, rxp, ryp, stops):
        st = "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
        return (f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" '
                f'gradientTransform="translate({cxp * w:.1f} {cyp * h:.1f}) scale({rxp * w:.1f} {ryp * h:.1f})">{st}</radialGradient>')
    blaa = rg(f"{uid}b", 0, 0.25, 0.80, 1.00, [(0, SKIFER, 1), (0.25, INDIGO, 1), (0.52, BLAEK, 1), (0.74, BLAEK, 0)])
    roed = rg(f"{uid}r", 1, 1, 0.75, 0.95, [(0, RUBIN, 1), (0.25, VIN, 1), (0.52, BORDEAUX, 1), (0.76, BORDEAUX, 0)])
    bg = (f'<rect width="{w}" height="{h}" fill="{NAT}"/><rect width="{w}" height="{h}" fill="url(#{uid}r)"/>'
          f'<rect width="{w}" height="{h}" fill="url(#{uid}b)"/>')
    return f"<defs>{blaa}{roed}</defs>", bg


def tile(w, h, inner_fn, v="kalk", fill=0.5, rx=0, uid="m"):
    """Gradient-flade w×h med en logoversion centreret, så den fylder `fill` af den mindste side."""
    iw, ih, body = inner_fn(v)
    k = fill * min(w / iw, h / ih)
    defs, bg = moedet_defs(w, h, uid)
    if rx:
        defs = defs.replace("</defs>", f'<clipPath id="{uid}c"><rect width="{w}" height="{h}" rx="{rx}"/></clipPath></defs>')
        bg = f'<g clip-path="url(#{uid}c)">{bg}</g>'
    g = f'<g transform="translate({(w - iw * k) / 2:.2f} {(h - ih * k) / 2:.2f}) scale({k:.5f})">{body}</g>'
    return doc(w, h, bg + g, defs=defs)


def render(svg_path, png_path, w, h):
    subprocess.run([PY, f"{SKILL}/render_png.py", str(svg_path), "-o", str(png_path), "--width", str(w),
                    "--height", str(h), "--padding", "0"], check=True, capture_output=True)


if __name__ == "__main__":
    for d in ("svg", "png", "web", "flader"):
        shutil.rmtree(HER / d, ignore_errors=True)
        (HER / d).mkdir()
    for f in ("_ikon-master.svg", "_favicon-kilde.svg"):
        (HER / f).unlink(missing_ok=True)

    # 1 · logoer i alle farvevarianter
    for navn, fn in VERSIONER.items():
        for v in VARIANTER:
            w, h, body = fn(v)
            (HER / "svg" / f"sagsvagt-{navn}-{v}.svg").write_text(doc(w, h, body), "utf-8")

    # 2 · PNG'er (gennemsigtige) i naturligt format, længste side 1200 px
    for f in sorted((HER / "svg").glob("*.svg")):
        m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', f.read_text("utf-8"))
        vw, vh = float(m.group(1)), float(m.group(2))
        k = 1200 / max(vw, vh)
        render(f, HER / "png" / f"{f.stem}.png", round(vw * k), round(vh * k))

    # 3 · gradient-flader: rene baggrunde og med logo (primært udtryk: Kalk på Mødet)
    FLADER = [("web-1920x1080", 1920, 1080, vandret_body, 0.42), ("kvadrat-1080", 1080, 1080, stablet_body, 0.50),
              ("story-1080x1920", 1080, 1920, stablet_body, 0.55), ("banner-1500x500", 1500, 500, vandret_body, 0.50),
              ("linkedin-1584x396", 1584, 396, vandret_body, 0.48)]
    for navn, w, h, fn, fill in FLADER:
        defs, bg = moedet_defs(w, h)
        ren = HER / "flader" / f"moedet-{navn}.svg"
        ren.write_text(doc(w, h, bg, defs=defs), "utf-8")
        render(ren, ren.with_suffix(".png"), w, h)
        med = HER / "flader" / f"moedet-{navn}-logo.svg"
        med.write_text(tile(w, h, fn, fill=fill), "utf-8")
        render(med, med.with_suffix(".png"), w, h)

    # 4 · app-ikon og favicon: mærket i Kalk på Mødet
    web = HER / "web"
    ikon = web / "sagsvagt-app-icon.svg"
    ikon.write_text(tile(512, 512, symbol_body, fill=0.78), "utf-8")                 # fuld flade; platformen runder
    maskable = web / "_maskable.svg"
    maskable.write_text(tile(512, 512, symbol_body, fill=0.58), "utf-8")             # inden for sikker zone
    fav = web / "favicon.svg"
    fav.write_text(tile(256, 256, symbol_body, fill=0.92, rx=56, uid="f"), "utf-8")  # afrundet flise
    for z, src, navn in [(180, ikon, "apple-touch-icon"), (192, ikon, "icon-192"), (512, ikon, "icon-512"),
                         (512, maskable, "maskable-512"), (16, fav, "favicon-16"), (32, fav, "favicon-32"),
                         (48, fav, "favicon-48")]:
        render(src, web / f"{navn}.png", z, z)
    maskable.unlink()
    subprocess.run([PY, f"{SKILL}/render_png.py", str(fav), "--ico", str(web / "favicon.ico"),
                    "--ico-sizes", "16", "32", "48"], check=True, capture_output=True)
    (web / "site.webmanifest").write_text(json.dumps({
        "name": "Sagsvagt", "short_name": "Sagsvagt",
        "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
        "theme_color": NAT, "background_color": NAT, "display": "standalone"}, indent=2, ensure_ascii=False), "utf-8")
    (web / "head-snippet.html").write_text(
        '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n'
        f'<meta name="theme-color" content="{NAT}">\n', "utf-8")

    print("Logopakke bygget:", len(list((HER / 'svg').glob('*.svg'))), "logo-SVG,",
          len(list((HER / 'flader').glob('*.png'))), "flader,", len(list(web.iterdir())), "web-filer")
