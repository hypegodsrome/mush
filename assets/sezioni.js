import { getFirestore, doc, getDocFromServer, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const SEZIONI = { previsione: "Previsione", mappa: "Mappa", specie: "Specie", webcam: "Webcam", meteo: "Meteo" };
const riferimento = app => doc(getFirestore(app), "impostazioni", "sezioni");
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
