"""
Estrae i sentieri escursionistici dei Simbruini da OpenStreetMap.

Perche' non lo strato a tessere di Waymarked Trails: quello si ferma allo zoom
16, e oltre Leaflet ingrandisce l'ultimo livello, quindi le sigle CAI diventano
illeggibili proprio quando servono - cioe' quando si guarda da vicino il punto
dove si va. Disegnati come linee vettoriali restano nitidi a ogni zoom, si
possono cliccare e portano il nome del percorso.

NON gira nella CI ogni sei ore. I sentieri non cambiano di settimana in
settimana, e Overpass e' un servizio pubblico gratuito che ogni tanto risponde
504: interrogarlo quattro volte al giorno per un dato statico sarebbe
scortese oltre che fragile. Si lancia a mano quando serve, e il risultato
viene committato.

Uso:  python scripts/sentieri.py
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "data", "sentieri.json")

UA = "mush-bot/1.0 (https://hypegodsrome.github.io/mush; eug2002@gmail.com)"
MIRROR = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Riquadro dei Simbruini e della valle dell'Aniene, con un po' di margine.
BBOX = (41.85, 12.98, 42.05, 13.30)

TOLLERANZA_M = 12      # semplificazione: sotto questa distanza il punto si butta
DECIMALI = 5           # ~1 m: oltre e' precisione che nessuno usa e byte sprecati


def scarica():
    # `out body` e non `out tags`: servono i MEMBRI della relazione, cioe'
    # quali way la compongono. Con `out tags` tornano solo le etichette e
    # ogni percorso resta senza geometria.
    q = f"""[out:json][timeout:180];
relation["route"="hiking"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
out body;
>;
out skel qt;"""
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


def _dist_punto_segmento(p, a, b):
    """Distanza in metri fra un punto e il segmento a-b, su piano tangente."""
    kx = 111320.0 * math.cos(math.radians(p[0]))
    ky = 110540.0
    px, py = p[1] * kx, p[0] * ky
    ax, ay = a[1] * kx, a[0] * ky
    bx, by = b[1] * kx, b[0] * ky
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def semplifica(punti, tol):
    """Douglas-Peucker iterativo: la ricorsione su tracciati lunghi sfonda
    il limite di stack di Python."""
    if len(punti) < 3:
        return punti
    tieni = [False] * len(punti)
    tieni[0] = tieni[-1] = True
    pila = [(0, len(punti) - 1)]
    while pila:
        i, j = pila.pop()
        if j <= i + 1:
            continue
        peggio, quale = 0.0, -1
        for k in range(i + 1, j):
            d = _dist_punto_segmento(punti[k], punti[i], punti[j])
            if d > peggio:
                peggio, quale = d, k
        if peggio > tol:
            tieni[quale] = True
            pila.append((i, quale))
            pila.append((quale, j))
    return [p for p, t in zip(punti, tieni) if t]


def catene(ways):
    """Unisce i tratti che si toccano in tracciati continui.
    Una relazione di percorso e' una borsa di way non ordinate: disegnate una
    per una verrebbero centinaia di segmenti staccati invece di un sentiero."""
    resto = [list(w) for w in ways if len(w) >= 2]
    out = []
    while resto:
        corrente = resto.pop(0)
        cambiato = True
        while cambiato:
            cambiato = False
            for i, w in enumerate(resto):
                if corrente[-1] == w[0]:
                    corrente += w[1:]
                elif corrente[-1] == w[-1]:
                    corrente += list(reversed(w))[1:]
                elif corrente[0] == w[-1]:
                    corrente = w[:-1] + corrente
                elif corrente[0] == w[0]:
                    corrente = list(reversed(w))[1:] + corrente
                else:
                    continue
                resto.pop(i)
                cambiato = True
                break
        out.append(corrente)
    return out


def main():
    print(f"  interrogo Overpass sul riquadro {BBOX}...")
    d = scarica()
    els = d.get("elements", [])

    nodi = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node"}
    ways = {e["id"]: e.get("nodes", []) for e in els if e["type"] == "way"}
    rels = [e for e in els if e["type"] == "relation"]
    print(f"  {len(rels)} percorsi, {len(ways)} tratti, {len(nodi)} nodi")

    percorsi, punti_prima, punti_dopo = [], 0, 0
    for r in rels:
        t = r.get("tags", {})
        tratti = [ways.get(m["ref"], []) for m in r.get("members", [])
                  if m["type"] == "way"]
        tratti = [w for w in tratti if len(w) >= 2]
        if not tratti:
            continue

        linee = []
        for catena in catene(tratti):
            pts = [nodi[n] for n in catena if n in nodi]
            if len(pts) < 2:
                continue
            punti_prima += len(pts)
            pts = semplifica(pts, TOLLERANZA_M)
            punti_dopo += len(pts)
            linee.append([[round(a, DECIMALI), round(b, DECIMALI)] for a, b in pts])

        if not linee:
            continue
        percorsi.append({
            "ref": t.get("ref") or "",
            "nome": t.get("name") or "",
            "rete": t.get("network") or "",
            "linee": linee,
        })

    # I percorsi senza sigla ne' nome non aiutano nessuno sulla mappa.
    percorsi = [p for p in percorsi if p["ref"] or p["nome"]]
    percorsi.sort(key=lambda p: (p["ref"] or "zzz", p["nome"]))

    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, "w", encoding="utf-8") as f:
        json.dump({"bbox": BBOX, "percorsi": percorsi}, f,
                  ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(DEST) / 1024
    print(f"  semplificati {punti_prima} punti -> {punti_dopo} "
          f"({100 * punti_dopo / max(1, punti_prima):.0f}%)")
    print(f"  {len(percorsi)} percorsi scritti in data/sentieri.json ({kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
