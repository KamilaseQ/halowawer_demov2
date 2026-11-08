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
    reg.manifest = m;
    return m;
  }, ["manifest"]);
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
    const g = await loader.loadAsync(url, NOWE_LADOWANIE ? (e: ProgressEvent) => postepPliku(url, e.loaded, e.total) : undefined);
    if (NOWE_LADOWANIE) zakonczPlik(url);
    anizotropia(g.scene);
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
