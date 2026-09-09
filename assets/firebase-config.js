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
  apiKey: "DA_COMPILARE",
  authDomain: "ecosite-34d60.firebaseapp.com",
  projectId: "ecosite-34d60",
  storageBucket: "ecosite-34d60.firebasestorage.app",
  messagingSenderId: "DA_COMPILARE",
  appId: "DA_COMPILARE",
};

// Solo questi indirizzi possono entrare. Lista vuota = chiunque abbia un
// account Google. Nota che e' un controllo lato client: vale come cancello
// d'ingresso, non come protezione dei dati (i JSON sono pubblici sul repo).
export const EMAIL_AMMESSE = [
  "eug2002@gmail.com",
];
