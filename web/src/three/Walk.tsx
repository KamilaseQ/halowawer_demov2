import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useStan } from "../state/store";
import { reg } from "./models";
import { rig } from "./CameraRig";

/* Spacer: celownik (elipsa) na terenie/podłodze pod kursorem, klik = przejście kamery w to miejsce. */

export function Walk() {
  const tryb = useStan((s) => s.tryb);
  const { gl, camera, invalidate } = useThree();
  const ring = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    if (tryb !== "spacer") return;
    const el = gl.domElement;
    let down: { x: number; y: number; t: number } | null = null;

    const targets = () => {
      const s = useStan.getState();
      const w = s.widok === "dom" && s.dom ? reg.wnetrza.get(s.dom) : null;
      if (w) return { floors: w.podlogi as THREE.Object3D[], all: [w.root] as THREE.Object3D[] };
      return { floors: reg.grunt, all: [...reg.grunt, ...reg.przeszkody] };
    };

    const hit = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const { floors, all } = targets();
      const hits = ray.intersectObjects(all, true).filter((h) => h.object.visible && isVisible(h.object));
      if (!hits.length) return null;
      const h = hits[0];
      const isFloor = floors.some((f) => f === h.object || isChildOf(h.object, f));
      if (!isFloor || !h.face) return null;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y < 0.7) return null;
      return { point: h.point, normal: n, dist: h.distance };
    };

    const onMove = (ev: PointerEvent) => {
      const m = ring.current;
      if (!m) return;
      if (down) return;
      const h = hit(ev);
      if (h && h.dist < 120) {
        m.visible = true;
        m.position.copy(h.point).addScaledVector(h.normal, 0.03);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.normal);
        const sc = THREE.MathUtils.clamp(h.dist * 0.035, 0.6, 2.2);
        m.scale.setScalar(sc);
        el.style.cursor = "pointer";
      } else {
        m.visible = false;
        el.style.cursor = "grab";
      }
      invalidate();
    };
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      el.style.cursor = "grabbing";
    };
    const onUp = (ev: PointerEvent) => {
      const d = down;
      down = null;
      el.style.cursor = "grab";
      if (!d || ev.button !== 0) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5) return;
      const h = hit(ev);
      if (!h) return;
      rig.walkTo(h.point, useStan.getState().widok === "dom" ? 1.6 : 1.65);
      useStan.getState().set({ punkt: null });
    };
    const onLeave = () => {
      if (ring.current) ring.current.visible = false;
      invalidate();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.style.cursor = "grab";
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.style.cursor = "";
      if (ring.current) ring.current.visible = false;
    };
  }, [tryb, gl, camera]);

  return (
    <mesh ref={ring} visible={false} renderOrder={10}>
      <ringGeometry args={[0.36, 0.46, 48]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function isChildOf(o: THREE.Object3D, p: THREE.Object3D) {
  let x: THREE.Object3D | null = o;
  while (x) {
    if (x === p) return true;
    x = x.parent;
  }
  return false;
}
function isVisible(o: THREE.Object3D) {
  let x: THREE.Object3D | null = o;
  while (x) {
    if (!x.visible) return false;
    x = x.parent;
  }
  return true;
}
