// Dzielenie dużych plików modeli na części, żeby żaden plik w repozytorium nie przekraczał limitu GitHuba (100 MB).
// Aplikacja skleja części przy wczytywaniu (web/src/three/models.ts: czesci.json), więc model działa tak samo.
//
// Użycie (z katalogu web/):
//   node scripts/podziel-duze.mjs [--limit 95] [--czesc 90] [--plik nazwa.glb]
//     --limit  próg w MiB: dzielone są pliki z manifest.json większe niż próg (domyślnie 95)
//     --czesc  rozmiar jednej części w MiB (domyślnie 90)
//     --plik   tylko ten plik (np. do testu z małym limitem)
// Wynik: public/models/<plik>.czesc-01, -02, … oraz wpis w public/models/czesci.json; oryginał zostaje lokalnie,
// a w ../.gitignore jego wyjątek z białej listy zastępuje wzorzec części. Pliki poniżej progu są nietknięte.
import fs from "node:fs";
import path from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MiB = 1024 * 1024;
const limit = +arg("--limit", 95) * MiB;
const czesc = +arg("--czesc", 90) * MiB;
const tylko = arg("--plik", null);
const KAT = path.resolve("public/models");
const manifest = JSON.parse(fs.readFileSync(path.join(KAT, "manifest.json"), "utf8"));
const mapaPlik = path.join(KAT, "czesci.json");
const mapa = fs.existsSync(mapaPlik) ? JSON.parse(fs.readFileSync(mapaPlik, "utf8")) : {};

const pliki = [manifest.osiedle, manifest.zielen, manifest.okolica, ...Object.values(manifest.wnetrza ?? {})].filter(Boolean);
const doPodzialu = pliki.filter((f) => (!tylko || f === tylko) && fs.existsSync(path.join(KAT, f)) && fs.statSync(path.join(KAT, f)).size > limit);
if (!doPodzialu.length) {
  console.log(`Brak plików z manifestu większych niż ${(limit / MiB).toFixed(0)} MiB — nic do dzielenia.`);
  process.exit(0);
}

const gitignore = path.resolve("../.gitignore");
let gi = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
for (const f of doPodzialu) {
  const dane = fs.readFileSync(path.join(KAT, f));
  const czesci = [];
  for (let off = 0, i = 1; off < dane.length; off += czesc, i++) {
    const nazwa = `${f}.czesc-${String(i).padStart(2, "0")}`;
    fs.writeFileSync(path.join(KAT, nazwa), dane.subarray(off, Math.min(off + czesc, dane.length)));
    czesci.push(nazwa);
  }
  mapa[f] = { czesci, bajty: dane.length };
  console.log(`${f}: ${(dane.length / MiB).toFixed(1)} MiB → ${czesci.length} części`);
  // biała lista .gitignore: zamiast oryginału jego części
  const wyjatek = `!/web/public/models/${f}`;
  const wzorzec = `!/web/public/models/${f}.czesc-*`;
  // linia wyjątku z dowolnym końcem linii (plik może mieć mieszane CRLF/LF)
  const linie = gi.split("\n");
  const i = linie.findIndex((l) => l.replace(/\r$/, "") === wyjatek);
  if (i >= 0) linie[i] = wzorzec + (linie[i].endsWith("\r") ? "\r" : "");
  else if (!linie.some((l) => l.replace(/\r$/, "") === wzorzec)) {
    if (linie[linie.length - 1] === "") linie.pop();
    linie.push(wzorzec, "");
  }
  gi = linie.join("\n");
}
fs.writeFileSync(mapaPlik, JSON.stringify(mapa, null, 2) + "\n");
if (gi) fs.writeFileSync(gitignore, gi);
console.log("Zapisano public/models/czesci.json i zaktualizowano .gitignore. Sprawdź: node scripts/sprawdz-rozmiary.mjs");
