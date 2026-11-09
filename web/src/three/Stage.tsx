import * as THREE from "three";
import { wariantySkorupy } from "./przekroj";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { EffectComposer, SMAA, ToneMapping, Bloom, BrightnessContrast, Outline } from "@react-three/postprocessing";
import { N8AOPostPass } from "n8ao";
import { ToneMappingMode } from "postprocessing";
import { useStan } from "../state/store";
import { useManifest, useGLB, modelUrl, initKtx2, reg, NOWE_LADOWANIE, LM_KTX2, zglosPliki } from "./models";
import { wczytajLightmapyKtx2 } from "./Interiors";
import { Estate } from "./Estate";
import { Interiors } from "./Interiors";
import { Extras } from "./Extras";
import { Lighting } from "./Lighting";
import { CameraRig, photoFov } from "./CameraRig";
import { Walk } from "./Walk";
import { LightPools } from "./LightPools";
import { WalkMarkers } from "./WalkMarkers";
import { HouseLabelProjector, RoomLabels } from "./Labels";
import KAM from "../data/kameraZdjecia.json";

function Ready() {
  useEffect(() => {
    useStan.getState().set({ scenaGotowa: true });
  }, []);
  return null;
}

/** NOWE_LADOWANIE: wszystko, co dziś doładowuje się po ekranie ładowania (zieleń, okolica) albo dopiero przy
    wejściu do domu (wnętrza obu typów), wczytujemy za ekranem ładowania. useGLB jest pamiętane po adresie,
    więc Extras i Interiors dostają potem gotowe modele bez czekania i bez parsowania w trakcie oglądania. */
function Wstepne() {
  const man = useManifest();
  const pliki = [man.osiedle, man.zielen, man.okolica, ...Object.values(man.wnetrza ?? {})].filter(Boolean) as string[];
  zglosPliki(pliki.map(modelUrl));
  for (const f of pliki.slice(1)) useGLB(modelUrl(f));
  return null;
}

/** NOWE_LADOWANIE: kompilacja shaderów wszystkiego, co jest w scenie, za ekranem ładowania (bez przycięć
    przy pierwszym obrocie makiety). Ekran znika dopiero po rozgrzaniu. */
function Rozgrzewka() {
  const { gl, scene, camera, invalidate } = useThree();
  const dodatki = useStan((s) => s.dodatkiGotowe);
  const man = useManifest();
  const [wnetrzaGotowe, setWnetrzaGotowe] = useState(false);
  useEffect(() => {
    // czekamy, aż wszystkie domy z wnętrzami się zarejestrują (montowane w Interiors pod flagą)
    const ile = Object.values(man.domy ?? {}).filter((d) => d && (d as { wnetrze?: string }).wnetrze).length;
    const t = setInterval(() => { if (reg.wnetrza.size >= ile) { setWnetrzaGotowe(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, [man]);
  useEffect(() => {
    if (!dodatki || !wnetrzaGotowe) return;
    useStan.getState().set({ etapLadowania: "Przygotowanie grafiki" });
    let ok = true;
    const t0 = performance.now();
    // LM_KTX2: lightmapy wszystkich domów (skompresowane) przed kompilacją i wysyłką na GPU
    const lm = LM_KTX2 ? wczytajLightmapyKtx2() : Promise.resolve();
    // compileAsync przechodzi tylko po widocznych obiektach: wnętrza na czas kompilacji widoczne
    const ukryte: THREE.Object3D[] = [];
    lm.then(() => {
    for (const w of reg.wnetrza.values()) w.root.traverse((o) => { if (!o.visible) { ukryte.push(o); o.visible = true; } });
    if (LM_KTX2) for (const w of reg.wnetrza.values()) w.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.lightMap && (m.lightMap as THREE.CompressedTexture).isCompressedTexture) gl.initTexture(m.lightMap);
    });
    return gl.compileAsync(scene, camera).catch(() => {})
      // wariant bryły domu w widoku kondygnacji (przekroj.ts: ustawSkorupe), żeby pierwsze wejście nie kompilowało shaderów
      .then(() => wariantySkorupy(reg.domy.values(), () => gl.compileAsync(scene, camera).catch(() => {})));
    }).then(() => {
      for (const o of ukryte) o.visible = false;
      useStan.setState({}); // ponowne zastosowanie widoczności domów (subskrypcje HouseInterior)
      if (!ok) return;
      reg.odswiezCienie();
      invalidate();
      // jedna klatka po kompilacji (wysyłka tekstur na GPU), potem odsłonięcie
      requestAnimationFrame(() => requestAnimationFrame(() => {
        console.info(`[ladowanie] rozgrzewka ${(performance.now() - t0).toFixed(0)} ms`);
        useStan.getState().set({ rozgrzane: true });
      }));
    });
    return () => { ok = false; };
  }, [dodatki, wnetrzaGotowe, gl, scene, camera, invalidate]);
  return null;
}

function World() {
  const man = useManifest();
  const gotowa = useStan((s) => s.scenaGotowa);
  if (!man.osiedle) return null;
  return (
    <>
      <Lighting />
      <Estate />
      {NOWE_LADOWANIE && <Wstepne />}
      <Ready />
      {gotowa && (
        <>
          <HouseLabelProjector />
          <RoomLabels />
          <WalkMarkers />
          <LightPools />
          <Suspense fallback={null}>
            <Interiors />
          </Suspense>
          <Suspense fallback={null}>
            <Extras />
          </Suspense>
          {NOWE_LADOWANIE && <Rozgrzewka />}
        </>
      )}
    </>
  );
}

function tmMode() {
  const q = new URLSearchParams(location.search).get("tm");
  if (q === "aces") return ToneMappingMode.ACES_FILMIC;
  if (q === "neutral") return ToneMappingMode.NEUTRAL;
  return ToneMappingMode.AGX;
}

function Effects() {
  const pora = useStan((s) => s.pora);
  const qbc = new URLSearchParams(location.search).get("bc");
  const bc = (qbc ? qbc.split(",").map(Number) : [0, 0]) as [number, number];
  const { scene, camera, size, invalidate } = useThree();
  // hak QA: materiał i kolor w punkcie ekranu (diagnostyka kolorów, np. dachy kontekstu)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__material = (x: number, y: number) => {
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
      const h = r.intersectObjects(scene.children, true).find((i) => i.object.visible && (i.object as THREE.Mesh).isMesh);
      if (!h) return null;
      const m = (h.object as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const mat = Array.isArray(m) ? m[(h.face as THREE.Face & { materialIndex?: number })?.materialIndex ?? 0] : m;
      return { obiekt: h.object.name, material: mat?.name, kolor: mat?.color?.getHexString(), rough: mat?.roughness, normal: h.face?.normal.toArray().map((v) => +v.toFixed(2)) };
    };
    // hak QA: promień w świecie → lista trafień (obiekt z przodkami, materiał, punkt), np. wysokość płotu nad gruntem
    w.__promien = (o: [number, number, number], d: [number, number, number], far = 1000) => {
      const r = new THREE.Raycaster(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize(), 0, far);
      return r.intersectObjects(scene.children, true).filter((i) => i.object.visible && (i.object as THREE.Mesh).isMesh).slice(0, 6).map((i) => {
        const n: string[] = [];
        for (let x: THREE.Object3D | null = i.object; x; x = x.parent) if (x.name) n.push(x.name);
        const m = (i.object as THREE.Mesh).material as THREE.Material | THREE.Material[];
        return { obiekt: n.slice(0, 3).join("<"), material: (Array.isArray(m) ? m[0] : m)?.name, p: i.point.toArray().map((v) => +v.toFixed(3)) };
      });
    };
  }, [scene, camera]);
  // obrys domu pod kursorem (ui1): wybór ustawia Estate w reg.podswietlone
  const [sel, setSel] = useState<THREE.Object3D[]>([]);
  useEffect(() => {
    reg.onPodswietlenie = () => setSel(reg.podswietlone);
    return () => {
      reg.onPodswietlenie = null;
    };
  }, []);
  // frameloop "demand": klatka dopiero po tym, jak Outline przejmie nowy wybór (efekt dziecka już się wykonał)
  useEffect(() => {
    const t = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(t);
  }, [sel, invalidate]);
  const ao = useMemo(() => {
    const p = new N8AOPostPass(scene, camera, size.width, size.height);
    p.configuration.aoRadius = 1.2;
    p.configuration.distanceFalloff = 0.7;
    p.configuration.intensity = 1.6; // 96 wypala AO w GLB, SSAO tylko domyka styki
    p.configuration.halfRes = false; // halfRes w n8ao 2.0.1 używa starej klasy MRT, która pada na three r187
    p.configuration.color = new THREE.Color("#1c1a17");
    p.setQualityMode("Medium");
    return p;
  }, [scene, camera]);
  return (
    <EffectComposer multisampling={4} enableNormalPass={false} autoClear={false}>
      <primitive object={ao} />
      <Bloom intensity={pora === "noc" ? 0.55 : 0} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={tmMode()} />
      <Outline selection={sel} visibleEdgeColor={0xe8cf8a} hiddenEdgeColor={0x000000} edgeStrength={3.5} blur xRay={false} />
      <BrightnessContrast brightness={bc[0]} contrast={bc[1]} />
      <SMAA />
    </EffectComposer>
  );
}

export function Stage() {
  const aspect = typeof window !== "undefined" ? window.innerWidth / window.innerHeight : 1.6;
  return (
    <Canvas
      className="stage"
      frameloop="demand"
      dpr={[1, 1.75]}
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true, stencil: false }}
      camera={{ fov: photoFov(aspect), near: 0.1, far: 4000, position: KAM.pozycja as [number, number, number] }}
      onCreated={(state) => {
        const { gl } = state;
        initKtx2(gl);
        (window as unknown as Record<string, unknown>).__three = state;
        gl.toneMapping = THREE.NoToneMapping;
        gl.localClippingEnabled = true; // przekrój rzutu (przekroj.ts)
        if (NOWE_LADOWANIE) {
          // cienie statyczne: scena się nie rusza, więc mapa cieni 4096² nie musi być liczona w każdej klatce
          // (ani przy każdym renderze lustra). Odświeżamy ją po zmianie słońca, widoczności, trybu lub wczytaniu.
          gl.shadowMap.autoUpdate = false;
          reg.odswiezCienie = () => {
            gl.shadowMap.needsUpdate = true;
            state.invalidate();
          };
          (window as unknown as Record<string, unknown>).__odswiezCienie = () => reg.odswiezCienie(); // hak QA
          useStan.subscribe((a, b) => {
            if (a.scenaGotowa !== b.scenaGotowa || a.dodatkiGotowe !== b.dodatkiGotowe || a.wnetrzeGotowe !== b.wnetrzeGotowe ||
              a.widok !== b.widok || a.dom !== b.dom || a.kond !== b.kond || a.tryb !== b.tryb || a.pora !== b.pora) reg.odswiezCienie();
          });
        }
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <CameraRig />
      <Suspense fallback={null}>
        <World />
        <Walk />
        <Effects />
      </Suspense>
    </Canvas>
  );
}
