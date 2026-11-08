import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useState } from "react";
import { useStan } from "../state/store";
import { reg } from "./models";
import { rig } from "./CameraRig";

const ray = new THREE.Raycaster();
/** Czy znacznik jest widoczny z kamery (nie zasłania go ściana ani bryła). */
function visible(from: THREE.Vector3, to: THREE.Vector3, blockers: THREE.Object3D[]) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  ray.set(from, dir.normalize());
  ray.far = dist - 0.15;
  const hit = ray.intersectObjects(blockers, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && !/PODLOGA/.test(h.object.parent?.name ?? "") && !/PODLOGA/.test(h.object.name));
  return !hit;
}

/* Punkty spaceru jako koła z ikoną idącego człowieka (wzorzec ui6). Klik = krok do punktu z zachowaniem kierunku
   patrzenia, jak klik w podłogę (Street View). Wcześniej znacznik przestawiał kamerę na ujęcie pokoju razem z jego
   kierunkiem, co przy kliknięciu w okolicę znacznika wyglądało jak skok i nagły obrót. Ujęcie pokoju (kierunek
   z renderu) zostaje pod przyciskami pomieszczeń na pasku u góry. */
export function WalkMarkers() {
  const s = useStan();
  const { camera } = useThree();
  // przelicz widoczność, gdy kamera przeszła w nowe miejsce (render nie zależy od stanu)
  const [, force] = useState(0);
  const last = useRef(new THREE.Vector3(1e9, 0, 0));
  useFrame(() => {
    if (last.current.distanceTo(camera.position) > 0.6) {
      last.current.copy(camera.position);
      force((n) => n + 1);
    }
  });
  if (s.tryb !== "spacer" || !s.etykiety) return null;
  const cam = camera.position;
  return (
    <>
      {s.punkty.map((p) => {
        if (p.id === s.punkt) return null;
        const pos = new THREE.Vector3(p.pos[0], p.pos[1] + 0.05, p.pos[2]);
        const d = pos.distanceTo(cam);
        if (d < 1.2 || d > 60) return null;
        if (s.widok === "dom" && Math.abs(p.pos[1] - (cam.y - 1.6)) > 1.2) return null; // tylko bieżąca kondygnacja
        const w = s.widok === "dom" && s.dom ? reg.wnetrza.get(s.dom) : null;
        const blockers = w ? [w.root] : reg.przeszkody;
        // znacznik leży na podłodze: musi być widoczny jego środek (wcześniej punkt 0,4 m wyżej, więc znacznik
        // za oparciem sofy był rysowany na sofie)
        if (!visible(cam, pos.clone().add(new THREE.Vector3(0, 0.12, 0)), blockers)) return null;
        return (
          <Html key={p.id} position={pos} center zIndexRange={[15, 5]} style={{ pointerEvents: "none" }}>
            <button className="wm" title={p.etykieta} onClick={() => {
                rig.walkTo(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), s.widok === "dom" ? 1.6 : 1.65);
                s.set({ punkt: null });
              }}>
              <svg viewBox="0 0 24 24" className="icon"><circle cx="13" cy="4.2" r="1.7" /><path d="m9.5 21 2.3-6.3 2.7 2.4V21M8 11.5l2.5-3.3 3.5.3 2 3 2.5 1M11.8 14.7l1-6" /></svg>
              <span>{p.etykieta}</span>
            </button>
          </Html>
        );
      })}
    </>
  );
}
