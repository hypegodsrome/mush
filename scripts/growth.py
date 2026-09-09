"""
Modello di previsione della crescita dei funghi (fruttificazione epigea).

Idea di fondo: il fungo che raccogli non "cresce" nel giorno in cui piove.
La pioggia innesca il micelio, poi servono ~1-3 settimane perche' i primordi
si sviluppino e il carpoforo emerga. Quindi il punteggio di OGGI dipende
soprattutto dalla pioggia di 8-21 giorni FA, e dal fatto che nel frattempo
il terreno non si sia asciugato.

Otto fattori, ognuno normalizzato in [0,1]. I sei meteorologici si combinano
con una media geometrica pesata: se un fattore va a zero (niente pioggia,
oppure gelo) il punteggio crolla, che e' il comportamento reale, mentre una
media aritmetica "compenserebbe" la siccita' con una bella temperatura.
Gli ultimi due - bosco ospite e stagione - non si mediano: MOLTIPLICANO. Non
sono ingredienti da bilanciare, sono la frazione di bosco e di calendario in
cui quella specie puo' proprio esistere.

Fattori:
  f1 innesco    pioggia nella finestra di incubazione (D-21 .. D-8)
  f2 umidita'   umidita' del suolo + pioggia recente (D-7 .. D)
  f3 temperatura banda ottimale per la specie (suolo se disponibile, altrimenti aria)
  f4 shock termico  calo di temperatura che induce i primordi
  f5 asciugatura    penalita' per vento forte ed evapotraspirazione
  f6 riserva    pioggia stagionale accumulata dal micelio
  f7 ospite     affinita' fra la specie e gli alberi presenti nella zona
  f8 stagione   periodo dell'anno in cui quella specie butta davvero

Fonti dei dati: Open-Meteo (storico 92gg + previsione 16gg, stesso endpoint).

Esegui `python growth.py` per il self-check.
"""

from datetime import date
from math import exp

# Giorni di storico necessari prima del primo giorno calcolabile.
LOOKBACK = 60

# Sotto questo valore un fattore necessario inizia a strozzare il punteggio
# in modo proporzionale, fino ad azzerarlo. Vedi il cancello in score_day().
GATE_FLOOR = 0.15

# Tipi di bosco riconosciuti. Ogni specie deve dichiarare l'affinita' con
# tutti: un ospite dimenticato diventerebbe silenziosamente 0.3.
ALBERI_NOTI = ("faggio", "quercia", "castagno", "conifere", "leccio")

# Open-Meteo calcola la temperatura del suolo su superficie generica, di fatto
# scoperta. Sotto una chioma chiusa d'estate il suolo sta diversi gradi sotto:
# senza questa correzione una faggeta a 500 m risultava a 26 C e il porcino
# veniva azzerato dalla banda termica, che e' falso.
OMBRA_BOSCO_C = 3.5


# --------------------------------------------------------------------------
# Profili per specie. Le bande di temperatura sono sul suolo a 0-7 cm quando
# il dato c'e', altrimenti sulla temperatura media dell'aria.
#   temp = (t_min, t_ott_min, t_ott_max, t_max)  -> trapezio
#   lag  = (giorni_min, giorni_max) finestra di incubazione dopo la pioggia
# --------------------------------------------------------------------------
SPECIES = {
    "porcino": {
        "nome": "Porcino (Boletus edulis / aereus / pinophilus)",
        "temp": (4.0, 12.0, 19.0, 26.0),
        "lag": (8, 21),
        # Due buttate: i "cimaroli" di fine primavera e la stagione vera d'autunno.
        "stagione": [("05-15", "06-01", "06-30", "07-20"),
                     ("08-20", "09-10", "10-25", "11-25")],
        "pioggia_innesco": 40.0,   # mm che saturano il fattore innesco
        "ospiti": {"faggio": 1.00, "quercia": 0.95, "castagno": 0.90,
                   "conifere": 0.70, "leccio": 0.60},
        "note": "Vuole lo shock termico dopo il caldo. Faggeta e querceta.",
    },
    "galletto": {
        "nome": "Galletto / finferlo (Cantharellus cibarius)",
        "temp": (3.0, 11.0, 18.0, 24.0),
        "lag": (6, 18),
        # Stagione lunghissima: parte con i temporali estivi e tira fino a novembre.
        "stagione": [("06-01", "07-01", "09-30", "11-15")],
        "pioggia_innesco": 28.0,
        "ospiti": {"faggio": 0.95, "quercia": 0.85, "castagno": 0.90,
                   "conifere": 0.80, "leccio": 0.50},
        "note": "Si accontenta di meno acqua ma la vuole costante: butta a "
                "ondate su una stagione lunga. Regge il fresco meglio del porcino.",
    },
    "steccherino": {
        "nome": "Steccherino dorato (Hydnum repandum)",
        "temp": (1.0, 8.0, 16.0, 21.0),
        "lag": (10, 24),
        "stagione": [("08-10", "09-15", "11-15", "12-20")],
        "pioggia_innesco": 35.0,
        "ospiti": {"faggio": 1.00, "quercia": 0.80, "castagno": 0.75,
                   "conifere": 0.70, "leccio": 0.40},
        "note": "Tardivo e resistente. Parte quando il porcino ha gia' chiuso, "
                "e regge le prime gelate leggere.",
    },
    "trombetta": {
        "nome": "Trombetta dei morti (Craterellus cornucopioides)",
        "temp": (1.0, 8.0, 15.0, 20.0),
        "lag": (12, 26),
        # Il nome viene da Ognissanti: e' il fungo di fine autunno.
        "stagione": [("09-01", "10-01", "11-20", "12-20")],
        "pioggia_innesco": 45.0,
        # Marcatamente legata a faggio e quercia: sotto conifera e' rara.
        "ospiti": {"faggio": 1.00, "quercia": 0.90, "castagno": 0.60,
                   "conifere": 0.20, "leccio": 0.40},
        "note": "La piu' tardiva e la piu' esigente in acqua. Autunno inoltrato, "
                "faggeta e querceta con lettiera fitta e muschio.",
    },
}

# Pesi della media geometrica sui fattori METEO. Devono sommare a 1.
PESI = {
    "innesco": 0.32,
    "umidita": 0.22,
    "temperatura": 0.22,
    "asciugatura": 0.10,
    "shock": 0.08,
    "riserva": 0.06,
}

# Condizioni meteo necessarie: sotto GATE_FLOOR strozzano il punteggio in
# modo proporzionale.
NECESSARI = ("innesco", "umidita", "temperatura")

# Fuori stagione il fattore non scende a zero ma a questo valore: una buttata
# tardiva o anticipata e' rara, non impossibile, e un modello che stampa zero
# secco a fine novembre direbbe una bugia.
STAGIONE_MIN = 0.10

# Ospite e stagione non stanno nella media pesata: sono MOLTIPLICATORI diretti.
# Non e' un ingrediente da mediare con gli altri, e' la frazione di bosco in
# cui quella specie puo' esistere. Dentro la media geometrica con peso 0.12
# un bosco per meta' sbagliato costava un misero 18%; moltiplicato, dimezza
# il punteggio, che e' quello che succede davvero.
# `fattori["ospite"]` resta esposto per l'interfaccia.


# --------------------------------------------------------------------------
# Utilita'
# --------------------------------------------------------------------------

def _clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def _sat(x, k):
    """Curva saturante 0->1. A x=k vale 0.63, a x=3k vale 0.95."""
    return 1.0 - exp(-max(0.0, x) / k)


def _trapezio(x, a, b, c, d):
    """0 sotto a, sale ad 1 in [b,c], riscende a 0 sopra d."""
    if x is None or x <= a or x >= d:
        return 0.0
    if x < b:
        return (x - a) / (b - a)
    if x <= c:
        return 1.0
    return (d - x) / (d - c)


def _slice(serie, i, da, a):
    """Finestra serie[i-da : i-a+1], scartando i None. `da` > `a`."""
    lo = max(0, i - da)
    hi = i - a + 1
    if hi <= lo:
        return []
    return [v for v in serie[lo:hi] if v is not None]


def _somma(serie, i, da, a):
    return sum(_slice(serie, i, da, a))


def _media(serie, i, da, a):
    w = _slice(serie, i, da, a)
    return sum(w) / len(w) if w else None


def _max_rolling(serie, i, da, a, ampiezza=3):
    """Massima somma su `ampiezza` giorni consecutivi dentro la finestra.
    Distingue un vero evento piovoso da settimane di pioggerella."""
    w = _slice(serie, i, da, a)
    if len(w) < ampiezza:
        return sum(w)
    return max(sum(w[j:j + ampiezza]) for j in range(len(w) - ampiezza + 1))


# --------------------------------------------------------------------------
# I fattori
# --------------------------------------------------------------------------

def _doy(iso):
    """Giorno dell'anno da una data ISO. None se la stringa non e' una data."""
    try:
        a, m, g = (int(x) for x in iso.split("-"))
        return date(a, m, g).timetuple().tm_yday
    except (ValueError, AttributeError):
        return None


def _doy_mmdd(mmdd, anno):
    m, g = (int(x) for x in mmdd.split("-"))
    return date(anno, m, g).timetuple().tm_yday


def _f_stagione(iso, sp):
    """Fenologia: in che periodo dell'anno quella specie butta davvero.

    Indipendente dal meteo. Le trombette a luglio non escono nemmeno con la
    settimana perfetta, e nessun modello di pioggia lo sa. Una specie puo'
    avere piu' finestre (il porcino ha i cimaroli di primavera oltre alla
    stagione d'autunno): vale la migliore.
    """
    n = _doy(iso)
    if n is None:                      # serie sintetiche senza date vere
        return 1.0, {"stagione": None}
    anno = int(iso.split("-")[0])
    picco = max(_trapezio(n, *(_doy_mmdd(x, anno) for x in finestra))
                for finestra in sp["stagione"])
    return STAGIONE_MIN + (1.0 - STAGIONE_MIN) * picco, {"stagione": round(picco, 2)}

def _f_innesco(d, i, sp):
    """Pioggia nella finestra di incubazione, pesata sulla concentrazione."""
    lag_min, lag_max = sp["lag"]
    tot = _somma(d["precipitation_sum"], i, lag_max, lag_min)
    evento = _max_rolling(d["precipitation_sum"], i, lag_max, lag_min, 3)
    volume = _sat(tot, sp["pioggia_innesco"])
    # Una pioggia concentrata vale piu' della stessa acqua spalmata su 2 settimane.
    concentrazione = 0.40 + 0.60 * _sat(evento, sp["pioggia_innesco"] * 0.6)
    return volume * concentrazione, {"mm_finestra": round(tot, 1),
                                     "mm_max_3gg": round(evento, 1)}


def _f_umidita(d, i):
    """Umidita' del suolo mantenuta nell'ultima settimana.

    Dove c'e' una stazione al suolo vicina, la sua umidita' relativa misurata
    entra come terza componente: e' l'unico dato osservato invece che
    interpolato. Pesa il 25%, non di piu', perche' e' una lettura istantanea
    contro medie giornaliere - dice com'e' adesso, non com'e' stata la settimana.
    """
    sm = _media(d.get("soil_moisture_0_to_7cm_mean", []), i, 7, 0)
    pioggia = _somma(d["precipitation_sum"], i, 7, 0)
    p_score = _sat(pioggia, 18.0)

    # 45% = aria secca, 80% = satura: sotto i 45 il bosco asciuga comunque.
    rh_st = _media(d.get("rh_stazione", []), i, 7, 0)
    st_score = None if rh_st is None else _clamp((rh_st - 45.0) / 35.0)

    if sm is None:
        # Nessun dato di suolo: ricado su pioggia recente + umidita' relativa.
        rh = rh_st if rh_st is not None else _media(
            d.get("relative_humidity_2m_mean", []), i, 7, 0)
        rh_score = _clamp(((rh if rh is not None else 60) - 45) / 35.0)
        return 0.6 * p_score + 0.4 * rh_score, {
            "suolo": None, "mm_7gg": round(pioggia, 1),
            "rh_stazione": None if rh_st is None else round(rh_st)}

    # 0.05 m3/m3 = secco, 0.25 = ben umido.
    sm_score = _clamp((sm - 0.05) / 0.20)
    if st_score is None:
        val = 0.70 * sm_score + 0.30 * p_score
    else:
        val = 0.55 * sm_score + 0.20 * p_score + 0.25 * st_score
    return val, {"suolo": round(sm, 3), "mm_7gg": round(pioggia, 1),
                 "rh_stazione": None if rh_st is None else round(rh_st)}


def _f_temperatura(d, i, sp, alberi=None):
    """Banda termica ottimale. Preferisce il suolo, ricade sull'aria.

    Al dato di suolo va tolta l'ombra della chioma: le bande delle specie sono
    quelle del sottobosco, il modello misura terreno scoperto."""
    t = _media(d.get("soil_temperature_0_to_7cm_mean", []), i, 6, 0)
    fonte = "suolo"
    ombra = 0.0
    if t is not None:
        copertura = min(1.0, sum(alberi.values())) if alberi else 0.0
        ombra = OMBRA_BOSCO_C * copertura
        t -= ombra
    else:
        t = _media(d.get("temperature_2m_mean", []), i, 6, 0)
        fonte = "aria"
    if t is None:
        return 0.5, {"t": None, "fonte": None, "ombra": None}
    return _trapezio(t, *sp["temp"]), {"t": round(t, 1), "fonte": fonte,
                                       "ombra": round(ombra, 1) or None}


def _f_shock(d, i):
    """Calo termico fra due settimane consecutive: induce i primordi.
    E' un bonus, non un requisito -> non scende mai sotto 0.5."""
    prima = _media(d.get("temperature_2m_mean", []), i, 20, 13)
    dopo = _media(d.get("temperature_2m_mean", []), i, 12, 6)
    if prima is None or dopo is None:
        return 0.75, {"delta": None}
    delta = prima - dopo          # positivo = si e' raffreddato
    return 0.5 + 0.5 * _clamp(delta / 6.0), {"delta": round(delta, 1)}


def _f_asciugatura(d, i):
    """Vento ed evapotraspirazione asciugano la lettiera e bloccano la buttata."""
    et0 = _media(d.get("et0_fao_evapotranspiration", []), i, 5, 0)
    vento = _media(d.get("wind_speed_10m_max", []), i, 5, 0)
    pen = 0.0
    if et0 is not None:
        pen += _clamp((et0 - 3.0) / 5.0) * 0.6      # oltre 3 mm/giorno inizia a pesare
    if vento is not None:
        pen += _clamp((vento - 22.0) / 30.0) * 0.4  # oltre 22 km/h asciuga
    return _clamp(1.0 - pen, 0.30, 1.0), {"et0": None if et0 is None else round(et0, 2),
                                          "vento": None if vento is None else round(vento, 1)}


def _f_riserva(d, i, sp):
    """Acqua accumulata dal micelio nei due mesi precedenti.
    Bonus lento: pesa poco ma spiega le annate buone e quelle nulle.

    La finestra parte dove finisce quella di innesco, altrimenti per le specie
    a incubazione lunga (trombette, lag fino a 26 giorni) la stessa pioggia
    verrebbe contata due volte."""
    inizio = sp["lag"][1] + 1
    tot = _somma(d["precipitation_sum"], i, LOOKBACK, inizio)
    return 0.5 + 0.5 * _sat(tot, 150.0), {"mm_riserva": round(tot, 1),
                                          "riserva_giorni": [inizio, LOOKBACK]}


# --------------------------------------------------------------------------
# Punteggio
# --------------------------------------------------------------------------

def _f_ospite(alberi, sp):
    """Affinita' micorrizica fra la specie e il bosco della zona.

    `alberi` sono le frazioni di copertura ({"faggio": 0.9, "quercia": 0.1}),
    quindi il prodotto scalare con le affinita' della specie sta gia' in [0,1].
    Zona senza composizione dichiarata: fattore neutro, cosi' non inventa
    penalita' su dati che non abbiamo."""
    if not alberi:
        return 1.0, {"bosco": None}
    tot = sum(alberi.values())
    if tot <= 0:
        return 1.0, {"bosco": None}
    aff = sum(f * sp["ospiti"].get(a, 0.3) for a, f in alberi.items()) / tot
    dominante = max(alberi.items(), key=lambda kv: kv[1])[0]
    return _clamp(aff), {"bosco": dominante,
                         "affinita": round(aff, 2)}


def _etichetta(q):
    if q < 1.5:
        return "Irrilevante"
    if q < 3.5:
        return "Scarso"
    if q < 5.5:
        return "Appena favorevole"
    if q < 7.5:
        return "Favorevole"
    return "Molto favorevole"


def _fattore_limitante(f):
    """Quale fattore sta tenendo giu' il punteggio (peso x quanto manca).
    L'ospite entra con esponente 1: e' un moltiplicatore, non una media."""
    return min(f.items(), key=lambda kv: kv[1] ** PESI.get(kv[0], 1.0))[0]


def score_day(d, i, specie="porcino", alberi=None):
    """Punteggio 0-10 per il giorno all'indice `i` delle serie giornaliere.
    `alberi` e' la composizione del bosco della zona, in frazioni di copertura.
    Ritorna None se non c'e' abbastanza storico alle spalle."""
    if i < LOOKBACK:
        return None
    sp = SPECIES[specie]

    f_innesco, det_i = _f_innesco(d, i, sp)
    f_umid, det_u = _f_umidita(d, i)
    f_temp, det_t = _f_temperatura(d, i, sp, alberi)
    f_shock, det_s = _f_shock(d, i)
    f_asc, det_a = _f_asciugatura(d, i)
    f_ris, det_r = _f_riserva(d, i, sp)
    f_osp, det_o = _f_ospite(alberi, sp)
    f_sta, det_st = _f_stagione(d["time"][i], sp)

    f = {
        "innesco": f_innesco,
        "umidita": f_umid,
        "temperatura": f_temp,
        "ospite": f_osp,
        "stagione": f_sta,
        "shock": f_shock,
        "asciugatura": f_asc,
        "riserva": f_ris,
    }

    prod = 1.0
    for k, peso in PESI.items():
        prod *= max(f[k], 1e-9) ** peso

    # Innesco, umidita' e temperatura sono condizioni necessarie, non
    # ingredienti da mediare: nessuna combinazione degli altri deve poterle
    # compensare. La media geometrica da sola non basta, perche' con pesi < 1
    # rimonta troppo i valori piccoli (0.03**0.32 = 0.32), e finiva per dare
    # "Scarso" a 2 mm di pioggia. Questo cancello e' una rampa, non un
    # gradino: uno scalino secco produceva salti 0.00 -> 2.66 fra due giorni
    # consecutivi mentre la finestra di incubazione scorreva.
    gate = _clamp(min(f[k] for k in NECESSARI) / GATE_FLOOR)

    q = round(10.0 * prod * gate * f["ospite"] * f["stagione"], 2)
    return {
        "data": d["time"][i],
        "q": q,
        "etichetta": _etichetta(q),
        "specie": specie,
        "fattori": {k: round(v, 3) for k, v in f.items()},
        "limitante": _fattore_limitante(f),
        "dettagli": {**det_i, **det_u, **det_t, **det_s, **det_a, **det_r,
                     **det_o, **det_st},
    }


def score_series(d, specie="porcino", alberi=None):
    """Punteggio per ogni giorno calcolabile delle serie."""
    return [s for s in (score_day(d, i, specie, alberi)
                        for i in range(len(d["time"]))) if s]


def picco(scores, da_data=None):
    """Giorno migliore fra quelli >= da_data (tipicamente oggi)."""
    cand = [s for s in scores if da_data is None or s["data"] >= da_data]
    return max(cand, key=lambda s: s["q"]) if cand else None


# --------------------------------------------------------------------------
# Self-check
# --------------------------------------------------------------------------

def _serie(n, pioggia=0.0, temp=15.0, suolo_um=0.15, suolo_t=None,
           vento=10.0, et0=2.0, rh=70.0, fine="2026-10-01"):
    """Serie sintetica costante di n giorni, che finisce a `fine`.
    Il primo ottobre e' dentro la stagione buona di tutte e quattro le specie,
    cosi' il fattore stagionale non falsa i confronti sugli altri fattori."""
    from datetime import timedelta
    ultimo = date(*(int(x) for x in fine.split("-")))
    return {
        "time": [(ultimo - timedelta(days=n - 1 - j)).isoformat() for j in range(n)],
        "precipitation_sum": [pioggia] * n,
        "temperature_2m_mean": [temp] * n,
        "relative_humidity_2m_mean": [rh] * n,
        "wind_speed_10m_max": [vento] * n,
        "et0_fao_evapotranspiration": [et0] * n,
        "soil_moisture_0_to_7cm_mean": [suolo_um] * n,
        "soil_temperature_0_to_7cm_mean": [suolo_t if suolo_t is not None else temp] * n,
    }


def demo():
    N = 80
    ultimo = N - 1

    # I pesi sono una media pesata: se non sommano a 1 il punteggio non e' piu'
    # sulla scala 0-10 e nessuno se ne accorge.
    assert abs(sum(PESI.values()) - 1.0) < 1e-9, sum(PESI.values())
    assert set(NECESSARI) <= set(PESI)
    for k in ("ospite", "stagione"):
        assert k not in PESI, f"{k} moltiplica, non entra nella media"
    for nome, sp in SPECIES.items():
        assert set(sp["ospiti"]) == set(ALBERI_NOTI), nome
        assert sp["temp"] == tuple(sorted(sp["temp"])), nome

    # Serve storico: sotto LOOKBACK giorni non si calcola nulla.
    assert score_day(_serie(80), 10) is None, "deve rifiutare storico insufficiente"
    assert score_day(_serie(80), ultimo) is not None

    # Siccita' totale -> punteggio ~0 nonostante temperatura perfetta.
    secco = score_day(_serie(N, pioggia=0.0, temp=16.0, suolo_um=0.02), ultimo)
    assert secco["q"] < 1.0, f"siccita' deve azzerare, invece {secco['q']}"
    assert secco["limitante"] == "innesco", secco["limitante"]

    # Gelo -> la temperatura azzera anche con acqua abbondante.
    gelo = score_day(_serie(N, pioggia=8.0, temp=-4.0, suolo_um=0.30), ultimo)
    assert gelo["q"] < 1.0, f"gelo deve azzerare, invece {gelo['q']}"
    assert gelo["limitante"] == "temperatura", gelo["limitante"]

    # Condizioni buone -> punteggio alto.
    buono = score_day(_serie(N, pioggia=6.0, temp=16.0, suolo_um=0.28,
                             vento=8.0, et0=1.5), ultimo)
    assert buono["q"] > 6.0, f"condizioni ideali, invece {buono['q']}"
    assert buono["etichetta"] in ("Favorevole", "Molto favorevole")

    # Monotonia: piu' pioggia nella finestra di incubazione -> punteggio piu' alto.
    q = [score_day(_serie(N, pioggia=p, temp=16.0, suolo_um=0.25), ultimo)["q"]
         for p in (0.5, 2.0, 5.0, 10.0)]
    assert q == sorted(q), f"non monotono in pioggia: {q}"

    # Regressione: il cancello sui fattori necessari dev'essere una rampa.
    # Con lo scalino il punteggio saltava da 0.00 a 2.66 fra due giorni
    # consecutivi, solo perche' la finestra di incubazione scorreva di un giorno.
    sweep = [score_day(_serie(N, pioggia=p / 20.0, temp=16.0, suolo_um=0.25),
                       ultimo)["q"] for p in range(0, 60)]
    assert sweep == sorted(sweep), "il cancello deve restare monotono"
    salti = [b - a for a, b in zip(sweep, sweep[1:])]
    assert max(salti) < 0.5, f"salto troppo brusco nel cancello: {max(salti):.2f}"

    # Pioggia trascurabile (~3 mm in due settimane) non e' un innesco:
    # non deve arrivare a "Scarso".
    briciole = score_day(_serie(N, pioggia=0.2, temp=16.0, suolo_um=0.25), ultimo)
    assert briciole["q"] < 1.5, f"3 mm non sono un innesco, invece {briciole['q']}"
    assert briciole["etichetta"] == "Irrilevante"

    # Il vento forte deve penalizzare, a parita' di tutto il resto.
    calmo = score_day(_serie(N, pioggia=6.0, temp=16.0, suolo_um=0.28, vento=5.0), ultimo)
    ventoso = score_day(_serie(N, pioggia=6.0, temp=16.0, suolo_um=0.28, vento=60.0), ultimo)
    assert ventoso["q"] < calmo["q"], "il vento forte deve abbassare il punteggio"

    # Lo shock termico deve premiare: caldo prima, fresco dopo.
    d = _serie(N, pioggia=6.0, temp=16.0, suolo_um=0.28)
    for j in range(N - 20, N - 12):
        d["temperature_2m_mean"][j] = 24.0        # settimana calda, due settimane fa
    con_shock = score_day(d, ultimo)
    senza = score_day(_serie(N, pioggia=6.0, temp=16.0, suolo_um=0.28), ultimo)
    assert con_shock["fattori"]["shock"] > senza["fattori"]["shock"]

    # Le specie hanno bande diverse: a 22 gradi il porcino e' ancora in
    # partita, la trombetta no; a 9 gradi si invertono.
    caldo = _serie(N, pioggia=6.0, temp=22.0, suolo_um=0.25)
    assert (score_day(caldo, ultimo, "porcino")["q"]
            > score_day(caldo, ultimo, "trombetta")["q"])
    freddo = _serie(N, pioggia=6.0, temp=9.0, suolo_um=0.25)
    for tardiva in ("steccherino", "trombetta"):
        assert (score_day(freddo, ultimo, tardiva)["q"]
                > score_day(freddo, ultimo, "porcino")["q"]), tardiva

    # Il bosco conta: la trombetta sotto conifera pura non ha ospite, il
    # galletto invece se la cava.
    base = _serie(N, pioggia=6.0, temp=13.0, suolo_um=0.28)
    conifera = {"conifere": 1.0}
    faggeta = {"faggio": 1.0}
    # Moltiplicatore diretto: affinita' 0.2 deve dare un quinto del punteggio.
    t_con = score_day(base, ultimo, "trombetta", conifera)
    t_fag = score_day(base, ultimo, "trombetta", faggeta)
    assert abs(t_con["q"] - t_fag["q"] * 0.2) < 0.05, (t_con["q"], t_fag["q"])
    assert (score_day(base, ultimo, "galletto", conifera)["q"]
            > score_day(base, ultimo, "trombetta", conifera)["q"])
    assert score_day(base, ultimo, "trombetta", conifera)["limitante"] == "ospite"

    # Stagione: con meteo identico, la trombetta a luglio non deve uscire, a
    # inizio novembre si'. Il porcino fa il contrario a fine ottobre.
    meteo = dict(pioggia=6.0, temp=13.0, suolo_um=0.28)
    luglio = score_day(_serie(N, **meteo, fine="2026-07-15"), ultimo, "trombetta", faggeta)
    novembre = score_day(_serie(N, **meteo, fine="2026-11-05"), ultimo, "trombetta", faggeta)
    assert luglio["q"] < novembre["q"] * 0.2, (luglio["q"], novembre["q"])
    assert luglio["limitante"] == "stagione", luglio["limitante"]

    # Fuori stagione si scende molto, ma non a zero: le buttate anomale esistono.
    assert luglio["fattori"]["stagione"] == STAGIONE_MIN
    assert luglio["q"] > 0.0

    # Il porcino ha due finestre: i cimaroli di giugno devono valere piu' di
    # meta' agosto, che sta nel buco fra le due.
    giugno = score_day(_serie(N, **meteo, fine="2026-06-15"), ultimo, "porcino", faggeta)
    agosto = score_day(_serie(N, **meteo, fine="2026-08-10"), ultimo, "porcino", faggeta)
    assert giugno["fattori"]["stagione"] > agosto["fattori"]["stagione"], "cimaroli"

    # Date non riconoscibili (serie sintetiche vecchio stile): fattore neutro.
    senza_date = _serie(N, **meteo)
    senza_date["time"] = [f"d{j:03d}" for j in range(N)]
    assert score_day(senza_date, ultimo, "trombetta")["fattori"]["stagione"] == 1.0

    # L'ombra della chioma va tolta al suolo, e solo al suolo. Con 24 gradi di
    # terreno scoperto il porcino e' fuori banda; sotto faggeta chiusa no.
    caldo24 = _serie(N, pioggia=6.0, temp=24.0, suolo_um=0.25, suolo_t=24.0)
    scoperto = score_day(caldo24, ultimo, "porcino", None)
    sotto_chioma = score_day(caldo24, ultimo, "porcino", faggeta)
    assert sotto_chioma["fattori"]["temperatura"] > scoperto["fattori"]["temperatura"]
    assert sotto_chioma["dettagli"]["ombra"] == OMBRA_BOSCO_C
    assert scoperto["dettagli"]["ombra"] is None
    assert (abs(scoperto["dettagli"]["t"] - sotto_chioma["dettagli"]["t"])
            - OMBRA_BOSCO_C) < 1e-6

    # Se il dato di suolo manca si usa l'aria, e l'aria NON va ombreggiata:
    # la temperatura a 2 m e' gia' quella dell'ambiente.
    solo_aria = _serie(N, pioggia=6.0, temp=24.0, suolo_um=0.25)
    del solo_aria["soil_temperature_0_to_7cm_mean"]
    a = score_day(solo_aria, ultimo, "porcino", faggeta)
    assert a["dettagli"]["fonte"] == "aria" and a["dettagli"]["ombra"] is None

    # Bosco non dichiarato: fattore neutro, non una penalita' inventata.
    assert score_day(base, ultimo, "porcino", None)["fattori"]["ospite"] == 1.0

    # Le frazioni non normalizzate non devono sballare la scala.
    a = score_day(base, ultimo, "porcino", {"faggio": 9, "quercia": 1})["fattori"]["ospite"]
    b = score_day(base, ultimo, "porcino", {"faggio": 0.9, "quercia": 0.1})["fattori"]["ospite"]
    assert abs(a - b) < 1e-9, (a, b)
    assert 0.0 <= a <= 1.0

    # Innesco e riserva non devono mai contare la stessa pioggia due volte,
    # nemmeno per le specie a incubazione lunga.
    for nome, sp in SPECIES.items():
        assert sp["lag"][1] < LOOKBACK, nome
        assert _f_riserva(_serie(N), ultimo, sp)[1]["riserva_giorni"][0] > sp["lag"][1], nome

    # L'umidita' misurata dalla stazione deve spostare il fattore umidita'
    # nella direzione giusta, e comparire nei dettagli.
    umido, secco_aria = _serie(N, pioggia=3.0, temp=15.0, suolo_um=0.15), \
                        _serie(N, pioggia=3.0, temp=15.0, suolo_um=0.15)
    umido["rh_stazione"] = [92.0] * N
    secco_aria["rh_stazione"] = [30.0] * N
    su, ss = score_day(umido, ultimo), score_day(secco_aria, ultimo)
    assert su["fattori"]["umidita"] > ss["fattori"]["umidita"]
    assert su["dettagli"]["rh_stazione"] == 92
    # Senza stazione il dettaglio esiste comunque, a None.
    assert score_day(_serie(N), ultimo)["dettagli"]["rh_stazione"] is None

    # Dati di suolo mancanti: deve ricadere su aria/pioggia senza esplodere.
    senza_suolo = _serie(N, pioggia=6.0, temp=16.0)
    del senza_suolo["soil_moisture_0_to_7cm_mean"]
    del senza_suolo["soil_temperature_0_to_7cm_mean"]
    fb = score_day(senza_suolo, ultimo)
    assert fb is not None and 0.0 <= fb["q"] <= 10.0
    assert fb["dettagli"]["fonte"] == "aria"

    # I None dentro le serie non devono far saltare i conti.
    bucata = _serie(N, pioggia=6.0, temp=16.0, suolo_um=0.25)
    for k in ("precipitation_sum", "temperature_2m_mean", "wind_speed_10m_max"):
        bucata[k][ultimo - 3] = None
    assert score_day(bucata, ultimo) is not None

    # Il punteggio resta sempre nel dominio dichiarato.
    for s in score_series(_serie(N, pioggia=3.0, temp=15.0)):
        assert 0.0 <= s["q"] <= 10.0, s

    print("growth.py: tutti i controlli passati")
    print(f"  siccita'  q={secco['q']:5.2f}  limitante={secco['limitante']}")
    print(f"  gelo      q={gelo['q']:5.2f}  limitante={gelo['limitante']}")
    print(f"  ideale    q={buono['q']:5.2f}  {buono['etichetta']}")


if __name__ == "__main__":
    demo()
