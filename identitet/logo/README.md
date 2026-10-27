# Sagsvagt – logopakke

To parter mødes og danner et S: rød og blå blok, der mødes om sagen. Paletten hedder **Vin og blæk** og har ingen hvid.
Det primære udtryk er mærket i **Kalk** på gradienten **Mødet**.
Se `brugsguide.png` for farvevarianter, frizone, minimumsstørrelser, palet og kontrast, gradient, typografi og forbudt brug.

## Filer

| Mappe | Indhold |
|---|---|
| `svg/` | Masterfiler i fire versioner: `vandret` (primært), `stablet`, `symbol` og `ordmaerke`. Hver version findes i fem farvevarianter (se tabellen nedenfor). Frizonen (1 X) er indbygget. |
| `png/` | De samme filer som gennemsigtig PNG, længste side 1200 px. |
| `flader/` | Gradienten "Mødet" som SVG og PNG, både ren og med logoet i Kalk: web 1920×1080, kvadrat 1080, story 1080×1920, banner 1500×500 og LinkedIn 1584×396. |
| `web/` | Mærket i Kalk på Mødet: `favicon.ico`, `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `sagsvagt-app-icon.svg`, `site.webmanifest` og `head-snippet.html`, som skal ind i `<head>`. |

### Farvevarianter

| Navn | Brug |
|---|---|
| `kalk` | Primært: på gradienten Mødet og andre mørke flader |
| `roedblaa-moerk` | Rød og blå (Rubin + Skifer) på Nat |
| `roedblaa-lys` | Rød og blå (Vin + Indigo) på Kalk |
| `nat` | Én farve på lyse flader |
| `sort` | Kun til tryk i én farve (stempel, gravering) |

## Palet

| Rød | HEX | Blå | HEX | Neutral | HEX |
|---|---|---|---|---|---|
| Bordeaux | #3E0E14 | Blæk | #0C1430 | Nat | #0E0F14 |
| Vin | #8A2430 | Indigo | #28377A | Grafit | #2A2B33 |
| Rubin | #B04A50 | Skifer | #5D6BA8 | Sten | #8D8A86 |
| Rosen | #DCA9A5 | Lyng | #B7BBD8 | Kalk | #E6DFD3 |

## Regler i korte træk
- Rød og blå bruges ligeværdigt. Ingen af dem er "vinderfarven".
- I mærket står rød altid til venstre og blå til højre.
- Ingen hvid. Brug Kalk som lys flade.

## Skrift
Montserrat, SemiBold i logoet og Bold/Regular i tekst. Den er gratis under SIL Open Font License. Ordmærket er tegnet som konturer.

## App-ikon (27/10)
App-ikonet og favicon bruger nu den sorte udgave fra reklamefilmen: mærket i Kalk på flad Nat uden gradient. `byg_ikon_nat.py` bygger dem på Mac'en og kopierer dem til roden af `site/`. Kør den efter `byg_pakke.py`, ellers kommer gradient-ikonet tilbage. Den gamle udgave ligger uden for repoet i `Sagsvagt/identitet/logo-backup-foer-sort/`.

## Hvor pakken ligger
Pakken ligger i repoet under `site/identitet/logo/`. Robotten lægger den ikke op på sagsvagt.dk (`--exclude '/identitet'` i `opdater-avisen.yml`). `Sagsvagt/identitet/logo` er en genvej hertil, så videoværktøjerne finder filerne. Kør `byg_pakke.py` via genvejen, for den henter geometrien fra `Sagsvagt/identitet/koncepter/`, som ikke er i repoet.

## Byg igen
Kør `byg_pakke.py` og derefter `byg_guide.py`, fx `C:/Users/Asger/miniforge3/python.exe byg_pakke.py`. Paletten og varianterne står øverst i `byg_pakke.py`.

## Før lancering
- Lav en varemærkesøgning (fx på dkpto.dk og euipo.europa.eu) og en omvendt billedsøgning på symbolet.
- CMYK-værdierne er kun omregnede. Få en trykprøve, særligt af gradienten, før der trykkes.
