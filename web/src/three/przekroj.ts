import * as THREE from "three";

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

export function utworzPrzekroj(root: THREE.Object3D): Przekroj {
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
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
  const plaski = new THREE.MeshBasicMaterial({ name: "PRZEKROJ", color: KOLOR.clone(), toneMapped: false });
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

/** h = wysokość cięcia w świecie albo null (bez przekroju); lvl = kondygnacja (wybór gotowego wierzchu,
    którego wysokość ma pierwszeństwo, żeby płaszczyzna cięcia trafiła dokładnie 2 mm nad wierzch). */
export function ustawPrzekroj(p: Przekroj, h: number | null, lvl = 0) {
  const got = h !== null ? p.gotowe[lvl] : undefined;
  if (got) h = got.h;
  const on = h !== null;
  if (on) {
    p.plane.constant = h!;
    p.wierzch.uniforms.uH.value = h;
  }
  for (const [k, g] of Object.entries(p.gotowe)) for (const o of g.obj) o.visible = on && +k === lvl;
  p.lvl = on ? lvl : null;
  if (on === p.on) return;
  p.on = on;
  for (const mat of p.mats) {
    mat.clippingPlanes = on ? [p.plane] : null;
    if (p.arch.has(mat)) {
      if (on) {
        mat.userData.sidePrzed ??= mat.side;
        mat.side = THREE.FrontSide;
      } else if (mat.userData.sidePrzed !== undefined) {
        mat.side = mat.userData.sidePrzed;
      }
    }
    mat.needsUpdate = true;
  }
  for (const c of p.caps) c.visible = on;
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
