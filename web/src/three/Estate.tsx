import * as THREE from "three";
import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useGLB, useManifest, modelUrl, reg, findAncestorDom, type DomInfo, NOWE_LADOWANIE } from "./models";
import { WARSTWA_WNETRZ } from "./lustra";
import { przygotujMaterial, oknoNoc } from "./materials";
import { nav, useStan, type PunktSpaceru } from "../state/store";
import type { DomId } from "../data/domy";

/** Wieczorem świecą okna parteru przy tarasach (b5), a na piętrze 1–2 okna na dom:
    [jasność parteru, udział zapalonych okien piętra]. B jak na b2 (piętro zapalone). */
const OKNA_NOC: Record<string, [number, number]> = { A: [1.3, 0.35], B: [1.2, 0.8], C: [1.3, 0.4], D: [1.1, 0.25], E: [1.4, 0.4], F: [1.3, 0.3], G: [1.2, 0.35] };

function prepare(scene: THREE.Object3D) {
  reg.domy.clear();
  reg.grunt = [];
  reg.przeszkody = [];
  reg.kule = [];
  const punkty: PunktSpaceru[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (/^LAMPA_KULA/.test(o.name)) reg.kule.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
  });

  for (const child of [...scene.children]) {
    const name = child.name;
    const dm = /^DOM_([A-G])$/.exec(name);
    if (dm) {
      const id = dm[1] as DomId;
      const meshes: THREE.Mesh[] = [];
      const mats: THREE.MeshStandardMaterial[] = [];
      const clones = new Map<string, THREE.Material>();
      const groundY = new THREE.Box3().setFromObject(child).min.y;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes.push(m);
        const meshY = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).y;
        const pietro = meshY - groundY > 2.9 ? 1 : 0;
        const one = (src: THREE.Material) => {
          const isG = (src.name || "").toUpperCase().startsWith("SZYB");
          const key = src.uuid + (isG ? "#" + pietro : "");
          let c = clones.get(key);
          if (!c) {
            const prepared = przygotujMaterial(m, src);
            // szyby: klon per dom z własną jasnością wieczorem; resztę klonujemy per dom do podświetlenia
            const isGlass = (prepared as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && prepared.name.toUpperCase().startsWith("SZYB");
            c = prepared.clone();
            if (isGlass) {
              const [jasP, udzialP] = OKNA_NOC[id] ?? [1, 0.4];
              const hb = new THREE.Box3().setFromObject(child);
              const hc = hb.getCenter(new THREE.Vector3());
              c.userData.oknaK = 1;
              c.userData.jasP = jasP;
              c.userData.jasG = id === "B" ? 1.25 : 1.0; // b2: piętro B zapalone, jasność ok. L* 70
              c.userData.udzial = udzialP;
              c.userData.srodek = [hc.x, hc.z];
              c.userData.grunt = groundY;
              c.userData.seed = "ABCDEFG".indexOf(id);
              oknoNoc(c as THREE.MeshPhysicalMaterial);
              reg.szyby.push(c as THREE.MeshPhysicalMaterial);
            }
            clones.set(key, c);
            if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial && !isGlass) mats.push(c as THREE.MeshStandardMaterial);
          }
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
        m.castShadow = true;
        m.receiveShadow = true;
      });
      // bryły domów także w odbiciu luster (warstwa wnętrza): z okna łazienki B widać w lustrze dom A
      if (NOWE_LADOWANIE) child.traverse((o) => o.layers.enable(WARSTWA_WNETRZ));
      const box = new THREE.Box3().setFromObject(child);
      const info: DomInfo = { id, obj: child, box, center: box.getCenter(new THREE.Vector3()), ground: box.min.y, meshes, mats };
      reg.domy.set(id, info);
      reg.przeszkody.push(child);
      continue;
    }
    if (name.startsWith("PKT_")) {
      const p = new THREE.Vector3();
      child.getWorldPosition(p);
      const et = (child.userData?.etykieta as string) || name.replace(/^PKT_/, "").replace(/_/g, " ");
      punkty.push({ id: name, etykieta: et, pos: [p.x, p.y, p.z] });
      continue;
    }
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map((x) => przygotujMaterial(m, x)) : przygotujMaterial(m, m.material);
      m.receiveShadow = true;
      m.castShadow = name !== "ZIEMIA";
    });
    if (name === "ZIEMIA") {
      reg.grunt.push(child);
      // grunt także w odbiciu luster (warstwa wnętrza), żeby okno w lustrze nie pokazywało pustki pod horyzontem
      if (NOWE_LADOWANIE) child.traverse((o) => o.layers.enable(WARSTWA_WNETRZ));
    }
    if (name === "OGRODZENIA" || name.startsWith("KONTEKST")) reg.przeszkody.push(child);
    if (NOWE_LADOWANIE && (name.startsWith("KONTEKST") || name === "TARASY")) child.traverse((o) => o.layers.enable(WARSTWA_WNETRZ));
  }
  // kolejność punktów: od wjazdu (wschód) do ogrodów, najpierw ulica
  punkty.sort((a, b) => (a.id.includes("ULICA") === b.id.includes("ULICA") ? b.pos[0] - a.pos[0] : a.id.includes("ULICA") ? -1 : 1));
  reg.punktyOsiedla = punkty;
  const box = new THREE.Box3().setFromObject(scene);
  reg.osiedleBox.copy(box);
  return punkty;
}

/** Materiał nalotu: złoto z przezroczystością, bez zapisu głębi, z lekkim przesunięciem do kamery,
    żeby nie migotał na powierzchni domu. Jeden wspólny dla wszystkich domów. */
// głębsze złoto przy kryciu 0,45: na ścianie D ΔE ≈ 7 (b7 P2-14: 5–8), faktura elewacji dalej czytelna
const NALOT = new THREE.MeshBasicMaterial({
  color: new THREE.Color("#c9a24f"),
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  depthFunc: THREE.LessEqualDepth,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  toneMapped: false,
});
/** szyby bez nalotu (b7 P1-7): złoto na szkle robiło z okna beżową plamę (ΔE 31) */
const BEZ_NALOTU = new THREE.MeshBasicMaterial({ visible: false });
const jestSzyba = (mt: THREE.Material) => (mt.name || "").toUpperCase().startsWith("SZYB");
const nakladki = new Map<DomInfo, THREE.Mesh[]>();
function nakladka(d: DomInfo): THREE.Mesh[] {
  let l = nakladki.get(d);
  if (!l) {
    l = [];
    for (const m of d.meshes) {
      const src = m.material;
      let mat: THREE.Material | THREE.Material[];
      if (Array.isArray(src)) {
        if (src.every(jestSzyba)) continue;
        mat = src.map((mt) => (jestSzyba(mt) ? BEZ_NALOTU : NALOT));
      } else {
        if (jestSzyba(src)) continue;
        mat = NALOT;
      }
      const o = new THREE.Mesh(m.geometry, mat);
      o.name = "NALOT";
      o.visible = false;
      o.renderOrder = 5;
      o.castShadow = false;
      o.receiveShadow = false;
      o.raycast = () => {}; // nakładka nie przechwytuje kliknięć ani spaceru
      m.add(o);
      l.push(o);
    }
    nakladki.set(d, l);
  }
  return l;
}

export function Estate() {
  const man = useManifest();
  const gltf = useGLB(modelUrl(man.osiedle!));
  const punkty = useMemo(() => prepare(gltf.scene), [gltf]);

  useEffect(() => {
    const s = useStan.getState();
    if (s.widok === "osiedle") s.set({ punkty });
  }, [punkty]);

  // podświetlenie domu pod kursorem jak w ui1 (u nas złoto zamiast błękitu): półprzezroczysty nalot na całej
  // bryle (nakładka na tych samych geometriach, rysowana na wierzchu z tą samą głębią) + jasny obrys krawędzi
  // (efekt Outline w Stage, wybór z reg.podswietlone). Sama emisja 0,16 na białych ścianach była niewidoczna.
  useEffect(() => {
    const paint = (hover: DomId | null, widok: string, dom: DomId | null) => {
      let sel: THREE.Object3D[] = [];
      for (const [id, d] of reg.domy) {
        const on = id === hover && !(widok === "dom" && dom === id);
        const lay = nakladka(d);
        for (const o of lay) o.visible = on;
        if (on) sel = d.meshes;
      }
      reg.podswietlone = sel;
      reg.onPodswietlenie?.();
    };
    const s0 = useStan.getState();
    paint(s0.hover, s0.widok, s0.dom);
    return useStan.subscribe((s, p) => {
      if (s.hover !== p.hover || s.widok !== p.widok || s.dom !== p.dom) paint(s.hover, s.widok, s.dom);
    });
  }, [gltf]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const s = useStan.getState();
    if (s.zdjecie) return;
    // w spacerze klik w fasadę prowadzi do niej (Walk), więc dom nie podświetla się jako „wejdź”
    if (s.tryb === "spacer") {
      if (s.hover) s.set({ hover: null });
      return;
    }
    const id = findAncestorDom(e.object);
    const klik = id && !(s.widok === "dom" && s.dom === id);
    const el = e.nativeEvent.target as HTMLElement | null;
    if (el?.style) el.style.cursor = klik ? "pointer" : "";
    if (id !== s.hover) s.set({ hover: id });
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const s = useStan.getState();
    const el = e.nativeEvent.target as HTMLElement | null;
    if (el?.style && s.tryb !== "spacer") el.style.cursor = "";
    if (s.hover) s.set({ hover: null });
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    const s = useStan.getState();
    if (s.zdjecie) return;
    const id = findAncestorDom(e.object);
    if (!id) return;
    if (s.widok === "dom" && s.dom === id) return;
    // spacer (także na osiedlu): klik w dom to krok w jego stronę, a nie przeskok do widoku domu
    if (s.tryb === "spacer") return;
    e.stopPropagation();
    nav.dom(id);
  };

  return (
    <group onPointerMove={onMove} onPointerOut={onOut} onClick={onClick}>
      <primitive object={gltf.scene} />
    </group>
  );
}
