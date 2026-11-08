import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { NOWE_LADOWANIE } from "./models";

/** warstwa siatek wnętrz: kamera odbicia lustra widzi tylko ją (NOWE_LADOWANIE) */
export const WARSTWA_WNETRZ = 2;

/* Lustra we wnętrzach (materiał LUSTRO*, agent wnętrz od v12): płaskie odbicie (Reflector) zamiast metalu
   z mapą nieba. Mapa otoczenia odbijała niebo HDRI, więc lustro w sypialni wyglądało jak szary beton
   (b7 iter18 P1-2). Reflector renderuje scenę z kamery odbitej w płaszczyźnie lustra, tylko gdy lustro
   jest w kadrze. Budujemy go w układzie świata (dom może mieć macierz lustrzaną z wyznacznikiem −1),
   a widoczność synchronizujemy z rodzicem oryginalnej siatki. */

export interface Lustro {
  src: THREE.Mesh;
  refl: Reflector;
}

export function zbudujLustra(meshes: THREE.Mesh[], group: THREE.Group): Lustro[] {
  const out: Lustro[] = [];
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    if (!pos || pos.count < 3) continue;
    const idx = m.geometry.index;
    const ia = idx ? idx.getX(0) : 0, ib = idx ? idx.getX(1) : 1, ic = idx ? idx.getX(2) : 2;
    const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
    const b = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
    const c = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    // normalna ma wskazywać do pokoju: od środka bryły domu, czyli w stronę, z której patrzy materiał
    // (front face); przy macierzy lustrzanej kolejność wierzchołków się odwraca
    if (m.matrixWorld.determinant() < 0) n.negate();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, d = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const pu = p.dot(u), pv = p.dot(v);
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
      d += p.dot(n);
    }
    d /= pos.count;
    const w = u1 - u0, h = v1 - v0;
    if (w < 0.05 || h < 0.05) continue;
    const center = new THREE.Vector3().addScaledVector(u, (u0 + u1) / 2).addScaledVector(v, (v0 + v1) / 2).addScaledVector(n, d + 0.003);
    const res = 1024;
    // kształt odbicia = kształt tafli z GLB (okrągłe lustro zostaje okrągłe). Wcześniej prostokąt z ramki
    // wychodził poza okrągłą ramę (b7, przegląd klienta 01, poz. 2). Wierzchołki tafli przenosimy do układu
    // lokalnego Reflectora: płaszczyzna XY, normalna +Z (lookAt), z = 0.
    const ramka = new THREE.Object3D();
    ramka.position.copy(center);
    ramka.lookAt(center.clone().add(n));
    ramka.updateMatrix();
    const doLok = ramka.matrix.clone().invert();
    const lok: number[] = [];
    const q = new THREE.Vector3();
    const naLok = (i: number) => { q.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(doLok); return [q.x, q.y]; };
    const nTri = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < nTri; t++) {
      const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
      const A = naLok(i0), B = naLok(i1), C = naLok(i2);
      const pole = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(pole) < 1e-10) continue;
      // nawinięcie w stronę +Z (materiał Reflectora jest jednostronny)
      const tri = pole > 0 ? [A, B, C] : [A, C, B];
      for (const [x, y] of tri) lok.push(x, y, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(lok, 3));
    const refl = new Reflector(lok.length >= 9 ? geo : new THREE.PlaneGeometry(w, h), {
      textureWidth: Math.round(res * Math.min(1, w / h)),
      textureHeight: Math.round(res * Math.min(1, h / w)),
      color: 0xd8d6d2,
      clipBias: 0.003,
      multisample: 4,
    });
    refl.name = "LUSTRO_ODBICIE";
    if (NOWE_LADOWANIE) {
      // odbicie renderuje tylko wnętrze (warstwa 2), a nie całe osiedle z zielenią: w G lustro przy wejściu
      // dawało w spacerze zadania 55–77 ms w każdej klatce. Okna w odbiciu pokazują tło sceny.
      const zKamery = refl.getReflectionCamera.bind(refl);
      refl.getReflectionCamera = (cam: THREE.Camera) => {
        const rc = zKamery(cam);
        rc.layers.set(WARSTWA_WNETRZ);
        return rc;
      };
    }
    refl.position.copy(center);
    refl.lookAt(center.clone().add(n));
    refl.raycast = () => {};
    group.add(refl);
    m.visible = false;
    out.push({ src: m, refl });
  }
  return out;
}

/** Lustro widoczne tylko razem z kondygnacją i wnętrzem, w którym jest. */
export function synchronizujLustra(l: Lustro[]) {
  for (const x of l) {
    let vis = true;
    let o: THREE.Object3D | null = x.src.parent;
    while (o) {
      if (!o.visible) { vis = false; break; }
      o = o.parent;
    }
    x.refl.visible = vis;
  }
}
