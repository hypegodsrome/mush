// Registro degli accessi.
//
// Condiviso fra il sito e la pagina di amministrazione, cosi' l'indirizzo
// dell'amministratore e la forma dei documenti stanno scritti in un posto solo.
//
// Se Firestore non e' ancora attivo sul progetto, tutto qui dentro fallisce e
// deve fallire in modo innocuo: il sito e' consultabile lo stesso, semplicemente
// senza registro. Meglio un sito che funziona senza registro che una pagina
// bianca perche' manca un database.

import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const EMAIL_ADMIN = "eug2002@gmail.com";

/** Due accessi entro questa finestra sono la stessa sessione. */
const SESSIONE_MS = 30 * 60 * 1000;

export const isAdmin = (u) => !!u && u.email === EMAIL_ADMIN;

/** Registra l'accesso e restituisce lo stato dell'utente.
 *  Ritorna {bandito, nuovo, errore}. `errore` valorizzato significa che il
 *  registro non ha funzionato, non che l'utente sia da respingere. */
export async function registraAccesso(app, u) {
  try {
    const db = getFirestore(app);
    const rif = doc(db, "utenti", u.uid);
    const attuale = await getDoc(rif);

    if (!attuale.exists()) {
      // I campi devono combaciare esattamente con quelli ammessi dalle
      // regole in creazione, altrimenti la scrittura viene respinta.
      await setDoc(rif, {
        email: u.email,
        nome: u.displayName || "",
        primo_accesso: serverTimestamp(),
        ultimo_accesso: serverTimestamp(),
        accessi: 1,
        bandito: false,
      });
      return { bandito: false, nuovo: true };
    }

    const dati = attuale.data();
    if (dati.bandito === true) return { bandito: true, nuovo: false, dati };

    // onAuthStateChanged scatta a ogni caricamento di pagina e a ogni rinnovo
    // del token, circa ogni ora. Incrementando sempre, "accessi" finiva per
    // contare le pageview: cinquanta ricariche di prova diventavano cinquanta
    // accessi. Si conta una sessione sola se l'ultima e' piu' vecchia di
    // mezz'ora, e la data si aggiorna comunque.
    const precedente = dati.ultimo_accesso?.toDate?.();
    const nuovaSessione = !precedente
      || (Date.now() - precedente.getTime()) > SESSIONE_MS;

    await updateDoc(rif, {
      ultimo_accesso: serverTimestamp(),
      accessi: nuovaSessione ? increment(1) : (dati.accessi || 1),
      nome: u.displayName || dati.nome || "",
    });
    return { bandito: false, nuovo: false, nuovaSessione, dati };
  } catch (e) {
    console.warn("registro non disponibile:", e.code || e.message);
    return { bandito: false, nuovo: false, errore: e.code || e.message };
  }
}

/** Elenco completo. Le regole lo concedono al solo amministratore. */
export async function elencoUtenti(app) {
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, "utenti"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function bandisci(app, uid, bandito) {
  await updateDoc(doc(getFirestore(app), "utenti", uid), {
    bandito,
    bandito_il: bandito ? serverTimestamp() : null,
  });
}

/** Cancellare non e' bandire: al prossimo accesso l'utente ricrea il proprio
 *  documento e rientra. Serve solo a fare pulizia. */
export async function elimina(app, uid) {
  await deleteDoc(doc(getFirestore(app), "utenti", uid));
}
