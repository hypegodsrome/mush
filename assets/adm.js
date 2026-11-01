// Pagina di amministrazione: chi e' entrato, e chi non deve piu' entrare.
//
// Tutto quello che c'e' qui e' comodita' d'interfaccia. Chi puo' leggere
// l'elenco e chi puo' bandire lo decidono le regole di Firestore, sui server
// di Google. Se qualcuno apre questa pagina senza averne diritto, la vede
// vuota con un errore di permessi: e' il comportamento voluto.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence,
  reauthenticateWithPopup,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { EMAIL_ADMIN, isAdmin, elencoUtenti, bandisci, elimina } from "./registro.js";
import { SEZIONI, leggiSezioni, salvaSezioni, leggiLuoghi, salvaLuoghi,
  leggiWebcam, salvaWebcam } from "./sezioni.js";
import { CONTENUTI, leggiContenuti, salvaContenuti,
  FOTO_PREDEFINITE, leggiImmagini, salvaImmagini } from "./contenuti.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let utenti = [];

/** Il contatore lo scrive l'utente nel proprio documento. Le regole ora ne
 *  verificano il tipo, ma un valore gia' salvato prima di quelle regole
 *  potrebbe non essere un numero: qui viene comunque forzato, cosi' non
 *  finisce mai in pagina come testo arbitrario. */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const data = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit",
    year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function mostraGate(msg) {
  $("#gate").hidden = false;
  $("#app").hidden = true;
  if (msg) { $("#gate-err").hidden = false; $("#gate-err").textContent = msg; }
}

await setPersistence(auth, browserLocalPersistence).catch(() => {});

onAuthStateChanged(auth, async (u) => {
  if (!u) return mostraGate();
  if (!isAdmin(u)) {
    // Le regole lo fermerebbero comunque; questo evita solo di mostrargli
    // una pagina piena di errori di permessi.
    return mostraGate(`${u.email} non è l'amministratore di questo sito.`);
  }
  $("#gate").hidden = true;
  $("#app").hidden = false;
  $("#user").textContent = u.email;
  carica();
  caricaSezioni();
  caricaLuoghi();
  caricaWebcam();
  caricaContenuti();
  caricaImmagini();
});

$("#btn-login").addEventListener("click", async () => {
  $("#gate-err").hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    mostraGate(e.code === "auth/popup-blocked"
      ? "Il browser ha bloccato la finestra di accesso."
      : (e.code || e.message));
  }
});
$("#btn-logout").addEventListener("click", () => signOut(auth));
$("#sel-ordine").addEventListener("change", disegna);
$("#sel-filtro").addEventListener("change", disegna);
$("#ricarica-sezioni").addEventListener("click", caricaSezioni);
$("#form-sezioni").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin(auth.currentUser)) return;
  const valori = Object.fromEntries($$("#sezioni-opzioni input").map(input => [input.name, input.checked]));
  $("#sezioni-campi").disabled = true;
  $("#salva-sezioni").disabled = true;
  $("#sezioni-msg").textContent = "Salvataggio…";
  try {
    await salvaSezioni(app, valori);
    $("#sezioni-msg").textContent = "Visibilità salvata. Il sito si aggiorna anche per gli utenti già collegati.";
  } catch (e) {
    $("#sezioni-msg").textContent = "Salvataggio non riuscito. Nessuna conferma ricevuta: riprova.";
  } finally {
    $("#sezioni-campi").disabled = false;
    $("#salva-sezioni").disabled = false;
  }
});

async function caricaSezioni() {
  $("#sezioni-campi").disabled = true;
  $("#salva-sezioni").disabled = true;
  $("#ricarica-sezioni").hidden = true;
  try {
    const valori = await leggiSezioni(app);
    $("#sezioni-opzioni").innerHTML = Object.entries(SEZIONI).map(([id, nome]) =>
      `<label class="sezione-toggle"><span>${nome}</span><input type="checkbox" role="switch" name="${id}" ${valori[id] ? "checked" : ""}><span class="sezione-stato"></span></label>`).join("");
    $("#sezioni-campi").disabled = false;
    $("#salva-sezioni").disabled = false;
    $("#sezioni-msg").textContent = "Attiva una sezione per mostrarla, disattivala per nasconderla.";
  } catch (e) {
    $("#sezioni-msg").textContent = "Impostazioni non disponibili. Verifica la connessione e riprova.";
    $("#ricarica-sezioni").hidden = false;
  }
}

$("#ricarica-luoghi").addEventListener("click", caricaLuoghi);
$("#form-luoghi").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin(auth.currentUser)) return;
  const valori = Object.fromEntries($$("#luoghi-opzioni input").map(input => [input.name, input.checked]));
  if (!Object.values(valori).some(Boolean)) {
    $("#luoghi-msg").textContent = "Lascia visibile almeno una località.";
    return;
  }
  $("#luoghi-campi").disabled = true;
  $("#salva-luoghi").disabled = true;
  $("#luoghi-msg").textContent = "Salvataggio…";
  try {
    await salvaLuoghi(app, valori);
    $("#luoghi-msg").textContent = "Località salvate. Il sito si aggiorna anche per gli utenti già collegati.";
  } catch (e) {
    $("#luoghi-msg").textContent = "Salvataggio non riuscito. Riprova.";
  } finally {
    $("#luoghi-campi").disabled = false;
    $("#salva-luoghi").disabled = false;
  }
});

async function caricaLuoghi() {
  $("#luoghi-campi").disabled = true;
  $("#salva-luoghi").disabled = true;
  $("#ricarica-luoghi").hidden = true;
  try {
    const risposta = await fetch("../data/spots.json");
    if (!risposta.ok) throw new Error("Località non disponibili");
    const catalogo = (await risposta.json()).spots;
    const valori = await leggiLuoghi(app, catalogo.map(s => s.id));
    $("#luoghi-opzioni").innerHTML = catalogo.map(s =>
      `<label class="sezione-toggle"><span>${esc(s.nome)}</span><input type="checkbox" role="switch" name="${esc(s.id)}" ${valori[s.id] ? "checked" : ""}><span class="sezione-stato"></span></label>`).join("");
    $("#luoghi-campi").disabled = false;
    $("#salva-luoghi").disabled = false;
    $("#luoghi-msg").textContent = "Le località disattivate non compaiono agli utenti.";
  } catch (e) {
    $("#luoghi-msg").textContent = "Impossibile caricare le località. Riprova.";
    $("#ricarica-luoghi").hidden = false;
  }
}

$("#ricarica-webcam").addEventListener("click", caricaWebcam);
$("#form-webcam").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin(auth.currentUser)) return;
  const valori = Object.fromEntries($$("#webcam-opzioni input").map(input => [input.name, input.checked]));
  $("#webcam-campi").disabled = true;
  $("#salva-webcam").disabled = true;
  $("#webcam-msg").textContent = "Salvataggio…";
  try {
    await salvaWebcam(app, valori);
    $("#webcam-msg").textContent = "Webcam salvate. Il sito si aggiorna anche per gli utenti già collegati.";
  } catch (e) {
    $("#webcam-msg").textContent = "Salvataggio non riuscito. Riprova.";
  } finally {
    $("#webcam-campi").disabled = false;
    $("#salva-webcam").disabled = false;
  }
});

async function caricaWebcam() {
  $("#webcam-campi").disabled = true;
  $("#salva-webcam").disabled = true;
  $("#ricarica-webcam").hidden = true;
  try {
    const risposta = await fetch("../data/webcam.json", { cache: "no-cache" });
    if (!risposta.ok) throw new Error("Webcam non disponibili");
    const catalogo = (await risposta.json()).cam || [];
    const valori = await leggiWebcam(app, catalogo.map(c => c.id));
    $("#webcam-opzioni").innerHTML = catalogo.map(c =>
      `<label class="sezione-toggle"><span>${esc(c.nome)}<small class="admin-cam-state">${c.viva ? "Attiva" : "Non attiva"}</small></span><input type="checkbox" role="switch" name="${esc(c.id)}" ${valori[c.id] ? "checked" : ""}><span class="sezione-stato"></span></label>`).join("");
    $("#webcam-campi").disabled = false;
    $("#salva-webcam").disabled = false;
    $("#webcam-msg").textContent = "Le webcam disattivate non compaiono agli utenti.";
  } catch (e) {
    $("#webcam-msg").textContent = "Impossibile caricare le webcam. Riprova.";
    $("#ricarica-webcam").hidden = false;
  }
}

$("#ricarica-contenuti").addEventListener("click", caricaContenuti);
$("#contenuti-opzioni").addEventListener("click", e => {
  const reset = e.target.closest("button[data-reset]");
  if (!reset) return;
  const voce = CONTENUTI.find(c => c.chiave === reset.dataset.reset);
  const campo = $(`#contenuti-opzioni [name="${reset.dataset.reset}"]`);
  if (voce && campo) { campo.value = voce.predefinito; campo.focus(); }
});
$("#form-contenuti").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin(auth.currentUser)) return;
  const testi = {};
  for (const voce of CONTENUTI) {
    const valore = $(`#contenuti-opzioni [name="${voce.chiave}"]`)?.value.trim();
    if (!valore) {
      $("#contenuti-msg").textContent = `Compila “${voce.etichetta}” nella pagina ${voce.sezione}.`;
      return;
    }
    if (valore !== voce.predefinito) testi[voce.chiave] = valore;
  }
  $("#contenuti-campi").disabled = true;
  $("#salva-contenuti").disabled = true;
  $("#contenuti-msg").textContent = "Pubblicazione…";
  try {
    await salvaContenuti(app, testi);
    $("#contenuti-msg").textContent = "Testi pubblicati. Apri il sito per verificarli.";
  } catch (e) {
    $("#contenuti-msg").textContent = "Pubblicazione non riuscita. Riprova.";
  } finally {
    $("#contenuti-campi").disabled = false;
    $("#salva-contenuti").disabled = false;
  }
});

async function caricaContenuti() {
  $("#contenuti-campi").disabled = true;
  $("#salva-contenuti").disabled = true;
  $("#ricarica-contenuti").hidden = true;
  try {
    const testi = await leggiContenuti(app);
    const contenitore = $("#contenuti-opzioni");
    contenitore.replaceChildren();
    for (const sezione of Object.keys(SEZIONI)) {
      const gruppo = document.createElement("details");
      gruppo.className = "admin-content-group";
      if (sezione === "home") gruppo.open = true;
      const titolo = document.createElement("summary");
      titolo.textContent = SEZIONI[sezione];
      gruppo.append(titolo);
      for (const voce of CONTENUTI.filter(c => c.sezione === sezione)) {
        const riga = document.createElement("div");
        riga.className = "admin-content-row";
        const etichetta = document.createElement("label");
        etichetta.textContent = voce.etichetta;
        const campo = document.createElement("textarea");
        campo.name = voce.chiave;
        campo.maxLength = 500;
        campo.rows = voce.predefinito.length > 85 ? 3 : 2;
        campo.value = testi[voce.chiave] ?? voce.predefinito;
        etichetta.append(campo);
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "btn-ghost";
        reset.dataset.reset = voce.chiave;
        reset.textContent = "Ripristina";
        riga.append(etichetta, reset);
        gruppo.append(riga);
      }
      contenitore.append(gruppo);
    }
    $("#contenuti-campi").disabled = false;
    $("#salva-contenuti").disabled = false;
    $("#contenuti-msg").textContent = "Modifica i campi e premi Pubblica i testi.";
  } catch (e) {
    $("#contenuti-msg").textContent = "Impossibile caricare i testi. Riprova.";
    $("#ricarica-contenuti").hidden = false;
  }
}

$("#ricarica-immagini").addEventListener("click", caricaImmagini);
$("#immagini-opzioni").addEventListener("click", e => {
  const reset = e.target.closest("button[data-stagione]");
  if (!reset) return;
  const campo = $(`#immagini-opzioni [name="${reset.dataset.stagione}"]`);
  if (campo) { campo.value = FOTO_PREDEFINITE[reset.dataset.stagione]; campo.focus(); }
});
$("#form-immagini").addEventListener("submit", async e => {
  e.preventDefault();
  if (!isAdmin(auth.currentUser)) return;
  const valori = Object.fromEntries($$("#immagini-opzioni input").map(campo => [campo.name, campo.value.trim()]));
  for (const [stagione, valore] of Object.entries(valori)) {
    if (!/^https:\/\/[^\s]+$/i.test(valore) && !/^assets\/[a-z0-9/_%.\-]+$/i.test(valore)) {
      $("#immagini-msg").textContent = `Indirizzo non valido per ${stagione}: usa HTTPS o un percorso assets/.`;
      return;
    }
  }
  $("#immagini-campi").disabled = true;
  $("#salva-immagini").disabled = true;
  $("#immagini-msg").textContent = "Pubblicazione…";
  try {
    await salvaImmagini(app, valori);
    $("#immagini-msg").textContent = "Foto pubblicate. La Home si aggiorna automaticamente.";
  } catch (e) {
    $("#immagini-msg").textContent = "Pubblicazione non riuscita. Riprova.";
  } finally {
    $("#immagini-campi").disabled = false;
    $("#salva-immagini").disabled = false;
  }
});

async function caricaImmagini() {
  $("#immagini-campi").disabled = true;
  $("#salva-immagini").disabled = true;
  $("#ricarica-immagini").hidden = true;
  try {
    const valori = await leggiImmagini(app);
    const contenitore = $("#immagini-opzioni");
    contenitore.replaceChildren();
    for (const [stagione] of Object.entries(FOTO_PREDEFINITE)) {
      const riga = document.createElement("div");
      riga.className = "admin-content-row";
      const etichetta = document.createElement("label");
      etichetta.textContent = stagione[0].toUpperCase() + stagione.slice(1);
      const campo = document.createElement("input");
      campo.type = "text";
      campo.inputMode = "url";
      campo.name = stagione;
      campo.value = valori[stagione];
      campo.maxLength = 500;
      campo.required = true;
      etichetta.append(campo);
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "btn-ghost";
      reset.dataset.stagione = stagione;
      reset.textContent = "Ripristina";
      riga.append(etichetta, reset);
      contenitore.append(riga);
    }
    $("#immagini-campi").disabled = false;
    $("#salva-immagini").disabled = false;
    $("#immagini-msg").textContent = "Usa indirizzi HTTPS delle foto oppure i percorsi assets/ inclusi nel sito.";
  } catch (e) {
    $("#immagini-msg").textContent = "Impossibile caricare le foto. Riprova.";
    $("#ricarica-immagini").hidden = false;
  }
}

async function carica() {
  $("#msg").textContent = "Caricamento…";
  try {
    utenti = await elencoUtenti(app);
    $("#msg").textContent = "";
    disegna();
  } catch (e) {
    const permessi = String(e.code || "").includes("permission-denied");
    const spento = String(e.message || "").includes("has not been used");
    $("#utenti").innerHTML = `<div class="err">
      <b>Registro non leggibile.</b><br>${esc(e.code || e.message)}
      ${spento ? "<br><br>Cloud Firestore non è ancora attivo su questo progetto. "
                 + "Attivalo dalla console Firebase, poi ricarica."
        : permessi ? "<br><br>Le regole hanno rifiutato la lettura. "
                     + "Le condizioni richieste sono qui sotto: quella che risulta "
                     + "<b>no</b> è la causa." + await diagnosi()
                   : ""}
    </div>`;
    $("#msg").textContent = "";
  }
}

/** Le regole concedono l'elenco solo se email e email_verified combaciano.
 *  Senza vederli, un permission-denied resta un indovinello. */
async function diagnosi() {
  const u = auth.currentUser;
  if (!u) return "<br><br>Nessun utente connesso.";
  let claims = {};
  try { claims = (await u.getIdTokenResult(true)).claims; } catch (e) { /* niente */ }
  const si = (b) => (b ? "sì" : "<b>no</b>");
  return `<br><br>
    Indirizzo: <code>${esc(u.email)}</code><br>
    È l'amministratore atteso (<code>${esc(EMAIL_ADMIN)}</code>): ${si(u.email === EMAIL_ADMIN)}<br>
    Indirizzo verificato dal provider: ${si(claims.email_verified === true)}<br>
    Regole pubblicate di recente: se hai appena fatto il deploy, attendi
    qualche secondo e ricarica.`;
}

function disegna() {
  const ordine = $("#sel-ordine").value, filtro = $("#sel-filtro").value;
  const ms = (t) => (t?.toDate ? t.toDate().getTime() : 0);

  let righe = utenti.filter((u) =>
    filtro === "tutti" || (filtro === "banditi" ? u.bandito : !u.bandito));

  righe.sort((a, b) => ({
    ultimo: () => ms(b.ultimo_accesso) - ms(a.ultimo_accesso),
    primo: () => ms(b.primo_accesso) - ms(a.primo_accesso),
    accessi: () => num(b.accessi) - num(a.accessi),
    email: () => String(a.email).localeCompare(String(b.email)),
  }[ordine]()));

  const banditi = utenti.filter((u) => u.bandito).length;
  $("#riassunto").innerHTML = [
    ["Registrati", utenti.length],
    ["Attivi", utenti.length - banditi],
    ["Banditi", banditi],
    ["Sessioni totali", utenti.reduce((s, u) => s + num(u.accessi), 0)],
  ].map(([k, v]) => `<div class="obs"><div class="obs-k">${esc(k)}</div>
      <div class="obs-v">${v}</div></div>`).join("");

  $("#utenti").innerHTML = righe.length === 0
    ? `<p class="muted small">Nessun utente da mostrare.</p>`
    : righe.map((u) => `
      <div class="utente${u.bandito ? " is-bandito" : ""}">
        <div class="ut-chi">
          <b>${esc(u.nome || "(senza nome)")}</b>
          <span>${esc(u.email)}</span>
          ${u.email === EMAIL_ADMIN ? `<span class="pill">amministratore</span>` : ""}
          ${u.bandito ? `<span class="pill pill-ko">bandito</span>` : ""}
        </div>
        <div class="ut-dati">
          <span>primo ${esc(data(u.primo_accesso))}</span>
          <span>ultimo ${esc(data(u.ultimo_accesso))}</span>
          <span>${num(u.accessi)} session${num(u.accessi) === 1 ? "e" : "i"}</span>
        </div>
        <div class="ut-azioni">
          ${u.email === EMAIL_ADMIN ? `<span class="muted small">non bandibile</span>` : `
            <button class="btn-ghost" data-az="${u.bandito ? "riammetti" : "bandisci"}"
              data-uid="${esc(u.uid)}">${u.bandito ? "Riammetti" : "Bandisci"}</button>
            <button class="btn-ghost" data-az="elimina" data-uid="${esc(u.uid)}">Elimina</button>`}
        </div>
      </div>`).join("");

  $$("#utenti button[data-az]").forEach((b) =>
    b.addEventListener("click", () => azione(b.dataset.az, b.dataset.uid)));
}

/* Riautenticazione recente prima delle azioni distruttive.
 *
 * Non posso imporre il secondo fattore da qui: lo decide l'account Google.
 * Ma posso pretendere un accesso FRESCO, e quello passa da Google - quindi
 * se sull'account la verifica in due passaggi e' attiva, scatta li'.
 * Serve anche contro il caso concreto: sessione lasciata aperta su un
 * computer altrui. La finestra e' corta apposta. */
const FRESCHEZZA_MS = 5 * 60 * 1000;
let ultimaRiauth = 0;

async function confermaIdentita() {
  if (Date.now() - ultimaRiauth < FRESCHEZZA_MS) return true;
  try {
    await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
    ultimaRiauth = Date.now();
    return true;
  } catch (e) {
    $("#msg").textContent = e.code === "auth/popup-blocked"
      ? "Il browser ha bloccato la finestra di conferma."
      : "Identità non confermata: " + (e.code || e.message);
    return false;
  }
}

async function azione(az, uid) {
  const u = utenti.find((x) => x.uid === uid);
  if (!u) return;

  // Bandire e cancellare sono azioni che tolgono l'accesso a una persona:
  // meritano una conferma esplicita, non un click distratto.
  const domande = {
    bandisci: `Bandire ${u.email}?\n\nVerrà disconnesso e non potrà più entrare.`,
    riammetti: `Riammettere ${u.email}?`,
    elimina: `Eliminare ${u.email} dal registro?\n\n`
             + `Attenzione: non è un bando. Al prossimo accesso rientra e viene registrato di nuovo.`,
  };
  if (!confirm(domande[az])) return;

  $("#msg").textContent = "Conferma la tua identità…";
  if (!await confermaIdentita()) return;

  $("#msg").textContent = "Salvataggio…";
  try {
    if (az === "elimina") await elimina(app, uid);
    else await bandisci(app, uid, az === "bandisci");
    await carica();
    $("#msg").textContent = "Fatto.";
  } catch (e) {
    $("#msg").textContent = "Non riuscito: " + (e.code || e.message);
  }
}
