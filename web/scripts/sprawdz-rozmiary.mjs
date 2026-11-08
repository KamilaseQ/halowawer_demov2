// Kontrola rozmiarów plików w repozytorium: GitHub odrzuca pliki > 100 MB i ostrzega przy > 50 MB.
// Sprawdza pliki w indeksie gita (to, co trafi do commitu). Kod wyjścia 1, gdy którykolwiek przekracza limit.
//
// Użycie (z katalogu web/ albo jako hook pre-commit): node scripts/sprawdz-rozmiary.mjs [--limit 95] [--ostrzez 50]
// Gdy model z manifestu przekracza limit, podziel go: node scripts/podziel-duze.mjs
import { execFileSync } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MiB = 1024 * 1024;
const limit = arg("--limit", 95) * MiB;
const ostrzez = arg("--ostrzez", 50) * MiB;

const lista = execFileSync("git", ["ls-files", "-s", "-z"], { encoding: "utf8", maxBuffer: 64 * MiB }).split("\0").filter(Boolean);
const shaDoSciezki = new Map();
for (const w of lista) {
  const [meta, sciezka] = w.split("\t");
  shaDoSciezki.set(meta.split(" ")[1], sciezka);
}
const wynik = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objectsize)"], {
  input: [...shaDoSciezki.keys()].join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * MiB,
});
const rozmiary = wynik.trim().split("\n").map((l) => { const [sha, s] = l.split(" "); return { sciezka: shaDoSciezki.get(sha), bajty: +s }; });
rozmiary.sort((a, b) => b.bajty - a.bajty);

const zaDuze = rozmiary.filter((r) => r.bajty > limit);
const duze = rozmiary.filter((r) => r.bajty > ostrzez && r.bajty <= limit);
const mb = (b) => (b / MiB).toFixed(1);
console.log(`Plików w indeksie: ${rozmiary.length}, razem ${mb(rozmiary.reduce((s, r) => s + r.bajty, 0))} MiB, największy: ${rozmiary[0] ? `${rozmiary[0].sciezka} (${mb(rozmiary[0].bajty)} MiB)` : "—"}`);
for (const r of duze) console.log(`  ostrzeżenie (> ${mb(ostrzez)} MiB): ${r.sciezka} ${mb(r.bajty)} MiB`);
if (zaDuze.length) {
  for (const r of zaDuze) console.log(`  ZA DUŻY (> ${mb(limit)} MiB): ${r.sciezka} ${mb(r.bajty)} MiB`);
  console.log("Podziel modele: (w web/) node scripts/podziel-duze.mjs, a potem usuń oryginał z indeksu: git rm --cached <plik>");
  process.exit(1);
}
console.log("OK: żaden plik nie przekracza limitu.");
