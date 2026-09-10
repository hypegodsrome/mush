import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const NOMI_FATTORI = {
  ospite:      ["Bosco ospite", "affinità con gli alberi della zona"],
  stagione:    ["Stagione", "periodo dell'anno in cui butta"],
  innesco:     ["Innesco", "pioggia 8–21 giorni fa"],
  umidita:     ["Umidità", "suolo e pioggia recente"],
  temperatura: ["Temperatura", "banda ottimale della specie"],
  shock:       ["Shock termico", "calo che induce i primordi"],
  asciugatura: ["Asciugatura", "vento ed evapotraspirazione"],
  riserva:     ["Riserva", "pioggia accumulata in 60 giorni"],
};

const stato = { dati: null, spot: null, specie: "porcino",
                mappa: null, base: null, strati: {} };

// ==========================================================================
// Utilita'
// ==========================================================================
const DOW = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

function giorno(iso) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, g));
}
const dow = (iso) => DOW[giorno(iso).getUTCDay()];
const gg = (iso) => iso.slice(8, 10);

/** Componenti RGB della scala: serve al disegno su canvas, dove non si puo'
 *  passare una stringa "rgb(...)" pixel per pixel. */
function coloreQrgb(q) {
  const stops = [[0, [156, 163, 175]], [3, [156, 163, 175]], [5, [251, 191, 36]],
                 [7, [249, 115, 22]], [10, [239, 68, 68]]];
  q = Math.max(0, Math.min(10, q));
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i - 1], [x2, c2] = stops[i];
    if (q <= x2) {
      const t = x2 === x1 ? 0 : (q - x1) / (x2 - x1);
      return c1.map((c, j) => Math.round(c + (c2[j] - c) * t));
    }
  }
  return [239, 68, 68];
}

/** Scala colore allineata alla legenda di Meteo Funghi. */
function coloreQ(q) {
  const stops = [[0, [156, 163, 175]], [3, [156, 163, 175]], [5, [251, 191, 36]],
                 [7, [249, 115, 22]], [10, [239, 68, 68]]];
  q = Math.max(0, Math.min(10, q));
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i - 1], [x2, c2] = stops[i];
    if (q <= x2) {
      const t = x2 === x1 ? 0 : (q - x1) / (x2 - x1);
      return `rgb(${c1.map((c, j) => Math.round(c + (c2[j] - c) * t)).join(",")})`;
    }
  }
  return "rgb(239,68,68)";
}

/** Aggiunge un parametro anti-cache rispettando la query gia' presente. */
const bust = (url, t) => url + (url.includes("?") ? "&" : "?") + "_=" + t;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ==========================================================================
// Tema
//
// Tre stati: "auto" segue il sistema, "chiaro" e "scuro" sono scelte
// esplicite. Il pulsante li cicla, cosi' dopo aver scelto si puo' tornare
// all'automatico - con un semplice interruttore a due posizioni non si
// potrebbe piu'. Il valore iniziale lo mette lo script inline nell'head,
// prima del CSS, per non far lampeggiare la pagina.
// ==========================================================================
const TEMI = [
  { id: "auto",   icona: "◐", testo: "Tema: automatico (segue il sistema)" },
  { id: "chiaro", icona: "☀", testo: "Tema: chiaro" },
  { id: "scuro",  icona: "☾", testo: "Tema: scuro" },
];

function temaCorrente() {
  return document.documentElement.dataset.tema || "auto";
}

function applicaTema(id) {
  const root = document.documentElement;
  if (id === "auto") delete root.dataset.tema;
  else root.dataset.tema = id;

  try {
    if (id === "auto") localStorage.removeItem("mush-tema");
    else localStorage.setItem("mush-tema", id);
  } catch (e) { /* storage bloccato: vale per questa sessione */ }

  // Due pulsanti: uno nell'intestazione e uno nella schermata di accesso, che
  // e' quello che si vede per primo. Restano in sincrono perche' leggono
  // entrambi lo stesso stato.
  const t = TEMI.find((x) => x.id === id) || TEMI[0];
  $$("[data-tema-btn]").forEach((b) => {
    b.textContent = t.icona;
    b.title = t.testo;
    b.setAttribute("aria-label", t.testo);
  });

  // La barra del browser su mobile deve seguire il fondo pagina.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || "#12100d";
  }
}

function avviaTema() {
  applicaTema(temaCorrente());
  $$("[data-tema-btn]").forEach((b) => b.addEventListener("click", () => {
    const i = TEMI.findIndex((x) => x.id === temaCorrente());
    applicaTema(TEMI[(i + 1) % TEMI.length].id);
  }));
}
avviaTema();

// ==========================================================================
// Autenticazione
// ==========================================================================
const configurato = !Object.values(firebaseConfig).some((v) => v === "DA_COMPILARE");
// Bypass solo in sviluppo locale: su GitHub Pages l'hostname non e' mai
// localhost, quindi in produzione questo ramo non puo' attivarsi.
const inLocale = ["localhost", "127.0.0.1", ""].includes(location.hostname);

function mostraGate(msg) {
  $("#gate").hidden = false;
  $("#app").hidden = true;
  if (msg) { $("#gate-err").hidden = false; $("#gate-err").textContent = msg; }
}

function apriApp(utente, opz = {}) {
  $("#gate").hidden = true;
  $("#app").hidden = false;
  $("#user").textContent = utente?.email || "modalità sviluppo";
  // Il collegamento all'amministrazione compare solo a chi la puo' usare.
  // Non e' una misura di sicurezza - chi conosce l'indirizzo ci arriva
  // comunque, e a quel punto sono le regole di Firestore a fermarlo.
  $("#link-adm").hidden = !opz.admin;
  // Senza questo catch un errore di render finisce in una promise rifiutata:
  // console muta e pagina a meta', senza che nessuno se ne accorga.
  avvia().catch((e) => {
    console.error(e);
    $("main").insertAdjacentHTML("afterbegin",
      `<div class="err"><b>Errore nel disegnare la pagina.</b><br>${esc(e.message)}</div>`);
  });
}

if (!configurato && inLocale) {
  console.warn("Firebase non configurato: accesso libero perché sei in locale.");
  $("#btn-logout").hidden = true;
  apriApp(null);
} else if (!configurato) {
  mostraGate("Firebase non è ancora configurato: compila assets/firebase-config.js "
    + "con l'output di `firebase apps:sdkconfig WEB --project ecosite-34d60`.");
} else {
  const fbApp = initializeApp(firebaseConfig);
  const auth = getAuth(fbApp);
  const provider = new GoogleAuthProvider();
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  // Entra chiunque abbia un account Google: nessuna lista di indirizzi.
  // L'unico motivo per cui si viene respinti e' un bando, che pero' non e'
  // deciso qui - lo decidono le regole di Firestore, che girano sui server
  // di Google. Questo controllo serve solo a mostrare un messaggio decente.
  onAuthStateChanged(auth, async (u) => {
    if (!u) return mostraGate();

    const { registraAccesso, isAdmin } = await import("./registro.js");
    // Non chiamarlo `stato`: coprirebbe lo stato globale del modulo.
    const esito = await registraAccesso(fbApp, u);

    if (esito.bandito) {
      await signOut(auth);
      return mostraGate("Questo account non ha più accesso al sito.");
    }
    apriApp(u, { admin: isAdmin(u), registro: !esito.errore });
  });

  // I due inciampi del primo deploy. Entrambi si risolvono in console, ma i
  // codici grezzi non dicono cosa fare, quindi lo diciamo noi.
  const PROJ = firebaseConfig.projectId;
  const AIUTO = {
    "auth/configuration-not-found":
      `Authentication non è ancora attivo sul progetto ${PROJ}. `
      + `Aprilo in console → Authentication → Inizia, poi abilita Google.`,
    "auth/unauthorized-domain":
      `Il dominio «${location.hostname}» non è autorizzato. `
      + `Console → Authentication → Settings → Domini autorizzati → Aggiungi dominio.`,
    "auth/operation-not-allowed":
      "Il provider Google non è abilitato. "
      + "Console → Authentication → Sign-in method → Google → Abilita.",
    "auth/popup-blocked":
      "Il browser ha bloccato la finestra di accesso. Sbloccala e riprova.",
    "auth/popup-closed-by-user":
      "Finestra di accesso chiusa prima di completare l'accesso.",
  };

  $("#btn-login").addEventListener("click", async () => {
    $("#gate-err").hidden = true;
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      mostraGate(AIUTO[e.code] || e.message || String(e));
    }
  });

  $("#btn-logout").addEventListener("click", () => signOut(auth));
}

// ==========================================================================
// Avvio
// ==========================================================================
async function carica(nome) {
  const r = await fetch(`data/${nome}.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`data/${nome}.json → HTTP ${r.status}`);
  return r.json();
}

async function avvia() {
  if (stato.dati) return;
  try {
    const [spots, meta, mf, stazione, webcam] = await Promise.all([
      carica("spots"), carica("meta"),
      carica("meteofunghi").catch(() => null),
      carica("stazione").catch(() => null),
      carica("webcam").catch(() => null),
    ]);
    stato.dati = { spots: spots.spots, giorno: spots.giorno, meta, mf, stazione, webcam };
    stato.spot = spots.spots[0];
  } catch (e) {
    $("main").innerHTML = `<div class="err"><b>Dati non disponibili.</b><br>${esc(e.message)}
      <br><br>Genera i JSON con <code>python scripts/build_data.py</code>,
      oppure attendi il prossimo giro di GitHub Actions.</div>`;
    return;
  }

  riempiSelettori();
  renderPrevisione();
  renderStagioni();
  renderModello();
  attivaTab();
  avviaLightbox();
}

function riempiSelettori() {
  const { spots, meta } = stato.dati;
  $("#sel-spot").innerHTML = spots
    .map((s) => `<option value="${esc(s.id)}">${esc(s.nome)} · ${Math.round(s.quota_dem)} m</option>`)
    .join("");
  $("#sel-specie").innerHTML = Object.entries(meta.modello.specie)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(v.nome.split(" (")[0])}</option>`).join("");
  $("#sel-meteo").innerHTML = $("#sel-spot").innerHTML;
  $("#sel-meteo").addEventListener("change", renderMeteo);

  $("#sel-spot").addEventListener("change", (e) => {
    stato.spot = spots.find((s) => s.id === e.target.value);
    renderPrevisione();
    if (stato.mappa) disegnaMappa();
  });
  $("#sel-specie").addEventListener("change", (e) => {
    stato.specie = e.target.value;
    renderPrevisione();
    if (stato.mappa) disegnaMappa();
  });
}

// ==========================================================================
// Vista: previsione
// ==========================================================================
function renderPrevisione() {
  const s = stato.spot, sp = s.specie[stato.specie], oggi = sp.oggi;
  if (!oggi) return;

  const q = oggi.q;
  $("#q-val").textContent = q.toFixed(1).replace(".", ",");
  $("#q-label").textContent = oggi.etichetta;
  $("#q-label").style.color = coloreQ(q);
  const arc = $("#gauge-arc");
  arc.style.stroke = coloreQ(q);
  arc.style.strokeDashoffset = String(327 - 327 * (q / 10));
  // A q=0 l'arco ha lunghezza nulla ma stroke-linecap:round disegna comunque
  // un pallino in cima, che si legge come "un pochino": va nascosto.
  arc.style.opacity = q < 0.05 ? "0" : "1";

  $("#q-spot").textContent =
    `${s.nome} · ${Math.round(s.quota_dem)} m · ${s.bosco}`;

  const [nomeLim] = NOMI_FATTORI[oggi.limitante];
  $("#q-lim").innerHTML = q >= 7
    ? `Tutti i fattori sono allineati. Il più debole resta <strong>${esc(nomeLim.toLowerCase())}</strong>.`
    : `Fattore che frena di più: <strong>${esc(nomeLim.toLowerCase())}</strong>.`;

  const p = sp.picco, d = sp.giorni_al_picco;
  $("#q-peak").innerHTML = !p ? "" :
    d <= 0 ? `Il picco previsto è <strong>oggi</strong> (${p.q.toFixed(1).replace(".", ",")}).`
    : `Meglio fra <strong>${d} giorni</strong>: ${esc(dow(p.data))} ${gg(p.data)}, `
      + `punteggio ${p.q.toFixed(1).replace(".", ",")}.`;

  $("#clima").innerHTML = rigaClima(s);

  // strip
  const max = Math.max(1, ...sp.prossimi.map((x) => x.q));
  $("#strip").innerHTML = sp.prossimi.map((x, i) => `
    <div class="day${i === 0 ? " is-today" : ""}">
      <div class="day-dow">${esc(dow(x.data))}</div>
      <div class="day-num">${esc(gg(x.data))}</div>
      <div class="day-bar"><div class="day-fill"
        style="height:${Math.max(4, (x.q / max) * 46)}px;background:${coloreQ(x.q)}"></div></div>
      <div class="day-q" style="color:${coloreQ(x.q)}">${x.q.toFixed(1).replace(".", ",")}</div>
    </div>`).join("");

  // fattori
  // `ospite` non ha un peso: moltiplica il risultato, quindi in ordine
  // d'importanza viene per primo.
  const pesi = stato.dati.meta.modello.pesi;
  const rilievo = (k) => pesi[k] ?? 1;
  $("#fattori").innerHTML = Object.entries(oggi.fattori)
    .sort((a, b) => rilievo(b[0]) - rilievo(a[0]))
    .map(([k, v]) => {
      const [nome, sub] = NOMI_FATTORI[k];
      return `<div class="fat${k === oggi.limitante ? " is-lim" : ""}">
        <div class="fat-name">${esc(nome)}<small>${esc(sub)}</small></div>
        <div class="fat-track"><div class="fat-fill" style="width:${(v * 100).toFixed(0)}%"></div></div>
        <div class="fat-val">${v.toFixed(2).replace(".", ",")}</div>
      </div>`;
    }).join("") + dettagliOggi(oggi);

  renderClassifica();
}

/** Il cumulato in millimetri da solo non dice niente: 39 mm sono tanti o
 *  pochi? La risposta e' il confronto con gli stessi 60 giorni degli ultimi
 *  anni, ed e' l'informazione che spiega il punteggio meglio di ogni altra. */
function rigaClima(s) {
  const c = s.clima;
  if (!c) return "";
  const pct = c.rapporto == null ? null : Math.round(c.rapporto * 100);
  const grave = c.percentile <= 20;
  const posizione = c.anni_piu_secchi === 0
    ? `i più secchi degli ultimi ${c.anni} anni`
    : `più secchi di ${c.anni - c.anni_piu_secchi} anni su ${c.anni}`;

  return `<div class="clima${grave ? " is-grave" : ""}">
    <b>${c.pioggia_ora.toFixed(0)} mm</b> negli ultimi ${c.finestra_giorni} giorni,
    contro una norma di <b>${c.pioggia_norma.toFixed(0)} mm</b>${pct == null ? ""
      : ` — il <b>${pct}%</b>`}.
    Sono ${posizione} (storico ${c.pioggia_min.toFixed(0)}–${c.pioggia_max.toFixed(0)} mm).
    ${c.temp_scarto == null ? "" : `Temperatura ${c.temp_scarto > 0 ? "sopra" : "sotto"}
      la media di <b>${Math.abs(c.temp_scarto).toFixed(1)} °C</b>.`}
  </div>`;
}

function dettagliOggi(o) {
  const d = o.dettagli, n = (x, u) => x == null ? "n/d" : `${String(x).replace(".", ",")} ${u}`;
  return `<p class="muted small" style="margin-top:.6rem">
    Pioggia nella finestra di innesco ${n(d.mm_finestra, "mm")} (massimo ${n(d.mm_max_3gg, "mm")} in 3 giorni) ·
    ultimi 7 giorni ${n(d.mm_7gg, "mm")} · 60 giorni ${n(d.mm_60gg, "mm")} ·
    suolo ${d.suolo == null ? "n/d" : String(d.suolo).replace(".", ",") + " m³/m³"} ·
    temperatura ${n(d.t, "°C")} (${esc(d.fonte || "n/d")}) ·
    vento ${n(d.vento, "km/h")} · evapotraspirazione ${n(d.et0, "mm/g")}
    ${d.rh_stazione == null ? ""
      : `· umidità misurata dalla stazione ${d.rh_stazione}%`}
    ${d.bosco == null ? ""
      : `· bosco prevalente ${esc(d.bosco)}, affinità ${String(d.affinita).replace(".", ",")}`}
  </p>`;
}

function renderClassifica() {
  const righe = stato.dati.spots
    .map((s) => ({ s, q: s.specie[stato.specie].oggi?.q ?? 0 }))
    .sort((a, b) => b.q - a.q);

  $("#classifica").innerHTML = righe.map(({ s, q }) => `
    <button class="rank${s.id === stato.spot.id ? " is-on" : ""}" data-id="${esc(s.id)}" type="button">
      <span class="rank-n">${esc(s.nome)}<small>${Math.round(s.quota_dem)} m · ${esc(s.bosco)}</small></span>
      <span class="pill">${esc(s.specie[stato.specie].oggi?.etichetta || "")}</span>
      <span class="rank-q" style="color:${coloreQ(q)}">${q.toFixed(1).replace(".", ",")}</span>
    </button>`).join("");

  $$("#classifica .rank").forEach((b) => b.addEventListener("click", () => {
    stato.spot = stato.dati.spots.find((s) => s.id === b.dataset.id);
    $("#sel-spot").value = stato.spot.id;
    renderPrevisione();
    if (stato.mappa) disegnaMappa();
    scrollTo({ top: 0, behavior: "smooth" });
  }));
}

// ==========================================================================
// Vista: mappa
//
// Gli strati vengono da sorgenti aperte, non dai server di qualcun altro:
//   Boschi   Corine Land Cover 2018 (EEA), WMS pubblico
//   Pioggia  radar RainViewer, libero e senza chiave
//   Crescita e Meteo Funghi sono dati nostri, gia' in data/
// ==========================================================================

const CORINE = "https://image.discomap.eea.europa.eu/arcgis/services/Corine/CLC2018_WM/MapServer/WMSServer";

/* Sentieri segnati CAI, da OpenStreetMap via scripts/sentieri.py.
   Disegnati come linee e non come tessere: lo strato a tessere di Waymarked
   Trails si ferma allo zoom 16, e oltre le sigle diventano illeggibili
   proprio quando servono. Le linee restano nitide a ogni zoom e si cliccano.
   Il file pesa 288 KB, quindi si carica solo alla prima accensione. */
const ZOOM_SIGLE = 13;   // sotto, le etichette sarebbero un groviglio
const MAX_SIGLE = 60;    // quante sigle al massimo tenere insieme in pagina

/* Un canvas solo per tutto il disegno vettoriale.
   Con il renderer SVG di Leaflet ogni tratto e ogni cella diventano un
   elemento nel DOM, che il browser riproietta a ogni spostamento: i soli
   sentieri ne facevano piu' di mille, e la mappa diventava inusabile.
   Su canvas sono pennellate, non nodi. */
let TELA = null;
const tela = () => (TELA = TELA || L.canvas({ padding: 0.3 }));
const PUNTI_PER_SIGLA = 70;   // ogni quanti punti ripetere la sigla.
                              // A 25 il tracciato diventava una collana di
                              // etichette attaccate e non si leggeva la mappa.

const BASI = {
  osm: ["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "&copy; OpenStreetMap", 19],
  topo: ["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
         "&copy; OpenTopoMap (CC-BY-SA)", 17],
};

function avviaMappa() {
  if (stato.mappa) { setTimeout(() => stato.mappa.invalidateSize(), 60); return; }

  stato.mappa = L.map("map", { scrollWheelZoom: true, zoomControl: false })
    .setView([41.95, 13.12], 11);
  L.control.zoom({ position: "bottomright" }).addTo(stato.mappa);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(stato.mappa);
  aggiungiControlli();

  cambiaBase("osm");
  // Duecento kilobyte di punti d'interesse: si chiedono alla prima apertura
  // della mappa, non all'avvio del sito.
  montaPoi();

  // Boschi: il WMS non manda header CORS, ma per un tile layer non servono -
  // sono immagini, non fetch.
  //
  // maxNativeZoom non e' un dettaglio: oltre lo zoom 11 il servizio EEA
  // smette di disegnare e restituisce una tessera con scritto "Zoom Level
  // Not Supported", che finiva dritta sulla mappa. Cosi' invece Leaflet
  // ingrandisce l'ultimo livello buono - sgranato, ma e' una mappa di
  // copertura del suolo, non una foto: la sgranatura e' onesta, visto che
  // il dato originale ha celle da 100 m.
  stato.strati.boschi = L.tileLayer.wms(CORINE, {
    layers: "12", format: "image/png", transparent: true, version: "1.3.0",
    opacity: 0.7, maxNativeZoom: 11, maxZoom: 19,
    attribution: "Corine Land Cover 2018 &copy; EEA",
  });

  $$("#pannello .sw").forEach((sw) => sw.addEventListener("change", () => {
    accendiStrato(sw.dataset.strato, sw.checked);
  }));
  $("#op-boschi").addEventListener("input", (e) => {
    stato.strati.boschi.setOpacity(e.target.value / 100);
  });
  $$("#pannello .basi .chip").forEach((b) => b.addEventListener("click", () => {
    $$("#pannello .basi .chip").forEach((x) => x.classList.toggle("is-on", x === b));
    cambiaBase(b.dataset.base);
  }));
  $("#pannello-tog").addEventListener("click", () =>
    $("#pannello").classList.toggle("is-chiuso"));

  $("#pannello-chiudi").addEventListener("click", () =>
    $("#pannello").classList.add("is-chiuso"));

  $("#legenda-tog").addEventListener("click", (e) => {
    const aperta = e.currentTarget.getAttribute("aria-expanded") === "true";
    e.currentTarget.setAttribute("aria-expanded", String(!aperta));
    $("#legenda-corpo").hidden = aperta;
  });

  // Sul telefono il pannello parte chiuso: aperto coprirebbe la mappa, che e'
  // la ragione per cui si e' su questa schermata.
  if (matchMedia("(max-width: 700px)").matches) $("#pannello").classList.add("is-chiuso");

  disegnaCrescita();
  accendiStrato("crescita", true);
  aggiornaFonteMappa();
}

/* Solo pulsanti che fanno qualcosa: un cluster pieno di icone inerti e' peggio
   di un cluster corto. */
function aggiungiControlli() {
  const Cluster = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const d = L.DomUtil.create("div", "mappa-cluster");
      const bottoni = [
        ["⌖", "Dove sono", () => stato.mappa.locate({ setView: true, maxZoom: 14 })],
        ["⛶", "Schermo intero", () => {
          const el = $(".mappa-scena");
          if (document.fullscreenElement) document.exitFullscreen();
          else el.requestFullscreen?.().catch(() => {});
          setTimeout(() => stato.mappa.invalidateSize(), 250);
        }],
        ["⟲", "Torna sulle zone", () => stato.mappa.setView([41.95, 13.12], 11)],
      ];
      for (const [ic, titolo, fn] of bottoni) {
        const b = L.DomUtil.create("button", "", d);
        b.type = "button"; b.textContent = ic;
        b.title = titolo; b.setAttribute("aria-label", titolo);
        L.DomEvent.on(b, "click", L.DomEvent.stop).on(b, "click", fn);
      }
      L.DomEvent.disableClickPropagation(d);
      return d;
    },
  });
  new Cluster().addTo(stato.mappa);

  stato.mappa.on("locationerror", () =>
    $("#map-src").textContent = "Posizione non disponibile: permesso negato o GPS assente.");
}

function cambiaBase(quale) {
  const [url, attr, maxZoom] = BASI[quale];
  if (stato.base) stato.mappa.removeLayer(stato.base);
  stato.base = L.tileLayer(url, { maxZoom, attribution: attr }).addTo(stato.mappa);
  stato.base.setZIndex(0);
}

async function accendiStrato(nome, acceso) {
  const m = stato.mappa;
  if (nome === "pioggia" && acceso && !stato.strati.pioggia) {
    if (!await preparaPioggia()) { $("#radar-ora").textContent = "non disponibile"; return; }
  }
  if (nome === "pioggia") { if (acceso) avviaPioggia(); else fermaPioggia(); }
  if (nome === "sentieri" && acceso && !stato.strati.sentieri) {
    await disegnaSentieri();
  }
  if (nome === "mf" && acceso && !stato.strati.mf) disegnaMF();
  if (nome === "confine" && acceso && !stato.strati.confine) disegnaConfine();
  if (nome === "antenne") {
    if (acceso && !stato.strati.antenne) await disegnaAntenne();
    // fermaAntenne anche quando lo strato non si e' disegnato: se il GPS era
    // acceso va spento comunque.
    if (acceso) avviaAntenne(); else fermaAntenne();
  }

  const l = stato.strati[nome];
  if (!l) return;
  if (acceso) { l.addTo(m); if (l.setZIndex) l.setZIndex(nome === "boschi" ? 1 : 2); }
  else m.removeLayer(l);

  // Le sigle seguono i sentieri: restare appese a uno strato spento sarebbe
  // solo peso e confusione.
  if (nome === "sentieri") {
    if (acceso) aggiornaSigle();
    else if (stato.strati.sigle) m.removeLayer(stato.strati.sigle);
  }
  aggiornaFonteMappa();
}

// ==========================================================================
// Cosa c'e' sul territorio
//
// Due elenchi diversi, tenuti separati di proposito:
//
//   data/poi.json      luoghi presi da OpenStreetMap - rifugi, fontane, vette,
//                      parcheggi. Aperto, verificabile, si aggiorna da solo.
//   data/servizi.json  recapiti di maneggi, noleggi, scuole di sci. Scritti a
//                      mano, e ognuno dichiara quanto vale la sua posizione.
//
// I secondi si disegnano con un'icona quadrata e i primi con un pallino: a
// colpo d'occhio si capisce che sono due cose diverse, e chi cerca un numero
// di telefono non finisce su una fontana.
//
// Tutto si carica alla prima apertura della mappa, non all'avvio del sito:
// sono duecento kilobyte che a chi guarda solo la previsione non servono.
// ==========================================================================

let POI = null, SERV = null;
let poiMontati = false;
const STRATI_POI = {};        // chiave categoria -> layer acceso

const COLORE_POI = {
  visita: "#2563eb", rifugi: "#b45309", dormire: "#7c3aed", campeggi: "#0d9488",
  mangiare: "#dc2626", picnic: "#16a34a", acqua: "#0ea5e9", vette: "#7c2d12",
  grotte: "#475569", cascate: "#0891b2", parcheggi: "#334155",
  ricarica: "#0f766e", trasporti: "#64748b",
};

const telLink = (n) =>
  `<a href="tel:${esc(String(n).replace(/[^0-9+]/g, ""))}">${esc(n)}</a>`;

async function montaPoi() {
  if (poiMontati) return;
  poiMontati = true;
  const [p, sv] = await Promise.all([
    carica("poi").catch((e) => { console.warn("poi:", e.message); return null; }),
    carica("servizi").catch((e) => { console.warn("servizi:", e.message); return null; }),
  ]);
  POI = p; SERV = sv;
  costruisciGriglia();
  disegnaConfine();
}

/* Le caselle si costruiscono dai dati, non a mano nell'HTML: cosi' il numero
   fra parentesi e' sempre quello vero e non una promessa scaduta. */
function costruisciGriglia() {
  const g = $("#poi-griglia");
  if (!g) return;
  const pezzi = [];

  const casella = (chiave, icona, nome, n) => `
    <label class="poi-v${n ? "" : " is-vuota"}">
      <input type="checkbox" class="sw-poi" data-poi="${esc(chiave)}"${n ? "" : " disabled"}>
      <i aria-hidden="true">${icona}</i>
      <span>${esc(nome)}</span>
      <b>${n}</b>
    </label>`;

  if (POI?.punti) {
    const n = {};
    POI.punti.forEach((p) => { n[p.c] = (n[p.c] || 0) + 1; });
    pezzi.push(`<div class="poi-tit">Sul territorio <small>OpenStreetMap</small></div>
      <div class="poi-caselle">`
      + Object.entries(POI.categorie)
          .map(([k, c]) => casella("p:" + k, c.icona, c.nome, n[k] || 0)).join("")
      + `</div>`);
  }

  if (SERV?.servizi) {
    const n = {};
    SERV.servizi.forEach((v) => {
      if (v.lat != null) n[v.cat] = (n[v.cat] || 0) + 1;
    });
    pezzi.push(`<div class="poi-tit">Sport, noleggi e servizi <small>con recapiti</small></div>
      <div class="poi-caselle">`
      + Object.entries(SERV.categorie)
          .map(([k, c]) => casella("s:" + k, c.icona, c.nome, n[k] || 0)).join("")
      + `</div>`);
  }

  g.innerHTML = pezzi.join("") || `<p class="muted small">Elenchi non disponibili.</p>`;
  $$("#poi-griglia .sw-poi").forEach((c) =>
    c.addEventListener("change", () => accendiPoi(c.dataset.poi, c.checked)));
}

function accendiPoi(chiave, acceso) {
  if (!stato.mappa) return;
  if (!STRATI_POI[chiave]) STRATI_POI[chiave] = creaStratoPoi(chiave);
  const l = STRATI_POI[chiave];
  if (!l) return;
  if (acceso) l.addTo(stato.mappa);
  else stato.mappa.removeLayer(l);
  aggiornaFonteMappa();
}

function creaStratoPoi(chiave) {
  const [tipo, cat] = chiave.split(":");
  return tipo === "p" ? stratoOsm(cat) : stratoServizi(cat);
}

function stratoOsm(cat) {
  if (!POI?.punti) return null;
  const colore = COLORE_POI[cat] || "#475569";
  const etichetta = POI.categorie[cat]?.nome || cat;
  const g = L.layerGroup();

  for (const p of POI.punti) {
    if (p.c !== cat) continue;
    const t = p.t || {};
    const righe = [];
    if (t.ele) righe.push(`${Math.round(+t.ele)} m`);
    if (t.street) righe.push(esc(t.street + (t.housenumber ? " " + t.housenumber : "")));
    if (t.city) righe.push(esc(t.city));
    if (t.opening_hours) righe.push(esc(t.opening_hours));
    if (t.description) righe.push(esc(t.description));
    const tel = t.phone ? `<div>${telLink(t.phone)}</div>` : "";
    // rel="noopener": un link che apre una scheda nuova le lascia altrimenti
    // un riferimento a questa pagina, ed e' un appiglio in piu' per chi
    // volesse manometterla dall'altra parte.
    const web = t.website && /^https?:\/\//.test(t.website)
      ? `<div><a href="${esc(t.website)}" target="_blank" rel="noopener noreferrer">sito</a></div>`
      : "";

    L.circleMarker([p.lat, p.lon], {
      renderer: tela(), radius: 6, weight: 2, color: "#fff", opacity: 0.9,
      fillColor: colore, fillOpacity: 0.95,
    }).bindPopup(
      `<b>${esc(p.n)}</b><br><span class="pop-cat">${esc(etichetta)}</span>`
      + (righe.length ? `<br>${righe.join(" &middot; ")}` : "") + tel + web
    ).addTo(g);
  }
  return g;
}

function stratoServizi(cat) {
  if (!SERV?.servizi) return null;
  const c = SERV.categorie[cat] || { nome: cat, icona: "\u2022" };
  const g = L.layerGroup();

  for (const v of SERV.servizi) {
    if (v.cat !== cat || v.lat == null) continue;
    const tel = (v.tel || []).map(telLink).join(" &middot; ");
    const mail = v.email
      ? `<div><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></div>` : "";
    // Un punto trovato solo per paese non e' un indirizzo: dirlo evita che
    // qualcuno guidi fino a un pallino e non trovi niente.
    const avviso = v.precisione === "localita"
      ? `<div class="pop-avviso">Posizione approssimata: solo la localit&agrave;
         (${esc(v.zona || "")})</div>` : "";

    L.marker([v.lat, v.lon], {
      icon: L.divIcon({ className: "poi-serv",
                        html: `<span>${c.icona}</span>`, iconSize: null }),
    }).bindPopup(
      `<b>${esc(v.nome)}</b><br><span class="pop-cat">${esc(c.nome)}</span>`
      + (v.note ? `<br>${esc(v.note)}` : "")
      + (v.indirizzo ? `<br>${esc(v.indirizzo)}` : "")
      + (tel ? `<div>${tel}</div>` : "") + mail + avviso
    ).addTo(g);
  }
  return g;
}

/* Il confine dell'area protetta: una linea sola, sotto tutto il resto.
   Riempirla di verde coprirebbe i boschi, che sono l'informazione vera. */
function disegnaConfine() {
  if (!POI?.confine?.length || stato.strati.confine) return;
  stato.strati.confine = L.layerGroup(POI.confine.map((anello) =>
    L.polyline(anello, { renderer: tela(), color: "#15803d", weight: 2.5,
                         opacity: 0.85, dashArray: "6 4", interactive: false })));
  const sw = $('#pannello .sw[data-strato="confine"]');
  if (sw?.checked) stato.strati.confine.addTo(stato.mappa);
}

// ==========================================================================
// Pioggia in movimento
//
// Una fotografia del radar dice se piove adesso; non dice da dove arriva ne'
// dove sara' fra un'ora, che e' la domanda di chi deve decidere se uscire.
// Quindi la pioggia si guarda scorrere, su una linea del tempo sola:
//
//   da -2 ore a +30 minuti   radar RainViewer, misurato, un fotogramma ogni
//                            dieci minuti (il "nowcast" e' estrapolazione del
//                            radar stesso, non un modello)
//   da +1 a +24 ore          griglia oraria di Open-Meteo, scaricata in CI e
//                            disegnata come campo continuo
//
// Le due meta' hanno natura diversa e la scritta lo dice: sopra c'e' cio' che
// e' stato visto, sotto cio' che e' previsto. Spacciarle per la stessa cosa
// sarebbe comodo e falso.
// ==========================================================================

/* Scala della pioggia in mm/h, sui colori del radar RainViewer: cosi' le due
   meta' dell'animazione non cambiano lingua a meta' strada. */
const RAIN_SCALA = [[0.1, [140, 214, 255]], [1, [61, 155, 214]],
                    [4, [31, 95, 168]], [10, [140, 59, 168]], [25, [190, 40, 110]]];
const RAIN_MS = 420;          // durata di un fotogramma
const RAIN_PAUSA_FINE = 3;    // fotogrammi di sosta prima di ricominciare

function coloreP(mm) {
  if (mm <= RAIN_SCALA[0][0]) return RAIN_SCALA[0][1];
  for (let i = 1; i < RAIN_SCALA.length; i++) {
    const [x1, c1] = RAIN_SCALA[i - 1], [x2, c2] = RAIN_SCALA[i];
    if (mm <= x2) {
      const t = (mm - x1) / (x2 - x1);
      return c1.map((c, j) => Math.round(c + (c2[j] - c) * t));
    }
  }
  return RAIN_SCALA[RAIN_SCALA.length - 1][1];
}

const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const rosa = (g) => ROSA[Math.round((((g % 360) + 360) % 360) / 22.5) % 16];

let PIOGGIA = null;

/** Costruisce la linea del tempo. Torna false se non c'e' niente da mostrare:
 *  meglio dirlo che lasciare acceso uno strato vuoto. */
async function preparaPioggia() {
  const P = { frames: [], i: 0, timer: null, sosta: 0, corrente: null,
              gruppo: L.layerGroup(), prev: null };

  try {
    const d = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
    for (const f of [...(d.radar?.past || []), ...(d.radar?.nowcast || [])]) {
      // Il radar gratuito di RainViewer copre fino allo zoom 7: da 8 in su
      // restituisce sempre la stessa immagine con scritto "Zoom Level Not
      // Supported", che finiva dritta sulla mappa. Con maxNativeZoom Leaflet
      // ingrandisce l'ultimo livello con dati veri: sgranato, ma la domanda a
      // cui deve rispondere - sta piovendo sulla zona? - regge lo stesso.
      P.frames.push({ t: f.time * 1000, misurato: true,
                      url: `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` });
    }
  } catch (e) {
    console.warn("radar non disponibile:", e.message);
  }

  try {
    const pv = await carica("pioggia_prev");
    P.prev = pv;
    const ultimoRadar = P.frames.length ? P.frames[P.frames.length - 1].t : 0;
    pv.ore.forEach((iso, k) => {
      // Le ore sono UTC senza suffisso: senza la Z il browser le leggerebbe
      // come ora locale e d'estate l'animazione salterebbe indietro di due ore.
      const t = Date.parse(iso + "Z");
      // Dove c'e' il radar il radar vince: e' misura, non previsione.
      if (t > ultimoRadar) P.frames.push({ t, misurato: false, k });
    });
  } catch (e) {
    console.warn("previsione di pioggia non disponibile:", e.message);
  }

  if (!P.frames.length) return false;
  P.frames.sort((a, b) => a.t - b.t);

  // Si parte da adesso, non da due ore fa: il primo sguardo deve rispondere
  // "sta piovendo?", il resto lo racconta l'animazione.
  const ora = Date.now();
  const i0 = P.frames.findIndex((f) => f.t >= ora);
  P.i = i0 < 0 ? P.frames.length - 1 : i0;

  PIOGGIA = P;
  stato.strati.pioggia = P.gruppo;

  const sl = $("#rain-sl");
  sl.max = String(P.frames.length - 1);
  sl.value = String(P.i);
  sl.addEventListener("input", () => { fermaTimer(); mostraFrame(+sl.value); });
  $("#rain-play").addEventListener("click", () => (P.timer ? fermaTimer() : avviaTimer()));
  return true;
}

function stratoFrame(f) {
  if (f.layer) return f.layer;
  if (f.url) {
    f.layer = L.tileLayer(f.url, { opacity: 0, maxNativeZoom: 7, maxZoom: 19,
                                   attribution: "Radar &copy; RainViewer" });
  } else {
    const g = PIOGGIA.prev, mm = g.mm[f.k], n = g.lon.length;
    f.layer = campoOverlay(
      g.lat, g.lon,
      (iy, ix) => mm[iy * n + ix],
      coloreP,
      // Sotto il decimo di millimetro non e' pioggia, e' rumore del modello:
      // colorarlo stenderebbe un velo azzurro su tutta la provincia.
      (v) => (v < 0.1 ? 0 : Math.min(0.72, 0.2 + v * 0.35)),
      480);
    f.layer.setOpacity(0);
  }
  return f.layer;
}

function mostraFrame(i) {
  const P = PIOGGIA;
  if (!P) return;
  P.i = ((i % P.frames.length) + P.frames.length) % P.frames.length;
  const f = P.frames[P.i];

  const l = stratoFrame(f);
  if (!P.gruppo.hasLayer(l)) P.gruppo.addLayer(l);
  if (P.corrente && P.corrente !== l) P.corrente.setOpacity(0);
  l.setOpacity(f.misurato ? 0.68 : 0.62);
  P.corrente = l;

  const d = new Date(f.t);
  const ore = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const dm = Math.round((f.t - Date.now()) / 60000);
  const quando = Math.abs(dm) < 8 ? "adesso"
    : dm < 0 ? `${-dm} min fa`
    : dm < 90 ? `fra ${dm} min` : `fra ${Math.round(dm / 60)} h`;
  $("#radar-ora").textContent =
    `${ore} \u00b7 ${quando} \u00b7 ${f.misurato ? "radar" : "previsto"}`;
  $("#rain-sl").value = String(P.i);

  // "Verso dove va": il vento si misura da dove viene, quindi la direzione del
  // moto e' l'opposta. Senza girarla la freccia indicherebbe il contrario.
  const v = P.prev;
  if (v?.vento_da?.length) {
    const k = Math.min(v.vento_da.length - 1, Math.max(0,
      Math.round((f.t - Date.parse(v.ore[0] + "Z")) / 3600000)));
    $("#rain-vento").textContent =
      `In arrivo da ${rosa(v.vento_da[k])}, si sposta verso `
      + `${rosa(v.vento_da[k] + 180)} a ${v.vento_kmh[k]} km/h`;
  }
}

function avviaTimer() {
  const P = PIOGGIA;
  if (!P || P.timer) return;
  $("#rain-play").textContent = "\u275a\u275a";
  P.timer = setInterval(() => {
    // Sull'ultimo fotogramma si resta fermi un momento: senza la sosta il ciclo
    // riparte cosi' in fretta che sembra uno sfarfallio.
    if (P.i === P.frames.length - 1 && P.sosta < RAIN_PAUSA_FINE) { P.sosta++; return; }
    P.sosta = 0;
    mostraFrame(P.i + 1);
  }, RAIN_MS);
}

function fermaTimer() {
  const P = PIOGGIA;
  if (!P?.timer) return;
  clearInterval(P.timer);
  P.timer = null;
  $("#rain-play").textContent = "\u25b6";
}

function avviaPioggia() { mostraFrame(PIOGGIA?.i ?? 0); avviaTimer(); }

/* Fermare il timer quando lo strato si spegne non e' pignoleria: un
   setInterval che continua a scambiare opacita' su layer staccati dalla mappa
   e' lavoro per il browser e batteria per chi guarda. */
function fermaPioggia() { fermaTimer(); }

/* Griglia nazionale di Meteo Funghi: 820 celle da 0,2 gradi su tutta Italia.
   Si costruisce solo alla prima accensione, perche' ottocento cerchi disegnati
   sempre rallentano la mappa anche quando lo strato e' spento. */
/* I sentieri sono due passate di linea: una chiara e spessa sotto che fa da
   bordo, una rossa sottile sopra. Senza il bordo, una traccia rossa sopra il
   verde del bosco o l'arancione del Corine sparisce. */
async function disegnaSentieri() {
  let d;
  try {
    d = await fetch("data/sentieri.json", { cache: "force-cache" }).then((r) => r.json());
  } catch (e) {
    $("#map-src").textContent = "Sentieri non disponibili: " + (e.message || e);
    return;
  }

  const gruppo = L.layerGroup();
  SIGLE = [];

  for (const p of d.percorsi) {
    for (const linea of p.linee) {
      if (linea.length < 2) continue;

      // Una linea intera per tracciato, non un layer per tratto: prima erano
      // due polilinee ogni settanta punti, cioe' centinaia di oggetti in piu'
      // senza che si vedesse alcuna differenza.
      // Due passate: bordo chiaro sotto, rosso sopra. Senza il bordo il rosso
      // sparisce sul verde del bosco.
      L.polyline(linea, { renderer: tela(), color: "#ffffff", weight: 5,
                          opacity: 0.75, lineCap: "round",
                          interactive: false }).addTo(gruppo);
      L.polyline(linea, { renderer: tela(), color: "#d3352b", weight: 2.4,
                          opacity: 0.95, dashArray: "7 5", lineCap: "round" })
        .addTo(gruppo)
        .bindPopup(`<b>${esc(p.ref || "")}</b><br>${esc(p.nome || "senza nome")}`);

      // Le posizioni delle sigle si calcolano una volta e si tengono da parte.
      // I riquadri veri si creano solo per quelli che entrano nella vista.
      if (p.ref) {
        for (let k = Math.floor(PUNTI_PER_SIGLA / 2); k < linea.length;
             k += PUNTI_PER_SIGLA) {
          SIGLE.push({ ll: linea[k], ref: p.ref });
        }
      }
    }
  }

  stato.strati.sentieri = gruppo;
  stato.strati.sigle = L.layerGroup();
  stato.mappa.on("zoomend moveend", aggiornaSigle);
  aggiornaSigle();
}

/* Le sigle si ricreano a ogni spostamento, ma solo per il pezzo di mappa che
   si sta guardando e solo da un certo zoom in su. Tenerle tutte appese - piu'
   di trecento - costava a ogni pan, e sotto lo zoom 13 non si leggevano
   comunque perche' si accavallavano. */
function aggiornaSigle() {
  const g = stato.strati.sigle;
  if (!g) return;
  g.clearLayers();

  if (stato.mappa.getZoom() < ZOOM_SIGLE) {
    stato.mappa.removeLayer(g);
    return;
  }

  const vista = stato.mappa.getBounds();
  let n = 0;
  for (const s of SIGLE) {
    if (n >= MAX_SIGLE) break;
    if (!vista.contains(s.ll)) continue;
    L.marker(s.ll, {
      interactive: false,
      icon: L.divIcon({ className: "sent-sigla", html: `<span>${esc(s.ref)}</span>`,
                        iconSize: null }),
    }).addTo(g);
    n++;
  }

  // Il gruppo delle sigle sta sulla mappa solo se ci sono i sentieri.
  if (stato.mappa.hasLayer(stato.strati.sentieri)) g.addTo(stato.mappa);
}

/* Meteo Funghi come campo continuo, non come pallini.
 *
 * La griglia e' regolare, 0,2 gradi: il modo giusto di renderla e'
 * interpolarla, non disegnare un cerchio per cella. Ottocentoventi pallini
 * dicono "ecco dove ho misurato"; una macchia sfumata dice "ecco dove
 * crescono", che e' la domanda vera.
 *
 * Niente libreria di heatmap: quelle stimano una densita' di punti, mentre
 * qui il valore e' gia' dato su una griglia. Si disegna a mano con
 * interpolazione bilineare e si appoggia come immagine sulla mappa.
 */
function campoOverlay(lats, lons, val, colore, alfa, W = 640) {
  const latMin = lats[0], latMax = lats[lats.length - 1];
  const lonMin = lons[0], lonMax = lons[lons.length - 1];

  // Si lavora in Mercatore, non in gradi: su parecchi gradi di latitudine
  // stirare l'immagine linearmente sposterebbe le macchie di chilometri
  // rispetto alla mappa sotto.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const invMerc = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  const yTop = merc(latMax), yBot = merc(latMin);
  const H = Math.max(1, Math.round(W * (yTop - yBot) / ((lonMax - lonMin) * Math.PI / 180)));

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);

  for (let py = 0; py < H; py++) {
    const lat = invMerc(yTop - (yTop - yBot) * (py + 0.5) / H);
    const fy = (lat - latMin) / (latMax - latMin) * (lats.length - 1);
    const iy = Math.min(lats.length - 2, Math.max(0, Math.floor(fy)));
    const ty = Math.min(1, Math.max(0, fy - iy));

    for (let px = 0; px < W; px++) {
      const lon = lonMin + (lonMax - lonMin) * (px + 0.5) / W;
      const fx = (lon - lonMin) / (lonMax - lonMin) * (lons.length - 1);
      const ix = Math.min(lons.length - 2, Math.max(0, Math.floor(fx)));
      const tx = Math.min(1, Math.max(0, fx - ix));

      // Fuori dalla terraferma la griglia ha buchi: se manca anche un solo
      // angolo la cella resta trasparente, invece di inventare un valore.
      const a = val(iy, ix), b = val(iy, ix + 1),
            c = val(iy + 1, ix), e = val(iy + 1, ix + 1);
      const o = (py * W + px) * 4;
      if (a == null || b == null || c == null || e == null) continue;

      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
      const op = alfa(v);
      if (op <= 0) continue;
      const [r, g, bl] = colore(v);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl;
      img.data[o + 3] = Math.round(255 * Math.min(1, op));
    }
  }
  ctx.putImageData(img, 0, 0);

  return L.imageOverlay(cv.toDataURL("image/png"),
    [[latMin, lonMin], [latMax, lonMax]], { opacity: 1, interactive: false });
}

function disegnaMF() {
  const mf = stato.dati.mf;
  if (!mf || !mf.punti) return;

  const lats = [...new Set(mf.punti.map((p) => p.lat))].sort((a, b) => a - b);
  const lons = [...new Set(mf.punti.map((p) => p.lon))].sort((a, b) => a - b);
  const q = new Map(mf.punti.map((p) => [`${p.lat}|${p.lon}`, p.q]));

  stato.strati.mf = campoOverlay(
    lats, lons,
    (iy, ix) => q.get(`${lats[iy]}|${lons[ix]}`) ?? null,
    coloreQrgb,
    // I valori bassi sfumano invece di stendere un velo grigio su mezza
    // Italia: sotto l'1 non c'e' niente da segnalare.
    (v) => Math.min(1, Math.max(0, (v - 0.6) / 3)) * 0.72);
}

function disegnaCrescita() {
  if (stato.strati.crescita) stato.mappa.removeLayer(stato.strati.crescita);

  const st = stato.dati.stazione;
  if (!st) { stato.strati.crescita = null; return; }

  stato.strati.crescita = L.layerGroup([
    L.marker([st.lat, st.lon]).bindPopup(
      `<b>${esc(st.nome)}</b><br>Stazione al suolo · ${st.quota} m<br>
       ${st.temp ?? "?"} °C · ${st.umidita ?? "?"}% · pioggia mese ${st.pioggia_mese ?? "?"} mm`),
  ]);

  const sw = $('#pannello .sw[data-strato="crescita"]');
  if (sw && sw.checked) stato.strati.crescita.addTo(stato.mappa);
}

/* Legenda: mostra solo gli strati accesi, e per ognuno la sua scala. Una
   legenda fissa che spiega cose spente confonde piu' di quanto aiuti. */
const LEGENDA = {
  boschi: () => `<b>Copertura del suolo</b>
    <div class="lg-voci">${[
      ["#80ff00", "Bosco di latifoglie"],
      ["#00a600", "Bosco di conifere"],
      ["#4dff00", "Bosco misto"],
      ["#a6f200", "Cespuglieto e bosco in transizione"],
      ["#ccf24d", "Prateria naturale"],
      ["#e6e6e6", "Pascolo"],
      ["#ffffa8", "Seminativo"],
      ["#e6004d", "Area urbana"],
    ].map(([c, n]) => `<span class="lg-v"><i style="background:${c}"></i>${n}</span>`).join("")}</div>
    <small>Corine Land Cover 2018, celle da 100 m</small>`,
  pioggia: () => `<b>Pioggia</b>
    <div class="lg-voci">${RAIN_SCALA.map(([mm, c]) =>
      `<span class="lg-v"><i style="background:rgb(${c.join(",")})"></i>${
        String(mm).replace(".", ",")} mm/h</span>`).join("")}</div>
    <small>Fino a +30 minuti e' radar misurato, dopo e' modello previsto</small>`,
  confine: () => `<b>Confine del Parco</b>
    <div class="lg-voci"><span class="lg-v"><i style="background:#15803d"></i>
      Perimetro dell'area protetta</span></div>`,
  crescita: () => `<b>Stazione al suolo</b>
    <div class="lg-voci"><span class="lg-v"><i style="background:#3388ff"></i>
      Monte Livata, misure vere</span></div>`,
  mf: () => `<b>Meteo Funghi</b>
    <div class="lg-barra"></div>
    <div class="lg-estremi"><span>0 &middot; irrilevante</span><span>10 &middot; molto favorevole</span></div>`,
  antenne: () => `<b>Antenne</b>
    <div class="lg-voci">
      <span class="lg-v"><i style="background:#0369a1"></i>Telefonia mobile dichiarata</span>
      <span class="lg-v"><i style="background:#7dd3fc"></i>Comunicazione, tipo non specificato</span>
    </div>
    <small>I cerchi sono raggi <strong>stimati</strong> &mdash; 1,2 km in paese,
      2,5 km fuori &mdash; non copertura misurata. Il pallino verde è dove sei,
      secondo il GPS. Nessun browser può leggere la cella agganciata: quella
      indicata è solo la più vicina in linea d'aria.</small>`,
};

function aggiornaFonteMappa() {
  const accesi = [...$$("#pannello .sw")].filter((s) => s.checked).map((s) => s.dataset.strato);

  const corpo = accesi.filter((k) => LEGENDA[k]).map((k) => `<div class="lg-b">${LEGENDA[k]()}</div>`).join("");
  const leg = $("#legenda-corpo");
  leg.innerHTML = corpo
    || `<p class="muted small" style="margin:0">Niente da spiegare: gli strati
        accesi non hanno una scala di colori.</p>`;
  $(".mappa-legenda").hidden = false;

  const nomi = accesi.map((k) => $(`#pannello .sw[data-strato="${k}"]`)
    .closest(".strato").querySelector(".strato-nome").textContent.trim());
  $("#map-src").textContent = nomi.length
    ? "Strati attivi: " + nomi.join(" · ") : "Nessuno strato attivo.";
}

/** Chiamata quando cambia zona o specie: ridisegna solo i nostri marcatori. */
function disegnaMappa() { if (stato.mappa) disegnaCrescita(); }

// ==========================================================================
// Antenne
//
// Va detto prima di tutto il resto, perche' e' il punto: una pagina web NON
// puo' sapere a quale cella e' agganciato il telefono. Non esiste un'API che
// lo permetta. navigator.connection arriva al massimo a effectiveType ("4g"),
// che e' una stima di velocita' della connessione, non l'identita' di una
// cella: niente cell ID, niente LAC/TAC, niente PCI, niente eNB, nemmeno il
// nome dell'operatore. Quei valori li legge solo un'app Android nativa
// tramite TelephonyManager, con i permessi concessi a mano. Da qui dentro,
// mai.
//
// Cio' che si puo' fare onestamente, ed e' cio' che c'e' qui: prendere la
// posizione dal GPS, prendere i tralicci censiti in OpenStreetMap, e dire
// quale sta piu' vicino in linea d'aria. Quando cambia si segna l'ora. Non e'
// un handover: e' la geometria che cambia. Il telefono puo' benissimo restare
// agganciato all'antenna di prima, perche' a decidere e' il livello di
// segnale, e in montagna il segnale lo decide il rilievo - un crinale in
// mezzo zittisce una cella a due chilometri e ne lascia passare una a
// quindici.
//
// Per lo stesso motivo i cerchi restano cerchi: due raggi dichiarati, presi
// sull'ordine di grandezza tipico di una macrocella - stretta dove le celle
// sono fitte, cioe' in paese, larga dove sono rade. Non sono misurati, non
// sono una promessa di campo, e il fumetto di ogni antenna lo ripete.
// ==========================================================================

// Raggi disegnati, in metri. 1 = il traliccio sta dentro un centro abitato
// (lo decide scripts/antenne.py confrontandolo con i place di OSM).
const ANT_RAGGIO_M = { 1: 1200, 0: 2500 };

// Sotto questo scarto le due antenne si equivalgono e non si cambia: con due
// pali quasi equidistanti il rumore del GPS li farebbe scambiare a ogni
// battito e l'elenco si riempirebbe di passaggi che non sono successi.
const ANT_ISTERESI_M = 100;

const ANT_MAX_STORICO = 8;

let ANT = null;             // data/antenne.json, caricato alla prima accensione
let antVigilanza = null;    // id di watchPosition, null quando il GPS e' spento
let antVicina = null;       // l'antenna piu' vicina adesso (l'oggetto, non una copia)
let antStorico = [];        // ultimi cambi, il piu' recente in testa
let antIo = null;           // il pallino di dove si e'

/* Distanza in metri. Leaflet ha distanceTo, ma qui la stessa posizione si
   confronta con tutte le antenne a ogni battito del GPS: costruire cinquanta
   LatLng al secondo per poi buttarli e' spreco. Piano con correzione del
   coseno: su queste distanze l'errore e' sotto il metro. */
function antMetri(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111320;
  const dx = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) * Math.PI / 360);
  return Math.hypot(dx, dy);
}

/* Le coordinate abbreviate in coda distinguono due pali dello stesso gestore:
   senza, l'elenco dei passaggi direbbe "da Vodafone a Vodafone". */
function antNome(a) {
  const base = a.n || a.op
    || (a.t === "mobile" ? "Traliccio di telefonia" : "Traliccio di comunicazione");
  return `${base} (${a.lat.toFixed(3)}, ${a.lon.toFixed(3)})`;
}

function antFumetto(a, raggio) {
  const righe = [];
  if (a.op) righe.push(`Gestore dichiarato in OSM: ${esc(a.op)}`);
  // esc() anche qui: oggi antenne.py garantisce un numero, ma il giorno in
  // cui quel filtro cambiasse, il campo arriverebbe grezzo da OSM - dove
  // scrive chiunque nel mondo - dritto dentro innerHTML.
  if (a.h) righe.push(`Alto ${esc(String(a.h).replace(".", ","))} m`);
  righe.push(`Cerchio disegnato: ${String(raggio / 1000).replace(".", ",")} km, stimato`);

  return `<b>${esc(antNome(a))}</b>
    <br><span class="pop-cat">${a.t === "mobile"
      ? "telefonia mobile dichiarata in OSM"
      : "telecomunicazioni, tipo non specificato"}</span>
    <br>${righe.join("<br>")}
    <div class="pop-avviso">Il cerchio non è copertura misurata, e questa
      non è l'antenna a cui sei connesso: quale cella ti stia servendo
      il browser non lo può sapere.</div>`;
}

async function disegnaAntenne() {
  if (!ANT) {
    ANT = await carica("antenne").catch((e) => {
      console.warn("antenne:", e.message);
      return null;
    });
  }
  if (!ANT?.antenne?.length) return;

  const g = L.layerGroup();
  for (const a of ANT.antenne) {
    const raggio = ANT_RAGGIO_M[a.ab ? 1 : 0];

    // L.circle e non circleMarker: questo deve valere metri sul terreno, non
    // pixel sullo schermo, altrimenti ingrandendo la mappa il "raggio
    // operativo" resterebbe un bollino delle stesse dimensioni.
    // interactive:false perche' i cerchi si sovrappongono: cliccabili,
    // ruberebbero il clic al pallino dell'antenna che sta sotto.
    L.circle([a.lat, a.lon], {
      renderer: tela(), radius: raggio, interactive: false,
      color: "#0ea5e9", weight: 1, opacity: 0.45,
      fillColor: "#0ea5e9", fillOpacity: 0.05,
    }).addTo(g);

    L.circleMarker([a.lat, a.lon], {
      renderer: tela(), radius: 5, weight: 2, color: "#fff", opacity: 0.9,
      fillColor: a.t === "mobile" ? "#0369a1" : "#7dd3fc", fillOpacity: 0.95,
    }).bindPopup(antFumetto(a, raggio)).addTo(g);
  }
  stato.strati.antenne = g;
}

function antScrivi(nome, sotto) {
  const n = $("#ant-nome"), d = $("#ant-dist");
  if (n) n.textContent = nome;
  if (d) d.textContent = sotto || "";
}

function antElenco() {
  const el = $("#ant-log");
  if (!el) return;
  el.innerHTML = antStorico.length
    ? antStorico.map((r) => `<div class="ant-r">alle <b>${esc(r.ora)}</b>
        la più vicina è cambiata da ${esc(r.da)} a ${esc(r.a)}</div>`).join("")
    : `<p class="ant-nulla">Nessun cambio finora.</p>`;
}

function antAggiorna(pos) {
  if (!ANT?.antenne?.length) return;
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;

  let piu = null, dmin = Infinity;
  for (const a of ANT.antenne) {
    const d = antMetri(lat, lon, a.lat, a.lon);
    if (d < dmin) { dmin = d; piu = a; }
  }
  if (!piu) return;

  // Isteresi: si lascia vincere la nuova solo se guadagna abbastanza.
  let scelta = piu, dScelta = dmin;
  if (antVicina) {
    const dOra = antMetri(lat, lon, antVicina.lat, antVicina.lon);
    if (dOra - dmin < ANT_ISTERESI_M) { scelta = antVicina; dScelta = dOra; }
  }

  if (antVicina !== scelta) {
    // Alla prima lettura antVicina e' null: non e' un cambio, e' l'inizio.
    if (antVicina) {
      antStorico.unshift({
        ora: new Date().toLocaleTimeString("it-IT",
          { hour: "2-digit", minute: "2-digit" }),
        da: antNome(antVicina), a: antNome(scelta),
      });
      antStorico = antStorico.slice(0, ANT_MAX_STORICO);
    }
    antVicina = scelta;
    antElenco();
  }

  // Il pallino di dove si e', appeso allo strato: cosi' sparisce da solo
  // quando lo strato si spegne, senza doverlo rincorrere.
  if (!antIo) {
    antIo = L.circleMarker([lat, lon], {
      renderer: tela(), radius: 6, weight: 3, color: "#fff",
      fillColor: "#16a34a", fillOpacity: 1,
    }).bindPopup("Sei qui, secondo il GPS.");
    if (stato.strati.antenne) antIo.addTo(stato.strati.antenne);
  } else {
    antIo.setLatLng([lat, lon]);
  }

  antScrivi(antNome(scelta),
    `${Math.round(dScelta)} m in linea d'aria`
    + (acc ? ` · GPS ±${Math.round(acc)} m` : ""));
}

function avviaAntenne() {
  const box = $("#ant-vivo");
  if (box) box.hidden = false;
  antElenco();

  if (!ANT?.antenne?.length) {
    antScrivi("Nessuna antenna nei dati.",
      "Lancia python scripts/antenne.py per generare data/antenne.json.");
    return;
  }
  if (antVigilanza !== null) return;          // gia' in ascolto
  if (!navigator.geolocation) {
    antScrivi("GPS non disponibile.", "Questo browser non espone la posizione.");
    return;
  }

  antScrivi("In attesa del GPS…", "");
  antVigilanza = navigator.geolocation.watchPosition(
    antAggiorna,
    (e) => antScrivi(
      e.code === e.PERMISSION_DENIED
        ? "Permesso di posizione negato." : "Posizione non disponibile.",
      "Senza posizione non si può dire quale antenna sia la più vicina."),
    // maximumAge basso perche' in auto una posizione di mezzo minuto fa e'
    // gia' a un chilometro da qui, e sarebbe l'antenna sbagliata.
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

/* Un watchPosition dimenticato acceso tiene il GPS al lavoro e svuota la
   batteria di chi e' in giro per boschi - cioe' proprio chi usa questo sito.
   Si spegne appena lo strato si spegne o si lascia la vista mappa. */
function fermaAntenne() {
  if (antVigilanza !== null) {
    navigator.geolocation.clearWatch(antVigilanza);
    antVigilanza = null;
  }
  if (antIo) {
    stato.strati.antenne?.removeLayer(antIo);
    antIo = null;
  }
  antVicina = null;
  const box = $("#ant-vivo");
  if (box) box.hidden = true;
}

// ==========================================================================
// Vista: specie
//
// Il contenuto sta in guida.js. Qui c'e' solo il disegno, il filtro per
// habitat e la ricerca. Caricato a richiesta: chi non apre la guida non
// scarica il testo.
// ==========================================================================
let specieMontate = false;
let SP = null;
let CREDITI = {};

/* Quali confusioni hanno una foto. La chiave e' un pezzo del nome scritto in
   guida.js: si cerca per sottostringa perche' li' i nomi sono discorsivi
   ("Amanita phalloides e Amanita verna", "Uova di Amanita"). */
const SOSIA_FOTO = {
  "phalloides": "x-phalloides",
  "verna": "x-verna",
  "uova": "x-verna",
  "galerina": "x-galerina",
  "omphalotus": "x-omphalotus",
  "entoloma": "x-entoloma",
  "xanthodermus": "x-xanthodermus",
  "clitocybe": "x-clitocybe",
  "scleroderma": "x-scleroderma",
};

async function montaSpecie() {
  if (specieMontate) return;
  specieMontate = true;

  SP = await import("./guida.js");
  // I crediti sono un obbligo di licenza, non un dettaglio: se non arrivano
  // le foto non si mostrano.
  CREDITI = await fetch("assets/specie/crediti.json").then((r) => r.json()).catch(() => ({}));

  $("#sp-filtri").innerHTML =
    `<button class="sp-f is-on" data-h="all" type="button">Tutte</button>`
    + Object.entries(SP.HABITAT)
        .map(([k, n]) => `<button class="sp-f" data-h="${esc(k)}" type="button">${esc(n)}</button>`)
        .join("");

  $("#sp-griglia").innerHTML = SP.SPECIE.map(tesseraSpecie).join("");

  $$("#sp-filtri .sp-f").forEach((b) => b.addEventListener("click", () => {
    $$("#sp-filtri .sp-f").forEach((x) => x.classList.toggle("is-on", x === b));
    filtraSpecie();
  }));
  $("#sp-q").addEventListener("input", filtraSpecie);

  $$("#sp-griglia .sp-t").forEach((t) =>
    t.addEventListener("click", () => apriSpecie(t.dataset.id)));

  const dlg = $("#sd");
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  $("#sd-chiudi").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => { $("#sd-corpo").innerHTML = ""; });

  // Crediti raccolti in fondo: CC BY e CC BY-SA vogliono l'attribuzione, e
  // sulla tessera quadrata non c'e' spazio per metterla su ogni foto.
  $("#sp-crediti").innerHTML = "Foto: " + Object.entries(CREDITI)
    .map(([k, c]) => `${esc(c.autore || "ignoto")} (${esc(c.licenza || "")})`)
    .filter((v, i, a) => a.indexOf(v) === i).join(" · ")
    + " — via Wikimedia Commons.";
}

/* Tessera quadrata: foto, nome, e il bordo che dice la commestibilita'.
   Sul telefono una scheda per fungo con foto grande e testo occupava mezzo
   schermo a specie: per scorrere quattordici funghi ci voleva un minuto.
   Cosi' si vedono tutti in una schermata, e il dettaglio si apre al tocco. */
function tesseraSpecie(sp) {
  const etichettaHab = SP.HABITAT[sp.habitat] || sp.habitat;
  const [comEt] = SP.COMMESTIBILITA[sp.commestibilita] || ["", ""];
  const cerca = [sp.nome, sp.sci, etichettaHab, comEt].join(" ").toLowerCase();

  return `<button class="sp-t c-${esc(sp.commestibilita)}" type="button"
            data-id="${esc(sp.id)}" data-h="${esc(sp.habitat)}"
            data-cerca="${esc(cerca)}" title="${esc(sp.nome)} — ${esc(comEt)}">
    <img src="assets/specie/${esc(sp.id)}.jpg" alt="" loading="lazy"
         decoding="async" width="720" height="540">
    <span class="sp-t-nome">${esc(sp.nome)}</span>
  </button>`;
}

/* Dettaglio: stessa roba di prima, ma dentro un dialog che sul telefono
   occupa tutto e su schermo largo resta una scheda centrata. */
function apriSpecie(id) {
  const sp = SP.SPECIE.find((x) => x.id === id);
  if (!sp) return;
  const cr = CREDITI[sp.id];
  const [comEt] = SP.COMMESTIBILITA[sp.commestibilita] || ["", ""];
  const ordine = ["mortale", "grave", "lieve", "nessuna"];
  const peggio = ordine.find((g) => sp.confusioni.some((c) => c[1] === g)) || "nessuna";

  $("#sd-corpo").innerHTML = `
    <figure class="sd-foto">
      <img src="assets/specie/${esc(sp.id)}.jpg" alt="${esc(sp.nome)}">
      ${cr ? `<figcaption>${esc(cr.autore || "autore ignoto")} &middot;
        ${esc(cr.licenza || "")}
        <a href="${esc(cr.pagina || "#")}" rel="noopener" target="_blank">Commons</a>
      </figcaption>` : ""}
    </figure>

    <div class="sd-testo">
      <div class="sp-top">
        <span class="pill">${esc(SP.HABITAT[sp.habitat] || sp.habitat)}</span>
        <span class="sp-com sp-com-${esc(sp.commestibilita)}">${esc(comEt)}</span>
      </div>
      <h3 class="sp-nome">${esc(sp.nome)}</h3>
      <em class="sp-sci">${esc(sp.sci)}</em>

      <dl class="sp-dl">
        <dt>Stagione</dt><dd>${esc(sp.stagione)}</dd>
        <dt>Dove</dt><dd>${esc(sp.dove)}</dd>
        <dt>Come si riconosce</dt><dd>${esc(sp.segni)}</dd>
        <dt>In cucina</dt><dd>${esc(sp.consumo)}</dd>
        ${sp.nota ? `<dt>Attenzione</dt><dd>${esc(sp.nota)}</dd>` : ""}
      </dl>

      <h4 class="sd-h4 r-${peggio}">Sosia e confusioni &middot;
        rischio ${esc(SP.GRAVITA[peggio][0].toLowerCase())}</h4>
      <div class="sp-conf" style="display:grid">
        ${sp.confusioni.map(([nome, g, testo]) => {
          const n = nome.toLowerCase();
          const sid = Object.entries(SOSIA_FOTO).find(([k]) => n.includes(k))?.[1] || null;
          const c = sid && CREDITI[sid];
          return `<div class="sp-c sp-c-${esc(g)}">
            ${c ? `<img class="sp-c-foto" src="assets/specie/${esc(sid)}.jpg"
                      alt="${esc(nome)}" loading="lazy"
                      title="${esc(nome)} — ${esc(c.autore || "")} · ${esc(c.licenza || "")}">` : ""}
            <div>
              <b>${esc(nome)}</b>
              <span class="sp-r sp-r-${esc(g)}">${esc(SP.GRAVITA[g][1])}</span>
              <p>${esc(testo)}</p>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  $("#sd").showModal();
}

function filtraSpecie() {
  const h = $("#sp-filtri .sp-f.is-on").dataset.h;
  const q = $("#sp-q").value.trim().toLowerCase();
  let visti = 0;
  $$("#sp-griglia .sp-t").forEach((c) => {
    const ok = (h === "all" || c.dataset.h === h)
            && (!q || c.dataset.cerca.includes(q));
    c.hidden = !ok;
    if (ok) visti++;
  });
  $("#sp-vuoto").hidden = visti > 0;
}

// ==========================================================================
// Vista: webcam
//
// Caricate solo a richiesta: nessun setInterval, nessun polling.
// Vive e spente le decide la CI leggendo Last-Modified (dal browser non si
// puo': quasi nessuna manda header CORS). Quando una stagionale riparte, al
// giro successivo `viva` torna true e risale da sola nella griglia grande.
// ==========================================================================
let camsMontate = false;

const camsVive = () => (stato.dati.webcam?.cam || []).filter((c) => c.viva);
const camsSpente = () => (stato.dati.webcam?.cam || []).filter((c) => !c.viva);

function schedaCam(c, piccola) {
  // sandbox: lo stream e' di terzi e gira in un iframe. Gli si concede lo
  // stretto necessario per riprodurre il video, niente popup, niente moduli,
  // niente accesso al nostro contesto (`allow-same-origin` assente apposta).
  // referrerpolicy: le webcam non hanno bisogno di sapere da quale pagina
  // arrivi la richiesta.
  // L'iframe non riceve i tocchi: se li prendesse lui, la tessera non si
  // aprirebbe mai. Il video si comanda a schermo intero.
  const media = c.iframe
    ? `<iframe class="cam-shot" loading="lazy" allowfullscreen title="${esc(c.nome)}"
         referrerpolicy="no-referrer" tabindex="-1"
         sandbox="allow-scripts allow-presentation"></iframe>`
    : `<img class="cam-shot" alt="${esc(c.nome)}" loading="lazy" decoding="async"
         referrerpolicy="no-referrer">`;
  return `<figure class="cam${piccola ? " is-off" : ""}${c.iframe ? " is-video" : ""}"
            data-id="${esc(c.id)}" tabindex="0" role="button"
            aria-label="${esc(c.nome)} — apri a schermo intero">
      ${media}
      <figcaption class="cam-head">
        <span class="cam-name">${esc(c.nome)}</span>
        <span class="cam-sub">${esc(piccola ? (c.errore || "non attiva") : c.dove)}</span>
      </figcaption>
      <div class="cam-msg"></div>
    </figure>`;
}

function montaCams() {
  if (camsMontate) return;
  if (!stato.dati.webcam) {
    $("#cams").innerHTML = `<p class="muted small">Elenco webcam non disponibile.</p>`;
    return;
  }
  camsMontate = true;

  const vive = camsVive(), spente = camsSpente();
  $("#cams").innerHTML = vive.map((c) => schedaCam(c, false)).join("")
    || `<p class="muted small">Nessuna webcam attiva in questo momento.</p>`;

  $("#cams-off-wrap").hidden = spente.length === 0;
  $("#cams-off").innerHTML = spente.map((c) => schedaCam(c, true)).join("");
  $("#cams-off-n").textContent = spente.length;

  $("#btn-cams").addEventListener("click", aggiornaCams);
  $$("#v-webcam .cam").forEach((fig) => {
    fig.addEventListener("click", () => apriGrande(fig));
    fig.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apriGrande(fig); }
    });
  });
  aggiornaCams();
}

function aggiornaCams() {
  const t = Date.now();
  const perId = Object.fromEntries((stato.dati.webcam.cam || []).map((c) => [c.id, c]));

  $$("#v-webcam .cam").forEach((fig) => {
    const c = perId[fig.dataset.id];
    const el = $(".cam-shot", fig), msg = $(".cam-msg", fig);

    if (c.iframe) { el.src = c.iframe; msg.textContent = "Stream esterno."; return; }

    msg.textContent = c.viva ? "Caricamento…" : (c.errore || "non attiva");
    el.onload = () => { if (c.viva) msg.textContent = "Scaricata ora."; };
    el.onerror = () => { el.dataset.state = "err"; msg.textContent = "Non raggiungibile."; };
    el.src = bust(c.url, t);
  });

  const q = stato.dati.webcam.controllate;
  $("#cam-time").textContent = "Immagini scaricate alle "
    + new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    + (q ? " · stato verificato il " + new Date(q).toLocaleString("it-IT",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
}

/** Ingrandimento a tutto schermo. Per gli stream si chiede il fullscreen
 *  nativo all'iframe; per le immagini basta il dialog a tutta finestra, che
 *  funziona anche dove l'API Fullscreen e' bloccata (iOS in primis). */
function apriGrande(fig) {
  const id = fig.dataset.id;
  const c = (stato.dati.webcam.cam || []).find((x) => x.id === id);
  if (!c) return;

  if (c.iframe) {
    const fr = $(".cam-shot", fig);
    if (fr.requestFullscreen) fr.requestFullscreen().catch(() => {});
    return;
  }

  const dlg = $("#lb");
  $("#lb-img").src = $(".cam-shot", fig).src;   // gia' scaricata: nessun nuovo giro
  $("#lb-title").textContent = c.nome;
  $("#lb-sub").textContent = c.viva ? c.dove : (c.errore || "non attiva");
  dlg.showModal();
}

function avviaLightbox() {
  const dlg = $("#lb");
  // Click fuori dall'immagine = chiudi.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  $("#lb-close").addEventListener("click", () => dlg.close());
  $("#lb-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else dlg.requestFullscreen?.().catch(() => {});
  });
  dlg.addEventListener("close", () => { $("#lb-img").src = ""; });
}

// ==========================================================================
// Vista: meteo
// ==========================================================================
/** La scheda Meteo ha un suo selettore, indipendente da quello della
 *  previsione: qui si viene per guardare i numeri di una zona, non per
 *  cambiare l'analisi. */
function spotMeteo() {
  return stato.dati.spots.find((s) => s.id === $("#sel-meteo").value) || stato.spot;
}

// ==========================================================================
// La linea del tempo
//
// Un giorno non e' una risposta. "Domani 18 gradi e 4 mm" puo' voler dire un
// acquazzone alle sei del mattino e sole tutto il resto, oppure pioggia fine
// dalle otto a sera: per chi deve decidere quando uscire e' la differenza fra
// andarci e non andarci. Quindi le ore si scorrono, e le sette zone si
// aggiornano tutte insieme - cosi' si vede anche DOVE il tempo e' diverso,
// non solo quando.
//
// L'asse dei tempi e' uno solo, condiviso da tutte le zone: lo garantisce
// build_data.py, che rifiuta di scrivere il file se una zona torna con ore
// diverse dalle altre.
// ==========================================================================

let ORARIO = null;
let oraSel = 0;
let oraTimer = null;
const ORA_MS = 260;          // un'ora ogni quarto di secondo

async function montaOrario() {
  if (ORARIO === null) {
    ORARIO = await carica("orario").catch((e) => {
      console.warn("meteo orario:", e.message);
      return false;
    });
  }
  const wrap = $(".linea-wrap");
  if (!ORARIO) { if (wrap) wrap.hidden = true; return; }
  if (wrap) wrap.hidden = false;

  const sl = $("#linea-sl");
  if (sl.max !== String(ORARIO.ore.length - 1)) {
    sl.max = String(ORARIO.ore.length - 1);
    // Si parte dall'ora corrente, non dall'inizio del file: la prima domanda
    // e' sempre "adesso", il resto lo si cerca trascinando.
    oraSel = indiceOraCorrente();
    sl.value = String(oraSel);
    disegnaGiorni();
    sl.addEventListener("input", () => { fermaOre(); mostraOra(+sl.value); });
    $("#linea-play").addEventListener("click", () => (oraTimer ? fermaOre() : avviaOre()));
  }
  mostraOra(oraSel);
}

/* Le ore del file sono locali e senza fuso ("2026-09-10T17:00"): confrontarle
   come testo con l'ora locale di adesso evita di passare per Date, che su
   quelle stringhe assume comportamenti diversi da browser a browser. */
function indiceOraCorrente() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const adesso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
  const i = ORARIO.ore.indexOf(adesso);
  if (i >= 0) return i;
  // Se l'ora esatta non c'e' (file vecchio di qualche ora) si prende la prima
  // successiva, e in mancanza l'ultima disponibile.
  const dopo = ORARIO.ore.findIndex((o) => o >= adesso);
  return dopo >= 0 ? dopo : ORARIO.ore.length - 1;
}

/* La striscia dei giorni: ogni giorno largo quanto le ore che contiene, cosi'
   il primo e l'ultimo - che spesso sono spezzoni - non mentono sulla loro
   durata. */
function disegnaGiorni() {
  const conteggio = new Map();
  for (const o of ORARIO.ore) {
    const g = o.slice(0, 10);
    conteggio.set(g, (conteggio.get(g) || 0) + 1);
  }
  const tot = ORARIO.ore.length;
  const oggi = new Date().toISOString().slice(0, 10);
  $("#linea-giorni").innerHTML = [...conteggio].map(([g, n]) => {
    const d = giorno(g);
    return `<span class="lg-g${g === oggi ? " is-oggi" : ""}"
      style="flex:0 0 ${(100 * n / tot).toFixed(3)}%">
      <b>${DOW[d.getUTCDay()]}</b><span>${g.slice(8, 10)}</span></span>`;
  }).join("");
}

function mostraOra(i) {
  if (!ORARIO) return;
  oraSel = Math.max(0, Math.min(ORARIO.ore.length - 1, i));
  const sl = $("#linea-sl");
  sl.value = String(oraSel);

  const iso = ORARIO.ore[oraSel];
  const d = giorno(iso.slice(0, 10));
  const testa = `${DOW[d.getUTCDay()]} ${iso.slice(8, 10)}, ${iso.slice(11, 16)}`;

  const b = $("#linea-bolla");
  b.textContent = testa;
  // La bolla insegue il cursore. Il 2% di margine ai lati tiene conto della
  // pallina del cursore, che non arriva mai al bordo esatto della pista.
  const f = ORARIO.ore.length > 1 ? oraSel / (ORARIO.ore.length - 1) : 0;
  b.style.left = `calc(${(2 + f * 96).toFixed(2)}% )`;

  const adesso = indiceOraCorrente();
  b.classList.toggle("is-adesso", oraSel === adesso);

  $("#ora-zone").innerHTML = stato.dati.spots.map((s) => {
    const z = ORARIO.zone[s.id];
    if (!z) return "";
    const [ic, desc] = MET ? MET.tempo(z.cod[oraSel]) : ["", ""];
    const mm = z.mm[oraSel], prob = z.prob[oraSel];
    return `<div class="oz${s.id === stato.spot.id ? " is-sel" : ""}"
                 data-spot="${esc(s.id)}" title="${esc(desc)}">
      <div class="oz-n">${esc(s.nome)}</div>
      <div class="oz-i">${ic}</div>
      <div class="oz-t">${z.t[oraSel] == null ? "&ndash;"
        : Math.round(z.t[oraSel]) + "&deg;"}</div>
      <div class="oz-d">
        ${mm > 0 ? `<span class="oz-mm">${mm.toFixed(1).replace(".", ",")} mm</span>`
                 : `<span class="muted">${prob == null ? "" : prob + "%"}</span>`}
        <span class="muted">${z.vento[oraSel] == null ? "" : z.vento[oraSel] + " km/h"}</span>
      </div>
    </div>`;
  }).join("");

  $$("#ora-zone .oz").forEach((el) => el.addEventListener("click", () => {
    const s = stato.dati.spots.find((x) => x.id === el.dataset.spot);
    if (!s) return;
    stato.spot = s;
    $("#sel-spot").value = s.id;
    $("#sel-meteo").value = s.id;
    renderMeteo();
    renderPrevisione();
  }));
}

function avviaOre() {
  if (oraTimer || !ORARIO) return;
  $("#linea-play").textContent = "\u275a\u275a";
  oraTimer = setInterval(() => {
    if (oraSel >= ORARIO.ore.length - 1) { fermaOre(); return; }
    mostraOra(oraSel + 1);
  }, ORA_MS);
}

function fermaOre() {
  if (!oraTimer) return;
  clearInterval(oraTimer);
  oraTimer = null;
  $("#linea-play").textContent = "\u25b6";
}

function renderMeteo() {
  const s = spotMeteo();
  $("#meteo-zona").textContent = `${s.nome} · ${Math.round(s.quota_dem)} m`;
  $("#meteo-zona2").textContent = s.nome;
  // La stazione parla solo per le zone che le stanno intorno.
  $("#staz-wrap").hidden = !(stato.dati.stazione && s.rh_stazione != null);
  renderStazione();
  renderPrevisioniMeteo(s);
  renderConfrontoZone();
  renderStatModello(s);
  renderFonti(s);
  renderChart(s);
}


/* ---------- previsione meteo ----------
   Nessun connettore meteo di mezzo: e' lo stesso dato Open-Meteo gia'
   scaricato in CI per il modello, con in piu' codice del tempo, probabilita'
   di pioggia e raffiche. La tabella dei codici sta in meteo.js e si carica
   solo quando si apre la scheda. */
let SIGLE = [];   // posizioni gia' calcolate delle sigle dei sentieri
let MET = null;

async function caricaMeteoLib() {
  if (!MET) MET = await import("./meteo.js");
  return MET;
}

function renderPrevisioniMeteo(s) {
  if (!MET) return;
  const m = s.meteo, i0 = OGGI_I(s);
  if (i0 < 0 || !m.codice) { $("#previsioni").innerHTML = ""; return; }

  const fine = Math.min(m.giorni.length, i0 + 16);
  const righe = [];
  for (let i = i0; i < fine; i++) {
    const [ic, testo] = MET.tempo(m.codice[i]);
    const p = m.prob_pioggia?.[i];
    righe.push(`<div class="pv-g${i === i0 ? " is-oggi" : ""}">
      <div class="pv-d"><b>${i === i0 ? "Oggi" : esc(dow(m.giorni[i]))}</b>
        <span>${esc(gg(m.giorni[i]))}</span></div>
      <div class="pv-ic" title="${esc(testo)}">${ic}</div>
      <div class="pv-t"><b>${Math.round(m.tmax[i])}&deg;</b>
        <span>${Math.round(m.tmin[i])}&deg;</span></div>
      <div class="pv-p">
        ${p == null ? "" : `<span class="pv-prob${p >= 50 ? " is-alta" : ""}">${p}%</span>`}
        ${m.pioggia[i] > 0
          ? `<span class="pv-mm">${m.pioggia[i].toFixed(1).replace(".", ",")} mm</span>` : ""}
      </div>
      <div class="pv-v">${Math.round(m.vento[i])}<small> km/h ${esc(MET.bussola(m.vento_dir?.[i]))}</small>
        ${m.raffica?.[i] ? `<small class="pv-raf">raffiche ${Math.round(m.raffica[i])}</small>` : ""}
      </div>
    </div>`);
  }

  $("#previsioni").innerHTML = righe.join("")
    + `<p class="muted small" style="margin:.7rem 0 0">
        Alba ${esc(MET.ora(m.alba?.[i0]))} &middot; tramonto ${esc(MET.ora(m.tramonto?.[i0]))}.
        Open-Meteo sulle coordinate della zona, ${Math.round(s.quota_dem)} m.
      </p>`;
}

/* Tutte le zone a confronto per oggi: la domanda vera non e' "che tempo fa",
   e' "dove conviene andare". */
function renderConfrontoZone() {
  if (!MET) return;
  const sel = spotMeteo();
  $("#confronto").innerHTML = stato.dati.spots.map((s) => {
    const i = OGGI_I(s), m = s.meteo;
    if (i < 0) return "";
    const [ic, testo] = MET.tempo(m.codice?.[i]);
    const q = s.specie[stato.specie].oggi?.q ?? 0;
    return `<button class="cz-r${s.id === sel.id ? " is-on" : ""}"
              data-id="${esc(s.id)}" type="button">
      <span class="cz-n">${esc(s.nome)}<small>${Math.round(s.quota_dem)} m</small></span>
      <span class="cz-i" title="${esc(testo)}">${ic}</span>
      <span class="cz-t">${Math.round(m.tmax[i])}&deg;<small>${Math.round(m.tmin[i])}&deg;</small></span>
      <span class="cz-p">${m.prob_pioggia?.[i] ?? "&ndash;"}%</span>
      <span class="cz-q" style="color:${coloreQ(q)}">${q.toFixed(1).replace(".", ",")}</span>
    </button>`;
  }).join("");

  $$("#confronto .cz-r").forEach((b) => b.addEventListener("click", () => {
    $("#sel-meteo").value = b.dataset.id;
    renderMeteo();
  }));
}

const ETICHETTE_FONTI = {
  modello:  ["Modello operativo", "previsione corrente, parte passata"],
  era5:     ["ERA5", "rianalisi, cella ~25 km"],
  alta_ris: ["Alta risoluzione", "archivio previsioni, cella più fine"],
};

function renderFonti(s) {
  const f = s.pioggia_fonti;
  if (!f || !f.totali_per_fonte) { $("#fonti").innerHTML = ""; return; }
  const tot = f.totali_per_fonte;
  const vals = Object.values(tot);
  const spread = Math.max(...vals) - Math.min(...vals);
  const minTot = Math.min(...vals);

  $("#fonti").innerHTML = Object.entries(tot)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const [nome, sub] = ETICHETTE_FONTI[k] || [k, ""];
      return `<div class="obs"><div class="obs-k">${esc(nome)}</div>
        <div class="obs-v">${v.toFixed(0)} <small>mm</small></div>
        <div class="obs-sub">${esc(sub)}</div></div>`;
    }).join("")
    + `<p class="muted small" style="grid-column:1/-1;margin:.2rem 0 0">
        Totali sul periodo passato. Divergenza fra la più asciutta e la più
        piovosa: <strong>${spread.toFixed(0)} mm</strong>${minTot > 0
          ? `, cioè il ${Math.round(100 * spread / minTot)}% della più bassa` : ""}.
        ${f.giorni_fusi} giorni fusi, scarto medio giornaliero
        ${String(f.scarto_medio ?? "n/d").replace(".", ",")} mm (massimo
        ${String(f.scarto_max ?? "n/d").replace(".", ",")} mm).
      </p>`;
}

const OGGI_I = (s) => s.meteo.giorni.indexOf(stato.dati.giorno);

function _sommaUltimi(arr, i, n) {
  return arr.slice(Math.max(0, i - n + 1), i + 1)
            .reduce((a, v) => a + (v ?? 0), 0);
}

function renderStatModello(s) {
  const m = s.meteo, i = OGGI_I(s);
  if (i < 0) { $("#stat-modello").innerHTML = ""; return; }
  const val = [
    ["Massima oggi", m.tmax[i], "°C"],
    ["Minima oggi", m.tmin[i], "°C"],
    ["Media oggi", m.tmedia[i], "°C"],
    ["Umidità relativa", m.umidita?.[i], "%"],
    ["Vento max", m.vento[i], "km/h"],
    ["Pioggia oggi", m.pioggia[i], "mm"],
    ["Pioggia 7 giorni", _sommaUltimi(m.pioggia, i, 7), "mm"],
    ["Pioggia 30 giorni", _sommaUltimi(m.pioggia, i, 30), "mm"],
    ["Pioggia 60 giorni", _sommaUltimi(m.pioggia, i, 60), "mm"],
    ["Umidità del suolo", m.suolo_umidita?.[i], "m³/m³"],
    ["Temperatura suolo", m.suolo_temp?.[i], "°C"],
  ];
  const num = (v) => v == null ? "n/d"
    : (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1)).replace(/\.?0+$/, "").replace(".", ",");

  $("#stat-modello").innerHTML = val.map(([k, v, u]) => `
    <div class="obs"><div class="obs-k">${esc(k)}</div>
      <div class="obs-v">${num(v)} <small>${esc(u)}</small></div></div>`).join("")
    + `<p class="muted small" style="grid-column:1/-1;margin:.2rem 0 0">
        Open-Meteo interpolato su ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} ·
        ${esc(s.bosco)}${s.bias_pioggia && s.bias_pioggia !== 1
          ? ` · pioggia riscalata ×${String(s.bias_pioggia).replace(".", ",")} sulla stazione` : ""}
        ${s.approssimata ? " · ⚠ posizione approssimativa, da confermare" : ""}
      </p>`;
}

function renderStazione() {
  const st = stato.dati.stazione;
  if (!st) { $("#stazione").innerHTML = `<p class="muted small">Stazione non raggiungibile.</p>`; return; }
  const obs = [
    ["Temperatura", st.temp, "°C"], ["Umidità", st.umidita, "%"],
    ["Pioggia oggi", st.pioggia_oggi, "mm"], ["Pioggia mese", st.pioggia_mese, "mm"],
    ["Pioggia anno", st.pioggia_anno, "mm"], ["Vento", st.vento_kmh, "km/h"],
    ["Raffica max", st.raffica_kmh, "km/h"], ["Punto di rugiada", st.dew_point, "°C"],
    ["Pressione", st.pressione, "mb"],
  ];
  $("#stazione").innerHTML = obs.map(([k, v, u]) => `
    <div class="obs"><div class="obs-k">${esc(k)}</div>
      <div class="obs-v">${v == null ? "n/d" : String(v).replace(".", ",")} <small>${esc(u)}</small></div>
    </div>`).join("")
    + `<p class="muted small" style="grid-column:1/-1;margin:.2rem 0 0">
        ${esc(st.nome)} · ${st.quota} m · ${esc(st.strumento || "")} ·
        aggiornata ${esc(st.aggiornamento || "n/d")} ·
        <a href="${esc(st.url)}" rel="noopener">Rete Meteo Lazio</a>
      </p>`;
}

/** Grafico combinato pioggia/temperatura, SVG scritto a mano: una libreria
 *  per due serie sarebbe piu' peso che codice. */
function renderChart(s) {
  const m = s.meteo;
  const oggiIdx = OGGI_I(s);
  const da = Math.max(0, oggiIdx - 30);
  const gi = m.giorni.slice(da), pi = m.pioggia.slice(da), te = m.tmedia.slice(da);

  const W = Math.max(620, gi.length * 14), H = 230, P = { t: 12, r: 34, b: 26, l: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxP = Math.max(5, ...pi.map((v) => v ?? 0));
  const tMin = Math.min(...te.filter((v) => v != null)) - 2;
  const tMax = Math.max(...te.filter((v) => v != null)) + 2;

  const x = (i) => P.l + (i + 0.5) * (iw / gi.length);
  const yP = (v) => P.t + ih - (v / maxP) * ih;
  const yT = (v) => P.t + ih - ((v - tMin) / (tMax - tMin)) * ih;
  const bw = Math.max(3, (iw / gi.length) - 3);

  const barre = pi.map((v, i) => v == null || v <= 0 ? "" :
    `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yP(v).toFixed(1)}" width="${bw.toFixed(1)}"
       height="${(P.t + ih - yP(v)).toFixed(1)}" rx="1.5" class="ch-rain"/>`).join("");

  const linea = te.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${yT(v).toFixed(1)}`)
    .filter(Boolean).join(" ");

  const oggiX = x(oggiIdx - da);
  const etichette = gi.map((g, i) => (i % 5 === 0 || i === gi.length - 1)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch-lab" font-size="9"
         text-anchor="middle">${gg(g)}</text>` : "").join("");

  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Pioggia giornaliera e temperatura media">
    <line x1="${P.l}" y1="${P.t + ih}" x2="${W - P.r}" y2="${P.t + ih}" class="ch-asse"/>
    ${barre}
    <polyline points="${linea}" fill="none" class="ch-temp" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${oggiX.toFixed(1)}" y1="${P.t}" x2="${oggiX.toFixed(1)}" y2="${P.t + ih}"
      class="ch-oggi" stroke-dasharray="3 3" stroke-width="1"/>
    <text x="${P.l - 6}" y="${P.t + 8}" class="ch-lab-rain" font-size="9" text-anchor="end">${maxP.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${P.t + ih}" class="ch-lab-rain" font-size="9" text-anchor="end">0</text>
    <text x="${W - P.r + 6}" y="${yT(tMax - 2).toFixed(1)}" class="ch-lab-temp" font-size="9">${(tMax - 2).toFixed(0)}°</text>
    <text x="${W - P.r + 6}" y="${yT(tMin + 2).toFixed(1)}" class="ch-lab-temp" font-size="9">${(tMin + 2).toFixed(0)}°</text>
    ${etichette}
  </svg>`;
}

// ==========================================================================
// Vista: modello
// ==========================================================================
/* ---------- calendario delle buttate ----------
   Le finestre stagionali sono gia' nel modello: qui vengono solo disegnate,
   mese per mese, per rispondere a colpo d'occhio a "quando esce cosa".
   Nessun dato nuovo, solo lo stesso trapezio che usa il punteggio. */

const MESI_BREVI = ["G", "F", "M", "A", "M", "G", "L", "A", "S", "O", "N", "D"];
const MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const doyDa = (m, g) => Math.round(
  (Date.UTC(2001, m - 1, g) - Date.UTC(2001, 0, 1)) / 86400000) + 1;

/** Stesso trapezio del modello: 0 fuori, 1 nel cuore della finestra. */
function trapezio(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

function fattoreStagione(finestre, doy) {
  return Math.max(...finestre.map((f) => {
    const [a, b, c, d] = f.map((s) => doyDa(+s.slice(0, 2), +s.slice(3)));
    return trapezio(doy, a, b, c, d);
  }));
}

/** Per un mese intero vale il giorno migliore: un mese in cui la buttata
 *  parte il 25 e' comunque un mese in cui si va a cercare. */
function stagioneMese(finestre, mese) {
  const giorni = new Date(Date.UTC(2001, mese, 0)).getUTCDate();
  let max = 0;
  for (let g = 1; g <= giorni; g++) max = Math.max(max, fattoreStagione(finestre, doyDa(mese, g)));
  return max;
}

function renderStagioni() {
  const md = stato.dati.meta.modello;
  const oggi = giorno(stato.dati.giorno);
  const meseOra = oggi.getUTCMonth() + 1;

  const intestazione = MESI_BREVI.map((m, i) =>
    `<div class="cal-m${i + 1 === meseOra ? " is-ora" : ""}">${m}</div>`).join("");

  const righe = Object.entries(md.specie).map(([k, v]) => {
    const celle = MESI_BREVI.map((_, i) => {
      const mese = i + 1;
      const f = stagioneMese(v.stagione, mese);
      const cls = f >= 0.99 ? "is-picco" : f > 0.35 ? "is-buono" : f > 0 ? "is-margine" : "";
      const stato_ = f >= 0.99 ? "piena stagione" : f > 0.35 ? "in stagione"
        : f > 0 ? "inizio o fine stagione" : "fuori stagione";
      return `<div class="cal-c ${cls}${mese === meseOra ? " is-ora" : ""}"
        title="${esc(v.nome.split(" (")[0])} — ${MESI_LUNGHI[i]}: ${stato_}"></div>`;
    }).join("");
    return `<div class="cal-nome">${esc(v.nome.split(" (")[0])}</div>
            <div class="cal-riga">${celle}</div>`;
  }).join("");

  $("#calendario").innerHTML = `
    <div class="cal">
      <div class="cal-nome"></div><div class="cal-riga">${intestazione}</div>
      ${righe}
    </div>
    <div class="cal-legenda">
      <span><i class="is-picco"></i> piena stagione</span>
      <span><i class="is-buono"></i> in stagione</span>
      <span><i class="is-margine"></i> inizio o fine</span>
      <span><i></i> fuori stagione</span>
    </div>`;
}

function renderModello() {
  const md = stato.dati.meta.modello;
  $("#pesi").innerHTML = Object.entries(md.pesi)
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const [nome, sub] = NOMI_FATTORI[k];
      return `<div class="peso">
        <b>${esc(nome)}<br><span class="muted small" style="font-weight:400">${esc(sub)}</span></b>
        <div class="fat-track"><div class="fat-fill" style="width:${(v / 0.32 * 100).toFixed(0)}%"></div></div>
        <span class="fat-val">${(v * 100).toFixed(0)}%</span></div>`;
    }).join("");

  $("#pesi").insertAdjacentHTML("beforeend", `<div class="peso">
    <b>Bosco ospite<br><span class="muted small" style="font-weight:400">affinità con gli alberi</span></b>
    <div class="fat-track"><div class="fat-fill" style="width:100%"></div></div>
    <span class="fat-val">×</span></div>
    <p class="muted small" style="margin:.2rem 0 0">
      Il bosco non entra nella media pesata: <strong>moltiplica</strong> il risultato.
      Non è un ingrediente da bilanciare con gli altri, è la frazione di bosco in cui
      quella specie può proprio esistere. Trombette sotto conifera pura: affinità 0,2,
      cioè un quinto del punteggio, per quanto perfetto sia il tempo.</p>`);

  const ordine = ["faggio", "quercia", "castagno", "conifere", "leccio"];
  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu",
                "lug", "ago", "set", "ott", "nov", "dic"];
  const mmdd = (s) => `${+s.slice(3)} ${MESI[+s.slice(0, 2) - 1]}`;
  const periodo = (f) => f.map(([a, b, c, d]) =>
    `${mmdd(b)} – ${mmdd(c)} <span class="muted">(da ${mmdd(a)} a ${mmdd(d)})</span>`)
    .join(" &nbsp;·&nbsp; ");

  $("#specie-info").innerHTML = Object.values(md.specie).map((s) => `
    <div class="sp"><b>${esc(s.nome)}</b>
      <span>Ottimale fra ${s.temp[1]} e ${s.temp[2]} °C (limiti ${s.temp[0]}–${s.temp[3]}) ·
      incubazione ${s.lag[0]}–${s.lag[1]} giorni dopo la pioggia. ${esc(s.note)}</span>
      <span class="stag">Periodo: ${periodo(s.stagione)}</span>
      <div class="ospiti">${ordine.map((a) => `<span class="osp">
        ${esc(a)} <b>${String(s.ospiti[a]).replace(".", ",")}</b></span>`).join("")}</div>
    </div>`).join("");

  $("#zone-bosco").innerHTML = stato.dati.spots.map((s) => `
    <div class="sp"><b>${esc(s.nome)}${s.approssimata ? " ⚠" : ""}</b>
      <span>${Math.round(s.quota_dem)} m · ${esc(s.bosco)}${s.approssimata
        ? " · posizione approssimativa, da confermare" : ""}</span>
      <div class="ospiti">${Object.entries(s.alberi || {})
        .sort((a, b) => b[1] - a[1])
        .map(([a, f]) => `<span class="osp">${esc(a)} <b>${Math.round(f * 100)}%</b></span>`)
        .join("")}</div></div>`).join("");

  const et = { ok: "attiva", errore: "errore", disattivato: "non attiva" };
  $("#sorgenti").innerHTML = Object.entries(stato.dati.meta.sorgenti).map(([k, v]) => {
    const cls = v.stato === "ok" ? "ok" : v.stato === "errore" ? "ko" : "off";
    return `<div class="src"><span><span class="dot ${cls}"></span><b>${esc(k)}</b></span>
      <span>${esc(et[v.stato] || v.stato)}${v.messaggio ? " — " + esc(v.messaggio) : ""}</span></div>`;
  }).join("");
}

// ==========================================================================
// Tab
// ==========================================================================
function attivaTab() {
  $$(".voce[data-view]").forEach((b) => b.addEventListener("click", () => mostraVista(b)));
}

function mostraVista(b) {
  const v = b.dataset.view;
  $$(".voce[data-view]").forEach((x) => x.classList.toggle("is-on", x === b));
  $$(".view").forEach((s) => { s.hidden = s.id !== "v-" + v; });

  // La mappa vuole tutta la finestra: main perde larghezza massima e margini
  // solo mentre e' in vista. Con una classe invece che con :has() perche' il
  // momento del cambio deve essere lo stesso in cui Leaflet ricalcola.
  $("main").classList.toggle("e-mappa", v === "mappa");

  // Il GPS non deve restare acceso mentre si guarda la previsione: chi ha
  // cambiato scheda non sta piu' guardando le antenne, ma la batteria si
  // consumerebbe lo stesso.
  if (v !== "mappa") fermaAntenne();

  if (v === "specie") montaSpecie();
  if (v === "mappa") avviaMappa();
  if (v === "webcam") montaCams();
  if (v === "meteo") caricaMeteoLib().then(() => { renderMeteo(); montaOrario(); });
  // Lo scorrimento delle ore va fermato uscendo dalla scheda: un timer che
  // continua a ridisegnare una vista nascosta e' solo batteria buttata.
  if (v !== "meteo") fermaOre();
}
