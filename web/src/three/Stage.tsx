import * as THREE from "three";
import { Suspense, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { EffectComposer, SMAA, ToneMapping, Bloom, BrightnessContrast } from "@react-three/postprocessing";
import { N8AOPostPass } from "n8ao";
import { ToneMappingMode } from "postprocessing";
import { useStan } from "../state/store";
import { useManifest, initKtx2 } from "./models";
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

function World() {
  const man = useManifest();
  const gotowa = useStan((s) => s.scenaGotowa);
  if (!man.osiedle) return null;
  return (
    <>
      <Lighting />
      <Estate />
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
  const { scene, camera, size } = useThree();
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
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <primitive object={ao} />
      <Bloom intensity={pora === "noc" ? 0.55 : 0} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={tmMode()} />
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
