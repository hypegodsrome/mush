import { getFirestore, doc, getDocFromServer, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Ogni voce punta a un testo stabile della pagina. I valori sono sempre
// inseriti con textContent: il pannello non permette HTML eseguibile.
export const CONTENUTI = [
  ["home", "Sopratitolo", "#v-home .livata-kicker", "MONTI SIMBRUINI · LAZIO"],
  ["home", "Descrizione principale", "#v-home .livata-hero p", "Paesaggi, webcam, meteo e sentieri dei Monti Simbruini."],
  ["home", "Pulsante webcam", "#v-home .livata-primary .cms-label", "Guarda le webcam"],
  ["home", "Introduzione: etichetta", "#v-home .livata-intro .eyebrow", "ESPLORA IL TERRITORIO"],
  ["home", "Introduzione: titolo", "#v-home .livata-intro h2", "La montagna, a portata di mano."],
  ["home", "Introduzione: descrizione", "#v-home .livata-intro p", "Osserva il panorama, controlla il meteo e scopri i luoghi sulla mappa."],
  ["home", "Meteo: titolo", "#v-home [data-go=meteo] b", "Stazione meteo"],
  ["home", "Meteo: descrizione", "#v-home [data-go=meteo] small", "Le misure attuali da Monte Livata"],
  ["home", "Mappa: titolo", "#v-home [data-go=mappa] b", "Esplora la mappa"],
  ["home", "Mappa: descrizione", "#v-home [data-go=mappa] small", "Luoghi, sentieri e condizioni"],
  ["previsione", "Stazione: titolo", "#v-previsione .stazione-previsione-wrap h2", "Stazione Monte Livata · misure attuali"],
  ["previsione", "Stazione: descrizione", "#v-previsione .stazione-previsione-wrap p", "Valori osservati alla stazione. Il punteggio e i prossimi giorni sono calcolati per la zona selezionata."],
  ["previsione", "Giorni: titolo", "#v-previsione #previsione-giorni-titolo", "Prossimi 16 giorni"],
  ["previsione", "Punteggio: titolo", "#v-previsione #previsione-punteggio-titolo", "Perché questo punteggio"],
  ["previsione", "Confronto: titolo", "#v-previsione #previsione-confronto-titolo", "Confronto fra le zone"],
  ["mappa", "Pannello: titolo", "#v-mappa .pannello-cap span", "Strati e luoghi"],
  ["mappa", "Luoghi: titolo", "#v-mappa .strato-poi > .strato-et", "Cosa c'è sulla mappa"],
  ["mappa", "Sfondo stradale", "#v-mappa [data-base=osm]", "Stradale"],
  ["mappa", "Sfondo rilievo", "#v-mappa [data-base=topo]", "Rilievo"],
  ["specie", "Etichetta", "#v-specie > .eyebrow", "Guida"],
  ["specie", "Titolo", "#v-specie > h2", "Cosa si trova sui Simbruini"],
  ["specie", "Descrizione", "#v-specie > p.muted", "Le specie che crescono fra Livata, Subiaco e la valle dell'Aniene. Per ognuna: dove cercarla, quando, come si riconosce in mano, e soprattutto cosa le somiglia."],
  ["webcam", "Pulsante aggiornamento", "#btn-cams", "Aggiorna immagini"],
  ["meteo", "Etichetta oraria", "#v-meteo > .eyebrow:first-of-type", "Ora per ora"],
  ["meteo", "Titolo orario", "#meteo-orario-titolo", "Che tempo fa, e quando"],
  ["meteo", "Descrizione oraria", "#meteo-orario-titolo + p", "Trascina la barra, o premi play: la temperatura, la pioggia e il vento di tutte le zone si spostano all'ora scelta."],
  ["meteo", "Titolo stazione", "#v-meteo #staz-wrap h2", "Stazione al suolo — misurato"],
  ["meteo", "Titolo confronto", "#v-meteo #meteo-confronto-titolo", "Tutte le zone oggi"],
  ["meteo", "Titolo fonti", "#v-meteo #meteo-fonti-titolo", "Pioggia passata: le fonti a confronto"],
  ["meteo", "Titolo grafico", "#v-meteo #meteo-grafico-titolo", "Pioggia e temperatura — 30 giorni + previsione"],
].map(([sezione, etichetta, selettore, predefinito]) => ({
  sezione, etichetta, selettore, predefinito,
  chiave: `${sezione}_${selettore.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase()}`,
}));

const riferimento = app => doc(getFirestore(app), "impostazioni", "contenuti");
const riferimentoImmagini = app => doc(getFirestore(app), "impostazioni", "immagini");
export const FOTO_PREDEFINITE = {
  primavera: "assets/seasons/primavera.png",
  estate: "assets/seasons/estate.png",
  autunno: "assets/seasons/autunno.png",
  inverno: "assets/seasons/inverno.png",
};
const chiavi = new Set(CONTENUTI.map(c => c.chiave));
export function normalizzaContenuti(data) {
  const testi = data?.testi;
  if (!testi || typeof testi !== "object") return {};
  return Object.fromEntries(Object.entries(testi).filter(([k, v]) =>
    chiavi.has(k) && typeof v === "string" && v.length <= 500));
}
export async function leggiContenuti(app) {
  const snap = await getDocFromServer(riferimento(app));
  return normalizzaContenuti(snap.data());
}
export function osservaContenuti(app, aggiorna, errore) {
  return onSnapshot(riferimento(app), snap => aggiorna(normalizzaContenuti(snap.data())), errore);
}
export async function salvaContenuti(app, testi) {
  await setDoc(riferimento(app), { testi: normalizzaContenuti({ testi }) });
}
export function normalizzaImmagini(data) {
  return Object.fromEntries(Object.entries(FOTO_PREDEFINITE).map(([stagione, predefinita]) => {
    const valore = data?.[stagione];
    const valido = typeof valore === "string" && valore.length <= 500
      && (/^https:\/\/[^\s]+$/i.test(valore) || /^assets\/[a-z0-9/_%.\-]+$/i.test(valore));
    return [stagione, valido ? valore : predefinita];
  }));
}
export async function leggiImmagini(app) {
  const snap = await getDocFromServer(riferimentoImmagini(app));
  return normalizzaImmagini(snap.data());
}
export function osservaImmagini(app, aggiorna, errore) {
  return onSnapshot(riferimentoImmagini(app), snap => aggiorna(normalizzaImmagini(snap.data())), errore);
}
export async function salvaImmagini(app, valori) {
  await setDoc(riferimentoImmagini(app), normalizzaImmagini(valori));
}
const originali = new Map();
export function applicaContenuti(testi, root = document) {
  for (const voce of CONTENUTI) {
    const elemento = root.querySelector(voce.selettore);
    if (!elemento) continue;
    if (!originali.has(voce.chiave)) originali.set(voce.chiave, elemento.innerHTML);
    if (Object.hasOwn(testi || {}, voce.chiave)) elemento.textContent = testi[voce.chiave];
    else if (elemento.innerHTML !== originali.get(voce.chiave)) elemento.innerHTML = originali.get(voce.chiave);
  }
}
