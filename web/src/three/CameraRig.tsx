import * as THREE from "three";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { useStan, type PunktSpaceru } from "../state/store";
import { reg, maWnetrze, ustawDrzwi, NOWE_LADOWANIE } from "./models";
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

/** Przejście kamery do (pos, tgt) bez „nawijania” azymutu i bez łuku wokół starego celu.
    1) camera-controls 3.1 nie normalizuje kąta w setLookAt: po kilku obrotach w spacerze kąt bieżący
       narastał (np. 3 pełne obroty) i przejście odkręcało go z powrotem, stąd obroty kamery o 360°.
       normalizeRotations() po ustawieniu celu wybiera najkrótszą drogę.
    2) Przed przejściem bieżące ujęcie zapisujemy jako cel w odległości docelowej wzdłuż kierunku patrzenia
       (obraz się nie zmienia). Dzięki temu kamera leci prawie po prostej i obraca się najkrótszą drogą,
       zamiast zataczać łuk wokół starego celu (np. z widoku domu do spaceru). */
export function przejdz(c: CameraControlsImpl, pos: THREE.Vector3, tgt: THREE.Vector3, transition: boolean) {
  if (transition) {
    // każde przejście użytkownika (spacer, widok, punkt) kończy kadr 1:1: drzwi wracają do pozy otwartej
    for (const w of reg.wnetrza.values()) ustawDrzwi(w, false);
    const cp = c.getPosition(new THREE.Vector3(), false);
    const dir = c.getTarget(new THREE.Vector3(), false).sub(cp);
    if (dir.lengthSq() > 1e-10) {
      dir.normalize();
      const t = cp.clone().addScaledVector(dir, Math.max(0.05, pos.distanceTo(tgt)));
      c.setLookAt(cp.x, cp.y, cp.z, t.x, t.y, t.z, false);
      c.normalizeRotations();
      // prędkości z poprzedniego przejścia dotyczyły innego promienia: zerujemy, żeby nie było przestrzału
      const v = c as unknown as Record<string, { value?: number; set?: (x: number, y: number, z: number) => void }>;
      for (const k of ["_thetaVelocity", "_phiVelocity", "_radiusVelocity"]) if (v[k] && "value" in v[k]) v[k].value = 0;
      v._targetVelocity?.set?.(0, 0, 0);
    }
  }
  const done = c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, transition);
  c.normalizeRotations();
  return done;
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
    przejdz(c, e, e.clone().addScaledVector(dir, 0.05), true);
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
    // ujęcia QA z poziomu oczu: near jak w spacerze (adaptacyjne near jest zablokowane razem z rig.lock)
    const pc = c.camera as THREE.PerspectiveCamera;
    pc.near = 0.1;
    pc.updateProjectionMatrix();
    przejdz(c, new THREE.Vector3(...pos), new THREE.Vector3(...tgt), false);
    rig.invalidate();
  },
  /** Ujęcie QA 1:1 z renderem referencyjnym (KADR_n z GLB wnętrza bieżącego domu), np. rig.kadr("1.png"). */
  kadrPending: null as string | null,
  kadr(ref: string) {
    const c = rig.controls;
    rig.kadrPending = ref; // jeśli wnętrze jeszcze się wczytuje, kadr wykona się po rejestracji wnętrza
    if (!c) return false;
    // najpierw wnętrze aktywnego domu: przy nowym ładowaniu zamontowane są wszystkie domy (A i C mają te same
    // kadry co B, w odbiciu lustrzanym), a kadr ma trafić do domu z adresu
    const aktywny = useStan.getState().dom;
    const kolejka = [...reg.wnetrza.entries()].sort(([a], [b]) => (a === aktywny ? -1 : b === aktywny ? 1 : 0)).map(([, w]) => w);
    for (const w of kolejka) {
      const k = w.kadry.find((x) => x.ref === ref);
      if (!k) continue;
      // kamery SKP stoją czasem za oknem z dużym near: wyższe kondygnacje chowamy, żeby nie było widać przekroju stropu
      const kk = Number(/^PKT_(\d+)_/.exec(k.pokoj)?.[1] ?? 99);
      for (const [lvl, obj] of Object.entries(w.kond)) obj.visible = +lvl <= kk;
      const cam = c.camera as THREE.PerspectiveCamera;
      const t = k.pos.clone().addScaledVector(k.dir, 0.05);
      // FOV kamer SketchUpa jest poziomy (kadr 16:9): przeliczamy na pionowy dla three.js
      const aspect = cam.aspect || 16 / 9;
      const hor = (window as unknown as { __fovPoz?: boolean }).__fovPoz === true; // pomiar 07.11: FOV z SKP jest pionowy (poziomy dawał za ciasne kadry)
      const fovV = hor ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(k.fov) / 2) / aspect)) : k.fov;
      rig.ujecie([k.pos.x, k.pos.y, k.pos.z], [t.x, t.y, t.z], fovV);
      // drzwi jak na renderze (w spacerze są otwarte o 90°, reguła R12 agenta wnętrz)
      ustawDrzwi(w, true);
      cam.near = Math.max(0.05, k.near);
      cam.updateProjectionMatrix();
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

function isVisibleChain(o: THREE.Object3D | null) {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
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
    } else if (s.tryb === "spacer" && s.widok === "dom" && s.dom && maWnetrze(s.dom) && !reg.wnetrza.get(s.dom)) {
      // wnętrze jeszcze się wczytuje: pokazujemy bryłę domu, a po rejestracji wnętrza (interiorArrived)
      // kamera płynnie wchodzi do środka. Wcześniej ustawiała się na ulicy i potem przeskakiwała.
      const d = reg.domy.get(s.dom);
      if (!d) return;
      const f = houseFrontDir();
      tgt = new THREE.Vector3(d.center.x, d.ground + 4.2, d.center.z);
      pos = tgt.clone().addScaledVector(f, 23).add(new THREE.Vector3(0, 9.5, 0));
      fovTarget.current = FOV_DOM;
      limits = [9, 70];
    } else if (s.tryb === "spacer") {
      mode = "fp";
      const inside = s.widok === "dom" && s.dom && reg.wnetrza.get(s.dom);
      const list = inside ? inside.punkty : reg.punktyOsiedla;
      // start spaceru we wnętrzu: salon z kadrem renderu (najładniejsze ujęcie), potem dowolny punkt z kadrem
      const kadrowe = inside ? new Set(inside.kadry.map((k) => k.pokoj)) : new Set<string>();
      let p = pickPoint(list, s.punkt) ?? list.find((x) => /^PKT_0_SALON/.test(x.id) && kadrowe.has(x.id)) ?? list.find((x) => kadrowe.has(x.id)) ?? list[0];
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
      // start zapisany w GLB przy punkcie (extras.spacer + extras.cel od agenta wnętrz) ma pierwszeństwo
      const pktStart = inside ? (inside as { startyPunktow?: Record<string, { pos: THREE.Vector3; cel: THREE.Vector3 }> }).startyPunktow?.[p.id] : undefined;
      if (pktStart && !kadr) {
        pos = pktStart.pos.clone();
        tgt = pos.clone().addScaledVector(pktStart.cel.clone().sub(pos).normalize(), 0.05);
        fovTarget.current = FOV_SPACER;
        configure("fp");
        c.minPolarAngle = 0;
        c.maxPolarAngle = Math.PI;
        przejdz(c, pos, tgt, transition).then(() => {
          if (rig.mode !== "fp") return;
          c.minDistance = 0; c.maxDistance = 0.2; c.minPolarAngle = 0.35; c.maxPolarAngle = Math.PI - 0.45;
        });
        invalidate();
        return;
      }
      if (kadr) {
        // stanowisko i kierunek jak na wizualizacji, ale oko na wysokości spaceru (1,6 m nad posadzką punktu):
        // kamery renderów stoją na 1,25–1,4 m, więc pierwszy krok podnosił kamerę o 20–35 cm
        pos = kadr.spacer.clone();
        pos.y = base.y + 1.6;
        tgt = pos.clone().addScaledVector(kadr.dir, 0.05);
        fovTarget.current = FOV_SPACER;
        configure("fp");
        c.minPolarAngle = 0;
        c.maxPolarAngle = Math.PI;
        przejdz(c, pos, tgt, transition).then(() => {
          if (rig.mode !== "fp") return;
          c.minDistance = 0; c.maxDistance = 0.2; c.minPolarAngle = 0.35; c.maxPolarAngle = Math.PI - 0.45;
        });
        invalidate();
        return;
      }
      // na osiedlu patrzymy w stronę najbliższego domu. We wnętrzu (punkt bez kadru renderu) patrzymy w głąb
      // pomieszczenia: kierunek z najdłuższym wolnym widokiem na wysokości oczu (najdłuższa przekątna),
      // a kamerę cofamy pod przeciwległą ścianę (do 2,2 m, 0,5 m przed nią). Wcześniej zawsze +Z, więc
      // w WC, wejściu, holu i łazience start wypadał 1 m przed ścianą (b7 P1-12).
      let look = new THREE.Vector3(0, 0, -1);
      if (inside && s.dom) {
        const root = (inside as { root: THREE.Object3D }).root;
        const free = (from: THREE.Vector3, dir: THREE.Vector3, max: number) => {
          const ray = new THREE.Raycaster(from, dir, 0.05, max);
          const hit = ray.intersectObject(root, true).find((h) => isVisibleChain(h.object));
          return hit ? hit.distance : max;
        };
        // ocena kierunku = średnia z wachlarza promieni (±20°, na wysokości oczu i 0,4 m wyżej), ucięta do 6 m:
        // wąski otwór drzwi daje długi promień środkowy, ale krótkie boczne, więc nie wygrywa z przekątną pokoju
        const yaw = (a: number) => new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        // szeroki wachlarz (±45°), a promienie dłuższe niż 1,6 × mediana wachlarza przycinamy: promień, który
        // ucieka przez otwór drzwi, nie podbija oceny kierunku „na korytarz” (WC, łazienka, wejście)
        const score = (from: THREE.Vector3, a: number) => {
          const d: number[] = [];
          for (const da of [-0.8, -0.5, -0.25, 0, 0.25, 0.5, 0.8]) for (const dy of [0, 0.4]) d.push(free(from.clone().setY(from.y + dy), yaw(a + da), 6));
          const med = [...d].sort((x, y) => x - y)[d.length >> 1];
          return d.reduce((acc, x) => acc + Math.min(x, 1.6 * med), 0) / d.length;
        };
        // najpierw stajemy pod ścianą przeciwną do najlepszego kierunku, potem wybieramy kierunek jeszcze raz
        // z tego miejsca (z kąta pokoju widać więcej)
        const bestYaw = (from: THREE.Vector3) => {
          let bA = 0, bS = -1;
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const sc = score(from, a);
            if (sc > bS + 0.02) { bS = sc; bA = a; }
          }
          return bA;
        };
        const a1 = bestYaw(pos);
        const back = yaw(a1).negate();
        pos.addScaledVector(back, Math.max(0, Math.min(2.2, free(pos, back, 2.7) - 0.5)));
        look = yaw(bestYaw(pos));
        look.y = -0.12;
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
    const done = przejdz(c, pos, tgt, transition);
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
      return st.scenaGotowa && st.dodatkiGotowe && (!NOWE_LADOWANIE || (st.rozgrzane && reg.lmOczekujace === 0)) && st.wnetrzeGotowe !== false && !rig.kadrPending && performance.now() - lastMove.current > 450 && Math.abs(cam.fov - fovTarget.current) < 0.02;
    };
    apply(false);
    let prev = useStan.getState();
    return useStan.subscribe((s) => {
      const p = prev;
      prev = s;
      // punkt → null to tylko zdjęcie zaznaczenia po swobodnym kroku w spacerze: kamera już idzie w kliknięte
      // miejsce i nie może wracać do pierwszego punktu domu (wcześniej tak skakała po kliknięciu w podłogę)
      const punktChanged = s.punkt !== p.punkt && s.punkt !== null;
      const viewChanged = s.widok !== p.widok || s.dom !== p.dom || s.tryb !== p.tryb || s.kond !== p.kond || punktChanged;
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
    // precyzja głębi: near zależny od odległości kamery od celu. Stałe near 0,1 przy far 4000 dawało
    // w widoku z lotu ptaka (100–200 m) rozdzielczość głębi 6–24 mm, więc powierzchnie bliższe niż 2–3 cm
    // migotały. W spacerze we wnętrzu near 5 cm (meble tuż przed kamerą), na zewnątrz 10 cm.
    if (!rig.lock && ref.current) {
      const st = useStan.getState();
      const want =
        rig.mode === "fp" ? (st.widok === "dom" ? 0.05 : 0.1) : THREE.MathUtils.clamp(ref.current.distance * 0.02, 0.1, 1.5);
      if (Math.abs(cam.near - want) > want * 0.12) {
        cam.near = want;
        cam.updateProjectionMatrix();
        invalidate();
      }
    }
    // kondygnacja kamery w spacerze (pigułka pięter musi się zmieniać przy wejściu po schodach)
    {
      const st = useStan.getState();
      const w = rig.mode === "fp" && st.widok === "dom" && st.dom ? reg.wnetrza.get(st.dom) : null;
      let lv: number | null = null;
      if (w) {
        const y = cam.position.y - 1.6;
        lv = 0;
        for (const [k, v] of Object.entries(w.poziomy)) if (y > v - 0.6 && +k > lv) lv = +k;
      }
      if (lv !== st.poziomSpaceru) st.set({ poziomSpaceru: lv });
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
