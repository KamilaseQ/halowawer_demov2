import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useStan } from "../state/store";
import { reg } from "./models";
import { rig } from "./CameraRig";

/* Spacer: celownik (elipsa) na terenie/podłodze pod kursorem, klik = przejście kamery w to miejsce.

   Cel wybieramy jak w Street View / Matterport: kliknięcie w cokolwiek (podłoga, dywan, mebel, ściana, fasada)
   prowadzi do najbliższego wolnego miejsca na podłodze wzdłuż promienia od kamery:
   - podłoga albo niska powierzchnia leżąca na niej (dywan, próg, taras) → dokładnie tam;
   - mebel, ściana, fasada → cofamy się wzdłuż promienia w stronę kamery i bierzemy pierwszy punkt, nad którym
     pionowy promień trafia w wolną podłogę (nie w blat, sofę, łóżko), z odstępem od przeszkody.
   Wcześniej liczyło się tylko bezpośrednie trafienie w siatkę podłogi, więc klik w dywan lub mebel nic nie robił,
   a w części domów (duże dywany, meble przy wejściu) spacer praktycznie nie działał. */

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** maks. wysokość „leżącej” powierzchni nad podłogą (dywan, próg, stopień tarasu), po której można iść */
const NISKO_WN = 0.06;
const NISKO_OS = 0.45;
/** odstęp celu od przeszkody (m): we wnętrzu jak przy meblu, na osiedlu dalej od fasady (inaczej kamera staje z nosem w tynku) */
const ODSTEP_WN = 0.45;
const ODSTEP_OS = 1.2;

export function Walk() {
  const tryb = useStan((s) => s.tryb);
  const { gl, camera, invalidate, scene } = useThree();
  const ring = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const vray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    if (tryb !== "spacer") return;
    const el = gl.domElement;
    let down: { x: number; y: number; t: number } | null = null;

    const targets = () => {
      const s = useStan.getState();
      const w = s.widok === "dom" && s.dom ? reg.wnetrza.get(s.dom) : null;
      if (w) return { inside: true, floors: w.podlogi as THREE.Object3D[], all: [w.root] as THREE.Object3D[] };
      return { inside: false, floors: reg.grunt, all: [...reg.grunt, ...reg.przeszkody] };
    };

    const visibleHits = (r: THREE.Raycaster, all: THREE.Object3D[]) => r.intersectObjects(all, true).filter((h) => isVisible(h.object) && !!h.face);

    /** Czy w punkcie (x, z) można stanąć: pionowy promień z wysokości oczu trafia najpierw w podłogę
        albo w niską powierzchnię leżącą na niej. Zwraca punkt na powierzchni. */
    const wolne = (x: number, z: number, fromY: number, t: ReturnType<typeof targets>) => {
      vray.set(new THREE.Vector3(x, fromY, z), DOWN);
      vray.far = fromY + 50;
      const hs = visibleHits(vray, t.all);
      if (!hs.length) return null;
      const first = hs[0];
      const isF = (o: THREE.Object3D) => t.floors.some((f) => f === o || isChildOf(o, f));
      const fl = hs.find((h) => isF(h.object));
      if (!fl) return null;
      const n = first.face!.normal.clone().transformDirection(first.object.matrixWorld);
      if (first === fl) return fl.point.clone();
      // dywan / taras / próg: płaska powierzchnia tuż nad podłogą
      if (Math.abs(n.y) > 0.7 && first.point.y - fl.point.y < (t.inside ? NISKO_WN : NISKO_OS)) return first.point.clone();
      return null;
    };

    const hit = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const t = targets();
      const hits = visibleHits(ray, t.all);
      if (!hits.length) return null;
      const h = hits[0];
      const camPos = ray.ray.origin;
      // oko kamery nad bieżącą podłogą: pionowe sondy startują trochę poniżej oczu (pod sufitem, nad meblami)
      const fromY = camPos.y - 0.2;
      const n = h.face!.normal.clone().transformDirection(h.object.matrixWorld);
      // 1) trafienie w powierzchnię do chodzenia (podłoga, dywan, taras): sprawdzamy pionowo, że to wolne miejsce
      if (n.y > 0.7) {
        const p = wolne(h.point.x, h.point.z, Math.max(fromY, h.point.y + 0.3), t);
        if (p && Math.abs(p.y - h.point.y) < 0.08) return { point: p, normal: UP.clone(), dist: h.distance };
      }
      // 2) mebel / ściana / fasada: cofamy się wzdłuż promienia (w poziomie) w stronę kamery
      const dir = ray.ray.direction.clone();
      const flat = new THREE.Vector3(dir.x, 0, dir.z);
      const horiz = flat.length();
      if (horiz < 0.2) return null; // prawie pionowo w dół na mebel: nie zgadujemy
      flat.normalize();
      const dmax = Math.hypot(h.point.x - camPos.x, h.point.z - camPos.z) - (t.inside ? ODSTEP_WN : ODSTEP_OS);
      const step = t.inside ? 0.15 : 0.4;
      for (let d = dmax; d > (t.inside ? 0.7 : 1.5); d -= step) {
        const x = camPos.x + flat.x * d;
        const z = camPos.z + flat.z * d;
        const p = wolne(x, z, fromY, t);
        if (!p) continue;
        // ten sam poziom co kamera (bez skakania na niższą kondygnację / do wykopu)
        if (t.inside && Math.abs(camPos.y - 1.6 - p.y) > 0.6) continue;
        // odstęp: obok też musi być wolno (żeby nie stanąć wciśniętym w sofę)
        const side = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(0.25);
        if (t.inside && (!wolne(x + side.x, z + side.z, fromY, t) || !wolne(x - side.x, z - side.z, fromY, t))) continue;
        return { point: p, normal: UP.clone(), dist: Math.hypot(d, camPos.y - p.y) };
      }
      return null;
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
    // hak testowy (tools/test_spacer.mjs): dokąd pójdzie kamera po kliknięciu w punkt ekranu
    (window as unknown as Record<string, unknown>).__spacerHit = (x: number, y: number) => {
      const h = hit({ clientX: x, clientY: y });
      return h ? [h.point.x, h.point.y, h.point.z] : null;
    };
    // diagnostyka (QA): pierwsze widoczne trafienia w całej scenie pod punktem ekranu, z informacją, czy obiekt jest celem spaceru
    (window as unknown as Record<string, unknown>).__spacerDiag = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const t = targets();
      const scena = scene.children;
      return ray
        .intersectObjects(scena, true)
        .filter((h) => isVisible(h.object) && h.object.type !== "Points")
        .slice(0, 4)
        .map((h) => {
          const nazwy: string[] = [];
          for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.name) nazwy.push(o.name);
          return {
            obiekt: nazwy.slice(0, 3).join("<"),
            d: +h.distance.toFixed(2),
            cel: t.all.some((a) => a === h.object || isChildOf(h.object, a)),
            podloga: t.floors.some((f) => f === h.object || isChildOf(h.object, f)),
          };
        });
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
