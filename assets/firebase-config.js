// Configurazione web del progetto Firebase `ecosite-34d60`.
//
// Questi valori sono PUBBLICI per definizione: finiscono nel bundle che gira
// nel browser di chiunque apra il sito. Non sono un segreto e non vanno
// nascosti. Quello che protegge il progetto e' altrove:
//   - Authentication > Settings > Domini autorizzati  (chi puo' fare login)
//   - le regole di sicurezza dei servizi che userai (Firestore, Storage, ...)
//
// Per riempirli, con la CLI loggata sull'account che possiede il progetto:
//   firebase apps:sdkconfig WEB --project ecosite-34d60
//
// Se non esiste ancora un'app web nel progetto, creala prima:
//   firebase apps:create WEB mush --project ecosite-34d60

export const firebaseConfig = {
  apiKey: "AIzaSyCgYIBNbJyAh-i2eXlXzzOPwVU6EQGCplQ",
  authDomain: "ecosite-34d60.firebaseapp.com",
  projectId: "ecosite-34d60",
  storageBucket: "ecosite-34d60.firebasestorage.app",
  messagingSenderId: "512648397417",
  appId: "1:512648397417:web:7c2bb9edb5ba1e264958f8",
};

// Chi puo' entrare. Lista VUOTA = chiunque abbia un account Google, che e' la
// configurazione attuale: il sito e' aperto a tutti quelli che hanno il link.
//
// Per richiuderlo basta elencare gli indirizzi ammessi:
//   export const EMAIL_AMMESSE = ["tuo@gmail.com", "altro@gmail.com"];
//
// In ogni caso e' un controllo lato client: vale come cancello d'ingresso
// all'interfaccia, non come protezione dei dati, che restano pubblici in
// data/*.json per chiunque conosca l'indirizzo.
export const EMAIL_AMMESSE = [];
