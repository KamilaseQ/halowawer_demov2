import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { useStan, type PunktSpaceru } from "../state/store";
import { reg } from "./models";
import KAM from "../data/kameraZdjecia.json";
import { KAT_PN } from "../lib/slonce";

const A = CameraControlsImpl.ACTION;
const EYE = 1.65;
const FOV_DOM = 40;
const FOV_RZUT = 28;
const FOV_SPACER = 62;

/** Pionowy FOV, przy którym kadr 3D pokrywa się ze zdjęciem wyświetlanym jak object-fit: cover. */
export function photoFov(aspect: number) {
  const ap = KAM.w / KAM.h;
  const t = Math.tan(THREE.MathUtils.degToRad(KAM.fov) / 2) * Math.min(1, ap / aspect);
  return THREE.MathUtils.radToDeg(2 * Math.atan(t));
}

/* API dla innych komponentów (spacer, przyciski zoomu, kompas). */
export const rig = {
  controls: null as CameraControlsImpl | null,
  mode: "orbit" as "orbit" | "fp" | "top",
  kompas: null as null | ((azDeg: number) => void),
  walkTo(p: THREE.Vector3, eye = EYE) {
    const c = rig.controls;
    if (!c) return;
    const pos = c.getPosition(new THREE.Vector3());
    const tgt = c.getTarget(new THREE.Vector3());
    const dir = tgt.sub(pos);
    dir.y = Math.max(-0.4, Math.min(0.2, dir.y / (dir.length() || 1))) * (dir.length() || 1);
    dir.normalize();
    const e = p.clone().add(new THREE.Vector3(0, eye, 0));
    c.smoothTime = 0.55;
    c.setLookAt(e.x, e.y, e.z, e.x + dir.x * 0.05, e.y + dir.y * 0.05, e.z + dir.z * 0.05, true);
  },
  fov: 45,
  /** ujęcie ustawione ręcznie (QA: ujecie/kadr): automatyczne ustawienia po doładowaniu go nie nadpisują */
  lock: false,
  invalidate: () => {},
  /** Powrót do domyślnego ujęcia bieżącego widoku. */
  reset: () => {},
  /** Ujęcie QA: dowolna kamera (bez limitów), np. kadry porównawcze z referencjami. */
  ujecie(pos: [number, number, number], tgt: [number, number, number], fov?: number) {
    const c = rig.controls;
    if (!c) return;
    c.minDistance = 0;
    c.maxDistance = Infinity;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    if (fov) rig.fov = fov;
    rig.lock = true;
    c.setLookAt(...pos, ...tgt, false);
    rig.invalidate();
  },
  /** Ujęcie QA 1:1 z renderem referencyjnym (KADR_n z GLB wnętrza bieżącego domu), np. rig.kadr("1.png"). */
  kadrPending: null as string | null,
  kadr(ref: string) {
    const c = rig.controls;
    rig.kadrPending = ref; // jeśli wnętrze jeszcze się wczytuje, kadr wykona się po rejestracji wnętrza
    if (!c) return false;
    for (const w of reg.wnetrza.values()) {
      const k = w.kadry.find((x) => x.ref === ref);
      if (!k) continue;
      // kamery SKP stoją czasem za oknem z dużym near: wyższe kondygnacje chowamy, żeby nie było widać przekroju stropu
      const kk = Number(/^PKT_(\d+)_/.exec(k.pokoj)?.[1] ?? 99);
      for (const [lvl, obj] of Object.entries(w.kond)) obj.visible = +lvl <= kk;
      const cam = c.camera as THREE.PerspectiveCamera;
      cam.near = Math.max(0.05, k.near);
      cam.updateProjectionMatrix();
      const t = k.pos.clone().addScaledVector(k.dir, 0.05);
      // FOV kamer SketchUpa jest poziomy (kadr 16:9): przeliczamy na pionowy dla three.js
      const aspect = cam.aspect || 16 / 9;
      const hor = (window as unknown as { __fovPoz?: boolean }).__fovPoz === true; // pomiar 07.11: FOV z SKP jest pionowy (poziomy dawał za ciasne kadry)
      const fovV = hor ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(k.fov) / 2) / aspect)) : k.fov;
      rig.ujecie([k.pos.x, k.pos.y, k.pos.z], [t.x, t.y, t.z], fovV);
      rig.kadrPending = null;
      return true;
    }
    return false;
  },
  zoom(sign: 1 | -1) {
    const c = rig.controls;
    if (!c) return;
    if (rig.mode === "fp") c.zoomTo(THREE.MathUtils.clamp(c.camera.zoom * (sign > 0 ? 1.25 : 0.8), 1, 3), true);
    else c.dolly(sign * c.distance * 0.28, true);
  },
};

function houseFrontDir(): THREE.Vector3 {
  // kierunek „od domu do kamery zdjęcia” w poziomie: fronty od ulicy, ukos jak na zdjęciu
  const p = new THREE.Vector3(...(KAM.pozycja as [number, number, number]));
  const t = new THREE.Vector3(...(KAM.cel as [number, number, number]));
  const d = p.sub(t);
  d.y = 0;
  return d.normalize();
}

function floorLevel(dom: string, kond: number): number {
  const w = reg.wnetrza.get(dom as never);
  if (w && w.poziomy[kond] !== undefined) return w.poziomy[kond];
  const d = reg.domy.get(dom as never);
  return (d ? d.ground + 0.15 : 0) + kond * 2.95;
}

function pickPoint(list: PunktSpaceru[], id: string | null) {
  return list.find((p) => p.id === id) ?? null;
}

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const { camera, size, invalidate } = useThree();
  rig.invalidate = invalidate;
  if (rig.fov === 45) rig.fov = photoFov(size.width / size.height);
  const fovTarget = { get current() { return rig.fov; }, set current(v: number) { rig.fov = v; } };
  const azPrev = useRef(999);
  const lastMove = useRef(performance.now());
  const shift = useRef(0);
  const prevM = useRef(new THREE.Matrix4());

  const configure = (mode: "orbit" | "fp" | "top") => {
    const c = ref.current;
    if (!c) return;
    rig.mode = mode;
    if (mode === "orbit") {
      c.mouseButtons.left = A.ROTATE;
      c.mouseButtons.right = A.TRUCK;
      c.mouseButtons.middle = A.DOLLY;
      c.mouseButtons.wheel = A.DOLLY;
      c.touches.one = A.TOUCH_ROTATE;
      c.touches.two = A.TOUCH_DOLLY_TRUCK;
      c.touches.three = A.TOUCH_TRUCK;
      c.azimuthRotateSpeed = 0.9;
      c.polarRotateSpeed = 0.9;
      c.minPolarAngle = 0.08;
      c.maxPolarAngle = THREE.MathUtils.degToRad(80);
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.dollyToCursor = true;
      c.zoomTo(1, false);
    } else if (mode === "fp") {
      c.mouseButtons.left = A.ROTATE;
      c.mouseButtons.right = A.NONE;
      c.mouseButtons.middle = A.NONE;
      c.mouseButtons.wheel = A.ZOOM;
      c.touches.one = A.TOUCH_ROTATE;
      c.touches.two = A.TOUCH_ZOOM;
      c.touches.three = A.NONE;
      c.azimuthRotateSpeed = -0.32;
      c.polarRotateSpeed = -0.32;
      c.minPolarAngle = 0.35;
      c.maxPolarAngle = Math.PI - 0.45;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.minZoom = 1;
      c.maxZoom = 3;
      c.dollyToCursor = false;
    } else {
      c.mouseButtons.left = A.TRUCK;
      c.mouseButtons.right = A.ROTATE;
      c.mouseButtons.middle = A.DOLLY;
      c.mouseButtons.wheel = A.DOLLY;
      c.touches.one = A.TOUCH_TRUCK;
      c.touches.two = A.TOUCH_DOLLY_ROTATE;
      c.azimuthRotateSpeed = 0.6;
      c.polarRotateSpeed = 0;
      c.dollyToCursor = true;
      c.zoomTo(1, false);
    }
  };

  const apply = (transition = true) => {
    const c = ref.current;
    if (!c) return;
    const s = useStan.getState();
    const aspect = size.width / Math.max(1, size.height);
    c.smoothTime = 0.7;
    {
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.near !== 0.1) { cam.near = 0.1; cam.updateProjectionMatrix(); }
    }
    // limity odległości zdejmujemy na czas przejścia, potem ustawiamy docelowe
    c.minDistance = 0;
    c.maxDistance = Infinity;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    let pos: THREE.Vector3, tgt: THREE.Vector3, mode: "orbit" | "fp" | "top" = "orbit";
    let limits: [number, number] = [8, 320];

    if (s.widok === "osiedle" && s.tryb !== "spacer") {
      pos = new THREE.Vector3(...(KAM.pozycja as [number, number, number]));
      tgt = new THREE.Vector3(...(KAM.cel as [number, number, number]));
      fovTarget.current = photoFov(aspect);
      limits = [12, 320];
    } else if (s.tryb === "spacer") {
      mode = "fp";
      const inside = s.widok === "dom" && s.dom && reg.wnetrza.get(s.dom);
      const list = inside ? inside.punkty : reg.punktyOsiedla;
      let p = pickPoint(list, s.punkt) ?? list[0];
      if (!p && s.widok === "dom" && s.dom) {
        // brak wnętrza: spacer zaczyna się przed domem, od ulicy
        const d = reg.domy.get(s.dom);
        if (!d) return;
        const f = houseFrontDir();
        p = { id: "", etykieta: "", pos: [d.center.x + f.x * 9, d.ground, d.center.z + f.z * 9] };
      }
      if (!p) return;
      const base = new THREE.Vector3(...p.pos);
      pos = base.clone().add(new THREE.Vector3(0, inside ? 1.6 : EYE, 0));
      // start w pokoju z kadrem renderu (KADR_n): oko i kierunek jak na wizualizacji
      const kadr = inside ? (inside as { kadry: { pokoj: string; spacer: THREE.Vector3; dir: THREE.Vector3 }[] }).kadry.find((k) => k.pokoj === p!.id) : undefined;
      if (kadr) {
        pos = kadr.spacer.clone();
        tgt = pos.clone().addScaledVector(kadr.dir, 0.05);
        fovTarget.current = FOV_SPACER;
        configure("fp");
        c.minPolarAngle = 0;
        c.maxPolarAngle = Math.PI;
        c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, transition).then(() => {
          if (rig.mode !== "fp") return;
          c.minDistance = 0; c.maxDistance = 0.2; c.minPolarAngle = 0.35; c.maxPolarAngle = Math.PI - 0.45;
        });
        invalidate();
        return;
      }
      // na osiedlu patrzymy w stronę najbliższego domu. We wnętrzu kadr jak na renderach (1.png, 4.png):
      // cofamy się od punktu w głąb domu (do 2,6 m, przed ścianą) i patrzymy w stronę ogrodu (+Z)
      let look = new THREE.Vector3(0, 0, -1);
      if (inside && s.dom) {
        const d = reg.domy.get(s.dom);
        if (d) {
          look = new THREE.Vector3(0, 0, 1);
          const back = new THREE.Vector3(0, 0, -1);
          const ray = new THREE.Raycaster(pos.clone(), back, 0, 2.6);
          const hit = ray.intersectObject((inside as { root: THREE.Object3D }).root, true).find((h) => h.object.visible);
          const step = hit ? Math.max(0, hit.distance - 0.55) : 2.6;
          pos.addScaledVector(back, step);
        }
        look.y = -0.1;
      }
      if (!inside) {
        let best: THREE.Vector3 | null = null;
        let bd = Infinity;
        for (const d of reg.domy.values()) {
          const dd = d.center.distanceTo(base);
          if (dd < bd) { bd = dd; best = d.center; }
        }
        if (best) look = best.clone().sub(base).setY(0).normalize();
        look.y = 0.08;
      }
      tgt = pos.clone().addScaledVector(look.normalize(), 0.05);
      fovTarget.current = FOV_SPACER;
      limits = [0, 0.2];
    } else if (s.widok === "dom" && s.dom) {
      const d = reg.domy.get(s.dom);
      if (!d) return;
      const f = houseFrontDir();
      if (s.tryb === "rzut") {
        mode = "top";
        const k = s.kond === "dom" ? 0 : s.kond;
        const y = floorLevel(s.dom, k);
        tgt = new THREE.Vector3(d.center.x, y, d.center.z);
        pos = tgt.clone().add(new THREE.Vector3(0, 34, 0)).addScaledVector(new THREE.Vector3(0, 0, -1), 0.02);
        fovTarget.current = FOV_RZUT;
        limits = [12, 80];
      } else if (s.kond === "dom") {
        tgt = new THREE.Vector3(d.center.x, d.ground + 4.2, d.center.z);
        pos = tgt.clone().addScaledVector(f, 23).add(new THREE.Vector3(0, 9.5, 0));
        fovTarget.current = FOV_DOM;
        limits = [9, 70];
      } else {
        const y = floorLevel(s.dom, s.kond);
        tgt = new THREE.Vector3(d.center.x, y + 0.6, d.center.z);
        pos = tgt.clone().addScaledVector(f, 8.5).add(new THREE.Vector3(0, 17, 0));
        fovTarget.current = FOV_DOM;
        limits = [7, 45];
      }
    } else return;

    configure(mode);
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    const done = c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, transition);
    const finalize = () => {
      if (rig.mode !== mode) return;
      c.minDistance = limits[0];
      c.maxDistance = limits[1];
      if (mode === "orbit") {
        c.minPolarAngle = 0.08;
        c.maxPolarAngle = THREE.MathUtils.degToRad(s.widok === "dom" && s.kond !== "dom" ? 70 : 82);
      } else if (mode === "fp") {
        c.minPolarAngle = 0.35;
        c.maxPolarAngle = Math.PI - 0.45;
      } else {
        const pol = c.polarAngle;
        c.minPolarAngle = pol;
        c.maxPolarAngle = pol;
      }
    };
    if (transition) done.then(finalize);
    else finalize();
    invalidate();
  };

  // reakcja na zmiany stanu
  useEffect(() => {
    rig.controls = ref.current as unknown as CameraControlsImpl;
    rig.reset = () => apply(true);
    // haki dla zrzutów QA (tools/shot.mjs)
    const w = window as unknown as Record<string, unknown>;
    w.__stan = useStan;
    w.__rig = rig;
    w.__ready = () => {
      const cam = camera as THREE.PerspectiveCamera;
      const st = useStan.getState();
      return st.scenaGotowa && st.dodatkiGotowe && st.wnetrzeGotowe !== false && !rig.kadrPending && performance.now() - lastMove.current > 450 && Math.abs(cam.fov - fovTarget.current) < 0.02;
    };
    apply(false);
    let prev = useStan.getState();
    return useStan.subscribe((s) => {
      const p = prev;
      prev = s;
      const viewChanged = s.widok !== p.widok || s.dom !== p.dom || s.tryb !== p.tryb || s.kond !== p.kond || s.punkt !== p.punkt;
      const backToPhoto = s.zdjecie && !p.zdjecie;
      const interiorArrived = s.punkty !== p.punkty && s.widok === "dom" && (s.tryb === "spacer" || s.kond !== "dom");
      // start z linku (#/dom/D, spacer): rejestr domów i punktów jest pełny dopiero po wczytaniu sceny
      const sceneArrived = s.scenaGotowa && !p.scenaGotowa && !(s.widok === "osiedle" && s.tryb === "model");
      if (viewChanged || backToPhoto) rig.lock = false;
      if (rig.lock) return;
      if (sceneArrived) apply(false);
      else if (viewChanged || backToPhoto || interiorArrived) apply(true);
    });
  }, []);

  // przy zmianie proporcji okna FOV osiedla musi dalej pokrywać się ze zdjęciem
  useEffect(() => {
    shift.current = NaN; // wymuś ponowne ustawienie przesunięcia obiektywu dla nowego rozmiaru
    const s = useStan.getState();
    if (s.widok === "osiedle" && s.tryb !== "spacer") fovTarget.current = photoFov(size.width / size.height);
    invalidate();
  }, [size.width, size.height]);

  // przesunięcie obiektywu: gdy po prawej jest karta domu, środek kadru przesuwa się w lewo (bez obracania kamery)
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    {
      const st = useStan.getState();
      const card = st.widok === "dom" && st.tryb !== "spacer" && st.galeria === null && size.width > 900;
      const want = card ? -Math.min(170, size.width * 0.09) : 0;
      if (Number.isNaN(shift.current) || Math.abs(shift.current - want) > 0.5) {
        shift.current = Number.isNaN(shift.current) ? want : shift.current + (want - shift.current) * (1 - Math.exp(-dt * 4));
        if (Math.abs(shift.current - want) < 0.5) shift.current = want;
        if (Math.abs(shift.current) < 0.5) cam.clearViewOffset();
        else cam.setViewOffset(size.width, size.height, -shift.current, 0, size.width, size.height);
        invalidate();
      }
    }
    if (!prevM.current.equals(cam.matrixWorld)) {
      prevM.current.copy(cam.matrixWorld);
      lastMove.current = performance.now();
    }
    const f = fovTarget.current;
    if (Math.abs(cam.fov - f) > 0.01) {
      cam.fov += (f - cam.fov) * (1 - Math.exp(-dt * 4));
      if (Math.abs(cam.fov - f) < 0.01) cam.fov = f;
      cam.updateProjectionMatrix();
      invalidate();
    }
    if (rig.kompas) {
      const dir = cam.getWorldDirection(new THREE.Vector3());
      // azymut od północy (−Z) w stronę wschodu (+X)
      const az = (THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z)) + KAT_PN + 360) % 360;
      if (Math.abs(az - azPrev.current) > 0.05) {
        azPrev.current = az;
        rig.kompas(az);
      }
    }
  });

  return <CameraControls ref={ref} makeDefault smoothTime={0.7} draggingSmoothTime={0.12} />;
}
