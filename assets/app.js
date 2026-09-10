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
  renderFooter();
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
    try {
      const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const d = await r.json();
      const f = d.radar.past[d.radar.past.length - 1];
      // Il radar gratuito di RainViewer copre fino allo zoom 7: da 8 in su
      // restituisce sempre la stessa immagine con scritto "Zoom Level Not
      // Supported", che finiva dritta sulla mappa. Con maxNativeZoom Leaflet
      // ingrandisce l'ultimo livello con dati veri: sgranato, ma la domanda
      // a cui deve rispondere - sta piovendo sulla zona? - regge lo stesso.
      stato.strati.pioggia = L.tileLayer(
        `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0.65, maxNativeZoom: 7, maxZoom: 19,
          attribution: "Radar &copy; RainViewer" });
      $("#radar-ora").textContent = new Date(f.time * 1000)
        .toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      $("#radar-ora").textContent = "non disponibile";
      return;
    }
  }
  if (nome === "sentieri" && acceso && !stato.strati.sentieri) {
    await disegnaSentieri();
  }
  if (nome === "mf" && acceso && !stato.strati.mf) disegnaMF();

  const l = stato.strati[nome];
  if (!l) return;
  if (acceso) { l.addTo(m); if (l.setZIndex) l.setZIndex(nome === "boschi" ? 1 : 2); }
  else m.removeLayer(l);
  aggiornaFonteMappa();
}

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
  for (const p of d.percorsi) {
    for (const linea of p.linee) {
      // Il tracciato si spezza in tratti corti e a ciascuno si attacca la
      // sigla: cosi' il numero si ripete lungo il percorso, come i segnavia
      // veri, invece di comparire una volta sola a meta'.
      // I tooltip li posiziona Leaflet: con i divIcon restavano tutti
      // accatastati nell'angolo della mappa.
      for (let k = 0; k < linea.length - 1; k += PUNTI_PER_SIGLA) {
        const tratto = linea.slice(k, Math.min(k + PUNTI_PER_SIGLA + 1, linea.length));
        if (tratto.length < 2) continue;

        // Due passate: una chiara e spessa che fa da bordo, una rossa sopra.
        // Senza il bordo, il rosso sparisce sul verde del bosco.
        L.polyline(tratto, { color: "#ffffff", weight: 5, opacity: 0.75,
                             lineCap: "round", interactive: false }).addTo(gruppo);
        const l = L.polyline(tratto, { color: "#d3352b", weight: 2.4, opacity: 0.95,
                                       dashArray: "7 5", lineCap: "round" }).addTo(gruppo);

        // Un solo bindTooltip per layer: il secondo sostituisce il primo e la
        // sigla permanente non veniva mai creata. Il nome per esteso passa
        // nel popup, che e' un canale separato.
        l.bindPopup(`<b>${esc(p.ref || "")}</b><br>${esc(p.nome || "senza nome")}`);
        if (p.ref) {
          l.bindTooltip(p.ref, {
            permanent: true, direction: "center", className: "sent-sigla",
          });
        }
      }
    }
  }

  stato.strati.sentieri = gruppo;
  stato.mappa.on("zoomend", aggiornaSigle);
  aggiornaSigle();
}

/* Sotto un certo zoom le sigle si accavallano e non si legge piu' niente:
   meglio nasconderle che stampare un groviglio. Si agisce sul contenitore
   della mappa, cosi' vale anche per i tooltip creati dopo. */
function aggiornaSigle() {
  const mostra = stato.mappa.getZoom() >= ZOOM_SIGLE;
  stato.mappa.getContainer().classList.toggle("senza-sigle", !mostra);
}

function disegnaMF() {
  const mf = stato.dati.mf;
  if (!mf || !mf.punti) return;
  stato.strati.mf = L.layerGroup(mf.punti.map((p) => L.circleMarker([p.lat, p.lon], {
    radius: 7, weight: 0,
    fillOpacity: p.q < 1 ? 0.35 : 0.75,
    fillColor: coloreQ(p.q),
  }).bindPopup(`<b>Meteo Funghi</b><br>`
    + `<span class="pop-q" style="color:${coloreQ(p.q)}">`
    + `${p.q.toFixed(1).replace(".", ",")}</span> su 10`)));
}

function disegnaCrescita() {
  if (stato.strati.crescita) stato.mappa.removeLayer(stato.strati.crescita);
  const marcatori = stato.dati.spots.map((s) => {
    const o = s.specie[stato.specie].oggi, q = o?.q ?? 0;
    // Il raggio non parte da zero e il bordo c'e' sempre: con la siccita'
    // il punteggio e' 0 e il colore diventa grigio, che sopra il verde dello
    // strato boschi sparisce del tutto. Un marcatore che non si vede non
    // dice "punteggio basso", dice "guasto".
    const mk = L.circleMarker([s.lat, s.lon], {
      radius: 10 + q * 0.9,
      weight: s.id === stato.spot.id ? 4 : 2.5,
      className: s.id === stato.spot.id ? "mk mk-sel" : "mk",
      fillOpacity: 0.95, fillColor: coloreQ(q),
    }).bindPopup(`<b>${esc(s.nome)}</b><br>${Math.round(s.quota_dem)} m · ${esc(s.bosco)}<br>
      <span class="pop-q" style="color:${coloreQ(q)}">${q.toFixed(1).replace(".", ",")}</span> su 10
      — ${esc(o?.etichetta || "")}`);
    mk.on("click", () => {
      stato.spot = s; $("#sel-spot").value = s.id; renderPrevisione(); disegnaCrescita();
    });
    return mk;
  });

  const st = stato.dati.stazione;
  if (st) marcatori.push(L.marker([st.lat, st.lon]).bindPopup(
    `<b>${esc(st.nome)}</b><br>Stazione al suolo · ${st.quota} m<br>
     ${st.temp ?? "?"} °C · ${st.umidita ?? "?"}% · pioggia mese ${st.pioggia_mese ?? "?"} mm`));

  stato.strati.crescita = L.layerGroup(marcatori);
  if ($('#pannello .sw[data-strato="crescita"]').checked)
    stato.strati.crescita.addTo(stato.mappa);
}

/* Legenda: mostra solo gli strati accesi, e per ognuno la sua scala. Una
   legenda fissa che spiega cose spente confonde piu' di quanto aiuti. */
const LEGENDA = {
  crescita: () => `<b>Crescita</b>
    <div class="lg-barra"></div>
    <div class="lg-estremi"><span>0 · irrilevante</span><span>10 · molto favorevole</span></div>`,
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
  pioggia: () => `<b>Radar pioggia</b>
    <div class="lg-voci">${[
      ["#8cd6ff", "debole"], ["#3d9bd6", "moderata"],
      ["#1f5fa8", "forte"], ["#8c3ba8", "molto forte"],
    ].map(([c, n]) => `<span class="lg-v"><i style="background:${c}"></i>${n}</span>`).join("")}</div>`,
};

function aggiornaFonteMappa() {
  const accesi = [...$$("#pannello .sw")].filter((s) => s.checked).map((s) => s.dataset.strato);

  const corpo = accesi.filter((k) => LEGENDA[k]).map((k) => `<div class="lg-b">${LEGENDA[k]()}</div>`).join("");
  const leg = $("#legenda-corpo");
  leg.innerHTML = corpo || `<p class="muted small" style="margin:0">Nessuno strato attivo.</p>`;
  $(".mappa-legenda").hidden = false;

  const nomi = accesi.map((k) => $(`#pannello .sw[data-strato="${k}"]`)
    .closest(".strato").querySelector(".strato-nome").textContent.trim());
  $("#map-src").textContent = nomi.length
    ? "Strati attivi: " + nomi.join(" · ") : "Nessuno strato attivo.";
}

/** Chiamata quando cambia zona o specie: ridisegna solo i nostri marcatori. */
function disegnaMappa() { if (stato.mappa) disegnaCrescita(); }

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

function renderFooter() {
  const g = new Date(stato.dati.meta.generato);
  $("#foot-meta").textContent = "Dati generati il "
    + g.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric",
                                  hour: "2-digit", minute: "2-digit" });
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

  if (v === "specie") montaSpecie();
  if (v === "mappa") avviaMappa();
  if (v === "webcam") montaCams();
  if (v === "meteo") caricaMeteoLib().then(renderMeteo);
}
