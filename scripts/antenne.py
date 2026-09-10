"""
Tralicci e antenne di telefonia dei Simbruini da OpenStreetMap.

Perche' OSM e non un catasto ufficiale. Sono state provate le alternative:

  OpenCellID (opencellid.org)  e' il dataset aperto delle celle - quello che
  avrebbe cell ID, LAC e potenza stimata, cioe' esattamente il dato buono. Il
  download pero' passa da https://opencellid.org/ocid/downloads?token=...:
  senza token risponde {"status":"error","message":"INVALID_DATA"}, e la
  chiave si ottiene solo registrandosi. Niente registrazioni per un sito
  statico: scartato.

  ARPA Lazio pubblica in dati aperti "Densita_impianti_telefonia_mobile.xlsx".
  Scaricato e aperto: e' un conteggio di impianti per Comune, senza una sola
  coordinata. Gli altri due file (ImpiantiTV, ImpiantiRadio) sono radio e
  televisione, non telefonia. Inutilizzabile per mettere puntini su una mappa.

  Il portale dati.lazio.it non espone l'API CKAN (package_search -> 404).

Resta OSM: aperto (ODbL), senza chiave, gia' usato dal resto del sito, e i
tralicci sono oggetti grandi e fissi che i mappatori censiscono bene. Cio' che
OSM NON ha e' quale cella serve quale punto: e' una posizione, non una
copertura. Il resto del programma lo dice a chiare lettere.

Come poi.py e sentieri.py, NON gira nella CI: un traliccio non si sposta ogni
sei ore, e Overpass e' un servizio pubblico gratuito. Si lancia a mano, il
risultato viene committato.

Uso:  python scripts/antenne.py
"""

import datetime
import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "data", "antenne.json")

UA = "mush-bot/1.0 (https://hypegodsrome.github.io/mush; eug2002@gmail.com)"
MIRROR = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

BBOX = (41.75, 12.90, 42.10, 13.45)     # sud, ovest, nord, est
DECIMALI = 5

# Distanza entro cui un traliccio si considera "in paese". Serve solo a
# scegliere il raggio disegnato sulla mappa: in centro abitato le celle sono
# fitte e piccole, in mezzo al bosco rade e larghe.
RAGGIO_ABITATO_M = 1000

# tower:type che NON sono telecomunicazioni. Senza questo filtro la mappa si
# riempie di campanili: nel riquadro ce ne sono 27, piu' torri di guardia
# medievali e pali della luce.
TIPI_ESCLUSI = {
    "bell_tower", "church", "lighting", "defensive", "observation",
    "watchtower", "cooling", "water_tower", "clock", "minaret", "bridge",
    "diving", "hose", "monitoring", "siren", "chimney", "pagoda", "stele",
}


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


def scarica_antenne():
    s, o, n, e = BBOX
    # nwr e non node: un traliccio grosso a volte e' disegnato come area.
    # Si interroga largo e si filtra dopo, perche' i mappatori usano tag
    # diversi per la stessa cosa - a volte il palo, a volte l'antenna sopra.
    filtri = [
        '["man_made"="mast"]',
        '["man_made"="tower"]',
        '["man_made"="antenna"]',
        '["telecom"="antenna"]',
        '["communication:mobile_phone"="yes"]',
        '["tower:type"="communication"]',
    ]
    pezzi = "".join(f"nwr{f}({s},{o},{n},{e});" for f in filtri)
    return overpass(f"[out:json][timeout:180];({pezzi});out center tags;")


def scarica_abitati():
    """Citta', paesi e frazioni: servono solo a capire quali tralicci stanno
    dentro un centro abitato."""
    s, o, n, e = BBOX
    q = ('[out:json][timeout:120];'
         f'node["place"~"^(city|town|village|hamlet)$"]({s},{o},{n},{e});'
         'out qt;')
    return [(el["lat"], el["lon"]) for el in overpass(q).get("elements", [])
            if el.get("lat") is not None]


def metri(a_lat, a_lon, b_lat, b_lon):
    """Distanza in metri. Formula piatta con correzione del coseno: a queste
    latitudini e su queste distanze l'errore rispetto alla sfera e' sotto il
    metro, e non serve altro per decidere se un palo e' in paese."""
    dy = (b_lat - a_lat) * 111320
    dx = (b_lon - a_lon) * 111320 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot(dx, dy)


def _tipo(t):
    """Quanto e' sicuro che questo oggetto sia telefonia mobile.

      'mobile'  il mappatore ha scritto communication:mobile_phone=yes.
                E' l'unico caso in cui si puo' dirlo senza inventare.
      'comm'    palo o traliccio di telecomunicazioni: puo' essere telefonia,
                puo' essere un ponte radio o un ripetitore televisivo.

    Chi non rientra in nessuno dei due torna None e non finisce sulla mappa."""
    if t.get("communication:mobile_phone") == "yes":
        return "mobile"
    tt = t.get("tower:type")
    if tt in TIPI_ESCLUSI:
        return None
    if tt == "communication" or t.get("telecom") == "antenna" or \
            t.get("man_made") == "antenna":
        return "comm"
    # man_made=mast senza altri tag: nel riquadro sono quasi sempre pali
    # radio, ma "quasi sempre" non basta per chiamarli antenne.
    return None


def _altezza(t):
    for k in ("height", "tower:height", "est_height"):
        v = t.get(k)
        if not v:
            continue
        try:
            return round(float(str(v).replace(",", ".").split()[0]), 1)
        except ValueError:
            pass
    return None


def main():
    print(f"  interrogo Overpass sul riquadro {BBOX}...")
    d = scarica_antenne()
    els = d.get("elements", [])
    print(f"  {len(els)} elementi grezzi (pali, torri, campanili, antenne)")

    print("  cerco i centri abitati per distinguere paese e bosco...")
    try:
        abitati = scarica_abitati()
    except Exception as e:
        abitati = []
        print(f"  [warn] centri abitati non disponibili: {e}", file=sys.stderr)
    print(f"  {len(abitati)} centri abitati")

    grezze = []
    for el in els:
        t = el.get("tags", {}) or {}
        tipo = _tipo(t)
        if not tipo:
            continue
        c = el.get("center") or el
        lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None:
            continue
        grezze.append((lat, lon, tipo, t))

    # Un traliccio con tre antenne sopra e' spesso quattro oggetti OSM nello
    # stesso punto. Sulla mappa devono restare un pallino solo, altrimenti il
    # conteggio mente e i cerchi si sovrappongono a caso. Si tiene il piu'
    # informato: 'mobile' batte 'comm', e con i tag batte senza.
    grezze.sort(key=lambda g: (g[2] != "mobile", -len(g[3])))
    antenne = []
    for lat, lon, tipo, t in grezze:
        if any(metri(lat, lon, a["lat"], a["lon"]) < 60 for a in antenne):
            continue
        a = {"lat": round(lat, DECIMALI), "lon": round(lon, DECIMALI), "t": tipo}
        op = t.get("operator") or t.get("network") or t.get("owner")
        if op:
            a["op"] = op
        if t.get("name"):
            a["n"] = t["name"]
        h = _altezza(t)
        if h:
            a["h"] = h
        # 1 = dentro un centro abitato. Decide solo il raggio disegnato.
        if any(metri(lat, lon, plat, plon) < RAGGIO_ABITATO_M
               for plat, plon in abitati):
            a["ab"] = 1
        antenne.append(a)

    antenne.sort(key=lambda a: (a["lat"], a["lon"]))

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, "w", encoding="utf-8") as f:
        json.dump({
            "bbox": BBOX,
            "fonte": "OpenStreetMap (ODbL) via Overpass",
            "aggiornato": datetime.datetime.now(
                datetime.timezone.utc).strftime("%Y-%m-%d"),
            # Il testo che il sito mostra: sta qui e non nel JavaScript
            # perche' e' il limite del DATO, e chi legge il file lo deve
            # trovare senza aprire la pagina.
            "avvertenza": ("Posizioni dei tralicci, non copertura. OSM non "
                           "dice quale cella serve quale punto, e nessun "
                           "browser puo' leggere la cella agganciata."),
            "raggio_abitato_m": RAGGIO_ABITATO_M,
            "antenne": antenne,
        }, f, ensure_ascii=False, separators=(",", ":"))

    n_mob = sum(1 for a in antenne if a["t"] == "mobile")
    n_ab = sum(1 for a in antenne if a.get("ab"))
    n_op = sum(1 for a in antenne if a.get("op"))
    print(f"    telefonia mobile dichiarata: {n_mob}")
    print(f"    telecomunicazioni generiche: {len(antenne) - n_mob}")
    print(f"    dentro un centro abitato:    {n_ab}")
    print(f"    con operatore noto:          {n_op}")
    kb = os.path.getsize(DEST) / 1024
    print(f"  {len(antenne)} antenne in data/antenne.json ({kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
