import * as THREE from "three";
import type { DomInfo } from "./models";

/* Przekrój poziomy kondygnacji dla widoku „Rzut” (STANDARD_WIZUALNY §8a, ui3/ui9/ui10):
   - wszystko powyżej wysokości cięcia (ok. 1,3 m nad posadzką) jest odcinane płaszczyzną (local clipping);
   - ściany i schody dostają zamknięte, matowe wierzchy w ciepłej bieli.

   Wierzchy robimy bez dodatkowej geometrii i bez bufora szablonu: ściany są bryłami zamkniętymi, więc przez
   otwarte cięcie widać ich tylne ściany (BackSide). Rysujemy je płaskim kolorem, a głębię każdego fragmentu
   przenosimy na płaszczyznę cięcia (przecięcie promienia z kamery z y = h). Dzięki temu wierzch ma poprawną
   głębię: SSAO (N8AO czyta bufor głębi) i etykiety widzą płaski wierzch na wysokości cięcia, a nie dół ściany.
   Materiały architektury przełączamy w tym widoku na FrontSide (w GLB są dwustronne), żeby tylne ściany
   nie były rysowane materiałem ściany. */

// schody bez wierzchu: w rzucie mają być widoczne stopnie poniżej cięcia, a nie pełny blok biegu
const ARCH = /__SCIANY/;

/* Cięcie kondygnacji (09.11, zgłoszenie użytkownika): w widoku kondygnacji (Model 3D) wnętrze i bryła domu z osiedla
   są przycinane na wysokości wierzchów ścian tej kondygnacji (extras.wierzch na KOND_n), w Rzucie na wysokości przekroju.
   Bez tego ściany klatki schodowej z grupy parteru (SKP: jedna ściana na dwie kondygnacje, do 5,9 m) wystawały
   w widoku parteru. Wnętrza dzielą materiały między domami (scene.clone), a widoczne jest zawsze tylko jedno,
   więc płaszczyzna wnętrz jest wspólna; materiały mają ją na stałe (bez przełączania clippingPlanes = bez
   przekompilowania shaderów przy wejściu do widoku), a „wyłączenie” to przesunięcie płaszczyzny daleko w górę. */
export const DALEKO = 1e6;
export const PLASZCZYZNA_WNETRZ = new THREE.Plane(new THREE.Vector3(0, -1, 0), DALEKO);
let wlasciciel: Przekroj | null = null;

const VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vWp;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const FRAG = /* glsl */ `
uniform mat4 projectionMatrix;
uniform vec3 uKolor;
uniform float uH;
varying vec3 vWp;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec3 rd = vWp - cameraPosition;
  if (abs(rd.y) < 1e-5) discard;
  float t = (uH - cameraPosition.y) / rd.y;
  if (t <= 0.0 || t >= 1.0) discard;
  vec3 P = cameraPosition + rd * t;
  vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
  gl_FragDepth = clamp((cp.z / cp.w) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(uKolor, 1.0);
}`;

export interface Przekroj {
  plane: THREE.Plane;
  wierzch: THREE.ShaderMaterial;
  caps: THREE.Mesh[];
  mats: Set<THREE.Material>;
  arch: Set<THREE.Material>;
  /** gotowe wierzchy z GLB (KOND_n__PRZEKROJ, agent wnętrz): kondygnacja → siatki i wysokość cięcia (świat) */
  gotowe: Record<number, { obj: THREE.Object3D[]; h: number }>;
  on: boolean;
  lvl: number | null;
}

/** Ciepła biel wierzchów, liniowo przed tone mappingiem AgX. Dobrane pomiarem do celu b7 (P1-10) na ekranie:
    L* 90, a* 0…+1, b* +4…+6 (AgX mocno odbarwia jasne tony, stąd tak ciepły i jasny kolor wejściowy). */
const KOLOR = new THREE.Color().setRGB(3.05, 2.6, 1.75);

/* Wierzchy ścian (KOND_n__WIERZCHY w GLB od v19/v13, gotowe przekroje KOND_n__PRZEKROJ i zapasowe wierzchy z tylnych
   ścian) mają płaski kolor bez lightmapy, przyciemniany razem ze światłem dnia (jasnoscWierzchow, z Lighting).
   Wcześniej wierzchy w lightmapie wnętrza świeciły w nocy i przy niskim słońcu jak źródło światła. */
const koloryWierzchow: THREE.Color[] = [];
export const WIERZCH_SCIANY = new THREE.MeshBasicMaterial({ name: "WIERZCH_SCIANY", color: KOLOR.clone(), toneMapped: false });
koloryWierzchow.push(WIERZCH_SCIANY.color);
let jasnoscW = 1;
export function jasnoscWierzchow(k: number) {
  if (Math.abs(k - jasnoscW) < 1e-4) return false;
  jasnoscW = k;
  for (const c of koloryWierzchow) c.copy(KOLOR).multiplyScalar(k);
  return true;
}

export function utworzPrzekroj(root: THREE.Object3D): Przekroj {
  const plane = PLASZCZYZNA_WNETRZ;
  const wierzch = new THREE.ShaderMaterial({
    name: "PRZEKROJ_WIERZCH",
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uKolor: { value: KOLOR.clone() }, uH: { value: 0 } },
    side: THREE.BackSide,
    clipping: true,
    clippingPlanes: [plane],
    toneMapped: false,
  });
  const p: Przekroj = { plane, wierzch, caps: [], mats: new Set(), arch: new Set(), gotowe: {}, on: false, lvl: null };
  // Gotowe wierzchy z GLB (od v12/v6): płaska siatka na wysokości cięcia − 2 mm, z poszerzonymi ściankami
  // bez grubości. Gdy są, nie robimy wierzchów z tylnych ścian (ściany SKP nie są bryłami zamkniętymi;
  // tylne ściany poziomych kawałków podłogi w SCIANY dawały fałszywe wierzchy na podłodze, R02-01).
  const plaski = new THREE.MeshBasicMaterial({ name: "PRZEKROJ", color: KOLOR.clone().multiplyScalar(jasnoscW), toneMapped: false });
  (wierzch.uniforms.uKolor.value as THREE.Color).multiplyScalar(jasnoscW);
  koloryWierzchow.push(wierzch.uniforms.uKolor.value as THREE.Color, plaski.color);
  // hak strojenia koloru wierzchów (QA): window.__wierzchy = [kolory uniformów i materiałów]
  const w = window as unknown as { __wierzchy?: THREE.Color[] };
  (w.__wierzchy ??= []).push(wierzch.uniforms.uKolor.value as THREE.Color, plaski.color);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const g = /^KOND_(\d+)__PRZEKROJ/.exec(o.name);
    if (!g) return;
    const k = +g[1];
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    o.visible = false;
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh) {
        m.material = plaski;
        m.castShadow = false;
        m.receiveShadow = false;
        m.raycast = () => {};
      }
    });
    (p.gotowe[k] ??= { obj: [], h: box.max.y + 0.002 }).obj.push(o);
  });
  const maGotowe = Object.keys(p.gotowe).length > 0;
  // najpierw lista siatek: dodawanie dzieci w trakcie traverse zapętlało przechodzenie
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name !== "PRZEKROJ" && !/__PRZEKROJ/.test(ancestorName(o))) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const list = Array.isArray(m.material) ? m.material : [m.material];
    // Zapasowe wierzchy z tylnych ścian tylko na żądanie (?wierzchy=tyl). Ściany SKP nie są bryłami zamkniętymi,
    // więc tylne ściany poziomych kawałków podłóg w SCIANY rysowały na posadzkach białe wieloboki (zgłoszenie
    // użytkownika 08.11, rzuty 5/6/7/9 na wnętrzach v11/v5). Bez gotowych KOND_n__PRZEKROJ lepiej rzut bez wierzchów niż fałszywe plamy.
    const zapasowe = new URLSearchParams(location.search).get("wierzchy") === "tyl";
    const isArch = !maGotowe && zapasowe && ARCH.test(ancestorName(m));
    for (const mat of list) {
      p.mats.add(mat);
      if (isArch) p.arch.add(mat);
      // płaszczyzna na stałe (DALEKO = bez cięcia): ten sam wariant shadera we wszystkich widokach
      mat.clippingPlanes = [plane];
    }
    if (isArch) {
      const cap = new THREE.Mesh(m.geometry, wierzch);
      cap.name = "PRZEKROJ";
      cap.visible = false;
      cap.castShadow = false;
      cap.receiveShadow = false;
      cap.raycast = () => {};
      m.add(cap);
      p.caps.push(cap);
    }
  }
  return p;
}

/** h = wysokość cięcia w świecie albo null (bez cięcia); lvl = kondygnacja; rzut = widok Rzut (gotowy wierzch przekroju
    KOND_n__PRZEKROJ ma pierwszeństwo wysokości, żeby płaszczyzna trafiła dokładnie 2 mm nad wierzch). W widoku
    kondygnacji (rzut = false) tniemy na wysokości wierzchów ścian, bez gotowych przekrojów.
    Zwraca użytą wysokość (albo null). Płaszczyznę wnętrz zmienia tylko dom, który ją ustawił (kolejność subskrypcji). */
export function ustawPrzekroj(p: Przekroj, h: number | null, lvl = 0, rzut = true): number | null {
  const got = h !== null && rzut ? p.gotowe[lvl] : undefined;
  if (got) h = got.h;
  const on = h !== null;
  if (on) {
    p.plane.constant = h!;
    p.wierzch.uniforms.uH.value = h;
    wlasciciel = p;
  } else if (wlasciciel === p) {
    p.plane.constant = DALEKO;
    wlasciciel = null;
  }
  for (const [k, g] of Object.entries(p.gotowe)) for (const o of g.obj) o.visible = on && rzut && +k === lvl;
  p.lvl = on ? lvl : null;
  const naRzut = on && rzut;
  if (naRzut === p.on) return h;
  p.on = naRzut;
  for (const mat of p.arch) {
    if (naRzut) {
      mat.userData.sidePrzed ??= mat.side;
      mat.side = THREE.FrontSide;
    } else if (mat.userData.sidePrzed !== undefined) {
      mat.side = mat.userData.sidePrzed;
    }
    mat.needsUpdate = true;
  }
  for (const c of p.caps) c.visible = naRzut;
  return h;
}

/** Bryła domu z osiedla w widoku kondygnacji: cięcie na wysokości h (null = cała bryła). Elewacja leży w płaszczyźnie
    zewnętrznego lica ścian wnętrza (przekrój 1,6 m i 2,9 m, dom B): przesunięcie głębi daje pierwszeństwo elewacji
    (bez migotania z białym licem wnętrza). Materiały bryły są dwustronne, więc po zdjęciu dachu od środka widać
    tylne strony elewacji (podbitka wnęki wejścia, brama garażu): w widoku przyciętym tylko strona elewacji (FrontSide);
    oba warianty shaderów kompiluje rozgrzewka (Stage: wariantySkorupy). Cień też przycięty (clipShadows). */
export function ustawSkorupe(d: DomInfo, h: number | null) {
  const on = h !== null;
  d.ciecie.constant = on ? h! : DALEKO;
  if (d.obj.userData.ciecieOn === on) return;
  d.obj.userData.ciecieOn = on;
  stronySkorupy(d, on);
}
function stronySkorupy(d: DomInfo, on: boolean) {
  for (const m of d.meshes) {
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mat.polygonOffset = on;
      mat.polygonOffsetFactor = on ? -1 : 0;
      mat.polygonOffsetUnits = on ? -2 : 0;
      mat.userData.sideSkorupy ??= mat.side;
      const side = on ? THREE.FrontSide : (mat.userData.sideSkorupy as THREE.Side);
      if (mat.side !== side) {
        mat.side = side;
        mat.needsUpdate = true;
      }
    }
  }
}
/** Rozgrzewka: wariant FrontSide bryły wszystkich domów (fn kompiluje scenę), potem powrót do stanu bieżącego. */
export async function wariantySkorupy(domy: Iterable<DomInfo>, fn: () => Promise<unknown>) {
  const lista = [...domy];
  for (const d of lista) stronySkorupy(d, true);
  await fn();
  for (const d of lista) stronySkorupy(d, !!d.obj.userData.ciecieOn);
}

function ancestorName(o: THREE.Object3D): string {
  let x: THREE.Object3D | null = o;
  const names: string[] = [];
  while (x) {
    if (x.name) names.push(x.name);
    x = x.parent;
  }
  return names.join("/");
}
