"""
Punti d'interesse dei Simbruini da OpenStreetMap, piu' il confine del Parco.

Perche' OSM e non le schede del sito del Parco: quelle sono il loro archivio,
con foto e testi loro. OSM e' una banca dati aperta (ODbL), la stessa che gia'
fornisce i sentieri, e per cio' che serve qui - dove si dorme, dove si mangia,
dove si parcheggia, dove c'e' acqua - e' completa quanto basta e si aggiorna
da sola.

Il confine dell'area protetta e' una relazione OSM: si scarica insieme al
resto e si disegna sotto tutto, cosi' si vede subito cosa e' dentro il Parco.

Come i sentieri, NON gira nella CI: un bar non apre e chiude ogni sei ore, e
Overpass e' un servizio pubblico gratuito. Si lancia a mano, il risultato
viene committato.

Uso:  python scripts/poi.py
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "data", "poi.json")

UA = "mush-bot/1.0 (https://hypegodsrome.github.io/mush; eug2002@gmail.com)"
MIRROR = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

BBOX = (41.75, 12.90, 42.10, 13.45)     # sud, ovest, nord, est
DECIMALI = 5

# chiave -> (etichetta, icona, filtri Overpass)
# L'ordine e' quello con cui compaiono nel pannello.
CATEGORIE = {
    "visita":    ("Centri visita", "\U0001F3E1",
                  ['["information"="visitor_centre"]', '["tourism"="information"]["name"]']),
    "rifugi":    ("Rifugi e bivacchi", "\U0001F3D5",
                  ['["tourism"="alpine_hut"]', '["tourism"="wilderness_hut"]',
                   '["amenity"="shelter"]["name"]']),
    "dormire":   ("Dove dormire", "\U0001F6CF",
                  ['["tourism"~"^(hotel|guest_house|hostel|chalet|apartment)$"]["name"]']),
    "campeggi":  ("Campeggi", "\U0001F3D5",
                  ['["tourism"="camp_site"]', '["tourism"="caravan_site"]']),
    "mangiare":  ("Dove mangiare", "\U0001F374",
                  ['["amenity"~"^(restaurant|fast_food|bar|cafe|pub)$"]["name"]']),
    "picnic":    ("Aree pic-nic", "\U0001F333",
                  ['["tourism"="picnic_site"]', '["leisure"="picnic_table"]']),
    "acqua":     ("Acqua potabile", "\U0001F6B0",
                  ['["amenity"="drinking_water"]', '["natural"="spring"]["drinking_water"="yes"]',
                   '["man_made"="water_tap"]']),
    "vette":     ("Vette", "⛰",
                  ['["natural"="peak"]["name"]']),
    "grotte":    ("Grotte", "\U0001F573",
                  ['["natural"="cave_entrance"]']),
    "cascate":   ("Cascate e sorgenti", "\U0001F4A7",
                  ['["waterway"="waterfall"]', '["natural"="spring"]["name"]']),
    "parcheggi": ("Parcheggi", "\U0001F17F",
                  ['["amenity"="parking"]["name"]']),
    "ricarica":  ("Ricarica elettrica", "\U0001F50C",
                  ['["amenity"="charging_station"]']),
    "trasporti": ("Stazioni e fermate", "\U0001F68F",
                  ['["railway"="station"]', '["highway"="bus_stop"]["name"]']),
}

# Tag che vale la pena portarsi dietro nel fumetto. Il resto sarebbe peso.
TAG_UTILI = ("phone", "contact:phone", "website", "contact:website", "ele",
             "opening_hours", "operator", "addr:street", "addr:housenumber",
             "addr:city", "description")


def overpass(q):
    ultimo = None
    for m in MIRROR:
        try:
            url = f"{m}?{urllib.parse.urlencode({'data': q})}"
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            ultimo = e
            print(f"  [warn] {m.split('/')[2]}: {e}", file=sys.stderr)
    raise RuntimeError(f"nessun mirror Overpass ha risposto: {ultimo}")


def scarica_poi():
    s, o, n, e = BBOX
    pezzi = []
    for filtri in CATEGORIE.values():
        for f in filtri[2]:
            # nwr = nodi, way e relazioni insieme: un rifugio a volte e' un
            # punto e a volte l'edificio disegnato.
            pezzi.append(f"nwr{f}({s},{o},{n},{e});")
    q = "[out:json][timeout:180];(" + "".join(pezzi) + ");out center tags;"
    return overpass(q)


def scarica_confine():
    """Il perimetro dell'area protetta. `out geom` restituisce direttamente le
    coordinate dei membri: senza, servirebbe un secondo giro per i nodi."""
    q = ('[out:json][timeout:180];'
         'relation["boundary"="protected_area"]["name"~"Simbruini",i]'
         f'({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});out geom;')
    d = overpass(q)
    anelli = []
    for rel in d.get("elements", []):
        for m in rel.get("members", []):
            if m.get("type") != "way" or m.get("role") not in ("outer", ""):
                continue
            pts = [[round(g["lat"], DECIMALI), round(g["lon"], DECIMALI)]
                   for g in m.get("geometry", [])]
            if len(pts) >= 2:
                anelli.append(pts)
    return anelli


def _categoria(t):
    """A quale casella appartiene questo elemento. Il primo che risponde
    vince: l'ordine di CATEGORIE e' anche l'ordine di priorita', cosi' un
    rifugio che serve da mangiare resta un rifugio."""
    if t.get("information") == "visitor_centre" or (
            t.get("tourism") == "information" and t.get("name")):
        return "visita"
    if t.get("tourism") in ("alpine_hut", "wilderness_hut") or (
            t.get("amenity") == "shelter" and t.get("name")):
        return "rifugi"
    if t.get("tourism") in ("hotel", "guest_house", "hostel", "chalet", "apartment"):
        return "dormire"
    if t.get("tourism") in ("camp_site", "caravan_site"):
        return "campeggi"
    if t.get("amenity") in ("restaurant", "fast_food", "bar", "cafe", "pub"):
        return "mangiare"
    if t.get("tourism") == "picnic_site" or t.get("leisure") == "picnic_table":
        return "picnic"
    if t.get("amenity") in ("drinking_water", "water_tap") or \
            t.get("man_made") == "water_tap" or \
            (t.get("natural") == "spring" and t.get("drinking_water") == "yes"):
        return "acqua"
    if t.get("natural") == "peak":
        return "vette"
    if t.get("natural") == "cave_entrance":
        return "grotte"
    if t.get("waterway") == "waterfall" or t.get("natural") == "spring":
        return "cascate"
    if t.get("amenity") == "parking":
        return "parcheggi"
    if t.get("amenity") == "charging_station":
        return "ricarica"
    if t.get("railway") == "station" or t.get("highway") == "bus_stop":
        return "trasporti"
    return None


def main():
    print(f"  interrogo Overpass sul riquadro {BBOX}...")
    d = scarica_poi()
    els = d.get("elements", [])
    print(f"  {len(els)} elementi grezzi")

    visti = set()
    punti = []
    for el in els:
        t = el.get("tags", {}) or {}
        cat = _categoria(t)
        if not cat:
            continue
        c = el.get("center") or el
        lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None:
            continue

        nome = t.get("name") or ""
        # Fontane, parcheggi e fermate spesso non hanno nome: senza etichetta
        # il fumetto direbbe soltanto "senza nome", quindi si usa la categoria.
        if not nome:
            if cat in ("acqua", "picnic", "parcheggi", "ricarica"):
                nome = CATEGORIE[cat][0]
            else:
                continue

        # Lo stesso posto puo' tornare due volte se combacia con due filtri.
        chiave = (cat, nome, round(lat, 4), round(lon, 4))
        if chiave in visti:
            continue
        visti.add(chiave)

        p = {"c": cat, "n": nome,
             "lat": round(lat, DECIMALI), "lon": round(lon, DECIMALI)}
        extra = {k.split(":")[-1]: v for k, v in t.items() if k in TAG_UTILI}
        if extra:
            p["t"] = extra
        punti.append(p)

    punti.sort(key=lambda p: (p["c"], p["n"]))

    print("  cerco il confine dell'area protetta...")
    try:
        confine = scarica_confine()
    except Exception as e:
        confine = []
        print(f"  [warn] confine non disponibile: {e}", file=sys.stderr)

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, "w", encoding="utf-8") as f:
        json.dump({"bbox": BBOX,
                   "categorie": {k: {"nome": n, "icona": i}
                                 for k, (n, i, _) in CATEGORIE.items()},
                   "confine": confine, "punti": punti},
                  f, ensure_ascii=False, separators=(",", ":"))

    conteggio = {}
    for p in punti:
        conteggio[p["c"]] = conteggio.get(p["c"], 0) + 1
    for k, (n, _, _) in CATEGORIE.items():
        print(f"    {n}: {conteggio.get(k, 0)}")
    kb = os.path.getsize(DEST) / 1024
    print(f"  {len(punti)} punti e {len(confine)} tratti di confine "
          f"in data/poi.json ({kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
