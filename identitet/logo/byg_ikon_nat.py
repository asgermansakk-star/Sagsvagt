"""Bygger app-ikonet og favicon i den sorte udgave fra reklamefilmen: mærket i Kalk på en flad Nat-flade (ingen gradient).

Samme størrelser og fyld som trin 4 i byg_pakke.py, men læser det færdige symbol fra svg/, så den ikke skal bruge
Montserrat-filen fra Windows. Skriver til web/ og kopierer ikonerne til roden af site/ (to mapper op).

Kør:  python byg_ikon_nat.py   (kræver cairosvg og pillow; på Mac: DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib)
"""
import io
import re
import shutil
from pathlib import Path

import cairosvg
from PIL import Image

HER = Path(__file__).resolve().parent
WEB = HER / "web"
SITE = HER.parent.parent
NAT = "#0E0F14"

_sym = (HER / "svg" / "sagsvagt-symbol-kalk.svg").read_text("utf-8")
IW, IH = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', _sym).groups())
BODY = re.search(r"</title>(.*)</svg>", _sym, re.S).group(1)


def flise(w, h, fill, rx=0):
    """Nat-flade w×h med symbolet centreret, så det fylder `fill` af den mindste side (som tile() i byg_pakke.py)."""
    k = fill * min(w / IW, h / IH)
    bg = f'<rect width="{w}" height="{h}" rx="{rx}" fill="{NAT}"/>'
    g = f'<g transform="translate({(w - IW * k) / 2:.2f} {(h - IH * k) / 2:.2f}) scale({k:.5f})">{BODY}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" width="{w}" height="{h}" '
            f'role="img"><title>Sagsvagt</title>{bg}{g}</svg>\n')


def png(svg, z):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=z, output_height=z))).convert("RGBA")


if __name__ == "__main__":
    ikon = flise(512, 512, 0.78)              # fuld flade; platformen runder
    maskable = flise(512, 512, 0.58)          # inden for sikker zone
    fav = flise(256, 256, 0.92, rx=56)        # afrundet flise
    (WEB / "sagsvagt-app-icon.svg").write_text(ikon, "utf-8")
    (WEB / "favicon.svg").write_text(fav, "utf-8")
    for z, src, navn in [(180, ikon, "apple-touch-icon"), (192, ikon, "icon-192"), (512, ikon, "icon-512"),
                         (512, maskable, "maskable-512"), (16, fav, "favicon-16"), (32, fav, "favicon-32"),
                         (48, fav, "favicon-48")]:
        png(src, z).save(WEB / f"{navn}.png", optimize=True)
    png(fav, 48).save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for f in ("favicon.svg", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "maskable-512.png"):
        shutil.copy2(WEB / f, SITE / f)
    print("Sort app-ikon bygget i web/ og kopieret til site/")
