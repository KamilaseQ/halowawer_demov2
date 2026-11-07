import * as THREE from "three";
import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useGLB, useManifest, modelUrl, reg, findAncestorDom, type DomInfo } from "./models";
import { przygotujMaterial, oknoNoc } from "./materials";
import { nav, useStan, type PunktSpaceru } from "../state/store";
import type { DomId } from "../data/domy";

const GOLD = new THREE.Color("#d5b770");
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
    if (name === "ZIEMIA") reg.grunt.push(child);
    if (name === "OGRODZENIA" || name.startsWith("KONTEKST")) reg.przeszkody.push(child);
  }
  // kolejność punktów: od wjazdu (wschód) do ogrodów, najpierw ulica
  punkty.sort((a, b) => (a.id.includes("ULICA") === b.id.includes("ULICA") ? b.pos[0] - a.pos[0] : a.id.includes("ULICA") ? -1 : 1));
  reg.punktyOsiedla = punkty;
  const box = new THREE.Box3().setFromObject(scene);
  reg.osiedleBox.copy(box);
  return punkty;
}

export function Estate() {
  const man = useManifest();
  const gltf = useGLB(modelUrl(man.osiedle!));
  const punkty = useMemo(() => prepare(gltf.scene), [gltf]);

  useEffect(() => {
    const s = useStan.getState();
    if (s.widok === "osiedle") s.set({ punkty });
  }, [punkty]);

  // podświetlenie domu pod kursorem (emisja na klonach materiałów)
  useEffect(() => {
    const paint = (hover: DomId | null, widok: string, dom: DomId | null) => {
      for (const [id, d] of reg.domy) {
        const on = id === hover && !(widok === "dom" && dom === id);
        for (const m of d.mats) {
          m.emissive = on ? GOLD : m.emissive ?? new THREE.Color(0);
          m.emissiveIntensity = on ? 0.16 : 0;
          if (!on) m.emissive.setRGB(0, 0, 0);
        }
      }
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
    const id = findAncestorDom(e.object);
    if (s.tryb === "spacer" && s.widok === "dom") return;
    if (id !== s.hover) s.set({ hover: id });
  };
  const onOut = () => {
    if (useStan.getState().hover) useStan.getState().set({ hover: null });
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    const s = useStan.getState();
    if (s.zdjecie) return;
    const id = findAncestorDom(e.object);
    if (!id) return;
    if (s.widok === "dom" && s.dom === id) return;
    if (s.widok === "dom" && s.tryb === "spacer") return;
    e.stopPropagation();
    nav.dom(id);
  };

  return (
    <group onPointerMove={onMove} onPointerOut={onOut} onClick={onClick}>
      <primitive object={gltf.scene} />
    </group>
  );
}
