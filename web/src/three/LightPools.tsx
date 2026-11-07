import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useStan } from "../state/store";
import { reg } from "./models";

/* Plamy światła pod kulami ogrodowymi (LAMPA_KULA_*): addytywny gradient na gruncie, tylko w porze Noc.
   Zamiast 11 świateł punktowych (każde podnosi koszt wszystkich materiałów). */

function poolTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,214,160,1)");
  grd.addColorStop(0.35, "rgba(255,200,140,0.45)");
  grd.addColorStop(1, "rgba(255,190,130,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function LightPools() {
  const gotowa = useStan((s) => s.scenaGotowa);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
    [],
  );
  const geo = useMemo(() => new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2), []);
  const spots = useMemo(() => {
    if (!gotowa) return [] as THREE.Vector3[];
    const ray = new THREE.Raycaster();
    const out: THREE.Vector3[] = [];
    for (const k of reg.kule) {
      const p = k.clone();
      ray.set(p.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(reg.grunt, true)[0];
      out.push(new THREE.Vector3(p.x, (hit ? hit.point.y : p.y - 0.22) + 0.02, p.z));
    }
    return out;
  }, [gotowa]);
  const cur = useRef(0);
  useFrame(({ invalidate }, dt) => {
    const want = useStan.getState().pora === "noc" ? 0.55 : 0;
    if (Math.abs(cur.current - want) > 0.002) {
      cur.current += (want - cur.current) * (1 - Math.exp(-dt * 3.5));
      mat.opacity = cur.current;
      invalidate();
    }
  });
  return (
    <>
      {spots.map((p, i) => (
        <mesh key={i} geometry={geo} material={mat} position={p} renderOrder={5} />
      ))}
    </>
  );
}
