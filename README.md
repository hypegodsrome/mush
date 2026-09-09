# Mush

Sito personale su funghi e meteo della **Valle dell'Aniene** e dei **Monti
Simbruini** (Monte Livata, Subiaco, Jenne, Canterano).

Sito statico su GitHub Pages, login Google via Firebase Auth, dati rigenerati
da GitHub Actions ogni 6 ore.

- **Previsione** — modello di crescita a otto fattori, per zona e per specie
- **Mappa** — le sette zone, più la griglia nazionale di Meteo Funghi
- **Webcam** — Monte Livata e dintorni, caricate solo a richiesta
- **Meteo** — stazione al suolo e statistiche per ogni zona
- **Modello** — come funziona, con che pesi, e cosa non sa fare

## Il modello

Il fungo non nasce il giorno in cui piove: la pioggia innesca il micelio, poi
servono una-tre settimane perché il carpoforo emerga. Il punteggio di oggi
dipende quindi soprattutto dalla pioggia di **8–21 giorni fa**, e dal fatto che
nel frattempo il terreno non si sia asciugato.

**Sei fattori meteo**, combinati con una media geometrica pesata:

| Fattore | Peso | Cosa guarda |
|---|---:|---|
| Innesco | 32% | pioggia nella finestra di incubazione, pesata sulla concentrazione |
| Umidità | 22% | suolo 0–7 cm, pioggia dei 7 giorni, umidità misurata dalla stazione |
| Temperatura | 22% | banda della specie, sul suolo corretto per l'ombra della chioma |
| Asciugatura | 10% | vento ed evapotraspirazione degli ultimi 5 giorni |
| Shock termico | 8% | calo di temperatura che induce i primordi |
| Riserva | 6% | pioggia accumulata dal micelio, dopo la finestra di innesco |

La media è **geometrica**, non aritmetica: se un fattore va a zero il punteggio
crolla, che è il comportamento reale. Una media aritmetica compenserebbe la
siccità con una bella temperatura. Sopra c'è un cancello a rampa su innesco,
umidità e temperatura: sono condizioni necessarie, e nessuna combinazione delle
altre deve poterle compensare.

**Due fattori moltiplicano** invece di entrare nella media, perché non sono
ingredienti da bilanciare — sono la frazione di bosco e di calendario in cui
quella specie può proprio esistere:

- **Bosco ospite** — affinità micorrizica fra la specie e gli alberi della zona.
  Trombette sotto conifera pura: 0,2, cioè un quinto del punteggio, per quanto
  perfetto sia il tempo.
- **Stagione** — la fenologia della specie. Le trombette a luglio non escono
  nemmeno con la settimana ideale. Fuori finestra il fattore scende a 0,10 e non
  a zero: le buttate anomale esistono.

### Specie

| Specie | Periodo migliore | Temperatura ottimale | Incubazione |
|---|---|---:|---:|
| Porcino | 10 set – 25 ott (+ cimaroli 1–30 giu) | 12–19 °C | 8–21 gg |
| Galletto / finferlo | 1 lug – 30 set | 11–18 °C | 6–18 gg |
| Steccherino dorato | 15 set – 15 nov | 8–16 °C | 10–24 gg |
| Trombetta dei morti | 1 ott – 20 nov | 8–15 °C | 12–26 gg |

### Zone

Monte Livata, Campaegli, Rocca Canterano, Canterano, località Cicchetti,
Subiaco, Jenne. Coordinate verificate su OSM/Nominatim — **tranne località
Cicchetti**, che OSM non conosce: è piazzata fra Canterano e Rocca Canterano e
va corretta con le coordinate vere (`SPOTS` in `scripts/build_data.py`).

Ogni zona dichiara la composizione del bosco in frazioni di copertura, stimata
per fascia altimetrica: faggeta sopra i 1000 m, castagno e querce sotto, leccio
sui versanti caldi dell'Aniene. Sono stime, non un rilievo forestale.

```bash
python scripts/growth.py              # controlli del modello
python scripts/build_data.py --selftest
python scripts/build_data.py          # rigenera data/*.json
```

## Sorgenti

| Sorgente | Cosa dà | Come |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | 92 giorni di storico + 16 di previsione, umidità e temperatura del suolo | API pubblica, nessuna chiave |
| [Rete Meteo Lazio RM-175](https://meteoregionelazio.it/rete/stazione.php?id=RM-175) | osservazioni reali da una Davis Vantage Pro 2 a 1345 m | scraping |
| [Meteo Funghi](https://meteofunghi.fungocenter.it/) | griglia nazionale, 632 celle da 0,2° | scraping di `/embed` |
| Windy | previsione puntuale, opzionale | disattivo finché manca il secret `WINDY_KEY` |

La stazione di Monte Livata entra nel modello in due modi, entro 8 km:

- la **pioggia misurata** riscala quella modellata da Open-Meteo — è il fattore
  che pesa di più e il modello a griglia in montagna sbaglia parecchio. Tocca
  solo i giorni passati: un bias osservato ieri non è il bias della previsione
  di domani;
- l'**umidità relativa misurata** entra nel fattore umidità al 25%. Non di più,
  perché è una lettura istantanea contro medie giornaliere: dice com'è adesso,
  non com'è stata la settimana.

Perché lo scraping gira in CI e non nel browser: `meteofunghi.fungocenter.it`
non manda header CORS e vieta l'iframe (`X-Frame-Options: SAMEORIGIN`), quindi
dalla pagina non è raggiungibile. In più così l'eventuale chiave Windy resta in
un Secret e non finisce nel JavaScript.

## Configurazione

### Firebase

I valori in `assets/firebase-config.js` sono pubblici per definizione: finiscono
nel bundle che gira nel browser. Non sono un segreto.

```bash
firebase login                                              # account che possiede ecosite-34d60
firebase apps:create WEB mush --project ecosite-34d60       # solo la prima volta
firebase apps:sdkconfig WEB --project ecosite-34d60
```

Poi, nella console Firebase:

1. **Authentication → Sign-in method** → abilita **Google**
2. **Authentication → Settings → Domini autorizzati** → aggiungi
   `hypegodsrome.github.io`

Senza il secondo passo il login fallisce con `auth/unauthorized-domain`. Il sito
lo dice esplicitamente nel messaggio d'errore.

Chi può entrare si controlla con `EMAIL_AMMESSE` nello stesso file. È un
cancello d'ingresso lato client, **non** una protezione dei dati: i JSON sono
serviti in chiaro da GitHub Pages e chiunque abbia l'URL li può scaricare. Per
un sito di funghi va bene; se un giorno ci metti qualcosa di privato, serve un
backend vero.

### Windy (opzionale)

`Settings → Secrets and variables → Actions` → nuovo secret `WINDY_KEY`. Al giro
successivo il modulo si attiva da solo; senza, `build_data.py` lo salta e tira
dritto.

## Webcam

Lo stato vivo/spento **non è scritto nel codice**: lo misura la CI a ogni giro
leggendo `Last-Modified` (dal browser non si può, quasi nessuna manda header
CORS). Oltre 24 ore dall'ultimo fotogramma la webcam finisce in fondo alla
pagina, in piccolo e in bianco e nero, con scritto da quanto è ferma. Quando
riparte torna su a dimensione piena da sola, senza toccare niente.

Si caricano **solo** all'apertura della scheda o premendo Aggiorna: nessun
`setInterval`, nessun polling. Un tocco sull'immagine la apre a tutto schermo.

## Limiti

È un modello meteorologico. Non sa dove sono i tuoi boschi, che alberi ci sono
davvero, com'è il suolo, né se qualcuno è già passato stamattina. Dice se le
*condizioni* sono favorevoli; se il micelio lì non c'è, non nasce niente
comunque.

**Non usare questo sito per decidere se un fungo è commestibile.** Per quello
serve un micologo della ASL.
