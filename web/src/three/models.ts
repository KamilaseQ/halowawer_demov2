import * as THREE from "three";
import { suspend } from "suspend-react";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { DomId } from "../data/domy";
import type { PunktSpaceru } from "../state/store";
import type { Przekroj } from "./przekroj";
import type { Lustro } from "./lustra";

export interface Manifest {
  osiedle?: string | null;
  zielen?: string | null;
  okolica?: string | null;
  wnetrza?: Record<string, string | null> | null;
  domy?: Record<string, { wnetrze: string; macierz: number[] | null }> | null;
  uwagi?: string;
}

export const modelUrl = (f: string) => `/models/${f}`;

/** Telefony i tablety (iOS ma limit pamięci karty ok. 1–1,5 GB; pełne wnętrza z lightmapami go przekraczały
    i przeglądarka zamykała kartę). Wnętrza z teksturami maks. 512 px (wnetrze-…-m.glb), lightmapy maks. 2048 px
    (tex/m/), lżejszy obraz (Stage, Lighting). Pliki robi scripts/mobilne.mjs; gdy ich brak, wracamy do pełnych.
    Test na komputerze: ?mobile=1 (albo ?mobile=0, żeby wyłączyć na telefonie). */
export const MOBILNE = (() => {
  const q = new URLSearchParams(location.search).get("mobile");
  if (q === "1" || q === "0") return q === "1";
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
})();
/** wariant mobilny pliku (wnętrze GLB albo lightmapa), null gdy nie ma */
export function adresMobilny(url: string): string | null {
  if (!MOBILNE) return null;
  if (/\/wnetrze-[^/]+\.glb$/.test(url) && !url.endsWith("-m.glb")) return url.replace(/\.glb$/, "-m.glb");
  if (/\/tex\/[^/]+\.webp$/.test(url)) return url.replace(/\/tex\//, "/tex/m/");
  return null;
}
/** MOBILNE: obraz tekstury (ImageBitmap) zwalniany zaraz po wysłaniu na GPU, żeby nie trzymać drugiej kopii w pamięci */
export function zwolnijPoWysylce(t: THREE.Texture) {
  if (!MOBILNE || typeof ImageBitmap === "undefined") return;
  t.onUpdate = () => {
    if (t.image instanceof ImageBitmap) t.image.close();
    t.onUpdate = null;
  };
}

/** Krok 2 planu użytkownika (docs/04-ladowanie.md): architektura ładowania i płynności. Domyślnie włączona
    od 08.11 (po zamknięciu kroku 1); stara ścieżka tylko do porównań: ?ladowanie=stare. */
export const NOWE_LADOWANIE = new URLSearchParams(location.search).get("ladowanie") !== "stare";

if (NOWE_LADOWANIE) {
  // raycast z drzewem BVH (three-mesh-bvh): celownik spaceru, widoczność znaczników i kliknięcia liczyły
  // promienie przez całe wnętrze (ok. 300 tys. trójkątów) w wątku głównym, co dawało przycięcia w spacerze.
  // Drzewa budujemy przy wczytaniu modelu (za ekranem ładowania), a geometria klonów domów jest współdzielona.
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  // dekodowanie meshopt w workerach zamiast w wątku głównym
  MeshoptDecoder.useWorkers?.(4);
}

/* ---------- postęp ładowania w bajtach (NOWE_LADOWANIE) ----------
   Rozmiary plików znamy z góry (HEAD w zglosPliki), postęp z onProgress loaderów. */
const bajty = new Map<string, { pobrane: number; razem: number }>();
let ramkaPostepu = 0;
function publikujPostep() {
  if (ramkaPostepu) return;
  ramkaPostepu = requestAnimationFrame(() => {
    ramkaPostepu = 0;
    let p = 0, r = 0;
    for (const b of bajty.values()) { p += Math.min(b.pobrane, b.razem || b.pobrane); r += b.razem || b.pobrane; }
    // import leniwy: store importuje typy z models, więc unikamy cyklu przy starcie modułu
    void import("../state/store").then(({ useStan }) => useStan.getState().set({ bajtyPobrane: p, bajtyRazem: r }));
  });
}
export function postepPliku(url: string, pobrane: number, razem?: number) {
  const b = bajty.get(url) ?? { pobrane: 0, razem: 0 };
  b.pobrane = Math.max(b.pobrane, pobrane);
  if (razem) b.razem = Math.max(b.razem, razem);
  bajty.set(url, b);
  publikujPostep();
}
export function zakonczPlik(url: string) {
  const b = bajty.get(url);
  if (b) { b.pobrane = b.razem || b.pobrane; publikujPostep(); }
}
/** Zgłoszenie listy plików z rozmiarami (HEAD), żeby pasek znał całość od pierwszej sekundy. */
export function zglosPliki(urls: string[]) {
  // modele podzielone na części: zgłaszamy części (postęp liczony z ich pobierania)
  urls = urls.flatMap((u) => {
    const opis = czesci[u.slice(u.lastIndexOf("/") + 1)];
    return opis ? opis.czesci.map((c) => u.slice(0, u.lastIndexOf("/") + 1) + c) : [u];
  });
  for (const u of urls) {
    if (bajty.has(u)) continue;
    bajty.set(u, { pobrane: 0, razem: 0 });
    void fetch(u, { method: "HEAD" }).then((r) => postepPliku(u, 0, +(r.headers.get("content-length") ?? 0))).catch(() => {});
  }
}

function drzewaBVH(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const g = m.geometry;
    if (!g.boundsTree && g.attributes.position && g.attributes.position.count >= 64) g.computeBoundsTree();
  });
}

export function useManifest(): Manifest {
  return suspend(async () => {
    // porównania kandydatów bez przełączania manifestu:
    //   ?manifest=manifest-kandydat.json  (cały manifest kandydata: wnętrza z lightmapami, zewnętrze)
    //   ?osiedle=…&zielen=…&okolica=…     (podmiana pojedynczych plików, nadpisuje manifest)
    const q = new URLSearchParams(location.search);
    const mf = q.get("manifest");
    const plik = mf && /^manifest[\w-]*\.json$/.test(mf) ? mf : "manifest.json";
    const r = await fetch(`/models/${plik}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return {};
    const m = (await r.json()) as Manifest;
    for (const k of ["osiedle", "zielen", "okolica"] as const) if (q.get(k)) m[k] = q.get(k);
    // modele podzielone na części (limit plików GitHuba 100 MB, scripts/podziel-duze.mjs): czesci.json
    const rc = await fetch(`/models/czesci.json?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    czesci = rc && rc.ok ? ((await rc.json().catch(() => ({}))) as typeof czesci) : {};
    reg.manifest = m;
    return m;
  }, ["manifest"]);
}

/** plik modelu → jego części (gdy był większy niż limit repozytorium) */
let czesci: Record<string, { czesci: string[]; bajty: number }> = {};

/** Pobranie modelu złożonego z części: części pobierane równolegle, sklejane w jeden bufor GLB. */
async function pobierzCzesci(url: string, opis: { czesci: string[]; bajty: number }): Promise<ArrayBuffer> {
  const baza = url.slice(0, url.lastIndexOf("/") + 1);
  const bufory = await Promise.all(
    opis.czesci.map(async (c) => {
      const adres = baza + c;
      const r = await fetch(adres);
      if (!r.ok || !r.body) throw new Error(`brak części modelu: ${adres}`);
      const razem = +(r.headers.get("content-length") ?? 0);
      const czytnik = r.body.getReader();
      const kawalki: Uint8Array[] = [];
      let pobrane = 0;
      for (;;) {
        const { done, value } = await czytnik.read();
        if (done) break;
        kawalki.push(value);
        pobrane += value.length;
        if (NOWE_LADOWANIE) postepPliku(adres, pobrane, razem);
      }
      if (NOWE_LADOWANIE) zakonczPlik(adres);
      return kawalki;
    }),
  );
  const wynik = new Uint8Array(opis.bajty);
  let off = 0;
  for (const kawalki of bufory) for (const k of kawalki) { wynik.set(k, off); off += k.length; }
  if (off !== opis.bajty) throw new Error(`model ${url}: ${off} B zamiast ${opis.bajty} B`);
  return wynik.buffer;
}

/* Jeden wspólny loader (meshopt + draco lokalnie), z postępem dla UI. */
const draco = new DRACOLoader().setDecoderPath("/draco/");
export const loadingManager = THREE.DefaultLoadingManager;
const loader = new GLTFLoader(loadingManager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

/** KTX2/Basis (tekstury skompresowane na GPU): wymaga renderera do wykrycia formatów, więc włączane z Stage.onCreated. */
/** loader KTX2 współdzielony z lightmapami wnętrz (NOWE_LADOWANIE + lm=ktx2) */
export let ktx2Loader: KTX2Loader | null = null;
/** lightmapy wnętrz w KTX2 (UASTC, skompresowane na GPU): wszystkie domy za ekranem ładowania */
export const LM_KTX2 = NOWE_LADOWANIE && new URLSearchParams(location.search).get("lm") === "ktx2";

export function initKtx2(gl: THREE.WebGLRenderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
  loader.setKTX2Loader(ktx2);
  ktx2Loader = ktx2;
  maxAniso = Math.min(16, gl.capabilities.getMaxAnisotropy());
}

/** Filtrowanie anizotropowe dla wszystkich tekstur modeli (b7 iter18 P1-5): bez niego posadzki, kostka
    i forniry oglądane pod kątem się rozmywały, a fugi jodełki znikały. Lightmapy wnętrz dostają to samo (anizotropiaMax()
    w Interiors.lmTexture): ściany widziane z góry pod ostrym kątem brały bardzo grube mipmapy i wyglądały jak schodkowe klocki (e3 R11). */
let maxAniso = 8;
export const anizotropiaMax = () => maxAniso;
const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap", "emissiveMap", "alphaMap", "clearcoatNormalMap"] as const;
function anizotropia(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const k of TEX_KEYS) {
        const t = (mat as unknown as Record<string, THREE.Texture | null>)[k];
        if (t && t.anisotropy < maxAniso) { t.anisotropy = maxAniso; t.needsUpdate = true; }
      }
    }
  });
}

export function useGLB(url: string): GLTF {
  return suspend(async () => {
    const plik = url.slice(url.lastIndexOf("/") + 1);
    const postep = NOWE_LADOWANIE ? (e: ProgressEvent) => postepPliku(url, e.loaded, e.total) : undefined;
    const mobilny = adresMobilny(url);
    const g = czesci[plik]
      ? await loader.parseAsync(await pobierzCzesci(url, czesci[plik]), url.slice(0, url.lastIndexOf("/") + 1))
      : mobilny
        ? await loader.loadAsync(mobilny, postep).catch(() => loader.loadAsync(url, postep))
        : await loader.loadAsync(url, postep);
    if (NOWE_LADOWANIE) zakonczPlik(url);
    anizotropia(g.scene);
    if (MOBILNE) {
      // obraz zwalniamy tylko, gdy ma jedną teksturę (GLTFLoader klonuje tekstury ze wspólnym obrazem przy innym samplerze,
      // a każdy klon wysyła obraz na GPU osobno)
      const wgObrazu = new Map<THREE.Texture["source"], Set<THREE.Texture>>();
      g.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) for (const k of TEX_KEYS) {
          const t = (mat as unknown as Record<string, THREE.Texture | null>)[k];
          if (t) { const s = wgObrazu.get(t.source) ?? new Set(); s.add(t); wgObrazu.set(t.source, s); }
        }
      });
      for (const s of wgObrazu.values()) if (s.size === 1) zwolnijPoWysylce([...s][0]);
    }
    if (NOWE_LADOWANIE) drzewaBVH(g.scene);
    return g;
  }, ["glb", url]);
}

/* ---------- rejestr obiektów sceny (dzielony między komponentami, bez React) ---------- */
export interface DomInfo {
  id: DomId;
  obj: THREE.Object3D;
  box: THREE.Box3;
  center: THREE.Vector3;
  /** Poziom terenu przy domu (dół bryły). */
  ground: number;
  meshes: THREE.Mesh[];
  /** Materiały tylko tego domu (klony) do podświetlenia. */
  mats: THREE.MeshStandardMaterial[];
  /** płaszczyzna cięcia bryły tego domu (widoki kondygnacji, przekroj.ts: ustawSkorupe); materiały bryły to klony per dom */
  ciecie: THREE.Plane;
}

/** Kamera sceny SKP (kadr renderu referencyjnego), kontrakt KADR_n (agent wnętrz). */
export interface Kadr {
  id: string;
  ref: string;
  pokoj: string;
  etykieta: string;
  fov: number;
  near: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** start spaceru: oko przesunięte przed przeszkodę */
  spacer: THREE.Vector3;
}

export interface WnetrzeInfo {
  root: THREE.Object3D;
  kadry: Kadr[];
  /** kond → poziom posadzki (świat) */
  poziomy: Record<number, number>;
  podlogi: THREE.Mesh[];
  punkty: PunktSpaceru[];
  kond: Record<number, THREE.Object3D>;
  sufity: Record<number, THREE.Object3D[]>;
  /** przekrój poziomy dla widoku Rzut (przekroj.ts) */
  przekroj?: Przekroj;
  /** kond → wysokość wierzchów ścian (świat), z extras.wierzch na KOND_n (GLB od v19/v13) */
  wierzchy?: Record<number, number>;
  /** start spaceru zapisany przy punkcie w GLB (PKT_n_* extras.spacer / extras.cel, świat) */
  startyPunktow?: Record<string, { pos: THREE.Vector3; cel: THREE.Vector3 }>;
  /** lustra (lustra.ts) */
  lustra?: Lustro[];
  lustraGrupa?: THREE.Group;
  /** skrzydła drzwi (węzły DRZWI_*, oś obrotu w początku węzła): w GLB otwarte (spacer),
      extras.render = kwaternion [x,y,z,w] pozy z renderów SKP (kadry 1:1 z referencją) */
  drzwi?: {
    obj: THREE.Object3D;
    otwarte: THREE.Quaternion;
    render: THREE.Quaternion;
    /** opcjonalna druga lightmapa skrzydła wypieczona w pozie z renderów (extras.lightMapRender): materiały obu póz */
    lm?: { mesh: THREE.Mesh; otwarte: THREE.Material | THREE.Material[]; render: THREE.Material | THREE.Material[] }[];
  }[];
}

/** Drzwi jak na renderach (kadr 1:1) albo otwarte (spacer i pozostałe widoki). */
export function ustawDrzwi(w: WnetrzeInfo, jakNaRenderze: boolean) {
  if (!w.drzwi) return;
  for (const d of w.drzwi) {
    d.obj.quaternion.copy(jakNaRenderze ? d.render : d.otwarte);
    for (const l of d.lm ?? []) l.mesh.material = jakNaRenderze ? l.render : l.otwarte;
  }
  reg.odswiezCienie();
}

export const reg = {
  domy: new Map<DomId, DomInfo>(),
  grunt: [] as THREE.Object3D[],
  przeszkody: [] as THREE.Object3D[],
  punktyOsiedla: [] as PunktSpaceru[],
  osiedleBox: new THREE.Box3(new THREE.Vector3(0, -1, -110), new THREE.Vector3(130, 12, 0)),
  wnetrza: new Map<DomId, WnetrzeInfo>(),
  /** materiały sterowane porą dnia */
  szyby: [] as THREE.MeshPhysicalMaterial[],
  lampy: [] as THREE.MeshStandardMaterial[],
  /** środki kul ogrodowych LAMPA_KULA_* (świat) */
  kule: [] as THREE.Vector3[],
  /** siatki domu pod kursorem (obrys w Stage) i powiadomienie o zmianie */
  podswietlone: [] as THREE.Object3D[],
  onPodswietlenie: null as null | (() => void),
  /** cienie statyczne (NOWE_LADOWANIE): mapa cieni liczona tylko po zmianie słońca lub widoczności, nie w każdej klatce */
  odswiezCienie: () => {},
  /** lightmapy w trakcie dekodowania (NOWE_LADOWANIE, ImageBitmap w tle): __ready czeka na 0 */
  lmOczekujace: 0,
  /** manifest po wczytaniu (dostęp poza hookami, np. kamera sprawdza, czy dom ma wnętrze) */
  manifest: null as Manifest | null,
};

/** Czy dom ma wnętrze w manifeście (nawet jeśli jeszcze się wczytuje). */
export function maWnetrze(id: DomId | null): boolean {
  const m = reg.manifest;
  if (!id || !m?.domy || !m.wnetrza) return false;
  const d = m.domy[id];
  return !!(d && m.wnetrza[d.wnetrze]);
}

export function findAncestorDom(o: THREE.Object3D | null): DomId | null {
  while (o) {
    const m = /^DOM_([A-G])$/.exec(o.name);
    if (m) return m[1] as DomId;
    o = o.parent;
  }
  return null;
}
