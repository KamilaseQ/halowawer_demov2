import * as THREE from "three";
import { useEffect, useMemo } from "react";
import { useGLB, useManifest, modelUrl, reg, type WnetrzeInfo, type Kadr } from "./models";
import { szyba } from "./materials";
import { useStan, type PunktSpaceru } from "../state/store";
import type { DomId } from "../data/domy";
import { rig } from "./CameraRig";

/** Który plik wnętrza i jaka macierz dla domu (manifest.domy). */
export function interiorFor(man: ReturnType<typeof useManifest>, id: DomId | null) {
  if (!id || !man.domy || !man.wnetrza) return null;
  const d = man.domy[id] as { wnetrze: string; macierz: number[] | null; lightmapy?: Record<string, string> } | undefined;
  if (!d) return null;
  const file = man.wnetrza[d.wnetrze];
  if (!file) return null;
  return { file, macierz: d.macierz, lightmapy: d.lightmapy };
}

/* ---------- lightmapy (kontrakt §4): extras węzła { lightMap, lightMapIntensity } albo manifest.domy.X.lightmapy ----------
   Siatka z lightmapą bierze światło tylko z mapy (słońce + niebo + GI wypalone w Cycles) i słabe odbicia otoczenia;
   światła kierunkowe i półkula runtime są dla niej wyłączone, żeby nie liczyć słońca dwa razy. */
const texLoader = new THREE.TextureLoader();
const lmCache = new Map<string, THREE.Texture>();
export const lightmapMats: THREE.MeshStandardMaterial[] = [];
const LM_TINT: [number, number, number] = [1.04, 1.0, 0.94];
function lmTexture(url: string) {
  let t = lmCache.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.channel = 1;
    lmCache.set(url, t);
  }
  return t;
}
function applyLightmap(root: THREE.Object3D, url: string, intensity: number) {
  const tex = lmTexture(url);
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.attributes.uv1) return;
    const one = (src: THREE.Material) => {
      const sm = src as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial || (src.name || "").toUpperCase().startsWith("SZYB")) return src;
      let c = clones.get(src) as THREE.MeshStandardMaterial | undefined;
      if (!c) {
        c = sm.clone();
        c.lightMap = tex;
        c.lightMapIntensity = intensity;
        c.userData.lmBase = intensity;
        c.envMapIntensity = 0.22;
        c.onBeforeCompile = (sh) => {
          const NL = String.fromCharCode(10);
          // ciepła korekta wypalonego światła (bake z niebieskim niebem HDRI, rendery dewelopera są ciepłe)
          sh.uniforms.uLmTint = { value: new THREE.Color(...(((window as unknown as { __lmTint?: [number, number, number] }).__lmTint) ?? LM_TINT)) };
          // światło z lightmapy zastępuje półkulę i światła bezpośrednie (słońce jest już wypalone)
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", ["#include <common>", "uniform vec3 uLmTint;"].join(NL))
            .replace("#include <lights_fragment_maps>", ["irradiance = vec3( 0.0 );", "#include <lights_fragment_maps>", "irradiance *= uLmTint;"].join(NL))
            .replace(
              "#include <lights_fragment_end>",
              ["#include <lights_fragment_end>", "reflectedLight.directDiffuse = vec3( 0.0 );", "reflectedLight.directSpecular = vec3( 0.0 );"].join(NL),
            );
        };
        c.customProgramCacheKey = () => "lm2";
        clones.set(src, c);
        lightmapMats.push(c);
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
    m.receiveShadow = false;
  });
}

function prepareInterior(src: THREE.Object3D, macierz: number[] | null, lightmapy?: Record<string, string>): WnetrzeInfo {
  const root = src.clone(true);
  // lightmapy: najpierw z manifestu (osobne dla domów lustrzanych), potem z extras węzłów
  root.traverse((o) => {
    const fromManifest = lightmapy?.[o.name];
    const fromExtras = o.userData?.lightMap as string | undefined;
    const url = fromManifest ?? fromExtras;
    if (url) applyLightmap(o, modelUrl(url), (o.userData?.lightMapIntensity as number) ?? 1);
  });
  if (macierz) {
    const m = new THREE.Matrix4().fromArray(macierz);
    const holder = new THREE.Group();
    holder.add(root);
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(m);
    holder.updateMatrixWorld(true);
    return collect(holder);
  }
  root.updateMatrixWorld(true);
  return collect(root);
}

function collect(root: THREE.Object3D): WnetrzeInfo {
  const info: WnetrzeInfo = { root, kadry: [], poziomy: {}, podlogi: [], punkty: [], kond: {}, sufity: {} };
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (/^KADR_\d+$/.test(o.name)) {
      const ex = o.userData ?? {};
      const pos = o.getWorldPosition(new THREE.Vector3());
      // Object3D.getWorldDirection zwraca +Z; kamera patrzy w −Z
      const dir = o.getWorldDirection(new THREE.Vector3()).negate();
      const sp = Array.isArray(ex.spacer) ? new THREE.Vector3(...(ex.spacer as [number, number, number])).applyMatrix4(root.matrixWorld) : pos.clone();
      info.kadry.push({ id: o.name, ref: ex.ref ?? "", pokoj: ex.pokoj ?? "", etykieta: ex.etykieta ?? "", fov: ex.fov ?? 60, near: ex.near ?? 0.05, pos, dir, spacer: sp } satisfies Kadr);
    }
    const km = /^KOND_(\d+)$/.exec(o.name);
    if (km) info.kond[+km[1]] = o;
    const sm = /^KOND_(\d+)__SUFIT/.exec(o.name);
    if (sm) (info.sufity[+sm[1]] ??= []).push(o);
    const pm = /^KOND_(\d+)__PODLOGA/.exec(o.name);
    if (pm) {
      o.traverse((x) => {
        if ((x as THREE.Mesh).isMesh) info.podlogi.push(x as THREE.Mesh);
      });
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty()) info.poziomy[+pm[1]] = b.max.y;
    }
    const pt = /^PKT_(\d+)_(.+)$/.exec(o.name);
    if (pt) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      const et = (o.userData?.etykieta as string) || pt[2].replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
      info.punkty.push({ id: o.name, etykieta: et, pos: [p.x, p.y, p.z], kond: +pt[1] } satisfies PunktSpaceru);
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const fix = (mat: THREE.Material) => ((mat.name || "").toUpperCase().startsWith("SZYB") ? szyba(mat) : mat);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
    }
  });
  info.punkty.sort((a, b) => (a.kond ?? 0) - (b.kond ?? 0));
  return info;
}

function HouseInterior({ id, file, macierz, lightmapy }: { id: DomId; file: string; macierz: number[] | null; lightmapy?: Record<string, string> }) {
  const gltf = useGLB(modelUrl(file));
  const info = useMemo(() => prepareInterior(gltf.scene, macierz, lightmapy), [gltf, macierz, lightmapy]);

  useEffect(() => {
    reg.wnetrza.set(id, info);
    useStan.getState().set({ wnetrzeGotowe: true });
    if (rig.kadrPending) {
      const ref = rig.kadrPending;
      setTimeout(() => rig.kadr(ref), 0);
    }
    const s = useStan.getState();
    if (s.widok === "dom" && s.dom === id) s.set({ punkty: info.punkty });
    return () => {
      reg.wnetrza.delete(id);
    };
  }, [id, info]);

  // widoczność kondygnacji i sufitów
  useEffect(() => {
    const apply = () => {
      const s = useStan.getState();
      const active = s.widok === "dom" && s.dom === id;
      const inside = active && (s.kond !== "dom" || s.tryb === "spacer" || s.tryb === "rzut");
      info.root.visible = inside;
      const shell = reg.domy.get(id);
      if (shell) shell.obj.visible = !inside;
      if (!inside) return;
      const walk = s.tryb === "spacer";
      const top = walk ? 99 : (s.kond as number);
      for (const [k, obj] of Object.entries(info.kond)) obj.visible = +k <= top;
      for (const [k, arr] of Object.entries(info.sufity)) for (const o of arr) o.visible = walk || +k < top;
    };
    apply();
    const unsub = useStan.subscribe(apply);
    return () => {
      unsub();
      const shell = reg.domy.get(id);
      if (shell) shell.obj.visible = true;
    };
  }, [id, info]);

  return <primitive object={info.root} />;
}

export function Interiors() {
  const man = useManifest();
  const dom = useStan((s) => s.dom);
  const widok = useStan((s) => s.widok);
  const cfg = widok === "dom" ? interiorFor(man, dom) : null;
  useEffect(() => {
    const has = !!cfg && !!dom && reg.wnetrza.has(dom);
    useStan.getState().set({ wnetrzeGotowe: cfg ? has : null });
  }, [dom, widok, !!cfg]);
  if (!cfg || !dom) return null;
  return <HouseInterior key={dom} id={dom} file={cfg.file} macierz={cfg.macierz} lightmapy={cfg.lightmapy} />;
}
