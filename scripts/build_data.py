"""
Genera i JSON statici che il sito legge.

Gira dentro GitHub Actions, non nel browser. Due motivi:
  - meteofunghi.fungocenter.it non manda header CORS e vieta l'iframe
    (X-Frame-Options: SAMEORIGIN), quindi dal browser non e' raggiungibile;
  - cosi' l'eventuale chiave Windy resta in un Secret e non finisce nel JS.

Produce in data/:
  meteofunghi.json  griglia nazionale di crescita estratta da meteofunghi
  spots.json        punteggio del nostro modello per ogni zona dei Simbruini
  meta.json         timestamp e stato delle sorgenti

Uso:  python scripts/build_data.py
"""

import html as html_mod
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import growth  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

UA = "Mozilla/5.0 (compatible; mush-bot/1.0; +https://github.com/hypegodsrome/mush)"
METEOFUNGHI = "https://meteofunghi.fungocenter.it/embed"
OPENMETEO = "https://api.open-meteo.com/v1/forecast"
ARCHIVIO = "https://archive-api.open-meteo.com/v1/archive"
STORICO_MODELLI = "https://historical-forecast-api.open-meteo.com/v1/forecast"
ANNI_CLIMA = 15          # per la norma stagionale
FINESTRA_CLIMA = 60      # giorni su cui si confronta il cumulato con la norma
WINDY = "https://api.windy.com/api/point-forecast/v2"
STAZIONE = "https://meteoregionelazio.it/rete/stazione.php"
STAZIONE_ID = "RM-175"                      # Monte Livata - Centro Visite Simbruini
STAZIONE_LATLON = (41.9389, 13.1487)        # dichiarate dalla scheda clima
BIAS_RAGGIO_KM = 8.0                        # oltre, la stazione non e' rappresentativa

# Zone dei Monti Simbruini. L'altitudine la ricalcola Open-Meteo dal suo DEM,
# quella qui sotto e' solo indicativa per la scheda.
# Coordinate verificate su Nominatim/OSM il 09/09/2026, tranne dove indicato.
# `alberi` sono frazioni di copertura, stimate dalla fascia altimetrica dei
# Simbruini: faggeta sopra i ~1000 m, castagno e querce (roverella, cerro) sotto,
# leccio sui versanti caldi della valle dell'Aniene. Sono stime, non un rilievo
# forestale: correggile con quello che vedi davvero nei tuoi boschi.
SPOTS = [
    {"id": "livata", "nome": "Monte Livata", "lat": 41.9386, "lon": 13.1529,
     "bosco": "faggeta (Campo dell'Osso, Monna dell'Orso)",
     "alberi": {"faggio": 0.95, "quercia": 0.05}},

    {"id": "campaegli", "nome": "Campaegli", "lat": 41.9716, "lon": 13.1072,
     "bosco": "faggeta con rimboschimenti di conifere",
     "alberi": {"faggio": 0.85, "conifere": 0.10, "quercia": 0.05}},

    {"id": "roccacanterano", "nome": "Rocca Canterano", "lat": 41.9565, "lon": 13.0218,
     "bosco": "castagneto e querceto, faggio in alto",
     "alberi": {"castagno": 0.40, "quercia": 0.40, "faggio": 0.20}},

    {"id": "canterano", "nome": "Canterano", "lat": 41.9421, "lon": 13.0373,
     "bosco": "castagneto e querceto",
     "alberi": {"castagno": 0.45, "quercia": 0.45, "faggio": 0.10}},

    {"id": "cicchetti", "nome": "Localita' Cicchetti", "lat": 41.9490, "lon": 13.0300,
     "bosco": "misto castagno-quercia",
     "alberi": {"castagno": 0.40, "quercia": 0.40, "faggio": 0.20},
     # OSM non conosce questo toponimo: nessun risultato ne' su Nominatim ne'
     # su Overpass. Piazzata fra Canterano e Rocca Canterano, da correggere
     # con le coordinate vere.
     "approssimata": True},

    {"id": "subiaco", "nome": "Subiaco", "lat": 41.9267, "lon": 13.0944,
     "bosco": "querceto, castagneto, leccio sui versanti caldi",
     "alberi": {"quercia": 0.50, "castagno": 0.35, "leccio": 0.15}},

    {"id": "jenne", "nome": "Jenne", "lat": 41.8888, "lon": 13.1696,
     "bosco": "faggeta e querceto misto",
     "alberi": {"faggio": 0.45, "quercia": 0.35, "castagno": 0.20}},
]

# Webcam verificate una a una il 09/09/2026 senza header Referer. Lo stato
# vivo/spento non e' scritto qui: lo misura probe_webcam() a ogni giro, cosi'
# quando una stagionale riparte torna in pagina da sola.
WEBCAM = [
    {"id": "livata_360", "nome": "Monte Livata - REALVIEWCAM360",
     "dove": "Livata paese, chiesa di San Giuseppe - 1429 m",
     "url": "https://ipcamlive.com/player/snapshot.php?alias=67d9301b52ea3"},
    {"id": "livata_centro", "nome": "Monte Livata - Centro Visite Simbruini",
     "dove": "1345 m - stessa postazione della stazione meteo",
     "url": "https://www.meteo-lazio.it/webcam-livata/webcam.php?Resolution=640x480&Quality=Clarity"},
    {"id": "livata_orzella", "nome": "Monte Livata - Orzella Sport",
     "dove": "Pista e strada provinciale - 1350-1855 m",
     "url": "https://livata.it/ccam.jpg"},
    {"id": "campaegli_cam", "nome": "Campaegli",
     "dove": "Cervara di Roma - 1400 m",
     "url": "https://www.meteoregionelazio.it/webcams/campaegli/FI9901EP_00626E8B72EB/snap/webcam.php?Resolution=640x480&Quality=Clarity"},
    {"id": "livata_4k_1", "nome": "Monte Livata - panoramica 4K",
     "dove": "Immagine 4K, circa 1 MB: si carica piano",
     "url": "https://www.ramsatwebcams.it/montelivata_4k/foto/montelivata_view01.jpg"},
    {"id": "livata_4k_2", "nome": "Monte Livata - panoramica 4K, vista 2",
     "dove": "Immagine 4K, circa 1 MB",
     "url": "https://www.ramsatwebcams.it/montelivata_4k/foto/montelivata_view02.jpg"},
    {"id": "monna_arrivo", "nome": "Monna dell'Orso - arrivo seggiovia",
     "dove": "1758 m - impianti sciistici",
     "url": "https://www.ramsatwebcams.it/monna002/foto/monna_arrivo2.jpg"},
    {"id": "monna_pano", "nome": "Monna dell'Orso - panoramica",
     "dove": "Impianti sciistici",
     "url": "https://www.ramsatwebcams.it/montelivata/foto/monnadellorso_dexpano.jpg"},
    {"id": "livata_video", "nome": "Monte Livata - diretta video",
     "dove": "Stream RAMSAT REALVIEWCAM360",
     "iframe": "https://g0.ipcamlive.com/player/player.php?alias=67d9301b52ea3&autoplay=1&mute=1&disablevideofit=1"},
]

# Oltre queste ore dall'ultimo fotogramma, la webcam e' considerata spenta.
CAM_ORE_VIVA = 24

DAILY = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "relative_humidity_2m_mean",
    "wind_speed_10m_max",
    "et0_fao_evapotranspiration",
    "soil_moisture_0_to_7cm_mean",
    "soil_temperature_0_to_7cm_mean",
    # Solo per la scheda meteo, non per il modello: codice del tempo,
    # probabilita' di pioggia, raffiche, direzione, alba e tramonto.
    "weather_code",
    "precipitation_probability_max",
    "wind_gusts_10m_max",
    "wind_direction_10m_dominant",
    "sunrise",
    "sunset",
]

PAST_DAYS = 92      # massimo consentito dall'endpoint forecast
FORECAST_DAYS = 16  # idem


def _get(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("User-Agent", UA)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# --------------------------------------------------------------------------
# meteofunghi.fungocenter.it
# --------------------------------------------------------------------------

def scrape_meteofunghi():
    """La pagina /embed inietta la griglia lato server come
    `const heatData = {...GeoJSON...};`. Nessuna API, va estratta dall'HTML,
    quindi e' legata al loro markup: se cambia, questo si rompe di proposito
    invece di pubblicare dati vecchi."""
    html = _get(METEOFUNGHI).decode("utf-8", "replace")

    m = re.search(r"const\s+heatData\s*=\s*(\{.*?\})\s*;", html, re.S)
    if not m:
        raise RuntimeError("heatData non trovato: il markup di meteofunghi e' cambiato")
    fc = json.loads(m.group(1))

    feats = fc.get("features", [])
    if not feats:
        raise RuntimeError("heatData vuoto")

    # La data di aggiornamento e' testo nell'header della pagina.
    d = re.search(r"AGGIORNAMENTO\s+([0-9]{1,2}\s+\w+\s+[0-9]{4})", html)

    punti = [
        {
            "lon": round(f["geometry"]["coordinates"][0], 6),
            "lat": round(f["geometry"]["coordinates"][1], 6),
            "q": f["properties"]["quantity"],
        }
        for f in feats
        if f.get("geometry", {}).get("type") == "Point"
    ]
    return {
        "fonte": "meteofunghi.fungocenter.it",
        "url": "https://meteofunghi.fungocenter.it/",
        "aggiornamento": d.group(1) if d else None,
        "punti": punti,
    }


# --------------------------------------------------------------------------
# Webcam
# --------------------------------------------------------------------------

def probe_webcam(c, adesso):
    """Verifica se una webcam sta davvero trasmettendo.

    Va fatto qui e non nel browser: quasi nessuna di queste manda header CORS,
    quindi dalla pagina si puo' solo provare a disegnare l'immagine, senza
    sapere se e' di stamattina o di febbraio. Da qui invece si legge
    Last-Modified, e una stagionale che riparte torna in pagina da sola al
    giro successivo.
    """
    stato = {**c, "viva": False, "ultimo": None, "ore": None, "errore": None}
    url = c.get("iframe") or c["url"]
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            code = r.status
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
            lm = r.headers.get("Last-Modified")
            testa = r.read(4)  # basta il magic number, non serve scaricare 1 MB
    except Exception as e:
        stato["errore"] = str(e)
        return stato

    if code != 200:
        stato["errore"] = f"HTTP {code}"
        return stato

    if c.get("iframe"):
        stato["viva"] = ctype.startswith("text/html")
        if not stato["viva"]:
            stato["errore"] = f"risposta inattesa: {ctype}"
        return stato

    # Un 200 puo' essere una pagina d'errore travestita: controlla i byte.
    immagine = testa[:3] == b"\xff\xd8\xff" or testa[:4] == b"\x89PNG"
    if not (ctype.startswith("image/") and immagine):
        stato["errore"] = f"non e' un'immagine ({ctype})"
        return stato

    if lm:
        try:
            t = parsedate_to_datetime(lm)
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            ore = (adesso - t).total_seconds() / 3600.0
            stato["ultimo"] = t.isoformat(timespec="seconds")
            stato["ore"] = round(ore, 1)
            stato["viva"] = ore <= CAM_ORE_VIVA
            if not stato["viva"]:
                stato["errore"] = f"ferma da {ore / 24:.0f} giorni"
            return stato
        except Exception:
            pass

    # Endpoint dinamico senza Last-Modified (es. lo snapshot di ipcamlive):
    # se risponde con un JPEG valido, e' in diretta.
    stato["viva"] = True
    return stato


def build_webcam(adesso):
    return [probe_webcam(c, adesso) for c in WEBCAM]


# --------------------------------------------------------------------------
# Stazione al suolo (Rete Meteo Lazio)
# --------------------------------------------------------------------------

def _sezione(txt, da, per=2000):
    i = txt.find(da)
    return txt[i:i + per] if i >= 0 else ""


def _num(txt, etichetta, dopo=90):
    """Primo numero che compare subito dopo `etichetta`. La pagina e' una
    sequenza etichetta/valore, quindi la prossimita' e' l'unico aggancio."""
    i = txt.find(etichetta)
    if i < 0:
        return None
    m = re.search(r"(-?\d+[.,]?\d*)", txt[i + len(etichetta):i + len(etichetta) + dopo])
    return float(m.group(1).replace(",", ".")) if m else None


def scrape_stazione(sid=STAZIONE_ID):
    """Osservazioni reali da una Davis Vantage Pro 2 sul posto.
    Il modello e' un'interpolazione, questa e' misura diretta: serve sia da
    mostrare, sia per correggere la pioggia del modello (vedi bias_pioggia)."""
    html = _get(f"{STAZIONE}?id={sid}").decode("utf-8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    t = re.sub(r"<[^>]+>", " | ", t)
    t = re.sub(r"&nbsp;|&#\d+;", " ", t)
    txt = re.sub(r"\s+", " ", t)

    nome = re.search(r"Stazione meteo di ([^|<]{3,90}?)\s*(?:\||in tempo reale)", html)
    agg = re.search(r"Aggiornamento:\s*\|?\s*(\d{2}/\d{2}/\d{2,4}\s+\d{2}:\d{2})", txt)
    ritardo = re.search(r"Ultimo dato\s*\|?\s*([^|]{1,24}?)\s*\|", txt)

    precip = _sezione(txt, "Precipitazioni", 600)
    vento = _sezione(txt, "| Vento |", 500)

    return {
        "id": sid,
        "nome": html_mod.unescape(nome.group(1).strip()) if nome else f"Stazione {sid}",
        "url": f"{STAZIONE}?id={sid}",
        "strumento": "Davis Vantage Pro 2" if "Vantage Pro 2" in txt else None,
        "quota": _num(txt, "Quota osservazioni:"),
        "lat": STAZIONE_LATLON[0],
        "lon": STAZIONE_LATLON[1],
        "aggiornamento": agg.group(1) if agg else None,
        "ritardo": ritardo.group(1).strip() if ritardo else None,
        "temp": _num(_sezione(txt, "| Temperatura |", 200), "Attuale"),
        "temp_min": _num(_sezione(txt, "| Temperatura |", 400), "Minima"),
        "temp_max": _num(_sezione(txt, "| Temperatura |", 400), "Massima"),
        "umidita": _num(_sezione(txt, "Umidita" if "Umidita" in txt else "Umidit", 200), "|"),
        "pressione": _num(txt, "Pressione |"),
        "dew_point": _num(txt, "Dew point"),
        "vento_kmh": _num(vento, "Velocita" if "Velocita" in vento else "Velocit"),
        "raffica_kmh": _num(vento, "Raffica max"),
        "pioggia_oggi": _num(precip, "Pioggia oggi"),
        "pioggia_mese": _num(precip, "| Mese |"),
        "pioggia_anno": _num(precip, "| Anno |"),
        "rain_rate": _num(precip, "Rain rate"),
    }


def _km(a, b):
    """Distanza approssimata in km (piano tangente, basta per <100 km)."""
    from math import cos, radians, hypot
    return hypot((a[0] - b[0]) * 111.0,
                 (a[1] - b[1]) * 111.0 * cos(radians((a[0] + b[0]) / 2)))


def bias_pioggia(daily, stazione, oggi):
    """Riscala la pioggia MODELLATA sul totale davvero MISURATO dalla stazione
    nel mese in corso, e applica il fattore ai giorni passati.

    La pioggia e' il fattore dominante del modello, e il modello a griglia
    sbaglia parecchio in montagna. Correggerla con una misura a terra e' il
    guadagno piu' grosso per il minimo sforzo.

    Non tocca i giorni futuri: un bias osservato nel passato non e'
    automaticamente il bias della previsione, e fingere il contrario
    darebbe una precisione che non abbiamo.

    Ritorna il fattore applicato, oppure None se la correzione non e' sensata.
    """
    reale = stazione.get("pioggia_mese")
    if reale is None:
        return None

    mese = oggi[:7]
    idx = [i for i, g in enumerate(daily["time"]) if g[:7] == mese and g <= oggi]
    if len(idx) < 4:
        return None  # inizio mese: campione troppo corto per stimare un bias

    modello = sum(daily["precipitation_sum"][i] or 0.0 for i in idx)

    # Con totali minuscoli il rapporto e' solo rumore: se sono d'accordo sul
    # fatto che non e' piovuto, non c'e' niente da correggere.
    if modello < 5.0 and reale < 5.0:
        return 1.0
    if modello < 1.0:
        return None  # non si puo' riscalare uno zero

    k = max(0.3, min(3.0, reale / modello))
    for i, g in enumerate(daily["time"]):
        if g <= oggi and daily["precipitation_sum"][i] is not None:
            daily["precipitation_sum"][i] *= k
    return round(k, 3)


# --------------------------------------------------------------------------
# Open-Meteo
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Pioggia prevista, su griglia
#
# Il radar dice dov'e' la pioggia adesso e, con il nowcast, dove sara' fra
# mezz'ora. Oltre serve un modello. Questa griglia e' quella che sulla mappa
# fa scorrere le ore successive: senza, l'animazione si fermerebbe a +30
# minuti e non risponderebbe alla domanda vera ("domani mattina piove?").
#
# Passo 0,1 gradi, circa 8 km in latitudine: piu' fitto sarebbe finto, perche'
# i modelli globali disponibili gratuitamente non risolvono meglio di cosi'.
# --------------------------------------------------------------------------

GRIGLIA_PIOGGIA = (41.6, 42.3, 12.6, 13.6, 0.10)   # lat0, lat1, lon0, lon1, passo
ORE_PREVISIONE = 24


def fetch_pioggia_prev():
    lat0, lat1, lon0, lon1, passo = GRIGLIA_PIOGGIA
    lats = [round(lat0 + passo * i, 2)
            for i in range(int(round((lat1 - lat0) / passo)) + 1)]
    lons = [round(lon0 + passo * j, 2)
            for j in range(int(round((lon1 - lon0) / passo)) + 1)]
    pts = [(a, b) for a in lats for b in lons]

    q = urllib.parse.urlencode({
        "latitude": ",".join(str(a) for a, _ in pts),
        "longitude": ",".join(str(b) for _, b in pts),
        "hourly": "precipitation,wind_speed_10m,wind_direction_10m",
        # UTC e non Europe/Rome: il browser sa convertire, e un fuso scritto a
        # meta' strada e' il modo classico per sbagliare di due ore in estate.
        "timezone": "UTC",
        "forecast_hours": ORE_PREVISIONE,
    })
    raw = json.loads(_get(f"{OPENMETEO}?{q}", timeout=120).decode())
    if not isinstance(raw, list):
        raw = [raw]
    if len(raw) != len(pts):
        raise RuntimeError(f"attesi {len(pts)} punti, tornati {len(raw)}")

    ore = raw[0]["hourly"]["time"]
    # L'ordine e' lat-maggiore: il disegno sulla mappa legge mm[t][iy*nlon+ix],
    # e se qui cambiasse l'ordine la pioggia finirebbe trasposta.
    mm = [[round(raw[p]["hourly"]["precipitation"][t] or 0.0, 1)
           for p in range(len(pts))] for t in range(len(ore))]

    # Il vento serve a dire "verso dove va": si prende al centro della griglia,
    # che cade sui Simbruini.
    c = (len(lats) // 2) * len(lons) + len(lons) // 2
    return {
        "lat": lats, "lon": lons, "ore": ore, "mm": mm,
        "vento_kmh": [round(v or 0) for v in raw[c]["hourly"]["wind_speed_10m"]],
        "vento_da": [round(v or 0) for v in raw[c]["hourly"]["wind_direction_10m"]],
    }


def verifica_ordine_griglia():
    """La mappa legge la griglia come mm[t][iy * nlon + ix]. Se un giorno
    qualcuno riordinasse i punti qui sopra, la pioggia comparirebbe ruotata e
    nessuno se ne accorgerebbe subito: meglio inchiodare il contratto."""
    lats, lons = [1, 2], [10, 20, 30]
    pts = [(a, b) for a in lats for b in lons]
    for iy, a in enumerate(lats):
        for ix, b in enumerate(lons):
            assert pts[iy * len(lons) + ix] == (a, b)


def fetch_openmeteo(spots):
    """Una sola chiamata per tutti i punti: l'endpoint accetta liste di
    coordinate e risponde con un array nello stesso ordine."""
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(s["lat"]) for s in spots),
        "longitude": ",".join(str(s["lon"]) for s in spots),
        "daily": ",".join(DAILY),
        "timezone": "Europe/Rome",
        "past_days": PAST_DAYS,
        "forecast_days": FORECAST_DAYS,
    })
    raw = json.loads(_get(f"{OPENMETEO}?{q}").decode())
    # Con un punto solo risponde con un oggetto, con piu' punti con una lista.
    return raw if isinstance(raw, list) else [raw]


# --------------------------------------------------------------------------
# Pioggia passata da piu' fonti
#
# La pioggia e' il fattore che pesa di piu' nel modello, e una fonte sola non
# basta: per giugno-settembre 2026 su Livata ERA5 dava 115 mm e l'archivio dei
# modelli ad alta risoluzione 78 mm. Il 47% di scarto. Prendere l'una o l'altra
# a caso significa sbagliare il fattore dominante senza accorgersene.
#
# Tre fonti indipendenti sul passato:
#   modello   endpoint forecast con past_days - il modello operativo corrente
#   era5      rianalisi ERA5, cella ~25 km, ritardo di qualche giorno
#   alta_ris  archivio delle previsioni ad alta risoluzione, cella piu' fine
#
# Si fondono con la MEDIANA, non con la media: con tre valori la mediana ignora
# l'outlier invece di farsi tirare da lui. Con due sole fonti disponibili la
# mediana coincide con la media, e va bene lo stesso.
# --------------------------------------------------------------------------

def _daily_multi(base, spots, extra):
    """Chiamata multi-punto: gli endpoint accettano liste di coordinate e
    rispondono con un array nello stesso ordine."""
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(s["lat"]) for s in spots),
        "longitude": ",".join(str(s["lon"]) for s in spots),
        "timezone": "Europe/Rome",
        **extra,
    })
    raw = json.loads(_get(f"{base}?{q}", timeout=180).decode())
    return raw if isinstance(raw, list) else [raw]


def fetch_fonti_passato(spots, da, a):
    """Serie giornaliere di pioggia dalle fonti indipendenti dal modello
    operativo. Ogni fonte che fallisce viene semplicemente saltata."""
    fonti = {}
    tentativi = [
        ("era5", ARCHIVIO, {"daily": "precipitation_sum", "models": "era5",
                            "start_date": da, "end_date": a}),
        ("alta_ris", STORICO_MODELLI, {"daily": "precipitation_sum",
                                       "start_date": da, "end_date": a}),
    ]
    for nome, base, extra in tentativi:
        try:
            risp = _daily_multi(base, spots, extra)
            if len(risp) != len(spots):
                raise RuntimeError(f"{len(risp)} punti su {len(spots)}")
            fonti[nome] = [
                dict(zip(r["daily"]["time"], r["daily"]["precipitation_sum"]))
                for r in risp
            ]
        except Exception as e:
            print(f"[warn] fonte {nome}: {e}", file=sys.stderr)
    return fonti


def _mediana(v):
    v = sorted(v)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def fondi_pioggia(d, per_fonte, oggi):
    """Sostituisce la pioggia con la mediana fra le fonti, giorno per giorno.

    Tocca solo il passato: sul futuro esiste una fonte sola, ed e' giusto cosi'.
    Ritorna quanto le fonti sono d'accordo, che e' informazione da mostrare:
    se litigano, il punteggio di quei giorni vale meno.
    """
    orig = list(d["precipitation_sum"])
    scarti, usati, n_fonti = [], 0, {}

    for i, g in enumerate(d["time"]):
        if g > oggi:
            continue
        vals = [orig[i]] if orig[i] is not None else []
        for nome, mappa in per_fonte.items():
            v = mappa.get(g)
            if v is not None:
                vals.append(v)
        n_fonti[len(vals)] = n_fonti.get(len(vals), 0) + 1
        if len(vals) < 2:
            continue
        d["precipitation_sum"][i] = _mediana(vals)
        usati += 1
        scarti.append(max(vals) - min(vals))

    tot = {nome: round(sum(v for g, v in m.items()
                           if g <= oggi and v is not None), 1)
           for nome, m in per_fonte.items()}
    tot["modello"] = round(sum(v for g, v in zip(d["time"], orig)
                               if g <= oggi and v is not None), 1)
    return {
        "fonti": sorted(list(per_fonte) + ["modello"]),
        "giorni_fusi": usati,
        "totali_per_fonte": tot,
        "scarto_medio": round(sum(scarti) / len(scarti), 2) if scarti else None,
        "scarto_max": round(max(scarti), 1) if scarti else None,
    }


# --------------------------------------------------------------------------
# Climatologia
# --------------------------------------------------------------------------

def fetch_clima(spots, oggi, anni=ANNI_CLIMA):
    """Norma stagionale da ERA5: quanto e' piovuto nella STESSA finestra di
    calendario negli ultimi `anni` anni.

    Serve a rispondere alla domanda che un cercatore si fa davvero: non
    "quanti millimetri sono caduti", ma "e' poco o tanto per il periodo".
    """
    fine = datetime.fromisoformat(oggi).date()
    inizio = date(fine.year - anni, 1, 1)
    risp = _daily_multi(ARCHIVIO, spots, {
        "daily": "precipitation_sum,temperature_2m_mean",
        "start_date": inizio.isoformat(), "end_date": (fine - timedelta(days=1)).isoformat(),
    })
    if len(risp) != len(spots):
        raise RuntimeError(f"clima: {len(risp)} punti su {len(spots)}")

    out = []
    for r in risp:
        dd = r["daily"]
        pio = dict(zip(dd["time"], dd["precipitation_sum"]))
        tmp = dict(zip(dd["time"], dd["temperature_2m_mean"]))
        cumuli, temp_medie = [], []
        for anno in range(fine.year - anni, fine.year):
            f = date(anno, fine.month, min(fine.day, 28))
            giorni = [(f - timedelta(days=k)).isoformat() for k in range(FINESTRA_CLIMA)]
            v = [pio.get(g) for g in giorni]
            t = [tmp.get(g) for g in giorni]
            if all(x is not None for x in v):
                cumuli.append(sum(v))
            t = [x for x in t if x is not None]
            if t:
                temp_medie.append(sum(t) / len(t))
        out.append({
            "anni": len(cumuli),
            "finestra_giorni": FINESTRA_CLIMA,
            "pioggia_norma": round(sum(cumuli) / len(cumuli), 1) if cumuli else None,
            "pioggia_min": round(min(cumuli), 1) if cumuli else None,
            "pioggia_max": round(max(cumuli), 1) if cumuli else None,
            "storico": sorted(round(c, 1) for c in cumuli),
            "temp_norma": round(sum(temp_medie) / len(temp_medie), 1) if temp_medie else None,
        })
    return out


def confronta_clima(clima, pioggia_ora, temp_ora):
    """Posiziona l'anno in corso dentro la distribuzione degli anni passati."""
    if not clima or clima["pioggia_norma"] is None:
        return None
    st = clima["storico"]
    sotto = sum(1 for c in st if c < pioggia_ora)
    return {
        **clima,
        "pioggia_ora": round(pioggia_ora, 1),
        "rapporto": round(pioggia_ora / clima["pioggia_norma"], 2)
                    if clima["pioggia_norma"] else None,
        # Quanti degli anni passati sono stati piu' secchi di questo.
        "percentile": round(100 * sotto / len(st)) if st else None,
        "anni_piu_secchi": sotto,
        "temp_ora": None if temp_ora is None else round(temp_ora, 1),
        "temp_scarto": None if (temp_ora is None or clima["temp_norma"] is None)
                       else round(temp_ora - clima["temp_norma"], 1),
    }


# --------------------------------------------------------------------------
# Windy (opzionale)
# --------------------------------------------------------------------------

def fetch_windy(lat, lon, key):
    """Previsione puntuale Windy. Serve solo da conferma incrociata: Windy
    non espone lo storico, che e' il dato che conta per il micelio."""
    body = json.dumps({
        "lat": lat, "lon": lon, "model": "gfs",
        "parameters": ["temp", "precip", "wind", "rh"],
        "levels": ["surface"], "key": key,
    }).encode()
    raw = json.loads(_get(WINDY, data=body,
                          headers={"Content-Type": "application/json"}).decode())
    ts = raw.get("ts", [])
    return {
        "modello": "gfs",
        "ore": [datetime.fromtimestamp(t / 1000, timezone.utc).isoformat() for t in ts],
        "temp_c": [None if v is None else round(v - 273.15, 1)
                   for v in raw.get("temp-surface", [])],
        "precip_mm": raw.get("past3hprecip-surface") or raw.get("precip-surface", []),
        "rh": raw.get("rh-surface", []),
    }


# --------------------------------------------------------------------------
# Assemblaggio
# --------------------------------------------------------------------------

def build_spots(oggi, stazione=None):
    meteo = fetch_openmeteo(SPOTS)
    if len(meteo) != len(SPOTS):
        raise RuntimeError(f"Open-Meteo ha risposto per {len(meteo)} punti su {len(SPOTS)}")

    # Fonti indipendenti sul passato, sulla stessa finestra del modello.
    primo = meteo[0]["daily"]["time"][0]
    fonti = fetch_fonti_passato(SPOTS, primo, oggi)

    # La norma stagionale non e' indispensabile: se cade, il sito perde il
    # confronto con gli anni passati ma i punteggi restano.
    try:
        clima = fetch_clima(SPOTS, oggi)
    except Exception as e:
        print(f"[warn] clima: {e}", file=sys.stderr)
        clima = [None] * len(SPOTS)

    out = []
    for idx, (spot, m) in enumerate(zip(SPOTS, meteo)):
        d = m["daily"]

        # Ordine voluto: prima si fondono le fonti modellistiche fra loro, poi
        # la stazione corregge il risultato. La misura a terra e' l'autorita'
        # piu' alta e deve avere l'ultima parola.
        fusione = fondi_pioggia(d, {n: v[idx] for n, v in fonti.items()}, oggi)

        # Correzione con la misura a terra, solo dove la stazione e' vicina
        # abbastanza da essere rappresentativa.
        dist = _km((spot["lat"], spot["lon"]), STAZIONE_LATLON)
        k = None
        rh_st = None
        if stazione and dist <= BIAS_RAGGIO_KM:
            k = bias_pioggia(d, stazione, oggi)
            # L'umidita' relativa misurata entra nel fattore umidita'. E' una
            # lettura istantanea, quindi la si dichiara solo per oggi: il
            # modello la media con i giorni interpolati, non la spalma indietro.
            rh_st = stazione.get("umidita")
            if rh_st is not None:
                d["rh_stazione"] = [rh_st if g == oggi else None for g in d["time"]]

        specie = {}
        for nome in growth.SPECIES:
            serie = growth.score_series(d, nome, spot.get("alberi"))
            futuro = [s for s in serie if s["data"] >= oggi]
            corrente = next((s for s in serie if s["data"] == oggi), serie[-1] if serie else None)
            p = growth.picco(serie, oggi)
            specie[nome] = {
                "oggi": corrente,
                "picco": p,
                "giorni_al_picco": (
                    (datetime.fromisoformat(p["data"]) - datetime.fromisoformat(oggi)).days
                    if p else None
                ),
                "serie": [{"data": s["data"], "q": s["q"]} for s in serie],
                "prossimi": futuro[:16],
            }

        # Cumulato della finestra climatica, dopo fusione e correzione:
        # va confrontato con la norma lo stesso dato che alimenta il modello.
        i_oggi = d["time"].index(oggi) if oggi in d["time"] else len(d["time"]) - 1
        da = max(0, i_oggi - FINESTRA_CLIMA + 1)
        pio_ora = sum(v or 0 for v in d["precipitation_sum"][da:i_oggi + 1])
        t_ora = [v for v in d["temperature_2m_mean"][da:i_oggi + 1] if v is not None]

        out.append({
            **spot,
            "quota_dem": m.get("elevation"),
            "km_stazione": round(dist, 1),
            "bias_pioggia": k,
            "rh_stazione": rh_st,
            "pioggia_fonti": fusione,
            "clima": confronta_clima(clima[idx], pio_ora,
                                     sum(t_ora) / len(t_ora) if t_ora else None),
            "specie": specie,
            "meteo": {
                "giorni": d["time"],
                "pioggia": d["precipitation_sum"],
                "tmax": d["temperature_2m_max"],
                "tmin": d["temperature_2m_min"],
                "tmedia": d["temperature_2m_mean"],
                "umidita": d.get("relative_humidity_2m_mean"),
                "vento": d["wind_speed_10m_max"],
                "suolo_umidita": d.get("soil_moisture_0_to_7cm_mean"),
                "suolo_temp": d.get("soil_temperature_0_to_7cm_mean"),
                "codice": d.get("weather_code"),
                "prob_pioggia": d.get("precipitation_probability_max"),
                "raffica": d.get("wind_gusts_10m_max"),
                "vento_dir": d.get("wind_direction_10m_dominant"),
                "alba": d.get("sunrise"),
                "tramonto": d.get("sunset"),
            },
        })
    return out


def main():
    os.makedirs(DATA, exist_ok=True)
    adesso = datetime.now(timezone.utc)
    oggi = (adesso + timedelta(hours=2)).date().isoformat()  # ora locale italiana

    meta = {
        "generato": adesso.isoformat(timespec="seconds"),
        "giorno": oggi,
        "sorgenti": {},
        "modello": {
            "pesi": growth.PESI,
            "lookback_giorni": growth.LOOKBACK,
            "stagione_min": growth.STAGIONE_MIN,
            "specie": {k: {"nome": v["nome"], "temp": v["temp"],
                           "lag": v["lag"], "note": v["note"],
                           "ospiti": v["ospiti"], "stagione": v["stagione"]}
                       for k, v in growth.SPECIES.items()},
        },
    }

    # Le sorgenti sono indipendenti: se una cade, le altre devono comunque
    # pubblicare. Il sito mostra lo stato per sorgente invece di una pagina rotta.
    try:
        mf = scrape_meteofunghi()
        _write("meteofunghi.json", mf)
        meta["sorgenti"]["meteofunghi"] = {
            "stato": "ok", "punti": len(mf["punti"]),
            "aggiornamento": mf["aggiornamento"],
        }
    except Exception as e:
        meta["sorgenti"]["meteofunghi"] = {"stato": "errore", "messaggio": str(e)}
        print(f"[warn] meteofunghi: {e}", file=sys.stderr)

    # La stazione va letta prima degli spot: serve a correggerne la pioggia.
    stazione = None
    try:
        stazione = scrape_stazione()
        _write("stazione.json", stazione)
        meta["sorgenti"]["stazione"] = {
            "stato": "ok", "id": stazione["id"], "nome": stazione["nome"],
            "aggiornamento": stazione["aggiornamento"],
            "pioggia_mese": stazione["pioggia_mese"],
        }
    except Exception as e:
        meta["sorgenti"]["stazione"] = {"stato": "errore", "messaggio": str(e)}
        print(f"[warn] stazione: {e}", file=sys.stderr)

    try:
        spots = build_spots(oggi, stazione)
        _write("spots.json", {"giorno": oggi, "spots": spots})
        f0 = spots[0]["pioggia_fonti"]
        meta["sorgenti"]["openmeteo"] = {
            "stato": "ok", "spots": len(spots),
            "fonti_passato": f0["fonti"],
            "giorni_fusi": f0["giorni_fusi"],
            "scarto_medio_mm": f0["scarto_medio"],
            "clima_anni": (spots[0].get("clima") or {}).get("anni"),
            # k=1.0 significa "confrontato con la stazione, nessuno scarto":
            # elencarlo come corretto sarebbe fuorviante.
            "bias_pioggia": {s["id"]: s["bias_pioggia"] for s in spots
                             if s["bias_pioggia"] not in (None, 1.0)},
        }
    except Exception as e:
        meta["sorgenti"]["openmeteo"] = {"stato": "errore", "messaggio": str(e)}
        print(f"[errore] open-meteo: {e}", file=sys.stderr)
        _write("meta.json", meta)
        return 1  # senza meteo non c'e' sito: fallisci la build

    try:
        pv = fetch_pioggia_prev()
        _write("pioggia_prev.json", pv)
        meta["sorgenti"]["pioggia_prev"] = {
            "stato": "ok", "celle": len(pv["lat"]) * len(pv["lon"]),
            "ore": len(pv["ore"]), "da": pv["ore"][0], "a": pv["ore"][-1],
        }
    except Exception as e:
        meta["sorgenti"]["pioggia_prev"] = {"stato": "errore", "messaggio": str(e)}
        print(f"[warn] pioggia prevista: {e}", file=sys.stderr)

    try:
        cams = build_webcam(adesso)
        _write("webcam.json", {"controllate": adesso.isoformat(timespec="seconds"),
                               "ore_soglia": CAM_ORE_VIVA, "cam": cams})
        vive = [c["id"] for c in cams if c["viva"]]
        meta["sorgenti"]["webcam"] = {
            "stato": "ok", "vive": len(vive), "totali": len(cams),
            "spente": {c["id"]: c["errore"] for c in cams if not c["viva"]},
        }
    except Exception as e:
        meta["sorgenti"]["webcam"] = {"stato": "errore", "messaggio": str(e)}
        print(f"[warn] webcam: {e}", file=sys.stderr)

    key = os.environ.get("WINDY_KEY", "").strip()
    if key:
        try:
            w = fetch_windy(SPOTS[0]["lat"], SPOTS[0]["lon"], key)
            _write("windy.json", w)
            meta["sorgenti"]["windy"] = {"stato": "ok", "ore": len(w["ore"])}
        except Exception as e:
            meta["sorgenti"]["windy"] = {"stato": "errore", "messaggio": str(e)}
            print(f"[warn] windy: {e}", file=sys.stderr)
    else:
        meta["sorgenti"]["windy"] = {"stato": "disattivato",
                                     "messaggio": "Secret WINDY_KEY non impostato"}

    _write("meta.json", meta)
    print(json.dumps(meta["sorgenti"], indent=2, ensure_ascii=False))
    return 0


def _write(nome, obj):
    p = os.path.join(DATA, nome)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  scritto {nome} ({os.path.getsize(p)/1024:.1f} KB)")


def verifica_csp():
    """La CSP ammette lo script inline del tema per hash. Se qualcuno lo
    modifica senza aggiornare l'hash, il browser lo blocca in silenzio: niente
    errore visibile, solo il tema che smette di funzionare. Meglio accorgersene
    qui e far fallire la build."""
    import base64
    import hashlib

    for pagina in ("index.html", os.path.join("adm", "index.html")):
        html = open(os.path.join(ROOT, pagina), encoding="utf-8").read()
        inline = re.findall(r"<script>(.*?)</script>", html, re.S)
        if len(inline) != 1:
            raise AssertionError(f"{pagina}: atteso 1 script inline, trovati "
                                 f"{len(inline)}: aggiorna la CSP e questo controllo")

        atteso = "sha256-" + base64.b64encode(
            hashlib.sha256(inline[0].encode("utf-8")).digest()).decode()

        csp = re.search(r'http-equiv="Content-Security-Policy"\s+content="(.*?)"',
                        html, re.S)
        if not csp:
            raise AssertionError(f"{pagina}: meta Content-Security-Policy assente")
        if atteso not in csp.group(1):
            raise AssertionError(
                f"{pagina}: hash CSP non aggiornato.\n  atteso: '{atteso}'\n"
                "  sostituiscilo nel meta Content-Security-Policy.")

        # Direttive che non devono sparire in una modifica distratta.
        for d in ("default-src 'none'", "object-src 'none'", "base-uri 'self'",
                  "form-action 'none'"):
            if d not in csp.group(1):
                raise AssertionError(f"{pagina}: direttiva CSP mancante: {d}")

        print(f"  CSP {pagina}: hash inline verificato ({atteso[:20]}...)")


def verifica_sri():
    """Scarica ogni risorsa da CDN e confronta il digest con l'attributo
    `integrity` dichiarato nell'HTML.

    A runtime il browser fa gia' questo controllo e rifiuta lo script se non
    combacia. Farlo anche qui serve a due cose che il browser non copre: si
    accorge se qualcuno cambia l'indirizzo senza aggiornare l'hash (il sito
    si romperebbe per tutti, in silenzio), e vede se il CDN inizia a servire
    byte diversi - cioe' una compromissione della catena di fornitura - prima
    che se ne accorga un visitatore.
    """
    import base64
    import hashlib

    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    risorse = re.findall(
        r'(?:src|href)="(https://[^"]+)"[^>]*?integrity="([^"]+)"', html, re.S)
    if not risorse:
        raise AssertionError("nessuna risorsa con integrity in index.html: "
                             "se ne hai tolte, aggiorna questo controllo")

    for url, dichiarato in risorse:
        algo, _, atteso = dichiarato.partition("-")
        if algo not in ("sha256", "sha384", "sha512"):
            raise AssertionError(f"algoritmo SRI ignoto: {dichiarato}")
        blob = _get(url, timeout=60)
        vero = base64.b64encode(hashlib.new(algo, blob).digest()).decode()
        nome = url.rsplit("/", 1)[-1]
        if vero != atteso:
            raise AssertionError(
                f"INTEGRITA' VIOLATA su {url}\n"
                f"  dichiarato: {algo}-{atteso}\n"
                f"  ricevuto:   {algo}-{vero}\n"
                "  Il CDN sta servendo byte diversi da quelli attesi. Non "
                "pubblicare finche' non hai capito perche'.")
        print(f"  SRI {nome}: {len(blob)/1024:.0f} KB, digest confermato")


def selftest():
    verifica_csp()
    verifica_sri()
    verifica_ordine_griglia()

    """Controlli sulla correzione di bias: e' l'unico punto dove i dati
    vengono riscritti, quindi e' l'unico che merita una rete."""
    def serie(mm_al_giorno, giorni=20):
        return {"time": [f"2026-09-{d:02d}" for d in range(1, giorni + 1)],
                "precipitation_sum": [mm_al_giorno] * giorni}

    oggi = "2026-09-10"

    # Entrambi asciutti: nessuna correzione, ma confronto avvenuto.
    assert bias_pioggia(serie(0.05), {"pioggia_mese": 0.8}, oggi) == 1.0

    # Il modello esagera: deve ridurre.
    d = serie(4.0)                       # 40 mm modellati al 10
    k = bias_pioggia(d, {"pioggia_mese": 20.0}, oggi)
    assert k is not None and 0.3 <= k < 1.0, k
    assert abs(sum(d["precipitation_sum"][:10]) - 20.0) < 0.1, "deve pareggiare il misurato"
    # I giorni futuri restano intatti: un bias passato non e' un bias previsto.
    assert d["precipitation_sum"][-1] == 4.0, "il futuro non va toccato"

    # Il modello sottostima: deve alzare, ma con il tetto a 3x.
    d = serie(1.0)
    assert bias_pioggia(d, {"pioggia_mese": 500.0}, oggi) == 3.0

    # Casi in cui non si corregge affatto.
    assert bias_pioggia(serie(4.0), {"pioggia_mese": None}, oggi) is None
    assert bias_pioggia(serie(0.0), {"pioggia_mese": 50.0}, oggi) is None, "non si scala uno zero"
    assert bias_pioggia(serie(4.0), {"pioggia_mese": 20.0}, "2026-09-02") is None, \
        "inizio mese: campione troppo corto"

    # Fusione fra fonti: con tre valori vince la mediana, che ignora l'outlier
    # invece di farsi tirare da lui come farebbe la media.
    assert _mediana([1, 100, 3]) == 3
    assert _mediana([2, 4]) == 3
    d = {"time": ["2026-09-08", "2026-09-09", "2026-09-10"],
         "precipitation_sum": [10.0, 10.0, 10.0]}
    r = fondi_pioggia(d, {"era5": {"2026-09-08": 2.0, "2026-09-09": 2.0},
                          "alta_ris": {"2026-09-08": 3.0, "2026-09-09": 3.0}},
                      "2026-09-09")
    assert d["precipitation_sum"][:2] == [3.0, 3.0], d["precipitation_sum"]
    assert d["precipitation_sum"][2] == 10.0, "il futuro ha una fonte sola, non si tocca"
    assert r["giorni_fusi"] == 2 and r["scarto_max"] == 8.0

    # Una fonte sola non e' una fusione: il valore deve restare intatto.
    d2 = {"time": ["2026-09-08"], "precipitation_sum": [7.0]}
    assert fondi_pioggia(d2, {}, "2026-09-09")["giorni_fusi"] == 0
    assert d2["precipitation_sum"] == [7.0]

    # I buchi di una fonte non devono contare come zero.
    d3 = {"time": ["2026-09-08"], "precipitation_sum": [8.0]}
    fondi_pioggia(d3, {"era5": {"2026-09-08": None}}, "2026-09-09")
    assert d3["precipitation_sum"] == [8.0], "un None non e' una misura"

    # Confronto con la norma: posiziona l'anno dentro la distribuzione.
    c = {"pioggia_norma": 100.0, "storico": [50.0, 80.0, 120.0, 150.0], "temp_norma": 15.0}
    r = confronta_clima(c, 60.0, 17.0)
    assert r["rapporto"] == 0.6 and r["anni_piu_secchi"] == 1 and r["percentile"] == 25
    assert r["temp_scarto"] == 2.0
    assert confronta_clima(None, 10, 10) is None

    # Distanze: la stazione e' a Livata, Camerata Nuova e' fuori raggio.
    assert _km(STAZIONE_LATLON, (41.9386, 13.1529)) < 1.0
    assert _km(STAZIONE_LATLON, (42.0100, 13.1200)) > BIAS_RAGGIO_KM

    print("build_data.py: tutti i controlli passati")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        sys.exit(main())
