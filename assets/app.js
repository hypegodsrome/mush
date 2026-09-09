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

const stato = { dati: null, spot: null, specie: "porcino", mappa: null, strati: {} };

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

function apriApp(utente) {
  $("#gate").hidden = true;
  $("#app").hidden = false;
  $("#user").textContent = utente?.email || "modalità sviluppo";
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
  const auth = getAuth(initializeApp(firebaseConfig));
  const provider = new GoogleAuthProvider();
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  // Nessuna lista di indirizzi: entra chiunque abbia un account Google.
  // Il filtro c'era e l'ho tolto invece di lasciarlo con la lista vuota,
  // perche' una copia vecchia del file in cache avrebbe continuato a
  // rifiutare gente per dieci minuti dopo ogni pubblicazione.
  onAuthStateChanged(auth, (u) => (u ? apriApp(u) : mostraGate()));

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
// ==========================================================================
function avviaMappa() {
  if (stato.mappa) { stato.mappa.invalidateSize(); return; }
  stato.mappa = L.map("map", { scrollWheelZoom: false })
    .setView([stato.spot.lat, stato.spot.lon], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, attribution: "&copy; OpenStreetMap",
  }).addTo(stato.mappa);
  $("#sel-layer").addEventListener("change", disegnaMappa);
  disegnaMappa();
}

function disegnaMappa() {
  const m = stato.mappa, quale = $("#sel-layer").value;
  Object.values(stato.strati).forEach((l) => m.removeLayer(l));
  stato.strati = {};

  if (quale === "mf") {
    const mf = stato.dati.mf;
    if (!mf) { $("#map-src").textContent = "Griglia Meteo Funghi non disponibile."; return; }
    const g = L.layerGroup(mf.punti.map((p) => L.circleMarker([p.lat, p.lon], {
      radius: 7, weight: 0, fillOpacity: p.q < 1 ? 0.35 : 0.75, fillColor: coloreQ(p.q),
    }).bindPopup(`<b>Meteo Funghi</b><br><span class="pop-q" style="color:${coloreQ(p.q)}">`
      + `${p.q.toFixed(1).replace(".", ",")}</span> su 10`))).addTo(m);
    stato.strati.mf = g;
    m.setView([42.2, 12.6], 6);
    $("#map-src").innerHTML = `Griglia di ${mf.punti.length} celle da 0,2° · aggiornata `
      + `${esc(mf.aggiornamento || "n/d")} · fonte <a href="${esc(mf.url)}" rel="noopener">meteofunghi.fungocenter.it</a>.`;
    return;
  }

  const g = L.layerGroup(stato.dati.spots.map((s) => {
    const o = s.specie[stato.specie].oggi, q = o?.q ?? 0;
    // Il bordo lo decide il CSS: Leaflet scriverebbe `stroke` come attributo
    // di presentazione, dove le variabili CSS non si risolvono. Una regola su
    // classe ha priorita' piu' alta dell'attributo, quindi vince e segue il tema.
    const mk = L.circleMarker([s.lat, s.lon], {
      radius: 9 + q, weight: s.id === stato.spot.id ? 3 : 1,
      className: s.id === stato.spot.id ? "mk mk-sel" : "mk",
      fillOpacity: 0.85, fillColor: coloreQ(q),
    }).bindPopup(`<b>${esc(s.nome)}</b><br>${Math.round(s.quota_dem)} m · ${esc(s.bosco)}<br>
      <span class="pop-q" style="color:${coloreQ(q)}">${q.toFixed(1).replace(".", ",")}</span> su 10
      — ${esc(o?.etichetta || "")}`);
    mk.on("click", () => {
      stato.spot = s; $("#sel-spot").value = s.id; renderPrevisione(); disegnaMappa();
    });
    return mk;
  })).addTo(m);

  const st = stato.dati.stazione;
  if (st) {
    stato.strati.st = L.marker([st.lat, st.lon]).addTo(m)
      .bindPopup(`<b>${esc(st.nome)}</b><br>Stazione al suolo · ${st.quota} m<br>
        ${st.temp ?? "?"} °C · ${st.umidita ?? "?"}% · pioggia mese ${st.pioggia_mese ?? "?"} mm`);
  }
  stato.strati.spots = g;
  m.setView([41.95, 13.15], 10);
  $("#map-src").textContent =
    `Otto zone dei Monti Simbruini, punteggio del modello per ${stato.specie}. `
    + `Il marcatore è la stazione di Monte Livata.`;
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
  const media = c.iframe
    ? `<iframe class="cam-shot" loading="lazy" allowfullscreen title="${esc(c.nome)}"
         referrerpolicy="no-referrer"
         sandbox="allow-scripts allow-presentation"></iframe>`
    : `<img class="cam-shot" alt="${esc(c.nome)}" loading="lazy" decoding="async"
         referrerpolicy="no-referrer">`;
  return `<figure class="cam${piccola ? " is-off" : ""}" data-id="${esc(c.id)}">
      <figcaption class="cam-head">
        <span class="cam-name">${esc(c.nome)}</span>
        <span class="cam-sub">${esc(piccola ? (c.errore || "non attiva") : c.dove)}</span>
      </figcaption>
      ${media}
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
  $$("#v-webcam .cam").forEach((fig) => fig.addEventListener("click", () => apriGrande(fig)));
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
  // La stazione parla solo per le zone che le stanno intorno.
  $("#staz-wrap").hidden = !(stato.dati.stazione && s.rh_stazione != null);
  renderStazione();
  renderStatModello(s);
  renderFonti(s);
  renderChart(s);
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
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("is-on", x === b));
    $$(".view").forEach((v) => { v.hidden = v.id !== "v-" + b.dataset.view; });
    if (b.dataset.view === "mappa") avviaMappa();
    if (b.dataset.view === "webcam") montaCams();
    if (b.dataset.view === "meteo") renderMeteo();
  }));
}
