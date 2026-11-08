import * as THREE from "three";
import { useEffect, useMemo } from "react";
import { useStan } from "../state/store";
import { useGLB, useManifest, modelUrl, reg } from "./models";
import { przygotujMaterial } from "./materials";

/* Dodatkowe pliki z manifestu: zieleń (instancje roślin) i okolica (sąsiedztwo, las, łąka po horyzont). */

function prepareExtra(scene: THREE.Object3D, kind: "zielen" | "okolica") {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const fix = (mat: THREE.Material) => {
      const x = przygotujMaterial(m, mat) as THREE.MeshStandardMaterial;
      // karty roślin: alfa jako maska (MASK z GLB). Karty są jednostronne i zdublowane w geometrii
      // z ustawionymi normalnymi (96), więc NIE wymuszamy DoubleSide. alphaToCoverage (MSAA ×4) sprawdzone 08.11:
      // liście robią się ażurowe, a biały kolor tekstury pod alfą prześwituje mocniej. Zostaje twardy próg;
      // obwódkę usuwa rozszerzenie koloru w teksturach (96, zielen-v13).
      if (x.map && (x.transparent || x.alphaTest > 0)) {
        x.transparent = false;
        x.alphaTest = x.alphaTest > 0 ? x.alphaTest : 0.5;
        x.alphaToCoverage = false;
      }
      return x;
    };
    m.material = Array.isArray(m.material) ? m.material.map(fix) : fix(m.material);
    m.receiveShadow = true;
    // cienie rzucają tylko drzewa, miskanty i krzewy (prośba 96); kępy traw i byliny nie (plamy i koszt)
    let n = "";
    for (let x: THREE.Object3D | null = o; x; x = x.parent) n += " " + x.name.toUpperCase();
    // okolica: las to dalekie impostory (bez cieni, prośba 96); cień rzucają tylko bryły-duchy
    m.castShadow = kind === "zielen" ? /BRZOZA|SOSNA|MISKANT|KRZEW/.test(n) : /DUCH/.test(n);
    if (kind === "okolica" && /LAS/.test(n)) m.receiveShadow = false;
  });
  if (kind === "okolica") reg.przeszkody.push(scene);
  return scene;
}

function Extra({ file, kind }: { file: string; kind: "zielen" | "okolica" }) {
  const gltf = useGLB(modelUrl(file));
  const scene = useMemo(() => prepareExtra(gltf.scene, kind), [gltf, kind]);
  return <primitive object={scene} />;
}

function ExtrasReady() {
  useEffect(() => {
    useStan.getState().set({ dodatkiGotowe: true });
  }, []);
  return null;
}

export function Extras() {
  const man = useManifest();
  return (
    <>
      {man.zielen && <Extra file={man.zielen} kind="zielen" />}
      {man.okolica && <Extra file={man.okolica} kind="okolica" />}
      <ExtrasReady />
    </>
  );
}

export function useHasOkolica() {
  return !!useManifest().okolica;
}
