"""
Scarica le foto delle specie da Wikimedia Commons.

Perche' non una ricerca per parola chiave: su una guida ai funghi la foto DEVE
essere della specie giusta. Una ricerca su Commons per "Boletus edulis"
restituisce anche cesti misti e sosia fotografati per confronto, e una foto
sbagliata qui non e' un difetto estetico, e' un rischio. Si parte invece
dall'immagine di apertura dell'articolo di Wikipedia, che gli editori
sorvegliano proprio perche' rappresenti la specie del titolo.

Le licenze vengono lette dai metadati di Commons e salvate accanto ai file:
CC BY e CC BY-SA obbligano a citare autore e licenza, e va fatto in pagina.

Uso:  python scripts/immagini.py
"""

import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "assets", "specie")
UA = "mush-bot/1.0 (https://hypegodsrome.github.io/mush; eug2002@gmail.com)"

LARGHEZZA = 720          # basta per una scheda: oltre e' peso sprecato
QUALITA = 82

# id nel sito -> titolo dell'articolo Wikipedia da cui prendere l'immagine.
# Si prova prima l'edizione italiana, poi quella inglese.
SPECIE = {
    "porcino":     ("Boletus edulis", "Boletus edulis"),
    "galletto":    ("Cantharellus cibarius", "Cantharellus cibarius"),
    "steccherino": ("Hydnum repandum", "Hydnum repandum"),
    "trombetta":   ("Craterellus cornucopioides", "Craterellus cornucopioides"),
    "ovolo":       ("Amanita caesarea", "Amanita caesarea"),
    "mazza":       ("Macrolepiota procera", "Macrolepiota procera"),
    "chiodino":    ("Armillaria mellea", "Armillaria mellea"),
    "prugnolo":    ("Calocybe gambosa", "Calocybe gambosa"),
    "russula":     ("Russula virescens", "Russula virescens"),
    "sanguinello": ("Lactarius deliciosus", "Lactarius deliciosus"),
    "prataiolo":   ("Agaricus campestris", "Agaricus campestris"),
    "pinarolo":    ("Suillus luteus", "Suillus luteus"),
    "vescia":      ("Lycoperdon perlatum", "Lycoperdon perlatum"),
    "prunulo":     ("Clitopilus prunulus", "Clitopilus prunulus"),
    # I sosia pericolosi: vederli conta piu' che leggerne la descrizione.
    "x-phalloides":  ("Amanita phalloides", "Amanita phalloides"),
    "x-galerina":    ("Galerina marginata", "Galerina marginata"),
    "x-omphalotus":  ("Omphalotus olearius", "Omphalotus olearius"),
    "x-entoloma":    ("Entoloma sinuatum", "Entoloma sinuatum"),
    "x-xanthodermus": ("Agaricus xanthodermus", "Agaricus xanthodermus"),
    "x-clitocybe":    ("Clitocybe dealbata", "Clitocybe rivulosa"),
    "x-scleroderma":  ("Scleroderma citrinum", "Scleroderma citrinum"),
    "x-verna":        ("Amanita verna", "Amanita verna"),
}

# Licenze accettate. Tutto il resto si scarta: meglio una scheda senza foto
# che una foto che non possiamo pubblicare.
OK_LICENZE = re.compile(r"^(cc[ -]?by([ -]sa)?([ -][\d.]+)?|cc0|public domain|pd)", re.I)


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _json(url):
    return json.loads(_get(url).decode())


def _pulisci(html):
    """I metadati di Commons arrivano in HTML: qui serve il testo."""
    if not html:
        return None
    t = re.sub(r"<[^>]+>", "", html)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def file_di_wikipedia(titolo, lingua):
    """Nome del file dell'immagine di apertura dell'articolo."""
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "pageimages",
        "piprop": "original|name", "titles": titolo, "redirects": "1",
    })
    d = _json(f"https://{lingua}.wikipedia.org/w/api.php?{q}")
    for p in (d.get("query", {}).get("pages") or {}).values():
        nome = p.get("pageimage")
        if nome:
            return "File:" + nome
    return None


def scheda_commons(nome_file):
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "titles": nome_file,
        "prop": "imageinfo", "iiprop": "url|extmetadata|size",
        "iiurlwidth": str(LARGHEZZA),
    })
    d = _json(f"https://commons.wikimedia.org/w/api.php?{q}")
    for p in (d.get("query", {}).get("pages") or {}).values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii:
            continue
        em = ii.get("extmetadata", {})
        return {
            "file": p["title"],
            "url": ii.get("thumburl") or ii["url"],
            "licenza": _pulisci(em.get("LicenseShortName", {}).get("value")),
            "autore": _pulisci(em.get("Artist", {}).get("value")),
            "pagina": ii.get("descriptionurl"),
        }
    return None


def salva(sid, meta):
    dati = _get(meta["url"], timeout=120)
    im = Image.open(io.BytesIO(dati))
    im = im.convert("RGB")
    if im.width > LARGHEZZA:
        im = im.resize((LARGHEZZA, round(im.height * LARGHEZZA / im.width)),
                       Image.LANCZOS)
    # Taglio 4:3 dal centro: le schede hanno tutte lo stesso riquadro, e
    # lasciare che ogni foto imponga la sua altezza sfalsa la griglia.
    alto = round(im.width * 3 / 4)
    if im.height > alto:
        y = (im.height - alto) // 2
        im = im.crop((0, y, im.width, y + alto))
    p = os.path.join(DEST, f"{sid}.jpg")
    im.save(p, "JPEG", quality=QUALITA, optimize=True, progressive=True)
    return os.path.getsize(p)


def main():
    os.makedirs(DEST, exist_ok=True)
    crediti, mancanti = {}, []

    for sid, (it, en) in SPECIE.items():
        nome = None
        for lingua, titolo in (("it", it), ("en", en)):
            try:
                nome = file_di_wikipedia(titolo, lingua)
            except Exception as e:
                print(f"  [warn] {sid} {lingua}: {e}", file=sys.stderr)
            if nome:
                break
        if not nome:
            mancanti.append((sid, "nessuna immagine nell'articolo"))
            continue

        meta = scheda_commons(nome)
        if not meta:
            mancanti.append((sid, "file non trovato su Commons"))
            continue

        lic = meta["licenza"] or ""
        if not OK_LICENZE.match(lic.replace("-", " ")):
            mancanti.append((sid, f"licenza non utilizzabile: {lic}"))
            continue

        peso = salva(sid, meta)
        crediti[sid] = {k: meta[k] for k in ("file", "licenza", "autore", "pagina")}
        print(f"  {sid:<14} {peso/1024:5.0f} KB  {lic:<16} {(meta['autore'] or '')[:34]}")

    with open(os.path.join(DEST, "crediti.json"), "w", encoding="utf-8") as f:
        json.dump(crediti, f, ensure_ascii=False, indent=1)

    print(f"\n  {len(crediti)} immagini salvate in assets/specie/")
    for sid, perche in mancanti:
        print(f"  [manca] {sid}: {perche}", file=sys.stderr)
    return 0 if crediti else 1


if __name__ == "__main__":
    sys.exit(main())
