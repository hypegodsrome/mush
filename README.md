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

Tema chiaro o scuro dal pulsante in alto a destra: cicla automatico → chiaro →
scuro. In automatico segue il sistema operativo. Entrambe le palette superano
WCAG AA (4,5:1) su tutti i colori di testo.

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

**Il sito è aperto: entra chiunque abbia un account Google e il link.** Non
c'è nessuna lista di indirizzi ammessi. C'era, ed è stata tolta del tutto
invece di lasciarla vuota: con `Cache-Control: max-age=600` una copia vecchia
del file avrebbe continuato a rifiutare gente per dieci minuti dopo ogni
pubblicazione.

Un filtro rimesso in `onAuthStateChanged` sarebbe comunque un controllo lato
client: tiene fuori dall'interfaccia, non dai dati. I JSON sono serviti in
chiaro da GitHub Pages e chiunque abbia l'indirizzo li può scaricare. Per una
restrizione vera serve un backend.

### Amministrazione

`/mush/adm/` — riservata a `eug2002@gmail.com`. Elenca chi è entrato (primo
accesso, ultimo accesso, numero di accessi) e permette di bandire, riammettere
o eliminare.

Il registro sta su **Cloud Firestore**, in `utenti/{uid}`. Il bando è applicato
dalle regole in [`firestore.rules`](firestore.rules), che girano sui server di
Google: non è un controllo del browser e non si aggira modificando la pagina.
Le regole impediscono anche di togliersi il bando da soli, di cambiare la
propria email, e di scrivere un contatore che non sia un intero — quel campo lo
scrive l'utente e finisce in pagina nell'amministrazione.

**Cosa un bando non fa:** i dati meteo stanno in file statici su GitHub Pages e
restano pubblici. Un bandito non entra più nell'interfaccia e non legge il
registro, ma i JSON li scarica lo stesso conoscendo l'indirizzo. Per impedirlo
servirebbe un backend.

Eliminare un utente **non** è bandirlo: al prossimo accesso ricrea il proprio
documento e rientra.

#### Attivazione

Firestore va acceso una volta sola, dalla console:

1. [Crea il database](https://console.firebase.google.com/project/ecosite-34d60/firestore)
   → *Crea database* → modalità **produzione** → regione `eur3` o `europe-west8`
2. Poi, da qui, pubblica le regole:

```bash
firebase deploy --only firestore:rules --project ecosite-34d60
```

Finché Firestore è spento il sito funziona lo stesso: il registro fallisce in
silenzio e nessuno viene respinto.

### Cache

Gli asset escono con `Cache-Control: max-age=600`. Per non lasciare dieci
minuti di codice vecchio con dati nuovi dopo ogni deploy, la CI appende la
versione del commit agli indirizzi di `app.js`, `app.css` e
`firebase-config.js`. L'indirizzo cambia a ogni pubblicazione, quindi la cache
non può rispondere. L'HTML non è marcato: è lui a cambiare.

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

## Sicurezza

Prima le cose che **non** si possono fare, perché contano più di quelle fatte.

GitHub Pages serve file statici da una CDN. Non c'è un server, quindi:

- **Non è possibile limitare le richieste né bloccare i bot.** Nessun rate
  limit, nessun challenge, nessun blocco per IP. Un limite scritto nel
  JavaScript lo si aggira con un `curl`. `robots.txt` lo rispettano solo i
  crawler educati. Per un blocco vero serve un CDN davanti al sito
  (Cloudflare con dominio personalizzato, oppure spostarsi su un host con
  regole edge).
- **Non è possibile impostare header HTTP.** Niente `X-Frame-Options`, niente
  `frame-ancestors`, niente `Permissions-Policy`: quelle direttive esistono
  solo come header veri. La CSP sta in un `<meta>`, che copre tutto il resto
  ma non quelle.
- **I dati sono pubblici.** `data/*.json` è scaricabile da chiunque conosca
  l'indirizzo. Il login protegge l'interfaccia, non i file. Non esiste modo di
  cambiarlo restando su hosting statico.

Quindi: **"sicuro al 100%" non è una condizione raggiungibile**, qui come
altrove. Quello che si può fare è ridurre la superficie, ed è stato fatto.

| Misura | Dove |
|---|---|
| HTTPS obbligatorio, HSTS, redirect da HTTP | GitHub Pages, di serie |
| CSP con `default-src 'none'`, tutto in allowlist | `<meta>` in `index.html` |
| Script inline ammesso per **hash**, non `unsafe-inline` | idem |
| Hash verificato a ogni build, altrimenti fallisce | `verifica_csp()` |
| SRI sugli script da CDN | `index.html` |
| **Integrità della catena di fornitura**: a ogni build le risorse CDN vengono riscaricate e il digest confrontato con l'`integrity` dichiarato | `verifica_sri()` |
| **Riautenticazione fresca** prima di bandire o eliminare | `confermaIdentita()` |
| Permessi minimi: ognuno tocca solo il proprio documento, solo tre campi, non può sbandirsi | `firestore.rules` |
| Iframe di terzi in `sandbox`, senza `allow-same-origin` | `schedaCam()` |
| `referrerpolicy="no-referrer"` su webcam e iframe | idem |
| Ogni stringa passata all'HTML viene escapata | `esc()` |
| Nessun segreto nel client (la chiave Windy sta in un Secret) | `build_data.py` |
| Versioni CDN fissate esatte, mai `@latest` | `index.html` |
| Aggiornamento automatico delle action | `.github/dependabot.yml` |
| `noindex, nofollow` e `robots.txt` | `index.html`, `robots.txt` |

### Perché la checklist da CMS non si applica tutta

Buona parte dei consigli di sicurezza che si trovano in giro presuppone un
server con un CMS, un database e dei plugin. Qui non c'è niente di tutto ciò,
e le voci vanno tradotte o scartate:

| Voce tipica | Qui |
|---|---|
| Certificato SSL/TLS | già attivo, con HSTS e redirect. Nulla da fare |
| MFA sull'area amministrativa | il secondo fattore lo impone Google, non il sito. Attivalo sull'account; il sito richiede comunque un accesso **fresco** prima delle azioni distruttive |
| Web Application Firewall | **non installabile.** Non c'è un origin server da proteggere. Servirebbe un CDN davanti al sito (Cloudflare con dominio personalizzato) |
| Anti-DDoS | nessuna configurazione possibile, ma un sito statico su CDN non ha un backend da esaurire: è la forma più resistente per costruzione |
| Aggiornare CMS, plugin, PHP | non esistono. Le uniche dipendenze sono Leaflet e l'SDK Firebase, a versione fissa, con integrità verificata a ogni build |
| Scansione malware e integrità file | l'equivalente qui è git più i controlli su CSP e SRI: qualsiasi modifica è un commit, e un CDN che cambia byte fa fallire la build |
| Backup del database | il codice è su git in più copie. **Il registro utenti su Firestore non è sottoposto a backup**: se ti importa, servono i backup programmati di Firestore, che richiedono il piano Blaze |
| Niente utente "admin", limite ai tentativi di accesso | non ci sono password da indovinare: l'identità è Google, e l'amministratore è un indirizzo preciso inchiodato nelle regole lato server |

`style-src` tiene `'unsafe-inline'` perché l'interfaccia scrive attributi
`style` (larghezze delle barre, colori del punteggio) e gli hash sugli
attributi non sono ancora supportati in modo diffuso. È una concessione nota,
non una svista.

### Da fare in console, non dal codice

1. **Limita la chiave API Firebase per referrer.**
   [Credenziali Google Cloud](https://console.cloud.google.com/apis/credentials?project=ecosite-34d60)
   → la chiave del browser → *Restrizioni applicazione* → *Siti web* → aggiungi
   `hypegodsrome.github.io/*`. Senza questo la chiave è usabile da qualsiasi
   sito; con questo, no.
2. **Se un giorno aggiungi Firestore**, attiva **App Check** e scrivi regole di
   sicurezza restrittive. `EMAIL_AMMESSE` è un controllo lato client: tiene
   fuori dall'interfaccia, non dai dati.

## Limiti

È un modello meteorologico. Non sa dove sono i tuoi boschi, che alberi ci sono
davvero, com'è il suolo, né se qualcuno è già passato stamattina. Dice se le
*condizioni* sono favorevoli; se il micelio lì non c'è, non nasce niente
comunque.

**Non usare questo sito per decidere se un fungo è commestibile.** Per quello
serve un micologo della ASL.
