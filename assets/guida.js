/* Guida alle specie dei Monti Simbruini e della valle dell'Aniene.
 *
 * Contenuto scritto per questo sito. Niente foto: non ho immagini di cui
 * detenga i diritti, e una foto sbagliata su una guida ai funghi e' peggio
 * di nessuna foto. Al loro posto c'e' il campo `segni`, che descrive a
 * parole i caratteri che si controllano in mano.
 *
 * `confusioni` e' la parte che conta davvero. Le guide che elencano solo le
 * specie buone sono quelle che mandano la gente in ospedale: quasi ogni
 * fungo commestibile ha un sosia, e alcuni di quei sosia uccidono.
 *
 * `habitat` alimenta i filtri; `cerca` e' il testo su cui lavora la ricerca.
 */

export const HABITAT = {
  bosco:   "Bosco",
  ceppaie: "Ceppaie",
  prato:   "Prato e radure",
};

export const SPECIE = [
  {
    id: "porcino",
    nome: "Porcini",
    sci: "Boletus edulis, aereus, pinophilus, reticulatus",
    habitat: "bosco",
    stagione: "Giugno (cimaroli) e da fine agosto a novembre",
    modello: "porcino",
    dove: "Faggeta sopra i 1000 m per l'edulis, querceta e castagneto più in "
        + "basso per l'aereus. Sui Simbruini la fascia migliore è quella del "
        + "faggio fra Livata, Campaegli e Monte Autore.",
    segni: "Tubuli e pori sotto il cappello, mai lamelle. Pori bianchi da "
         + "giovane, poi crema e verdastri, che non virano al blu alla "
         + "pressione. Gambo tozzo con reticolo chiaro in rilievo. Carne "
         + "bianca immutabile al taglio. Odore gradevole, di nocciola.",
    confusioni: [
      ["Boletus satanas e affini", "grave",
       "Pori ROSSI o aranciati e gambo con reticolo rosso. Carne che vira al "
       + "blu. Provoca vomito e diarrea violenti. Regola pratica: pori rossi, "
       + "si lascia dov'è."],
      ["Tylopilus felleus", "lieve",
       "Identico a un porcino a vista, ma il reticolo del gambo è scuro e a "
       + "maglie larghe, e i pori virano al rosa. Amarissimo: non è tossico "
       + "ma rovina l'intero cesto se ci finisce dentro."],
    ],
  },
  {
    id: "galletto",
    nome: "Galletti o finferli",
    sci: "Cantharellus cibarius",
    habitat: "bosco",
    stagione: "Da giugno a novembre, con più ondate",
    modello: "galletto",
    dove: "Faggeta e castagneto, spesso nel muschio e sui bordi dei sentieri. "
        + "Cresce a gruppi numerosi: trovato uno, cercare intorno.",
    segni: "Giallo uovo uniforme, imbutiforme da adulto. Sotto il cappello "
         + "non ha lamelle vere ma pieghe spesse e ramificate che scendono "
         + "sul gambo. Carne biancastra, soda, fibrosa. Odore di albicocca.",
    confusioni: [
      ["Omphalotus olearius", "grave",
       "Il fungo dell'olivo: arancione acceso, cresce a cespi FITTI su legno "
       + "o su radici, ha lamelle vere sottili e taglienti, e di notte emette "
       + "una debole luce. Provoca intossicazioni gastrointestinali serie. "
       + "La differenza sta nelle pieghe contro le lamelle, e nel crescere "
       + "isolati contro il cespo."],
      ["Hygrophoropsis aurantiaca", "lieve",
       "Il falso finferlo: più arancione, lamelle vere e ripetutamente "
       + "biforcate, carne molle. Poco digeribile, non mortale."],
    ],
  },
  {
    id: "steccherino",
    nome: "Steccherino dorato",
    sci: "Hydnum repandum",
    habitat: "bosco",
    stagione: "Da settembre a dicembre",
    modello: "steccherino",
    dove: "Faggeta, spesso in file o cerchi. Regge le prime gelate leggere "
        + "e continua quando il porcino ha già chiuso.",
    segni: "Impossibile da confondere una volta girato: sotto il cappello ha "
         + "AGUZZI simili a piccoli spilli, non lamelle né pori. Colore "
         + "crema-albicocca, cappello irregolare, carne che si sbriciola.",
    confusioni: [
      ["Nessuna pericolosa", "nessuna",
       "Gli aculei sotto il cappello lo rendono uno dei funghi più sicuri da "
       + "riconoscere in Europa. L'Hydnum rufescens è più piccolo e scuro, "
       + "ed è ugualmente commestibile."],
    ],
  },
  {
    id: "trombetta",
    nome: "Trombette dei morti",
    sci: "Craterellus cornucopioides",
    habitat: "bosco",
    stagione: "Da ottobre a dicembre",
    modello: "trombetta",
    dove: "Faggeta e querceta con lettiera fitta e muschio, nei valloni umidi. "
        + "Il nome viene da Ognissanti, ed è un'indicazione di calendario "
        + "prima che un'immagine.",
    segni: "Imbuto cavo fino alla base, grigio-nero, superficie esterna "
         + "liscia o appena rugosa. Carne sottile ed elastica. Crescono a "
         + "gruppi molto numerosi ma sono quasi invisibili sulla lettiera: "
         + "si trovano restando fermi e abbassandosi.",
    confusioni: [
      ["Nessuna pericolosa", "nessuna",
       "La forma a tromba cava e il colore scuro non hanno sosia tossici. "
       + "Si secca benissimo e concentra il profumo."],
    ],
  },
  {
    id: "ovolo",
    nome: "Ovolo buono",
    sci: "Amanita caesarea",
    habitat: "bosco",
    stagione: "Da luglio a ottobre",
    dove: "Querceta e castagneto sui versanti caldi, sotto i 1000 m. Nella "
        + "valle dell'Aniene si trova verso Subiaco e Canterano.",
    segni: "Cappello arancione, lamelle GIALLE, gambo GIALLO, anello giallo "
         + "striato, volva bianca a sacco alla base. Da giovane è un uovo "
         + "bianco: va tagliato in due per lungo prima di raccoglierlo.",
    confusioni: [
      ["Amanita phalloides", "mortale",
       "Il tignosone verdognolo: lamelle BIANCHE, gambo BIANCO, volva bianca. "
       + "Una sola può uccidere un adulto, e i sintomi arrivano dopo 8-12 ore, "
       + "quando il fegato è già colpito. La discriminante è il colore di "
       + "lamelle e gambo: nell'ovolo sono gialli, nella phalloides bianchi."],
      ["Amanita muscaria", "grave",
       "Rossa con verruche bianche, ma la pioggia può lavarle via lasciandola "
       + "somigliante all'ovolo. Lamelle e gambo restano bianchi."],
      ["Uova non aperte", "mortale",
       "Un ovolo chiuso e un'Amanita mortale allo stadio di uovo sono "
       + "indistinguibili dall'esterno. Vanno SEMPRE sezionati per lungo: "
       + "l'ovolo buono mostra all'interno il giallo aranciato, le amanite "
       + "mortali restano bianche."],
    ],
  },
  {
    id: "mazza",
    nome: "Mazza di tamburo",
    sci: "Macrolepiota procera",
    habitat: "prato",
    stagione: "Da agosto a novembre",
    dove: "Radure, pascoli, bordi del bosco. Sui pianori di Campo dell'Osso e "
        + "nelle radure di faggeta.",
    segni: "Grande, cappello fino a 30 cm, prima a bacchetta di tamburo poi "
         + "aperto e piatto, coperto di squame brune su fondo chiaro. Gambo "
         + "alto e slanciato con ZIGRINATURA a serpente e anello DOPPIO e "
         + "SCORREVOLE. La carne non cambia colore al taglio.",
    confusioni: [
      ["Chlorophyllum molybdites", "grave",
       "Rara in Italia ma in espansione: identica a vista, ma le lamelle "
       + "virano al verdastro con l'età e la sporata è verde."],
      ["Lepiote piccole", "mortale",
       "Le Lepiota di piccola taglia, sotto i 10 cm di cappello, contengono "
       + "le stesse tossine della phalloides. Regola: le mazze di tamburo si "
       + "raccolgono solo grandi, con gambo zigrinato e anello scorrevole."],
    ],
  },
  {
    id: "chiodino",
    nome: "Chiodini",
    sci: "Armillaria mellea e specie affini",
    habitat: "ceppaie",
    stagione: "Da settembre a dicembre",
    dove: "Su ceppaie, radici e legno morto, a cespi molto fitti. Parassita: "
        + "si trova dove il bosco ha alberi sofferenti o tagliati.",
    segni: "Cespi numerosi che partono da un unico punto. Cappello miele con "
         + "fine peluria scura al centro, lamelle bianche poi macchiate di "
         + "ruggine, anello bianco e persistente. Sporata BIANCA.",
    confusioni: [
      ["Galerina marginata", "mortale",
       "Cresce sullo stesso legno, stessa taglia, stesso colore, e contiene "
       + "le amatossine della phalloides. Differenza: sporata BRUNO-RUGGINE "
       + "invece che bianca. Va verificata lasciando un cappello su un foglio "
       + "per qualche ora."],
      ["Hypholoma fasciculare", "grave",
       "Il falso chiodino: giallo zolfo, lamelle verdastre, amarissimo. "
       + "Cresce sugli stessi ceppi e negli stessi cespi."],
    ],
    nota: "Va sempre cotto a lungo e l'acqua di prebollitura buttata: da crudo "
        + "o poco cotto è tossico anche quando la specie è quella giusta.",
  },
  {
    id: "prugnolo",
    nome: "Prugnolo",
    sci: "Calocybe gambosa",
    habitat: "prato",
    stagione: "Da aprile a giugno",
    dove: "Pascoli e radure, spesso in cerchi o file lunghe, sui versanti "
        + "esposti a sud che si scaldano per primi.",
    segni: "Bianco-crema, carnoso, lamelle bianche fitte e strette, gambo "
         + "pieno. Odore forte di farina fresca, che è il carattere più "
         + "affidabile.",
    confusioni: [
      ["Entoloma lividum", "grave",
       "Cresce negli stessi posti e nella stessa stagione, ha anch'esso odore "
       + "farinaceo, ma le lamelle virano al ROSA con la maturazione e la "
       + "sporata è rosa. Provoca intossicazioni gravi e prolungate. È la "
       + "confusione più frequente in Italia."],
    ],
  },
  {
    id: "russula",
    nome: "Colombina verde",
    sci: "Russula virescens",
    habitat: "bosco",
    stagione: "Da giugno a settembre",
    dove: "Querceta, castagneto e faggeta.",
    segni: "Cappello verde tenue screpolato a placchette come un mosaico, "
         + "lamelle bianche, gambo bianco cassante. La carne si rompe come "
         + "il gesso, non si sfilaccia.",
    confusioni: [
      ["Amanita phalloides", "mortale",
       "Anche la phalloides può presentarsi verde. Le russule NON hanno mai "
       + "anello né volva: se alla base c'è un sacco o sul gambo c'è un "
       + "anello, non è una russula. Va sempre scavato il piede per intero."],
    ],
  },
  {
    id: "sanguinello",
    nome: "Sanguinello",
    sci: "Lactarius deliciosus",
    habitat: "bosco",
    stagione: "Da settembre a novembre",
    dove: "Sotto i pini, anche nei rimboschimenti di conifere di Campaegli.",
    segni: "Cappello aranciato a zone concentriche, che si macchia di verde. "
         + "Al taglio emette un LATTICE ARANCIONE-CAROTA che vira lentamente "
         + "al verde. Solo sotto conifere.",
    confusioni: [
      ["Lactarius torminosus", "lieve",
       "Rosato, con margine del cappello barbuto e lattice BIANCO e piccante. "
       + "Sotto betulla. Provoca disturbi gastrointestinali."],
    ],
  },
];

export const GRAVITA = {
  mortale: ["Mortale", "Può uccidere"],
  grave:   ["Grave", "Intossicazione seria"],
  lieve:   ["Lieve", "Disturbi o fungo immangiabile"],
  nessuna: ["Sicuro", "Nessun sosia pericoloso"],
};
