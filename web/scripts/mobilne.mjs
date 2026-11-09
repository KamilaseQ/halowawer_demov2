// Lżejsze warianty wnętrz dla telefonów (limit pamięci karty w iOS ok. 1–1,5 GB; pełne wnętrza + lightmapy
// przekraczały go i Chrome/Safari zamykały kartę: „Kurza twarz”).
//   - wnętrza z manifestu: wnetrze-X-vN.glb → wnetrze-X-vN-m.glb, tekstury maks. 512 px (geometria bez zmian)
//   - lightmapy z git (tex/*.webp) → tex/m/*.webp, maks. 2048 px
// Aplikacja na telefonie bierze te pliki, a gdy ich brak, wraca do pełnych (models.ts: MOBILNE).
// Uruchomić po każdej podmianie wnętrz/lightmap w manifeście:  npm run mobilne
// Zależności (sharp, gltf-transform) z pipeline/preview/node_modules (poza repozytorium).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.resolve(WEB, "../pipeline/preview/package.json"));
// ta sama kopia sharp, której używa gltf-transform (ndarray-pixels): dwie wersje libvips w jednym procesie się wykluczają
const sharp = createRequire(req.resolve("ndarray-pixels"))("sharp");
const { NodeIO } = req("@gltf-transform/core");
const { ALL_EXTENSIONS } = req("@gltf-transform/extensions");
const { textureCompress } = req("@gltf-transform/functions");
const { MeshoptDecoder, MeshoptEncoder } = req("meshoptimizer");

const MODELE = path.join(WEB, "public/models");
const TEX_GLB = 512;
const TEX_LM = 2048;

const man = JSON.parse(fs.readFileSync(path.join(MODELE, "manifest.json"), "utf8"));

// --- wnętrza ---
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});
for (const plik of Object.values(man.wnetrza ?? {})) {
  if (!plik) continue;
  const zrodlo = path.join(MODELE, plik);
  const cel = zrodlo.replace(/\.glb$/, "-m.glb");
  const doc = await io.read(zrodlo);
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEX_GLB, TEX_GLB], quality: 88 }));
  await io.write(cel, doc);
  console.log(`${plik} ${(fs.statSync(zrodlo).size / 2 ** 20).toFixed(1)} MB → ${path.basename(cel)} ${(fs.statSync(cel).size / 2 ** 20).toFixed(1)} MB`);
}

// --- lightmapy (te, które są w repozytorium) ---
const tex = path.join(MODELE, "tex");
fs.mkdirSync(path.join(tex, "m"), { recursive: true });
const wGit = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "public/models/tex"], { cwd: WEB, encoding: "utf8" })
  .split("\n").filter((f) => /^public\/models\/tex\/[^/]+\.webp$/.test(f));
for (const f of wGit) {
  const nazwa = path.basename(f);
  const img = sharp(path.join(WEB, f));
  const { width = 0, height = 0 } = await img.metadata();
  if (width <= TEX_LM && height <= TEX_LM) { fs.copyFileSync(path.join(WEB, f), path.join(tex, "m", nazwa)); continue; }
  await img.resize({ width: TEX_LM, height: TEX_LM, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, effort: 6 }).toFile(path.join(tex, "m", nazwa));
  console.log(`tex/${nazwa} ${width}×${height} → tex/m/ maks. ${TEX_LM}`);
}
