"""
Servizi e recapiti del comprensorio: maneggi, noleggi, piscine, navette...

I recapiti sono dati d'archivio, scritti a mano qui sotto. Le coordinate no:
quelle si chiedono a Nominatim (il geocoder di OpenStreetMap) e ognuna porta
con se' quanto vale.

`precisione` non e' un dettaglio burocratico. Un maneggio di cui si conosce
solo il paese non puo' comparire sulla mappa come un puntino esatto: chi ci
crede parte e non lo trova. Quindi:

    esatta      Nominatim ha riconosciuto l'indirizzo o il nome del posto
    localita'   si e' potuto piazzare solo il paese o la frazione
    (assente)   nessuna delle due: resta nell'elenco, fuori dalla mappa

Nominatim e' gratuito e ha una regola sola: una richiesta al secondo e uno
User-Agent che dica chi sei. Si rispetta.

Non gira nella CI: i recapiti non cambiano ogni sei ore e interrogare un
servizio pubblico per un dato fermo sarebbe scortese. Si lancia a mano, il
risultato viene committato, e le coordinate gia' trovate non si richiedono
piu' (la cache e' il file stesso).

Uso:  python scripts/servizi.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "data", "servizi.json")

UA = "mush-bot/1.0 (https://hypegodsrome.github.io/mush; eug2002@gmail.com)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
PAUSA_S = 1.1          # la regola d'uso di Nominatim e' una richiesta al secondo

# Riquadro dei Simbruini allargato ai paesi di fondovalle e ai comuni abruzzesi
# di confine: fuori da qui un risultato con lo stesso nome e' un omonimo.
VIEWBOX = (12.80, 42.20, 13.60, 41.55)   # lon1, lat1, lon2, lat2

CATEGORIE = {
    "arrampicata": ("Arrampicata", "\U0001F9D7"),
    "maneggi":     ("Maneggi", "\U0001F40E"),
    "bike":        ("Noleggio bici ed e-bike", "\U0001F6B2"),
    "neve":        ("Noleggio ciaspole e sci", "\U0001F3BF"),
    "scuolesci":   ("Scuole di sci e snowboard", "⛷"),
    "tennis":      ("Campi da tennis", "\U0001F3BE"),
    "piscine":     ("Piscine", "\U0001F3CA"),
    "navette":     ("Servizio navetta", "\U0001F68C"),
    "calcetto":    ("Calcetto", "⚽"),
    "avventura":   ("Parco avventura", "\U0001F332"),
    "golf":        ("Golf", "⛳"),
    "circoli":     ("Circoli sportivi", "\U0001F3D3"),
    "benessere":   ("Centri benessere", "\U0001F486"),
}

# nome, categoria, telefoni, email, indirizzo (per il geocoder), note
# `dove` e' il ripiego: il posto che si cerca se l'indirizzo non basta.
SERVIZI = [
    ("Vivere l'Aniene", "arrampicata", ["320 9681006"], None, None, "Subiaco RM", ""),
    ("Rifugio Viperella", "arrampicata", ["347 1665470"], None,
     "Rifugio Viperella, Campo Staffi, Filettino FR", "Campo Staffi, Filettino FR", ""),

    ("Family Ranch Subiaco", "maneggi", ["3477 316443"], "familyranchsubiaco@gmail.com",
     None, "Subiaco RM", ""),
    ("Centro Ippico Monte Livata", "maneggi", ["348 4504084"], "centroippicolivata@libero.it",
     None, "Monte Livata, Subiaco RM", ""),
    ("Maneggio Campaegli", "maneggi", ["347 8280689"], None,
     None, "Campaegli, Cervara di Roma RM", "Valerio"),
    ("Maneggio EquiRanch Campo Staffi", "maneggi", ["348 4835759"], None,
     None, "Campo Staffi, Filettino FR", ""),
    ("Centro Equestre S. Giorgio", "maneggi", ["0775 599751"], None,
     None, "Altipiani di Arcinazzo, Trevi nel Lazio FR", ""),
    ("Centro Ippico Vallenoce", "maneggi", ["349 1232450"], None, None, "Pereto AQ", ""),
    ("Centro Ippico Rocca di Botte", "maneggi", ["347 5783844"], None,
     None, "Rocca di Botte AQ", ""),
    ("Centro Ippico Oricola", "maneggi", ["348 7057588"], None, None, "Oricola AQ",
     "Ilaria Fiori"),
    ("Ostello Colle Mordani", "maneggi", ["328 7208972"], "info@collemordani.it",
     "SP28 Via Rio Suria, Trevi nel Lazio FR", "Trevi nel Lazio FR", ""),

    ("Probike Subiaco", "bike", ["334 5851967"], None, None, "Subiaco RM", ""),
    ("Campaegli Resort", "bike", ["379 2846074"], None,
     "Via dell'Orsetto Lavatore, Campaegli, Cervara di Roma RM",
     "Campaegli, Cervara di Roma RM", "Carmen · e-bike senza guida"),
    ("Diego Checchi 2001", "bike", ["349 3652252"], None,
     None, "Monte Livata, Subiaco RM", "e-bike con guida"),
    ("Rete d'impresa We_Net", "bike", ["0774 85050"], "info@subiacoturismo.it",
     None, "Subiaco RM", ""),
    ("Livata Escursioni", "bike", ["327 1289899"], None,
     None, "Monte Livata, Subiaco RM", "Lupi Lorenzo"),
    ("Luca Terrinoni", "bike", ["339 2735653"], None,
     None, "Altipiani di Arcinazzo, Trevi nel Lazio FR", ""),
    ("Ostello Colle Mordani", "bike", ["328 7208972"], "info@collemordani.it",
     "SP28 Via Rio Suria, Trevi nel Lazio FR", "Trevi nel Lazio FR", ""),

    ("Orzella Sport", "neve", ["0774 826055"], None,
     "Viale dei Boschi 24, Monte Livata, Subiaco RM", "Monte Livata, Subiaco RM", ""),
    ("Noleggio Livata Simona Sport", "neve", ["347 5039194"], None,
     "Piazzale Campo dell'Osso, Subiaco RM", "Campo dell'Osso, Subiaco RM", ""),
    ("Genziana Campo Staffi", "neve", ["339 1940288"], "genziana.campostaffi@tiscali.it",
     None, "Campo Staffi, Filettino FR", ""),
    ("Rifugio Viperella", "neve", ["347 1665470"], None,
     "Rifugio Viperella, Campo Staffi, Filettino FR", "Campo Staffi, Filettino FR", ""),

    ("Scuola sci e snowboard Livata", "scuolesci",
     ["389 6496028", "328 6930432", "389 6882024"], None,
     "Viale dei Boschi 13, Monte Livata, Subiaco RM", "Monte Livata, Subiaco RM", ""),
    ("Scuole Sci Monte Livata", "scuolesci", ["393 0717820"], "scuolascilivata@gmail.com",
     None, "Monte Livata, Subiaco RM", "segreteria"),
    ("Scuole Sci Campo Staffi", "scuolesci", ["392 2372416"], "santucci.francesco@ymail.com",
     None, "Campo Staffi, Filettino FR", ""),
    ("Baita Capriati", "scuolesci", ["348 8133461"], None,
     None, "Campo Staffi, Filettino FR", ""),

    ("Livata 2001 – Area sportiva dell'Anello", "tennis", ["324 8626357"], None,
     None, "Monte Livata, Subiaco RM", ""),
    ("Comune di Vallepietra", "tennis", ["0774 899031"], None, None, "Vallepietra RM", ""),
    ("Comune di Jenne", "tennis", ["0774 827601"], None, None, "Jenne RM", ""),
    ("Villaggio Val Granara", "tennis", [], None, None, "Filettino FR", ""),
    ("Villaggio Conifere Garden", "tennis", [], None, None, "Filettino FR", ""),
    ("Tennis Club Altipiani", "tennis", ["339 5476515"], None,
     None, "Altipiani di Arcinazzo, Trevi nel Lazio FR", ""),
    ("Centro Sportivo Le Sequoie", "tennis", ["0863 997961"], None, None, "Carsoli AQ", ""),
    ("Giardino del Ponte", "tennis", ["0774 83860", "327 8357053"], None,
     "Corso Cesare Battisti 39, Subiaco RM", "Subiaco RM", ""),

    ("Ostello Il Lescuso", "piscine", ["351 7866493"], None,
     "Strada Provinciale 45a km 12.5, Jenne RM", "Jenne RM", ""),
    ("Villaggio Conifere Garden", "piscine", [], None, None, "Filettino FR", ""),
    ("Villaggio Val Granara", "piscine", [], None, None, "Filettino FR", ""),
    ("Centro Nuoto Fiuggi", "piscine", ["0775 504336"], None, None, "Fiuggi FR", ""),
    ("Club della Piscina", "piscine", ["366 508299"], None, None, "Rocca di Botte AQ",
     "piscina e beach volley"),
    ("Piscina Casale del Colonnello", "piscine", ["339 1995136", "328 0264604"], None,
     None, "Carsoli AQ", ""),
    ("Piscina AgriQuartuccio", "piscine", [], None,
     "Strada Provinciale del Cavaliere, Oricola AQ", "Oricola AQ",
     "Azienda agricola F. De Santis"),
    ("SSD Sublacensis", "piscine", ["0774 504539"], None,
     "Via G. Scarpellini, Subiaco RM", "Subiaco RM", ""),

    ("Onorati Group", "navette", ["06 9349771", "0775 581832", "0775 527001"], None,
     None, "Subiaco RM", ""),
    ("COTRAL", "navette", ["06 72057205"], None, None, "Subiaco RM", ""),
    ("ATL", "navette", ["0775 581832", "0775 527001"], None, None, "Trevi nel Lazio FR", ""),
    ("Navetta Subiaco – Rocca Santo Stefano", "navette", ["0774 8161"], None,
     None, "Subiaco RM", ""),
    ("Navetta Monasteri e Laghetto San Benedetto", "navette", ["342 1938078"], None,
     None, "Subiaco RM", "servizio ETHA"),

    ("Ostello Il Lescuso", "calcetto", ["333 2206949"], None,
     "Strada Provinciale 45a km 12.5, Jenne RM", "Jenne RM", ""),
    ("Giardino del Ponte", "calcetto", ["0774 83860", "327 8357053"], None,
     "Corso Cesare Battisti 39, Subiaco RM", "Subiaco RM", ""),
    ("Anello di Livata – Livata 2001", "calcetto", ["324 8626357"], None,
     None, "Monte Livata, Subiaco RM", ""),
    ("Comune di Vallepietra", "calcetto", ["0774 899031"], None, None, "Vallepietra RM", ""),
    ("Centro Sportivo Le Sequoie", "calcetto", ["0863 997961"], None, None, "Carsoli AQ", ""),

    ("Altipiani Adventures Park", "avventura", ["331 3493696"], None,
     None, "Altipiani di Arcinazzo, Trevi nel Lazio FR", ""),
    ("Parco degli Angeli", "avventura", ["0774 85690"], None, None, "Subiaco RM", ""),
    ("Parco Avventura Casale del Colonnello", "avventura",
     ["339 1995136", "328 0264604"], None, None, "Carsoli AQ", ""),

    ("Fiuggi Golf Club", "golf", ["0775 515250"], None, None, "Fiuggi FR", ""),
    ("Golf Fiuggi Terme & Country Club", "golf", ["0775 515640"], None, None, "Fiuggi FR", ""),

    ("CH Relais & Sport Club", "circoli", ["351 7725332"], "info@chclub.com",
     None, "Altipiani di Arcinazzo, Trevi nel Lazio FR",
     "Al coperto: biliardino, biliardo, ping pong. "
     "All'aperto: tennis, padel, calcetto, bubble soccer, gabbia a 3"),

    ("Campaegli Resort", "benessere", ["379 2846074"], "resortcampaegli@libero.it",
     "Via dell'Orsetto Lavatore, Campaegli, Cervara di Roma RM",
     "Campaegli, Cervara di Roma RM",
     "Piscina interna ed esterna, sauna, solarium"),
    ("Hotel Livata Mountain Wellness", "benessere", ["0774 922000"],
     "reservation@livatahotel.it",
     "Viale dei Boschi 24, Monte Livata, Subiaco RM", "Monte Livata, Subiaco RM",
     "SPA con piscina riscaldata, sauna, hammam, percorso Kneipp"),
]


# Nominatim non conosce "Monte Livata": il toponimo in banca dati e' "Livata",
# e cercandolo senza riquadro risponde con una via di Latina. Un omonimo a
# centoventi chilometri e' peggio di nessun risultato.
ALIAS = {
    "Monte Livata, Subiaco RM": "Livata, Subiaco",
    "Campo dell'Osso, Subiaco RM": "Campo dell'Osso, Subiaco",
    "Campaegli, Cervara di Roma RM": "Campaegli, Cervara di Roma",
    "Campo Staffi, Filettino FR": "Campo Staffi, Filettino",
    "Altipiani di Arcinazzo, Trevi nel Lazio FR": "Altipiani di Arcinazzo",
}


def _cerca(q, dentro_riquadro=True):
    par = {"q": q, "format": "jsonv2", "limit": 1, "addressdetails": 0,
           "countrycodes": "it"}
    if dentro_riquadro:
        par["viewbox"] = ",".join(str(x) for x in VIEWBOX)
        par["bounded"] = 1
    req = urllib.request.Request(f"{NOMINATIM}?{urllib.parse.urlencode(par)}",
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    time.sleep(PAUSA_S)
    if not d:
        return None
    return round(float(d[0]["lat"]), 6), round(float(d[0]["lon"]), 6)


def geocodifica(indirizzo, dove):
    """Prima l'indirizzo, poi il nome del posto, poi il paese. Torna
    (lat, lon, precisione) oppure (None, None, None)."""
    for q in filter(None, [indirizzo]):
        try:
            p = _cerca(q)
            if p:
                return p[0], p[1], "esatta"
        except Exception as e:
            print(f"  [warn] nominatim '{q}': {e}", file=sys.stderr)
    if dove:
        try:
            # Gli alias restano dentro il riquadro: sono toponimi di qui e
            # fuori zona esiste sicuro qualcosa che si chiama uguale.
            if dove in ALIAS:
                p = _cerca(ALIAS[dove])
                if p:
                    return p[0], p[1], "localita"
            # Il paese si cerca senza riquadro: alcuni centri di comune
            # abruzzesi cadono appena fuori dal bordo che usiamo.
            p = _cerca(dove, dentro_riquadro=False)
            if p:
                return p[0], p[1], "localita"
        except Exception as e:
            print(f"  [warn] nominatim '{dove}': {e}", file=sys.stderr)
    return None, None, None


def main():
    vecchi = {}
    if os.path.exists(DEST):
        with open(DEST, encoding="utf-8") as f:
            for v in json.load(f).get("servizi", []):
                vecchi[(v["nome"], v["cat"])] = v

    fuori, esatti, approssimati = 0, 0, 0
    out = []
    for nome, cat, tel, mail, indirizzo, dove, note in SERVIZI:
        assert cat in CATEGORIE, f"categoria sconosciuta: {cat}"
        v = vecchi.get((nome, cat))
        if v and v.get("lat") is not None:
            out.append(v)                       # gia' trovato, non si ridisturba
        else:
            print(f"  cerco {nome} ({indirizzo or dove})...")
            lat, lon, prec = geocodifica(indirizzo, dove)
            out.append({"nome": nome, "cat": cat, "tel": tel, "email": mail,
                        "indirizzo": indirizzo, "zona": dove, "note": note,
                        "lat": lat, "lon": lon, "precisione": prec})
        u = out[-1]
        # I recapiti si riscrivono sempre dal listato: la cache vale per le
        # coordinate, non per un numero di telefono cambiato nel frattempo.
        u.update({"tel": tel, "email": mail, "note": note, "zona": dove})
        if u["lat"] is None:
            fuori += 1
        elif u["precisione"] == "esatta":
            esatti += 1
        else:
            approssimati += 1

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, "w", encoding="utf-8") as f:
        json.dump({"categorie": {k: {"nome": n, "icona": i}
                                 for k, (n, i) in CATEGORIE.items()},
                   "servizi": out}, f, ensure_ascii=False, indent=1)

    kb = os.path.getsize(DEST) / 1024
    print(f"  {len(out)} servizi: {esatti} con indirizzo esatto, "
          f"{approssimati} sulla localita', {fuori} senza posizione")
    print(f"  scritti in data/servizi.json ({kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
