/* Codici del tempo WMO usati da Open-Meteo, con icona e descrizione.
 *
 * Non c'e' nessun connettore meteo di mezzo: il dato e' lo stesso gia'
 * scaricato in CI per il modello di crescita, con in piu' il codice del
 * tempo, la probabilita' di pioggia e le raffiche.
 */

export const WMO = {
  0:  ["☀️", "Sereno"],
  1:  ["🌤️", "Poco nuvoloso"],
  2:  ["⛅", "Parzialmente nuvoloso"],
  3:  ["☁️", "Coperto"],
  45: ["🌫️", "Nebbia"],
  48: ["🌫️", "Nebbia con brina"],
  51: ["🌦️", "Pioviggine debole"],
  53: ["🌦️", "Pioviggine"],
  55: ["🌦️", "Pioviggine intensa"],
  56: ["🌨️", "Pioviggine gelata"],
  57: ["🌨️", "Pioviggine gelata intensa"],
  61: ["🌧️", "Pioggia debole"],
  63: ["🌧️", "Pioggia"],
  65: ["🌧️", "Pioggia forte"],
  66: ["🌨️", "Pioggia gelata"],
  67: ["🌨️", "Pioggia gelata forte"],
  71: ["🌨️", "Neve debole"],
  73: ["🌨️", "Neve"],
  75: ["❄️", "Neve forte"],
  77: ["❄️", "Granuli di neve"],
  80: ["🌦️", "Rovesci deboli"],
  81: ["🌧️", "Rovesci"],
  82: ["⛈️", "Rovesci violenti"],
  85: ["🌨️", "Rovesci di neve"],
  86: ["❄️", "Rovesci di neve forti"],
  95: ["⛈️", "Temporale"],
  96: ["⛈️", "Temporale con grandine"],
  99: ["⛈️", "Temporale forte con grandine"],
};

export const tempo = (c) => WMO[c] || ["❔", "non disponibile"];

const ROSA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

/** Gradi in punto cardinale. Per chi cerca funghi il vento conta soprattutto
 *  per la direzione: quello da sud asciuga, quello umido da ovest no. */
export const bussola = (g) => (g == null ? "" : ROSA[Math.round(g / 22.5) % 16]);

export const ora = (iso) => (iso ? iso.slice(11, 16) : "—");
