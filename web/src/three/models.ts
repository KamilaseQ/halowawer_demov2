import * as THREE from "three";
import { suspend } from "suspend-react";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { DomId } from "../data/domy";
import type { PunktSpaceru } from "../state/store";

export interface Manifest {
  osiedle?: string | null;
  zielen?: string | null;
  okolica?: string | null;
  wnetrza?: Record<string, string | null> | null;
  domy?: Record<string, { wnetrze: string; macierz: number[] | null }> | null;
  uwagi?: string;
}

export const modelUrl = (f: string) => `/models/${f}`;

export function useManifest(): Manifest {
  return suspend(async () => {
    const r = await fetch(`/models/manifest.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return {};
    const m = (await r.json()) as Manifest;
    // porównania kandydatów bez przełączania manifestu: ?osiedle=…&zielen=…&okolica=…
    const q = new URLSearchParams(location.search);
    for (const k of ["osiedle", "zielen", "okolica"] as const) if (q.get(k)) m[k] = q.get(k);
    return m;
  }, ["manifest"]);
}

/* Jeden wspólny loader (meshopt + draco lokalnie), z postępem dla UI. */
const draco = new DRACOLoader().setDecoderPath("/draco/");
export const loadingManager = THREE.DefaultLoadingManager;
const loader = new GLTFLoader(loadingManager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

/** KTX2/Basis (tekstury skompresowane na GPU): wymaga renderera do wykrycia formatów, więc włączane z Stage.onCreated. */
export function initKtx2(gl: THREE.WebGLRenderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
  loader.setKTX2Loader(ktx2);
}

export function useGLB(url: string): GLTF {
  return suspend(() => loader.loadAsync(url), ["glb", url]);
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
};

export function findAncestorDom(o: THREE.Object3D | null): DomId | null {
  while (o) {
    const m = /^DOM_([A-G])$/.exec(o.name);
    if (m) return m[1] as DomId;
    o = o.parent;
  }
  return null;
}
