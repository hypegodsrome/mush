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

// Il sito e' aperto: entra chiunque abbia un account Google e il link.
// Non c'e' nessuna lista di indirizzi ammessi, per scelta.
//
// Per richiuderlo servirebbe rimettere un filtro in app.js, dentro
// onAuthStateChanged. Ma sarebbe comunque un controllo lato client: tiene
// fuori dall'interfaccia, non dai dati, che restano pubblici in data/*.json
// per chiunque conosca l'indirizzo. Per una restrizione vera serve un backend.
