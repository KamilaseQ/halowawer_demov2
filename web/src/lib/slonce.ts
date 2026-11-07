/* Położenie słońca (algorytm NOAA, dokładność ~0,5°) dla osiedla w Wawrze: 52,2°N, 21,12°E.
   Czas zegarowy: CET (UTC+1), a od kwietnia do października CEST (UTC+2). Dzień: 21. dzień miesiąca.
   Azymut: od północy w stronę wschodu (jak kompas), wysokość: nad horyzontem. */

/** Kalibracja stron świata: o ile stopni (zgodnie z ruchem wskazówek) oś −Z modelu jest obrócona względem
    północy geograficznej. SKP: North Angle = 0° (fronty dokładnie na N, ogrody na S), ale bez georeferencji
    z mapy, więc gdy klient poda azymut działki, wystarczy wpisać go tutaj (słońce i kompas obrócą się razem). */
export const KAT_PN = 0;

export const LAT = 52.2;
export const LON = 21.12;
export const MIESIACE = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
export const MIESIACE_DOP = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
export const MIESIACE_KR = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

const rad = Math.PI / 180;

function dayOfYear(month: number, day = 21) {
  const d = Date.UTC(2026, month - 1, day);
  return Math.floor((d - Date.UTC(2026, 0, 1)) / 86400000) + 1;
}
export const strefa = (month: number) => (month >= 4 && month <= 10 ? 2 : 1);

export function sunPosition(month: number, hour: number): { az: number; el: number } {
  const n = dayOfYear(month);
  const tz = strefa(month);
  const g = ((2 * Math.PI) / 365) * (n - 1 + (hour - tz - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqtime + 4 * LON - 60 * tz;
  const H = (tst / 4 - 180) * rad;
  const phi = LAT * rad;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / rad;
  const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const az = (A / rad + 180 + 360) % 360;
  return { az, el };
}

/** Wschód i zachód (godziny zegarowe, z dokładnością do 5 min) dla 21. dnia miesiąca. */
export function dzien(month: number): [number, number] {
  let rise = 12, set = 12;
  for (let h = 12; h > 2; h -= 1 / 12) if (sunPosition(month, h).el > 0) rise = h; else break;
  for (let h = 12; h < 23; h += 1 / 12) if (sunPosition(month, h).el > 0) set = h; else break;
  return [rise, set];
}

export const fmtGodz = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

const KIER = ["Pn", "Pn-Wsch", "Wsch", "Pd-Wsch", "Pd", "Pd-Zach", "Zach", "Pn-Zach"];
export const kierunek = (az: number) => KIER[Math.round(az / 45) % 8];
