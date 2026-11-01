import { getFirestore, doc, getDocFromServer, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const SEZIONI = { home: "Home", previsione: "Previsione", mappa: "Mappa", specie: "Specie", webcam: "Webcam", meteo: "Meteo" };
const riferimento = app => doc(getFirestore(app), "impostazioni", "sezioni");
const riferimentoLuoghi = app => doc(getFirestore(app), "impostazioni", "luoghi");
const riferimentoWebcam = app => doc(getFirestore(app), "impostazioni", "webcam");
export const normalizza = data => Object.fromEntries(
  Object.keys(SEZIONI).map(key => [key, data?.[key] !== false]));
export async function leggiSezioni(app) {
  const snap = await getDocFromServer(riferimento(app));
  return normalizza(snap.exists() ? snap.data() : null);
}
export function osservaSezioni(app, aggiorna, errore) {
  return onSnapshot(riferimento(app), snap => aggiorna(normalizza(snap.data())), errore);
}
export async function salvaSezioni(app, valori) {
  await setDoc(riferimento(app), normalizza(valori));
}
export const normalizzaLuoghi = (data, ids) => Object.fromEntries(
  ids.map(id => [id, data?.[id] !== false]));
export async function leggiLuoghi(app, ids) {
  const snap = await getDocFromServer(riferimentoLuoghi(app));
  return normalizzaLuoghi(snap.exists() ? snap.data() : null, ids);
}
export function osservaLuoghi(app, ids, aggiorna, errore) {
  return onSnapshot(riferimentoLuoghi(app),
    snap => aggiorna(normalizzaLuoghi(snap.data(), ids)), errore);
}
export async function salvaLuoghi(app, valori) {
  await setDoc(riferimentoLuoghi(app), valori);
}
export const normalizzaWebcam = (data, ids) => Object.fromEntries(
  ids.map(id => [id, data?.[id] !== false]));
export async function leggiWebcam(app, ids) {
  const snap = await getDocFromServer(riferimentoWebcam(app));
  return normalizzaWebcam(snap.exists() ? snap.data() : null, ids);
}
export function osservaWebcam(app, ids, aggiorna, errore) {
  return onSnapshot(riferimentoWebcam(app),
    snap => aggiorna(normalizzaWebcam(snap.data(), ids)), errore);
}
export async function salvaWebcam(app, valori) {
  await setDoc(riferimentoWebcam(app), valori);
}
